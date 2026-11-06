@echo off
chcp 65001 >nul
set NODE_NO_WARNINGS=1
cd /d "%~dp0.."
title PR6 - Trace order
set /p ORDER=Order number (for example PO-2026-000003):
node node_modules\tsx\dist\cli.mjs scripts\trace.ts %ORDER%
echo.
pause
