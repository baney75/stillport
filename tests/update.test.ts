import { test, expect } from "bun:test";
import { checksumFor, newer, releaseAsset } from "../src/update";
test("release selection and checksum matching reject ambiguous or malformed manifests", () => {
  expect(releaseAsset("darwin", "arm64")).toBe("stillport-darwin-arm64");
  expect(() => releaseAsset("plan9", "mips")).toThrow();
  const hash = "a".repeat(64);
  expect(
    checksumFor(`${hash}  stillport-linux-x64\n`, "stillport-linux-x64"),
  ).toBe(hash);
  expect(() => checksumFor(`${hash} other`, "stillport-linux-x64")).toThrow();
  expect(() => checksumFor(`${hash} app\n${hash} app`, "app")).toThrow();
  expect(newer("v0.2.0", "0.1.9")).toBe(true);
  expect(newer("v0.1.0", "0.1.0")).toBe(false);
  expect(newer("v0.1.0", "0.2.0")).toBe(false);
});
