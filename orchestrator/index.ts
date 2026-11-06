// Orchestrator daemon: event listeners (250 ms polling) + reconciliation every 15 s + read-only API.
import { loadDeployment, C, ok, head, info } from "../scripts/lib/common.ts";
import { createOrchestrator } from "./core.ts";
import { startApi } from "./api.ts";

const dep = loadDeployment();
const opts = {
  tamperAmount: process.env.FAULT_TAMPER_AMOUNT === "1",
  crashAfter: process.env.FAULT_CRASH_AFTER || undefined,
};
const port = Number(process.env.API_PORT ?? 8788);

head("INTEGRATION ORCHESTRATOR (Module B -> Module A -> Hub)");
ok(`retail ${dep.contracts.retail.address}`);
ok(`bank   ${dep.contracts.bank.address}`);
ok(`hub    ${dep.contracts.hub.address}`);
if (opts.tamperAmount) console.log(`${C.r}${C.b}FAULT_TAMPER_AMOUNT=1 (acceptance test only)${C.x}`);
if (opts.crashAfter) console.log(`${C.r}${C.b}FAULT_CRASH_AFTER=${opts.crashAfter} (acceptance test only)${C.x}`);

const orch = createOrchestrator(dep, opts);
startApi(dep, port, orch.stats);
ok(`read-only API http://127.0.0.1:${port}  (GET /health, /orders, /orders/:orderNo)`);
info("rules: PO Approved -> registerPayment + hub.linkPayment;  PaymentStatusChanged -> hub.finalize");

await orch.reconcile("startup reconcile");
ok("startup reconciliation done (CP-6)");
orch.start();
ok("listening for PurchaseOrderApproved / PaymentStatusChanged (polling 250 ms)");
setInterval(() => { void orch.reconcile("periodic reconcile"); }, 15_000);
