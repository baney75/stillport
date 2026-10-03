import { Database } from "bun:sqlite";
import { dispatch } from "../src/dispatch";
import { test, expect } from "bun:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  stat,
  symlink,
  readdir,
  realpath,
  truncate,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Takeout } from "../src/providers/takeout";
import { McpServer } from "../src/mcp";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL7WQAAAABJRU5ErkJggg==",
  "base64",
);

test("Takeout import, native sidecars, dates, paging, get, private export and refresh through public behavior", async () => {
  const root = await mkdtemp(join(tmpdir(), "stillport-test-"));
  const previous = process.env.STILLPORT_HOME;
  process.env.STILLPORT_HOME = join(root, "state");
  const archive = join(root, "archive"),
    album = join(archive, "Summer");
  await mkdir(album, { recursive: true });
  await writeFile(join(album, "beach.jpg"), "synthetic image fixture");
  await writeFile(join(album, "second.jpg"), "second fixture");
  await writeFile(join(album, "café.jpg"), "unicode fixture");
  await writeFile(join(album, "Café.jpg"), "normalized unicode fixture");
  await writeFile(
    join(album, "beach.jpg.supplemental-metadata.json"),
    JSON.stringify({
      title: "beach.jpg",
      description: "Sand and salt",
      photoTakenTime: {
        timestamp: String(Date.parse("2026-07-04T15:00:00Z") / 1000),
      },
    }),
  );
  await writeFile(join(album, "bad.json"), "{broken");
  const outside = join(root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "hosts"), "outside archive");
  await symlink(
    outside,
    join(archive, "outside"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const takeout = await Takeout.open();
  try {
    const imported = await takeout.import(archive);
    // The macOS filesystem normalizes the two café spellings to one path.
    const unicodeItems = process.platform === "darwin" ? 1 : 2;
    expect(imported.indexed).toBe(2 + unicodeItems);
    expect(imported.ignoredSidecars).toBe(1);
    if (process.platform !== "win32")
      expect(
        (await stat(join(root, "state/takeout.sqlite"))).mode & 0o777,
      ).toBe(0o600);
    const found = takeout.search({
      query: "salt",
      limit: 1,
      after: "2026-07-01T00:00:00.000Z",
      before: "2026-08-01T00:00:00.000Z",
    });
    expect(found.items.length).toBe(1);
    expect(found.items[0]!.takenAt).toBe("2026-07-04T15:00:00.000Z");
    const first = takeout.search({ limit: 1 });
    expect(first.nextCursor).toBeTruthy();
    const pagedIds = new Set([first.items[0]!.id]);
    let nextCursor = first.nextCursor;
    while (nextCursor) {
      const page = takeout.search({ limit: 1, cursor: nextCursor });
      expect(pagedIds.has(page.items[0]!.id)).toBe(false);
      pagedIds.add(page.items[0]!.id);
      nextCursor = page.nextCursor;
    }
    expect(pagedIds.size).toBe(2 + unicodeItems);
    expect(() =>
      takeout.search({ query: "changed", limit: 1, cursor: first.nextCursor! }),
    ).toThrow("cursor");
    expect(takeout.search({ query: "' OR 1=1 --", limit: 10 }).items).toEqual(
      [],
    );
    for (const query of ["café", "CAFE\u0301", "CAFÉ"]) {
      expect(takeout.search({ query, limit: 10 }).items.length).toBe(
        unicodeItems,
      );
    }
    expect(takeout.albums(10).items.length).toBe(1);
    const id = found.items[0]!.id;
    expect(takeout.get(id).localPath).toBe(
      await realpath(join(album, "beach.jpg")),
    );
    const exported = await takeout.export(id, join(root, "output"));
    expect(await Bun.file(exported.files[0]!).text()).toBe(
      "synthetic image fixture",
    );
    if (process.platform !== "win32")
      expect((await stat(exported.files[0]!)).mode & 0o777).toBe(0o600);
    const again = await takeout.export(id, join(root, "output"));
    expect(again.directory).not.toBe(exported.directory);
    await rm(join(album, "beach.jpg"));
    await expect(takeout.export(id, join(root, "output"))).rejects.toThrow(
      "no longer on disk",
    );
    await symlink(join(outside, "hosts"), join(album, "beach.jpg"), "file");
    await expect(takeout.export(id, join(root, "output"))).rejects.toThrow(
      "outside",
    );
    await takeout.import(archive);
    expect(takeout.search({ limit: 10 }).items.length).toBe(1 + unicodeItems);
    expect((await readdir(join(root, "output"))).length).toBe(2);
  } finally {
    takeout.close();
    if (previous === undefined) delete process.env.STILLPORT_HOME;
    else process.env.STILLPORT_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("Takeout preview preserves originals and is explicit about platform limits", async () => {
  const root = await mkdtemp(join(tmpdir(), "stillport-preview-"));
  const previous = process.env.STILLPORT_HOME;
  process.env.STILLPORT_HOME = join(root, "state");
  const archive = join(root, "archive");
  await mkdir(archive);
  const original = join(archive, "still.png");
  await writeFile(original, png);
  const takeout = await Takeout.open();
  try {
    await takeout.import(archive);
    const id = takeout.search({ limit: 1 }).items[0]!.id;
    const before = await Bun.file(original).arrayBuffer();
    const result = await takeout.preview(id, join(root, "preview"));
    expect(result.files).toHaveLength(1);
    expect(await Bun.file(result.files[0]!).size).toBeGreaterThan(0);
    expect(await Bun.file(original).arrayBuffer()).toEqual(before);
    if (process.platform === "darwin" || process.platform === "win32") {
      expect(result.files[0]).toEndWith("-preview.jpg");
      expect(result.note).toContain("1600");
    } else expect(result.note).toContain("unchanged");
  } finally {
    takeout.close();
    if (previous === undefined) delete process.env.STILLPORT_HOME;
    else process.env.STILLPORT_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("Takeout cancellation preserves the index and MCP removes a partial export", async () => {
  const root = await mkdtemp(join(tmpdir(), "stillport-cancel-"));
  const previous = process.env.STILLPORT_HOME;
  process.env.STILLPORT_HOME = join(root, "state");
  const archive = join(root, "archive");
  const output = join(root, "output");
  await mkdir(archive);
  const original = join(archive, "large.jpg");
  await writeFile(original, "");
  await truncate(original, 512 * 1024 * 1024);
  const takeout = await Takeout.open();
  try {
    await takeout.import(archive);
    const id = takeout.search({ limit: 1 }).items[0]!.id;

    const importController = new AbortController();
    importController.abort();
    await expect(
      takeout.import(archive, importController.signal),
    ).rejects.toThrow("cancelled");
    expect(takeout.status()).toEqual({ items: 1, archives: 1 });
    takeout.close();

    const server = new McpServer();
    await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    const request = server.handle({
      jsonrpc: "2.0",
      id: "takeout-export",
      method: "tools/call",
      params: {
        name: "stillport_export",
        arguments: { id, source: "takeout", out: output },
      },
    });

    let sawStaging = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const names = await readdir(output).catch(() => []);
      if (names.some((name) => name.startsWith(".stillport-"))) {
        sawStaging = true;
        break;
      }
      await Bun.sleep(1);
    }
    expect(sawStaging).toBe(true);
    await server.handle({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: "takeout-export" },
    });
    const response = await request;
    const payload = JSON.parse(response.result.content[0].text);
    expect(payload.error.code).toBe("CANCELLED");
    expect(await readdir(output)).toEqual([]);
    expect((await stat(original)).size).toBe(512 * 1024 * 1024);
  } finally {
    try {
      takeout.close();
    } catch {}
    if (previous === undefined) delete process.env.STILLPORT_HOME;
    else process.env.STILLPORT_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("archive recovery removes stale index entries only and re-import restores retrieval", async () => {
  const root = await mkdtemp(join(tmpdir(), "stillport-recovery-"));
  const previous = process.env.STILLPORT_HOME;
  process.env.STILLPORT_HOME = join(root, "state");
  const old = join(root, "Original archive"),
    moved = join(root, "Moved café archive");
  await mkdir(old);
  await writeFile(join(old, "café.png"), png);
  const t = await Takeout.open();
  try {
    await t.import(old);
    const originalId = t.search({ limit: 10 }).items[0]!.id;
    const archiveId = (await t.archives(10)).items[0]!.id;
    await rename(old, moved);
    expect((await t.archives(10)).items[0]!.folderExists).toBe(false);
    await symlink(
      moved,
      old,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect((await t.archives(10)).items[0]!.folderExists).toBe(false);
    await t.import(moved);
    expect(t.search({ query: "CAFÉ", limit: 10 }).items).toHaveLength(2);
    const forgotten = t.forget(archiveId);
    expect(forgotten).toMatchObject({ removed: 1, filesDeleted: false });
    expect(() => t.get(originalId)).toThrow("not in the Takeout index");
    expect(await Bun.file(join(moved, "café.png")).bytes()).toEqual(
      new Uint8Array(png),
    );
    expect(t.search({ limit: 10 }).items).toHaveLength(1);
    expect(() => t.forget(archiveId)).toThrow("not in the Takeout index");
    const current = (await t.archives(10)).items[0]!;
    t.forget(current.id);
    expect(t.status()).toMatchObject({ items: 0 });
    await t.import(moved);
    expect(t.search({ query: "CAFE\u0301", limit: 10 }).items).toHaveLength(1);
  } finally {
    t.close();
    if (previous === undefined) delete process.env.STILLPORT_HOME;
    else process.env.STILLPORT_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy indexes gain Unicode search without losing opaque IDs or rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "stillport-migration-"));
  const previous = process.env.STILLPORT_HOME;
  process.env.STILLPORT_HOME = root;
  const db = new Database(join(root, "takeout.sqlite"), { create: true });
  db.exec(
    "CREATE TABLE media (id TEXT PRIMARY KEY, root TEXT NOT NULL, path TEXT NOT NULL, filename TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, takenAt TEXT, kind TEXT NOT NULL, album TEXT NOT NULL)",
  );
  db.query("INSERT INTO media VALUES (?,?,?,?,?,?,?,?,?)").run(
    "old-id",
    root,
    join(root, "café.jpg"),
    "cafe\u0301.jpg",
    "CAFÉ",
    "été",
    null,
    "photo",
    "Summer",
  );
  db.close();
  try {
    const t = await Takeout.open();
    try {
      expect(
        t.search({ query: "CAFÉ", limit: 10 }).items.map((x) => x.id),
      ).toEqual(["old-id"]);
      expect(t.search({ query: "ÉTÉ", limit: 10 }).items).toHaveLength(1);
      expect(t.status()).toMatchObject({ items: 1 });
    } finally {
      t.close();
    }
    const reopened = await Takeout.open();
    try {
      expect(reopened.get("old-id").id).toBe("old-id");
    } finally {
      reopened.close();
    }
  } finally {
    if (previous === undefined) delete process.env.STILLPORT_HOME;
    else process.env.STILLPORT_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("MCP list filters and gallery use real indexed media and expose safe recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "stillport-mcp-gallery-"));
  const previous = process.env.STILLPORT_HOME;
  process.env.STILLPORT_HOME = join(root, "state");
  const archive = join(root, "archive"),
    album = join(archive, "Summer");
  await mkdir(album, { recursive: true });
  await writeFile(join(album, "café.png"), png);
  await writeFile(
    join(album, "café.png.supplemental-metadata.json"),
    JSON.stringify({
      title: "café.png",
      description: "Summer café",
      photoTakenTime: { timestamp: "1783177200" },
    }),
  );
  try {
    await dispatch("takeout import", archive, {});
    const server = new McpServer();
    const call = (method: string, params: unknown = {}) =>
      server.handle({ jsonrpc: "2.0", id: 1, method, params });
    await call("initialize");
    const tools = (await call("tools/list")).result.tools;
    expect(
      tools.find((t: any) => t.name === "stillport_takeout_forget").annotations
        .destructiveHint,
    ).toBe(true);
    const invoke = async (name: string, args: unknown) =>
      JSON.parse(
        (await call("tools/call", { name, arguments: args })).result.content[0]
          .text,
      );
    const list = await invoke("stillport_list", {
      source: "takeout",
      after: "2026-07-01",
      before: "2026-08-01",
      album: "Summer",
      favorite: false,
    });
    expect(list.ok).toBe(true);
    expect(list.data.items).toHaveLength(1);
    const excluded = await invoke("stillport_list", {
      source: "takeout",
      before: "2026-07-01",
    });
    expect(excluded.data.items).toEqual([]);
    const gallery = await invoke("stillport_gallery", {
      source: "takeout",
      query: "CAFÉ",
      out: join(root, "gallery"),
    });
    expect(gallery.ok).toBe(true);
    expect(gallery.data.itemCount).toBe(1);
    expect(gallery.data.previewCount).toBe(1);
    expect(await Bun.file(gallery.data.indexHtml).text()).toContain(
      "Summer café",
    );
    const archives = await invoke("stillport_takeout_archives", {});
    expect(archives.data.items[0].folderExists).toBe(true);
    const forgotten = await invoke("stillport_takeout_forget", {
      archive: archives.data.items[0].id,
    });
    expect(forgotten.data.filesDeleted).toBe(false);
    expect(await Bun.file(join(album, "café.png")).bytes()).toEqual(
      new Uint8Array(png),
    );
  } finally {
    if (previous === undefined) delete process.env.STILLPORT_HOME;
    else process.env.STILLPORT_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});
