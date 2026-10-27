# Stops the RS Inventory V3.1 Standalone UI Prototype web server
$ErrorActionPreference = "Continue"
. (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "local-server\common.ps1")
$pidFile = Join-Path $RunDir "prototype.json"

if (Test-Path $pidFile) {
  try {
    $info = Get-Content -Raw $pidFile | ConvertFrom-Json
    if ($info.pid) {
      $p = Get-Process -Id $info.pid -ErrorAction SilentlyContinue
      if ($p) {
        Write-Host "[*] Stopping V3 Prototype server (PID $($info.pid))..." -ForegroundColor Yellow
        Stop-Process -Id $info.pid -Force -ErrorAction SilentlyContinue
      }
    }
    if ($info.port) {
      $conn = Get-NetTCPConnection -LocalPort $info.port -State Listen -ErrorAction SilentlyContinue
      if ($conn) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {
    Write-Warning "Failed to parse ${pidFile}: $_"
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "[OK] V3.1 UI Prototype stopped." -ForegroundColor Green
} else {
  Write-Host "[*] V3.1 UI Prototype is not running." -ForegroundColor Yellow
}
