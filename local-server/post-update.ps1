# Run by update.ps1 after a successful update, with the NEW release's code (update.ps1 itself
# is still the old release's copy while it runs). Safe to run again; failures only warn.
# 3.1.2: releases before it restarted only the real company after an update; the Start Shop
# shortcut now runs the demo company too, so start it here when it is not running yet.
param([string]$From, [string]$To)
. "$PSScriptRoot\common.ps1"

if (Test-Path (Get-EnvFile "demo")) {
  $global:LASTEXITCODE = 0
  & "$PSScriptRoot\start.ps1" -Env demo -Prod -NoBrowser
  if ($LASTEXITCODE -ne 0) { Write-Host "[!] The demo company did not start; use the Start Shop shortcut later." -ForegroundColor Yellow }
}
