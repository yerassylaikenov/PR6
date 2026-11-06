// Integration orchestrator core (prompt 3.1 / 4.3).
// Rule 1: PO Approved (B)  -> registerPayment (A) with amount/hash READ FROM B -> hub.linkPayment
// Rule 2: PaymentStatusChanged (A) -> hub.finalize
// CP-3: before each step the on-chain state is re-read and completed steps are skipped.
// CP-6: reconcile() walks every approved PO and finishes what is incomplete.
import type { Hex } from "viem";
import {
  pub, wallet, paymentIdOf, operationIdOf, decodeError, telemetry, sleep, C, HUB_STATUS,
  type Deployment,
} from "../scripts/lib/common.ts";
import { orderNoMap } from "../scripts/lib/flow.ts";
import { retailAdapter, PO_APPROVED } from "./retailAdapter.ts";
import { bankAdapter, PAY } from "./bankAdapter.ts";
import { Idempotency } from "./idempotency.ts";

const RETRYABLE = new Set(["EnforcedPause", "RpcUnavailable"]);
const BACKOFF_S = [1, 2, 4, 8]; // 5 attempts total
const MISMATCH = new Set(["AmountMismatch", "DocHashMismatch"]);
const DONE_ERRORS = new Set(["AlreadyLinked", "AlreadyFinalized"]);

export interface CoreOptions { tamperAmount?: boolean; crashAfter?: string; quiet?: boolean }

