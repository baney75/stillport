import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const pluginFiles = [
  "plugin.json",
  "LICENSE",
  "install.sh",
  "skills/stillport/SKILL.md",
  "docs/google-setup.md",
  "brand/mark.svg",
  "brand/demo-preview.jpg",
  "examples/takeout-demo/README.md",
  "examples/takeout-demo/run.sh",
  "examples/takeout-demo/Harbor/stillport-harbor.png",
  "examples/takeout-demo/Harbor/stillport-harbor.png.supplemental-metadata.json",
] as const;

const fixedTime = new Date("1980-01-01T00:00:00.000Z");
const executableFiles = new Set(["install.sh", "examples/takeout-demo/run.sh"]);

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

  const stage = await mkdtemp(join(tmpdir(), "stillport-plugin-"));
  const archiveTemp = join(
    dirname(archivePath),
    `.${basename(archivePath)}.${randomUUID()}.zip`,
  );
  const checksumPath = `${archivePath}.sha256`;
  const checksumTemp = `${archiveTemp}.sha256`;
  try {
    for (const relative of pluginFiles) {
      const target = join(stage, relative);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(sourceRoot, relative), target);
      await chmod(target, executableFiles.has(relative) ? 0o755 : 0o644);
      await utimes(target, fixedTime, fixedTime);
    }
    await mkdir(dirname(archivePath), { recursive: true });
    const proc = Bun.spawn(["zip", "-X", "-q", archiveTemp, ...pluginFiles], {
      cwd: stage,
      env: { ...process.env, TZ: "UTC" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ]);
    if (code !== 0) throw new Error(`zip failed (${code}): ${stderr.trim()}`);
    const sha256 = createHash("sha256")
      .update(await readFile(archiveTemp))
      .digest("hex");
    await writeFile(checksumTemp, `${sha256}  ${basename(archivePath)}\n`);
    await rename(archiveTemp, archivePath);
    await rename(checksumTemp, checksumPath);
    return { archivePath, checksumPath, sha256 };
  } finally {
    await rm(stage, { recursive: true, force: true });
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
