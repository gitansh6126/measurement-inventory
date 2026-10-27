param(
  [ValidateSet("client", "demo")][string]$Env = "demo"
)
. "$PSScriptRoot\common.ps1"

$envFile = Get-EnvFile $Env
$cfg = Read-EnvFile $envFile
$webPort = [int]$cfg.WEB_PORT
$apiPort = [int]$cfg.PORT

$global:LASTEXITCODE = 0

& "$PSScriptRoot\start.ps1" -Env $Env -NoBrowser

$jsonFile = Join-Path $RunDir "$Env.json"
if (-not (Test-Path $jsonFile)) {
  Write-Error "Could not find $jsonFile"
  exit 1
}

$procInfo = Get-Content $jsonFile | ConvertFrom-Json
Write-Host "[*] V3 ($Env) server holding process active (API PID: $($procInfo.api), Web PID: $($procInfo.web))."

while ($true) {
  Start-Sleep -Seconds 10
  $apiListen = Test-PortInUse $apiPort
  $webListen = Test-PortInUse $webPort
  if (-not $apiListen -or -not $webListen) {
    Write-Host "[!] Process terminated or port closed. Exiting monitor."
    break
  }
}
