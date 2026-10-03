import { rm } from "node:fs/promises";
import { cancelledError, fail, throwIfCancelled } from "./core";
import { windowsPowerShell, windowsPowerShellEnv } from "./platform";

// Paths travel as process environment values, never as PowerShell source text.
const previewScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$source = $env:STILLPORT_PREVIEW_SOURCE
$destination = $env:STILLPORT_PREVIEW_DESTINATION
$image = [System.Drawing.Image]::FromFile($source)
try {
  $orientation = 1
  if ($image.PropertyIdList -contains 274) { $orientation = [int]$image.GetPropertyItem(274).Value[0] }
  $rotations = @{
    2 = 'RotateNoneFlipX'; 3 = 'Rotate180FlipNone'; 4 = 'Rotate180FlipX'
    5 = 'Rotate90FlipX'; 6 = 'Rotate90FlipNone'; 7 = 'Rotate270FlipX'; 8 = 'Rotate270FlipNone'
  }
  if ($rotations.ContainsKey($orientation)) {
    $image.RotateFlip([Enum]::Parse([System.Drawing.RotateFlipType], $rotations[$orientation]))
  }
  $scale = [Math]::Min(1.0, [Math]::Min(1600.0 / $image.Width, 1600.0 / $image.Height))
  $width = [Math]::Max(1, [int][Math]::Round($image.Width * $scale))
  $height = [Math]::Max(1, [int][Math]::Round($image.Height * $scale))
  $bitmap = New-Object System.Drawing.Bitmap($width, $height)
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.Clear([System.Drawing.Color]::White)
      $graphics.DrawImage($image, 0, 0, $width, $height)
    } finally { $graphics.Dispose() }
    $bitmap.Save($destination, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  } finally { $bitmap.Dispose() }
} finally { $image.Dispose() }
`;

export async function makeWindowsPreview(
  source: string,
  destination: string,
  signal?: AbortSignal,
) {
  if (process.platform !== "win32")
    fail(
      "PREVIEW_PLATFORM_UNSUPPORTED",
      "Windows image conversion requires Windows.",
    );
  throwIfCancelled(signal);
  const encoded = Buffer.from(previewScript, "utf16le").toString("base64");
  const child = Bun.spawn(
    [
      windowsPowerShell(),
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encoded,
    ],
    {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: windowsPowerShellEnv({
        STILLPORT_PREVIEW_SOURCE: source,
        STILLPORT_PREVIEW_DESTINATION: destination,
      }),
    },
  );
  const cancel = () => child.kill();
  const timer = setTimeout(cancel, 60_000);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (signal?.aborted) throw cancelledError();
    if (code !== 0)
      fail(
        "PREVIEW_FAILED",
        "Windows could not make a JPEG preview from this Takeout item.",
        "Use export instead.",
        5,
      );
    return destination;
  } catch (error) {
    await rm(destination, { force: true }).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
