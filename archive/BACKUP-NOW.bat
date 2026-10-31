@echo off
title RS Inventory - Backup now
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\local-server\backup.ps1" -Env client
pause
