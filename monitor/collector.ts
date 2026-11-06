// Unified monitoring collector for both modules + hub + orchestrator + web.
// One telemetry format, correlationId = orderId. HTTP: POST /log, GET /alerts, GET /health.
import { createServer } from "node:http";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import type { Hex } from "viem";
import { ROOT, pub, loadDeployment, appendLine, paymentIdOf, C, ok, head, info } from "../scripts/lib/common.ts";
import { orderNoMap } from "../scripts/lib/flow.ts";
import { AlertSink } from "./alerts.ts";
import { RuleEngine, type TelemetryRecord } from "./rules.ts";

const DIR = resolve(ROOT, process.env.MONITOR_DIR ?? "reports/monitoring");
mkdirSync(DIR, { recursive: true });
const TELEMETRY = resolve(DIR, "telemetry.jsonl");
const alerts = new AlertSink(resolve(DIR, "alerts.jsonl"));
const rules = new RuleEngine(alerts);
const dep = loadDeployment();
const port = Number(process.env.MONITOR_PORT ?? 8787);
const R3_DELAY_MS = Number(process.env.R3_DELAY_MS ?? 30_000);
let count = 0;

// paymentId -> orderId, so bank records are correlated by orderId as well
const paymentToOrder = new Map<string, string>();
async function refreshPaymentMap() {
  const n = Number(await pub.readContract({ ...dep.contracts.retail, functionName: "orderCount" }));
  for (let i = 0; i < n; i++) {
    const id = (await pub.readContract({ ...dep.contracts.retail, functionName: "orderIdAt", args: [BigInt(i)] })) as Hex;
    for (let a = 1; a <= 10; a++) paymentToOrder.set(paymentIdOf(id, a).toLowerCase(), id);
  }
}
const corr = (id?: string) => (id ? paymentToOrder.get(id.toLowerCase()) ?? id : undefined);

function record(rec: TelemetryRecord) {
  // never log secrets: only whitelisted fields are stored
  const clean = {
    ts: rec.ts ?? new Date().toISOString(), correlationId: corr(rec.correlationId), module: rec.module, category: rec.category,
    actor: rec.actor, txHash: rec.txHash, blockNumber: rec.blockNumber, outcome: rec.outcome, errorName: rec.errorName,
    severity: rec.severity, step: rec.step,
  };
  appendLine(TELEMETRY, JSON.stringify(clean));
  count++;
  const col = clean.outcome === "success" ? C.g : C.r;
  console.log(`${C.d}${clean.ts.slice(11, 19)}${C.x} ${col}●${C.x} ${String(clean.module).padEnd(12)} ${String(clean.step ?? clean.category).padEnd(26)} ${clean.outcome}${clean.errorName ? " " + clean.errorName : ""} ${C.d}${clean.correlationId?.slice(0, 12) ?? ""}${C.x}`);
  rules.ingest(clean as TelemetryRecord);
}

// --- HTTP endpoint ---------------------------------------------------------
createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method === "POST" && req.url === "/log") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 10_000) req.destroy(); });
    req.on("end", () => { try { record(JSON.parse(body)); res.end('{"ok":true}'); } catch { res.writeHead(400); res.end(); } });
    return;
  }
  res.setHeader("content-type", "application/json");
  if (req.url === "/alerts") { res.end(JSON.stringify(alerts.recent)); return; }
  if (req.url === "/health") { res.end(JSON.stringify({ ok: true, records: count, alerts: alerts.recent.length })); return; }
  res.writeHead(404); res.end();
}).listen(port, "127.0.0.1");

// --- Chain collector: events of all three contracts ------------------------
let fromBlock = 0n;
const EVENT_MODULE: Record<string, string> = { retail: "retail", bank: "bank", hub: "hub" };
async function pollEvents() {
  const latest = await pub.getBlockNumber();
  if (latest < fromBlock) return;
  await refreshPaymentMap();
  for (const [k, c] of Object.entries(dep.contracts)) {
    const logs: any[] = await pub.getContractEvents({ ...c, fromBlock, toBlock: latest } as any);
    for (const l of logs) {
      const a = l.args ?? {};
      const corr = a.poId ?? a.orderId ?? a.paymentId;
      record({ ts: new Date().toISOString(), correlationId: corr, module: EVENT_MODULE[k], category: "event", step: l.eventName, actor: a.operator ?? a.actor ?? a.retailer ?? a.supplier, txHash: l.transactionHash, blockNumber: String(l.blockNumber), outcome: "success" });
    }
  }
  fromBlock = latest + 1n;
}

// --- R-3 (a)/(c): cross-module state discrepancy ---------------------------
const stuckSince = new Map<string, number>();
async function crossCheck() {
  const names = orderNoMap();
  const n = Number(await pub.readContract({ ...dep.contracts.retail, functionName: "orderCount" }));
  for (let i = 0; i < n; i++) {
    const id = (await pub.readContract({ ...dep.contracts.retail, functionName: "orderIdAt", args: [BigInt(i)] })) as Hex;
    const po: any = await pub.readContract({ ...dep.contracts.retail, functionName: "getPO", args: [id] });
    const link: any = await pub.readContract({ ...dep.contracts.hub, functionName: "getOrder", args: [id] });
    const name = names.get(id.toLowerCase()) ?? id.slice(0, 12);
    let settled = false; let live = false;
    for (let a = 1; a <= 10; a++) {
      const p: any = await pub.readContract({ ...dep.contracts.bank, functionName: "getPayment", args: [paymentIdOf(id, a)] });
      if (p.status === 0) break;
      if (p.status === 1) live = true;
      if ((p.status === 2 || p.status === 3) && link.status < 2) settled = true;
    }
    if (po.status === 3 && live) rules.crossModule(id, name, "c", "PO cancelled in Module B while payment is live in Module A");
    if (settled) {
      const since = stuckSince.get(id) ?? Date.now();
      stuckSince.set(id, since);
      if (Date.now() - since > R3_DELAY_MS) rules.crossModule(id, name, "a", `payment settled in Module A but hub not finalized for ${Math.round((Date.now() - since) / 1000)}s`);
    } else stuckSince.delete(id);
  }
}

head("UNIFIED MONITOR (retail + bank + hub + orchestrator + web)");
ok(`HTTP collector http://127.0.0.1:${port}  (POST /log, GET /alerts, GET /health)`);
ok(`telemetry -> ${TELEMETRY.replace(ROOT, ".")}`);
ok("rules: R-1 access violation (High) | R-2 operational failure (Medium) | R-3 cross-module discrepancy (High)");
info(`correlationId = orderId; R-3 delay ${R3_DELAY_MS / 1000}s; cooldown 5 min per rule+key`);

setInterval(() => { pollEvents().catch(() => {}); }, 1000);
setInterval(() => { crossCheck().catch(() => {}); }, 2000);
