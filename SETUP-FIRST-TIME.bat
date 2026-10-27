@echo off
title RS Inventory - First-time setup
rem One time, after: git clone <repository URL> C:\RS-Inventory   (see README.md)
rem Installs Git / Node.js / PostgreSQL if missing, databases, settings, demo data, desktop shortcuts.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-server\install-all.ps1"
pause
