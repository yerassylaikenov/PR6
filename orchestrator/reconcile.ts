// One-shot state reconciliation report: compares PO (B), payment (A) and hub status for every order.
import { loadDeployment, ok, fail, head, writeJson, ROOT } from "../scripts/lib/common.ts";
import { orderSummary } from "../scripts/lib/trace.ts";
import { orderNoMap } from "../scripts/lib/flow.ts";
import { retailAdapter } from "./retailAdapter.ts";
import { resolve } from "node:path";

export function consistent(s: Awaited<ReturnType<typeof orderSummary>>): string | null {
  const { po, payment, hub } = s;
  if (hub.status === "Paid") {
    if (po.status !== "Approved" || payment?.status !== "Executed") return "Paid but PO/payment not Approved/Executed";
    if (!s.checks.amountMatches || !s.checks.hashMatches) return "amount/hash mismatch";
  }
  if (hub.status === "PaymentFailed" && !["Rejected", "Cancelled"].includes(payment?.status ?? "")) return "PaymentFailed but payment not Rejected";
  if (hub.status === "AwaitingPayment" && payment?.status !== "Registered") return "AwaitingPayment but payment already settled";
  return null;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const dep = loadDeployment();
  head("RECONCILE - state consistency across Module B, Module A and Hub");
  const names = orderNoMap();
  let bad = 0; const rows = [];
  for (const id of await retailAdapter(dep).allOrderIds()) {
    const s = await orderSummary(dep, names.get(id.toLowerCase()) ?? id);
    const err = consistent(s);
    rows.push({ orderNo: s.orderNo, po: s.po.status, payment: s.payment?.status ?? "None", hub: s.hub.status, error: err });
    err ? (bad++, fail(`${s.orderNo}: ${err}`)) : ok(`${s.orderNo}: PO ${s.po.status} | payment ${s.payment?.status ?? "None"} | hub ${s.hub.status}`);
  }
  writeJson(resolve(ROOT, "reports/tests/reconcile.json"), { ts: new Date().toISOString(), orders: rows.length, discrepancies: bad, rows });
  bad === 0 ? ok(`0 discrepancies in ${rows.length} orders`) : fail(`${bad} discrepancies`);
}
