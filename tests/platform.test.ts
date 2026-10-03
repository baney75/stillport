import { test, expect } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  safeFilename,
  stateDirectory,
  makePrivateWindows,
  windowsPowerShellEnv,
} from "../src/platform";
import { exportDirectory } from "../src/core";

test("Windows names avoid device aliases and terminal dots/spaces", () => {
  expect(safeFilename("CON.txt")).toBe("_CON.txt");
  expect(safeFilename("lpt9.")).toBe("_lpt9");
  expect(safeFilename("COM¹.jpg")).toBe("_COM¹.jpg");
  expect(safeFilename("photo... ")).toBe("photo");
  expect(safeFilename("a/b:c")).toBe("a_b_c");
});

test("Windows PowerShell child drops inherited module paths only", () => {
  const env = windowsPowerShellEnv(
    { STILLPORT_PRIVATE_PATH: "C:\\test", PSMODULEPATH: "from-extra" },
    { PSModulePath: "from-pwsh", PATH: "keep", CUSTOM: "keep-too" },
  );
  expect(Object.keys(env).some((key) => key.toLowerCase() === "psmodulepath")).toBe(false);
  expect(env.PATH).toBe("keep");
  expect(env.CUSTOM).toBe("keep-too");
  expect(env.STILLPORT_PRIVATE_PATH).toBe("C:\\test");
});

test.skipIf(process.platform !== "win32")(
  "export preserves caller folder ACL and protects new result",
  async () => {
    const parent = await mkdtemp(join(tmpdir(), "stillport-export-parent-"));
    const aclScript = String.raw`$a = Get-Acl -LiteralPath $env:STILLPORT_PRIVATE_PATH
[pscustomobject]@{ sddl=$a.Sddl; protected=$a.AreAccessRulesProtected; user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; entries=@($a.Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }) } | ConvertTo-Json -Depth 4 -Compress`;
    async function acl(path: string) {
      const child = Bun.spawn(
        [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(aclScript, "utf16le").toString("base64"),
        ],
        {
          stdout: "pipe",
          stderr: "pipe",
          env: windowsPowerShellEnv({ STILLPORT_PRIVATE_PATH: path }),
        },
      );
      const output = await new Response(child.stdout).text();
      expect(await child.exited).toBe(0);
      return JSON.parse(output) as {
        sddl: string;
        protected: boolean;
        user: string;
        entries: string[];
      };
    }
    try {
      const before = await acl(parent);
      const result = await exportDirectory(parent, (staging) =>
        Bun.write(join(staging, "sample.txt"), "sample").then(() => {}),
      );
      const after = await acl(parent);
      const child = await acl(result.directory);
      expect(after.sddl).toBe(before.sddl);
      expect(child.protected).toBe(true);
      expect(child.entries.sort()).toEqual([child.user, "S-1-5-18"].sort());
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  },
);

test("Windows uses LOCALAPPDATA while preserving existing state", async () => {
  const home = await mkdtemp(join(tmpdir(), "stillport-state-"));
  try {
    expect(
      stateDirectory(
        "win32",
        {
          LOCALAPPDATA: "C:\\Users\\Example\\AppData\\Local",
        } as NodeJS.ProcessEnv,
        home,
      ),
    ).toBe(join("C:\\Users\\Example\\AppData\\Local", "Stillport"));
    const legacy = join(home, ".local", "share", "stillport");
    await mkdir(legacy, { recursive: true });
    await Bun.write(join(legacy, "takeout.sqlite"), "old");
    expect(
      stateDirectory(
        "win32",
        {
          LOCALAPPDATA: "C:\\Users\\Example\\AppData\\Local",
        } as NodeJS.ProcessEnv,
        home,
      ),
    ).toBe(legacy);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "win32")(
  "Windows private directory has protected ACL",
  async () => {
    const path = await mkdtemp(join(tmpdir(), "stillport-acl-"));
    try {
      await makePrivateWindows(path);
      const script = String.raw`$a = Get-Acl -LiteralPath $env:STILLPORT_PRIVATE_PATH
$entries = @($a.Access | ForEach-Object { [pscustomobject]@{ sid = $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; rights = $_.FileSystemRights.ToString(); type = $_.AccessControlType.ToString() } })
[pscustomobject]@{ protected = $a.AreAccessRulesProtected; user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; entries = $entries } | ConvertTo-Json -Depth 5 -Compress`;
      const child = Bun.spawn(
        [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ],
        {
          stdout: "pipe",
          stderr: "pipe",
          env: windowsPowerShellEnv({ STILLPORT_PRIVATE_PATH: path }),
        },
      );
      const output = await new Response(child.stdout).text();
      expect(await child.exited).toBe(0);
      const acl = JSON.parse(output) as {
        protected: boolean;
        user: string;
        entries: Array<{ sid: string; rights: string; type: string }>;
      };
      expect(acl.protected).toBe(true);
      expect(acl.entries.map((entry) => entry.sid).sort()).toEqual(
        [acl.user, "S-1-5-18"].sort(),
      );
      expect(
        acl.entries.every(
          (entry) =>
            entry.type === "Allow" && entry.rights.includes("FullControl"),
        ),
      ).toBe(true);
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  },
);
