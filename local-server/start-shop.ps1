# ONE-CLICK "go live on the shop network" (START-SHOP.bat / START-DEMO.bat).
# Makes sure phones / PCs can reach this PC (firewall rule + Private network; one Windows
# "Yes" prompt only when something is missing), starts the built app and shows the addresses
# to open on other devices. The servers keep running after this window closes.
#   powershell -ExecutionPolicy Bypass -File start-shop.ps1 [-Env client|demo]
param([ValidateSet("client", "demo")][string]$Env = "client")
. "$PSScriptRoot\common.ps1"

if (-not (Test-Path (Get-EnvFile $Env))) {
  Write-Host "[!] Not installed yet: run SETUP-FIRST-TIME.bat first (see README.md)." -ForegroundColor Red
  exit 1
}

$port = [int](Read-EnvFile (Get-EnvFile $Env)).WEB_PORT
$rule = Get-NetFirewallRule -DisplayName $FirewallRule -ErrorAction SilentlyContinue
$ruleOk = $false
if ($rule -and $rule.Enabled -eq "True") {
  $ruleOk = [bool]($rule | Get-NetFirewallPortFilter | Where-Object { "$port" -in @($_.LocalPort) })
}
$public = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -eq "Public" })
if (-not $ruleOk -or $public.Count -gt 0) {
  Write-Host "[*] Opening the shop network for phones / PCs - click 'Yes' on the Windows prompt..."
  try {
    Start-Process powershell -Verb RunAs -Wait `
      -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\allow-network.ps1`" -Ask" | Out-Null
  } catch { Write-Host "[!] Skipped: other devices may not reach this PC (only this PC will work)." -ForegroundColor Yellow }
}

$global:LASTEXITCODE = 0
# -Prod: the shop always runs the fast built app (builds once if there is no build yet).
& "$PSScriptRoot\start.ps1" -Env $Env -Prod
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$lan = @(Get-LanAddresses)
$label = if ($Env -eq "demo") { "$AppTitle DEMO (training data)" } else { $AppTitle }
$lines = @("$label - open on phones / PCs on the shop Wi-Fi", "")
$lines += $lan | ForEach-Object { "  http://${_}:$port" }
$lines += "  http://$($env:COMPUTERNAME.ToLower()):$port", "", "Updated $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
$lines | Set-Content -Encoding utf8 (Join-Path $RunDir "$Env-shop-address.txt")
Write-Host "  Same addresses saved in $(Join-Path $RunDir "$Env-shop-address.txt")"
Write-Host "  If a phone cannot connect: same Wi-Fi? Then see README.md, 'Problems'."
