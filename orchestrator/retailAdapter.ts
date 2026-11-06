// Module B adapter (retail): read-only access to purchase orders.
import type { Hex } from "viem";
import { pub, type Deployment } from "../scripts/lib/common.ts";

export interface PO {
  retailer: Hex; supplier: Hex; poHash: Hex; totalPurchaseCost: bigint;
  itemCount: number; status: number; createdAt: bigint; updatedAt: bigint;
}
export const PO_APPROVED = 2;
export const PO_CANCELLED = 3;

export function retailAdapter(dep: Deployment) {
  const c = dep.contracts.retail;
  return {
    getPO: (orderId: Hex) => pub.readContract({ ...c, functionName: "getPO", args: [orderId] }) as Promise<PO>,
    async allOrderIds(): Promise<Hex[]> {
      const n = Number(await pub.readContract({ ...c, functionName: "orderCount" }));
      const ids: Hex[] = [];
      for (let i = 0; i < n; i++) ids.push((await pub.readContract({ ...c, functionName: "orderIdAt", args: [BigInt(i)] })) as Hex);
      return ids;
    },
    watchApproved(onLog: (log: any) => void) {
      return pub.watchContractEvent({ ...c, eventName: "PurchaseOrderApproved", pollingInterval: 250, onLogs: (logs) => logs.forEach(onLog) });
    },
  };
}
