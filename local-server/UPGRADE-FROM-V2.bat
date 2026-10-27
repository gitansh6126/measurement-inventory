@echo off
title RS Inventory - Copy the shop data from V2
echo Copies the real company from V2 (C:\RS-Inventory-V2) into this app. V2 is only read.
set /p REPLACE=Replace data already here with a fresh copy (y/N)?
if /i "%REPLACE%"=="y" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0upgrade-from-v2.ps1" -Replace
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0upgrade-from-v2.ps1"
)
pause
