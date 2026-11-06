// Acceptance checks of the NEW integration (prompt section 6). Every result below is measured
// on a live stand; nothing is hard-coded. Output: reports/acceptance/AT-*.json + SUMMARY.md.
import { resolve } from "node:path";
import { rmSync, writeFileSync } from "node:fs";
import { toHex, type Hex } from "viem";
import {
  ROOT, MONITOR_URL, STATE_DIR, loadDeployment, pub, wallet, account, paymentIdOf, decodeError, telemetry,
  writeJson, sleep, ok, fail, head, info, C, PO_STATUS, PAY_STATUS, HUB_STATUS, type AccountKey,
} from "./common.ts";
import { createOrder, approveOrder, send, readAll, waitFor, waitLinked, waitHubFinal, waitPaymentRegistered } from "./flow.ts";
import { orderSummary } from "./trace.ts";
import { startStand, startOrchestrator, killTree, stopAll, type StandConfig } from "./stand.ts";
import { createOrchestrator } from "../../orchestrator/core.ts";
import { consistent } from "../../orchestrator/reconcile.ts";

const CFG: StandConfig = { name: "acceptance", rpcPort: 8546, monitorPort: 8797, apiPort: 8798, r3DelayMs: 30000 };
const OUT = resolve(ROOT, "reports/acceptance");
const orchLog = (l: string) => console.log(`    ${C.d}[orchestrator]${C.x} ${l}`);

head("ACCEPTANCE TESTS AT-1..AT-7 - integration of Module B (retail) + Module A (bank) + Hub");
info("starting isolated stand: hardhat node :8546, monitor :8797, orchestrator API :8798 ...");
await startStand(CFG);
const dep = loadDeployment();
ok(`stand ready, contracts deployed (retail ${dep.contracts.retail.address.slice(0, 10)}…, bank ${dep.contracts.bank.address.slice(0, 10)}…, hub ${dep.contracts.hub.address.slice(0, 10)}…)`);
let orch = await startOrchestrator(CFG, {}, orchLog);
ok("orchestrator started (normal mode)");

const results: any[] = [];
const alertsNow = async (): Promise<any[]> => (await fetch(`${MONITOR_URL}/alerts`)).json();
async function snapshot(orderId: Hex) {
  const s = await readAll(dep, orderId);
  return { po: PO_STATUS[s.po.status], payment: PAY_STATUS[s.pay.status], hub: HUB_STATUS[s.link.status] };
}
async function paymentsCount(orderId: Hex) {
  let n = 0;
  for (let a = 1; a <= 10; a++) { const p: any = await pub.readContract({ ...dep.contracts.bank, functionName: "getPayment", args: [paymentIdOf(orderId, a)] }); if (p.status === 0) break; n++; }
  return n;
}
function record(id: string, title: string, expected: string, pass: boolean, actual: Record<string, unknown>) {
  const r = { id, title, expected, result: pass ? "PASS" : "FAIL", actual, ts: new Date().toISOString() };
  results.push(r);
  writeJson(resolve(OUT, `${id}.json`), r);
  console.log(pass ? `  ${C.g}${C.b}✔  ${id} PASS${C.x} - ${title}` : `  ${C.r}${C.b}✘  ${id} FAIL${C.x} - ${title}`);
}
const check = (cond: boolean, msg: string) => { cond ? ok(`  ${msg}`) : fail(`  ${msg}`); return cond; };

/** Unauthorized attempt: real eth_call against the contract + telemetry to the monitor (like the web UI). */
async function attack(who: AccountKey, c: "bank" | "retail" | "hub", fn: string, args: unknown[], corr: Hex) {
  try {
    await pub.simulateContract({ ...dep.contracts[c], functionName: fn, args, account: account(who) } as any);
    return "NOT_REVERTED";
  } catch (e) {
    const err = decodeError(e);
    await telemetry({ correlationId: corr, module: "web", category: "app", step: `${c}.${fn}`, actor: account(who).address, outcome: "reverted", errorName: err, severity: "High" });
    return err;
  }
}

