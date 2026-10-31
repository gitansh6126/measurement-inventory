@echo off
title RS Inventory (dev) - Demo (Built, fast)
rem Starts the built app; rebuilds first when the code changed since the last build. Switches from Dev mode if that is running.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\local-server\start.ps1" -Env demo -Prod
pause
