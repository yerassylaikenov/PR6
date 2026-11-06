# Screenshot session: starts the REAL stack in visible console windows on this laptop, runs the
# scenario, and captures every window to reports\screenshots\. Usage (from the project root):
#   powershell -ExecutionPolicy Bypass -File scripts\take-screenshots.ps1
param([switch]$Quick, [switch]$ShowOnly)
$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent $PSScriptRoot
Set-Location $ROOT
$SHOTS = Join-Path $ROOT "reports\screenshots"
New-Item -ItemType Directory -Force $SHOTS | Out-Null
$env:NODE_NO_WARNINGS = "1"
$wins = @()

function Open-Console([string]$title, [string]$cmd, [string]$size = "cols=150 lines=45", [string]$dir = $ROOT) {
  $modePart = if ($size) { "mode con $size & " } else { "" }
  $p = Start-Process conhost.exe -ArgumentList "cmd /k `"title $title & chcp 65001>nul & $modePart$cmd`"" -WorkingDirectory $dir -PassThru
  $script:wins += $p
  return $p
}
function Capture([string]$title, [string]$file) {
  powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "capture-window.ps1") -Title $title -Out (Join-Path $SHOTS $file)
}
function Wait-Port([int]$port) { node scripts\wait-port.mjs $port 120000 | Out-Null }
function Wait-File([string]$path, [datetime]$after, [int]$timeoutSec = 300) {
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $timeoutSec) {
    if ((Test-Path $path) -and ((Get-Item $path).LastWriteTime -gt $after)) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "timeout waiting for $path"
}
function Capture-Views {
  $views = @(
    @("PR6 - Task 1 Integration design", "task1", "lines=48", "show_01_task1_design.png"),
    @("PR6 - Task 2 Unified MVP", "task2", "lines=48", "show_02_task2_mvp.png"),
    @("PR6 - Task 3 Acceptance, monitoring, 30 runs", "task3", "lines=50", "show_03_task3_acceptance.png"),
    @("PR6 - Security 1 Unit, fuzz, invariant tests", "tests", "lines=50", "show_04_security_tests.png"),
    @("PR6 - Security 2 OWASP SC Top 10 2025", "owasp", "lines=48", "show_05_security_owasp.png")
  )
  foreach ($v in $views) {
    Open-Console $v[0] "node scripts\show-results.mjs $($v[1])" "cols=135 $($v[2])" | Out-Null
    Start-Sleep 3
    Capture $v[0] $v[3]
  }
}
if ($ShowOnly) {
  Capture-Views
  foreach ($p in $wins) { try { taskkill /PID $p.Id /T /F 2>$null | Out-Null } catch {} }
  Write-Host "DONE (views)" -ForegroundColor Green
  exit 0
}

Write-Host "== stack via launchers\start_all.cmd (the same launcher the user runs) ==" -ForegroundColor Cyan
$env:PR6_NO_BROWSER = "1"
$p = Start-Process conhost.exe -ArgumentList "cmd /c `"launchers\start_all.cmd`"" -WorkingDirectory $ROOT -PassThru
$script:wins += $p
Start-Sleep 5
Wait-Port 8545; Wait-Port 8787; Wait-Port 8788; Wait-Port 5173
Start-Sleep 4
Capture "PR6 - START ALL" "term_01_start_all_deploy_seed.png"

Write-Host "== demo e2e ==" -ForegroundColor Cyan
$t = Get-Date
Open-Console "PR6 - Demo E2E" "node node_modules\tsx\dist\cli.mjs scripts\demo-e2e.ts" "cols=175 lines=40" | Out-Null
Wait-File (Join-Path $ROOT "reports\e2e\demo-e2e.json") $t 120
Start-Sleep 2
Capture "PR6 - Demo E2E" "term_02_demo_e2e_paid.png"

Write-Host "== web UI scenario (Edge) ==" -ForegroundColor Cyan
node scripts\screenshots-web.mjs
Start-Sleep 3
Capture "PR6 - 2 Orchestrator" "term_03_orchestrator_auto_steps.png"
Capture "PR6 - 3 Monitor" "term_04_monitor_telemetry_R1.png"
Capture "PR6 - 1 Hardhat node" "term_05_hardhat_node.png"

Write-Host "== trace ==" -ForegroundColor Cyan
Open-Console "PR6 - Trace" "node node_modules\tsx\dist\cli.mjs scripts\trace.ts PO-2026-000004" "cols=170 lines=34" | Out-Null
Start-Sleep 12
Capture "PR6 - Trace" "term_06_trace_order.png"

if ($Quick) {
  foreach ($p in $wins) { try { taskkill /PID $p.Id /T /F 2>$null | Out-Null } catch {} }
  & (Join-Path $ROOT "launchers\stop_all.cmd") | Out-Null
  Write-Host "DONE (quick)" -ForegroundColor Green
  exit 0
}

Write-Host "== acceptance AT-1..AT-7 ==" -ForegroundColor Cyan
$t = Get-Date
Open-Console "PR6 - Acceptance AT-1..AT-7" "node node_modules\tsx\dist\cli.mjs scripts\acceptance.ts" "cols=175 lines=52" | Out-Null
Wait-File (Join-Path $ROOT "reports\acceptance\summary.json") $t 400
Start-Sleep 2
Capture "PR6 - Acceptance" "term_07_acceptance_summary.png"

Write-Host "== tests / OWASP / CI ==" -ForegroundColor Cyan
$t = Get-Date
Open-Console "PR6 - CI local" "node scripts\ci-local.mjs" "cols=150 lines=24" | Out-Null
Wait-File (Join-Path $ROOT "reports\ci\summary.json") $t 400
Start-Sleep 2
Capture "PR6 - CI local" "term_08_ci_local.png"

Write-Host "== charts ==" -ForegroundColor Cyan
node scripts\screenshot-charts.mjs

Write-Host "== saved results windows ==" -ForegroundColor Cyan
Capture-Views

Write-Host "== closing screenshot windows ==" -ForegroundColor Cyan
foreach ($p in $wins) { try { taskkill /PID $p.Id /T /F 2>$null | Out-Null } catch {} }
& (Join-Path $ROOT "launchers\stop_all.cmd") | Out-Null
Write-Host "DONE - screenshots in reports\screenshots" -ForegroundColor Green
