import { test, expect } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collisionKey,
  makeJpegPreviews,
  previewName,
} from "../src/providers/apple";
const cwd = import.meta.dir + "/..";
async function cli(...args: string[]) {
  const p = Bun.spawn([process.execPath, "src/cli.ts", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { data: JSON.parse(stdout), stderr, code };
}
test("CLI discovers native vs interactive search without accessing private libraries", async () => {
  const result = await cli("capabilities");
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.data.data.apple.nativeSearch).toBe(true);
  expect(result.data.data.google.nativeSearch).toBe("interactive");
  expect(result.data.data.takeout.nativeSearch).toBe(false);
});
test("Google native search reports a user-action path before touching credentials", async () => {
  const result = await cli("search", "beach", "--source", "google");
  expect(result.code).toBe(2);
  expect(result.data.error.code).toBe("INTERACTIVE_SEARCH_REQUIRED");
  expect(result.data.error.hint).toContain("google pick");
});
test("strict argument validation produces JSON and nonzero exit codes", async () => {
  for (const args of [
    ["list", "--limit", "0"],
    ["search", "a", "b"],
    ["list", "--limit", "NaN"],
    ["list", "--after", "2026-02-30"],
    ["list", "--after", "2026-03-01", "--before", "2026-01-01"],
    ["doctor", "--original"],
    ["list", "--sorce", "apple"],
    ["get"],
    ["list", "--source", "bogus"],
  ]) {
    const r = await cli(...args);
    expect(r.code).toBe(2);
    expect(r.data.ok).toBe(false);
    expect(r.stderr).toBe("");
  }
});
test("schema and doctor require no connected account", async () => {
  const schema = await cli("schema");
  expect(schema.data.data.commands["google pick"]).toBeDefined();
  const doctor = await cli("doctor");
  expect(doctor.data.data.networkChecked).toBe(false);
});

test("Apple previews request JPEGs at 1600 pixels without colliding with exports", async () => {
  const root = await mkdtemp(join(tmpdir(), "stillport-preview-"));
  const controller = new AbortController();
  await writeFile(join(root, "beach.heic"), "rendered HEIC");
  await writeFile(join(root, "beach.jpg"), "rendered JPEG");
  await writeFile(join(root, "beach-preview.jpg"), "reserved source name");
  const commands: string[][] = [];
  try {
    await makeJpegPreviews(
      root,
      async (command, _timeout, signal) => {
        expect(signal).toBe(controller.signal);
        commands.push(command);
        const output = command[command.indexOf("--out") + 1];
        await writeFile(output!, "synthetic JPEG");
        return { code: 0, stdout: "", stderr: "" };
      },
      controller.signal,
    );
    expect(commands).toHaveLength(3);
    const sourceKeys = new Set(
      commands.map((command) =>
        command[command.indexOf("--out") - 1]!.split("/")
          .at(-1)!
          .normalize("NFC")
          .toLowerCase(),
      ),
    );
    const destinationKeys = new Set<string>();
    for (const command of commands) {
      expect(command).toContain("format");
      expect(command).toContain("jpeg");
      expect(command).toContain("1600");
      const destination = command[command.indexOf("--out") + 1]!;
      expect(destination).not.toBe(command[command.indexOf("--out") - 1]);
      const key = destination.split("/").at(-1)!.normalize("NFC").toLowerCase();
      expect(sourceKeys.has(key)).toBe(false);
      destinationKeys.add(key);
    }
    expect(destinationKeys.size).toBe(3);
    expect(
      (await readdir(root)).every((name) =>
        /-preview(?:-\d+)?\.jpg$/i.test(name),
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Apple preview reservations are case-insensitive and Unicode-normalized", () => {
  const unavailable = new Set(
    ["beach.heic", "BEACH-preview.JPG", "caf\u00e9-preview.jpg"].map(
      collisionKey,
    ),
  );
  expect(previewName("beach.heic", unavailable)).toBe("beach-preview-2.jpg");
  expect(previewName("cafe\u0301.heic", unavailable)).toBe(
    "cafe\u0301-preview-2.jpg",
  );
});
