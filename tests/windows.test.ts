import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pkg from "../package.json";
import { makeWindowsPreview } from "../src/windows-preview";

const binary = process.env.STILLPORT_WINDOWS_BINARY;
const native = process.platform === "win32" && !!binary;

async function invoke(args: string[], env = process.env) {
  const child = Bun.spawn(args, {
    cwd: resolve("."),
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

test.skipIf(!native)(
  "native installer verifies checksum and preserves installation on mismatch",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "stillport-install-test-"));
    const asset = `stillport-windows-${process.arch}.exe`;
    const bytes = await Bun.file(binary!).arrayBuffer();
    const hash = createHash("sha256")
      .update(new Uint8Array(bytes))
      .digest("hex");
    let bad = false;
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const name = new URL(request.url).pathname.slice(1);
        if (name === asset) return new Response(bytes);
        if (name === "SHA256SUMS")
          return new Response(`${bad ? "0".repeat(64) : hash}  ${asset}\n`);
        return new Response("missing", { status: 404 });
      },
    });
    try {
      const installer = resolve("install.ps1");
      const run = () =>
        invoke([
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          installer,
          "-NoPath",
          "-InstallDir",
          root,
          "-ReleaseBaseUri",
          `http://127.0.0.1:${server.port}`,
        ]);
      const first = await run();
      expect(first.code).toBe(0);
      expect(
        (
          await invoke([join(root, "stillport.exe"), "--version"])
        ).stdout.trim(),
      ).toBe(pkg.version);
      bad = true;
      const second = await run();
      expect(second.code).not.toBe(0);
      expect(second.stderr + second.stdout).toContain("Checksum mismatch");
      expect(
        (
          await invoke([join(root, "stillport.exe"), "--version"])
        ).stdout.trim(),
      ).toBe(pkg.version);
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(!native)(
  "detached Windows helper applies after parent exit and rejects changed checksum",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "stillport-update-test-"));
    const installed = join(root, "stillport.exe");
    const bytes = await Bun.file(binary!).arrayBuffer();
    const hash = createHash("sha256")
      .update(new Uint8Array(bytes))
      .digest("hex");
    const script = `import {stageWindowsUpdate} from './src/update.ts';
const bytes = new Uint8Array(await Bun.file(process.env.STILLPORT_TEST_BINARY).arrayBuffer());
const result = await stageWindowsUpdate(process.env.STILLPORT_TEST_INSTALLED, bytes, process.env.STILLPORT_TEST_HASH, process.env.STILLPORT_TEST_VERSION, Number(process.env.STILLPORT_TEST_WAIT_PID) || process.pid);
console.log(JSON.stringify(result));`;
    async function run(expected: string, waitForPid?: number) {
      const child = await invoke([process.execPath, "-e", script], {
        ...process.env,
        STILLPORT_TEST_BINARY: binary!,
        STILLPORT_TEST_INSTALLED: installed,
        STILLPORT_TEST_HASH: expected,
        STILLPORT_TEST_VERSION: pkg.version,
        STILLPORT_TEST_WAIT_PID: waitForPid ? String(waitForPid) : "",
      });
      expect(child.code).toBe(0);
      const result = JSON.parse(child.stdout.trim()) as {
        pending: boolean;
        status: string;
      };
      expect(result.pending).toBe(true);
      for (let i = 0; i < 100; i++) {
        const text = await readFile(result.status, "utf8").catch(() => "");
        if (text) return text;
        await Bun.sleep(100);
      }
      throw new Error(
        "Update helper did not report status within ten seconds.",
      );
    }
    try {
      await writeFile(installed, "original");
      expect(await run("0".repeat(64))).toStartWith("failed:");
      expect(await readFile(installed, "utf8")).toBe("original");
      await copyFile(binary!, installed);
      const old = Bun.spawn([installed, "mcp"], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      await Bun.sleep(200);
      expect(old.pid).toBeGreaterThan(0);
      const pending = run(hash, old.pid);
      await Bun.sleep(300);
      old.stdin.end();
      expect(await old.exited).toBe(0);
      expect(await pending).toBe("applied");
      expect((await invoke([installed, "--version"])).stdout.trim()).toBe(
        pkg.version,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(!native)(
  "Windows preview rotates EXIF, bounds dimensions, and preserves original",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "stillport-preview-test-"));
    const source = join(root, "Unicode café photo.jpg");
    const destination = join(root, "preview.jpg");
    const make = String.raw`Add-Type -AssemblyName System.Drawing
$bitmap = [System.Drawing.Bitmap]::new(2400,1200)
try {
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try { $graphics.Clear([System.Drawing.Color]::Red) } finally { $graphics.Dispose() }
  $bitmap.Save($env:STILLPORT_TEST_SOURCE, [System.Drawing.Imaging.ImageFormat]::Jpeg)
} finally { $bitmap.Dispose() }`;
    const orientation = String.raw`Add-Type -AssemblyName System.Drawing
$image = [System.Drawing.Image]::FromFile($env:STILLPORT_TEST_SOURCE)
try { if ($image.PropertyIdList -contains 274) { $image.GetPropertyItem(274).Value[0] } else { 'missing' } } finally { $image.Dispose() }`;
    const inspect = String.raw`Add-Type -AssemblyName System.Drawing
$image = [System.Drawing.Image]::FromFile($env:STILLPORT_TEST_DEST)
try { [pscustomobject]@{ width=$image.Width; height=$image.Height } | ConvertTo-Json -Compress } finally { $image.Dispose() }`;
    function ps(script: string, env: NodeJS.ProcessEnv) {
      return invoke(
        [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ],
        env,
      );
    }
    try {
      expect(
        (await ps(make, { ...process.env, STILLPORT_TEST_SOURCE: source }))
          .code,
      ).toBe(0);
      const jpeg = new Uint8Array(await Bun.file(source).arrayBuffer());
      // JPEG APP1: Exif\0\0 + little-endian TIFF IFD0 with Orientation=6.
      const app1 = Uint8Array.from([
        0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a,
        0, 0x08, 0, 0, 0, 0x01, 0, 0x12, 0x01, 0x03, 0, 0x01, 0, 0, 0, 0x06, 0,
        0, 0, 0, 0, 0, 0,
      ]);
      await writeFile(
        source,
        Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]),
      );
      const tag = await ps(orientation, {
        ...process.env,
        STILLPORT_TEST_SOURCE: source,
      });
      expect(tag.code).toBe(0);
      expect(tag.stdout.trim()).toBe("6");
      const before = createHash("sha256")
        .update(new Uint8Array(await Bun.file(source).arrayBuffer()))
        .digest("hex");
      await makeWindowsPreview(source, destination);
      const after = createHash("sha256")
        .update(new Uint8Array(await Bun.file(source).arrayBuffer()))
        .digest("hex");
      expect(after).toBe(before);
      const info = await ps(inspect, {
        ...process.env,
        STILLPORT_TEST_DEST: destination,
      });
      expect(info.code).toBe(0);
      expect(JSON.parse(info.stdout)).toEqual({ width: 800, height: 1600 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
