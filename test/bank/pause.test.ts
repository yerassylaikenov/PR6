// Integration test — emergency pause / DoS mitigation (OWASP SC10).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deployRegistry, pid, dhash, Status } from "../../testlib/bank-helpers.ts";
import { decodeRevert } from "../../testlib/bank-errors.ts";

describe("Emergency pause (SC10)", () => {
  it("9) pause() blocks writes (EnforcedPause); unpause() restores them", async () => {
    const { publicClient, admin, operator, registry } = await deployRegistry();

    const ph = await registry.write.pause({ account: admin.account });
    await publicClient.waitForTransactionReceipt({ hash: ph });

    let decoded;
    try {
      await registry.write.registerPayment([pid("p-9"), dhash("p-9"), 1n], {
        account: operator.account,
      });
      assert.fail("expected revert while paused");
    } catch (e) {
      decoded = decodeRevert(e);
    }
    assert.equal(decoded!.errorName, "EnforcedPause");

    const uh = await registry.write.unpause({ account: admin.account });
    await publicClient.waitForTransactionReceipt({ hash: uh });

    const rh = await registry.write.registerPayment([pid("p-9"), dhash("p-9"), 1n], {
      account: operator.account,
    });
    await publicClient.waitForTransactionReceipt({ hash: rh });
    const p = await registry.read.getPayment([pid("p-9")]);
    assert.equal(p.status, Status.Registered);
  });
});
