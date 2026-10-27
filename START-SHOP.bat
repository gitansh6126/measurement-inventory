@echo off
title RS Inventory - Shop (real company)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-server\start-shop.ps1" -Env client
pause
