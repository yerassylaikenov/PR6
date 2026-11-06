# E2E experiment: 30 runs of the business scenario

Run: 2026-11-06T06:36:42.988Z. Conditions: fresh deploy, Hardhat automine (:8547), live orchestrator (event polling 250 ms), identical order (2 items), 2 warm-up runs excluded.

| Metric | Value |
|---|---|
| Successful operations | 30/30 (100.0%) |
| State discrepancies | 0 |
| Latency p50 | 478 ms |
| Latency p95 | 570 ms |
| Latency min / max / mean | 398 / 654 / 484 ms |

## Stage breakdown (mean)

| Stage | ms |
|---|---|
| Module B (createPO + approvePO) | 93 |
| Transfer B→A (orchestrator: registerPayment + linkPayment) | 152 |
| Module A (markExecuted) | 33 |
| Finalization (orchestrator: hub.finalize) | 205 |

## Gas (mean gasUsed)

| Step | gas |
|---|---|
| createPO | 169211 |
| approvePO | 38501 |
| registerPayment | 101274 |
| linkPayment | 150450 |
| markExecuted | 61728 |
| finalize | 69392 |

## Analysis

Limiting component: **finalize** (205 ms on average). The two automatic stages (transfer and finalization) are dominated by the orchestrator's event polling interval (250 ms) plus sequential waiting for receipts of two/one transactions; contract execution itself is ~1 block per tx on automine.
Optimization: subscribe to events via WebSocket (eth_subscribe) instead of HTTP polling, or reduce pollingInterval to 100 ms; registerPayment and linkPayment cannot be parallelised because the hub reads the registered payment.
