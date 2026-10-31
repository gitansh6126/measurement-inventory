# Registers Windows scheduled tasks for the local server (current Windows user):
#   "RS Inventory - Backup"        every day at -BackupTime (runs at next start-up if the PC was off)
#   "RS Inventory - Restore test"  every Sunday at 13:00 (same catch-up rule)
#   "RS Inventory - Watchdog"      every 5 minutes, also when nobody is signed in: restarts an
#                             environment that was running and stopped answering (crash, PC
#                             restart). Leaves alone what STOP.bat stopped. See watchdog.ps1.
#   "RS Inventory - Start"         at log-on, only with -StartAtLogon (go-live: V2 keeps its own
#                             auto-start during the production test; remove it with V2's
#                             install-autostart.ps1 -Remove when V3.1 takes over)
#   powershell -ExecutionPolicy Bypass -File install-autostart.ps1 [-BackupTime 20:45] [-StartAtLogon] [-WithDemo] [-NoWatchdog]
#   powershell -ExecutionPolicy Bypass -File install-autostart.ps1 -Remove
param(
  [string]$BackupTime = "20:45",
  [switch]$StartAtLogon,
  [switch]$WithDemo,
  [switch]$NoWatchdog,
  [switch]$Remove
)
. "$PSScriptRoot\common.ps1"

$tasks = "$TaskPrefix - Start", "$TaskPrefix - Start demo", "$TaskPrefix - Backup", "$TaskPrefix - Restore test", "$TaskPrefix - Watchdog"
# Tasks of the old V3.1 ZIP install point at its folder; always removed (this install replaces them).
foreach ($t in $tasks) { Unregister-ScheduledTask -TaskName ($t.Replace($TaskPrefix, $LegacyTaskPrefix)) -Confirm:$false -ErrorAction SilentlyContinue }
if ($Remove) {
  foreach ($t in $tasks) { Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue }
  Write-Host "[OK] Removed the $TaskPrefix scheduled tasks." -ForegroundColor Green
  exit 0
}

function Get-Action([string]$Script, [string]$ScriptArgs) {
  New-ScheduledTaskAction -Execute "powershell.exe" -WorkingDirectory $LocalServer `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $LocalServer $Script)`" $ScriptArgs"
}
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$user = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive

if ($StartAtLogon) {
  Register-ScheduledTask -Force -TaskName "$TaskPrefix - Start" -Action (Get-Action "start.ps1" "-Env client -Prod -NoBrowser") `
    -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $user) -Settings $settings -Principal $principal | Out-Null
}
if ($WithDemo) {
  Register-ScheduledTask -Force -TaskName "$TaskPrefix - Start demo" -Action (Get-Action "start.ps1" "-Env demo -Prod -NoBrowser") `
    -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $user) -Settings $settings -Principal $principal | Out-Null
}
Register-ScheduledTask -Force -TaskName "$TaskPrefix - Backup" -Action (Get-Action "backup.ps1" "-Env client") `
  -Trigger (New-ScheduledTaskTrigger -Daily -At $BackupTime) -Settings $settings -Principal $principal | Out-Null
Register-ScheduledTask -Force -TaskName "$TaskPrefix - Restore test" -Action (Get-Action "restore-test.ps1" "-Env client") `
  -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "13:00") -Settings $settings -Principal $principal | Out-Null

$watchdogNote = ""
if ($NoWatchdog) {
  Unregister-ScheduledTask -TaskName "$TaskPrefix - Watchdog" -Confirm:$false -ErrorAction SilentlyContinue
} else {
  # Repeats every 5 minutes for ever (no end date), so it also runs after a restart.
  $wdTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
  $wdSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 45)
  try {
    # S4U: runs whether or not this user is signed in, without storing a password. Needs an
    # Administrator window (SETUP-FIRST-TIME.bat / allow-network.ps1 ask for one).
    $s4u = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
    Register-ScheduledTask -Force -TaskName "$TaskPrefix - Watchdog" -Action (Get-Action "watchdog.ps1" "") `
      -Trigger $wdTrigger -Settings $wdSettings -Principal $s4u -ErrorAction Stop | Out-Null
    $watchdogNote = ", watchdog every 5 min (also without sign-in)"
  } catch {
    Register-ScheduledTask -Force -TaskName "$TaskPrefix - Watchdog" -Action (Get-Action "watchdog.ps1" "") `
      -Trigger $wdTrigger -Settings $wdSettings -Principal $principal | Out-Null
    $watchdogNote = ", watchdog every 5 min while $user is signed in"
    Write-Host "[!] Watchdog runs only while $user is signed in. To keep the app up after a restart without anyone signing in, run this again in an Administrator PowerShell." -ForegroundColor Yellow
  }
}
Write-Host "[OK] Scheduled tasks registered for $user (backup $BackupTime$(if ($StartAtLogon) { ', start at sign-in' })$watchdogNote)." -ForegroundColor Green
