// Integration tests — positive flows and event correctness.
// OWASP SC03 (logic/state machine), event integrity for the monitor.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deployRegistry, pid, dhash, reason, Status } from "../../testlib/bank-helpers.ts";

async function registeredEvents(publicClient: any, registry: any) {
  return publicClient.getContractEvents({
    address: registry.address,
    abi: registry.abi,
    eventName: "PaymentRegistered",
    fromBlock: 0n,
    toBlock: "latest",
  });
}
async function statusEvents(publicClient: any, registry: any) {
  return publicClient.getContractEvents({
    address: registry.address,
    abi: registry.abi,
    eventName: "PaymentStatusChanged",
    fromBlock: 0n,
    toBlock: "latest",
  });
}

describe("Payment flow — positive", () => {
  it("1) register -> markExecuted updates state and emits correct events (SC03)", async () => {
    const { publicClient, operator, settlement, registry } = await deployRegistry();
    const paymentId = pid("flow-exec-1");
    const docHash = dhash("flow-exec-1");

    const regHash = await registry.write.registerPayment(
      [paymentId, docHash, 1000n],
      { account: operator.account },
    );
    await publicClient.waitForTransactionReceipt({ hash: regHash });

    const execHash = await registry.write.markExecuted([paymentId], {
      account: settlement.account,
    });
    await publicClient.waitForTransactionReceipt({ hash: execHash });

    const p = await registry.read.getPayment([paymentId]);
    assert.equal(p.status, Status.Executed);
    assert.equal(p.docHash, docHash);
    assert.equal(p.amount, 1000n);
    assert.equal(p.registeredBy.toLowerCase(), operator.account.address.toLowerCase());
    assert.equal(p.settledBy.toLowerCase(), settlement.account.address.toLowerCase());

    const regEvents = await registeredEvents(publicClient, registry);
    assert.equal(regEvents.length, 1);
    assert.equal(regEvents[0].args.amount, 1000n);
    const stEvents = await statusEvents(publicClient, registry);
    assert.equal(stEvents.length, 1);
    assert.equal(stEvents[0].args.to, Status.Executed);
  });

  it("2) register -> markRejected stores the reason code (SC03)", async () => {
    const { publicClient, operator, settlement, registry } = await deployRegistry();
    const paymentId = pid("flow-rej-1");
    await registry.write
      .registerPayment([paymentId, dhash("flow-rej-1"), 500n], {
        account: operator.account,
      })
      .then((h: any) => publicClient.waitForTransactionReceipt({ hash: h }));

    const rc = reason("AC04");
    const h = await registry.write.markRejected([paymentId, rc], {
      account: settlement.account,
    });
    await publicClient.waitForTransactionReceipt({ hash: h });

    const p = await registry.read.getPayment([paymentId]);
    assert.equal(p.status, Status.Rejected);
    const ev = await statusEvents(publicClient, registry);
    assert.equal(ev[0].args.reasonCode, rc);
  });

  it("3) register -> cancelPayment by the initiator (SC03)", async () => {
    const { publicClient, operator, registry } = await deployRegistry();
    const paymentId = pid("flow-cancel-1");
    await registry.write
      .registerPayment([paymentId, dhash("flow-cancel-1"), 700n], {
        account: operator.account,
      })
      .then((h: any) => publicClient.waitForTransactionReceipt({ hash: h }));

    const h = await registry.write.cancelPayment([paymentId], {
      account: operator.account,
    });
    await publicClient.waitForTransactionReceipt({ hash: h });

    const p = await registry.read.getPayment([paymentId]);
    assert.equal(p.status, Status.Cancelled);
  });

  it("8) a reverted tx emits NO event; range query has no duplicates (SC03)", async () => {
    const { publicClient, operator, outsider, registry } = await deployRegistry();

    // Legitimate registration (emits exactly 1 event).
    const okId = pid("evt-1");
    const regHash = await registry.write.registerPayment(
      [okId, dhash("evt-1"), 10n],
      { account: operator.account },
    );
    await publicClient.waitForTransactionReceipt({ hash: regHash });

    // Unauthorized registration reverts: on Hardhat automine the send THROWS
    // (the tx is never mined), so it can never emit an event. This is exactly
    // why the monitor (Task 3) cannot rely on eth_getLogs for failed attempts.
    const badId = pid("evt-outsider");
    let reverted = false;
    try {
      await registry.write.registerPayment([badId, dhash("evt-outsider"), 10n], {
        account: outsider.account,
      });
    } catch {
      reverted = true;
    }
    assert.equal(reverted, true);

    // Only the one successful event exists; dedup key has no collisions.
    const events = await registeredEvents(publicClient, registry);
    assert.equal(events.length, 1);
    assert.equal(events[0].args.paymentId, okId);
    const keys = new Set(events.map((e: any) => `${e.transactionHash}-${e.logIndex}`));
    assert.equal(keys.size, events.length);
  });
});
