// End-to-end order history built ONLY from the blockchain (events + current state).
import type { Hex } from "viem";
import { pub, orderIdOf, paymentIdOf, PO_STATUS, PAY_STATUS, HUB_STATUS, type Deployment } from "./common.ts";

export async function orderSummary(dep: Deployment, orderNo: string) {
  const orderId = (orderNo.startsWith("0x") ? orderNo : orderIdOf(orderNo)) as Hex;
  const { retail, bank, hub } = dep.contracts;
  const po: any = await pub.readContract({ ...retail, functionName: "getPO", args: [orderId] });
  const link: any = await pub.readContract({ ...hub, functionName: "getOrder", args: [orderId] });

  const steps: { step: string; module: string; txHash: Hex; block: bigint; actor?: string; detail?: string; ts?: number }[] = [];
  const add = async (step: string, module: string, logs: any[], detail?: (l: any) => string, actor?: (l: any) => string) => {
    for (const l of logs) {
      const b = await pub.getBlock({ blockNumber: l.blockNumber });
      steps.push({ step, module, txHash: l.transactionHash, block: l.blockNumber, detail: detail?.(l), actor: actor?.(l), ts: Number(b.timestamp) });
    }
  };
  const ev = (c: any, eventName: string, args: any) => pub.getContractEvents({ ...c, eventName, args, fromBlock: 0n } as any);

  await add("PO created", "retail", await ev(retail, "PurchaseOrderCreated", { poId: orderId }),
    (l) => `total ${l.args.totalPurchaseCost} tiyn, poHash ${String(l.args.poHash).slice(0, 10)}…`, (l) => l.args.retailer);
  await add("PO approved", "retail", await ev(retail, "PurchaseOrderApproved", { poId: orderId }), undefined, (l) => l.args.supplier);
  await add("PO cancelled", "retail", await ev(retail, "PurchaseOrderCancelled", { poId: orderId }), undefined, (l) => l.args.retailer);

  const linked = await ev(hub, "OrderPaymentLinked", { orderId });
  // payment ids for all attempts that exist on-chain (1..N)
  const pids: Hex[] = [];
  for (let a = 1; a <= 10; a++) {
    const pid = paymentIdOf(orderId, a);
    const p: any = await pub.readContract({ ...bank, functionName: "getPayment", args: [pid] });
    if (p.status === 0) break;
    pids.push(pid);
  }
  for (const pid of pids) {
    await add("Payment registered", "bank", await ev(bank, "PaymentRegistered", { paymentId: pid }),
      (l) => `amount ${l.args.amount}, docHash ${String(l.args.docHash).slice(0, 10)}…`, (l) => l.args.operator);
    await add("Payment status", "bank", await ev(bank, "PaymentStatusChanged", { paymentId: pid }),
      (l) => `${PAY_STATUS[l.args.from]} -> ${PAY_STATUS[l.args.to]}`, (l) => l.args.actor);
  }
  await add("Hub linked", "hub", linked, (l) => `attempt ${l.args.attempt}, amount ${l.args.amount}`);
  await add("Hub finalized", "hub", await ev(hub, "OrderFinalized", { orderId }), (l) => HUB_STATUS[l.args.finalStatus]);
  steps.sort((a, b) => Number(a.block - b.block));

  const pay: any = link.status !== 0
    ? await pub.readContract({ ...bank, functionName: "getPayment", args: [link.paymentId] })
    : pids.length ? await pub.readContract({ ...bank, functionName: "getPayment", args: [pids[pids.length - 1]] }) : null;
  return {
    orderNo, orderId,
    po: { status: PO_STATUS[po.status], total: po.totalPurchaseCost.toString(), poHash: po.poHash, retailer: po.retailer, supplier: po.supplier },
    payment: pay ? { paymentId: link.status !== 0 ? link.paymentId : pids[pids.length - 1], status: PAY_STATUS[pay.status], amount: pay.amount.toString(), docHash: pay.docHash } : null,
    hub: { status: HUB_STATUS[link.status], attempt: link.attempt, amount: link.amount.toString(), docHash: link.docHash },
    checks: {
      amountMatches: !!pay && pay.amount === po.totalPurchaseCost,
      hashMatches: !!pay && pay.docHash === po.poHash,
    },
    steps: steps.map((s) => ({ ...s, block: s.block.toString() })),
    attempts: pids.length,
  };
}
