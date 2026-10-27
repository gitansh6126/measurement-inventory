# Starts V3.1 in DEV mode (code changes reload live) for other devices:
#   - LAN:      phones / PCs on the same Wi-Fi open http://<this PC's IP>:3510
#   - Internet: a free Cloudflare quick tunnel gives a public https://….trycloudflare.com link
#
#   powershell -ExecutionPolicy Bypass -File START-NETWORK-DEV.ps1 [-Env demo] [-NoInternet] [-NoBrowser]
#
# The API stays on 127.0.0.1; only the web app (which forwards /api) is reachable. The tunnel
# link changes every start and works only while this PC and the tunnel are running.
# Anyone with the internet link can reach the sign-in page: use it for demo / testing only.
# Stop everything (app + tunnel): STOP.bat or stop.ps1.
param(
  [ValidateSet("client", "demo")][string]$Env = "demo",
  [switch]$NoInternet,
  [switch]$NoBrowser
)
. "$PSScriptRoot\common.ps1"

$cfg = Read-EnvFile (Get-EnvFile $Env)
$webPort = [int]$cfg.WEB_PORT
New-Item -ItemType Directory -Force $RunDir, $LogDir | Out-Null

function Ask([string]$Question) {
  $a = Read-Host "$Question [Y/N]"
  return $a -match '^(y|yes)$'
}

# 1. Stop a running copy: allowed origins and dev hosts are fixed at start.
if (Test-PortInUse $webPort) {
  Write-Host "[*] V3.1 $Env is already running - restarting it with network access..."
  & "$PSScriptRoot\stop.ps1" -Env $Env
}

# 2. Windows Firewall: LAN devices need an inbound rule for the web port (Private networks only).
$ruleName = "RS Inventory V3.1 web $webPort"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($isAdmin -and (Ask "Allow port $webPort through Windows Firewall for Private (home/office) networks?")) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $webPort -Action Allow -Profile Private | Out-Null
    Write-Host "[OK] Firewall rule '$ruleName' added." -ForegroundColor Green
  } elseif (-not $isAdmin) {
    Write-Host "[!] Phones on Wi-Fi may be blocked by Windows Firewall. To allow them once, run this in an" -ForegroundColor Yellow
    Write-Host "    Administrator PowerShell (the internet link below works without it):" -ForegroundColor Yellow
    Write-Host "    New-NetFirewallRule -DisplayName `"$ruleName`" -Direction Inbound -Protocol TCP -LocalPort $webPort -Action Allow -Profile Private"
  }
}

# 3. Internet tunnel (cloudflared quick tunnel, no account needed).
$publicUrl = $null
if (-not $NoInternet) {
  $cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
  if (-not $cf) {
    foreach ($p in @("$env:ProgramFiles\cloudflared\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe")) {
      if ($p -and (Test-Path $p)) { $cf = $p; break }
    }
  }
  if (-not $cf -and (Ask "Internet access needs Cloudflare's 'cloudflared' tool (free, from winget). Install it now?")) {
    winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    $cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
    if (-not $cf -and (Test-Path "$env:ProgramFiles\cloudflared\cloudflared.exe")) { $cf = "$env:ProgramFiles\cloudflared\cloudflared.exe" }
    if (-not $cf -and (Test-Path "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe")) { $cf = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe" }
  }
  if ($cf) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $tunnelLog = Join-Path $LogDir "tunnel-$stamp.log"
    Write-Host "[*] Opening internet tunnel..."
    $tunnel = Start-Process $cf -PassThru -WindowStyle Hidden `
      -ArgumentList "tunnel --no-autoupdate --url http://127.0.0.1:$webPort" `
      -RedirectStandardOutput (Join-Path $LogDir "tunnel-$stamp.out.log") -RedirectStandardError $tunnelLog
    for ($i = 0; $i -lt 30 -and -not $publicUrl; $i++) {
      Start-Sleep -Seconds 1
      if (Test-Path $tunnelLog) {
        $m = Select-String -Path $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($m) { $publicUrl = $m.Matches[0].Value }
      }
      if ($tunnel.HasExited) { break }
    }
    if ($publicUrl) {
      @{ pid = $tunnel.Id; url = $publicUrl; started = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $RunDir "tunnel.json")
    } else {
      Write-Host "[!] The internet tunnel did not start (see $tunnelLog). Continuing with LAN only." -ForegroundColor Yellow
      if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
    }
  } else {
    Write-Host "[!] No cloudflared - continuing with LAN only." -ForegroundColor Yellow
  }
}

# 4. Hosts allowed to load dev assets / hot reload, and origins allowed to call the API.
$devHosts = @("localhost", "127.0.0.1", $env:COMPUTERNAME.ToLower()) + @(Get-LanAddresses)
if ($publicUrl) { $devHosts += ([Uri]$publicUrl).Host }
$env:NEXT_ALLOWED_DEV_ORIGINS = ($devHosts | Where-Object { $_ } | Select-Object -Unique) -join ","
$env:EXTRA_ALLOWED_ORIGINS = if ($publicUrl) { $publicUrl } else { "" }

# 5. Start API + web in dev mode (LAN binding), then show the links.
& "$PSScriptRoot\start.ps1" -Env $Env -Dev -NoBrowser
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
  if ($publicUrl) { & "$PSScriptRoot\stop.ps1" -Env $Env }
  exit $LASTEXITCODE
}

if ($publicUrl) {
  Write-Host "  Internet:       $publicUrl" -ForegroundColor Cyan
  Write-Host "                  (new link every start; demo / testing only)"
}
Write-Host "  Dev mode:       saving a code file reloads the app on every device."
Write-Host ""
if (-not $NoBrowser) { Start-Process "http://localhost:$webPort" }
