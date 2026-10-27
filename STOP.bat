@echo off
title Stop RS Inventory
rem Stops the shop app and the demo. Never touches V2.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-server\stop.ps1" -Env all
pause
