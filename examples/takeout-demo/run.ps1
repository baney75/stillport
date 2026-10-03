param([string]$Output = (Join-Path (Get-Location) 'stillport-demo-output'))
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$binary = if ($env:STILLPORT_BIN) { $env:STILLPORT_BIN } else { 'stillport.exe' }
$state = Join-Path ([IO.Path]::GetTempPath()) ('stillport-demo-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $state | Out-Null
$previousHome = $env:STILLPORT_HOME
try {
  $env:STILLPORT_HOME = $state
  $fixture = Join-Path $scriptDir 'Harbor'
  $import = & $binary takeout import $fixture --json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or -not $import.ok) { throw 'Fixture import failed.' }
  $search = & $binary search 'fictional harbor' --source takeout --limit 1 --json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or -not $search.ok -or $search.data.items.Count -ne 1) { throw 'Fixture search failed.' }
  $id = $search.data.items[0].id
  $preview = & $binary preview $id --source takeout --out $Output --json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or -not $preview.ok) { throw 'Fixture preview failed.' }
  $file = $preview.data.files[0]
  if (-not (Test-Path -LiteralPath $file)) { throw 'Preview file was not created.' }
  Add-Type -AssemblyName System.Drawing
  $image = [System.Drawing.Image]::FromFile($file)
  try {
    if ($image.Width -gt 1600 -or $image.Height -gt 1600) { throw 'Preview exceeds the 1600-pixel limit.' }
    [pscustomobject]@{ ok = $true; preview = $file; width = $image.Width; height = $image.Height } | ConvertTo-Json -Compress
  } finally { $image.Dispose() }
} finally {
  $env:STILLPORT_HOME = $previousHome
  Remove-Item -LiteralPath $state -Recurse -Force -ErrorAction SilentlyContinue
}
