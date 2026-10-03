import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function stateDirectory(
  platform = process.platform,
  env = process.env,
  home = homedir(),
) {
  if (env.STILLPORT_HOME) return env.STILLPORT_HOME;
  const legacy = join(home, ".local", "share", "stillport");
  if (platform !== "win32" || existsSync(legacy)) return legacy;
  return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "Stillport");
}

export function safeFilename(name: string) {
  let value = name
    .replace(/[\\/\x00-\x1f\x7f<>:"|?*]/g, "_")
    .replace(/^\.+/, "_")
    .slice(0, 160)
    .replace(/[. ]+$/, "");
  if (
    /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(
      value,
    )
  )
    value = `_${value}`;
  return value || "photo";
}

// pwsh 7 can pass its module path to Windows PowerShell 5.1. Let the latter
// reconstruct its own defaults so built-in commands such as Get-Acl load.
export function windowsPowerShellEnv(
  extra: NodeJS.ProcessEnv = {},
  inherited: NodeJS.ProcessEnv = process.env,
) {
  const env = { ...inherited, ...extra };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "psmodulepath") delete env[key];
  }
  return env;
}

export function windowsPowerShell(
  which: (name: string) => string | null = Bun.which,
) {
  return which("pwsh.exe") ? "pwsh.exe" : "powershell.exe";
}

async function command(args: string[], env = process.env) {
  const child = Bun.spawn(args, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exit !== 0)
    throw new Error(
      `Windows permission setup failed: ${stderr.trim() || stdout.trim()}`,
    );
  return stdout.trim();
}

const aclScript = String.raw`
$ErrorActionPreference = 'Stop'
$path = $env:STILLPORT_PRIVATE_PATH
$acl = Get-Acl -LiteralPath $path
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($rule) }
$item = Get-Item -LiteralPath $path -Force
$inherit = if ($item.PSIsContainer) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
$propagate = [Security.AccessControl.PropagationFlags]::None
$allow = [Security.AccessControl.AccessControlType]::Allow
$full = [Security.AccessControl.FileSystemRights]::FullControl
foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
  $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, $full, $inherit, $propagate, $allow)
  $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $path -AclObject $acl
`;
export async function makePrivateWindows(path: string) {
  if (process.platform !== "win32") return;
  await command(
    [
      windowsPowerShell(),
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(aclScript, "utf16le").toString("base64"),
    ],
    windowsPowerShellEnv({ STILLPORT_PRIVATE_PATH: path }),
  );
}
