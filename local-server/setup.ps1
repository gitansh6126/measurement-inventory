# One-time setup of the RS Inventory local server on THIS PC (real company + demo company).
# Normally run by SETUP-FIRST-TIME.bat (install-all.ps1). Or:
#   powershell -ExecutionPolicy Bypass -File setup.ps1 [-Env all|client|demo] [-SkipAdmin] [-NoShortcuts]
#
# Asks once for the PostgreSQL 'postgres' password, then:
#   1. creates database roles + databases (rs_v31_client, rs_v31_client_restore, rs_v31_demo_local)
#   2. writes client.env / demo.env with random passwords and secrets into the data folder
#      (RS_DATA_ROOT, default <this folder>-Data, e.g. C:\RS-Inventory-Data; never in git)
#   3. installs packages (pnpm), applies migrations, builds both companies
#   4. fills the demo company with sample data
#   5. asks for the real company's name and first admin (skipped with -SkipAdmin, used when
#      the shop's V2 data is copied in by upgrade-from-v2.ps1: V2's users come with it)
#   6. puts START SHOP / STOP SERVER / UPDATE on the desktop + auto start at sign-in (create-shortcuts.ps1)
# Safe to run again: existing env files, databases and data are kept. V2 is never touched.
# Do not move this folder or the data folder after setup (env files hold absolute paths).
param(
  [ValidateSet("all", "client", "demo")][string]$Env = "all",
  [switch]$SkipAdmin,
  [switch]$NoShortcuts
)
. "$PSScriptRoot\common.ps1"

