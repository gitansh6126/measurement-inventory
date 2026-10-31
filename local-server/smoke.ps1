# Read-only smoke test of the running app (archive\local-server\TEST-APP.bat). Nothing is saved.
#   powershell -ExecutionPolicy Bypass -File smoke.ps1 [-Env client|demo] [-Sheets <folder>]
# Signs in with the email / password typed here, opens every list, product, order and
# shortage / backorder report, and runs the import CHECK on every sheet in -Sheets
# (default: docs\import-samples). See app\api\scripts\upgrade-smoke.ts.
param(
  [ValidateSet("client", "demo")][string]$Env = "client",
  [string]$Sheets = (Join-Path (Split-Path $PSScriptRoot -Parent) "docs\import-samples")
)
. "$PSScriptRoot\common.ps1"

$cfg = Read-EnvFile (Get-EnvFile $Env)
$url = "http://127.0.0.1:$($cfg.WEB_PORT)"
try { Invoke-RestMethod "$url/api/version" -TimeoutSec 5 | Out-Null }
catch { Write-Host "[!] $AppTitle ($Env) is not running on $url. Start it first (START-SHOP.bat)." -ForegroundColor Red; exit 1 }

$email = Read-Host "Admin email"
$sec = Read-Host "Password" -AsSecureString
$env:SMOKE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$smokeArgs = @("--url", $url, "--email", $email)
if (Test-Path $Sheets) { $smokeArgs += @("--sheets", $Sheets) }
New-Item -ItemType Directory -Force $LogDir | Out-Null
Push-Location $ApiDir
try {
  node (Join-Path $AppRoot "node_modules\tsx\dist\cli.mjs") scripts/upgrade-smoke.ts @smokeArgs |
    Tee-Object -FilePath (Join-Path $LogDir "smoke-$Env-$(Get-Date -Format 'yyyyMMdd-HHmmss').log")
} finally { Remove-Item Env:SMOKE_PASSWORD -ErrorAction SilentlyContinue; Pop-Location }
