import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const targets = process.argv.includes("--all")
  ? [
      "bun-darwin-arm64",
      "bun-darwin-x64",
      "bun-linux-arm64",
      "bun-linux-x64-baseline",
      "bun-windows-x64",
      "bun-windows-arm64",
    ]
  : [
      `bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}${process.platform === "linux" && process.arch === "x64" ? "-baseline" : ""}`,
    ];
await mkdir("dist", { recursive: true });
const sums: string[] = [];
for (const target of targets) {
  const name =
    "stillport-" +
    target.replace("bun-", "").replace("-baseline", "") +
    (target.includes("windows") ? ".exe" : "");
  const result = await Bun.build({
    entrypoints: ["./src/cli.ts"],
    compile: {
      target: target as Bun.Build.CompileTarget,
      outfile: `dist/${name}`,
    },
    minify: true,
    sourcemap: "none",
  });
  if (!result.success)
    throw new Error("Build failed: " + result.logs.join("\n"));
  const bytes = await Bun.file(`dist/${name}`).arrayBuffer();
  sums.push(
    `${createHash("sha256").update(new Uint8Array(bytes)).digest("hex")}  ${name}`,
  );
}
await writeFile("dist/SHA256SUMS", sums.join("\n") + "\n");
