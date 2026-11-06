// Unit tests of OrderSettlementHub (prompt section 8, >= 8 cases).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex } from "viem";
import { deployAll, HUB, PAY } from "../../testlib/fixture.ts";

describe("OrderSettlementHub - unit", () => {
  it("links a payment with matching amount and hash (AwaitingPayment)", async () => {
    const f = await deployAll();
    const o = await f.preparePaid();
    const hub = await f.hubAs(f.orchestrator);
    await f.publicClient.waitForTransactionReceipt({ hash: await hub.write.linkPayment([o.orderId, 1]) });
    const l = await f.hub.read.getOrder([o.orderId]);
    assert.equal(l.status, HUB.AwaitingPayment);
    assert.equal(l.amount, o.total);
    assert.equal(l.paymentId, o.paymentId);
  });

  it("reverts AmountMismatch when payment amount differs from PO total", async () => {
    const f = await deployAll();
    const o = await f.preparePaid({ amount: 1_000_001n });
    const hub = await f.hubAs(f.orchestrator);
    await f.viem.assertions.revertWithCustomError(hub.write.linkPayment([o.orderId, 1]), f.hub, "AmountMismatch");
  });

  it("reverts DocHashMismatch when payment docHash differs from poHash", async () => {
    const f = await deployAll();
    const o = await f.preparePaid({ docHash: keccak256(toHex("forged")) });
    const hub = await f.hubAs(f.orchestrator);
    await f.viem.assertions.revertWithCustomError(hub.write.linkPayment([o.orderId, 1]), f.hub, "DocHashMismatch");
  });

  it("reverts AlreadyLinked on a repeated link of the same attempt", async () => {
    const f = await deployAll();
    const o = await f.preparePaid();
    const hub = await f.hubAs(f.orchestrator);
    await f.publicClient.waitForTransactionReceipt({ hash: await hub.write.linkPayment([o.orderId, 1]) });
    await f.viem.assertions.revertWithCustomError(hub.write.linkPayment([o.orderId, 1]), f.hub, "AlreadyLinked");
  });

  it("reverts AccessControlUnauthorizedAccount when linking without ORCHESTRATOR_ROLE", async () => {
    const f = await deployAll();
    const o = await f.preparePaid();
    const hub = await f.hubAs(f.attacker);
    await f.viem.assertions.revertWithCustomError(hub.write.linkPayment([o.orderId, 1]), f.hub, "AccessControlUnauthorizedAccount");
  });

  it("reverts PONotApproved when the PO is not approved by the supplier", async () => {
    const f = await deployAll();
    const o = await f.preparePaid({ approve: false });
    const hub = await f.hubAs(f.orchestrator);
    await f.viem.assertions.revertWithCustomError(hub.write.linkPayment([o.orderId, 1]), f.hub, "PONotApproved");
  });

  it("reverts NotSettledYet when finalizing before settlement", async () => {
    const f = await deployAll();
    const o = await f.preparePaid();
    const hub = await f.hubAs(f.orchestrator);
    await f.publicClient.waitForTransactionReceipt({ hash: await hub.write.linkPayment([o.orderId, 1]) });
    await f.viem.assertions.revertWithCustomError(hub.write.finalize([o.orderId]), f.hub, "NotSettledYet");
  });

  it("finalize -> Paid after markExecuted (anyone may call finalize)", async () => {
    const f = await deployAll();
    const o = await f.preparePaid();
    await f.publicClient.waitForTransactionReceipt({ hash: await (await f.hubAs(f.orchestrator)).write.linkPayment([o.orderId, 1]) });
    await f.publicClient.waitForTransactionReceipt({ hash: await (await f.bankAs(f.settlement)).write.markExecuted([o.paymentId]) });
    await f.publicClient.waitForTransactionReceipt({ hash: await (await f.hubAs(f.attacker)).write.finalize([o.orderId]) });
    assert.equal((await f.hub.read.getOrder([o.orderId])).status, HUB.Paid);
  });

  it("finalize -> PaymentFailed after markRejected", async () => {
    const f = await deployAll();
    const o = await f.preparePaid();
    await f.publicClient.waitForTransactionReceipt({ hash: await (await f.hubAs(f.orchestrator)).write.linkPayment([o.orderId, 1]) });
    await f.publicClient.waitForTransactionReceipt({ hash: await (await f.bankAs(f.settlement)).write.markRejected([o.paymentId, toHex("AC04", { size: 32 })]) });
    await f.publicClient.waitForTransactionReceipt({ hash: await f.hub.write.finalize([o.orderId]) });
    assert.equal((await f.hub.read.getOrder([o.orderId])).status, HUB.PaymentFailed);
  });

  it("reverts AlreadyFinalized on repeated finalize and on link after Paid", async () => {
    const f = await deployAll();
    const o = await f.preparePaid();
    await f.publicClient.waitForTransactionReceipt({ hash: await (await f.hubAs(f.orchestrator)).write.linkPayment([o.orderId, 1]) });
    await f.publicClient.waitForTransactionReceipt({ hash: await (await f.bankAs(f.settlement)).write.markExecuted([o.paymentId]) });
    await f.publicClient.waitForTransactionReceipt({ hash: await f.hub.write.finalize([o.orderId]) });
    await f.viem.assertions.revertWithCustomError(f.hub.write.finalize([o.orderId]), f.hub, "AlreadyFinalized");
    await f.viem.assertions.revertWithCustomError((await f.hubAs(f.orchestrator)).write.linkPayment([o.orderId, 2]), f.hub, "AlreadyFinalized");
  });

  it("reverts NotLinked when finalizing an unknown order", async () => {
    const f = await deployAll();
    await f.viem.assertions.revertWithCustomError(f.hub.write.finalize([keccak256(toHex("nope"))]), f.hub, "NotLinked");
  });

  it("allows attempt 2 only after the previous payment was cancelled (compensation)", async () => {
    const f = await deployAll();
    const o = await f.preparePaid({ amount: 999n });
    const hub = await f.hubAs(f.orchestrator);
    await f.viem.assertions.revertWithCustomError(hub.write.linkPayment([o.orderId, 1]), f.hub, "AmountMismatch");
    const bank = await f.bankAs(f.orchestrator);
    await f.publicClient.waitForTransactionReceipt({ hash: await bank.write.cancelPayment([o.paymentId]) });
    assert.equal((await f.bank.read.getPayment([o.paymentId])).status, PAY.Cancelled);
    await f.viem.assertions.revertWithCustomError(hub.write.linkPayment([o.orderId, 1]), f.hub, "PaymentNotRegistered");
    const { paymentIdOf } = await import("../../testlib/fixture.ts");
    const pid2 = paymentIdOf(o.orderId, 2);
    await f.publicClient.waitForTransactionReceipt({ hash: await bank.write.registerPayment([pid2, o.poHash, o.total]) });
    await f.publicClient.waitForTransactionReceipt({ hash: await hub.write.linkPayment([o.orderId, 2]) });
    assert.equal((await f.hub.read.getOrder([o.orderId])).attempt, 2);
  });

  it("pause blocks linkPayment (EnforcedPause), only admin can pause", async () => {
    const f = await deployAll();
    const o = await f.preparePaid();
    await f.viem.assertions.revertWithCustomError((await f.hubAs(f.attacker)).write.pause(), f.hub, "AccessControlUnauthorizedAccount");
    await f.publicClient.waitForTransactionReceipt({ hash: await f.hub.write.pause() });
    await f.viem.assertions.revertWithCustomError((await f.hubAs(f.orchestrator)).write.linkPayment([o.orderId, 1]), f.hub, "EnforcedPause");
  });
});
