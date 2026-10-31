# ONE-COMMAND INSTALL of RS Inventory on the shop PC, after `git clone` (the PC that already runs
# V2 is fine: this app uses its own folder, databases, ports 3210 / 3310, firewall rule and tasks).
# Easiest: double-click SETUP-FIRST-TIME.bat in the cloned folder. Or:
#   powershell -ExecutionPolicy Bypass -File local-server\install-all.ps1 [-SkipNetwork] [-SkipAutostart] [-V2Folder C:\RS-Inventory-V2]
#
# 1. installs Git, Node.js LTS and PostgreSQL 18 with winget when they are missing
# 2. runs setup.ps1 (databases, settings files, packages, build, demo data, shortcuts)
# 3. when V2 is found on this PC: offers to copy the shop's V2 data into V3.1
#    (upgrade-from-v2.ps1; V2 is only read). Otherwise asks for the first admin.
# 4. registers nightly backup, weekly restore test and the watchdog (install-autostart.ps1)
# 5. opens the shop network for phones / PCs (allow-network.ps1, one Windows "Yes" prompt)
# Safe to run again: every step skips what is already done.
param(
  [switch]$SkipNetwork,
  [switch]$SkipAutostart,
  [string]$V2Folder = "C:\RS-Inventory-V2"
)
. "$PSScriptRoot\common.ps1"

