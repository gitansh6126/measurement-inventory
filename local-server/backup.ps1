# Backup of one local environment: database (pg_dump custom format) + uploaded images.
#   powershell -ExecutionPolicy Bypass -File backup.ps1 [-Env client|demo]
# Writes BACKUP_DIR\<env>\<stamp>\ (db.dump, storage.zip, migration.txt, SHA256SUMS) and a
# second copy to BACKUP_COPY_DIR. CLIENT_READY exits with code 2 (FAILED) without that copy:
# a backup on the same disk as the database does not survive a disk failure or theft.
# The result also goes to MONITOR_BACKUP_PING_URL (<url>/fail when FAILED), when set.
param([ValidateSet("client", "demo")][string]$Env = "client")
. "$PSScriptRoot\common.ps1"

$cfg = Read-EnvFile (Get-EnvFile $Env)
$pgBin = Get-PgBin
$pgUrl = Get-PgUrl $cfg.DATABASE_URL
$keepDays = if ($cfg.BACKUP_KEEP_DAYS) { [int]$cfg.BACKUP_KEEP_DAYS } else { 14 }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dest = Join-Path $cfg.BACKUP_DIR "$Env\$stamp"
New-Item -ItemType Directory -Force $dest, $RunDir, $LogDir | Out-Null
Start-Transcript -Append -Path (Join-Path $LogDir "backup-$Env.log") | Out-Null

function Set-Status([string]$Text) {
  "$((Get-Date).ToString('o')) $Text" | Set-Content -Encoding utf8 (Join-Path $RunDir "$Env-backup-status.txt")
  Write-Host "[backup:$Env] $Text"
  Send-Ping $cfg.MONITOR_BACKUP_PING_URL -Fail:($Text -like "FAILED*") -Body "$AppTitle backup ($Env) on ${env:COMPUTERNAME}: $Text"
}

# Keeps folders newer than $keepDays, and always the newest 3.
function Remove-OldBackups([string]$Dir) {
  if (-not (Test-Path $Dir)) { return }
  Get-ChildItem $Dir -Directory | Sort-Object Name -Descending | Select-Object -Skip 3 |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$keepDays) } |
    ForEach-Object { Write-Host "[backup:$Env] removing old $($_.FullName)"; Remove-Item -Recurse -Force $_.FullName }
}

try {
  Remove-OldLogs $(if ($cfg.LOG_KEEP_DAYS) { [int]$cfg.LOG_KEEP_DAYS } else { 30 })
  Start-Postgres
  Write-Host "[backup:$Env] dumping database to $dest"
  # --no-owner/--no-acl so the dump restores into a differently named role (restore test).
  & (Join-Path $pgBin "pg_dump.exe") --format=custom --compress=9 --no-owner --no-acl --file="$dest\db.dump" --dbname="$pgUrl"
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed ($LASTEXITCODE)" }

  $storage = $cfg.STORAGE_ROOT
  if ($storage -and (Test-Path $storage) -and (Get-ChildItem $storage -Recurse -File | Select-Object -First 1)) {
    Write-Host "[backup:$Env] archiving images from $storage"
    Compress-Archive -Path (Join-Path $storage "*") -DestinationPath "$dest\storage.zip" -CompressionLevel Optimal
  } else { Write-Host "[backup:$Env] no uploaded images; skipping storage.zip" }

  # Migration in the dump, so a restore can be matched to the right release.
  $migration = & (Join-Path $pgBin "psql.exe") --dbname="$pgUrl" -Atc "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC LIMIT 1"
  if ($LASTEXITCODE -ne 0) { throw "reading migration failed ($LASTEXITCODE)" }
  [IO.File]::WriteAllText("$dest\migration.txt", "$migration".Trim())

  $sums = Get-ChildItem $dest -File | Where-Object Name -ne "SHA256SUMS" | ForEach-Object { "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower())  $($_.Name)" }
  [IO.File]::WriteAllLines("$dest\SHA256SUMS", [string[]]$sums)
  $size = "{0:N1} MB" -f ((Get-ChildItem $dest -File | Measure-Object Length -Sum).Sum / 1MB)
  Write-Host "[backup:$Env] local copy OK: $dest ($size)"
  Remove-OldBackups (Join-Path $cfg.BACKUP_DIR $Env)

  if ($cfg.BACKUP_COPY_DIR) {
    $copyRoot = Join-Path $cfg.BACKUP_COPY_DIR $Env
    try {
      New-Item -ItemType Directory -Force $copyRoot | Out-Null
      Copy-Item -Recurse $dest (Join-Path $copyRoot $stamp)
      Remove-OldBackups $copyRoot
      Set-Status "OK $stamp ($size) local + copy in $copyRoot"
    } catch {
      Set-Status "FAILED second copy to $copyRoot ($($_.Exception.Message)); local copy $dest is fine"
      exit 2
    }
  } elseif ($cfg.APP_ENV -eq "CLIENT_READY") {
    Set-Status "FAILED BACKUP_COPY_DIR is not set; only the local copy $dest exists"
    exit 2
  } else {
    Set-Status "OK $stamp ($size) local only"
  }
} catch {
  Set-Status "FAILED $($_.Exception.Message)"
  exit 1
} finally {
  Stop-Transcript | Out-Null
}
