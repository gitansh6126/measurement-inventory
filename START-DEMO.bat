@echo off
title RS Inventory - Demo company (training data)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-server\start-shop.ps1" -Env demo
pause
