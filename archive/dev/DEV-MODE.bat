@echo off
title RS Inventory (dev) - Dev Mode (Hot Reload)
rem Code changes show at once. Switches from the built Demo if that is running.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\local-server\start.ps1" -Env demo -Dev
pause
