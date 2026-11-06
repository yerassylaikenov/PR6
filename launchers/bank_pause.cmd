@echo off
chcp 65001 >nul
set NODE_NO_WARNINGS=1
cd /d "%~dp0.."
title PR6 - Admin: pause bank (Module A)
node node_modules\tsx\dist\cli.mjs scripts\admin.ts pause
pause
