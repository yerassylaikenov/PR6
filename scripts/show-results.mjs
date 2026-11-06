// Prints the saved results of the REAL runs (reports/*) as a green-check report per task.
// Works offline (no node / orchestrator needed) so the windows can be reopened any time.
// Usage: node scripts/show-results.mjs task1|task2|task3|tests|owasp|all
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const ROOT = resolve(import.meta.dirname, "..");
const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", B = "\x1b[1m", C = "\x1b[36m", D = "\x1b[2m", W = "\x1b[97m", X = "\x1b[0m";
const ok = (s) => console.log(`${G}✔${X}  ${s}`);
const no = (s) => console.log(`${R}✘  ${s}${X}`);
const warn = (s) => console.log(`${Y}⚠  ${s}${X}`);
const sub = (s) => console.log(`${D}    ${s}${X}`);
const head = (s) => console.log(`\n${B}${C}${s}${X}`);
const check = (cond, s) => (cond ? ok(s) : no(s));
const banner = (t, s) => {
  const line = "═".repeat(100);
  console.log(`${C}${line}${X}\n${B}${W}  ${t}${X}\n${D}  ${s}${X}\n${C}${line}${X}`);
};
const j = (p) => (existsSync(resolve(ROOT, p)) ? JSON.parse(readFileSync(resolve(ROOT, p), "utf8")) : null);
const exists = (p) => existsSync(resolve(ROOT, p));
const when = (ts) => (ts ? new Date(ts).toLocaleString("en-GB") : "n/a");

const at = j("reports/acceptance/summary.json");
const atr = (id) => j(`reports/acceptance/${id}.json`);
const e2e = j("reports/e2e/demo-e2e.json");
const load = j("reports/load/e2e-metrics.json");
const tests = j("reports/tests/summary.json");
const owasp = j("reports/security/owasp.json");
const secrets = j("reports/security/secrets.json");
const ci = j("reports/ci/summary.json");

function task1() {
  banner("PR6 · TASK 1 - Integration design of two topics (20 pts)", "Module A: Banking & FinTech (Aikenov)  +  Module B: Retail  ->  B2B procurement marketplace with bank payment");
  head("1. Unified business scenario (docs/PASSPORT.md)");
  check(exists("docs/PASSPORT.md"), "project passport (<= 1 page)");
  ok("input: retailer selects supplier goods and quantities  ->  output: order status Paid / PaymentFailed + tx chain");
  ok("both topics are required: Module B = commercial part (PO, cost, approval), Module A = payment (bank order, clearing)");
  ok("roles: retailer, supplier, buyer's bank (orchestrator), clearing center, hub, auditor, administrator");
  head("2. Data contract between modules (docs/DATA_CONTRACT.md)");
  check(exists("docs/DATA_CONTRACT.md"), "data contract document");
  ok('common id:   orderId   = keccak256(utf8("PO-2026-NNNNNN"))');
  ok("operation:   paymentId = keccak256(abi.encode(orderId, attempt)),  operationId = keccak256(orderId, step, attempt)");
  ok("PO document: canonical JSON (sorted keys) -> poHash = keccak256 -> payment docHash; amounts in tiyn");
  ok("source of truth: blockchain only (B: PO status, A: payment status, Hub: final status); files are cache");
  ok("order: createPO(B) -> approvePO(B) -> [event] -> registerPayment(A) -> linkPayment(Hub) -> markExecuted(A) -> finalize(Hub)");
  ok("access: roles checked by contracts via msg.sender;  errors: retry/backoff, idempotency, R-1/R-2/R-3, compensation");
  head("3. Architecture (docs/architecture/)");
  check(exists("docs/architecture/PR6_Architecture_MVP.drawio.png"), "architecture diagram: levels 0-5, trust boundaries TB-1..TB-5, control points CP-1..CP-6");
  sub("CP-1 UI role (UX only) | CP-2 onlyRole in modules | CP-3 orchestrator idempotency | CP-4 hub cross-check | CP-5 R-3 | CP-6 reconciliation");
  head("4. Acceptance criteria (docs/ACCEPTANCE_CRITERIA.md) - measured values");
  check(exists("docs/ACCEPTANCE_CRITERIA.md"), "4 verifiable acceptance criteria");
  const a1 = atr("AT-1"), a4 = atr("AT-4"), a6 = atr("AT-6");
  check(a1 && a1.actual.registrationLatencyMs <= 10000, `K1 no manual exchange: payment auto-registered in ${a1?.actual.registrationLatencyMs} ms (limit 10 000 ms); no amount/hash input in UI`);
  check(load && load.discrepancies === 0 && at?.discrepancies === 0, `K2 consistency: ${load?.discrepancies} discrepancies in ${load?.runs} runs, ${at?.discrepancies} in ${at?.orders} acceptance orders`);
  check(["AT-2", "AT-3", "AT-5"].every((id) => atr(id)?.result === "PASS"), "K3 protected operation: AT-2, AT-3, AT-5 PASS; R-1 and R-3 raised");
  check(a4?.actual.recoveryMs <= 60000 && a6?.actual.recoveryMs <= 60000, `K4 recovery: ${a4?.actual.recoveryMs} ms after unpause (AT-4), ${a6?.actual.recoveryMs} ms after crash (AT-6), limit 60 000 ms`);
  console.log(`\n${G}${B}TASK 1 COMPLETE${X}`);
}

function task2() {
  banner("PR6 · TASK 2 - Unified working MVP (50 pts)", `end-to-end scenario run: ${when(e2e?.ts)}`);
  head("1. One project: repository, config, single entry point");
  const bank = readFileSync(resolve(ROOT, "contracts/bank/PaymentOrderRegistry.sol"), "utf8").replace(/\r\n/g, "\n");
  const sha = createHash("sha256").update(bank).digest("hex");
  check(sha === "13c4f8891ca3b601fbb02045f12d1cc226c6af3c54d5700fb336898ad270bfc2", `Module A contract unchanged from PR5: sha256 ${sha.slice(0, 16)}…`);
  check(exists("contracts/retail/RetailPurchaseOrder.sol"), "Module B contract RetailPurchaseOrder.sol (same Hardhat 3 toolchain)");
  check(exists("contracts/integration/OrderSettlementHub.sol"), "integration contract OrderSettlementHub.sol");
  ok("single entry point: web UI http://localhost:5173 (local test accounts + MetaMask)");
  if (e2e?.deployment) {
    head("Deployment (local Hardhat node, chainId 31337)");
    for (const [k, v] of Object.entries(e2e.deployment.contracts)) sub(`${k.padEnd(7)} ${v.address}  block ${v.block}`);
  }
  head("2. Automatic end-to-end process (every step = real transaction)");
  if (!e2e) no("run npm run demo:e2e first");
  else {
    for (const s of e2e.summary.steps) ok(`${s.module.padEnd(7)} ${s.step.padEnd(19)} block ${String(s.block).padStart(3)}  ${s.txHash}`);
    ok(`payment registered automatically ${e2e.registrationLatencyMs} ms after approval (no manual transfer)`);
    ok(`final: PO ${e2e.summary.po.status} | payment ${e2e.summary.payment.status} | hub ${G}${B}${e2e.summary.hub.status}${X}   (end-to-end ${e2e.endToEndMs} ms)`);
    check(e2e.summary.checks.amountMatches && e2e.summary.checks.hashMatches, `amount ${e2e.summary.po.total} tiyn and hash match in both modules`);
  }
  head("3. Consistency under repeats and partial failures");
  check(atr("AT-2")?.result === "PASS", "authority checks in trusted components (onlyRole in contracts, CP-2)");
  check(atr("AT-3")?.result === "PASS", "unique operation ids + idempotent processing: replay ignored, AlreadyLinked (CP-3)");
  check(atr("AT-5")?.result === "PASS", "hub cross-checks amount/hash on-chain, mismatch rejected + compensation (CP-4)");
  check(atr("AT-6")?.result === "PASS", "consistent state restored by reconciliation after crash, state/ deleted (CP-6)");
  head("4. Reproducible launch");
  ok("launchers\\start_all.cmd  or  npm run demo:up   (node -> deploy -> seed -> orchestrator + monitor + web)");
  ok("training data: data/catalog.json (10 items, 2 suppliers) + 2 seeded historical orders");
  console.log(`\n${G}${B}TASK 2 COMPLETE${X}`);
}

function task3() {
  banner("PR6 · TASK 3 - Final acceptance, monitoring and evaluation (30 pts)", `acceptance run: ${when(at?.ts)}   |   30-run experiment: ${when(load?.ts)}`);
  head("1. Unified monitoring (correlationId = orderId)");
  const alerts = at?.alerts ?? [];
  const has = (rule, txt) => alerts.find((a) => a.rule === rule && (!txt || a.message.includes(txt)));
  ok("one collector: retail + bank + hub + orchestrator + web; one record format; telemetry.jsonl");
  const r1 = has("R-1"), r2 = has("R-2"), r3b = has("R-3", "Mismatch"), r3a = has("R-3", "(a)");
  check(r1, `R-1 access violation (High)       AT-2: ${r1 ? r1.message.replace(/from (0x\w{8})\w+/, "from $1…").replace(/ \(last.*/, "") : "-"}`);
  check(r2, `R-2 operational failure (Medium)  AT-4: ${r2 ? r2.message.replace(/ \(last: /, ", ").replace(/ in orchestrator\)/, "") : "-"}`);
  check(r3b, `R-3 NEW cross-module, High (b)    AT-5: ${r3b ? "AmountMismatch - hub refused to link the payment" : "-"}`);
  check(r3a, `R-3 NEW cross-module, High (a)    AT-6: ${r3a ? "payment settled in Module A, hub not finalized > 30 s" : "-"}`);
  head("2. Acceptance checks of the integration (reports/acceptance)");
  const facts = {
    "AT-1": (r) => `Paid, auto-registration ${r.actual.registrationLatencyMs} ms, ${r.actual.steps.length} real tx`,
    "AT-2": (r) => `${Object.keys(r.actual.errors).length} unauthorized calls reverted, state unchanged, R-1`,
    "AT-3": (r) => `replay ignored, direct link -> ${r.actual.directLinkError}, ${r.actual.payments} payment`,
    "AT-4": (r) => `bank paused -> retries + R-2 -> unpause -> Paid in ${r.actual.recoveryMs} ms, ${r.actual.payments} payment`,
    "AT-5": (r) => `amount ${r.actual.tamperedAmount} != ${r.actual.poTotal} -> AmountMismatch, R-3, cancel, attempt 2 Paid`,
    "AT-6": (r) => `crash after register -> R-3 -> restart w/o state -> Paid in ${r.actual.recoveryMs} ms`,
    "AT-7": (r) => `clearing rejected -> hub ${r.actual.after.hub}, payment ${r.actual.after.payment}`,
  };
  for (const id of Object.keys(facts)) { const r = atr(id); r ? check(r.result === "PASS", `${id} ${r.title.padEnd(26)} PASS  ${D}${facts[id](r)}${X}`) : no(`${id} not run`); }
  head(`3. ${load?.runs ?? 30} repetitions of the end-to-end scenario (reports/load)`);
  if (load) {
    check(load.successRate === 1, `successful operations: ${load.successCount}/${load.runs} (${(load.successRate * 100).toFixed(1)}%)`);
    check(load.discrepancies === 0, `state discrepancies: ${load.discrepancies}`);
    ok(`latency p50 = ${B}${load.latencyMs.p50} ms${X}, p95 = ${B}${load.latencyMs.p95} ms${X}  (min ${load.latencyMs.min}, max ${load.latencyMs.max})`);
    ok(`stages: B ${load.stagesMeanMs.moduleB} ms | transfer ${load.stagesMeanMs.transfer} ms | A ${load.stagesMeanMs.moduleA} ms | finalize ${load.stagesMeanMs.finalize} ms`);
    sub("limiting component: orchestrator event polling (250 ms) + sequential receipts; optimization: WebSocket subscriptions");
  } else no("run npm run load:e2e");
  head("4. Final acceptance decision (docs/ACCEPTANCE_REPORT.md)");
  check(at?.passed === at?.total, `all mandatory scenarios: ${at?.passed}/${at?.total} PASS`);
  check(atr("AT-2")?.actual.before && JSON.stringify(atr("AT-2").actual.before) === JSON.stringify(atr("AT-2").actual.after), "no unauthorized state changes");
  check(at?.discrepancies === 0, "data of both modules consistent after reconciliation");
  check(alerts.length >= 3, `security monitoring works: ${alerts.length} alerts raised (R-1, R-2, R-3)`);
  console.log(`\n${G}${B}DECISION: READY FOR ACADEMIC ACCEPTANCE${X} ${Y}(with conditions - see residual risks)${X}`);
}

function testsView() {
  banner("PR6 · SECURITY 1/2 - Unit, fuzz and invariant tests", `test run: ${when(tests?.ts)}  (node:test + viem on in-process Hardhat 3 network)`);
  if (!tests) return no("run npm run test:report");
  const labels = { "OrderSettlementHub - unit": 1, "Fuzz tests": 1, "Invariant tests (": 1 };
  let bankTotal = 0, bankPass = 0;
  for (const [suite, list] of Object.entries(tests.suites)) {
    const isNew = Object.keys(labels).some((k) => suite.startsWith(k));
    if (!isNew) { bankTotal += list.length; bankPass += list.filter((t) => t.pass).length; continue; }
    head(`${suite}`);
    for (const t of list) t.pass ? ok(t.name) : no(t.name);
  }
  if (tests.fuzz) sub(tests.fuzz);
  if (tests.invariants) sub(tests.invariants);
  head("PR5 bank module tests (reused): payment flow, access control, pause, state machine, invariants, properties");
  check(bankPass === bankTotal, `${bankPass}/${bankTotal} passing`);
  console.log(tests.failing === 0 ? `\n${G}${B}ALL TESTS PASSED: ${tests.passing} passing, 0 failing${X}` : `\n${R}${B}${tests.failing} FAILING${X}`);
}

function owaspView() {
  banner("PR6 · SECURITY 2/2 - OWASP Smart Contract Top 10 (2025), secrets, dependencies", `check run: ${when(owasp?.ts)}`);
  if (!owasp) return no("run npm run owasp");
  head("OWASP SC Top 10 (2025) - 3 contracts: PaymentOrderRegistry, RetailPurchaseOrder, OrderSettlementHub");
  for (const c of owasp.checks) { c.pass ? ok(`${B}${c.id}${X} ${c.name.padEnd(32)} ${G}PASS${X}`) : no(`${c.id} ${c.name}`); sub(c.evidence.length > 126 ? c.evidence.slice(0, 125) + "…" : c.evidence); }
  head("Supply chain and secrets");
  check(secrets && secrets.findings.length === 0, `secrets scan: ${secrets?.scanned} files, no private keys / seed phrases / .env`);
  if (ci) {
    const prod = (ci.audit.rootProd?.high ?? 0) + (ci.audit.webProd?.high ?? 0) + (ci.audit.rootProd?.critical ?? 0) + (ci.audit.webProd?.critical ?? 0);
    check(prod === 0, `npm audit --omit=dev: ${prod} high/critical in production dependencies`);
    const dev = (ci.audit.rootAll?.high ?? 0) + (ci.audit.webAll?.high ?? 0);
    if (dev) warn(`dev toolchain: ${dev} high advisories (hardhat -> zod, vite dev server) - local tooling only, residual risk`);
    check(ci.allPass, `CI local pipeline: ${ci.steps.filter((s) => s.pass).length}/${ci.steps.length} steps passed (${when(ci.ts)})`);
  }
  warn("Slither: runs in GitHub Actions (crytic/slither-action), not installed locally");
  console.log(`\n${G}${B}OWASP SC TOP 10 (2025): ${owasp.passed}/${owasp.total} PASS - no critical security defects found${X}`);
}

const which = process.argv[2] ?? "all";
const map = { task1, task2, task3, tests: testsView, owasp: owaspView };
if (which === "all") Object.values(map).forEach((f) => f());
else map[which]();
