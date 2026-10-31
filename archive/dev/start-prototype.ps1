# Starts the RS Inventory V3.1 Standalone UI Prototype local web server
param(
  [int]$Port = 8081,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
. (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "local-server\common.ps1")
$ProtoDir = Join-Path $V3Root "docs\ui-prototype"
New-Item -ItemType Directory -Force $RunDir, $LogDir | Out-Null

function Test-PortInUse([int]$p) {
  return [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

# If default port is in use, check if it's already serving prototype or choose alternate
$targetPort = $Port
$pidFile = Join-Path $RunDir "prototype.json"
if (Test-PortInUse $targetPort) {
  if (Test-Path $pidFile) {
    Write-Host "[*] V3.1 UI Prototype is already running on port $targetPort." -ForegroundColor Green
    if (-not $NoBrowser) { Start-Process "http://localhost:$targetPort" }
    exit 0
  } else {
    $targetPort = 8083
    if (Test-PortInUse $targetPort) {
      $targetPort = 8088
    }
  }
}

$stamp = Get-Date -Format "yyyyMMdd"
$outLog = Join-Path $LogDir "prototype-$stamp.log"
$errLog = Join-Path $LogDir "prototype-$stamp.err.log"

Write-Host "[*] Starting V3.1 UI Prototype on http://localhost:$targetPort..." -ForegroundColor Cyan

# Use Python http.server if python is available, otherwise npx serve
$proc = $null
if (Get-Command python -ErrorAction SilentlyContinue) {
  $proc = Start-Process python -PassThru -WindowStyle Hidden `
    -ArgumentList "-m http.server $targetPort --directory `"$ProtoDir`"" `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog
} else {
  $proc = Start-Process npx -PassThru -WindowStyle Hidden `
    -ArgumentList "-y serve `"$ProtoDir`" -p $targetPort" `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog
}

Start-Sleep -Seconds 2

if ($proc.HasExited) {
  Write-Host "[!] Failed to start prototype web server. Check $errLog" -ForegroundColor Red
  exit 1
}

@{ pid = $proc.Id; port = $targetPort; started = (Get-Date).ToString("o") } |
  ConvertTo-Json | Set-Content -Encoding utf8 $pidFile

$url = "http://localhost:$targetPort"

Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Green
Write-Host "  RS INVENTORY V3 - STANDALONE UI PROTOTYPE IS RUNNING" -ForegroundColor Green
Write-Host "=====================================================================" -ForegroundColor Green
Write-Host "  URL:           $url" -ForegroundColor Yellow
Write-Host "  Directory:     $ProtoDir"
Write-Host "  Logs:          $outLog"
Write-Host "  To Stop:       Run dev\STOP-UI-PROTOTYPE.bat"
Write-Host "=====================================================================" -ForegroundColor Green
Write-Host ""

if (-not $NoBrowser) {
  Start-Process $url
}
