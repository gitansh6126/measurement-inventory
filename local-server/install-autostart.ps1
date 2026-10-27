# Registers Windows scheduled tasks for the local server (current Windows user):
#   "RS Inventory - Backup"        every day at -BackupTime (runs at next start-up if the PC was off)
#   "RS Inventory - Restore test"  every Sunday at 13:00 (same catch-up rule)
#   "RS Inventory - Start"         at log-on, only with -StartAtLogon (go-live: V2 keeps its own
#                             auto-start during the production test; remove it with V2's
#                             install-autostart.ps1 -Remove when V3.1 takes over)
#   powershell -ExecutionPolicy Bypass -File install-autostart.ps1 [-BackupTime 20:45] [-StartAtLogon] [-WithDemo]
#   powershell -ExecutionPolicy Bypass -File install-autostart.ps1 -Remove
param(
  [string]$BackupTime = "20:45",
  [switch]$StartAtLogon,
  [switch]$WithDemo,
  [switch]$Remove
)
. "$PSScriptRoot\common.ps1"

$tasks = "$TaskPrefix - Start", "$TaskPrefix - Start demo", "$TaskPrefix - Backup", "$TaskPrefix - Restore test"
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
Write-Host "[OK] Scheduled tasks registered for $user (backup $BackupTime$(if ($StartAtLogon) { ', start at sign-in' }))." -ForegroundColor Green
