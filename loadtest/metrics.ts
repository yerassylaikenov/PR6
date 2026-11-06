import { resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import type { Hex } from "viem";
import { ROOT, loadDeployment, pub, paymentIdOf, ok, fail, head, info, C, writeJson, sleep } from "../scripts/lib/common.ts";
import { createOrder, approveOrder, send } from "../scripts/lib/flow.ts";
import { orderSummary } from "../scripts/lib/trace.ts";
import { startStand, startOrchestrator, stopAll, type StandConfig } from "../scripts/lib/stand.ts";
import { consistent } from "../orchestrator/reconcile.ts";

const WARMUP = 2;
const RUNS = Number(process.env.RUNS ?? 30);
const OUT = resolve(ROOT, "reports/load");

async function poll<T>(fn: () => Promise<T | undefined>, timeoutMs = 20000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { const v = await fn(); if (v !== undefined) return v; await sleep(20); }
  throw new Error("timeout");
}
const nearestRank = (sorted: number[], p: number) => sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];

export async function run(cfg: StandConfig) {
  head(`E2E EXPERIMENT - ${RUNS} runs (+${WARMUP} warm-up) of the full business scenario`);
  info("fresh deploy on isolated Hardhat node :8547, automine, live orchestrator (polling 250 ms), same order every run");
  await startStand(cfg);
  await startOrchestrator(cfg);
  const dep = loadDeployment();
  ok("stand ready");
  const rows: any[] = [];
  for (let i = -WARMUP; i < RUNS; i++) {
    const t0 = Date.now();
    let success = false, discrepancy = false, error = "";
    const r: any = { run: i + 1 };
    try {
      const o = await createOrder(dep, "supplier1", [{ sku: "AGR-001", qty: 3 }, { sku: "AGR-004", qty: 5 }]);
      const ap = await approveOrder(dep, o.orderId, "supplier1");
      const tB = Date.now();
      await poll(async () => { const l: any = await pub.readContract({ ...dep.contracts.hub, functionName: "getOrder", args: [o.orderId] }); return l.status === 1 ? l : undefined; });
      const tLinked = Date.now();
      const ex = await send(dep, "settlement", "bank", "markExecuted", [paymentIdOf(o.orderId, 1)]);
      const tA = Date.now();
      await poll(async () => { const l: any = await pub.readContract({ ...dep.contracts.hub, functionName: "getOrder", args: [o.orderId] }); return l.status >= 2 ? l : undefined; });
      const tF = Date.now();
      const s = await orderSummary(dep, o.orderNo);
      discrepancy = consistent(s) !== null;
      success = s.hub.status === "Paid" && !discrepancy;
      const gasOf = async (step: string) => { const st = s.steps.find((x) => x.step === step); return st ? (await pub.getTransactionReceipt({ hash: st.txHash as Hex })).gasUsed : 0n; };
      Object.assign(r, {
        orderNo: o.orderNo, totalMs: tF - t0, stageB_ms: tB - t0, transferMs: tLinked - tB, stageA_ms: tA - tLinked, finalizeMs: tF - tA,
        gasCreatePO: o.tx.gasUsed, gasApprovePO: ap.gasUsed, gasRegister: await gasOf("Payment registered"), gasLink: await gasOf("Hub linked"),
        gasExecute: ex.gasUsed, gasFinalize: await gasOf("Hub finalized"),
      });
    } catch (e) { error = String((e as Error).message); }
    Object.assign(r, { success, discrepancy, error });
    if (i < 0) { info(`warm-up ${i + WARMUP + 1}: ${r.totalMs} ms (not counted)`); continue; }
    rows.push(r);
    console.log(`${success ? C.g + "✔" : C.r + "✘"}${C.x} run ${String(r.run).padStart(2)}  ${r.orderNo}  total ${String(r.totalMs).padStart(5)} ms  (B ${r.stageB_ms} | transfer ${r.transferMs} | A ${r.stageA_ms} | finalize ${r.finalizeMs})${error ? " " + error : ""}`);
  }
  stopAll();

  const okRows = rows.filter((r) => r.success);
  const lat = okRows.map((r) => r.totalMs).sort((a, b) => a - b);
  const mean = (k: string) => Math.round(okRows.reduce((s, r) => s + Number(r[k]), 0) / Math.max(1, okRows.length));
  const metrics = {
    ts: new Date().toISOString(), runs: rows.length, warmup: WARMUP,
    successRate: okRows.length / rows.length, successCount: okRows.length, discrepancies: rows.filter((r) => r.discrepancy).length,
    latencyMs: { p50: nearestRank(lat, 50), p95: nearestRank(lat, 95), min: lat[0], max: lat[lat.length - 1], mean: mean("totalMs") },
    stagesMeanMs: { moduleB: mean("stageB_ms"), transfer: mean("transferMs"), moduleA: mean("stageA_ms"), finalize: mean("finalizeMs") },
    gasMean: { createPO: mean("gasCreatePO"), approvePO: mean("gasApprovePO"), registerPayment: mean("gasRegister"), linkPayment: mean("gasLink"), markExecuted: mean("gasExecute"), finalize: mean("gasFinalize") },
    method: "nearest-rank percentiles; clearing execution is performed by the script on behalf of the clearing center (SETTLEMENT_ROLE); timestamps by wall clock in the client; hub state polled every 20 ms",
  };
  mkdirSync(OUT, { recursive: true });
  const cols = Object.keys(rows[0]);
  writeFileSync(resolve(OUT, "e2e-raw.csv"), [cols.join(","), ...rows.map((r) => cols.map((c) => String(r[c] ?? "")).join(","))].join("\n") + "\n");
  writeJson(resolve(OUT, "e2e-metrics.json"), metrics);
  const st = metrics.stagesMeanMs;
  const slowest = Object.entries(st).sort((a, b) => b[1] - a[1])[0];
  writeFileSync(resolve(OUT, "SUMMARY.md"), [
    "# E2E experiment: 30 runs of the business scenario", "",
    `Run: ${metrics.ts}. Conditions: fresh deploy, Hardhat automine (:8547), live orchestrator (event polling 250 ms), identical order (2 items), ${WARMUP} warm-up runs excluded.`, "",
    "| Metric | Value |", "|---|---|",
    `| Successful operations | ${okRows.length}/${rows.length} (${(metrics.successRate * 100).toFixed(1)}%) |`,
    `| State discrepancies | ${metrics.discrepancies} |`,
    `| Latency p50 | ${metrics.latencyMs.p50} ms |`, `| Latency p95 | ${metrics.latencyMs.p95} ms |`,
    `| Latency min / max / mean | ${metrics.latencyMs.min} / ${metrics.latencyMs.max} / ${metrics.latencyMs.mean} ms |`, "",
    "## Stage breakdown (mean)", "", "| Stage | ms |", "|---|---|",
    `| Module B (createPO + approvePO) | ${st.moduleB} |`, `| Transfer B→A (orchestrator: registerPayment + linkPayment) | ${st.transfer} |`,
    `| Module A (markExecuted) | ${st.moduleA} |`, `| Finalization (orchestrator: hub.finalize) | ${st.finalize} |`, "",
    "## Gas (mean gasUsed)", "", "| Step | gas |", "|---|---|", ...Object.entries(metrics.gasMean).map(([k, v]) => `| ${k} | ${v} |`), "",
    "## Analysis", "",
    `Limiting component: **${slowest[0]}** (${slowest[1]} ms on average). The two automatic stages (transfer and finalization) are dominated by the orchestrator's event polling interval (250 ms) plus sequential waiting for receipts of two/one transactions; contract execution itself is ~1 block per tx on automine.`,
    "Optimization: subscribe to events via WebSocket (eth_subscribe) instead of HTTP polling, or reduce pollingInterval to 100 ms; registerPayment and linkPayment cannot be parallelised because the hub reads the registered payment.", "",
  ].join("\n"));

  head("RESULTS");
  ok(`success rate ${okRows.length}/${rows.length} = ${(metrics.successRate * 100).toFixed(1)}%`);
  metrics.discrepancies === 0 ? ok("state discrepancies: 0") : fail(`state discrepancies: ${metrics.discrepancies}`);
  ok(`latency p50 = ${metrics.latencyMs.p50} ms, p95 = ${metrics.latencyMs.p95} ms (min ${metrics.latencyMs.min}, max ${metrics.latencyMs.max})`);
  ok(`stages mean: B ${st.moduleB} ms | transfer ${st.transfer} ms | A ${st.moduleA} ms | finalize ${st.finalize} ms`);
  ok("saved reports/load/e2e-raw.csv, e2e-metrics.json, SUMMARY.md");
  process.exit(metrics.successRate === 1 ? 0 : 1);
}
