@echo off
title RS Inventory - Update to the newest release
rem Backs up, installs the newest release from GitHub, restarts. Rolls back by itself if it fails.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-server\update.ps1" %*
pause
