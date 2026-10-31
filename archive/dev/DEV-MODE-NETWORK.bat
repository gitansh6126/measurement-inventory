@echo off
title RS Inventory (dev) - Dev Mode on LAN + Internet
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\local-server\START-NETWORK-DEV.ps1" -Env demo
pause
