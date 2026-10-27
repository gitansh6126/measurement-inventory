# One-time LOCAL setup: creates role rs_v3 and databases rs_v31_demo / rs_v31_test.
# Asks only for the postgres superuser password; the rs_v3 password is read from
# LOCAL_RS_V2_PASSWORD in v2\app\api\.env. Never touches V1 databases.
# Run from v2\app\api:   & .\scripts\setup-local-db.ps1
$ErrorActionPreference = "Stop"
$api = Split-Path $PSScriptRoot -Parent
$line = Get-Content (Join-Path $api ".env") | Where-Object { $_ -like "LOCAL_RS_V2_PASSWORD=*" } | Select-Object -First 1
if (-not $line) { throw "LOCAL_RS_V2_PASSWORD missing in v2\app\api\.env" }
$pw = $line.Substring("LOCAL_RS_V2_PASSWORD=".Length).Trim()
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
& $psql -U postgres -h 127.0.0.1 -d postgres -v "rs_v3_password=$pw" -f (Join-Path $PSScriptRoot "setup-local-db.sql")
if ($LASTEXITCODE -ne 0) { throw "psql failed ($LASTEXITCODE)" }
