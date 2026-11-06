// Integration tests — state machine (SC03) and input validation (SC04).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deployRegistry, pid, dhash, reason } from "../../testlib/bank-helpers.ts";
import { decodeRevert } from "../../testlib/bank-errors.ts";

const ZERO32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

describe("State machine & input validation — negative", () => {
  it("6) final status is terminal (InvalidStatusTransition) and paymentId is not reusable (PaymentAlreadyExists) (SC03)", async () => {
    const { publicClient, operator, settlement, registry } = await deployRegistry();
    const paymentId = pid("sm-6");
    await registry.write
      .registerPayment([paymentId, dhash("sm-6"), 42n], { account: operator.account })
      .then((h: any) => publicClient.waitForTransactionReceipt({ hash: h }));
    await registry.write
      .markExecuted([paymentId], { account: settlement.account })
      .then((h: any) => publicClient.waitForTransactionReceipt({ hash: h }));

    // Executed -> Executed is forbidden.
    let d1;
    try {
      await registry.write.markExecuted([paymentId], { account: settlement.account });
      assert.fail("expected revert");
    } catch (e) {
      d1 = decodeRevert(e);
    }
    assert.equal(d1!.errorName, "InvalidStatusTransition");

    // Same paymentId cannot be reused.
    let d2;
    try {
      await registry.write.registerPayment([paymentId, dhash("sm-6b"), 7n], {
        account: operator.account,
      });
      assert.fail("expected revert");
    } catch (e) {
      d2 = decodeRevert(e);
    }
    assert.equal(d2!.errorName, "PaymentAlreadyExists");
  });

  it("7) zero inputs are rejected: InvalidPaymentId / InvalidDocHash / InvalidAmount / InvalidReasonCode (SC04)", async () => {
    const { publicClient, operator, settlement, registry } = await deployRegistry();

    const cases: Array<[Promise<any>, string]> = [
      [
        registry.write.registerPayment([ZERO32, dhash("z"), 1n], { account: operator.account }),
        "InvalidPaymentId",
      ],
      [
        registry.write.registerPayment([pid("z1"), ZERO32, 1n], { account: operator.account }),
        "InvalidDocHash",
      ],
      [
        registry.write.registerPayment([pid("z2"), dhash("z2"), 0n], { account: operator.account }),
        "InvalidAmount",
      ],
    ];
    for (const [p, expected] of cases) {
      let d;
      try {
        await p;
        assert.fail("expected revert for " + expected);
      } catch (e) {
        d = decodeRevert(e);
      }
      assert.equal(d!.errorName, expected);
    }

    // InvalidReasonCode needs an existing Registered payment.
    const paymentId = pid("z-reason");
    await registry.write
      .registerPayment([paymentId, dhash("z-reason"), 5n], { account: operator.account })
      .then((h: any) => publicClient.waitForTransactionReceipt({ hash: h }));
    let dr;
    try {
      await registry.write.markRejected([paymentId, ZERO32], { account: settlement.account });
      assert.fail("expected revert");
    } catch (e) {
      dr = decodeRevert(e);
    }
    assert.equal(dr!.errorName, "InvalidReasonCode");
  });
});
