# Installs the newest RELEASE of RS Inventory from GitHub (UPDATE.bat / desktop "Update").
#   powershell -ExecutionPolicy Bypass -File update.ps1 [-Tag v3.1.2] [-Yes] [-CheckOnly]
#
# Releases are git tags v<major>.<minor>.<patch> (no "-" suffix: v3.2.0-beta is never picked
# unless asked for with -Tag). The shop never runs untested work from a branch.
#
# Steps: fetch tags -> show what changes -> stop -> backup client + demo (database + images)
# -> git checkout <tag> -> pnpm install -> migrate + build -> start -> write version-history.txt.
# If anything after the checkout fails it ROLLS BACK by itself: previous code, and when the new
# release had added database migrations, the databases from the backup made a minute before
# (the app was stopped the whole time, so nothing typed is lost). Then it starts the old version.
# Data, settings and backups are in the data folder ($DataRoot) and are never touched by git.
param(
  [string]$Tag,
  [switch]$Yes,
  [switch]$CheckOnly
)
. "$PSScriptRoot\common.ps1"

$gitExe = Get-Git
if (-not $gitExe) { throw "Git is not installed. Run SETUP-FIRST-TIME.bat (it installs Git), then UPDATE.bat again." }
$safeDir = $V3Root.Replace("\", "/")
# safe.directory: git refuses a folder created by another Windows user without it.
function Invoke-Git { & $gitExe -C $V3Root -c "safe.directory=$safeDir" -c advice.detachedHead=false @args }
function Get-Release([string]$Ref) {
  $exact = Invoke-Git describe --tags --exact-match $Ref 2>$null
  if ($LASTEXITCODE -eq 0 -and $exact) { return "$exact".Trim() }
  return "commit $("$(Invoke-Git rev-parse --short $Ref)".Trim())"
}
function Get-Migrations([string]$Ref) {
  return @(Invoke-Git ls-tree --name-only "${Ref}:app/api/prisma/migrations" 2>$null | Where-Object { $_ -match '^\d{4}_' })
}
function Get-NewestBackup([string]$Env) {
  $dir = Join-Path (Read-EnvFile (Get-EnvFile $Env)).BACKUP_DIR $Env
  return Get-ChildItem $dir -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
}
function Write-History([string]$Text) {
  New-Item -ItemType Directory -Force $DataRoot | Out-Null
  "$((Get-Date).ToString('yyyy-MM-dd HH:mm')) $Text" | Add-Content -Encoding utf8 (Join-Path $DataRoot "version-history.txt")
}
function Step([string]$Text) { Write-Host ""; Write-Host "==> $Text" -ForegroundColor Cyan }

if (-not (Test-Path (Join-Path $V3Root ".git"))) { throw "$V3Root is not a git clone. Install with: git clone <repository URL> C:\RS-Inventory (README.md)." }
$envs = @("client", "demo") | Where-Object { Test-Path (Get-EnvFile $_) }
if (-not $envs -and -not $CheckOnly) { throw "Not installed yet: run SETUP-FIRST-TIME.bat first." }

New-Item -ItemType Directory -Force $LogDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Start-Transcript -Append -Path (Join-Path $LogDir "update-$stamp.log") | Out-Null
try {
  Write-Host "=====================================================================" -ForegroundColor Cyan
  Write-Host "  $($AppTitle.ToUpper()) - UPDATE" -ForegroundColor Cyan
  Write-Host "=====================================================================" -ForegroundColor Cyan

  Step "1/6 Looking for a new release"
  Invoke-Git fetch --tags --force --prune origin
  if ($LASTEXITCODE -ne 0) { throw "Could not reach GitHub (git fetch $LASTEXITCODE). Check the internet connection and try again. Nothing was changed." }
  $target = if ($Tag) { $Tag } else {
    Invoke-Git tag -l "v*" --sort=-v:refname | Where-Object { $_ -match '^v\d+\.\d+\.\d+$' } | Select-Object -First 1
  }
  if (-not $target) { throw "No release tag (v1.2.3) found on GitHub yet. Nothing was changed." }
  $targetCommit = "$(Invoke-Git rev-parse "$target^{commit}" 2>$null)".Trim()
  if ($LASTEXITCODE -ne 0 -or -not $targetCommit) { throw "Release $target not found. Nothing was changed." }
  $prevCommit = "$(Invoke-Git rev-parse HEAD)".Trim()
  $prevName = Get-Release HEAD
  Write-Host "    This PC:  $prevName"
  Write-Host "    Newest:   $target"
  if ($targetCommit -eq $prevCommit) {
    Write-Host "[OK] Already on the newest release ($target). Nothing to do." -ForegroundColor Green
    exit 0
  }
  # A fresh `git clone` sits on main, which can be newer than the last tag: never step back.
  Invoke-Git merge-base --is-ancestor $targetCommit $prevCommit
  if ($LASTEXITCODE -eq 0 -and -not $Tag) {
    Write-Host "[OK] This PC already has everything in $target (it is on newer code). Nothing to do." -ForegroundColor Green
    exit 0
  }
  Write-Host "    Changes:"
  Invoke-Git log --oneline --no-decorate -n 40 "$prevCommit..$targetCommit" | ForEach-Object { Write-Host "      $_" }
  $newMigrations = @(Get-Migrations $targetCommit | Where-Object { $_ -notin (Get-Migrations $prevCommit) })
  if ($newMigrations) { Write-Host "    Database changes: $($newMigrations -join ', ')" }
  if ($CheckOnly) { exit 0 }
  if (-not $Yes -and (Read-Host "Install $target now? The app stops for 5-15 minutes. (Y/n)") -match '^[nN]') { Write-Host "Cancelled. Nothing was changed."; exit 0 }

  # Local edits in the program folder are not expected on the shop PC; they are saved, then replaced.
  $dirty = Invoke-Git status --porcelain --untracked-files=no
  if ($dirty) {
    $patch = Join-Path $LogDir "local-changes-$stamp.patch"
    Invoke-Git diff HEAD | Set-Content -Encoding utf8 $patch
    Write-Host "[!] Program files were edited on this PC; saved to $patch and replaced by the release." -ForegroundColor Yellow
  }

  Step "2/6 Stopping the app"
  & "$PSScriptRoot\stop.ps1" -Env all

  Step "3/6 Backup before the update"
  $backups = @{}
  foreach ($n in $envs) {
    $global:LASTEXITCODE = 0
    & "$PSScriptRoot\backup.ps1" -Env $n
    # 2 = only the second copy (BACKUP_COPY_DIR) is missing / failed; the local backup is there.
    if ($LASTEXITCODE -notin 0, 2) { throw "Backup of $n failed (see above), so nothing was updated. Start the app again with the Shop shortcut." }
    if ($LASTEXITCODE -eq 2) { Write-Host "[!] $n backup has no second copy (BACKUP_COPY_DIR). The local backup is fine; continuing." -ForegroundColor Yellow }
    $backups[$n] = Get-NewestBackup $n
    Write-Host "    $n backup: $($backups[$n].FullName)"
  }

  $checkedOut = $false
  try {
    Step "4/6 Installing $target"
    Invoke-Git checkout --force $targetCommit
    if ($LASTEXITCODE -ne 0) { throw "git checkout $target failed ($LASTEXITCODE)" }
    $checkedOut = $true
    Install-Packages

    Step "5/6 Database changes + build (5-15 minutes)"
    & "$PSScriptRoot\build.ps1" -Env all

    Step "6/6 Starting"
    $first = if ("client" -in $envs) { "client" } else { "demo" }
    $global:LASTEXITCODE = 0
    & "$PSScriptRoot\start.ps1" -Env $first -Prod
    if ($LASTEXITCODE -ne 0) { throw "The new version did not start." }
  } catch {
    $why = $_.Exception.Message
    Write-Host ""
    Write-Host "[!] Update to $target failed: $why" -ForegroundColor Red
    Write-Host "[*] Rolling back to $prevName..." -ForegroundColor Yellow
    & "$PSScriptRoot\stop.ps1" -Env all
    if ($checkedOut) { Invoke-Git checkout --force $prevCommit }
    if ($checkedOut -and $newMigrations) {
      # Same method as upgrade-from-v2.ps1: empty the schema (tables added by the new release go
      # too), then load the dump taken a minute before the checkout.
      $pgBin = Get-PgBin
      foreach ($n in $envs) {
        $dump = Join-Path $backups[$n].FullName "db.dump"
        $url = Get-PgUrl (Read-EnvFile (Get-EnvFile $n)).DATABASE_URL
        Write-Host "[*] Putting the $n database back as it was before the update ($dump)..."
        & (Join-Path $pgBin "psql.exe") -X -q --dbname="$url" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
        if ($LASTEXITCODE -eq 0) { & (Join-Path $pgBin "pg_restore.exe") --no-owner --no-acl --exit-on-error --dbname="$url" $dump }
        if ($LASTEXITCODE -ne 0) { throw "ROLLBACK INCOMPLETE: restoring $n from $dump failed ($LASTEXITCODE). Do not use the app; call the developer with $LogDir\update-$stamp.log." }
      }
    }
    if ($checkedOut) {
      Install-Packages
      & "$PSScriptRoot\build.ps1" -Env all
    }
    & "$PSScriptRoot\start.ps1" -Env $(if ("client" -in $envs) { "client" } else { "demo" }) -Prod
    Write-History "ROLLED BACK $prevName (update to $target failed: $why)"
    Write-Host ""
    Write-Host "[!] The update failed and $prevName is running again. Send $LogDir\update-$stamp.log to the developer." -ForegroundColor Red
    exit 1
  }

  # The new release's own scripts: shortcuts it adds or renames, and any one-off step it needs
  # (local-server\post-update.ps1, only when a release ships one). Failures here only warn.
  try { & "$PSScriptRoot\create-shortcuts.ps1" } catch { Write-Host "[!] Desktop shortcuts not refreshed: $($_.Exception.Message)" -ForegroundColor Yellow }
  $post = Join-Path $PSScriptRoot "post-update.ps1"
  if (Test-Path $post) {
    try { & $post -From $prevName -To $target } catch { Write-Host "[!] post-update.ps1: $($_.Exception.Message)" -ForegroundColor Yellow }
  }

  Write-History "UPDATED $prevName -> $target"
  Write-Host ""
  Write-Host "=====================================================================" -ForegroundColor Green
  Write-Host "  UPDATED to $target (was $prevName)" -ForegroundColor Green
  Write-Host "=====================================================================" -ForegroundColor Green
  Write-Host "  Backups made before the update: $(($backups.Values | ForEach-Object { $_.FullName }) -join ', ')"
  Write-Host "  History: $(Join-Path $DataRoot 'version-history.txt')"
} finally {
  Stop-Transcript | Out-Null
}
