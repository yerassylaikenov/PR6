@echo off
chcp 65001 >nul
set NODE_NO_WARNINGS=1
cd /d "%~dp0.."
title PR6 - Acceptance tests AT-1..AT-7 (isolated stand, ~1.5 min)
node node_modules\tsx\dist\cli.mjs scripts\acceptance.ts
echo.
pause
