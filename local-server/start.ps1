# Starts one V3 environment on this PC: API (127.0.0.1 only) + web app (LAN by default).
#   powershell -ExecutionPolicy Bypass -File start.ps1 -Env demo [-Dev | -Prod] [-LocalOnly] [-NoBrowser]
#   -Dev   hot reload (code changes show at once; slower pages)
#   -Prod  the built app (fast); builds first when there is no build yet
#   neither: the build if one exists, else dev
# Starting in a different mode than the one running restarts it in the asked mode.
param(
  [ValidateSet("client", "demo")][string]$Env = "demo",
  [switch]$LocalOnly,
  [switch]$NoBrowser,
  [switch]$Prod,
  [switch]$Dev
)
. "$PSScriptRoot\common.ps1"

$envFile = Get-EnvFile $Env
$cfg = Read-EnvFile $envFile
$webPort = [int]$cfg.WEB_PORT
$apiPort = [int]$cfg.PORT
$distDir = Get-DistDir $Env
$local = "http://localhost:$webPort"

$wantMode = if ($Dev) { "dev" } elseif ($Prod) { "start" } else { $null }
$modeName = @{ dev = "Dev mode (hot reload)"; start = "Built (fast)" }
if (Test-PortInUse $webPort -or (Test-PortInUse $apiPort)) {
  $runFile = Join-Path $RunDir "$Env.json"
  $runMode = $null
  if (Test-Path $runFile) { try { $runMode = (Get-Content $runFile -Raw | ConvertFrom-Json).mode } catch { } }

  $isHealthy = (Test-PortInUse $webPort) -and (Test-PortInUse $apiPort)
  if ($isHealthy) {
    try {
      $check = Invoke-RestMethod "http://127.0.0.1:$webPort/api/version" -TimeoutSec 2
      if (-not $check) { $isHealthy = $false }
    } catch {
      $isHealthy = $false
    }
  }

  $stale = $wantMode -eq "start" -and $runMode -eq "start" -and (Test-BuildStale $Env)
  $modeMatches = -not $wantMode -or ($runMode -eq $wantMode)

  if ($isHealthy -and $modeMatches -and -not $stale) {
    Write-Host "[*] $Env is already running on port $webPort ($($modeName[$runMode]))."
    if (-not $NoBrowser) { Start-Process $local }
    exit 0
  }

  if ($stale) { Write-Host "[*] $Env is running an old build; restarting with the latest code..." }
  elseif ($wantMode -and $runMode -ne $wantMode) {
    $was = if ($runMode) { $modeName[$runMode] } else { "another mode" }
    Write-Host "[*] Switching $Env from $was to $($modeName[$wantMode])..."
  } else {
    Write-Host "[*] Port in use or unready process found; restarting $Env..."
  }

  & "$PSScriptRoot\stop.ps1" -Env $Env
  for ($i = 0; $i -lt 15 -and ((Test-PortInUse $webPort) -or (Test-PortInUse $apiPort)); $i++) { Start-Sleep -Seconds 1 }

  foreach ($p in @($webPort, $apiPort)) {
    if (Test-PortInUse $p) {
      Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { taskkill /T /F /PID $_.OwningProcess 2>$null | Out-Null }
    }
  }
}

# Built mode needs a build that is not older than the code: made the first time and after every
# code change (a few minutes), so the built app never shows old pages.
if ($Prod -and (Test-BuildStale $Env)) {
  if (Test-Path (Join-Path $WebDir "$distDir\BUILD_ID")) { Write-Host "[*] The code changed after the last build of $Env - rebuilding (a few minutes)..." }
  else { Write-Host "[*] No build of $Env yet - building it first (a few minutes)..." }
  & "$PSScriptRoot\build.ps1" -Env $Env
  if (Test-BuildStale $Env) { throw "Build of $Env failed; see the messages above." }
}

Start-Postgres
New-Item -ItemType Directory -Force $RunDir, $LogDir | Out-Null
if ($cfg.STORAGE_ROOT) { New-Item -ItemType Directory -Force $cfg.STORAGE_ROOT | Out-Null }

