# Windows

Stillport has native x64 and ARM64 executables. Takeout works with local extracted
archives; Google Photos uses interactive Picker with your OAuth Desktop client.
Apple Photos requires macOS.

## Install and verify

Download [install.ps1](../install.ps1), inspect it, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Version v0.2.0
```

The installer uses the OS architecture, checks SHA-256 and the executable's version,
and adds `%LOCALAPPDATA%\Programs\Stillport` to your user PATH. Restart the terminal.
It requires PowerShell and HTTPS access to GitHub, without administrator rights.
Internal photo and update operations prefer PowerShell 7 (`pwsh`) when installed,
then fall back to Windows PowerShell. This avoids running the older shell under
emulation on ARM64 computers that have native PowerShell 7.
`-InstallDir 'D:\Tools with spaces\Stillport'` chooses another destination;
`-NoPath` leaves PATH unchanged. An existing executable is retained as a uniquely
named `stillport.previous-*.exe` in the install directory.

```powershell
stillport --version
stillport doctor
stillport capabilities
$env:STILLPORT_BIN = (Get-Command stillport).Source
.\examples\takeout-demo\run.ps1 .\stillport-demo-output
```

The public demo uses a temporary index. No personal library is needed.

## Photos and privacy

```powershell
stillport takeout import 'D:\Photos\Google Photos'
stillport search 'café' --source takeout
stillport gallery --source takeout --query 'café' --out 'D:\Photo galleries'
```

Quote paths containing spaces. Stillport reads source photos and writes generated
outputs into fresh subfolders. Their protected ACL grants the current user and
SYSTEM access; existing output-parent permissions stay unchanged. State lives in
`%LOCALAPPDATA%\Stillport`, or `STILLPORT_HOME` when set. A pre-existing legacy
`~/.local/share/stillport` directory is retained so earlier state remains usable.
Google credentials use Windows Credential Manager through Bun's OS credential API.

JPEG, PNG, GIF, TIFF and BMP previews use Windows' system decoder and EXIF
orientation, with a maximum edge of 1600 pixels. WebP and AVIF previews are copied
unchanged. HEIC and RAW need a supported external viewer or macOS preview; export
still copies originals unchanged. Unsupported or missing previews become gallery
placeholders. HTML galleries work offline in a browser and can contain sensitive
captions and dates.

## Update and recover

`stillport update --check` inspects the current release. `stillport update` stages
and validates the release, then returns `pending: true`, `status`, and `rollback`.
The helper waits up to two minutes for that Stillport process to exit before
re-checking the checksum and replacing the executable. Read the returned status:

```powershell
Get-Content -LiteralPath 'PATH_FROM_STATUS'
stillport --version
```

`applied` confirms replacement. `failed: ...` describes a stopped update; keep the
status file for diagnosis. Close other running Stillport processes before updating.
To roll back, close Stillport, retain the newer executable if needed, and copy the
returned rollback path over the installed `stillport.exe`. Installation and updates
verify GitHub release hashes; the binaries are not Authenticode signed.

For moved archives, list `stillport takeout archives`, forget the unavailable
archive ID, and re-import the new folder. Forget changes only the local index.
