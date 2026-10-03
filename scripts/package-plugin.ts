import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const pluginFiles = [
  "plugin.json",
  "LICENSE",
  "install.sh",
  "install.ps1",
  "skills/stillport/SKILL.md",
  "docs/google-setup.md",
  "brand/mark.svg",
  "brand/demo-preview.jpg",
  "examples/takeout-demo/README.md",
  "examples/takeout-demo/run.sh",
  "examples/takeout-demo/run.ps1",
  "examples/takeout-demo/Harbor/stillport-harbor.png",
  "examples/takeout-demo/Harbor/stillport-harbor.png.supplemental-metadata.json",
] as const;

const executableFiles = new Set(["install.sh", "examples/takeout-demo/run.sh"]);

// Store entries without compression: stable bytes across operating systems and
// no external zip executable. Images are already compressed and the bundle is small.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Uint8Array) {
  let n = 0xffffffff;
  for (const byte of bytes) n = crcTable[(n ^ byte) & 255]! ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
function portableZip(entries: { name: string; bytes: Buffer }[]) {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const { name, bytes } of entries) {
    const filename = Buffer.from(name, "utf8");
    const crc = crc32(bytes);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6);
    h.writeUInt16LE(0x0021, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(bytes.length, 18);
    h.writeUInt32LE(bytes.length, 22);
    h.writeUInt16LE(filename.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(0x0314, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0x0021, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(bytes.length, 20);
    c.writeUInt32LE(bytes.length, 24);
    c.writeUInt16LE(filename.length, 28);
    c.writeUInt32LE(
      ((0o100000 | (executableFiles.has(name) ? 0o755 : 0o644)) << 16) >>> 0,
      38,
    );
    c.writeUInt32LE(offset, 42);
    local.push(h, filename, bytes);
    central.push(c, filename);
    offset += h.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

type PluginManifest = {
  version?: unknown;
  extensions?: {
    "com.openai"?: {
      interface?: { composerIcon?: unknown; logo?: unknown };
      onboardingSkill?: unknown;
    };
  };
};

async function regularFileWithoutSymlinks(root: string, relative: string) {
  let current = root;
  const parts = relative.split("/");
  for (const part of parts) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink())
      throw new Error(`Symlink is not allowed: ${relative}`);
    if (current === join(root, relative)) {
      if (!info.isFile()) throw new Error(`Expected a file: ${relative}`);
    } else if (!info.isDirectory()) {
      throw new Error(`Expected a directory in: ${relative}`);
    }
  }
}

function includedReference(value: unknown, label: string) {
  if (typeof value !== "string" || !value.startsWith("./")) {
    throw new Error(`${label} must be a relative ./ file reference`);
  }
  const relative = value.slice(2);
  if (
    relative.includes("\\") ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`${label} has an invalid relative path: ${value}`);
  }
  if (!pluginFiles.includes(relative as (typeof pluginFiles)[number])) {
    throw new Error(`${label} is not included in the plugin ZIP: ${value}`);
  }
}

/** Build the OpenAI skill plugin at an explicit archive path. */
export async function packagePlugin(root: string, out: string) {
  const sourceRoot = resolve(root);
  const archivePath = resolve(out);
  for (const relative of pluginFiles)
    await regularFileWithoutSymlinks(sourceRoot, relative);
  const manifest = JSON.parse(
    await readFile(join(sourceRoot, "plugin.json"), "utf8"),
  ) as PluginManifest;
  const pkg = JSON.parse(
    await readFile(join(sourceRoot, "package.json"), "utf8"),
  ) as { version?: unknown };
  if (
    typeof manifest.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(manifest.version)
  ) {
    throw new Error("plugin.json has an invalid version");
  }
  if (manifest.version !== pkg.version)
    throw new Error("plugin.json and package.json versions differ");
  const openai = manifest.extensions?.["com.openai"];
  includedReference(openai?.interface?.composerIcon, "composerIcon");
  includedReference(openai?.interface?.logo, "logo");
  includedReference(openai?.onboardingSkill, "onboardingSkill");
  if (basename(archivePath) !== `stillport-plugin-v${manifest.version}.zip`) {
    throw new Error(
      `Archive name must be stillport-plugin-v${manifest.version}.zip`,
    );
  }

  const archiveTemp = join(
    dirname(archivePath),
    `.${basename(archivePath)}.${randomUUID()}.zip`,
  );
  const checksumPath = `${archivePath}.sha256`;
  const checksumTemp = `${archiveTemp}.sha256`;
  try {
    const entries = [];
    for (const relative of pluginFiles) {
      await regularFileWithoutSymlinks(sourceRoot, relative);
      entries.push({
        name: relative,
        bytes: await readFile(join(sourceRoot, relative)),
      });
    }
    await mkdir(dirname(archivePath), { recursive: true });
    await writeFile(archiveTemp, portableZip(entries), { flag: "wx" });
    const sha256 = createHash("sha256")
      .update(await readFile(archiveTemp))
      .digest("hex");
    await writeFile(checksumTemp, `${sha256}  ${basename(archivePath)}\n`);
    await rename(archiveTemp, archivePath);
    await rename(checksumTemp, checksumPath);
    return { archivePath, checksumPath, sha256 };
  } finally {
    await rm(archiveTemp, { force: true });
    await rm(checksumTemp, { force: true });
  }
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const manifest = JSON.parse(
    await readFile(join(root, "plugin.json"), "utf8"),
  ) as { version: string };
  const out = join(root, "dist", `stillport-plugin-v${manifest.version}.zip`);
  const result = await packagePlugin(root, out);
  console.log(`${result.archivePath}\nSHA256 ${result.sha256}`);
}
