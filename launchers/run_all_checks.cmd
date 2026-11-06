@echo off
chcp 65001 >nul
set NODE_NO_WARNINGS=1
cd /d "%~dp0.."
title PR6 - Re-run ALL checks (tests, OWASP, acceptance, 30 runs, CI) ~4 min
echo Re-running every check from scratch. Results are saved to reports\ and shown at the end.
call node scripts\ci-local.mjs
node node_modules\tsx\dist\cli.mjs scripts\acceptance.ts
node node_modules\tsx\dist\cli.mjs loadtest\e2e-run.ts
node loadtest\charts.mjs
call "%~dp0show_results.cmd"
pause
