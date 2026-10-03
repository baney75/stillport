# Installs a checksum-verified native Windows release for the current user.
[CmdletBinding()]
param(
  [string]$Version = $env:STILLPORT_VERSION,
  [string]$InstallDir = $env:STILLPORT_INSTALL_DIR,
  [string]$ReleaseBaseUri = '',
  [switch]$NoPath
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $Version) { $Version = 'latest' }
if ($Version -ne 'latest' -and $Version -cnotmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') { throw 'Version must be latest or vX.Y.Z.' }
if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\Stillport' }
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$arch = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
if ($arch -eq 'x64') { $arch = 'x64' }
elseif ($arch -eq 'arm64') { $arch = 'arm64' }
else { throw 'Stillport releases support Windows x64 and ARM64.' }
$asset = "stillport-windows-$arch.exe"
if (-not $ReleaseBaseUri) {
  if ($Version -eq 'latest') { $ReleaseBaseUri = 'https://github.com/baney75/stillport/releases/latest/download' }
  else { $ReleaseBaseUri = "https://github.com/baney75/stillport/releases/download/$Version" }
}
$uri = [Uri]$ReleaseBaseUri
if ($uri.Scheme -ne 'https' -and -not ($uri.Scheme -eq 'http' -and $uri.Host -in @('localhost','127.0.0.1','[::1]'))) {
  throw 'ReleaseBaseUri must use HTTPS (or localhost for a local fixture).'
}
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
if ((Get-Item -LiteralPath $InstallDir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Install directory cannot be a link.' }
$staging = Join-Path $InstallDir ('.stillport-install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null
$installed = Join-Path $InstallDir 'stillport.exe'
$backup = Join-Path $InstallDir ('stillport.previous-' + [guid]::NewGuid().ToString('N') + '.exe')
$movedOld = $false
try {
  $download = Join-Path $staging $asset
  $manifest = Join-Path $staging 'SHA256SUMS'
  Invoke-WebRequest -UseBasicParsing -TimeoutSec 180 -Uri ($ReleaseBaseUri.TrimEnd('/') + '/' + $asset) -OutFile $download
  Invoke-WebRequest -UseBasicParsing -TimeoutSec 180 -Uri ($ReleaseBaseUri.TrimEnd('/') + '/SHA256SUMS') -OutFile $manifest
  $matches = @([IO.File]::ReadAllLines($manifest) | ForEach-Object {
    if ($_ -cmatch '^([a-f0-9]{64})\s+\*?(.+?)\s*$' -and $Matches[2] -ceq $asset) { $Matches[1] }
  })
  if ($matches.Count -ne 1) { throw 'Missing or ambiguous release checksum.' }
  $actual = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -cne $matches[0]) { throw 'Checksum mismatch. Existing installation is unchanged.' }
  $reported = (& $download --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $reported -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { throw 'Downloaded binary failed version validation.' }
  if ($Version -ne 'latest' -and "v$reported" -cne $Version) { throw 'Downloaded binary reports a different version.' }
  if (Test-Path -LiteralPath $installed) {
    if ((Get-Item -LiteralPath $installed -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Installed executable cannot be a link.' }
    Move-Item -LiteralPath $installed -Destination $backup
    $movedOld = $true
  }
  try { Move-Item -LiteralPath $download -Destination $installed }
  catch {
    if ($movedOld) { Move-Item -LiteralPath $backup -Destination $installed }
    throw
  }
  if (-not $NoPath) {
    $userPath = [Environment]::GetEnvironmentVariable('Path','User')
    $entries = @($userPath -split ';' | Where-Object { $_ })
    if (-not ($entries | Where-Object { $_.TrimEnd('\') -ieq $InstallDir.TrimEnd('\') })) {
      [Environment]::SetEnvironmentVariable('Path', (($entries + $InstallDir) -join ';'), 'User')
    }
  }
  Write-Output "Stillport $reported installed at $installed"
  Write-Output 'Open a new terminal, then run: stillport doctor'
} finally {
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