Write-Host "[*] Ensuring database migrations are up to date for $Env..."
$prisma = Join-Path $AppRoot "node_modules\prisma\build\index.js"
Push-Location $ApiDir
try {
  $env:DATABASE_URL = $cfg.DATABASE_URL
  node $prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw "[$Env] prisma migrate deploy failed ($LASTEXITCODE)" }
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Pop-Location
}

# Addresses the browser may use: this PC, its LAN IPs and its computer name.
$lan = @(if (-not $LocalOnly) { Get-LanAddresses })
$origins = @("http://localhost:$webPort", "http://127.0.0.1:$webPort")
if (-not $LocalOnly) {
  $origins += $lan | ForEach-Object { "http://${_}:$webPort" }
  $origins += "http://$($env:COMPUTERNAME.ToLower()):$webPort"
}
# Extra origins from the caller, e.g. the internet tunnel URL (START-NETWORK-DEV.ps1).
if ($env:EXTRA_ALLOWED_ORIGINS) {
  $origins += $env:EXTRA_ALLOWED_ORIGINS -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}
$env:ALLOWED_ORIGINS = ($origins | Select-Object -Unique) -join ","

$nextMode = if ($Dev) { "dev" } elseif ($Prod) { "start" } elseif (Test-Path (Join-Path $WebDir "$distDir\BUILD_ID")) { "start" } else { "dev" }
$env:NODE_ENV = if ($nextMode -eq "dev") { "development" } else { "production" }
$env:NEXT_TELEMETRY_DISABLED = "1"
# The version shown in the app is the release this folder is on (node --env-file never overrides
# a variable that is already set, so this wins over RELEASE_VERSION in the env file).
if ($AppVersion -ne "dev") { $env:RELEASE_VERSION = $AppVersion }
# Nightly backup / weekly restore test results, shown on the Backup page and the dashboard.
$env:BACKUP_STATUS_FILE = Join-Path $RunDir "$Env-backup-status.txt"
$env:RESTORE_TEST_STATUS_FILE = Join-Path $RunDir "$Env-restore-test-status.txt"

$gitInfo = Get-GitMetadata
if ($gitInfo) {
  if ($gitInfo.Commit) { $env:GIT_COMMIT = $gitInfo.Commit }
  if ($gitInfo.Branch) { $env:GIT_BRANCH = $gitInfo.Branch }
  if ($gitInfo.Tag) { $env:GIT_TAG = $gitInfo.Tag }
  $env:GIT_DIRTY = if ($gitInfo.IsDirty) { "true" } else { "false" }
  if ($gitInfo.Url) { $env:GIT_URL = $gitInfo.Url }
}

$tsx = Join-Path $AppRoot "node_modules\tsx\dist\cli.mjs"
$next = Join-Path $AppRoot "node_modules\next\dist\bin\next"
$stamp = Get-Date -Format "yyyyMMdd"

Write-Host "[*] Starting $Env API on 127.0.0.1:$apiPort..."
$apiArgList = if ($nextMode -eq "dev") {
  "--env-file=`"$envFile`" `"$tsx`" watch src/server.ts"
} else {
  "--env-file=`"$envFile`" `"$tsx`" src/server.ts"
}
$api = Start-Process node -PassThru -WindowStyle Hidden -WorkingDirectory $ApiDir `
  -ArgumentList $apiArgList `
  -RedirectStandardOutput (Join-Path $LogDir "$Env-api-$stamp.log") -RedirectStandardError (Join-Path $LogDir "$Env-api-$stamp.err.log")

Write-Host "[*] Waiting for $Env API to be ready..."
$apiVersion = $null
for ($i = 0; $i -lt 30 -and -not $apiVersion; $i++) {
  Start-Sleep -Seconds 1
  try { $apiVersion = Invoke-RestMethod "http://127.0.0.1:$apiPort/api/version" -TimeoutSec 2 } catch { }
  if ($apiVersion) { break }
  if ($api.HasExited) { break }
}
if (-not $apiVersion) {
  Write-Host "[!] $Env API failed to start on port $apiPort. Last API log lines:" -ForegroundColor Red
  $apiErrLog = Join-Path $LogDir "$Env-api-$stamp.err.log"
  if (Test-Path $apiErrLog) { Get-Content $apiErrLog -Tail 15 }
  & "$PSScriptRoot\stop.ps1" -Env $Env
  exit 1
}

