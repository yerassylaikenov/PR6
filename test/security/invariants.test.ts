// Stateful invariant testing: a random sequence of operations by random actors (including the
// attacker) is applied to all three contracts; after EVERY step the invariants are checked.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex, type Hex } from "viem";
import { deployAll, HUB, PAY, PO, orderIdOf, paymentIdOf } from "../../testlib/fixture.ts";

function prng(seed: number) {
  let s = seed >>> 0 || 1;
  return (max: number) => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s % max; };
}
const SEED = Number(process.env.INV_SEED ?? 6062026);
const STEPS = Number(process.env.INV_STEPS ?? 300);

describe(`Invariant tests (seed ${SEED}, ${STEPS} random steps)`, () => {
  it("cross-module invariants hold after every random operation", async () => {
    const f = await deployAll();
    const rnd = prng(SEED);
    const orders: { id: Hex; hash: Hex; total: bigint; attempt: number }[] = [];
    const finalSeen = new Map<string, number>();
    let ok = 0, reverted = 0;

    const tryTx = async (p: Promise<Hex>) => {
      try { await f.publicClient.waitForTransactionReceipt({ hash: await p }); ok++; } catch { reverted++; }
    };

    for (let step = 0; step < STEPS; step++) {
      const op = rnd(9);
      const o = orders.length ? orders[rnd(orders.length)] : undefined;
      if (op === 0 || !o) {
        const id = orderIdOf(`INV-${step}`), hash = keccak256(toHex(`inv-${step}`)), total = BigInt(1 + rnd(10_000_000));
        await tryTx((await f.retailAs(f.retailer)).write.createPO([id, f.supplier1.account.address, hash, total, 1]));
        orders.push({ id, hash, total, attempt: 1 });
      } else if (op === 1) await tryTx((await f.retailAs(rnd(4) ? f.supplier1 : f.attacker)).write.approvePO([o.id]));
      else if (op === 2) { // orchestrator registers payment; sometimes tampered
        const tamper = rnd(4) === 0;
        await tryTx((await f.bankAs(f.orchestrator)).write.registerPayment([paymentIdOf(o.id, o.attempt), o.hash, tamper ? o.total + 1n : o.total]));
      } else if (op === 3) await tryTx((await f.hubAs(rnd(5) ? f.orchestrator : f.attacker)).write.linkPayment([o.id, o.attempt]));
      else if (op === 4) await tryTx((await f.bankAs(rnd(5) ? f.settlement : f.attacker)).write.markExecuted([paymentIdOf(o.id, o.attempt)]));
      else if (op === 5) await tryTx((await f.bankAs(f.settlement)).write.markRejected([paymentIdOf(o.id, o.attempt), toHex("AC04", { size: 32 })]));
      else if (op === 6) await tryTx((await f.hubAs(f.attacker)).write.finalize([o.id])); // permissionless
      else if (op === 7) { // compensation: cancel and move to next attempt
        const p = await f.bank.read.getPayment([paymentIdOf(o.id, o.attempt)]);
        const l = await f.hub.read.getOrder([o.id]);
        if (p.status === PAY.Registered && l.status === HUB.None) {
          await tryTx((await f.bankAs(f.orchestrator)).write.cancelPayment([paymentIdOf(o.id, o.attempt)]));
          o.attempt++;
        }
      } else await tryTx((await f.retailAs(f.attacker)).write.cancelPO([o.id])); // always unauthorized

      // ---- invariants ----
      for (const x of orders) {
        const po = await f.retail.read.getPO([x.id]);
        const link = await f.hub.read.getOrder([x.id]);
        if (link.status === HUB.None) continue;
        const pay = await f.bank.read.getPayment([link.paymentId]);
        // I1: a linked order always refers to an approved PO with identical amount and hash
        assert.equal(po.status, PO.Approved, `I1 step ${step}`);
        assert.equal(link.amount, po.totalPurchaseCost, `I1 amount step ${step}`);
        assert.equal(link.docHash, po.poHash, `I1 hash step ${step}`);
        assert.equal(pay.amount, po.totalPurchaseCost, `I1 payment amount step ${step}`);
        // I2: Paid => payment Executed ; PaymentFailed => payment Rejected/Cancelled
        if (link.status === HUB.Paid) assert.equal(pay.status, PAY.Executed, `I2 step ${step}`);
        if (link.status === HUB.PaymentFailed) assert.ok(pay.status === PAY.Rejected || pay.status === PAY.Cancelled, `I2b step ${step}`);
        // I3: paymentId bound to (orderId, attempt)
        assert.equal(link.paymentId, paymentIdOf(x.id, link.attempt), `I3 step ${step}`);
        // I4: final statuses are irreversible
        const prev = finalSeen.get(x.id);
        if (prev !== undefined) assert.equal(link.status, prev, `I4 step ${step}`);
        if (link.status >= HUB.Paid) finalSeen.set(x.id, link.status);
      }
    }
    console.log(`      invariants: ${STEPS} steps, ${ok} successful tx, ${reverted} reverted, ${orders.length} orders, ${finalSeen.size} finalized`);
    assert.ok(ok > 0 && reverted > 0);
  });
});
