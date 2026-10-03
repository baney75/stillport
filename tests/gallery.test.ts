import { expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  truncate,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createGallery } from "../src/gallery";
import { PortError, type Media } from "../src/core";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL7WQAAAABJRU5ErkJggg==",
  "base64",
);
const jpg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFwAAAwEAAAAAAAAAAAAAAAAAAAQFBv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAbQAH//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8Af//Z",
  "base64",
);
const media = (id: string, extra: Partial<Media> = {}): Media => ({
  id,
  source: "takeout",
  filename: `${id}.png`,
  kind: "photo",
  ...extra,
});

async function fixture(callback: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "stillport-gallery-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("self-contained gallery copies supported stills, escapes metadata, and hides source paths", async () =>
  fixture(async (root) => {
    const source = join(root, "café image.png");
    await writeFile(source, png);
    const items = [
      media("opaque'1", {
        filename: "C:\\Family\\café photo.png",
        title: `<img src=x onerror=alert(1)>`,
        description: `Sand & sea </script><script>alert(1)</script>`,
        localPath: source,
        takenAt: "2026-07-04",
      }),
    ];
    const result = await createGallery(
      items,
      join(root, "out"),
      async (_item, out) => {
        const directory = join(out, "provider export");
        await mkdir(directory, { recursive: true });
        const file = join(directory, "café image.png");
        await writeFile(file, await readFile(source));
        return { directory, files: [file] };
      },
    );
    expect(result.itemCount).toBe(1);
    expect(result.previewCount).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(await readFile(join(result.directory, "preview-001.png"))).toEqual(
      png,
    );
    expect((await readdir(result.directory)).sort()).toEqual([
      "index.html",
      "preview-001.png",
    ]);
    if (process.platform !== "win32")
      expect((await stat(result.indexHtml)).mode & 0o777).toBe(0o600);
    const html = await readFile(result.indexHtml, "utf8");
    expect(html).toContain("café photo.png");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;/script&gt;");
    expect(html).toContain("opaque&#39;1");
    expect(html).not.toContain(source);
    expect(html).not.toContain("C:\\Family");
    expect(html).not.toMatch(/<(?:link|iframe)\b/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).toContain("Filter these results");
    expect(html).toContain("script-src 'sha256-");
    expect(html).toContain("img-src 'self' file:");
    expect(await readFile(source)).toEqual(png);
  }));

test("video and unsupported images remain visible with clear placeholders", async () =>
  fixture(async (root) => {
    let calls = 0;
    const result = await createGallery(
      [
        media("video", { kind: "video", filename: "clip.mp4" }),
        media("raw", { filename: "scan.dng" }),
        media("missing"),
      ],
      join(root, "out"),
      async (item, out) => {
        calls++;
        if (item.id === "missing")
          throw new PortError("FILE_MISSING", "Missing original");
        const directory = join(out, "export");
        await mkdir(directory, { recursive: true });
        const file = join(directory, "preview.svg");
        await writeFile(file, `<svg onload="alert(1)"></svg>`);
        return { directory, files: [file] };
      },
    );
    const html = await readFile(result.indexHtml, "utf8");
    expect(calls).toBe(2);
    expect(result.previewCount).toBe(0);
    expect(result.warnings).toEqual([
      "raw: no supported still preview",
      "missing: FILE_MISSING",
    ]);
    expect(html).toContain("Video preview unavailable");
    expect(html).toContain("Preview unavailable");
    expect(html).not.toContain("onload=");
    expect(await readdir(result.directory)).toEqual(["index.html"]);
  }));

test("cancellation removes staging and publishes nothing", async () =>
  fixture(async (root) => {
    const controller = new AbortController();
    const out = join(root, "out");
    await expect(
      createGallery(
        [media("one")],
        out,
        async (_item, folder) => {
          const directory = join(folder, "export");
          await mkdir(directory, { recursive: true });
          const file = join(directory, "one.jpg");
          await writeFile(file, jpg);
          controller.abort();
          return { directory, files: [file] };
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await readdir(out)).toEqual([]);
  }));

test("escaped and linked callback outputs are rejected without removing outside files", async () =>
  fixture(async (root) => {
    const outside = join(root, "outside");
    await mkdir(outside);
    const file = join(outside, "photo.png");
    await writeFile(file, png);
    const out = join(root, "out");
    await expect(
      createGallery([media("one")], out, async () => ({
        directory: outside,
        files: [file],
      })),
    ).rejects.toMatchObject({ code: "GALLERY_PREVIEW_PATH" });
    expect(await readFile(file)).toEqual(png);
    expect(await readdir(out)).toEqual([]);
    await expect(
      createGallery([media("one")], out, async (_item, folder) => {
        const directory = join(folder, "export");
        await mkdir(directory, { recursive: true });
        const linked = join(directory, "linked.png");
        await symlink(file, linked);
        return { directory, files: [linked] };
      }),
    ).rejects.toMatchObject({ code: "GALLERY_PREVIEW_PATH" });
    expect(await readFile(file)).toEqual(png);
    expect(await readdir(out)).toEqual([]);
  }));

test("empty pages export an index; more than 100 results are rejected before export", async () =>
  fixture(async (root) => {
    const out = join(root, "out");
    const empty = await createGallery([], out, async () => {
      throw Error("should not run");
    });
    expect(empty.itemCount).toBe(0);
    expect(empty.previewCount).toBe(0);
    expect(await readFile(empty.indexHtml, "utf8")).toContain("0 of");
    await expect(
      createGallery(
        Array.from({ length: 101 }, (_, i) => media(String(i))),
        out,
        async () => {
          throw Error("should not run");
        },
      ),
    ).rejects.toMatchObject({ code: "GALLERY_LIMIT" });
    expect(await readdir(out)).toEqual([basename(empty.directory)]);
  }));

test("oversized stills become placeholders; copying can be cancelled without publication", async () =>
  fixture(async (root) => {
    const out = join(root, "out");
    const result = await createGallery(
      [media("large")],
      out,
      async (_item, folder) => {
        const directory = join(folder, "export");
        await mkdir(directory, { recursive: true });
        const file = join(directory, "large.png");
        await writeFile(file, png);
        await truncate(file, 21 * 1024 * 1024);
        return { directory, files: [file] };
      },
    );
    expect(result.previewCount).toBe(0);
    expect(result.warnings).toContain("large: PREVIEW_TOO_LARGE");
    expect(await readdir(result.directory)).toEqual(["index.html"]);
    await rm(result.directory, { recursive: true });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(
        createGallery(
          [media("cancel")],
          out,
          async (_item, folder) => {
            const directory = join(folder, "export");
            await mkdir(directory, { recursive: true });
            const file = join(directory, "large.png");
            await writeFile(file, png);
            await truncate(file, 20 * 1024 * 1024);
            timer = setTimeout(() => controller.abort(), 5);
            return { directory, files: [file] };
          },
          controller.signal,
        ),
      ).rejects.toMatchObject({ code: "CANCELLED" });
      expect(await readdir(out)).toEqual([]);
    } finally {
      clearTimeout(timer);
    }
  }));
