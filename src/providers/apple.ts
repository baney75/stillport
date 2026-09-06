import script from "./apple.jxa" with { type: "text" };
import {
  cursorFor,
  cursorOffset,
  exportDirectory,
  fail,
  mediaKind,
  runProcess,
  type Media,
  type SearchOptions,
} from "../core";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
export async function appleCall(input: Record<string, unknown>): Promise<any> {
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
export async function appleSearch(options: SearchOptions, selection = false) {
  const { cursor, ...query } = options;
  const scope = { source: "apple", selection, ...query };
  const offset = cursorOffset(cursor, scope);
  const result = await appleCall({
    action: selection ? "selection" : "search",
    ...query,
    offset,
  });
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
export async function appleAlbums(limit: number, cursor?: string) {
  const scope = { source: "apple", command: "albums", limit };
  const offset = cursorOffset(cursor, scope);
  const result = await appleCall({ action: "albums", offset, limit });
  return {
    ...result,
    nextCursor:
      offset + limit < result.total ? cursorFor(offset + limit, scope) : null,
  };
}
export async function appleGet(id: string) {
  return normalize(await appleCall({ action: "get", id }));
}
export async function appleExport(
  id: string,
  out: string,
  original = false,
  preview = false,
) {
  return exportDirectory(out, async (staging) => {
    await appleCall({ action: "export", id, out: staging, original });
    if (preview) {
      for (const name of await readdir(staging)) {
        if (mediaKind(name) !== "photo")
          fail(
            "PREVIEW_UNSUPPORTED",
            "This item did not export as a still image.",
            "Use export for video and other formats.",
          );
        const result = await runProcess([
          "/usr/bin/sips",
          "-Z",
          "1600",
          join(staging, name),
        ]);
        if (result.code)
          fail(
            "PREVIEW_FAILED",
            "macOS could not resize this image.",
            "Use export instead.",
          );
      }
    }
  });
}
