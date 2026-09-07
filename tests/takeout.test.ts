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
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Takeout } from "../src/providers/takeout";

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
  await symlink("/etc", join(archive, "outside"));
  const takeout = await Takeout.open();
  try {
    const imported = await takeout.import(archive);
    // The macOS filesystem normalizes the two café spellings to one path.
    const unicodeItems = process.platform === "darwin" ? 1 : 2;
    expect(imported.indexed).toBe(2 + unicodeItems);
    expect(imported.ignoredSidecars).toBe(1);
    expect((await stat(join(root, "state/takeout.sqlite"))).mode & 0o777).toBe(
      0o600,
    );
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
    const second = takeout.search({ limit: 1, cursor: first.nextCursor! });
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    expect(second.nextCursor).toBeTruthy();
    expect(
      takeout.search({ limit: 1, cursor: second.nextCursor! }).nextCursor,
    ).toBeNull();
    expect(() =>
      takeout.search({ query: "changed", limit: 1, cursor: first.nextCursor! }),
    ).toThrow("cursor");
    expect(takeout.search({ query: "' OR 1=1 --", limit: 10 }).items).toEqual(
      [],
    );
    expect(takeout.search({ query: "café", limit: 10 }).items.length).toBe(1);
    expect(takeout.albums(10).items.length).toBe(1);
    const id = found.items[0]!.id;
    expect(takeout.get(id).localPath).toBe(
      await realpath(join(album, "beach.jpg")),
    );
    const exported = await takeout.export(id, join(root, "output"));
    expect(await Bun.file(exported.files[0]!).text()).toBe(
      "synthetic image fixture",
    );
    expect((await stat(exported.files[0]!)).mode & 0o777).toBe(0o600);
    const again = await takeout.export(id, join(root, "output"));
    expect(again.directory).not.toBe(exported.directory);
    await rm(join(album, "beach.jpg"));
    await expect(takeout.export(id, join(root, "output"))).rejects.toThrow(
      "no longer on disk",
    );
    await symlink("/etc/hosts", join(album, "beach.jpg"));
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
    if (process.platform === "darwin") {
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
