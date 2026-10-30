# Puts the shop shortcuts on this Windows user's desktop (run by setup.ps1 and update.ps1; safe to run again).
#   powershell -ExecutionPolicy Bypass -File create-shortcuts.ps1
# Shop / Demo / Stop / Update / Backup now. Each one opens a black window that shows what it does.
# Old and existing shortcuts are cleanly deleted before applying the new shortcuts on Windows.
. "$PSScriptRoot\common.ps1"

$desktop = [Environment]::GetFolderPath("Desktop")
$ws = New-Object -ComObject WScript.Shell

# 1. Clean up existing, old or stale shortcuts from the desktop
$stalePatterns = @(
  "$AppTitle*.lnk",
  "RS Inventory*.lnk",
  "Stop RS Inventory*.lnk",
  "start - Shortcut.lnk"
)
$cleaned = 0
foreach ($pat in $stalePatterns) {
  Get-ChildItem -Path $desktop -Filter $pat -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
      $cleaned++
    } catch { }
  }
}
$commonDesktop = [Environment]::GetFolderPath("CommonDesktopDirectory")
if ($commonDesktop -and (Test-Path $commonDesktop)) {
  foreach ($pat in $stalePatterns) {
    Get-ChildItem -Path $commonDesktop -Filter $pat -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
        $cleaned++
      } catch { }
    }
  }
}
if ($cleaned -gt 0) {
  Write-Host "    deleted $cleaned old/existing shortcuts from desktop" -ForegroundColor Yellow
}

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
  $shortcutPath = Join-Path $desktop "$($l.Name).lnk"
  $s = $ws.CreateShortcut($shortcutPath)
  $s.TargetPath = $target
  $s.WorkingDirectory = $V3Root
  $s.IconLocation = "shell32.dll,$($l.Icon)"
  $s.Description = $l.Tip
  $s.Save()
  $made++
}
Write-Host "    created $made fresh shortcuts on $desktop"
