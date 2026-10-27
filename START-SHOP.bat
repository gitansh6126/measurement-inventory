@echo off
title RS Inventory - Start Shop (all Wi-Fi devices)
rem Starts the real company (port 3210) and the demo company (port 3310) for every phone / PC
rem on the shop Wi-Fi. The Windows Startup shortcut runs it with -AutoStart (no prompts, no pause).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-server\start-shop.ps1" -Env all %*
if /i not "%~1"=="-AutoStart" pause
