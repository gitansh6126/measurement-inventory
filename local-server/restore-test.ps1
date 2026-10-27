# Proves a backup can be restored: loads it into the scratch database, checks it, wipes it.
# Never touches the live database.
#   powershell -ExecutionPolicy Bypass -File restore-test.ps1 [-Env client] [-From <backup folder>]
# Without -From it uses the newest local backup. Needs RESTORE_DB_URL in the env file (a
# dedicated database whose name contains "restore" or "test", owned by the same role).
param(
  [ValidateSet("client", "demo")][string]$Env = "client",
  [string]$From
)
. "$PSScriptRoot\common.ps1"

$cfg = Read-EnvFile (Get-EnvFile $Env)
if (-not $cfg.RESTORE_DB_URL) { throw "RESTORE_DB_URL missing in $(Get-EnvFile $Env)" }
$pgBin = Get-PgBin
$psql = Join-Path $pgBin "psql.exe"
New-Item -ItemType Directory -Force $RunDir, $LogDir | Out-Null
Start-Transcript -Append -Path (Join-Path $LogDir "restore-test-$Env.log") | Out-Null

function Log([string]$Text) { Write-Host "[restore-test:$Env] $Text" }
function Set-Status([string]$Text) {
  "$((Get-Date).ToString('o')) $Text" | Set-Content -Encoding utf8 (Join-Path $RunDir "$Env-restore-test-status.txt")
  Log $Text
}

$scratchUrl = Get-PgUrl $cfg.RESTORE_DB_URL
$scratch = ([Uri]$scratchUrl).AbsolutePath.TrimStart("/")
$live = ([Uri](Get-PgUrl $cfg.DATABASE_URL)).AbsolutePath.TrimStart("/")
function Q([string]$Sql) {
  $out = & $psql --dbname="$scratchUrl" -Atc $Sql
  if ($LASTEXITCODE -ne 0) { throw "query failed: $Sql" }
  return "$out".Trim()
}
function Clear-Scratch { & $psql --dbname="$scratchUrl" -qc "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" 2>$null | Out-Null }

$scratchChecked = $false
try {
  if ($scratch -notmatch "restore|test") { throw "RESTORE_DB_URL database '$scratch' must contain 'restore' or 'test'" }
  if ($scratch -eq $live) { throw "RESTORE_DB_URL must not be the live database" }
  $scratchChecked = $true

  $src = if ($From) { $From } else {
    Get-ChildItem (Join-Path $cfg.BACKUP_DIR $Env) -Directory -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1 -ExpandProperty FullName
  }
  if (-not $src -or -not (Test-Path "$src\db.dump")) { throw "no db.dump found (backup folder '$src')" }

  Log "verifying checksums in $src"
  foreach ($line in Get-Content "$src\SHA256SUMS") {
    $hash, $name = $line -split "  ", 2
    if ((Get-FileHash "$src\$name" -Algorithm SHA256).Hash.ToLower() -ne $hash) { throw "checksum mismatch: $name" }
  }

  Start-Postgres
  Log "restoring into scratch database $scratch"
  Clear-Scratch
  & (Join-Path $pgBin "pg_restore.exe") --no-owner --no-acl --exit-on-error --dbname="$scratchUrl" "$src\db.dump"
  if ($LASTEXITCODE -ne 0) { throw "pg_restore failed ($LASTEXITCODE)" }

  $migration = Q "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC LIMIT 1"
  $expected = (Get-Content -Raw "$src\migration.txt").Trim()
  if ($migration -ne $expected) { throw "migration $migration, backup recorded $expected" }
  Log "migration $migration"

  foreach ($t in "companies", "users", "product_groups", "product_variations", "stock_movements", "sales", "purchases", "parties", "orders", "group_sets", "warehouses", "audit_events") {
    Log ("  {0}: {1} rows" -f $t, (Q "SELECT count(*) FROM $t"))
  }

  if (Test-Path "$src\storage.zip") {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead("$src\storage.zip")
    try { Log "  storage archive: $(@($zip.Entries | Where-Object { $_.Name }).Count) files" } finally { $zip.Dispose() }
  }
  Set-Status "PASS $src"
} catch {
  Set-Status "FAIL $($_.Exception.Message)"
  exit 1
} finally {
  # Only ever wipe a database that passed the scratch checks above.
  if ($scratchChecked) { Clear-Scratch }
  Stop-Transcript | Out-Null
}