// ---------------- AT-1 ----------------
head("AT-1  Successful end-to-end process");
{
  const t0 = Date.now();
  const o = await createOrder(dep, "supplier1", [{ sku: "AGR-001", qty: 2 }, { sku: "AGR-005", qty: 3 }]);
  const before = await snapshot(o.orderId);
  check(true, `createPO ${o.orderNo} tx ${o.tx.hash.slice(0, 18)}… block ${o.tx.block}`);
  const ap = await approveOrder(dep, o.orderId, "supplier1");
  const tA = Date.now();
  check(true, `approvePO tx ${ap.hash.slice(0, 18)}… block ${ap.block}`);
  const reg = await waitPaymentRegistered(dep, o.orderId, 1, 15000);
  const k1 = Date.now() - tA;
  const c1 = check(k1 <= 10000, `payment registered automatically after ${k1} ms (K1 <= 10 000 ms)`);
  await waitLinked(dep, o.orderId);
  const ex = await send(dep, "settlement", "bank", "markExecuted", [reg.pid]);
  check(true, `clearing markExecuted tx ${ex.hash.slice(0, 18)}… block ${ex.block}`);
  await waitHubFinal(dep, o.orderId);
  const s = await orderSummary(dep, o.orderNo);
  const c2 = check(s.hub.status === "Paid", `hub status ${s.hub.status}`);
  const c3 = check(s.checks.amountMatches && s.checks.hashMatches, "amount and hash match across modules");
  const c4 = check(s.steps.length >= 6, `${s.steps.length} real transactions in the chain of this order`);
  record("AT-1", "Successful process", "Paid; amount/hash match; all steps are real tx", c1 && c2 && c3 && c4,
    { orderNo: o.orderNo, before, after: await snapshot(o.orderId), registrationLatencyMs: k1, endToEndMs: Date.now() - t0, steps: s.steps });
}

// ---------------- AT-2 ----------------
head("AT-2  Unauthorized actions (attacker / wrong roles)");
{
  const o = await createOrder(dep, "supplier1", [{ sku: "AGR-002", qty: 1 }]);
  const before = await snapshot(o.orderId);
  const errs = {
    attackerApprovePO: await attack("attacker", "retail", "approvePO", [o.orderId], o.orderId),
    wrongSupplierApprovePO: await attack("supplier2", "retail", "approvePO", [o.orderId], o.orderId),
    attackerRegisterPayment: await attack("attacker", "bank", "registerPayment", [paymentIdOf(o.orderId, 1), o.poHash, 1n], o.orderId),
    attackerLinkPayment: await attack("attacker", "hub", "linkPayment", [o.orderId, 1], o.orderId),
    retailerMarkExecuted: await attack("retailer", "bank", "markExecuted", [paymentIdOf(o.orderId, 1)], o.orderId),
  };
  let allRev = true;
  for (const [k, v] of Object.entries(errs)) allRev = check(v !== "NOT_REVERTED", `${k.padEnd(24)} -> reverted ${v}`) && allRev;
  const after = await snapshot(o.orderId);
  const same = check(JSON.stringify(before) === JSON.stringify(after), `state unchanged: PO ${after.po}, payment ${after.payment}, hub ${after.hub}`);
  const r1 = await waitFor(async () => (await alertsNow()).find((a) => a.rule === "R-1"), 5000).catch(() => null);
  const c3 = check(!!r1, `monitor raised R-1: ${r1?.message ?? "no alert"}`);
  record("AT-2", "Unauthorized permissions", "all reverted, state unchanged, R-1", allRev && same && c3, { orderNo: o.orderNo, errors: errs, before, after, alert: r1 });
}

