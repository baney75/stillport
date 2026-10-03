import { lstat, open, realpath, rm, writeFile } from "node:fs/promises";
import { copyPreview } from "./files";
import { createHash } from "node:crypto";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { exportDirectory, fail, throwIfCancelled, type Media } from "./core";

type Preview = (
  item: Media,
  out: string,
  signal?: AbortSignal,
) => Promise<{
  directory: string;
  files: string[];
  note?: string;
}>;

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );

const isWithin = (parent: string, child: string) => {
  const path = relative(parent, child);
  return (
    path !== "" &&
    path !== ".." &&
    !path.startsWith(`..${sep}`) &&
    !isAbsolute(path)
  );
};

// Preview providers may return several files. Copy only a validated still image;
// never trust a filename or mime type as evidence that the bytes are an image.
async function stillFormat(
  path: string,
): Promise<"jpg" | "png" | "gif" | "webp" | "avif" | null> {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (stat.size < 12) return null;
    const head = Buffer.alloc(64);
    await file.read(head, 0, Math.min(head.length, stat.size), 0);
    if (
      head
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      head.toString("ascii", 12, 16) === "IHDR"
    )
      return "png";
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
      const tail = Buffer.alloc(2);
      await file.read(tail, 0, 2, stat.size - 2);
      if (tail[0] === 0xff && tail[1] === 0xd9) return "jpg";
    }
    if (
      (head.toString("ascii", 0, 6) === "GIF87a" ||
        head.toString("ascii", 0, 6) === "GIF89a") &&
      head.readUInt16LE(6) > 0 &&
      head.readUInt16LE(8) > 0
    )
      return "gif";
    if (
      head.toString("ascii", 0, 4) === "RIFF" &&
      head.toString("ascii", 8, 12) === "WEBP"
    ) {
      const subtype = head.toString("ascii", 12, 16);
      if (
        subtype === "VP8 " ||
        subtype === "VP8L" ||
        (subtype === "VP8X" && !(head[20]! & 0x02))
      )
        return "webp";
    }
    if (
      head.toString("ascii", 4, 8) === "ftyp" &&
      head.toString("ascii", 8, 12) === "avif"
    )
      return "avif";
    return null;
  } finally {
    await file.close();
  }
}

const style = `:root{color-scheme:light;--ink:#173e38;--paper:#f7f2e8;--sage:#b9cba5;--coral:#ee8963;--line:#d9ded0}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.skip{position:absolute;top:-100px;left:1rem;background:#fff;padding:.7rem}.skip:focus{top:1rem}a{color:inherit}a:focus-visible,input:focus-visible{outline:3px solid var(--coral);outline-offset:3px}.top{background:var(--ink);color:var(--paper);padding:clamp(2rem,6vw,5rem) max(1.2rem,calc((100vw - 1240px)/2))}.brand{font:700 .8rem/1.2 ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--sage)}h1{font:400 clamp(2.7rem,7vw,5.3rem)/1.03 Georgia,serif;letter-spacing:-.045em;margin:1.2rem 0 .9rem}.intro{max-width:36rem;color:#dce7da;margin:0}.toolbar{max-width:1240px;margin:0 auto;padding:1.6rem 1.2rem;display:flex;align-items:end;justify-content:space-between;gap:1rem;flex-wrap:wrap}.search{display:grid;gap:.4rem;font-size:.85rem;font-weight:700}.search input{width:min(25rem,calc(100vw - 2.4rem));padding:.8rem .9rem;border:1px solid #9fac9d;border-radius:.6rem;background:#fff;color:var(--ink);font:inherit}#count{margin:0;font-size:.9rem}.grid{max-width:1240px;margin:auto;padding:0 1.2rem 4rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:1.25rem}.card{overflow:hidden;background:#fff;border:1px solid var(--line);border-radius:1rem;box-shadow:0 8px 24px #173e380c}.visual{aspect-ratio:4/3;background:#e4eadc;display:grid;place-items:center;overflow:hidden}.visual a{display:block;width:100%;height:100%}.visual img{display:block;width:100%;height:100%;object-fit:contain}.placeholder{padding:1rem;text-align:center;color:#456058;font-size:.85rem}.body{padding:1rem 1.1rem 1.2rem}.kind{font:700 .68rem/1.2 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#596f62}h2{font:400 1.45rem/1.2 Georgia,serif;margin:.5rem 0 .7rem;overflow-wrap:anywhere}.meta,.caption,.id{overflow-wrap:anywhere}.meta{color:#53655b;font-size:.84rem}.caption{margin:.8rem 0 0}.id{margin:.9rem 0 0;color:#66766a;font: .72rem/1.4 ui-monospace,monospace}#empty{max-width:1240px;margin:0 auto;padding:2rem 1.2rem}[hidden]{display:none!important}@media(max-width:600px){.top{padding:2.5rem 1.2rem}.toolbar{align-items:stretch}.search input{width:100%}.grid{gap:.9rem}}`;

const script = `const filter=document.getElementById('filter');const cards=[...document.querySelectorAll('.card')];const count=document.getElementById('count');const empty=document.getElementById('empty');function update(){const q=filter.value.trim().normalize('NFC').toLocaleLowerCase();let shown=0;for(const card of cards){const match=card.textContent.normalize('NFC').toLocaleLowerCase().includes(q);card.hidden=!match;if(match)shown++}count.textContent=shown+' of '+cards.length+' items';empty.hidden=shown!==0}filter.addEventListener('input',update);update();`;
const hash = (input: string) =>
  createHash("sha256").update(input).digest("base64");