export function createOrchestrator(dep: Deployment, opts: CoreOptions = {}) {
  const retail = retailAdapter(dep);
  const bank = bankAdapter(dep);
  const idem = new Idempotency();
  const w = wallet("orchestrator");
  const hubC = dep.contracts.hub;
  const blocked = new Set<string>(); // orders stopped after a data mismatch (no auto-retry)
  const paymentToOrder = new Map<string, Hex>();
  const steps: Record<string, Record<string, string>> = {};
  let names = orderNoMap();
  let queue: Promise<void> = Promise.resolve();
  const queued = new Set<string>();
  let lastError: string | null = null;
  let processedCount = 0;

  const nameOf = (id: Hex) => names.get(id.toLowerCase()) ?? (names = orderNoMap()).get(id.toLowerCase()) ?? id.slice(0, 12);
  const t = () => new Date().toISOString().slice(11, 19);
  const log = (id: Hex, icon: string, msg: string) => { if (!opts.quiet) console.log(`${C.d}[${t()}]${C.x} ${C.b}${nameOf(id)}${C.x} ${icon}  ${msg}`); };

  async function hubWrite(functionName: string, args: unknown[]) {
    const { request } = await pub.simulateContract({ ...hubC, functionName, args, account: w.account } as any);
    const hash = await w.writeContract(request as any);
    const r = await pub.waitForTransactionReceipt({ hash });
    return { hash, block: r.blockNumber, gasUsed: r.gasUsed };
  }

  /** Retry with backoff 1/2/4/8 s for EnforcedPause / RPC failures; then alert R-2. */
  async function withRetry<T>(orderId: Hex, step: string, fn: () => Promise<T>): Promise<T | null> {
    for (let i = 0; i < 5; i++) {
      try { return await fn(); } catch (e) {
        const name = decodeError(e);
        if (!RETRYABLE.has(name)) throw e;
        lastError = name;
        await telemetry({ correlationId: orderId, module: "orchestrator", category: "integration", step, actor: w.account.address, outcome: "error", errorName: name, severity: "Medium" });
        if (i < 4) { log(orderId, `${C.y}↻${C.x}`, `${step} failed with ${name}, retry ${i + 1}/4 in ${BACKOFF_S[i]}s`); await sleep(BACKOFF_S[i] * 1000); }
      }
    }
    log(orderId, `${C.y}⚠${C.x}`, `${step}: 5 attempts failed - R-2 raised, order stays AwaitingPayment, reconciliation will retry`);
    return null;
  }

  function message(orderId: Hex, step: string, attempt: number, extra: Record<string, unknown>) {
    const msg = { operationId: operationIdOf(orderId, step, attempt), orderId, orderNo: nameOf(orderId), step, attempt, ts: new Date().toISOString(), ...extra };
    idem.recordOperation(msg.operationId, msg);
    (steps[orderId] ??= {})[step] = String(extra.resultTx ?? "");
    void telemetry({ correlationId: orderId, module: "orchestrator", category: "integration", actor: w.account.address, step, attempt, txHash: extra.resultTx, blockNumber: extra.block, outcome: extra.outcome, errorName: extra.errorName, amount: extra.amount, docHash: extra.docHash });
  }

  async function processOrder(orderId: Hex, source = "event"): Promise<void> {
    const po = await retail.getPO(orderId);
    if (po.status !== PO_APPROVED) return;
    let link: any = await pub.readContract({ ...hubC, functionName: "getOrder", args: [orderId] });
    if (link.status >= 2) return; // already final (Paid / PaymentFailed)

    if (link.status === 0) {
      if (blocked.has(orderId)) return;
      // find the current attempt: skip compensated (Cancelled) payments
      let attempt = 1;
      let p = await bank.getPayment(paymentIdOf(orderId, attempt));
      while (p.status === PAY.Cancelled && attempt < 20) { attempt++; p = await bank.getPayment(paymentIdOf(orderId, attempt)); }
      const pid = paymentIdOf(orderId, attempt);
      paymentToOrder.set(pid.toLowerCase(), orderId);

      // STEP 1: REGISTER_PAYMENT (skip if already on-chain - CP-3)
      if (p.status === PAY.None) {
        const amount = po.totalPurchaseCost + (opts.tamperAmount ? 1n : 0n);
        const r = await withRetry(orderId, "REGISTER_PAYMENT", () => bank.registerPayment(pid, po.poHash, amount)).catch((e) => {
          const n = decodeError(e); if (n === "PaymentAlreadyExists") return "exists" as const; throw e;
        });
        if (r === null) return;
        if (r !== "exists") {
          log(orderId, `${C.g}✔${C.x}`, `REGISTER_PAYMENT attempt ${attempt} amount ${amount} docHash ${po.poHash.slice(0, 10)}… tx ${r.hash.slice(0, 14)}… block ${r.block} (${source})`);
          message(orderId, "REGISTER_PAYMENT", attempt, { amount, docHash: po.poHash, resultTx: r.hash, block: r.block, outcome: "success" });
        }
        if (opts.crashAfter === "REGISTER_PAYMENT") {
          log(orderId, `${C.r}✘${C.x}`, "FAULT_CRASH_AFTER=REGISTER_PAYMENT -> orchestrator process exits now");
          process.exit(3);
        }
      } else {
        log(orderId, `${C.d}•${C.x}`, `REGISTER_PAYMENT attempt ${attempt} already on-chain - skipped (idempotent)`);
      }

      // STEP 2: LINK (hub re-checks amount, hash and statuses on-chain - CP-4)
      try {
        const r = await withRetry(orderId, "LINK", () => hubWrite("linkPayment", [orderId, attempt]));
        if (r === null) return;
        log(orderId, `${C.g}✔${C.x}`, `LINK hub.linkPayment attempt ${attempt} -> AwaitingPayment tx ${r.hash.slice(0, 14)}… block ${r.block}`);
        message(orderId, "LINK", attempt, { resultTx: r.hash, block: r.block, outcome: "success" });
      } catch (e) {
        const name = decodeError(e);
        if (DONE_ERRORS.has(name)) { log(orderId, `${C.d}•${C.x}`, `LINK already done (${name})`); }
        else if (MISMATCH.has(name)) {
          lastError = name;
          log(orderId, `${C.r}✘${C.x}`, `LINK rejected by hub: ${name} -> R-3, compensation: cancelPayment(attempt ${attempt})`);
          message(orderId, "LINK", attempt, { outcome: "reverted", errorName: name, severity: "High" });
          const pay = await bank.getPayment(pid);
          if (pay.status === PAY.Registered) {
            const c = await bank.cancelPayment(pid);
            log(orderId, `${C.y}↺${C.x}`, `COMPENSATE cancelPayment tx ${c.hash.slice(0, 14)}… block ${c.block}`);
            message(orderId, "COMPENSATE", attempt, { resultTx: c.hash, block: c.block, outcome: "success" });
          }
          blocked.add(orderId);
          return;
        } else if (name === "AccessControlUnauthorizedAccount") {
          lastError = name;
          message(orderId, "LINK", attempt, { outcome: "reverted", errorName: name, severity: "High" });
          blocked.add(orderId);
          return;
        } else throw e;
      }
      link = await pub.readContract({ ...hubC, functionName: "getOrder", args: [orderId] });
    }

    // STEP 3: FINALIZE once the bank payment is settled
    if (link.status === 1) {
      paymentToOrder.set(link.paymentId.toLowerCase(), orderId);
      const p = await bank.getPayment(link.paymentId);
      if (p.status === PAY.Executed || p.status === PAY.Rejected || p.status === PAY.Cancelled) {
        try {
          const r = await withRetry(orderId, "FINALIZE", () => hubWrite("finalize", [orderId]));
          if (r === null) return;
          const after: any = await pub.readContract({ ...hubC, functionName: "getOrder", args: [orderId] });
          const st = HUB_STATUS[after.status];
          log(orderId, st === "Paid" ? `${C.g}✔${C.x}` : `${C.y}✔${C.x}`, `FINALIZE hub.finalize -> ${st === "Paid" ? C.g : C.y}${C.b}${st}${C.x} tx ${r.hash.slice(0, 14)}… block ${r.block}`);
          message(orderId, "FINALIZE", link.attempt, { resultTx: r.hash, block: r.block, outcome: "success", finalStatus: st });
          processedCount++;
        } catch (e) {
          const name = decodeError(e);
          if (!DONE_ERRORS.has(name) && name !== "NotSettledYet") throw e;
        }
      }
    }
  }

  function enqueue(orderId: Hex, source: string) {
    const key = orderId.toLowerCase();
    if (queued.has(key)) return queue;
    queued.add(key);
    queue = queue.then(async () => {
      queued.delete(key);
      try { await processOrder(orderId, source); } catch (e) {
        lastError = decodeError(e);
        log(orderId, `${C.r}✘${C.x}`, `processing error: ${lastError}`);
      }
    });
    return queue;
  }

  async function reconcile(source = "reconcile") {
    for (const id of await retail.allOrderIds()) await enqueue(id, source);
    return queue;
  }

  /** Event handlers (deduplicated by txHash:logIndex). Exposed so AT-3 can replay an event. */
  function onApproved(l: any) {
    const key = `${l.transactionHash}:${l.logIndex}`;
    if (idem.seenEvent(key)) { log(l.args.poId, `${C.d}•${C.x}`, `event ${key.slice(0, 14)}… already processed - replay ignored`); return queue; }
    idem.markEvent(key);
    return enqueue(l.args.poId, "event PurchaseOrderApproved");
  }
  function onPaymentStatus(l: any) {
    const key = `${l.transactionHash}:${l.logIndex}`;
    if (idem.seenEvent(key)) return queue;
    idem.markEvent(key);
    const orderId = paymentToOrder.get(String(l.args.paymentId).toLowerCase());
    return orderId ? enqueue(orderId, "event PaymentStatusChanged") : reconcile("event PaymentStatusChanged");
  }

  function start() {
    const u1 = retail.watchApproved(onApproved);
    const u2 = bank.watchStatus(onPaymentStatus);
    return () => { u1(); u2(); };
  }

  return {
    processOrder, enqueue, reconcile, onApproved, onPaymentStatus, start,
    stats: () => ({ processedCount, lastError, blocked: [...blocked].length, steps }),
    idle: () => queue,
  };
}
