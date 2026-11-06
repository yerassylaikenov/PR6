@echo off
REM Opens 5 terminal windows with the saved results of the real runs (green checks).
REM Works any time - no running node is required.
chcp 65001 >nul
cd /d "%~dp0.."
set ROOT=%CD%
start "" /D "%ROOT%" conhost.exe cmd /k "title PR6 - Task 1 Integration design & chcp 65001>nul & mode con cols=135 lines=48 & node scripts\show-results.mjs task1"
start "" /D "%ROOT%" conhost.exe cmd /k "title PR6 - Task 2 Unified MVP & chcp 65001>nul & mode con cols=135 lines=48 & node scripts\show-results.mjs task2"
start "" /D "%ROOT%" conhost.exe cmd /k "title PR6 - Task 3 Acceptance, monitoring, 30 runs & chcp 65001>nul & mode con cols=135 lines=50 & node scripts\show-results.mjs task3"
start "" /D "%ROOT%" conhost.exe cmd /k "title PR6 - Security 1 Unit, fuzz, invariant tests & chcp 65001>nul & mode con cols=135 lines=48 & node scripts\show-results.mjs tests"
start "" /D "%ROOT%" conhost.exe cmd /k "title PR6 - Security 2 OWASP SC Top 10 2025 & chcp 65001>nul & mode con cols=135 lines=48 & node scripts\show-results.mjs owasp"
