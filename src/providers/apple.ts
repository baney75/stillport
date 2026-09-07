import script from "./apple.jxa" with { type: "text" };
import {
  cursorFor,
  cursorOffset,
  exportDirectory,
  fail,
  mediaKind,
  runProcess,
  safeName,
  type Media,
  type SearchOptions,
} from "../core";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

type PreviewRunner = (
  cmd: string[],
  timeoutMs?: number,
  signal?: AbortSignal,
) => Promise<{
  stdout: string;
  stderr: string;
  code: number;
}>;

export function collisionKey(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

export function previewName(name: string, unavailable: Set<string>): string {
  const stem = safeName(name.replace(/\.[^.]+$/, ""));
  let index = 1;
  let candidate = `${stem}-preview.jpg`;
  while (unavailable.has(collisionKey(candidate))) {
    index += 1;
    candidate = `${stem}-preview-${index}.jpg`;
  }
  unavailable.add(collisionKey(candidate));
  return candidate;
}

/** Converts rendered Apple exports into JPEGs suitable for image-reading tools. */
export async function makeJpegPreviews(
  staging: string,
  runner: PreviewRunner = runProcess,
  signal?: AbortSignal,
): Promise<void> {
  const names = await readdir(staging);
  const unavailable = new Set(names.map(collisionKey));
  for (const name of names) {
    if (mediaKind(name) !== "photo")
      fail(
        "PREVIEW_UNSUPPORTED",
        "This item did not export as a still image.",
        "Use export for video and other formats.",
      );
    const source = join(staging, name);
    const destination = join(staging, previewName(name, unavailable));
    const result = await runner(
      [
        "/usr/bin/sips",
        "-s",
        "format",
        "jpeg",
        "-Z",
        "1600",
        source,
        "--out",
        destination,
      ],
      60_000,
      signal,
    );
    if (result.code)
      fail(
        "PREVIEW_FAILED",
        "macOS could not make a JPEG preview from this image.",
        "Use export instead.",
      );
    await rm(source);
  }
}

export async function appleCall(
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<any> {
  if (process.platform !== "darwin")
    fail(
      "PLATFORM_UNSUPPORTED",
      "Apple Photos requires macOS.",
      "Use Google Picker or a Takeout archive on this platform.",
      3,
    );
  const result = await runProcess(
    [
      "/usr/bin/osascript",
      "-l",
      "JavaScript",
      "-e",
      script,
      JSON.stringify(input),
    ],
    input.action === "export" ? 180_000 : 60_000,
    signal,
  );
  if (result.code !== 0) {
    if (/1743|not authorized|not permitted/i.test(result.stderr))
      fail(
        "APPLE_PERMISSION_REQUIRED",
        "macOS has not allowed Photos automation.",
        "Allow your terminal or agent host under System Settings > Privacy & Security > Automation > Photos, then retry.",
        3,
      );
    fail(
      "APPLE_UNAVAILABLE",
      "Photos could not complete the request.",
      "Open Photos, dismiss any dialogs, and confirm the correct library is open. Native search requires a Photos version with the search scripting command.",
      3,
    );
  }
  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch {
    return fail(
      "APPLE_RESPONSE_INVALID",
      "Photos returned an unreadable response.",
    );
  }
  if (response.error)
    fail(
      response.error,
      "The requested item or album is not in the open Photos library.",
      "List items or albums again to obtain a current ID.",
      4,
    );
  return response;
}
function normalize(row: any): Media {
  return { ...row, kind: mediaKind(row.filename) };
}
export async function appleSearch(
  options: SearchOptions,
  selection = false,
  signal?: AbortSignal,
) {
  const { cursor, ...query } = options;
  const scope = { source: "apple", selection, ...query };
  const offset = cursorOffset(cursor, scope);
  const result = await appleCall(
    {
      action: selection ? "selection" : "search",
      ...query,
      offset,
    },
    signal,
  );
  return {
    items: result.items.map(normalize),
    nextCursor: result.hasMore
      ? cursorFor(offset + options.limit, scope)
      : null,
    searchEngine: "apple-photos-native",
    order: "provider",
    note: "Results depend on the open library and Apple indexing. The library may change between pages.",
  };
}
export async function appleAlbums(
  limit: number,
  cursor?: string,
  signal?: AbortSignal,
) {
  const scope = { source: "apple", command: "albums", limit };
  const offset = cursorOffset(cursor, scope);
  const result = await appleCall({ action: "albums", offset, limit }, signal);
  return {
    ...result,
    nextCursor:
      offset + limit < result.total ? cursorFor(offset + limit, scope) : null,
  };
}
export async function appleGet(id: string, signal?: AbortSignal) {
  return normalize(await appleCall({ action: "get", id }, signal));
}
export async function appleExport(
  id: string,
  out: string,
  original = false,
  preview = false,
  signal?: AbortSignal,
) {
  const result = await exportDirectory(out, async (staging) => {
    await appleCall({ action: "export", id, out: staging, original }, signal);
    if (preview) await makeJpegPreviews(staging, runProcess, signal);
  });
  return preview
    ? { ...result, note: "JPEG preview, maximum 1600 pixels per dimension." }
    : result;
}
