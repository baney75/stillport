import { chmod, copyFile, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { createHash } from "node:crypto";
import { REPO, VERSION, fail, runProcess } from "./core";
import { requestJson } from "./http";
import { windowsPowerShell, windowsPowerShellEnv } from "./platform";
export function releaseAsset(
  platform = process.platform as string,
  arch = process.arch as string,
) {
  if (
    !["darwin", "linux", "win32"].includes(platform) ||
    !["arm64", "x64"].includes(arch)
  )
    fail(
      "PLATFORM_UNSUPPORTED",
      "Release binaries support macOS, Linux and Windows on ARM64 and x64.",
      "Run from source with Bun on other platforms.",
      3,
    );
  return `stillport-${platform === "win32" ? "windows" : platform}-${arch}${platform === "win32" ? ".exe" : ""}`;
}

// The helper runs after the CLI releases its .exe lock. Paths are environment
// values, never source text passed through cmd.exe.
export const windowsUpdateHelper = String.raw`
$ErrorActionPreference = 'Stop'
$ParentPid = [int]$env:STILLPORT_UPDATE_PARENT_PID
$Installed = $env:STILLPORT_UPDATE_INSTALLED
$Staged = $env:STILLPORT_UPDATE_STAGED
$Backup = $env:STILLPORT_UPDATE_BACKUP
$Status = $env:STILLPORT_UPDATE_STATUS
$ExpectedHash = $env:STILLPORT_UPDATE_HASH
try {
  $parent = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
  if ($parent) { $null = $parent.WaitForExit(120000) }
  if (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) { throw 'The running Stillport process did not exit within two minutes.' }
  if ((Get-FileHash -LiteralPath $Staged -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedHash) { throw 'The staged executable checksum changed.' }
  Move-Item -LiteralPath $Installed -Destination $Backup -ErrorAction Stop
  try {
    Move-Item -LiteralPath $Staged -Destination $Installed -ErrorAction Stop
  } catch {
    Move-Item -LiteralPath $Backup -Destination $Installed -ErrorAction Stop
    throw
  }
  Set-Content -LiteralPath $Status -Value 'applied' -NoNewline
} catch {
  Set-Content -LiteralPath $Status -Value ('failed: ' + $_.Exception.Message) -NoNewline
  exit 1
}
`;

export function windowsUpdateLaunchCommand(shell = windowsPowerShell()) {
  if (shell !== "pwsh.exe" && shell !== "powershell.exe")
    throw new Error("Unsupported Windows PowerShell executable.");
  const encoded = Buffer.from(windowsUpdateHelper, "utf16le").toString(
    "base64",
  );
  return [
    "cmd.exe",
    "/d",
    "/c",
    "start",
    "",
    "/b",
    shell,
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    encoded,
  ];
}

export async function stageWindowsUpdate(
  executable: string,
  binary: Uint8Array,
  expectedHash: string,
  version: string,
  waitForPid = process.pid,
) {
  const staging = await mkdtemp(
    join(dirname(executable), ".stillport-update-"),
  );
  const staged = join(staging, "stillport.exe");
  const status = join(staging, "status.txt");
  const rollback = `${executable}.previous-${Date.now()}`;
  try {
    await Bun.write(staged, binary);
    const probe = await runProcess([staged, "--version"], 15_000);
    if (probe.code || probe.stdout.trim() !== version)
      fail(
        "UPDATE_VALIDATION_FAILED",
        "The new binary did not report the expected version. Your installation is unchanged.",
      );
    const child = Bun.spawn(windowsUpdateLaunchCommand(), {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: true,
      env: windowsPowerShellEnv({
        STILLPORT_UPDATE_PARENT_PID: String(waitForPid),
        STILLPORT_UPDATE_INSTALLED: executable,
        STILLPORT_UPDATE_STAGED: staged,
        STILLPORT_UPDATE_BACKUP: rollback,
        STILLPORT_UPDATE_STATUS: status,
        STILLPORT_UPDATE_HASH: expectedHash,
      }),
    });
    // The trampoline must start before this process exits. The helper itself
    // reports applied/failed in the status file after the running .exe unlocks.
    if ((await child.exited) !== 0)
      throw new Error("Could not start the Windows update helper.");
    return {
      current: VERSION,
      latest: version,
      updated: false,
      pending: true,
      status,
      rollback,
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
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
  if (process.platform === "win32")
    return stageWindowsUpdate(
      executable,
      binary,
      expected,
      release.tag_name.slice(1),
    );
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
