// Shared fixture: deploys Module A, Module B and the Hub on the in-process Hardhat network.
import { network } from "hardhat";
import { keccak256, toHex, encodeAbiParameters, type Hex } from "viem";

export const ROLE = (n: string) => keccak256(toHex(n));
export const orderIdOf = (no: string) => keccak256(toHex(no));
export const paymentIdOf = (orderId: Hex, attempt: number) =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint32" }], [orderId, attempt]));
export const PO = { None: 0, Created: 1, Approved: 2, Cancelled: 3 } as const;
export const PAY = { None: 0, Registered: 1, Executed: 2, Rejected: 3, Cancelled: 4 } as const;
export const HUB = { None: 0, AwaitingPayment: 1, Paid: 2, PaymentFailed: 3 } as const;

export async function deployAll() {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [admin, orchestrator, settlement, retailer, supplier1, supplier2, attacker] = await viem.getWalletClients();
  const bank = await viem.deployContract("PaymentOrderRegistry", [admin.account.address]);
  const retail = await viem.deployContract("RetailPurchaseOrder", [admin.account.address]);
  const hub = await viem.deployContract("OrderSettlementHub", [retail.address, bank.address, admin.account.address]);
  const grants: [any, string, any][] = [
    [bank, "OPERATOR_ROLE", orchestrator], [bank, "SETTLEMENT_ROLE", settlement], [hub, "ORCHESTRATOR_ROLE", orchestrator],
    [retail, "RETAILER_ROLE", retailer], [retail, "SUPPLIER_ROLE", supplier1], [retail, "SUPPLIER_ROLE", supplier2],
  ];
  for (const [c, r, w] of grants) await publicClient.waitForTransactionReceipt({ hash: await c.write.grantRole([ROLE(r), w.account.address]) });

  const ctx = { viem, publicClient, admin, orchestrator, settlement, retailer, supplier1, supplier2, attacker, bank, retail, hub };

  let seq = 0;
  /** Creates + approves a PO and registers the payment (amount/hash may be overridden for negative cases). */
  async function preparePaid(opts: { total?: bigint; amount?: bigint; hash?: Hex; docHash?: Hex; attempt?: number; approve?: boolean; register?: boolean } = {}) {
    const orderId = orderIdOf(`PO-TEST-${++seq}-${Date.now()}`);
    const total = opts.total ?? 1_000_000n;
    const poHash = opts.hash ?? keccak256(toHex(`po-doc-${seq}`));
    const r = await viem.getContractAt("RetailPurchaseOrder", retail.address, { client: { wallet: retailer } });
    await publicClient.waitForTransactionReceipt({ hash: await r.write.createPO([orderId, supplier1.account.address, poHash, total, 1]) });
    if (opts.approve !== false) {
      const s = await viem.getContractAt("RetailPurchaseOrder", retail.address, { client: { wallet: supplier1 } });
      await publicClient.waitForTransactionReceipt({ hash: await s.write.approvePO([orderId]) });
    }
    const attempt = opts.attempt ?? 1;
    const paymentId = paymentIdOf(orderId, attempt);
    if (opts.register !== false) {
      const b = await viem.getContractAt("PaymentOrderRegistry", bank.address, { client: { wallet: orchestrator } });
      await publicClient.waitForTransactionReceipt({ hash: await b.write.registerPayment([paymentId, opts.docHash ?? poHash, opts.amount ?? total]) });
    }
    return { orderId, paymentId, total, poHash, attempt };
  }
  const hubAs = (w: any) => viem.getContractAt("OrderSettlementHub", hub.address, { client: { wallet: w } });
  const bankAs = (w: any) => viem.getContractAt("PaymentOrderRegistry", bank.address, { client: { wallet: w } });
  const retailAs = (w: any) => viem.getContractAt("RetailPurchaseOrder", retail.address, { client: { wallet: w } });
  return { ...ctx, preparePaid, hubAs, bankAs, retailAs };
}
