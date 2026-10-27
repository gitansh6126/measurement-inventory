# Checks that this PC has what the RS Inventory local server needs. Safe to run any time.
#   powershell -ExecutionPolicy Bypass -File check.ps1
# Exit code 0 = ready, 1 = something must be fixed first (listed in red).
. "$PSScriptRoot\common.ps1"

$problems = 0
function Ok([string]$Text) { Write-Host "  [OK]   $Text" -ForegroundColor Green }
function Bad([string]$Text, [string]$Fix) { Write-Host "  [FIX]  $Text" -ForegroundColor Red; Write-Host "         -> $Fix"; $script:problems++ }
function Warn([string]$Text) { Write-Host "  [NOTE] $Text" -ForegroundColor Yellow }

Write-Host "Checking this PC for $AppTitle..."

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Bad "Node.js not found" "Install Node.js 22 LTS (or newer) from https://nodejs.org, then open a NEW window" }
else {
  $v = (node --version).Trim()
  if ([int]($v -replace '^v(\d+).*', '$1') -ge 22) { Ok "Node.js $v" } else { Bad "Node.js $v is too old" "Install Node.js 22 LTS (or newer) from https://nodejs.org" }
  if (Get-Command npx -ErrorAction SilentlyContinue) { Ok "npx (fetches pnpm $PnpmVersion when needed)" } else { Bad "npx not found" "Reinstall Node.js (npx comes with it)" }
}

try { $pgBin = Get-PgBin; Ok "PostgreSQL tools in $pgBin" }
catch { Bad "PostgreSQL not found under C:\Program Files\PostgreSQL" "Install PostgreSQL 18 (https://www.postgresql.org/download/windows/); remember the 'postgres' password" }

$svc = Get-Service "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $svc) { Bad "No PostgreSQL Windows service" "Reinstall PostgreSQL with the default 'install as a service' option" }
elseif ($svc.Status -eq "Running") { Ok "Service $($svc.Name) is running" }
else { Warn "Service $($svc.Name) is $($svc.Status); setup/start will try to start it" }

if (-not (Test-Path (Join-Path $AppRoot "pnpm-lock.yaml"))) { Bad "App files missing in $AppRoot" "Clone the repository again (git clone ...); keep the app and local-server folders side by side" }
else { Ok "App files in $AppRoot" }

if (Get-Git) { Ok "Git (needed by UPDATE.bat)" }
else { Bad "Git not found" "Install Git for Windows (winget install -e --id Git.Git), or run SETUP-FIRST-TIME.bat which installs it" }

if (Test-Path (Join-Path $AppRoot "node_modules\next")) { Ok "Packages already installed" }
else { Warn "Packages not installed yet; setup downloads them (needs internet, a few minutes)" }

foreach ($port in 3210, 4210, 3310, 4310) {
  $owner = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $owner) { continue }
  $name = (Get-Process -Id $owner.OwningProcess -ErrorAction SilentlyContinue).ProcessName
  Warn "Port $port is in use by '$name' (fine if $AppTitle is already running)"
}

$free = (Get-PSDrive ($LocalServer.Substring(0, 1))).Free / 1GB
if ($free -lt 3) { Bad ("Only {0:N1} GB free on drive {1}:" -f $free, $LocalServer.Substring(0, 1)) "Free at least 3 GB" } else { Ok ("{0:N0} GB free on drive {1}:" -f $free, $LocalServer.Substring(0, 1)) }

Write-Host ""
if ($problems) { Write-Host "$problems problem(s) to fix before setup." -ForegroundColor Red; exit 1 }
Write-Host "This PC is ready." -ForegroundColor Green
exit 0