$bind = if ($LocalOnly) { "127.0.0.1" } else { "0.0.0.0" }
# Dev mode gets its own folder: `next dev` in the build folder would wipe the build.
$env:NEXT_DIST_DIR = if ($nextMode -eq "dev") { "$distDir-dev" } else { $distDir }
$env:API_INTERNAL_URL = "http://127.0.0.1:$apiPort"
Write-Host "[*] Starting $Env web app ($nextMode) on ${bind}:$webPort..."
$web = Start-Process node -PassThru -WindowStyle Hidden -WorkingDirectory $WebDir `
  -ArgumentList "`"$next`" $nextMode -p $webPort -H $bind" `
  -RedirectStandardOutput (Join-Path $LogDir "$Env-web-$stamp.log") -RedirectStandardError (Join-Path $LogDir "$Env-web-$stamp.err.log")

@{ api = $api.Id; web = $web.Id; mode = $nextMode; started = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $RunDir "$Env.json")

# Wait until the API answers through the web app (proves the /api route proxying too).
Write-Host "[*] Waiting for $Env web app to be ready..."
$version = $null
$probeTimeout = if ($nextMode -eq "dev") { 10 } else { 4 }
for ($i = 0; $i -lt 35 -and -not $version; $i++) {
  Start-Sleep -Seconds 2
  try { $version = Invoke-RestMethod "http://127.0.0.1:$webPort/api/version" -TimeoutSec $probeTimeout } catch { }
  if ($version) { break }
  if ($web.HasExited) { break }
}
if (-not $version) {
  Write-Host "[!] $Env web app did not start on port $webPort. Last web log lines:" -ForegroundColor Red
  $webErrLog = Join-Path $LogDir "$Env-web-$stamp.err.log"
  if (Test-Path $webErrLog) { Get-Content $webErrLog -Tail 15 }
  & "$PSScriptRoot\stop.ps1" -Env $Env
  exit 1
}

# Update PID file with real listening PIDs
$apiPid = (Get-NetTCPConnection -LocalPort $apiPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)
if (-not $apiPid) { $apiPid = $api.Id }
$webPid = (Get-NetTCPConnection -LocalPort $webPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)
if (-not $webPid) { $webPid = $web.Id }
@{ api = $apiPid; web = $webPid; mode = $nextMode; started = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $RunDir "$Env.json")

Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Green
Write-Host "  $($AppTitle.ToUpper()) $AppVersion ($($version.environment)) IS RUNNING" -ForegroundColor Green
Write-Host "=====================================================================" -ForegroundColor Green
Write-Host "  Mode:           $($modeName[$nextMode])"
if ($gitInfo -and $gitInfo.Commit) {
  $gitDesc = "$($gitInfo.Branch)@$($gitInfo.Commit)"
  if ($gitInfo.IsDirty) { $gitDesc += " (locally modified)" }
  Write-Host "  Git / GitHub:   $gitDesc ($($gitInfo.Url))"
}
Write-Host "  This PC:        $local"
if (-not $LocalOnly) {
  foreach ($ip in $lan) { Write-Host "  Phones / PCs:   http://${ip}:$webPort" }
  Write-Host "  By name:        http://$($env:COMPUTERNAME.ToLower()):$webPort"
}
Write-Host "  Database:       $(([Uri](Get-PgUrl $cfg.DATABASE_URL)).AbsolutePath.TrimStart('/')) (local PostgreSQL)"
Write-Host "  Logs:           $LogDir"
Write-Host "  Stop:           STOP.bat (keeps running after this window closes)"
Write-Host ""
if (-not $NoBrowser) { Start-Process $local }
