// Property-based / fuzz tests.
// P1 (SC04/SC08): for any valid (paymentId, docHash, amount) the contract
//   stores exactly those values, and verifyDocument returns true ONLY for the
//   original hash. Boundary amounts 1 and type(uint128).max are included.
// P2 (SC01): for any funded account WITHOUT a role, every write function
//   reverts and the registry state does not change.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex, type Hex } from "viem";
import { deployRegistry, pid, Status } from "../../testlib/bank-helpers.ts";
import { decodeRevert } from "../../testlib/bank-errors.ts";

const UINT128_MAX = (1n << 128n) - 1n;

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randHex32(rng: () => number): Hex {
  let s = "0x";
  for (let i = 0; i < 64; i++) s += Math.floor(rng() * 16).toString(16);
  return s as Hex;
}
function randAmount(rng: () => number): bigint {
  // 128-bit-ish random in [1, UINT128_MAX].
  let v = 0n;
  for (let i = 0; i < 4; i++) v = (v << 32n) | BigInt(Math.floor(rng() * 2 ** 32));
  return (v % UINT128_MAX) + 1n;
}

describe("Property: stored data round-trips and verifyDocument is exact (SC04/SC08)", () => {
  it("P1) exact storage + verifyDocument over random inputs and boundaries", async () => {
    const { publicClient, operator, registry } = await deployRegistry();
    const rng = mulberry32(0x50523552); // "PR5R"

    const samples: Array<{ id: Hex; doc: Hex; amount: bigint }> = [
      { id: pid("p1-min"), doc: keccak256(toHex("p1-min")), amount: 1n },
      { id: pid("p1-max"), doc: keccak256(toHex("p1-max")), amount: UINT128_MAX },
    ];
    for (let i = 0; i < 25; i++) {
      samples.push({
        id: keccak256(toHex(`p1-rand-${i}`)),
        doc: randHex32(rng),
        amount: randAmount(rng),
      });
    }

    for (const s of samples) {
      const h = await registry.write.registerPayment([s.id, s.doc, s.amount], {
        account: operator.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: h });

      const p = await registry.read.getPayment([s.id]);
      assert.equal(p.status, Status.Registered);
      assert.equal(p.docHash, s.doc);
      assert.equal(p.amount, s.amount);

      assert.equal(await registry.read.verifyDocument([s.id, s.doc]), true);
      // Any different hash must be rejected.
      const other = (s.doc === randHex32(rng) ? keccak256(toHex("x")) : randHex32(rng)) as Hex;
      if (other !== s.doc) {
        assert.equal(await registry.read.verifyDocument([s.id, other]), false);
      }
      // Zero hash is never accepted.
      assert.equal(
        await registry.read.verifyDocument([
          s.id,
          "0x0000000000000000000000000000000000000000000000000000000000000000",
        ]),
        false,
      );
    }
  });
});

describe("Property: unprivileged accounts cannot write (SC01)", () => {
  it("P2) every write reverts for random role-less accounts; state unchanged", async () => {
    const { viem, publicClient, operator, registry } = await deployRegistry();
    const wallets = await viem.getWalletClients();
    // Seed one real payment so markExecuted/markRejected/cancel have a target.
    const target = pid("p2-target");
    await registry.write
      .registerPayment([target, keccak256(toHex("p2")), 10n], { account: operator.account })
      .then((h: any) => publicClient.waitForTransactionReceipt({ hash: h }));

    const before = await registry.read.totalRegistered();
    // Accounts 5..12 are funded test accounts without any role.
    const rolelessIdx = [5, 6, 7, 8, 9, 10, 11, 12];
    for (const idx of rolelessIdx) {
      const acc = wallets[idx].account;
      const attempts: Array<[Promise<any>, string]> = [
        [registry.write.registerPayment([pid(`p2-${idx}`), keccak256(toHex("d")), 1n], { account: acc }), "registerPayment"],
        [registry.write.cancelPayment([target], { account: acc }), "cancelPayment"],
        [registry.write.markExecuted([target], { account: acc }), "markExecuted"],
        [registry.write.markRejected([target, toHex("AC01", { size: 32 })], { account: acc }), "markRejected"],
      ];
      for (const [p, label] of attempts) {
        let d;
        try {
          await p;
          assert.fail(`${label} must revert for roleless ${idx}`);
        } catch (e) {
          d = decodeRevert(e);
        }
        assert.equal(d!.errorName, "AccessControlUnauthorizedAccount", label);
      }
    }
    // State unchanged by all the failed attempts.
    assert.equal(await registry.read.totalRegistered(), before);
    const p = await registry.read.getPayment([target]);
    assert.equal(p.status, Status.Registered);
  });
});
