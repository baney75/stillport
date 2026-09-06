import { test, expect } from "bun:test";
import { GooglePhotos, mediaUrl } from "../src/providers/google";
import { pkce, validState } from "../src/auth";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestJson } from "../src/http";
const item = {
  id: "photo-1",
  createTime: "2026-01-01T00:00:00Z",
  type: "PHOTO",
  mediaFile: {
    filename: "../../test.jpg",
    mimeType: "image/jpeg",
    baseUrl: "https://lh3.googleusercontent.com/p/example",
    mediaFileMetadata: { width: 100, height: 100 },
  },
};
test("Picker create, selected item pagination and download use the documented wire contract", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const root = await mkdtemp(join(tmpdir(), "stillport-google-"));
  const google = new GooglePhotos(
    async () => "test-only-token",
    async (url, init) => {
      calls.push({ url: String(url), init });
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer test-only-token",
      );
      if (String(url).endsWith("/sessions")) {
        expect(
          JSON.parse(init!.body as string).pickingConfig.maxItemCount,
        ).toBe("7");
        return Response.json({
          id: "session",
          pickerUri: "https://photos.google.com/picker/abc",
        });
      }
      if (String(url).includes("googleusercontent"))
        return new Response("synthetic-jpeg", {
          headers: { "Content-Type": "image/jpeg" },
        });
      return Response.json({
        mediaItems: [item],
        nextPageToken: String(url).includes("pageToken") ? undefined : "page-2",
      });
    },
  );
  try {
    expect((await google.start(7)).id).toBe("session");
    const first = await google.items("session", 1);
    expect(first.nextCursor).toBe("page-2");
    expect(JSON.stringify(first)).not.toContain("baseUrl");
    await google.items("session", 1, first.nextCursor!);
    expect(calls.at(-1)!.url).toContain("pageToken=page-2");
    const result = await google.download("session", "photo-1", root);
    expect(result.files[0]!.startsWith(root + "/stillport-")).toBe(true);
    expect(await Bun.file(result.files[0]!).text()).toBe("synthetic-jpeg");
    expect(calls.at(-1)!.url).toEndWith("=d");
    expect(calls.at(-1)!.init?.redirect).toBe("error");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("reject media hosts that could leak a bearer token", () => {
  for (const url of [
    "http://lh3.googleusercontent.com/x",
    "https://googleusercontent.com.evil.test/x",
    "https://localhost/x",
    "https://user:pass@lh3.googleusercontent.com/x",
    "https://lh3.googleusercontent.com:9999/x",
  ])
    expect(() => mediaUrl(url, "=d")).toThrow();
});
test("failed media downloads leave no partial files", async () => {
  const root = await mkdtemp(join(tmpdir(), "stillport-fail-"));
  const google = new GooglePhotos(
    async () => "test",
    async (url) =>
      String(url).includes("googleusercontent")
        ? new Response("oops", { status: 403 })
        : Response.json({ mediaItems: [item] }),
  );
  try {
    await expect(google.download("s", "photo-1", root)).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("non-ready video is not downloaded", async () => {
  const google = new GooglePhotos(
    async () => "test",
    async () => Response.json({ mediaItems: [{ ...item, type: "VIDEO" }] }),
  );
  await expect(google.download("s", "photo-1", "/unused")).rejects.toThrow(
    "ready",
  );
});
test("OAuth uses verifiable S256 PKCE and constant-time state comparison", () => {
  const { verifier, challenge } = pkce();
  expect(verifier.length).toBeGreaterThanOrEqual(43);
  expect(challenge).toBe(
    createHash("sha256").update(verifier).digest("base64url"),
  );
  expect(validState("same", "same")).toBe(true);
  expect(validState("other", "same")).toBe(false);
  expect(validState(null, "same")).toBe(false);
});
test("provider errors never echo response credentials; GET retries transient failure", async () => {
  await expect(
    requestJson(
      "https://example.test",
      {},
      async () => new Response("secret-token", { status: 401 }),
    ),
  ).rejects.toThrow("authorization");
  let count = 0;
  const result = await requestJson("https://example.test", {}, async () =>
    ++count === 1
      ? new Response("", { status: 503, headers: { "retry-after": "0" } })
      : Response.json({ recovered: true }),
  );
  expect(count).toBe(2);
  expect(result).toEqual({ recovered: true });
  let posts = 0;
  await expect(
    requestJson("https://example.test", { method: "POST" }, async () => {
      posts++;
      return new Response("", { status: 503 });
    }),
  ).rejects.toThrow();
  expect(posts).toBe(1);
});
