@echo off
chcp 65001 >nul
set NODE_NO_WARNINGS=1
cd /d "%~dp0.."
title PR6 - Demo E2E (fully automatic scenario)
REM requires the running stack (launchers\start_all.cmd)
node node_modules\tsx\dist\cli.mjs scripts\demo-e2e.ts
echo.
pause
