import { Database } from "bun:sqlite";
import {
  readdir,
  readFile,
  realpath,
  stat,
  copyFile,
  chmod,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  isAbsolute,
} from "node:path";
import { constants } from "node:fs";
import {
  cursorFor,
  cursorOffset,
  dataDir,
  exportDirectory,
  fail,
  fingerprint,
  mediaKind,
  privateDir,
  runProcess,
  safeName,
  type Media,
  type SearchOptions,
} from "../core";
const extensions =
  /\.(jpe?g|png|heic|heif|gif|webp|tiff?|dng|avif|raw|cr2|nef|arw|mov|mp4|m4v|avi|webm|3gp|mkv)$/i;
export class Takeout {
  private constructor(private db: Database) {}
  static async open() {
    const directory = dataDir();
    await privateDir(directory);
    const file = join(directory, "takeout.sqlite");
    // Reserve a private file before SQLite opens it; do not rely on the caller's umask.
    const { open } = await import("node:fs/promises");
    const handle = await open(file, "a", 0o600);
    await handle.close();
    await chmod(file, 0o600);
    const db = new Database(file, { create: true });
    db.exec(
      "PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, root TEXT NOT NULL, path TEXT NOT NULL, filename TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, takenAt TEXT, kind TEXT NOT NULL, album TEXT NOT NULL); CREATE INDEX IF NOT EXISTS media_date ON media(takenAt); CREATE INDEX IF NOT EXISTS media_root ON media(root);",
    );
    return new Takeout(db);
  }
  close() {
    this.db.close();
  }
  status() {
    return this.db
      .query(
        "SELECT COUNT(*) AS items, COUNT(DISTINCT root) AS archives FROM media",
      )
      .get();
  }
  async import(directory: string) {
    let root: string;
    try {
      root = await realpath(resolve(directory));
      if (!(await stat(root)).isDirectory()) throw new Error();
    } catch {
      return fail(
        "ARCHIVE_NOT_FOUND",
        "The archive directory does not exist.",
        "Extract your Google Takeout ZIP first, then pass the Google Photos folder.",
        4,
      );
    }
    const records: any[] = [];
    let ignoredSidecars = 0;
    async function walk(folder: string) {
      const entries = await readdir(folder, { withFileTypes: true });
      // Do not follow symlinks out of a user-selected archive.
      const sidecars = new Map<string, any>();
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const path = join(folder, entry.name);
        if ((await stat(path)).size > 2 * 1024 * 1024) {
          ignoredSidecars++;
          continue;
        }
        try {
          const metadata = JSON.parse(await readFile(path, "utf8"));
          sidecars.set(entry.name, metadata);
          if (
            typeof metadata.title === "string" &&
            !sidecars.has(metadata.title)
          )
            sidecars.set(metadata.title, metadata);
        } catch {
          ignoredSidecars++;
        }
      }
      for (const entry of entries) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) {
          await walk(path);
          continue;
        }
        if (!entry.isFile() || !extensions.test(entry.name)) continue;
        const metadata =
          sidecars.get(entry.name + ".supplemental-metadata.json") ||
          sidecars.get(entry.name + ".json") ||
          sidecars.get(entry.name) ||
          {};
        const timestamp = Number(metadata.photoTakenTime?.timestamp);
        const date =
          Number.isFinite(timestamp) && timestamp > 0
            ? new Date(timestamp * 1000)
            : null;
        const takenAt =
          date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
        records.push({
          id: fingerprint(path),
          root,
          path,
          filename: entry.name,
          title:
            typeof metadata.title === "string" ? metadata.title : entry.name,
          description:
            typeof metadata.description === "string"
              ? metadata.description
              : "",
          takenAt,
          kind: mediaKind(entry.name),
          album: relative(root, folder) || basename(root),
        });
      }
    }
    await walk(root);
    // Replace only this archive's index in one transaction, including removed files.
    const insert = this.db.prepare(
      "INSERT INTO media VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET root=excluded.root,path=excluded.path,filename=excluded.filename,title=excluded.title,description=excluded.description,takenAt=excluded.takenAt,kind=excluded.kind,album=excluded.album",
    );
    this.db.transaction(() => {
      this.db.query("DELETE FROM media WHERE root=?").run(root);
      for (const record of records)
        insert.run(
          record.id,
          record.root,
          record.path,
          record.filename,
          record.title,
          record.description,
          record.takenAt,
          record.kind,
          record.album,
        );
    })();
    return {
      indexed: records.length,
      ignoredSidecars,
      root,
      copiedMedia: false,
      searchEngine: "takeout-metadata",
      note: "Search covers filenames, captions and folder names. This index does not contain Google’s face, object or OCR search.",
    };
  }
  search(options: SearchOptions) {
    if (options.favorite)
      fail(
        "UNSUPPORTED_FILTER",
        "Takeout does not provide a reliable favorites filter.",
        undefined,
        2,
      );
    const { cursor, ...query } = options;
    const scope = { source: "takeout", ...query };
    const offset = cursorOffset(cursor, scope);
    const clauses: string[] = [];
    const values: (string | number)[] = [];
    if (options.query) {
      clauses.push(
        "(instr(lower(filename),lower(?))>0 OR instr(lower(title),lower(?))>0 OR instr(lower(description),lower(?))>0 OR instr(lower(album),lower(?))>0)",
      );
      values.push(...Array(4).fill(options.query));
    }
    if (options.after) {
      clauses.push("takenAt>=?");
      values.push(options.after);
    }
    if (options.before) {
      clauses.push("takenAt<?");
      values.push(options.before);
    }
    if (options.album) {
      clauses.push("album=?");
      values.push(options.album);
    }
    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
    const rows = this.db
      .query(
        `SELECT * FROM media ${where} ORDER BY takenAt DESC, id LIMIT ? OFFSET ?`,
      )
      .all(...values, options.limit + 1, offset) as any[];
    return {
      items: rows.slice(0, options.limit).map((row) => this.media(row)),
      nextCursor:
        rows.length > options.limit
          ? cursorFor(offset + options.limit, scope)
          : null,
      searchEngine: "takeout-metadata",
      order: "takenAt-desc-id",
    };
  }
  albums(limit: number, cursor?: string) {
    const scope = { source: "takeout", command: "albums", limit };
    const offset = cursorOffset(cursor, scope);
    const rows = this.db
      .query(
        "SELECT album AS id, album AS name, COUNT(*) AS count FROM media GROUP BY album ORDER BY album LIMIT ? OFFSET ?",
      )
      .all(limit + 1, offset);
    return {
      items: rows.slice(0, limit),
      nextCursor: rows.length > limit ? cursorFor(offset + limit, scope) : null,
    };
  }
  private row(id: string) {
    const row = this.db.query("SELECT * FROM media WHERE id=?").get(id) as any;
    if (!row)
      fail(
        "NOT_FOUND",
        "This item is not in the Takeout index.",
        "Search the archive again.",
        4,
      );
    return row;
  }
  private media(row: any): Media {
    return {
      id: row.id,
      source: "takeout",
      filename: row.filename,
      title: row.title,
      description: row.description,
      takenAt: row.takenAt || undefined,
      kind: row.kind,
      localPath: row.path,
    };
  }
  get(id: string) {
    return this.media(this.row(id));
  }
  private async sourcePath(id: string) {
    const row = this.row(id);
    let path: string;
    try {
      path = await realpath(row.path);
    } catch {
      return fail(
        "FILE_MISSING",
        "The indexed photo is no longer on disk.",
        "Reconnect or re-import the archive.",
        4,
      );
    }
    const within = relative(row.root, path);
    if (
      within === ".." ||
      within.startsWith("../") ||
      within.startsWith("..\\") ||
      isAbsolute(within)
    )
      fail(
        "ARCHIVE_PATH_CHANGED",
        "The indexed file now points outside its archive.",
      );
    return { row, path };
  }
  async export(id: string, out: string) {
    const { path } = await this.sourcePath(id);
    return exportDirectory(out, async (staging) => {
      await copyFile(
        path,
        join(staging, basename(path)),
        constants.COPYFILE_EXCL,
      );
    });
  }
  async preview(id: string, out: string, signal?: AbortSignal) {
    const { row, path } = await this.sourcePath(id);
    if (row.kind !== "photo")
      fail(
        "PREVIEW_UNSUPPORTED",
        "Takeout preview only supports still images.",
        "Use export for video and other formats.",
        2,
      );
    if (process.platform === "darwin") {
      const result = await exportDirectory(out, async (staging) => {
        const destination = join(
          staging,
          safeName(row.filename.replace(/\.[^.]+$/, "") + "-preview.jpg"),
        );
        const converted = await runProcess(
          [
            "/usr/bin/sips",
            "-s",
            "format",
            "jpeg",
            "-Z",
            "1600",
            path,
            "--out",
            destination,
          ],
          60_000,
          signal,
        );
        if (converted.code)
          fail(
            "PREVIEW_FAILED",
            "macOS could not make a JPEG preview from this Takeout item.",
            "Use export instead.",
            5,
          );
      });
      return {
        ...result,
        note: "JPEG preview, correctly oriented by macOS and bounded to 1600 pixels per dimension.",
      };
    }
    if (!/\.(jpe?g|png|gif|webp|avif)$/i.test(row.filename))
      fail(
        "PREVIEW_PLATFORM_UNSUPPORTED",
        "This Takeout image needs macOS to make a JPEG preview.",
        "Use macOS for HEIC, RAW, TIFF and other non-web-readable stills, or export the original.",
        3,
      );
    const result = await exportDirectory(out, async (staging) => {
      await copyFile(
        path,
        join(staging, safeName(row.filename)),
        constants.COPYFILE_EXCL,
      );
    });
    return {
      ...result,
      note: "Web-readable Takeout preview copied locally; dimensions are unchanged on this platform.",
    };
  }
}
