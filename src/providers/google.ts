import { accessToken } from "../auth";
import { exportDirectory, fail, safeName, type Media } from "../core";
import { requestJson, type Fetcher } from "../http";
import { open } from "node:fs/promises";
import { join } from "node:path";
const BASE = "https://photospicker.googleapis.com/v1";
export interface Session {
  id: string;
  pickerUri: string;
  mediaItemsSet?: boolean;
  expireTime?: string;
  pollingConfig?: { pollInterval: string; timeoutIn: string };
}
export interface PickedItem {
  id: string;
  createTime?: string;
  type: string;
  mediaFile: {
    filename: string;
    mimeType: string;
    baseUrl: string;
    mediaFileMetadata?: {
      width?: number;
      height?: number;
      videoMetadata?: { processingStatus?: string };
    };
  };
}
export function googleMedia(item: PickedItem): Media {
  return {
    id: item.id,
    source: "google",
    filename: item.mediaFile.filename,
    takenAt: item.createTime,
    kind:
      item.type === "VIDEO"
        ? "video"
        : item.type === "PHOTO"
          ? "photo"
          : "unknown",
    mimeType: item.mediaFile.mimeType,
    width: item.mediaFile.mediaFileMetadata?.width,
    height: item.mediaFile.mediaFileMetadata?.height,
  };
}
export function mediaUrl(base: string, suffix: string) {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return fail("UNTRUSTED_MEDIA_URL", "Google returned an invalid media URL.");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".googleusercontent.com") ||
    url.username ||
    url.password ||
    url.port
  )
    fail(
      "UNTRUSTED_MEDIA_URL",
      "The media URL is outside Google’s media service.",
    );
  return url.href + suffix;
}
export class GooglePhotos {
  constructor(
    private token: () => Promise<string> = () => accessToken(),
    private fetcher: Fetcher = fetch,
  ) {}
  private async api<T>(path: string, init: RequestInit = {}) {
    return requestJson<T>(
      BASE + path,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${await this.token()}`,
          "Content-Type": "application/json",
        },
      },
      this.fetcher,
    );
  }
  async start(maxItems = 100): Promise<Session> {
    return this.api("/sessions", {
      method: "POST",
      body: JSON.stringify({
        pickingConfig: { maxItemCount: String(maxItems) },
      }),
    });
  }
  async session(id: string): Promise<Session> {
    return this.api(`/sessions/${encodeURIComponent(id)}`);
  }
  async close(id: string) {
    await this.api(`/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    return { closed: true, session: id };
  }
  async rawItems(
    session: string,
    limit: number,
    cursor?: string,
  ): Promise<{ mediaItems?: PickedItem[]; nextPageToken?: string }> {
    const params = new URLSearchParams({
      sessionId: session,
      pageSize: String(limit),
    });
    if (cursor) params.set("pageToken", cursor);
    return this.api(`/mediaItems?${params}`);
  }
  async items(session: string, limit: number, cursor?: string) {
    const result = await this.rawItems(session, limit, cursor);
    return {
      items: (result.mediaItems || []).map(googleMedia),
      nextCursor: result.nextPageToken || null,
      searchEngine: "google-photos-picker",
      scope: "user-selected-items",
      session,
    };
  }
  async find(session: string, id: string): Promise<PickedItem> {
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const result = await this.rawItems(session, 100, cursor);
      const item = result.mediaItems?.find((item) => item.id === id);
      if (item) return item;
      cursor = result.nextPageToken;
      if (cursor && seen.has(cursor))
        fail(
          "INVALID_RESPONSE",
          "Google returned a repeated pagination token.",
        );
      if (cursor) seen.add(cursor);
    } while (cursor);
    return fail(
      "NOT_FOUND",
      "This item is not in the selected Picker session.",
      "List the session’s items or start a new selection.",
      4,
    );
  }
  async download(session: string, id: string, out: string, preview = false) {
    const item = await this.find(session, id);
    const video = item.type === "VIDEO";
    const status =
      item.mediaFile.mediaFileMetadata?.videoMetadata?.processingStatus;
    if (video && !preview && status !== "READY")
      fail(
        "MEDIA_PROCESSING",
        "Google has not marked this video ready to download.",
        "Try preview, or retry after Google finishes processing.",
        5,
      );
    const url = mediaUrl(
      item.mediaFile.baseUrl,
      preview ? "=w1600-h1600" : video ? "=dv" : "=d",
    );
    const token = await this.token();
    const result = await exportDirectory(out, async (staging) => {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          headers: { Authorization: `Bearer ${token}` },
          redirect: "error",
          signal: AbortSignal.timeout(180_000),
        });
      } catch {
        return fail(
          "DOWNLOAD_FAILED",
          "The media download could not be started.",
          "Check your connection and retry.",
          5,
        );
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        fail(
          "DOWNLOAD_FAILED",
          `Google returned HTTP ${response.status} for the media.`,
          "Refresh the Picker session or select the item again.",
          5,
        );
      }
      const max = 1024 * 1024 * 1024;
      if (Number(response.headers.get("content-length")) > max) {
        await response.body.cancel();
        fail("FILE_TOO_LARGE", "Downloads are limited to 1 GiB per item.");
      }
      const type = response.headers.get("content-type")?.split(";")[0] || "";
      if (!/^(image\/|video\/|application\/octet-stream)/.test(type)) {
        await response.body.cancel();
        fail("DOWNLOAD_INVALID", "The provider returned a non-media response.");
      }
      const extension =
        type === "image/png"
          ? ".png"
          : type === "image/webp"
            ? ".webp"
            : ".jpg";
      const name = preview
        ? safeName(
            item.mediaFile.filename.replace(/\.[^.]+$/, "") +
              "-preview" +
              extension,
          )
        : safeName(item.mediaFile.filename);
      const file = await open(join(staging, name), "wx", 0o600);
      const reader = response.body.getReader();
      let total = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > max)
            fail("FILE_TOO_LARGE", "Downloads are limited to 1 GiB per item.");
          await file.writeFile(value);
        }
        if (!total)
          fail("DOWNLOAD_EMPTY", "The provider returned an empty media file.");
      } finally {
        await reader.cancel().catch(() => {});
        await file.close();
      }
    });
    return {
      ...result,
      note: preview
        ? "Preview, maximum 1600 pixels per dimension."
        : video
          ? "Google supplies a high-quality transcode, not the original video bytes."
          : "Google’s download excludes location metadata.",
    };
  }
}
