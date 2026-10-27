@echo off
title RS Inventory (dev) - Demo (Build ^& Start)
echo Stops V3.1 Demo, builds the latest code, then starts the fast built app.
echo This takes a few minutes. Use it after code changes.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\local-server\stop.ps1" -Env demo
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\local-server\build.ps1" -Env demo
if errorlevel 1 (echo [!] Build failed - see the messages above. & pause & exit /b 1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\local-server\start.ps1" -Env demo -Prod
pause
