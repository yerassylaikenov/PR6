// Detection rules.
// R-1 (High)   access-control violation: >= 3 access-denied errors from ONE actor within 60 s.  [PR5 Aikenov]
//              access errors of Module B (NotOrderSupplier / NotOrderRetailer) were added.        [Module B]
// R-2 (Medium) operational failure: >= 2 failures (EnforcedPause, RPC, timeouts ...) within 120 s. [PR5 Aikenov]
// R-3 (High)   CROSS-MODULE DISCREPANCY (new, CP-5):
//              (a) payment Executed/Rejected in A but hub did not finalize the order for > 30 s;
//              (b) hub reconciliation failure AmountMismatch / DocHashMismatch;
//              (c) PO cancelled in B while a live (Registered) payment exists in A.
// Rules are driven by receipts, application telemetry and the orchestrator journal - not only
// eth_getLogs, because events of reverted transactions never reach the log.
import type { AlertSink } from "./alerts.ts";

export interface TelemetryRecord {
  ts: string; correlationId?: string; module: string; category: string; actor?: string;
  txHash?: string; blockNumber?: string; outcome: string; errorName?: string; severity?: string; step?: string;
}

const ACCESS = new Set(["AccessControlUnauthorizedAccount", "NotPaymentInitiator", "SelfSettlementForbidden", "NotOrderSupplier", "NotOrderRetailer"]);
const MISMATCH = new Set(["AmountMismatch", "DocHashMismatch"]);
const IGNORE = new Set(["AlreadyLinked", "AlreadyFinalized", "PaymentAlreadyExists", "NotSettledYet"]);

export class RuleEngine {
  private r1 = new Map<string, number[]>();
  private r2: number[] = [];
  constructor(private readonly alerts: AlertSink) {}

  ingest(rec: TelemetryRecord) {
    if (rec.outcome === "success" || !rec.errorName || IGNORE.has(rec.errorName)) return;
    const t = Date.parse(rec.ts);
    const err = rec.errorName;
    if (ACCESS.has(err)) {
      const actor = (rec.actor ?? "unknown").toLowerCase();
      const hits = (this.r1.get(actor) ?? []).filter((x) => t - x <= 60_000);
      hits.push(t);
      this.r1.set(actor, hits);
      if (hits.length >= 3) this.alerts.fire({ rule: "R-1", severity: "High", key: actor, correlationId: rec.correlationId, ts: rec.ts, message: `${hits.length} access-control violations from ${actor} within 60s (last: ${err})` });
    } else if (MISMATCH.has(err)) {
      this.alerts.fire({ rule: "R-3", severity: "High", key: rec.correlationId ?? "?", correlationId: rec.correlationId, ts: rec.ts, message: `cross-module data mismatch ${err} for order ${rec.correlationId?.slice(0, 12)}… (hub refused to link)` });
    } else {
      this.r2 = this.r2.filter((x) => t - x <= 120_000);
      this.r2.push(t);
      if (this.r2.length >= 2) this.alerts.fire({ rule: "R-2", severity: "Medium", key: "global", correlationId: rec.correlationId, ts: rec.ts, message: `${this.r2.length} operational failures within 120s (last: ${err} in ${rec.module})` });
    }
  }

  /** R-3 (a)/(c): periodic cross-module state check (stuckSince is tracked by the collector). */
  crossModule(orderId: string, orderNo: string, kind: "a" | "c", detail: string) {
    this.alerts.fire({ rule: "R-3", severity: "High", key: orderId, correlationId: orderId, ts: new Date().toISOString(), message: `cross-module discrepancy (${kind}) ${orderNo}: ${detail}` });
  }
}
