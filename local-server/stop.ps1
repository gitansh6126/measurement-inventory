# Stops V3 local environments started by start.ps1. Never touches V1 or V2.
#   powershell -ExecutionPolicy Bypass -File stop.ps1 [-Env client|demo|all]
param([ValidateSet("client", "demo", "all")][string]$Env = "all")
. "$PSScriptRoot\common.ps1"

$names = if ($Env -eq "all") { @("client", "demo") } else { @($Env) }
$v3App = $AppRoot.ToLower()

# Only node processes whose command line belongs to this V3 app folder are stopped.
function Stop-V3Process([int]$ProcessId) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $p -or $p.Name -ne "node.exe") { return }
  $cmd = "$($p.CommandLine)".ToLower().Replace("%20", " ").Replace("/", "\")
  if (-not $cmd.Contains($v3App)) { return }
  Write-Host "    stopping PID $ProcessId"
  taskkill /T /F /PID $ProcessId | Out-Null
}

foreach ($n in $names) {
  Write-Host "[*] Stopping $n..."
  $pidFile = Join-Path $RunDir "$n.json"
  if (Test-Path $pidFile) {
    try {
      $saved = Get-Content $pidFile -Raw | ConvertFrom-Json
      Stop-V3Process $saved.api
      Stop-V3Process $saved.web
    } catch { }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  }
  # Fallback: whatever still listens on this environment's ports
  $envFile = Get-EnvFile $n
  if (Test-Path $envFile) {
    try {
      $cfg = Read-EnvFile $envFile
      foreach ($port in @([int]$cfg.WEB_PORT, [int]$cfg.PORT)) {
        Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
          ForEach-Object { Stop-V3Process $_.OwningProcess }
      }
    } catch { }
  }
}
# Internet tunnel started by START-NETWORK-DEV.ps1 (cloudflared), if any.
$tunnelFile = Join-Path $RunDir "tunnel.json"
if (Test-Path $tunnelFile) {
  try {
    $t = Get-Content $tunnelFile -Raw | ConvertFrom-Json
    $p = Get-Process -Id $t.pid -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq "cloudflared") {
      Write-Host "[*] Stopping internet tunnel (PID $($t.pid))..."
      Stop-Process -Id $t.pid -Force
    }
  } catch { }
  Remove-Item $tunnelFile -Force -ErrorAction SilentlyContinue
}
Write-Host "[OK] Done." -ForegroundColor Green
