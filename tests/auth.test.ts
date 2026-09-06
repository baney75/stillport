import { test, expect } from "bun:test";
import { login } from "../src/auth";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("real OAuth loopback rejects forged state and invalid callbacks, then closes on user denial", async () => {
  const root = await mkdtemp(join(tmpdir(), "stillport-oauth-"));
  const clientJson = join(root, "client.json");
  await writeFile(
    clientJson,
    JSON.stringify({ installed: { client_id: "synthetic-test-client" } }),
  );
  let flow: Promise<void> = Promise.resolve();
  let callback = "";
  try {
    const auth = login(
      { profile: "test", clientJson, open: false },
      (event: any) => {
        const authorization = new URL(event.url);
        expect(authorization.hostname).toBe("accounts.google.com");
        expect(authorization.searchParams.get("code_challenge_method")).toBe(
          "S256",
        );
        const target = new URL(authorization.searchParams.get("redirect_uri")!);
        callback = target.href;
        expect(target.hostname).toBe("127.0.0.1");
        flow = (async () => {
          target.searchParams.set("state", "forged");
          target.searchParams.set("code", "not-a-real-code");
          expect((await fetch(target)).status).toBe(400);
          target.searchParams.set(
            "state",
            authorization.searchParams.get("state")!,
          );
          expect((await fetch(target, { method: "POST" })).status).toBe(404);
          target.searchParams.delete("code");
          expect((await fetch(target)).status).toBe(400);
          target.searchParams.set("error", "access_denied");
          const response = await fetch(target);
          expect(response.status).toBe(200);
        })();
      },
    );
    await expect(auth).rejects.toThrow("declined or timed out");
    await flow;
    await expect(fetch(callback)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
