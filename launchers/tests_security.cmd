@echo off
chcp 65001 >nul
set NODE_NO_WARNINGS=1
cd /d "%~dp0.."
title PR6 - Security: unit + fuzz + invariant tests, OWASP SC Top 10, secrets
node scripts\run-tests.mjs
node scripts\owasp-check.mjs
node scripts\check-secrets.mjs
echo.
pause