function page(cards: string[]) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; style-src 'sha256-${hash(style)}'; script-src 'sha256-${hash(script)}'; base-uri 'none'; object-src 'none'; form-action 'none'"><title>Stillport gallery</title><style>${style}</style></head><body><a class="skip" href="#gallery">Skip to photos</a><header class="top"><div class="brand">Stillport / Gallery</div><h1>Photos, within reach.</h1><p class="intro">A private, offline contact sheet for this result page. Open a card image to view its local preview.</p></header><main id="gallery"><div class="toolbar"><label class="search" for="filter">Filter these results<input id="filter" type="search" autocomplete="off" placeholder="Search title, filename, date, caption or ID"></label><p id="count" role="status" aria-live="polite">${cards.length} of ${cards.length} items</p></div><div class="grid">${cards.join("")}</div><p id="empty" hidden>No matching items in this gallery.</p></main><script>${script}</script></body></html>`;
}

export async function createGallery(
  items: Media[],
  out: string,
  preview: Preview,
  signal?: AbortSignal,
) {
  if (items.length > 100)
    fail("GALLERY_LIMIT", "A gallery can contain at most 100 items.");
  const warnings: string[] = [];
  let previewCount = 0;
  let galleryBytes = 0;
  const maxImage = 20 * 1024 * 1024,
    maxGallery = 200 * 1024 * 1024;
  const result = await exportDirectory(
    out,
    async (staging) => {
      const cards: string[] = [];
      for (const [index, item] of items.entries()) {
        throwIfCancelled(signal);
        let asset: string | undefined;
        let placeholder =
          item.kind === "video"
            ? "Video preview unavailable"
            : "Preview unavailable";
        if (item.kind === "photo" && galleryBytes < maxGallery) {
          const requested = join(staging, `.preview-${index}`);
          try {
            const exported = await preview(item, requested, signal);
            throwIfCancelled(signal);
            const stagingReal = await realpath(staging);
            if (dirname(resolve(exported.directory)) !== resolve(requested))
              fail(
                "GALLERY_PREVIEW_PATH",
                "Preview output escaped its staging folder.",
              );
            if (!(await lstat(requested)).isDirectory())
              fail(
                "GALLERY_PREVIEW_PATH",
                "Preview output escaped its staging folder.",
              );
            const requestedReal = await realpath(requested);
            const folder = resolve(exported.directory);
            if (
              !isWithin(stagingReal, requestedReal) ||
              dirname(folder) !== resolve(requested) ||
              !(await lstat(folder)).isDirectory() ||
              !isWithin(requestedReal, await realpath(folder))
            )
              fail(
                "GALLERY_PREVIEW_PATH",
                "Preview output escaped its staging folder.",
              );
            for (const candidate of exported.files) {
              const path = resolve(candidate);
              if (dirname(path) !== folder)
                fail(
                  "GALLERY_PREVIEW_PATH",
                  "Preview output escaped its staging folder.",
                );
              const fileStat = await lstat(path);
              if (
                !fileStat.isFile() ||
                dirname(await realpath(path)) !== (await realpath(folder))
              )
                fail(
                  "GALLERY_PREVIEW_PATH",
                  "Preview output contains a link or non-file.",
                );
              if (
                fileStat.size > Math.min(maxImage, maxGallery - galleryBytes)
              ) {
                warnings.push(`${item.id}: PREVIEW_TOO_LARGE`);
                continue;
              }
              const format = await stillFormat(path);
              if (!format) continue;
              asset = `preview-${String(index + 1).padStart(3, "0")}.${format}`;
              galleryBytes += await copyPreview(
                path,
                join(staging, asset),
                Math.min(maxImage, maxGallery - galleryBytes),
                signal,
              );
              previewCount++;
              break;
            }
            if (!asset) warnings.push(`${item.id}: no supported still preview`);
          } catch (error) {
            throwIfCancelled(signal);
            if (
              error &&
              typeof error === "object" &&
              "code" in error &&
              (String(error.code).startsWith("PREVIEW_") ||
                error.code === "FILE_MISSING")
            ) {
              warnings.push(`${item.id}: ${String(error.code)}`);
            } else throw error;
          } finally {
            await rm(requested, { recursive: true, force: true });
          }
        }
        if (item.kind === "photo" && galleryBytes >= maxGallery && !asset)
          warnings.push(`${item.id}: GALLERY_BYTE_LIMIT`);
        const filename = basename(item.filename.replaceAll("\\", "/"));
        const title = item.title || filename || "Untitled item";
        const visual = asset
          ? `<a href="${asset}" aria-label="Open preview of ${escapeHtml(title)}"><img src="${asset}" alt="Preview of ${escapeHtml(title)}" loading="lazy"></a>`
          : `<span class="placeholder">${placeholder}</span>`;
        cards.push(
          `<article class="card"><div class="visual">${visual}</div><div class="body"><span class="kind">${escapeHtml(item.kind)}</span><h2>${escapeHtml(title)}</h2><div class="meta">${escapeHtml(filename)}${item.takenAt ? ` · ${escapeHtml(item.takenAt)}` : ""}</div>${item.description ? `<p class="caption">${escapeHtml(item.description)}</p>` : ""}<p class="id">${escapeHtml(item.id)}</p></div></article>`,
        );
      }
      await writeFile(join(staging, "index.html"), page(cards), {
        mode: 0o600,
      });
    },
    signal,
  );
  return {
    ...result,
    indexHtml: join(result.directory, "index.html"),
    itemCount: items.length,
    previewCount,
    warnings,
  };
}
