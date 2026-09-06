import { test, expect } from "bun:test";
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
