@echo off
chcp 65001 >nul
cd /d "%~dp0.."
title PR6 - STOP ALL
node scripts\reset.mjs
powershell -NoProfile -Command "Get-Process | Where-Object { $_.MainWindowTitle -match '^PR6 - [1-4] ' } | ForEach-Object { taskkill /PID $_.Id /T /F 2>$null | Out-Null }"
echo All PR6 processes stopped (ports 8545, 8787, 8788, 5173 are free).
timeout /t 3 >nul
