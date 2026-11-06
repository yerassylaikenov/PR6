// Fuzz (property-based) tests with a seeded PRNG: random amounts, hashes, attempts and actors.
// Property: the hub links a payment IF AND ONLY IF amount == PO total AND docHash == poHash.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex, type Hex } from "viem";
import { deployAll, HUB, PAY, paymentIdOf } from "../../testlib/fixture.ts";

// Deterministic xorshift PRNG so a failing case can be reproduced (seed printed on failure).
function prng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
  return {
    int: (max: number) => next() % max,
    big128: () => { let v = 0n; for (let i = 0; i < 4; i++) v = (v << 32n) | BigInt(next()); return (v % ((1n << 128n) - 1n)) + 1n; },
    hash: () => keccak256(toHex(`fuzz-${next()}-${next()}`)) as Hex,
  };
}
const SEED = Number(process.env.FUZZ_SEED ?? 20261106);
const RUNS = Number(process.env.FUZZ_RUNS ?? 40);

describe(`Fuzz tests (seed ${SEED}, ${RUNS} runs each)`, () => {
  it("linkPayment accepts iff amount and hash match (random uint128 amounts and hashes)", async () => {
    const f = await deployAll();
    const r = prng(SEED);
    const hub = await f.hubAs(f.orchestrator);
    let linked = 0, amountRejected = 0, hashRejected = 0;
    for (let i = 0; i < RUNS; i++) {
      const total = r.big128();
      const poHash = r.hash();
      const mode = r.int(3); // 0 = correct, 1 = tampered amount, 2 = tampered hash
      const amount = mode === 1 ? (total === 1n ? 2n : total - BigInt(1 + r.int(1000)) > 0n ? total - 1n : total + 1n) : total;
      const docHash = mode === 2 ? r.hash() : poHash;
      const o = await f.preparePaid({ total, hash: poHash, amount, docHash });
      if (mode === 0) {
        await f.publicClient.waitForTransactionReceipt({ hash: await hub.write.linkPayment([o.orderId, 1]) });
        const l = await f.hub.read.getOrder([o.orderId]);
        assert.equal(l.status, HUB.AwaitingPayment, `seed ${SEED} run ${i}`);
        assert.equal(l.amount, total);
        linked++;
      } else {
        await f.viem.assertions.revertWithCustomError(hub.write.linkPayment([o.orderId, 1]), f.hub, mode === 1 ? "AmountMismatch" : "DocHashMismatch");
        assert.equal((await f.hub.read.getOrder([o.orderId])).status, HUB.None);
        mode === 1 ? amountRejected++ : hashRejected++;
      }
    }
    console.log(`      fuzz: ${linked} linked, ${amountRejected} AmountMismatch, ${hashRejected} DocHashMismatch`);
    assert.equal(linked + amountRejected + hashRejected, RUNS);
  });

  it("random unprivileged callers can never change state of any module", async () => {
    const f = await deployAll();
    const r = prng(SEED + 1);
    const o = await f.preparePaid();
    const outsiders = [f.attacker, f.retailer, f.supplier2, f.admin];
    const before = JSON.stringify([await f.retail.read.getPO([o.orderId]), await f.bank.read.getPayment([o.paymentId]), await f.hub.read.getOrder([o.orderId])], (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    for (let i = 0; i < RUNS; i++) {
      const w = outsiders[r.int(outsiders.length)];
      const action = r.int(5);
      const call =
        action === 0 ? (await f.hubAs(w)).write.linkPayment([o.orderId, 1 + r.int(3)]) :
        action === 1 ? (await f.bankAs(w)).write.registerPayment([paymentIdOf(o.orderId, 2 + r.int(5)), r.hash(), r.big128()]) :
        action === 2 ? (await f.bankAs(w)).write.markExecuted([o.paymentId]) :
        action === 3 ? (await f.bankAs(w)).write.cancelPayment([o.paymentId]) :
                       (await f.retailAs(w)).write.approvePO([o.orderId]);
      await assert.rejects(call, `seed ${SEED} run ${i} action ${action}`);
    }
    const after = JSON.stringify([await f.retail.read.getPO([o.orderId]), await f.bank.read.getPayment([o.paymentId]), await f.hub.read.getOrder([o.orderId])], (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    assert.equal(after, before);
  });

  it("createPO input validation rejects zero id / zero hash / zero total / non-supplier", async () => {
    const f = await deployAll();
    const r = prng(SEED + 2);
    const retail = await f.retailAs(f.retailer);
    const zero = ("0x" + "00".repeat(32)) as Hex;
    for (let i = 0; i < RUNS / 2; i++) {
      const id = r.hash();
      const bad = r.int(4);
      const args: [Hex, Hex, Hex, bigint, number] = [
        bad === 0 ? zero : id,
        bad === 3 ? f.attacker.account.address : f.supplier1.account.address,
        bad === 1 ? zero : r.hash(),
        bad === 2 ? 0n : r.big128(),
        1 + r.int(20),
      ];
      const err = ["InvalidPoId", "InvalidPoHash", "InvalidAmount", "InvalidSupplier"][bad];
      await f.viem.assertions.revertWithCustomError(retail.write.createPO(args), f.retail, err);
    }
  });

  it("paymentId derivation is unique per (orderId, attempt): no collisions in random sample", async () => {
    const r = prng(SEED + 3);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const id = paymentIdOf(r.hash(), 1 + r.int(10));
      assert.ok(!seen.has(id));
      seen.add(id);
    }
    assert.equal(PAY.Registered, 1);
  });
});
