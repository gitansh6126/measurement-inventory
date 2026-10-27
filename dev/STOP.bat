@echo off
title Stop RS Inventory (dev)
rem Stops V3.1 Demo / Dev (API + web) and the internet tunnel. Never touches V1 or V2.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\local-server\stop.ps1"
pause