function New-Secret([int]$Bytes) {
  $b = New-Object byte[] $Bytes
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return (($b | ForEach-Object { $_.ToString("x2") }) -join "")
}
function ConvertFrom-Secure([Security.SecureString]$s) {
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
function Step([string]$Text) { Write-Host ""; Write-Host "==> $Text" -ForegroundColor Cyan }

# Runs SQL as the postgres superuser. psql :'var' interpolation quotes the values safely.
function Invoke-PgAdmin([string]$Sql, [hashtable]$Vars = @{}) {
  $pgArgs = @("-X", "-q", "-At", "-h", "127.0.0.1", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1")
  foreach ($k in $Vars.Keys) { $pgArgs += @("-v", "$k=$($Vars[$k])") }
  $out = $Sql | & $script:psql @pgArgs
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL command failed ($LASTEXITCODE)" }
  return $out
}

# Creates the role (or resets its password to match the env file) and its databases.
function Initialize-Database([string]$Role, [string]$Password, [string[]]$Databases) {
  $exists = Invoke-PgAdmin "SELECT 1 FROM pg_roles WHERE rolname = :'role';" @{ role = $Role }
  $verb = if ($exists) { "ALTER" } else { "CREATE" }
  Invoke-PgAdmin "$verb ROLE $Role LOGIN PASSWORD :'pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;" @{ pw = $Password } | Out-Null
  Write-Host "    role $Role $(if ($exists) { 'exists (password synced)' } else { 'created' })"
  foreach ($db in $Databases) {
    if (Invoke-PgAdmin "SELECT 1 FROM pg_database WHERE datname = :'db';" @{ db = $db }) { Write-Host "    database $db exists (kept)"; continue }
    Invoke-PgAdmin "CREATE DATABASE $db OWNER $Role ENCODING 'UTF8' TEMPLATE template0;" | Out-Null
    Invoke-PgAdmin "REVOKE ALL ON DATABASE $db FROM PUBLIC;" | Out-Null
    Write-Host "    database $db created"
  }
}

function Get-UrlPassword([string]$Url) { return [Uri]::UnescapeDataString(([Uri]$Url).UserInfo.Split(":", 2)[1]) }

function Write-EnvFromTemplate([string]$Name, [hashtable]$Values) {
  $target = Get-EnvFile $Name
  $text = Get-Content -Raw (Join-Path $LocalServer "$Name.example.env")
  foreach ($k in $Values.Keys) { $text = $text.Replace($k, $Values[$k]) }
  [IO.File]::WriteAllText($target, $text, (New-Object Text.UTF8Encoding $false))
  Write-Host "    wrote $target"
}

function Get-UserCount([string]$EnvName) {
  $url = Get-PgUrl (Read-EnvFile (Get-EnvFile $EnvName)).DATABASE_URL
  $n = & $script:psql -X -At --dbname="$url" -c "SELECT count(*) FROM users;" 2>$null
  return [int]("$n".Trim())
}

$tsx = Join-Path $AppRoot "node_modules\tsx\dist\cli.mjs"
$names = if ($Env -eq "all") { @("client", "demo") } else { @($Env) }
$started = Get-Date

Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "  $($AppTitle.ToUpper()) - SETUP ON $($env:COMPUTERNAME)" -ForegroundColor Cyan
Write-Host "  Folder: $V3Root" -ForegroundColor Cyan
Write-Host "  Data:   $DataRoot" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan

Step "1/6 Checking this PC"
# Files from a downloaded ZIP carry a 'blocked' mark; clear it so Windows does not prompt.
Get-ChildItem $V3Root -Recurse -File -Include *.ps1, *.bat, *.cmd -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
& "$PSScriptRoot\check.ps1"
if ($LASTEXITCODE -ne 0) { throw "Fix the items marked [FIX] above, then run setup again." }
$script:psql = Join-Path (Get-PgBin) "psql.exe"
Start-Postgres

Step "2/6 Databases (PostgreSQL on this PC)"
for ($try = 1; ; $try++) {
  # install-all.ps1 passes the password it just gave a fresh PostgreSQL install (first try only).
  if ($try -eq 1 -and $env:RS_SETUP_PG_PASSWORD) { $env:PGPASSWORD = $env:RS_SETUP_PG_PASSWORD }
  else { $env:PGPASSWORD = ConvertFrom-Secure (Read-Host "Enter the PostgreSQL 'postgres' password (set when PostgreSQL was installed - the same one V2 uses)" -AsSecureString) }
  Remove-Item Env:RS_SETUP_PG_PASSWORD -ErrorAction SilentlyContinue
  & $script:psql -X -At -h 127.0.0.1 -U postgres -d postgres -c "SELECT 1" 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { break }
  if ($try -ge 3) { throw "Could not sign in to PostgreSQL as 'postgres'. Check the password and that PostgreSQL uses port 5432." }
  Write-Host "    Wrong password or PostgreSQL not reachable. Try again." -ForegroundColor Yellow
}

$now = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
New-Item -ItemType Directory -Force $DataRoot, $BackupRoot, $StorageRoot | Out-Null
$backups = $BackupRoot
try {
  if ("client" -in $names) {
    $f = Get-EnvFile "client"
    $pw = if (Test-Path $f) { Get-UrlPassword (Read-EnvFile $f).DATABASE_URL } else { New-Secret 24 }
    Initialize-Database "rs_v31_client" $pw @("rs_v31_client", "rs_v31_client_restore")
    if (-not (Test-Path $f)) {
      Write-EnvFromTemplate "client" @{
        "CHANGE_ME_DB_PASSWORD" = $pw
        "CHANGE_ME_SESSION_SECRET" = (New-Secret 32)
        "DEPLOYED_AT=CHANGE_ME_SET_BY_SETUP" = "DEPLOYED_AT=$now"
        "STORAGE_ROOT=CHANGE_ME_SET_BY_SETUP" = "STORAGE_ROOT=$(Join-Path $StorageRoot 'client')"
        "BACKUP_DIR=CHANGE_ME_SET_BY_SETUP" = "BACKUP_DIR=$backups"
      }
    } else { Write-Host "    $f exists (kept)" }
  }
  if ("demo" -in $names) {
    $f = Get-EnvFile "demo"
    $pw = if (Test-Path $f) { Get-UrlPassword (Read-EnvFile $f).DATABASE_URL } else { New-Secret 24 }
    $demoDb = if (Test-Path $f) { ([Uri](Get-PgUrl (Read-EnvFile $f).DATABASE_URL)).AbsolutePath.TrimStart("/") } else { "rs_v31_demo_local" }
    $demoRole = if (Test-Path $f) { ([Uri](Read-EnvFile $f).DATABASE_URL).UserInfo.Split(":")[0] } else { "rs_v31_demo_local" }
    Initialize-Database $demoRole $pw @($demoDb)
    if (-not (Test-Path $f)) {
      Write-EnvFromTemplate "demo" @{
        "CHANGE_ME_DB_PASSWORD" = $pw
        "CHANGE_ME_SESSION_SECRET" = (New-Secret 32)
        "DEPLOYED_AT=CHANGE_ME_SET_BY_SETUP" = "DEPLOYED_AT=$now"
        "STORAGE_ROOT=CHANGE_ME_SET_BY_SETUP" = "STORAGE_ROOT=$(Join-Path $StorageRoot 'demo')"
        "BACKUP_DIR=CHANGE_ME_SET_BY_SETUP" = "BACKUP_DIR=$backups"
      }
    } else { Write-Host "    $f exists (kept)" }
  }
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }

Step "3/6 Installing packages, migrating databases, building (5-15 minutes)"
Install-Packages
& "$PSScriptRoot\build.ps1" -Env $Env

if ("demo" -in $names) {
  Step "4/6 Demo company sample data"
  if ((Get-UserCount "demo") -gt 0) { Write-Host "    demo company already has data (kept)" }
  else {
    Push-Location $ApiDir
    try {
      node --env-file="$(Get-EnvFile 'demo')" $tsx scripts/seed-demo.ts
      if ($LASTEXITCODE -ne 0) { throw "Demo seed failed ($LASTEXITCODE)" }
    } finally { Pop-Location }
  }
} else { Step "4/6 Demo company skipped" }

if ("client" -in $names -and -not $SkipAdmin) {
  Step "5/6 Real company and first admin"
  if ((Get-UserCount "client") -gt 0) { Write-Host "    real company already has users (kept). Add more users in the app." }
  else {
    $company = Read-Host "    Company name [RS Machinery]"
    if (-not $company) { $company = "RS Machinery" }
    do { $name = Read-Host "    Admin full name" } until ($name.Trim())
    do { $email = Read-Host "    Admin email (used to sign in)" } until ($email -match '^[^@\s]+@[^@\s]+\.[^@\s]+$')
    do {
      $p1 = ConvertFrom-Secure (Read-Host "    Admin password (at least 10 characters)" -AsSecureString)
      $p2 = ConvertFrom-Secure (Read-Host "    Same password again" -AsSecureString)
      $okPw = $p1.Length -ge 10 -and $p1 -ceq $p2
      if (-not $okPw) { Write-Host "    Passwords differ or are shorter than 10 characters. Try again." -ForegroundColor Yellow }
    } until ($okPw)
    $env:BOOTSTRAP_ADMIN_PASSWORD = $p1
    Push-Location $ApiDir
    try {
      node --env-file="$(Get-EnvFile 'client')" $tsx scripts/create-admin.ts --company "$company" --name "$name" --email "$email"
      if ($LASTEXITCODE -ne 0) { throw "Creating the admin failed ($LASTEXITCODE)" }
    } finally { Remove-Item Env:BOOTSTRAP_ADMIN_PASSWORD -ErrorAction SilentlyContinue; Pop-Location }
  }
} else { Step "5/6 First admin skipped (V2 data and users are copied by archive\local-server\UPGRADE-FROM-V2.bat)" }

if (-not $NoShortcuts) {
  Step "6/6 Desktop shortcuts"
  & "$PSScriptRoot\create-shortcuts.ps1"
} else { Step "6/6 Desktop shortcuts skipped" }

Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Green
Write-Host ("  SETUP FINISHED in {0:N0} minutes" -f ((Get-Date) - $started).TotalMinutes) -ForegroundColor Green
Write-Host "=====================================================================" -ForegroundColor Green
Write-Host "  Start:   '$AppTitle - Start Shop' on the desktop (START-SHOP.bat) - real company :3210 + demo :3310"
Write-Host "           (also runs by itself at every Windows sign-in; 'Switch to Demo company' is inside the app)"
Write-Host "  Stop:    '$AppTitle - Stop Server' (STOP.bat)"
Write-Host "  Update:  '$AppTitle - Update' (UPDATE.bat) whenever the developer says a new version is out"
Write-Host "  Then set BACKUP_COPY_DIR in $(Get-EnvFile 'client') (README.md)"
Write-Host ""
