# Puts the shop shortcuts on this Windows user's desktop (run by setup.ps1 and after every
# update; safe to run again).
#   powershell -ExecutionPolicy Bypass -File create-shortcuts.ps1 [-NoAutoStart]
# Desktop: Start Shop (real + demo company, all Wi-Fi devices) / Stop Server / Update.
# Windows Startup folder: "RS Inventory - Auto start" runs START-SHOP.bat -AutoStart at every
# sign-in (minimized, no prompts). -NoAutoStart removes it instead.
# Every shortcut opens a .bat file (never a .ps1, which Windows would open in Notepad).
param([switch]$NoAutoStart)
. "$PSScriptRoot\common.ps1"

$desktop = [Environment]::GetFolderPath("Desktop")
$startup = [Environment]::GetFolderPath("Startup")
$ws = New-Object -ComObject WScript.Shell

# Shortcuts made by older releases (any name); this script owns them, so they are replaced.
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

function New-Link([string]$Path, [string]$Bat, [string]$BatArgs, [int]$Icon, [string]$Tip, [int]$Window = 1) {
  $target = Join-Path $V3Root $Bat
  if (-not (Test-Path $target)) { Write-Host "    missing $target (skipped)" -ForegroundColor Yellow; return $false }
  $s = $ws.CreateShortcut($Path)
  $s.TargetPath = $target
  $s.Arguments = $BatArgs
  $s.WorkingDirectory = $V3Root
  $s.IconLocation = "shell32.dll,$Icon"
  $s.Description = $Tip
  $s.WindowStyle = $Window
  $s.Save()
  return $true
}

$links = @(
  @{ Name = "$AppTitle - Start Shop"; Bat = "START-SHOP.bat"; Icon = 13; Tip = "Starts the real company and the demo company for all shop Wi-Fi devices" },
  @{ Name = "$AppTitle - Stop Server"; Bat = "STOP.bat"; Icon = 27; Tip = "Stops the shop and demo apps" },
  @{ Name = "$AppTitle - Update"; Bat = "UPDATE.bat"; Icon = 238; Tip = "Backs up, installs the newest release, restarts (rolls back by itself if it fails)" }
)
$made = 0
foreach ($l in $links) { if (New-Link (Join-Path $desktop "$($l.Name).lnk") $l.Bat "" $l.Icon $l.Tip) { $made++ } }
Write-Host "    created $made shortcuts on $desktop"

$auto = Join-Path $startup "$AppTitle - Auto start.lnk"
if ($NoAutoStart) {
  Remove-Item $auto -Force -ErrorAction SilentlyContinue
  Write-Host "    auto start at sign-in: off"
} else {
  # 7 = minimized: the window only shows in the taskbar.
  if (New-Link $auto "START-SHOP.bat" "-AutoStart" 13 "Starts the shop app at Windows sign-in" 7) {
    Write-Host "    auto start at sign-in: on ($auto)"
  }
  # The older scheduled start tasks would start a second copy at the same moment.
  foreach ($t in "$TaskPrefix - Start", "$TaskPrefix - Start demo") {
    try { Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction Stop } catch { }
  }
}
