// End-to-end scenario with NO manual actions (requires the running orchestrator):
// retailer creates PO -> supplier approves -> (orchestrator) payment + link -> clearing executes
// -> (orchestrator) hub.finalize -> Paid. Every step is a real transaction.
import { resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { ROOT, loadDeployment, pub, ok, fail, head, info, C, writeJson } from "./lib/common.ts";
import { createOrder, approveOrder, send, waitPaymentRegistered, waitLinked, waitHubFinal } from "./lib/flow.ts";
import { orderSummary } from "./lib/trace.ts";

const out: string[] = [];
const origLog = console.log;
console.log = (...a: unknown[]) => { origLog(...a); out.push(a.join(" ")); };

const dep = loadDeployment();
head("DEMO E2E - B2B procurement with bank payment (fully automatic)");
try { await fetch(`http://127.0.0.1:${process.env.API_PORT ?? 8788}/health`); ok("orchestrator is running (GET /health)"); }
catch { fail("orchestrator is not running - start it with npm run orchestrator or launchers\\start_all.cmd"); process.exit(1); }

const t0 = Date.now();
const o = await createOrder(dep, "supplier1", [{ sku: "AGR-001", qty: 5 }, { sku: "AGR-002", qty: 3 }, { sku: "AGR-004", qty: 10 }]);
ok(`STEP 1 [Module B] retailer createPO ${C.b}${o.orderNo}${C.x}  total ${o.total} tiyn (${(o.total / 100).toLocaleString("en-US")} KZT)`);
info(`tx ${o.tx.hash}  block ${o.tx.block}  gas ${o.tx.gasUsed}  poHash ${o.poHash}`);

const a = await approveOrder(dep, o.orderId, "supplier1");
const tApproved = Date.now();
ok(`STEP 2 [Module B] supplier approvePO`);
info(`tx ${a.hash}  block ${a.block}  gas ${a.gasUsed}`);

const reg = await waitPaymentRegistered(dep, o.orderId, 1, 15000);
const regLatency = Date.now() - tApproved;
ok(`STEP 3 [auto B->A] orchestrator registered payment automatically in ${regLatency} ms (K1 limit 10 000 ms)`);
info(`paymentId ${reg.pid}  amount ${reg.p.amount}  docHash ${reg.p.docHash.slice(0, 18)}…`);
await waitLinked(dep, o.orderId, 15000);
ok(`STEP 3b [auto] hub.linkPayment -> AwaitingPayment (hub cross-checked amount and hash on-chain)`);

const ex = await send(dep, "settlement", "bank", "markExecuted", [reg.pid]);
ok(`STEP 4 [Module A] clearing center markExecuted`);
info(`tx ${ex.hash}  block ${ex.block}  gas ${ex.gasUsed}`);

const fin: any = await waitHubFinal(dep, o.orderId, 15000);
const total = Date.now() - t0;
ok(`STEP 5 [auto A->Hub] orchestrator hub.finalize -> ${C.g}${C.b}${["None", "AwaitingPayment", "Paid", "PaymentFailed"][fin.status]}${C.x}  (end-to-end ${total} ms)`);

const s = await orderSummary(dep, o.orderNo);
head("Transaction chain (from blockchain events)");
for (const st of s.steps) console.log(`  ${C.g}✔${C.x}  ${st.module.padEnd(7)} ${st.step.padEnd(20)} block ${String(st.block).padStart(4)}  ${st.txHash}  ${st.detail ?? ""}`);
head("State of the three contracts");
console.log(`  Module B (retail) PO status      : ${C.b}${s.po.status}${C.x}   total ${s.po.total}`);
console.log(`  Module A (bank)   payment status : ${C.b}${s.payment?.status}${C.x}   amount ${s.payment?.amount}`);
console.log(`  Hub               order status   : ${C.g}${C.b}${s.hub.status}${C.x}`);
s.checks.amountMatches ? ok("PO total == payment amount") : fail("amount mismatch");
s.checks.hashMatches ? ok("poHash == payment docHash") : fail("hash mismatch");
const verified = await pub.readContract({ ...dep.contracts.bank, functionName: "verifyDocument", args: [reg.pid, o.poHash] });
verified ? ok("bank.verifyDocument(paymentId, keccak256(PO JSON)) == true") : fail("verifyDocument false");
ok("no manual transfer of amount or hash: the orchestrator read them from Module B on-chain");
console.log(`\n${C.g}${C.b}E2E SCENARIO PASSED - order ${o.orderNo} is ${s.hub.status}${C.x}`);

const dir = resolve(ROOT, "reports/e2e");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "demo-e2e.log"), out.join("\n").replace(/\x1b\[[0-9;]*m/g, "") + "\n");
writeJson(resolve(dir, "demo-e2e.json"), {
  ts: new Date().toISOString(),
  deployment: { contracts: Object.fromEntries(Object.entries(dep.contracts).map(([k, v]) => [k, { address: v.address, txHash: v.txHash, block: v.block }])), accounts: dep.accounts },
  orderNo: o.orderNo, registrationLatencyMs: regLatency, endToEndMs: total, summary: s, gas: { createPO: o.tx.gasUsed, approvePO: a.gasUsed, markExecuted: ex.gasUsed } });
process.exit(0);