// ---------------- AT-3 ----------------
head("AT-3  Duplicate message (event replay + direct repeated linkPayment)");
{
  const o = await createOrder(dep, "supplier2", [{ sku: "FRS-002", qty: 4 }]);
  const ap = await approveOrder(dep, o.orderId, "supplier2");
  await waitLinked(dep, o.orderId);
  check(true, `order ${o.orderNo} linked (AwaitingPayment)`);
  const [log] = await pub.getContractEvents({ ...dep.contracts.retail, eventName: "PurchaseOrderApproved", args: { poId: o.orderId }, fromBlock: ap.block, toBlock: ap.block } as any);
  const replay = createOrchestrator(dep, { quiet: false });
  await replay.onApproved(log);                 // same event again -> dedup by txHash:logIndex
  await replay.processOrder(o.orderId, "forced replay"); // bypass dedup -> on-chain idempotency
  check(true, "event replayed to orchestrator (dedup + on-chain checks)");
  let direct = "NOT_REVERTED";
  try { await pub.simulateContract({ ...dep.contracts.hub, functionName: "linkPayment", args: [o.orderId, 1], account: account("orchestrator") } as any); }
  catch (e) { direct = decodeError(e); }
  const c1 = check(direct === "AlreadyLinked", `direct repeated hub.linkPayment -> ${direct}`);
  const n1 = await paymentsCount(o.orderId);
  const c2 = check(n1 === 1, `exactly ${n1} payment registered for the order`);
  const ex = await send(dep, "settlement", "bank", "markExecuted", [paymentIdOf(o.orderId, 1)]);
  await waitHubFinal(dep, o.orderId);
  await replay.onApproved(log);
  await replay.processOrder(o.orderId, "replay after finalize");
  const after = await snapshot(o.orderId);
  const c3 = check(after.hub === "Paid" && (await paymentsCount(o.orderId)) === 1, `after replay: hub ${after.hub}, still 1 payment`);
  record("AT-3", "Duplicate message", "one payment; AlreadyLinked; result unchanged", c1 && c2 && c3, { orderNo: o.orderNo, directLinkError: direct, payments: n1, executeTx: ex.hash, after });
}

// ---------------- AT-4 ----------------
head("AT-4  Module failure (bank paused) and automatic recovery");
{
  const pz = await send(dep, "admin", "bank", "pause", []);
  check(true, `admin paused Module A (bank) tx ${pz.hash.slice(0, 18)}…`);
  const o = await createOrder(dep, "supplier1", [{ sku: "AGR-004", qty: 6 }]);
  await approveOrder(dep, o.orderId, "supplier1");
  check(true, `supplier approved ${o.orderNo} while bank is paused`);
  const r2 = await waitFor(async () => (await alertsNow()).find((a) => a.rule === "R-2"), 15000).catch(() => null);
  const c1 = check(!!r2, `orchestrator retried with backoff, monitor raised R-2: ${r2?.message ?? "none"}`);
  const mid = await snapshot(o.orderId);
  check(mid.payment === "None" && mid.hub === "None", `while paused: payment ${mid.payment}, hub ${mid.hub} (order waits)`);
  const up = await send(dep, "admin", "bank", "unpause", []);
  const tUp = Date.now();
  check(true, `admin unpaused bank tx ${up.hash.slice(0, 18)}…`);
  const reg = await waitPaymentRegistered(dep, o.orderId, 1, 60000);
  await waitLinked(dep, o.orderId, 60000);
  await send(dep, "settlement", "bank", "markExecuted", [reg.pid]);
  await waitHubFinal(dep, o.orderId, 60000);
  const rec = Date.now() - tUp;
  const after = await snapshot(o.orderId);
  const n = await paymentsCount(o.orderId);
  const c2 = check(after.hub === "Paid" && n === 1, `order reached ${after.hub} ${rec} ms after unpause, payments: ${n} (no duplicates)`);
  record("AT-4", "Failure of one module", "auto recovery to Paid, R-2, no duplicates", c1 && c2 && rec <= 60000, { orderNo: o.orderNo, alert: r2, recoveryMs: rec, payments: n, during: mid, after });
}

