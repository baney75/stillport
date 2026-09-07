import { Database } from "bun:sqlite";
import {
  readdir,
  readFile,
  realpath,
  stat,
  chmod,
  open,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  isAbsolute,
} from "node:path";
import {
  cancellationError,
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
  throwIfCancelled,
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
  async import(directory: string, signal?: AbortSignal) {
    throwIfCancelled(signal);
    let root: string;
    try {
      root = await realpath(resolve(directory));
      throwIfCancelled(signal);
      if (!(await stat(root)).isDirectory()) throw new Error();
      throwIfCancelled(signal);
    } catch {
      if (signal?.aborted) cancellationError();
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
      throwIfCancelled(signal);
      const entries = await readdir(folder, { withFileTypes: true });
      throwIfCancelled(signal);
      // Do not follow symlinks out of a user-selected archive.
      const sidecars = new Map<string, any>();
      for (const entry of entries) {
        throwIfCancelled(signal);
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const path = join(folder, entry.name);
        const size = (await stat(path)).size;
        throwIfCancelled(signal);
        if (size > 2 * 1024 * 1024) {
          ignoredSidecars++;
          continue;
        }
        try {
          const metadata = JSON.parse(await readFile(path, "utf8"));
          throwIfCancelled(signal);
          sidecars.set(entry.name, metadata);
          if (
            typeof metadata.title === "string" &&
            !sidecars.has(metadata.title)
          )
            sidecars.set(metadata.title, metadata);
        } catch {
          if (signal?.aborted) cancellationError();
          ignoredSidecars++;
        }
      }
      for (const entry of entries) {
        throwIfCancelled(signal);
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
    throwIfCancelled(signal);
    // Replace only this archive's index in one transaction, including removed files.
    const insert = this.db.prepare(
      "INSERT INTO media VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET root=excluded.root,path=excluded.path,filename=excluded.filename,title=excluded.title,description=excluded.description,takenAt=excluded.takenAt,kind=excluded.kind,album=excluded.album",
    );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.query("DELETE FROM media WHERE root=?").run(root);
      for (let index = 0; index < records.length; index++) {
        if (index % 100 === 0) {
          await Bun.sleep(0);
          throwIfCancelled(signal);
        }
        const record = records[index]!;
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
      }
      throwIfCancelled(signal);
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw error;
    }
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
  private async sourcePath(id: string, signal?: AbortSignal) {
    throwIfCancelled(signal);
    const row = this.row(id);
    let path: string;
    try {
      path = await realpath(row.path);
      throwIfCancelled(signal);
    } catch {
      if (signal?.aborted) cancellationError();
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
  async export(id: string, out: string, signal?: AbortSignal) {
    const { path } = await this.sourcePath(id, signal);
    return exportDirectory(
      out,
      async (staging) => {
        await copyCancellable(path, join(staging, basename(path)), signal);
      },
      signal,
    );
  }
  async preview(id: string, out: string, signal?: AbortSignal) {
    const { row, path } = await this.sourcePath(id, signal);
    if (row.kind !== "photo")
      fail(
        "PREVIEW_UNSUPPORTED",
        "Takeout preview only supports still images.",
        "Use export for video and other formats.",
        2,
      );
    if (process.platform === "darwin") {
      const result = await exportDirectory(
        out,
        async (staging) => {
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
        },
        signal,
      );
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
    const result = await exportDirectory(
      out,
      async (staging) => {
        await copyCancellable(
          path,
          join(staging, safeName(row.filename)),
          signal,
        );
      },
      signal,
    );
    return {
      ...result,
      note: "Web-readable Takeout preview copied locally; dimensions are unchanged on this platform.",
    };
  }
}

async function copyCancellable(
  sourcePath: string,
  destinationPath: string,
  signal?: AbortSignal,
) {
  throwIfCancelled(signal);
  const source = await open(sourcePath, "r");
  let destination: Awaited<ReturnType<typeof open>> | undefined;
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let readOffset = 0;
  let writeOffset = 0;
  try {
    throwIfCancelled(signal);
    destination = await open(destinationPath, "wx", 0o600);
    while (true) {
      throwIfCancelled(signal);
      const { bytesRead } = await source.read(
        buffer,
        0,
        buffer.length,
        readOffset,
      );
      throwIfCancelled(signal);
      if (!bytesRead) break;
      let written = 0;
      while (written < bytesRead) {
        throwIfCancelled(signal);
        const result = await destination.write(
          buffer,
          written,
          bytesRead - written,
          writeOffset + written,
        );
        written += result.bytesWritten;
      }
      readOffset += bytesRead;
      writeOffset += bytesRead;
      await Bun.sleep(0);
    }
  } catch (error) {
    if (signal?.aborted) cancellationError();
    throw error;
  } finally {
    await destination?.close().catch(() => {});
    await source.close().catch(() => {});
  }
}
