import { chmod, copyFile, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { createHash } from "node:crypto";
import { REPO, VERSION, fail, runProcess } from "./core";
import { requestJson } from "./http";
export function releaseAsset(
  platform = process.platform as string,
  arch = process.arch as string,
) {
  if (
    !["darwin", "linux"].includes(platform) ||
    !["arm64", "x64"].includes(arch)
  )
    fail(
      "PLATFORM_UNSUPPORTED",
      "Release binaries support macOS and Linux on ARM64 and x64.",
      "Run from source with Bun on other platforms.",
      3,
    );
  return `stillport-${platform}-${arch}`;
}
export function checksumFor(sums: string, asset: string) {
  const matches = sums
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[1]?.replace(/^\*/, "") === asset);
  if (matches.length !== 1 || !/^[a-f0-9]{64}$/.test(matches[0]![0]!))
    return fail(
      "CHECKSUM_MISSING",
      "The release checksum file is invalid or missing this binary.",
    );
  return matches[0]![0]!;
}
function numericVersion(v: string) {
  return v.replace(/^v/, "").split(".").map(Number);
}
export function newer(candidate: string, current: string) {
  const a = numericVersion(candidate),
    b = numericVersion(current);
  for (let i = 0; i < 3; i++) {
    if (a[i]! > b[i]!) return true;
    if (a[i]! < b[i]!) return false;
  }
  return false;
}
async function download(url: string, max: number) {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  } catch {
    return fail(
      "UPDATE_NETWORK_ERROR",
      "Could not download the release.",
      "Check your network connection.",
      5,
    );
  }
  if (!response.ok || !response.body)
    fail(
      "UPDATE_DOWNLOAD_FAILED",
      `Release download returned HTTP ${response.status}.`,
      "Your current installation is unchanged.",
      5,
    );
  if (Number(response.headers.get("content-length")) > max) {
    await response.body.cancel();
    fail("UPDATE_TOO_LARGE", "The release file exceeds the download limit.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max)
        fail(
          "UPDATE_TOO_LARGE",
          "The release file exceeds the download limit.",
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}
export async function update(check = false) {
  const release = await requestJson<{ tag_name: string }>(
    `https://api.github.com/repos/${REPO}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `stillport/${VERSION}`,
      },
    },
  );
  if (!/^v\d+\.\d+\.\d+$/.test(release.tag_name))
    fail("INVALID_RELEASE", "The latest release tag is not a stable version.");
  const available = newer(release.tag_name, VERSION);
  if (check || !available)
    return {
      current: VERSION,
      latest: release.tag_name.slice(1),
      updateAvailable: available,
      updated: false,
    };
  if (/^bun(?:\.exe)?$/.test(basename(process.execPath)))
    fail(
      "SOURCE_INSTALL",
      "This command updates standalone Stillport binaries.",
      "For a source checkout: git pull --ff-only && bun install --frozen-lockfile. Or use the release installer.",
      2,
    );
  const asset = releaseAsset();
  const base = `https://github.com/${REPO}/releases/download/${release.tag_name}`;
  const sums = (await download(base + "/SHA256SUMS", 64 * 1024)).toString();
  const expected = checksumFor(sums, asset);
  const binary = await download(base + "/" + asset, 200 * 1024 * 1024);
  if (createHash("sha256").update(binary).digest("hex") !== expected)
    fail(
      "CHECKSUM_MISMATCH",
      "Release verification failed. Your installation is unchanged.",
    );
  const executable = process.execPath;
  const staging = await mkdtemp(
    join(dirname(executable), ".stillport-update-"),
  );
  try {
    const path = join(staging, "stillport");
    await Bun.write(path, binary);
    await chmod(path, 0o755);
    const probe = await runProcess([path, "--version"], 15_000);
    if (probe.code || probe.stdout.trim() !== release.tag_name.slice(1))
      fail(
        "UPDATE_VALIDATION_FAILED",
        "The new binary did not report the expected version. Your installation is unchanged.",
      );
    await copyFile(executable, join(staging, "previous"));
    await rename(join(staging, "previous"), executable + ".previous");
    await rename(path, executable);
    return {
      current: release.tag_name.slice(1),
      previous: VERSION,
      updated: true,
      rollback: executable + ".previous",
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
