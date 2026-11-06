# REPORT_DATA — данные для отчёта (собраны автоматически из reports/)

Сформировано: 2026-11-06T07:22:59.092Z

## Версии

| Компонент | Версия |
|---|---|
| Node.js | v24.13.0 |
| Hardhat | 3.18.1 |
| viem | 2.57.3 |
| OpenZeppelin | 5.6.1 |
| solc | 0.8.28 (optimizer 200) |
| OS | Microsoft Windows [Version 10.0.26300.9711] |

## Адреса контрактов и роли (локальная сеть 31337, сквозной сценарий)

| Контракт | Адрес | Блок |
|---|---|---|
| bank | `0x5fbdb2315678afecb367f032d93f642f64180aa3` | 1 |
| retail | `0xe7f1725e7734ce288f8367e1bb143e90bb3f0512` | 2 |
| hub | `0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0` | 3 |

| # | Аккаунт | Адрес | Роли |
|---|---|---|---|
| 0 | Administrator | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | DEFAULT_ADMIN_ROLE (all 3 contracts) |
| 1 | Buyer's bank (orchestrator) | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | OPERATOR_ROLE (A), ORCHESTRATOR_ROLE (Hub) |
| 2 | Clearing center | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | SETTLEMENT_ROLE (A) |
| 3 | Retailer 'Magazin Astana' | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | RETAILER_ROLE (B) |
| 4 | Supplier 'Agro-Opt LLP' | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` | SUPPLIER_ROLE (B) |
| 5 | Supplier 'Fresh Products LLP' | `0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc` | SUPPLIER_ROLE (B) |
| 6 | Attacker | `0x976EA74026E726554dB657fA54763abd0C3a0aa9` | none |

## Сквозной сценарий PO-2026-000003 (`npm run demo:e2e`, 2026-11-06T07:21:52.689Z)

| Шаг | Модуль | Блок | txHash | Детали |
|---|---|---|---|---|
| PO created | retail | 22 | `0x97fde99e2a9cec39632f5b69e319d3bfb9eeac9f01fc60a37fa20fc915e64262` | total 15890000 tiyn, poHash 0x9392dc5a… |
| PO approved | retail | 23 | `0xdcf22f344842488dd65776ef0f02d1973b3de283141921633b4f21f659745ca0` |  |
| Payment registered | bank | 24 | `0x2b7dec3cfefd5e0ec695cf164f49654cfb94628f695f0f31fa35710928d85a22` | amount 15890000, docHash 0x9392dc5a… |
| Hub linked | hub | 25 | `0xc73d49f6011b87441857dc9633e76f976d8fc2537552c397d691e87b83e456be` | attempt 1, amount 15890000 |
| Payment status | bank | 26 | `0x23d2694d27ff309c670210d5e9cc4bb8c23be7ac9fa7d9b253549796b0740b9d` | Registered -> Executed |
| Hub finalized | hub | 27 | `0xf0927231a6071b4a15ae331bc7d8172a70e7d30c671fd6943ff814a399cb08b6` | Paid |

Итог: PO **Approved**, платёж **Executed**, хаб **Paid**; сумма 15890000 тиын; авто-регистрация платежа через 124 мс; сквозная задержка 720 мс.

## Приёмочные проверки (2026-11-06T07:15:44.892Z)

| ID | Проверка | Результат |
|---|---|---|
| AT-1 | Successful process | **PASS** |
| AT-2 | Unauthorized permissions | **PASS** |
| AT-3 | Duplicate message | **PASS** |
| AT-4 | Failure of one module | **PASS** |
| AT-5 | Data mismatch | **PASS** |
| AT-6 | Recovery after failure | **PASS** |
| AT-7 | Payment rejection | **PASS** |

Итого 7/7 PASS; расхождений после сверки: 0 (7 заказов).

### Алерты монитора

- **R-3** [High] cross-module discrepancy (a) PO-2026-000006: payment settled in Module A but hub not finalized for 30s
- **R-3** [High] cross-module data mismatch AmountMismatch for order 0x5247423401… (hub refused to link)
- **R-2** [Medium] 2 operational failures within 120s (last: EnforcedPause in orchestrator)
- **R-1** [High] 3 access-control violations from 0x976ea74026e726554db657fa54763abd0c3a0aa9 within 60s (last: AccessControlUnauthorizedAccount)

## 30 повторов (2026-11-06T06:36:42.988Z)

| Метрика | Значение |
|---|---|
| Доля успешных | 30/30 (100.0%) |
| Расхождения | 0 |
| p50 / p95 | 478 / 570 мс |
| min / max / mean | 398 / 654 / 484 мс |
| Этапы (среднее) | Б 93 · передача 152 · А 33 · финализация 205 мс |
| gasUsed | createPO 169211 · approvePO 38501 · registerPayment 101274 · linkPayment 150450 · markExecuted 61728 · finalize 69392 |

## Тесты и безопасность

- node:test: **31 passing, 0 failing** (2026-11-06T07:16:05.403Z)
- fuzz: 13 linked, 14 AmountMismatch, 13 DocHashMismatch
- invariants: 300 steps, 86 successful tx, 194 reverted, 32 orders, 2 finalized
- OWASP SC Top 10 (2025): **10/10 PASS**
- CI local: PASSED; npm audit (prod) high+critical = 0; dev toolchain high = 13
