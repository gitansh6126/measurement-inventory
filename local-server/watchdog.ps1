# Keeps the app running (scheduled task "RS Inventory - Watchdog", every 5 minutes, also when
# nobody is signed in to Windows; see install-autostart.ps1).
#   powershell -ExecutionPolicy Bypass -File watchdog.ps1 [-MinFreeGB 5]
#
# An environment is watched while start.ps1 has started it and STOP.bat / update.ps1 has not
# stopped it (its run\<env>.json exists). When http://127.0.0.1:<WEB_PORT>/api/version does not
# answer three times in a row, it is restarted in the same mode: after a crash, and after the PC
# restarted (Windows Update, power cut). STOP.bat removes run\<env>.json, so a stopped app stays
# stopped. While update.ps1 runs (run\maintenance.txt) nothing is touched.
#
# Also, for the real company: pings MONITOR_PING_URL while it answers and the disk has room
# (<url>/fail otherwise), and deletes logs older than LOG_KEEP_DAYS.
param([int]$MinFreeGB = 5)
. "$PSScriptRoot\common.ps1"

New-Item -ItemType Directory -Force $RunDir, $LogDir | Out-Null
$logFile = Join-Path $LogDir "watchdog-$(Get-Date -Format 'yyyyMM').log"
# Only events are logged (a restart, a failure), not every healthy check.
function Log([string]$Text) {
  "$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) $Text" | Add-Content -Encoding utf8 $logFile
  Write-Host "[watchdog] $Text"
}

function Test-AppUp([int]$Port) {
  for ($i = 0; $i -lt 3; $i++) {
    if ($i) { Start-Sleep -Seconds 20 }
    try { if (Invoke-RestMethod "http://127.0.0.1:$Port/api/version" -TimeoutSec 15) { return $true } } catch { }
  }
  return $false
}

if ((Test-Path $MaintenanceFile) -and (Get-Item $MaintenanceFile).LastWriteTime -gt (Get-Date).AddHours(-3)) {
  Write-Host "[watchdog] update in progress ($MaintenanceFile); nothing checked."
  exit 0
}

$keepDays = 30
foreach ($n in "client", "demo") {
  $envFile = Get-EnvFile $n
  if (-not (Test-Path $envFile)) { continue }
  try { $cfg = Read-EnvFile $envFile } catch { Log "[$n] $($_.Exception.Message)"; continue }
  if ($n -eq "client" -and $cfg.LOG_KEEP_DAYS) { $keepDays = [int]$cfg.LOG_KEEP_DAYS }
  $ping = if ($n -eq "client") { $cfg.MONITOR_PING_URL } else { $null }

  $runFile = Join-Path $RunDir "$n.json"
  if (-not (Test-Path $runFile)) {
    # Stopped on purpose or never started: not watched. The missing heartbeat tells the monitor.
    continue
  }
  $run = $null
  $runRaw = Get-Content $runFile -Raw
  try { $run = $runRaw | ConvertFrom-Json } catch { }
  # start.ps1 writes the run file before the app is ready; leave a fresh start alone.
  if ($run -and $run.started) {
    try { if ([datetime]$run.started -gt (Get-Date).AddMinutes(-5)) { continue } } catch { }
  }

  $port = [int]$cfg.WEB_PORT
  $up = Test-AppUp $port
  $note = "answering"
  if (-not $up) {
    $modeArg = if ($run -and $run.mode -eq "dev") { "-Dev" } else { "-Prod" }
    Log "[$n] not answering on port $port; restarting ($modeArg)"
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $LocalServer "start.ps1") -Env $n $modeArg -NoBrowser 2>&1
    $code = $LASTEXITCODE
    $out | ForEach-Object { "    $_" } | Add-Content -Encoding utf8 $logFile
    $up = Test-AppUp $port
    if ($up) { Log "[$n] restarted OK"; $note = "restarted by the watchdog" }
    else {
      Log "[$n] RESTART FAILED (start.ps1 exit $code); see $LogDir\$n-*.err.log. Trying again in 5 minutes."
      # start.ps1 cleans up after a failed start (run file gone); put it back so the next run
      # tries again (e.g. PostgreSQL still starting after a reboot).
      if (-not (Test-Path $runFile)) { $runRaw | Set-Content -Encoding utf8 $runFile }
    }
  }

  if ($ping) {
    $free = Get-DataDriveFreeGB
    $disk = if ($null -ne $free) { "$free GB free" } else { "disk space unknown" }
    if (-not $up) { Send-Ping $ping -Fail -Body "$AppTitle $AppVersion on $env:COMPUTERNAME is DOWN: restart failed ($disk)" }
    elseif ($null -ne $free -and $free -lt $MinFreeGB) { Send-Ping $ping -Fail -Body "$AppTitle on $env:COMPUTERNAME: only $disk on the data drive" }
    else { Send-Ping $ping -Body "$AppTitle $AppVersion on $env:COMPUTERNAME $note ($disk)" }
  }
}

Remove-OldLogs $keepDays
exit 0