// ---------------- AT-5 ----------------
head("AT-5  Data mismatch (FAULT_TAMPER_AMOUNT=1) + compensation");
{
  killTree(orch);
  await sleep(500);
  orch = await startOrchestrator(CFG, { FAULT_TAMPER_AMOUNT: "1" }, orchLog);
  check(true, "orchestrator restarted with FAULT_TAMPER_AMOUNT=1 (registers amount + 1 tiyn)");
  const o = await createOrder(dep, "supplier2", [{ sku: "FRS-003", qty: 2 }]);
  await approveOrder(dep, o.orderId, "supplier2");
  const p1 = await waitFor(async () => {
    const p: any = await pub.readContract({ ...dep.contracts.bank, functionName: "getPayment", args: [paymentIdOf(o.orderId, 1)] });
    return p.status === 4 ? p : undefined;
  }, 20000);
  const c1 = check(p1.amount === BigInt(o.total) + 1n, `tampered payment amount ${p1.amount} != PO total ${o.total}`);
  const mid = await snapshot(o.orderId);
  const c2 = check(mid.hub === "None", `hub refused linkPayment (AmountMismatch): hub status ${mid.hub}, order NOT Paid`);
  check(true, "compensation: wrong payment (attempt 1) cancelled by orchestrator");
  const r3 = await waitFor(async () => (await alertsNow()).find((a) => a.rule === "R-3" && a.correlationId === o.orderId), 10000).catch(() => null);
  const c3 = check(!!r3, `monitor raised R-3: ${r3?.message ?? "none"}`);
  killTree(orch);
  await sleep(500);
  orch = await startOrchestrator(CFG, {}, orchLog);
  check(true, "flag switched off, orchestrator restarted -> attempt 2 with correct data");
  const reg2 = await waitPaymentRegistered(dep, o.orderId, 2, 30000);
  await waitLinked(dep, o.orderId, 30000);
  await send(dep, "settlement", "bank", "markExecuted", [reg2.pid]);
  await waitHubFinal(dep, o.orderId, 30000);
  const s = await orderSummary(dep, o.orderNo);
  const c4 = check(s.hub.status === "Paid" && s.hub.attempt === 2 && s.checks.amountMatches, `attempt ${s.hub.attempt}: hub ${s.hub.status}, amount ${s.payment?.amount} == ${s.po.total}`);
  record("AT-5", "Data mismatch", "AmountMismatch, R-3, not Paid; compensation; attempt 2 -> Paid", c1 && c2 && c3 && c4,
    { orderNo: o.orderNo, tamperedAmount: p1.amount.toString(), poTotal: o.total, attempt1: "Cancelled", alert: r3, final: s.hub, steps: s.steps });
}

// ---------------- AT-6 ----------------
head("AT-6  Recovery after orchestrator crash (FAULT_CRASH_AFTER=REGISTER_PAYMENT)");
{
  killTree(orch);
  await sleep(500);
  orch = await startOrchestrator(CFG, { FAULT_CRASH_AFTER: "REGISTER_PAYMENT" }, orchLog);
  const o = await createOrder(dep, "supplier1", [{ sku: "AGR-003", qty: 1 }]);
  await approveOrder(dep, o.orderId, "supplier1");
  const reg = await waitPaymentRegistered(dep, o.orderId, 1, 20000);
  await waitFor(async () => orch.exitCode !== null, 10000);
  check(true, `orchestrator registered payment and crashed (exit code ${orch.exitCode})`);
  const ex = await send(dep, "settlement", "bank", "markExecuted", [reg.pid]);
  check(true, `clearing executed payment while orchestrator is dead tx ${ex.hash.slice(0, 18)}…`);
  info("waiting for R-3 (payment settled, hub not finalized > 30 s) ...");
  const r3 = await waitFor(async () => (await alertsNow()).find((a) => a.rule === "R-3" && a.correlationId === o.orderId), 60000).catch(() => null);
  const c1 = check(!!r3, `monitor raised R-3: ${r3?.message ?? "none"}`);
  rmSync(STATE_DIR, { recursive: true, force: true });
  check(true, "state/ cache deleted (blockchain is the source of truth)");
  const tRestart = Date.now();
  orch = await startOrchestrator(CFG, {}, orchLog);
  await waitHubFinal(dep, o.orderId, 60000);
  const rec = Date.now() - tRestart;
  const after = await snapshot(o.orderId);
  const n = await paymentsCount(o.orderId);
  const c2 = check(after.hub === "Paid" && n === 1 && rec <= 60000, `reconciliation brought order to ${after.hub} in ${rec} ms, payments: ${n}`);
  record("AT-6", "Recovery after failure", "reconciliation -> Paid <= 60 s, no duplicates, R-3", c1 && c2, { orderNo: o.orderNo, alert: r3, recoveryMs: rec, payments: n, after });
}

