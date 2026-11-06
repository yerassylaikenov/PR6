// npm run trace -- PO-2026-000001 : end-to-end order history from blockchain + telemetry.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, loadDeployment, ok, fail, head, C, orderIdOf } from "./lib/common.ts";
import { orderSummary } from "./lib/trace.ts";

const orderNo = process.argv[2];
if (!orderNo) { console.log("usage: npm run trace -- PO-2026-000001"); process.exit(1); }
const dep = loadDeployment();
const s = await orderSummary(dep, orderNo);
head(`TRACE ${orderNo}   orderId ${s.orderId}`);
if (s.po.status === "None") { fail("order not found on-chain"); process.exit(1); }
for (const st of s.steps) {
  const time = st.ts ? new Date(st.ts * 1000).toISOString().slice(11, 19) : "";
  console.log(`  ${C.g}✔${C.x}  ${time} ${st.module.padEnd(7)} ${st.step.padEnd(20)} block ${String(st.block).padStart(4)} ${st.txHash} ${C.d}${st.detail ?? ""}${C.x}`);
}
head("Current state");
console.log(`  PO (Module B): ${s.po.status} | Payment (Module A): ${s.payment?.status ?? "None"} | Hub: ${C.b}${s.hub.status}${C.x}`);
s.checks.amountMatches ? ok(`amount matches (${s.po.total} tiyn)`) : fail("amount does not match / no payment");
s.checks.hashMatches ? ok("poHash == docHash") : fail("hash does not match / no payment");

const tel = resolve(ROOT, "reports/monitoring/telemetry.jsonl");
if (existsSync(tel)) {
  const id = orderIdOf(orderNo).toLowerCase();
  const recs = readFileSync(tel, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.correlationId?.toLowerCase() === id);
  head(`Telemetry records with correlationId = orderId: ${recs.length}`);
  for (const r of recs.slice(-12)) console.log(`  ${r.outcome === "success" ? C.g + "●" : C.r + "●"}${C.x} ${r.ts.slice(11, 19)} ${String(r.module).padEnd(12)} ${r.step ?? r.category} ${r.outcome}${r.errorName ? " " + r.errorName : ""}`);
}
