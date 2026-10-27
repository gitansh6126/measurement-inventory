# Lets phones / PCs on the shop Wi-Fi or LAN open the app. Needs Administrator
# (SETUP-FIRST-TIME.bat and START-SHOP.bat run it with a Windows "Yes" prompt).
#   powershell -ExecutionPolicy Bypass -File allow-network.ps1 [-Ask]
# 1. firewall rule "RS Inventory (LAN)": web ports from client.env / demo.env, PRIVATE networks only
#    (V2's own rule is left as it is, so both versions work during the test)
# 2. the connected network set to Private if Windows marked it Public (asks first with -Ask)
# 3. sleep while plugged in = Never, so the app stays online (asks first with -Ask)
# The API port is never opened; nothing is exposed to the internet.
param([switch]$Ask)
. "$PSScriptRoot\common.ps1"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Host "[!] Run this as Administrator." -ForegroundColor Red; exit 1 }
function Confirm-Step([string]$Question) {
  if (-not $Ask) { return $true }
  return (Read-Host "$Question (Y/n)") -notmatch '^[nN]'
}

try {
  $ports = @()
  foreach ($n in "client", "demo") {
    if (Test-Path (Get-EnvFile $n)) { $ports += (Read-EnvFile (Get-EnvFile $n)).WEB_PORT }
  }
  if (-not $ports) { throw "No client.env / demo.env yet. Run SETUP-FIRST-TIME.bat first." }
  Remove-NetFirewallRule -DisplayName $FirewallRule -ErrorAction SilentlyContinue
  # Rule of the old V3.1 ZIP install (same ports); this one replaces it.
  Remove-NetFirewallRule -DisplayName $LegacyFirewallRule -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName $FirewallRule -Direction Inbound -Protocol TCP -LocalPort $ports `
    -Profile Private -Action Allow | Out-Null
  Write-Host "[OK] Firewall: TCP $($ports -join ', ') allowed on Private networks." -ForegroundColor Green

  $public = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -eq "Public" }
  foreach ($p in $public) {
    if (Confirm-Step "Network '$($p.Name)' is Public, so phones cannot connect. Is it the SHOP network and should it be set to Private?") {
      Set-NetConnectionProfile -InterfaceIndex $p.InterfaceIndex -NetworkCategory Private
      Write-Host "[OK] '$($p.Name)' is now Private." -ForegroundColor Green
    } else { Write-Host "[!] '$($p.Name)' left Public: devices on it cannot open the app." -ForegroundColor Yellow }
  }

  if (Confirm-Step "Keep this PC awake while plugged in (sleep = Never)?") {
    powercfg /change standby-timeout-ac 0
    Write-Host "[OK] Sleep while plugged in: Never (the screen can still turn off)." -ForegroundColor Green
  }
} catch {
  Write-Host "[!] $($_.Exception.Message)" -ForegroundColor Red
  if ($Ask) { Read-Host "Press Enter to close" | Out-Null }
  exit 1
}
if ($Ask) { Start-Sleep -Seconds 3 }
exit 0