// ---------------- AT-7 ----------------
head("AT-7  Payment rejected by clearing center");
{
  const o = await createOrder(dep, "supplier2", [{ sku: "FRS-005", qty: 8 }]);
  await approveOrder(dep, o.orderId, "supplier2");
  const reg = await waitPaymentRegistered(dep, o.orderId, 1, 15000);
  await waitLinked(dep, o.orderId);
  const rj = await send(dep, "settlement", "bank", "markRejected", [reg.pid, toHex("AC04", { size: 32 })]);
  check(true, `clearing markRejected (reason AC04) tx ${rj.hash.slice(0, 18)}…`);
  await waitHubFinal(dep, o.orderId);
  const after = await snapshot(o.orderId);
  const c1 = check(after.hub === "PaymentFailed" && after.payment === "Rejected", `hub ${after.hub}, payment ${after.payment}, PO ${after.po} - consistent`);
  record("AT-7", "Payment rejection", "PaymentFailed, statuses consistent", c1, { orderNo: o.orderNo, after });
}

// ---------------- Reconciliation over all orders ----------------
head("Final reconciliation of all orders on the acceptance stand");
let bad = 0;
const n = Number(await pub.readContract({ ...dep.contracts.retail, functionName: "orderCount" }));
for (let i = 0; i < n; i++) {
  const id = (await pub.readContract({ ...dep.contracts.retail, functionName: "orderIdAt", args: [BigInt(i)] })) as Hex;
  const err = consistent(await orderSummary(dep, id));
  if (err) { bad++; fail(`${id.slice(0, 12)}…: ${err}`); }
}
check(bad === 0, `${n} orders checked, ${bad} discrepancies`);
const alerts = await alertsNow();

stopAll();
const passed = results.filter((r) => r.result === "PASS").length;
writeJson(resolve(OUT, "summary.json"), { ts: new Date().toISOString(), passed, total: results.length, discrepancies: bad, orders: n, alerts, results: results.map((r) => ({ id: r.id, title: r.title, result: r.result })) });
writeFileSync(resolve(OUT, "SUMMARY.md"), [
  "# Acceptance summary (AT-1..AT-7)", "", `Run: ${new Date().toISOString()} - isolated stand (Hardhat node :8546, automine)`, "",
  "| ID | Check | Expected | Result |", "|---|---|---|---|",
  ...results.map((r) => `| ${r.id} | ${r.title} | ${r.expected} | **${r.result}** |`), "",
  `Total: **${passed}/${results.length} PASS**, discrepancies after reconciliation: **${bad}** in ${n} orders.`, "",
  "## Alerts raised by the monitor", "", ...alerts.map((a: any) => `- ${a.rule} [${a.severity}] ${a.message}`), "",
].join("\n"));
head("ACCEPTANCE SUMMARY");
for (const r of results) console.log(r.result === "PASS" ? `  ${C.g}✔  ${r.id}${C.x} ${r.title}` : `  ${C.r}✘  ${r.id} ${r.title}${C.x}`);
console.log(passed === results.length ? `\n${C.g}${C.b}ALL ${passed}/${results.length} ACCEPTANCE CHECKS PASSED${C.x}` : `\n${C.r}${C.b}${passed}/${results.length} PASSED${C.x}`);
process.exit(passed === results.length ? 0 : 1);
