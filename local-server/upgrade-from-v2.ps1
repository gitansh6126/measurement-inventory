# Copies the shop's V2 data (real company) into V3.1 and upgrades it to the V3.1 database.
# V2 is only READ (pg_dump); it keeps running and keeps its own data.
# Easiest: double-click archive\local-server\UPGRADE-FROM-V2.bat. Or:
#   powershell -ExecutionPolicy Bypass -File upgrade-from-v2.ps1 [-V2Folder C:\RS-Inventory-V2] [-Replace] [-NoSmoke]
#
#  1. reads V2's client.env (database + images folder) and V3.1's client.env
#  2. refuses when V3.1 already has data, unless -Replace (then backs V3.1 up first)
#  3. pg_dump of V2 into backups\from-v2\<stamp>\ (also a V2 backup), row counts recorded
#  4. empties the V3.1 client database, restores the V2 dump into it
#  5. prisma migrate deploy: V2 stops at 0028, V3.1 adds 0029-0038 (warehouses off, no sets,
#     Product Type = the V2 categories; nothing else changes)
#  6. checks: every core table has the same row count as V2, the stock / set / warehouse drift
#     views are empty
#  7. copies V2's uploaded images
#  8. starts V3.1 and offers the read-only smoke test (sign-in, every list, product, order,
#     shortage / backorder report, import check of the sample sheets)
# Proven on the development PC 2026-10-24 with the V2 demo data: 0028 -> 0038, counts equal,
# drift views empty, smoke 0 failures, full V3.1 integration suite 209/209 on that database.
#
# Production test = a COPY: sales typed in V2 after the copy are not in V3.1. On go-live day
# stop V2 (STOP-V2), run this again with -Replace, then use only V3.1.
param(
  [string]$V2Folder = "C:\RS-Inventory-V2",
  [switch]$Replace,
  [switch]$NoSmoke
)
. "$PSScriptRoot\common.ps1"