function Step([string]$Text) { Write-Host ""; Write-Host "==> $Text" -ForegroundColor Cyan }
function ConvertFrom-Secure([Security.SecureString]$s) {
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
# winget changes PATH in the registry; reload it so this window sees node at once.
function Update-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
function Test-Node {
  $n = Get-Command node -ErrorAction SilentlyContinue
  if (-not $n) { return $false }
  return [int](((node --version) -replace '^v(\d+).*', '$1')) -ge 22
}
function Test-Postgres { try { Get-PgBin | Out-Null; return $true } catch { return $false } }
function Assert-Winget {
  if (Get-Command winget -ErrorAction SilentlyContinue) { return }
  throw "winget (App Installer) is not available. Install it from the Microsoft Store ('App Installer'), or install Node.js 22+ and PostgreSQL 18 by hand (links in README.md), then run SETUP-FIRST-TIME.bat again."
}

Get-ChildItem $V3Root -Recurse -File -Include *.ps1, *.bat, *.cmd -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue

Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "  $($AppTitle.ToUpper()) - INSTALL ON $($env:COMPUTERNAME)" -ForegroundColor Cyan
Write-Host "  Folder: $V3Root" -ForegroundColor Cyan
Write-Host "  Data:   $DataRoot" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan
if ($V3Root -match '\\(Desktop|Downloads|OneDrive|Google Drive|My Drive)(\\|$)') {
  Write-Host "[!] This folder is inside Desktop / Downloads / a synced drive." -ForegroundColor Yellow
  Write-Host "    Clone it to C:\RS-Inventory instead (see README.md), then run SETUP-FIRST-TIME.bat there." -ForegroundColor Yellow
  if ((Read-Host "    Continue anyway? (y/N)") -notmatch '^[yY]') { exit 1 }
}

Step "1/5 Required programs (Git, Node.js, PostgreSQL)"
if (Get-Git) { Write-Host "    Git already installed" }
else {
  Assert-Winget
  Write-Host "    Installing Git (needed by UPDATE.bat; Windows may ask 'Yes')..."
  winget install -e --id Git.Git --source winget --accept-package-agreements --accept-source-agreements --silent
  Update-Path
  if (-not (Get-Git)) { throw "Git did not install. Install it from https://git-scm.com/download/win, then run SETUP-FIRST-TIME.bat again." }
  Write-Host "    Git installed" -ForegroundColor Green
}
if (Test-Node) { Write-Host "    Node.js $(node --version) already installed" }
else {
  Assert-Winget
  Write-Host "    Installing Node.js LTS (Windows may ask 'Yes' to allow it)..."
  winget install -e --id OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements --silent
  Update-Path
  if (-not (Test-Node)) { throw "Node.js did not install. Install Node.js 22+ from https://nodejs.org, then run SETUP-FIRST-TIME.bat again." }
  Write-Host "    Node.js $(node --version) installed" -ForegroundColor Green
}

if (Test-Postgres) { Write-Host "    PostgreSQL already installed ($(Get-PgBin))" }
else {
  Assert-Winget
  Write-Host ""
  Write-Host "    PostgreSQL will be installed now. Choose its master ('postgres') password." -ForegroundColor Yellow
  Write-Host "    WRITE IT DOWN and keep it safe: it is needed for repairs and new versions." -ForegroundColor Yellow
  do {
    $p1 = ConvertFrom-Secure (Read-Host "    New postgres password (at least 8 letters/digits)" -AsSecureString)
    $p2 = ConvertFrom-Secure (Read-Host "    Same password again" -AsSecureString)
    # Letters/digits only: the EDB installer takes it on its command line.
    $okPw = $p1 -match '^[A-Za-z0-9]{8,}$' -and $p1 -ceq $p2
    if (-not $okPw) { Write-Host "    Passwords differ, are shorter than 8, or contain symbols. Try again." -ForegroundColor Yellow }
  } until ($okPw)
  Write-Host "    Installing PostgreSQL 18 (5-10 minutes; Windows may ask 'Yes')..."
  winget install -e --id PostgreSQL.PostgreSQL.18 --source winget --accept-package-agreements --accept-source-agreements `
    --override "--mode unattended --unattendedmodeui minimal --superpassword $p1 --serverport 5432 --enable-components server,commandlinetools"
  if (-not (Test-Postgres)) { throw "PostgreSQL did not install. Install PostgreSQL 18 from https://www.postgresql.org/download/windows/ (port 5432), then run SETUP-FIRST-TIME.bat again." }
  Write-Host "    PostgreSQL installed" -ForegroundColor Green
  $env:RS_SETUP_PG_PASSWORD = $p1
}

# V2 on this PC? Then V3.1 starts from a copy of the shop's real data, not an empty company.
$v2Env = Join-Path $V2Folder "local-server\client.env"
$fromV2 = $false
if ((Test-Path $v2Env) -and -not (Test-Path (Get-EnvFile "client"))) {
  Write-Host ""
  Write-Host "    V2 found in $V2Folder." -ForegroundColor Yellow
  $fromV2 = (Read-Host "    Copy the shop's V2 data (products, stock, sales, users...) into V3.1? V2 is not changed. (Y/n)") -notmatch '^[nN]'
}

Step "2/5 App setup (databases, settings, build$(if (-not $fromV2) { ', first admin' }))"
try {
  & "$PSScriptRoot\setup.ps1" -SkipAdmin:$fromV2
  if (-not $?) { throw "Setup did not finish. Read the red message above, fix it, and run SETUP-FIRST-TIME.bat again." }
} finally { Remove-Item Env:RS_SETUP_PG_PASSWORD -ErrorAction SilentlyContinue }

if ($fromV2) {
  Step "3/5 Copy the shop's data from V2"
  & "$PSScriptRoot\upgrade-from-v2.ps1" -V2Folder $V2Folder
  if ($LASTEXITCODE -ne 0) { throw "Copying the V2 data failed (see above). Fix it, then run archive\local-server\UPGRADE-FROM-V2.bat." }
} else { Step "3/5 V2 data copy skipped (run archive\local-server\UPGRADE-FROM-V2.bat any time later)" }

if ($SkipAutostart) { Step "4/5 Auto-start skipped" }
else {
  Step "4/5 Nightly backup, weekly restore test, watchdog (the app itself starts at sign-in from the Startup shortcut)"
  & "$PSScriptRoot\install-autostart.ps1"
}

if ($SkipNetwork) { Step "5/5 Shop network skipped" }
else {
  Step "5/5 Shop network (phones / other PCs) - click 'Yes' on the Windows prompt"
  try {
    $p = Start-Process powershell -Verb RunAs -Wait -PassThru `
      -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\allow-network.ps1`" -Ask"
    if ($p.ExitCode -ne 0) { Write-Host "[!] Network step did not finish; START-SHOP.bat will offer it again." -ForegroundColor Yellow }
  } catch { Write-Host "[!] Network step cancelled; START-SHOP.bat will offer it again." -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Green
Write-Host "  INSTALL FINISHED" -ForegroundColor Green
Write-Host "=====================================================================" -ForegroundColor Green
Write-Host "  Start the app:  desktop '$AppTitle - Start Shop' / START-SHOP.bat (real company :3210 + demo :3310)"
Write-Host "  Auto start:     at every Windows sign-in (Startup folder shortcut)"
Write-Host "  Stop:           desktop '$AppTitle - Stop Server' / STOP.bat"
Write-Host "  New version:    desktop '$AppTitle - Update' / UPDATE.bat"
Write-Host "  Restore data:   sign in as admin -> Backup & Restore -> Restore (README.md)"
Write-Host "  Still to do:    set BACKUP_COPY_DIR in $(Get-EnvFile 'client') (README.md)"
Write-Host ""
