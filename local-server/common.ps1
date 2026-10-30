# Shared helpers for the RS Inventory local server scripts. Dot-source it: . "$PSScriptRoot\common.ps1"
# Native tools (node, pnpm, psql, pg_dump) that print warnings on stderr must not stop a script:
# their failures are caught via $LASTEXITCODE, cmdlet errors stop it.
$ErrorActionPreference = "Continue"
$PSDefaultParameterValues["*:ErrorAction"] = "Stop"

$LocalServer = $PSScriptRoot
$V3Root = Split-Path $LocalServer -Parent
$AppRoot = Join-Path $V3Root "app"
$ApiDir = Join-Path $AppRoot "api"
$WebDir = Join-Path $AppRoot "web"
# Everything the shop owns lives OUTSIDE the git folder, so an update (git checkout of a release
# tag) can never touch it: client.env / demo.env, uploaded images, backups, logs, run state.
# Default: a folder next to the code, e.g. C:\RS-Inventory -> C:\RS-Inventory-Data.
$DataRoot = if ($env:RS_DATA_ROOT) { $env:RS_DATA_ROOT } else { "$V3Root-Data" }
$RunDir = Join-Path $DataRoot "run"
$LogDir = Join-Path $DataRoot "logs"
$BackupRoot = Join-Path $DataRoot "backups"
$StorageRoot = Join-Path $DataRoot "storage"
$AppTitle = "RS Inventory"
# The release this folder is on: VERSION file (kept in step with the git tag v<VERSION>).
$AppVersion = try { (Get-Content (Join-Path $V3Root "VERSION") -TotalCount 1).Trim() } catch { "dev" }
# Firewall rule / scheduled task names: separate from V2's, so both can run side by side.
$FirewallRule = "RS Inventory (LAN)"
$TaskPrefix = "RS Inventory"
# Names used by the old V3.1 ZIP install; setup removes them so they do not run twice.
$LegacyFirewallRule = "RS Inventory V3.1 (LAN)"
$LegacyTaskPrefix = "RS V3.1"
$PnpmVersion = "9.15.4"

function Get-EnvFile([string]$Name) {
  if ($Name -notin @("client", "demo")) { throw "Environment must be 'client' or 'demo' (got '$Name')" }
  return Join-Path $DataRoot "$Name.env"
}

# git is needed for UPDATE.bat; Git for Windows also puts it in this standard place.
function Get-Git {
  $g = Get-Command git -ErrorAction SilentlyContinue
  if ($g) { return $g.Source }
  foreach ($p in "$env:ProgramFiles\Git\cmd\git.exe", "${env:ProgramFiles(x86)}\Git\cmd\git.exe") { if (Test-Path $p) { return $p } }
  return $null
}

function Get-GitMetadata {
  $g = Get-Git
  if (-not $g -or -not (Test-Path (Join-Path $V3Root ".git"))) { return $null }
  try {
    $commit = (& $g -C $V3Root rev-parse --short HEAD 2>$null)
    if ($commit) { $commit = $commit.Trim() }
    $fullCommit = (& $g -C $V3Root rev-parse HEAD 2>$null)
    if ($fullCommit) { $fullCommit = $fullCommit.Trim() }
    $branch = (& $g -C $V3Root rev-parse --abbrev-ref HEAD 2>$null)
    if ($branch) { $branch = $branch.Trim() }
    $tag = (& $g -C $V3Root describe --tags --exact-match HEAD 2>$null)
    if ($tag) { $tag = $tag.Trim() }
    $status = (& $g -C $V3Root status --porcelain 2>$null)
    $dirty = [bool]$status
    $remote = (& $g -C $V3Root remote get-url origin 2>$null)
    if ($remote) {
      $remote = $remote.Trim()
      if ($remote -like "git@github.com:*") {
        $remote = "https://github.com/" + ($remote -replace '^git@github\.com:', '' -replace '\.git$', '')
      } elseif ($remote -like "https://github.com/*") {
        $remote = $remote -replace '\.git$', ''
      }
    }
    return @{
      Commit = $commit
      FullCommit = $fullCommit
      Branch = $branch
      Tag = $tag
      IsDirty = $dirty
      Url = $remote
    }
  } catch {
    return $null
  }
}

# Reads KEY=VALUE lines literally, skipping comments.
function Read-EnvFile([string]$Path) {
  if (-not (Test-Path $Path)) { throw "Missing $Path." }
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#")) { continue }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { continue }
    $values[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim()
  }
  foreach ($k in $values.Keys) {
    if ($values[$k] -like "*CHANGE_ME*") { throw "$Path still has a CHANGE_ME value in $k" }
  }
  return $values
}

function Get-PgBin {
  $dirs = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Name -replace '\D', '0') } -Descending
  foreach ($d in $dirs) {
    $bin = Join-Path $d.FullName "bin"
    if (Test-Path (Join-Path $bin "pg_dump.exe")) { return $bin }
  }
  throw "PostgreSQL not found under C:\Program Files\PostgreSQL. Install PostgreSQL 18 first."
}

function Start-Postgres {
  $svc = Get-Service "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $svc) { throw "No PostgreSQL Windows service found." }
  if ($svc.Status -ne "Running") {
    Write-Host "[*] Starting $($svc.Name)..."
    Start-Service $svc.Name
  }
}

function Get-PgUrl([string]$DatabaseUrl) { return ($DatabaseUrl -split '\?')[0] }

function Test-PortInUse([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Get-LanAddresses {
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -notmatch 'vEthernet|Loopback|WSL|VirtualBox|VMware' -and $_.IPAddress -notlike '169.254*' -and $_.IPAddress -ne '127.0.0.1' } |
    Select-Object -ExpandProperty IPAddress
}

function Get-DistDir([string]$Name) { return ".next-local-$Name" }

# True when web / shared code changed after the last build of $Name (or there is no build).
# next-env.d.ts and tsconfig.json are skipped: `next dev` rewrites them without a real change.
function Test-BuildStale([string]$Name) {
  $buildId = Join-Path $WebDir "$(Get-DistDir $Name)\BUILD_ID"
  if (-not (Test-Path $buildId)) { return $true }
  $built = (Get-Item $buildId).LastWriteTime
  $newer = Get-ChildItem -Recurse -File (Join-Path $AppRoot "web"), (Join-Path $AppRoot "shared") `
      -Include *.ts, *.tsx, *.js, *.mjs, *.css, *.json -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\(node_modules|\.next[^\\]*|dist)\\' -and
      $_.Name -notin @("next-env.d.ts", "tsconfig.json") -and $_.LastWriteTime -gt $built } |
    Select-Object -First 1
  return [bool]$newer
}

# pnpm installs the packages (app\pnpm-lock.yaml). The shop PC needs no global pnpm: npx
# fetches the pinned version the first time.
function Invoke-Pnpm([string[]]$PnpmArgs) {
  if (Get-Command pnpm -ErrorAction SilentlyContinue) { & pnpm @PnpmArgs }
  else { & npx --yes "pnpm@$PnpmVersion" @PnpmArgs }
}

function Install-Packages {
  Write-Host "[*] Installing packages (pnpm install --frozen-lockfile; needs internet)..."
  Push-Location $AppRoot
  try {
    Invoke-Pnpm @("install", "--frozen-lockfile")
    if ($LASTEXITCODE -ne 0) { throw "Package install failed ($LASTEXITCODE); check the internet connection and run it again." }
  } finally { Pop-Location }
}
