@echo off
chcp 65001 >nul
set NODE_NO_WARNINGS=1
cd /d "%~dp0.."
set ROOT=%CD%
title PR6 - START ALL
mode con cols=135 lines=48
echo ================================================================
echo  PR6 MVP - starting the whole stack
echo ================================================================
echo [0/6] stopping old processes and clearing demo state...
node scripts\reset.mjs
echo [1/6] Hardhat node  -^> window "PR6 - 1 Hardhat node :8545"
start "" /D "%ROOT%" conhost.exe cmd /k "title PR6 - 1 Hardhat node :8545 & set NODE_NO_WARNINGS=1 & node node_modules\hardhat\dist\src\cli.js node"
node scripts\wait-port.mjs 8545 || goto :err
echo [2/6] deploying Module A + Module B + Hub and granting roles...
node node_modules\tsx\dist\cli.mjs scripts\deploy-all.ts || goto :err
echo [3/6] seeding catalog and 2 historical orders...
node node_modules\tsx\dist\cli.mjs scripts\seed.ts || goto :err
echo [4/6] Monitor       -^> window "PR6 - 3 Monitor :8787"
start "" /D "%ROOT%" conhost.exe cmd /k "title PR6 - 3 Monitor :8787 & chcp 65001>nul & set NODE_NO_WARNINGS=1 & node node_modules\tsx\dist\cli.mjs monitor\collector.ts"
node scripts\wait-port.mjs 8787 || goto :err
echo [5/6] Orchestrator  -^> window "PR6 - 2 Orchestrator :8788"
start "" /D "%ROOT%" conhost.exe cmd /k "title PR6 - 2 Orchestrator :8788 & chcp 65001>nul & set NODE_NO_WARNINGS=1 & node node_modules\tsx\dist\cli.mjs orchestrator\index.ts"
node scripts\wait-port.mjs 8788 || goto :err
echo [6/6] Web UI        -^> window "PR6 - 4 Web UI :5173"
start "" /D "%ROOT%\web" conhost.exe cmd /k "title PR6 - 4 Web UI :5173 & node node_modules\vite\bin\vite.js --port 5173 --strictPort"
node scripts\wait-port.mjs 5173 || goto :err
if not defined PR6_NO_BROWSER start "" http://localhost:5173
echo.
echo  STACK IS UP:  http://localhost:5173   (opened in the default browser)
echo  Next: launchers\demo_e2e.cmd  or the live scenario in the browser (see DEMO.md)
echo.
pause
exit /b 0
:err
echo.
echo  ERROR - see the output above. Try launchers\stop_all.cmd and start again.
pause
exit /b 1
