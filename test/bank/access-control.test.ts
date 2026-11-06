// Integration tests — access control (OWASP SC01) and four-eyes (SC01/SC03).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deployRegistry,
  pid,
  dhash,
  OPERATOR_ROLE,
  SETTLEMENT_ROLE,
} from "../../testlib/bank-helpers.ts";
import { decodeRevert } from "../../testlib/bank-errors.ts";

describe("Access control — negative", () => {
  it("4) outsider calling registerPayment reverts (AccessControlUnauthorizedAccount); state unchanged (SC01)", async () => {
    const { publicClient, outsider, registry } = await deployRegistry();
    const before = await registry.read.totalRegistered();

    let decoded;
    try {
      await registry.write.registerPayment(
        [pid("ac-4"), dhash("ac-4"), 1n],
        { account: outsider.account },
      );
      assert.fail("expected revert");
    } catch (err) {
      decoded = decodeRevert(err);
    }
    assert.equal(decoded!.errorName, "AccessControlUnauthorizedAccount");

    const after = await registry.read.totalRegistered();
    assert.equal(before, after);
  });

  it("5) a role holder settling their OWN payment reverts (SelfSettlementForbidden) (SC01/SC03)", async () => {
    const { viem, publicClient, admin, registry } = await deployRegistry();
    // accounts[4] holds BOTH roles -> can register and attempt to settle.
    const wallets = await viem.getWalletClients();
    const dual = wallets[4];
    for (const role of [OPERATOR_ROLE, SETTLEMENT_ROLE]) {
      const h = await registry.write.grantRole([role, dual.account.address], {
        account: admin.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }

    const paymentId = pid("ac-5");
    const reg = await registry.write.registerPayment(
      [paymentId, dhash("ac-5"), 100n],
      { account: dual.account },
    );
    await publicClient.waitForTransactionReceipt({ hash: reg });

    let decoded;
    try {
      await registry.write.markExecuted([paymentId], { account: dual.account });
      assert.fail("expected revert");
    } catch (err) {
      decoded = decodeRevert(err);
    }
    assert.equal(decoded!.errorName, "SelfSettlementForbidden");
  });

  it("extra) pause() by a non-admin reverts (SC01/SC10)", async () => {
    const { outsider, registry } = await deployRegistry();
    let decoded;
    try {
      await registry.write.pause({ account: outsider.account });
      assert.fail("expected revert");
    } catch (err) {
      decoded = decodeRevert(err);
    }
    assert.equal(decoded!.errorName, "AccessControlUnauthorizedAccount");
  });
});
