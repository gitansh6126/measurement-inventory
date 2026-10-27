# Applies database migrations and builds the web app for one or both local environments.
# Run after setup and after every code update.
#   powershell -ExecutionPolicy Bypass -File build.ps1 -Env client|demo|all [-SkipMigrate]
param(
  [ValidateSet("client", "demo", "all")][string]$Env = "all",
  [switch]$SkipMigrate
)
. "$PSScriptRoot\common.ps1"

$names = if ($Env -eq "all") { @("client", "demo") } else { @($Env) }
$names = $names | Where-Object { Test-Path (Get-EnvFile $_) }
if (-not $names) { throw "No client.env or demo.env in $DataRoot. Run SETUP-FIRST-TIME.bat first." }

foreach ($n in $names) {
  $cfg = Read-EnvFile (Get-EnvFile $n)
  if ((Test-PortInUse ([int]$cfg.WEB_PORT)) -or (Test-PortInUse ([int]$cfg.PORT))) {
    throw "The $n server is running (port $($cfg.WEB_PORT) or $($cfg.PORT) in use). Run stop.ps1 -Env $n first."
  }
}

Start-Postgres
$prisma = Join-Path $AppRoot "node_modules\prisma\build\index.js"
$next = Join-Path $AppRoot "node_modules\next\dist\bin\next"

foreach ($n in $names) {
  $cfg = Read-EnvFile (Get-EnvFile $n)

  if (-not $SkipMigrate) {
    Write-Host "[*] [$n] Applying database migrations..."
    Push-Location $ApiDir
    try {
      $env:DATABASE_URL = $cfg.DATABASE_URL
      node $prisma migrate deploy
      if ($LASTEXITCODE -ne 0) { throw "[$n] prisma migrate deploy failed ($LASTEXITCODE)" }
    } finally { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue; Pop-Location }
  }

  Write-Host "[*] [$n] Building web app into $(Get-DistDir $n)..."
  Push-Location $WebDir
  try {
    $env:NEXT_DIST_DIR = Get-DistDir $n
    $env:API_INTERNAL_URL = "http://127.0.0.1:$($cfg.PORT)"
    $env:NEXT_TELEMETRY_DISABLED = "1"
    node $next build
    if ($LASTEXITCODE -ne 0) { throw "[$n] next build failed ($LASTEXITCODE)" }
  } finally {
    Remove-Item Env:NEXT_DIST_DIR, Env:API_INTERNAL_URL -ErrorAction SilentlyContinue
    Pop-Location
  }
  Write-Host "[OK] [$n] ready. Start it with start.ps1 -Env $n" -ForegroundColor Green
}
