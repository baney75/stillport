import { expect, test } from "bun:test";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { packagePlugin } from "../scripts/package-plugin";

const projectRoot = resolve(import.meta.dir, "..");
const included = [
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
];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "stillport-plugin-test-"));
  for (const relative of [...included, "package.json"]) {
    const target = join(root, relative);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(projectRoot, relative), target);
  }
  return root;
}

async function run(...command: string[]) {
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`${command[0]} failed (${code}): ${stderr}`);
  return stdout;
}

test("plugin ZIP extracts with linked resources and excludes added private files", async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, ".git"));
    await writeFile(join(root, ".git", "secret"), "private");
    await writeFile(join(root, ".env"), "SECRET=private");
    await writeFile(join(root, "oauth-client.json"), "private");
    await writeFile(join(root, "photos.db"), "private");
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "dist", "stillport"), "binary");
    const out = join(root, "output", "stillport-plugin-v0.1.3.zip");
    const result = await packagePlugin(root, out);
    const names = (await run("unzip", "-Z", "-1", out)).trim().split("\n");
    expect(names).toEqual(included);
    const extracted = join(root, "extracted");
    await run("unzip", "-qq", out, "-d", extracted);
    const manifest = JSON.parse(
      await readFile(join(extracted, "plugin.json"), "utf8"),
    );
    const openai = manifest.extensions["com.openai"];
    for (const ref of [
      openai.interface.composerIcon,
      openai.interface.logo,
      openai.onboardingSkill,
    ]) {
      expect(included).toContain(ref.slice(2));
      expect(await readFile(join(extracted, ref))).toEqual(
        await readFile(join(root, ref)),
      );
    }
    const skill = await readFile(
      join(extracted, "skills/stillport/SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("../../install.sh");
    expect(skill).toContain("../../docs/google-setup.md");
    expect(skill).toContain("examples/takeout-demo/run.sh");
    expect(await readFile(result.checksumPath, "utf8")).toBe(
      `${result.sha256}  stillport-plugin-v0.1.3.zip\n`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repeat packaging produces identical ZIP bytes", async () => {
  const root = await fixture();
  try {
    const first = await packagePlugin(
      root,
      join(root, "one", "stillport-plugin-v0.1.3.zip"),
    );
    const second = await packagePlugin(
      root,
      join(root, "two", "stillport-plugin-v0.1.3.zip"),
    );
    expect(second.sha256).toBe(first.sha256);
    expect(await readFile(second.archivePath)).toEqual(
      await readFile(first.archivePath),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing manifest references and files fail before an archive is produced", async () => {
  const root = await fixture();
  try {
    const out = join(root, "out", "stillport-plugin-v0.1.3.zip");
    const manifestPath = join(root, "plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.extensions["com.openai"].interface.composerIcon =
      "./brand/missing.svg";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(packagePlugin(root, out)).rejects.toThrow(
      "composerIcon is not included",
    );
    expect(await Bun.file(out).exists()).toBe(false);
    manifest.extensions["com.openai"].interface.composerIcon =
      "./brand/mark.svg";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await rm(join(root, "brand/mark.svg"));
    await expect(packagePlugin(root, out)).rejects.toThrow();
    expect(await Bun.file(out).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("whitelisted symlink is rejected", async () => {
  const root = await fixture();
  try {
    await rm(join(root, "brand/mark.svg"));
    await symlink(
      join(projectRoot, "brand/mark.svg"),
      join(root, "brand/mark.svg"),
    );
    const out = join(root, "out", "stillport-plugin-v0.1.3.zip");
    await expect(packagePlugin(root, out)).rejects.toThrow(
      "Symlink is not allowed",
    );
    expect(await Bun.file(out).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plugin and package versions must match", async () => {
  const root = await fixture();
  try {
    const pkgPath = join(root, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    pkg.version = "0.1.2";
    await writeFile(pkgPath, JSON.stringify(pkg));
    const out = join(root, "out", "stillport-plugin-v0.1.3.zip");
    await expect(packagePlugin(root, out)).rejects.toThrow("versions differ");
    expect(await Bun.file(out).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
