@echo off
chcp 65001 >nul
set NODE_NO_WARNINGS=1
cd /d "%~dp0.."
title PR6 - 30 runs of the end-to-end scenario (isolated stand)
node node_modules\tsx\dist\cli.mjs loadtest\e2e-run.ts
node loadtest\charts.mjs
start "" reports\load\charts-view.html
echo.
pause
