// Module A adapter (bank): the buyer's bank registers payment orders strictly from
// the PO data read on-chain (OPERATOR_ROLE) and listens for settlement events.
import type { Hex } from "viem";
import { pub, wallet, type Deployment } from "../scripts/lib/common.ts";

export interface Payment {
  docHash: Hex; amount: bigint; registeredAt: bigint; updatedAt: bigint;
  status: number; registeredBy: Hex; settledBy: Hex;
}
export const PAY = { None: 0, Registered: 1, Executed: 2, Rejected: 3, Cancelled: 4 } as const;

export function bankAdapter(dep: Deployment) {
  const c = dep.contracts.bank;
  const w = wallet("orchestrator");
  async function write(functionName: string, args: unknown[]) {
    const { request } = await pub.simulateContract({ ...c, functionName, args, account: w.account } as any);
    const hash = await w.writeContract(request as any);
    const r = await pub.waitForTransactionReceipt({ hash });
    return { hash, block: r.blockNumber, gasUsed: r.gasUsed };
  }
  return {
    getPayment: (pid: Hex) => pub.readContract({ ...c, functionName: "getPayment", args: [pid] }) as Promise<Payment>,
    registerPayment: (pid: Hex, docHash: Hex, amount: bigint) => write("registerPayment", [pid, docHash, amount]),
    cancelPayment: (pid: Hex) => write("cancelPayment", [pid]),
    watchStatus(onLog: (log: any) => void) {
      return pub.watchContractEvent({ ...c, eventName: "PaymentStatusChanged", pollingInterval: 250, onLogs: (logs) => logs.forEach(onLog) });
    },
  };
}