function Step([string]$Text) { Write-Host ""; Write-Host "==> $Text" -ForegroundColor Cyan }
function ConvertFrom-Secure([Security.SecureString]$s) {
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

# Tables compared after the copy (all exist in V2 0028 and V3.1).
$CoreTables = "companies", "users", "categories", "product_groups", "product_variations", "parties",
  "stock_movements", "stock_balances", "sales", "sale_lines", "purchases", "purchase_lines", "document_voids",
  "orders", "order_lines", "draft_orders", "vendor_prices", "measurement_pieces", "images", "audit_events"

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Force $LogDir, $RunDir | Out-Null
Start-Transcript -Append -Path (Join-Path $LogDir "upgrade-from-v2-$stamp.log") | Out-Null
try {
  $pgBin = Get-PgBin
  $psql = Join-Path $pgBin "psql.exe"
  function Q([string]$Url, [string]$Sql) {
    $out = & $psql -X --dbname="$Url" -Atc $Sql
    if ($LASTEXITCODE -ne 0) { throw "query failed: $Sql" }
    return "$out".Trim()
  }

  Step "1/8 Settings"
  $v2EnvFile = Join-Path $V2Folder "local-server\client.env"
  if (-not (Test-Path $v2EnvFile)) { throw "V2 not found: $v2EnvFile is missing. Pass -V2Folder <the V2 folder>." }
  $v2 = Read-EnvFile $v2EnvFile
  $v31EnvFile = Get-EnvFile "client"
  if (-not (Test-Path $v31EnvFile)) { throw "V3.1 is not set up yet: run SETUP-FIRST-TIME.bat first." }
  $v31 = Read-EnvFile $v31EnvFile
  $v2Url = Get-PgUrl $v2.DATABASE_URL
  $v31Url = Get-PgUrl $v31.DATABASE_URL
  $v2Db = ([Uri]$v2Url).AbsolutePath.TrimStart("/")
  $v31Db = ([Uri]$v31Url).AbsolutePath.TrimStart("/")
  if ($v2Db -eq $v31Db) { throw "V2 and V3.1 point at the same database ($v2Db). V3.1 must use its own (rs_v31_client)." }
  if ($v31Db -match "demo|test") { throw "V3.1 client database '$v31Db' looks like a demo/test database." }
  Write-Host "    V2:   $v2Db  (read only)"
  Write-Host "    V3.1: $v31Db"
  Start-Postgres

  Step "2/8 Is V3.1 empty?"
  $hasTables = Q $v31Url "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'"
  $v31Users = if ($hasTables -eq "1") { [int](Q $v31Url "SELECT count(*) FROM users") } else { 0 }
  if ($v31Users -gt 0 -and -not $Replace) {
    throw "V3.1 already has $v31Users user(s) (an earlier copy or typed data). To replace it with a fresh copy of V2, run archive\local-server\UPGRADE-FROM-V2.bat again and answer Y (or -Replace)."
  }
  if ($v31Users -gt 0) {
    Write-Host "    V3.1 has data: backing it up before replacing it..."
    & "$PSScriptRoot\backup.ps1" -Env client
    # 2 = the local copy is fine but BACKUP_COPY_DIR is not set yet: enough before a test copy.
    if ($LASTEXITCODE -notin 0, 2) { throw "Backup of V3.1 failed; nothing was replaced." }
  } else { Write-Host "    empty - OK" }
  & "$PSScriptRoot\stop.ps1" -Env client

  Step "3/8 Copy of V2 (pg_dump; V2 keeps running)"
  $dest = Join-Path $BackupRoot "from-v2\$stamp"
  New-Item -ItemType Directory -Force $dest | Out-Null
  & (Join-Path $pgBin "pg_dump.exe") --format=custom --compress=9 --no-owner --no-acl --file="$dest\v2-client.dump" --dbname="$v2Url"
  if ($LASTEXITCODE -ne 0) { throw "pg_dump of V2 failed ($LASTEXITCODE)" }
  $v2Migration = Q $v2Url "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1"
  if ($v2Migration -notmatch '^00(2[0-8]|1\d|0\d)_') { throw "V2 database is at $v2Migration; this V3.1 package upgrades V2 databases up to 0028." }
  $v2Counts = [ordered]@{}
  foreach ($t in $CoreTables) { $v2Counts[$t] = [long](Q $v2Url "SELECT count(*) FROM $t") }
  ($v2Counts.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) + "migration=$v2Migration" | Set-Content -Encoding utf8 "$dest\v2-counts.txt"
  Write-Host "    $dest\v2-client.dump ($('{0:N1} MB' -f ((Get-Item "$dest\v2-client.dump").Length / 1MB))), V2 at $v2Migration"

  Step "4/8 Restore into V3.1"
  & $psql -X -q --dbname="$v31Url" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" 2>$null
  if ($LASTEXITCODE -ne 0) { throw "Could not empty $v31Db ($LASTEXITCODE)" }
  & (Join-Path $pgBin "pg_restore.exe") --no-owner --no-acl --exit-on-error --dbname="$v31Url" "$dest\v2-client.dump"
  if ($LASTEXITCODE -ne 0) { throw "pg_restore into $v31Db failed ($LASTEXITCODE)" }

  Step "5/8 Upgrade the database to V3.1 (migrations 0029-0038)"
  $prisma = Join-Path $AppRoot "node_modules\prisma\build\index.js"
  Push-Location $ApiDir
  try {
    $env:DATABASE_URL = $v31.DATABASE_URL
    node $prisma migrate deploy
    if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy failed ($LASTEXITCODE)" }
  } finally { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue; Pop-Location }

  Step "6/8 Checks"
  $bad = 0
  foreach ($t in $CoreTables) {
    $n = [long](Q $v31Url "SELECT count(*) FROM $t")
    if ($n -eq $v2Counts[$t]) { Write-Host ("    [OK]   {0,-20} {1,8}" -f $t, $n) -ForegroundColor Green }
    else { Write-Host ("    [FAIL] {0,-20} V3.1 {1} / V2 {2}" -f $t, $n, $v2Counts[$t]) -ForegroundColor Red; $bad++ }
  }
  foreach ($view in "stock_balance_drift", "set_allocation_drift", "warehouse_balance_drift", "warehouse_total_drift") {
    $n = [long](Q $v31Url "SELECT count(*) FROM $view")
    if ($n -eq 0) { Write-Host ("    [OK]   {0,-24} empty" -f $view) -ForegroundColor Green }
    else { Write-Host ("    [FAIL] {0,-24} {1} rows" -f $view, $n) -ForegroundColor Red; $bad++ }
  }
  $migration = Q $v31Url "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1"
  Write-Host "    database now at $migration"
  if ($bad) { throw "$bad check(s) failed - do not use this copy; send $LogDir\upgrade-from-v2-$stamp.log to the developer." }

  Step "7/8 Product images"
  if ($v2.STORAGE_ROOT -and (Test-Path $v2.STORAGE_ROOT)) {
    New-Item -ItemType Directory -Force $v31.STORAGE_ROOT | Out-Null
    robocopy $v2.STORAGE_ROOT $v31.STORAGE_ROOT /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copying images failed (robocopy $LASTEXITCODE)" }
    Write-Host "    $(@(Get-ChildItem $v31.STORAGE_ROOT -Recurse -File).Count) files in $($v31.STORAGE_ROOT)"
  } else { Write-Host "    V2 has no uploaded images" }
  "$((Get-Date).ToString('o')) OK copy of V2 $v2Db ($v2Migration) -> $v31Db ($migration), dump $dest" | Set-Content -Encoding utf8 (Join-Path $RunDir "upgrade-from-v2-status.txt")

  Step "8/8 Start V3.1 and smoke test"
  $global:LASTEXITCODE = 0
  & "$PSScriptRoot\start.ps1" -Env client -Prod -NoBrowser
  if ($LASTEXITCODE -ne 0) { throw "V3.1 did not start (see above)." }
  if (-not $NoSmoke) {
    $email = Read-Host "    Admin email (your V2 sign-in) for the read-only smoke test - Enter to skip"
    if ($email) {
      $env:SMOKE_PASSWORD = ConvertFrom-Secure (Read-Host "    Password" -AsSecureString)
      $sheets = Join-Path $V3Root "docs\import-samples"
      $smokeArgs = @("--url", "http://127.0.0.1:$($v31.WEB_PORT)", "--email", $email)
      if (Test-Path $sheets) { $smokeArgs += @("--sheets", $sheets) }
      Push-Location $ApiDir
      try { node (Join-Path $AppRoot "node_modules\tsx\dist\cli.mjs") scripts/upgrade-smoke.ts @smokeArgs }
      finally { Remove-Item Env:SMOKE_PASSWORD -ErrorAction SilentlyContinue; Pop-Location }
      if ($LASTEXITCODE -ne 0) { Write-Host "[!] Smoke test found problems (above). Send the log to the developer." -ForegroundColor Yellow }
    }
  }
  Write-Host ""
  Write-Host "[OK] V3.1 now has a copy of the V2 data: http://localhost:$($v31.WEB_PORT)  (V2 still on its own address)" -ForegroundColor Green
  Write-Host "     Sign in with the same V2 users and passwords. Checklist: PRODUCTION-TEST.md"
} catch {
  Write-Host "[!] $($_.Exception.Message)" -ForegroundColor Red
  "$((Get-Date).ToString('o')) FAILED $($_.Exception.Message)" | Set-Content -Encoding utf8 (Join-Path $RunDir "upgrade-from-v2-status.txt")
  exit 1
} finally {
  Stop-Transcript | Out-Null
}
exit 0
