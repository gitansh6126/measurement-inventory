@echo off
title RS Inventory - Read-only smoke test
rem Signs in, opens every list / product / order / backorder report and CHECKS (never imports)
rem every .xlsx / .csv in docs\import-samples (put your own sheets there; the file name must say
rem products, stock, purchases or sales). Nothing is saved.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0smoke.ps1"
pause
