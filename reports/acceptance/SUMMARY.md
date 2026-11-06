# Acceptance summary (AT-1..AT-7)

Run: 2026-11-06T07:15:44.893Z - isolated stand (Hardhat node :8546, automine)

| ID | Check | Expected | Result |
|---|---|---|---|
| AT-1 | Successful process | Paid; amount/hash match; all steps are real tx | **PASS** |
| AT-2 | Unauthorized permissions | all reverted, state unchanged, R-1 | **PASS** |
| AT-3 | Duplicate message | one payment; AlreadyLinked; result unchanged | **PASS** |
| AT-4 | Failure of one module | auto recovery to Paid, R-2, no duplicates | **PASS** |
| AT-5 | Data mismatch | AmountMismatch, R-3, not Paid; compensation; attempt 2 -> Paid | **PASS** |
| AT-6 | Recovery after failure | reconciliation -> Paid <= 60 s, no duplicates, R-3 | **PASS** |
| AT-7 | Payment rejection | PaymentFailed, statuses consistent | **PASS** |

Total: **7/7 PASS**, discrepancies after reconciliation: **0** in 7 orders.

## Alerts raised by the monitor

- R-3 [High] cross-module discrepancy (a) PO-2026-000006: payment settled in Module A but hub not finalized for 30s
- R-3 [High] cross-module data mismatch AmountMismatch for order 0x5247423401… (hub refused to link)
- R-2 [Medium] 2 operational failures within 120s (last: EnforcedPause in orchestrator)
- R-1 [High] 3 access-control violations from 0x976ea74026e726554db657fa54763abd0c3a0aa9 within 60s (last: AccessControlUnauthorizedAccount)
