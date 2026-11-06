// Invariant tests (OWASP SC01 / SC03).
// We drive the contract through a long RANDOM but reproducible (seeded)
// sequence of legitimate actions interleaved with outsider attack attempts,
// and after every step we assert INV-1..INV-3 against a ghost model.
//
// INV-1 (SC01): only role holders change state; an address without a role
//               cannot change anything -> every attack attempt reverts and
//               leaves totalRegistered unchanged.
// INV-2 (SC03): a final status (Executed/Rejected/Cancelled) never changes,
//               and docHash/amount/registeredBy are immutable after register.
// INV-3 (SC01/SC03): for Executed/Rejected, settledBy != registeredBy
//               (four-eyes), and totalRegistered == #successful registrations.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex } from "viem";
import { deployRegistry, Status } from "../../testlib/bank-helpers.ts";
import { decodeRevert } from "../../testlib/bank-errors.ts";

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Ghost {
  status: number;
  docHash: `0x${string}`;
  amount: bigint;
  registeredBy: string;
  settledBy: string;
}

describe("Invariants under random sequences (SC01/SC03)", () => {
  it("INV-1..INV-3 hold after 60 randomized steps", async () => {
    const { publicClient, operator, settlement, outsider, registry } =
      await deployRegistry();
    const rng = mulberry32(0x5052_3531); // "PR51"
    const ghost = new Map<string, Ghost>();
    let successfulRegistrations = 0;

    const ids = Array.from({ length: 10 }, (_, i) => keccak256(toHex(`inv-${i}`)));
    const pick = <T>(a: T[]) => a[Math.floor(rng() * a.length)];

    const registered = () =>
      [...ghost.entries()].filter(([, g]) => g.status === Status.Registered);

    for (let step = 0; step < 60; step++) {
      // --- INV-1: an outsider attack must always revert (no state change). ---
      const before = await registry.read.totalRegistered();
      let decoded;
      try {
        await registry.write.registerPayment(
          [keccak256(toHex(`attack-${step}`)), keccak256(toHex("d")), 1n],
          { account: outsider.account },
        );
        assert.fail("outsider register must revert");
      } catch (e) {
        decoded = decodeRevert(e);
      }
      assert.equal(decoded!.errorName, "AccessControlUnauthorizedAccount");
      assert.equal(await registry.read.totalRegistered(), before);

      // --- choose a legitimate action ---
      const roll = rng();
      if (roll < 0.5) {
        // register a fresh id
        const free = ids.filter((id) => !ghost.has(id));
        if (free.length) {
          const id = pick(free);
          const docHash = keccak256(toHex(`doc-${id}`));
          const amount = BigInt(1 + Math.floor(rng() * 1_000_000));
          const h = await registry.write.registerPayment([id, docHash, amount], {
            account: operator.account,
          });
          await publicClient.waitForTransactionReceipt({ hash: h });
          ghost.set(id, {
            status: Status.Registered,
            docHash,
            amount,
            registeredBy: operator.account.address.toLowerCase(),
            settledBy: "0x0000000000000000000000000000000000000000",
          });
          successfulRegistrations++;
        }
      } else {
        const regs = registered();
        if (regs.length) {
          const [id, g] = pick(regs);
          const op = rng();
          if (op < 0.34) {
            const h = await registry.write.cancelPayment([id as `0x${string}`], {
              account: operator.account,
            });
            await publicClient.waitForTransactionReceipt({ hash: h });
            g.status = Status.Cancelled;
          } else if (op < 0.67) {
            const h = await registry.write.markExecuted([id as `0x${string}`], {
              account: settlement.account,
            });
            await publicClient.waitForTransactionReceipt({ hash: h });
            g.status = Status.Executed;
            g.settledBy = settlement.account.address.toLowerCase();
          } else {
            const h = await registry.write.markRejected(
              [id as `0x${string}`, toHex("AC01", { size: 32 })],
              { account: settlement.account },
            );
            await publicClient.waitForTransactionReceipt({ hash: h });
            g.status = Status.Rejected;
            g.settledBy = settlement.account.address.toLowerCase();
          }
        }
      }

      // --- verify ghost vs chain for every known id ---
      for (const [id, g] of ghost) {
        const p = await registry.read.getPayment([id as `0x${string}`]);
        assert.equal(p.status, g.status);
        // INV-2: immutable fields
        assert.equal(p.docHash, g.docHash);
        assert.equal(p.amount, g.amount);
        assert.equal(p.registeredBy.toLowerCase(), g.registeredBy);
        // INV-3: four-eyes on finals
        if (g.status === Status.Executed || g.status === Status.Rejected) {
          assert.notEqual(
            p.settledBy.toLowerCase(),
            p.registeredBy.toLowerCase(),
          );
        }
      }
    }

    // INV-3: counter equals number of successful registrations.
    assert.equal(
      await registry.read.totalRegistered(),
      BigInt(successfulRegistrations),
    );
  });
});
