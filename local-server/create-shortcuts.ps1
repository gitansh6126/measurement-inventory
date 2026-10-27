# Puts the shop shortcuts on this Windows user's desktop (run by setup.ps1; safe to run again).
#   powershell -ExecutionPolicy Bypass -File create-shortcuts.ps1
# Shop / Demo / Stop / Update / Backup now. Each one opens a black window that shows what it does.
# Old "RS Inventory V3.1 ..." shortcuts from the ZIP install are not touched: delete them by hand.
. "$PSScriptRoot\common.ps1"

$desktop = [Environment]::GetFolderPath("Desktop")
$ws = New-Object -ComObject WScript.Shell
$links = @(
  @{ Name = "$AppTitle - Shop"; Bat = "START-SHOP.bat"; Icon = 13; Tip = "Starts the real company for all shop devices" },
  @{ Name = "$AppTitle - Demo"; Bat = "START-DEMO.bat"; Icon = 18; Tip = "Starts the demo company (sample data for training)" },
  @{ Name = "$AppTitle - Stop"; Bat = "STOP.bat"; Icon = 27; Tip = "Stops the shop and demo apps" },
  @{ Name = "$AppTitle - Update"; Bat = "UPDATE.bat"; Icon = 238; Tip = "Backs up, installs the newest release, restarts (rolls back by itself if it fails)" },
  @{ Name = "$AppTitle - Backup now"; Bat = "BACKUP-NOW.bat"; Icon = 7; Tip = "Backup of the real company now (also automatic every night)" }
)
$made = 0
foreach ($l in $links) {
  $target = Join-Path $V3Root $l.Bat
  if (-not (Test-Path $target)) { Write-Host "    missing $target (skipped)" -ForegroundColor Yellow; continue }
  $s = $ws.CreateShortcut((Join-Path $desktop "$($l.Name).lnk"))
  $s.TargetPath = $target
  $s.WorkingDirectory = $V3Root
  $s.IconLocation = "shell32.dll,$($l.Icon)"
  $s.Description = $l.Tip
  $s.Save()
  $made++
}
Write-Host "    created $made shortcuts on $desktop"
