# ONE-CLICK "go live on the shop network" (START-SHOP.bat, the desktop "Start Shop" shortcut
# and the Windows Startup shortcut). Starts the real company AND the demo company, so the
# "Switch to Demo company" button inside the app always works.
# Makes sure phones / PCs can reach this PC (firewall rule + Private network; one Windows
# "Yes" prompt only when something is missing), starts the built app and shows the addresses
# to open on other devices. The servers keep running after this window closes.
#   powershell -ExecutionPolicy Bypass -File start-shop.ps1 [-Env all|client|demo] [-AutoStart]
#   -AutoStart  run at Windows sign-in: no Windows prompt, no browser, never waits for a key
param(
  [ValidateSet("all", "client", "demo")][string]$Env = "all",
  [switch]$AutoStart
)
. "$PSScriptRoot\common.ps1"

$names = @(if ($Env -eq "all") { "client", "demo" } else { $Env }) | Where-Object { Test-Path (Get-EnvFile $_) }
if (-not $names) {
  Write-Host "[!] Not installed yet: run SETUP-FIRST-TIME.bat first (see README.md)." -ForegroundColor Red
  exit 1
}

$ports = @($names | ForEach-Object { [int](Read-EnvFile (Get-EnvFile $_)).WEB_PORT })
$rule = Get-NetFirewallRule -DisplayName $FirewallRule -ErrorAction SilentlyContinue
$ruleOk = $false
if ($rule -and $rule.Enabled -eq "True") {
  $open = @($rule | Get-NetFirewallPortFilter | ForEach-Object { @($_.LocalPort) })
  $ruleOk = -not ($ports | Where-Object { "$_" -notin $open })
}
$public = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -eq "Public" })
if (-not $ruleOk -or $public.Count -gt 0) {
  if ($AutoStart) {
    Write-Host "[!] Phones may not reach this PC (firewall / Public network). Open 'Start Shop' on the desktop once and click 'Yes'." -ForegroundColor Yellow
  } else {
    Write-Host "[*] Opening the shop network for phones / PCs - click 'Yes' on the Windows prompt..."
    try {
      Start-Process powershell -Verb RunAs -Wait `
        -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\allow-network.ps1`" -Ask" | Out-Null
    } catch { Write-Host "[!] Skipped: other devices may not reach this PC (only this PC will work)." -ForegroundColor Yellow }
  }
}

$lan = @(Get-LanAddresses)
$lines = @("$AppTitle - open on phones / PCs on the shop Wi-Fi", "")
$failed = @()
foreach ($n in $names) {
  $global:LASTEXITCODE = 0
  # -Prod: the shop always runs the fast built app (builds once if there is no build yet).
  # The browser opens only for the real company (or the demo when it is the only one started).
  $quiet = $AutoStart -or ($n -eq "demo" -and "client" -in $names)
  if ($quiet) { & "$PSScriptRoot\start.ps1" -Env $n -Prod -NoBrowser } else { & "$PSScriptRoot\start.ps1" -Env $n -Prod }
  if ($LASTEXITCODE -ne 0) { $failed += $n; continue }
  $port = [int](Read-EnvFile (Get-EnvFile $n)).WEB_PORT
  $lines += if ($n -eq "demo") { "Demo company (training data):" } else { "Real company:" }
  $lines += $lan | ForEach-Object { "  http://${_}:$port" }
  $lines += "  http://$($env:COMPUTERNAME.ToLower()):$port", ""
}
$lines += "Updated $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
$addressFile = Join-Path $RunDir "shop-address.txt"
New-Item -ItemType Directory -Force $RunDir | Out-Null
$lines | Set-Content -Encoding utf8 $addressFile

Write-Host ""
$lines | Select-Object -SkipLast 1 | ForEach-Object { Write-Host $_ }
Write-Host "  Same addresses saved in $addressFile"
Write-Host "  If a phone cannot connect: same Wi-Fi? Then see README.md, 'Problems'."
if ($failed) {
  Write-Host "[!] Did not start: $($failed -join ', '). The last log lines are above; logs: $LogDir" -ForegroundColor Red
  if ("client" -in $failed) { exit 1 }
}
exit 0
