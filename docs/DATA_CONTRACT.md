# Контракт взаимодействия модулей (DATA_CONTRACT)

## 1. Общий идентификатор и идентификаторы операций

| Имя | Формула | Где используется |
|---|---|---|
| Номер заказа | `PO-2026-NNNNNN` (сквозная нумерация по `orderCount`) | UI, документ PO, trace |
| `orderId` | `keccak256(utf8(orderNo))`, bytes32 | poId в модуле Б, ключ в хабе, correlationId мониторинга |
| `paymentId` | `keccak256(abi.encode(orderId, uint32 attempt))`, attempt ≥ 1 | ключ платежа в модуле А; уникальность гарантирует `PaymentAlreadyExists` |
| `operationId` | `keccak256(abi.encode(orderId, step, attempt))` | журнал оркестратора `state/outbox.json` (идемпотентность CP-3) |

## 2. Документ PO (off-chain, `data/orders/<orderNo>.json`)

Канонический JSON — ключи отсортированы, без пробелов. Суммы — целые числа в **тиынах** (1 ₸ = 100 тиын).

```json
{"createdAt":"…","currency":"KZT","items":[{"name":"…","qty":5,"sku":"AGR-001","unitPurchasePrice":1250000}],
 "orderId":"0x…","orderNo":"PO-2026-000003","retailer":"0x…","supplier":"0x…","totalPurchaseCost":15890000}
```

`poHash = keccak256(canonicalJson)` хранится в модуле Б и передаётся в модуль А как `docHash`. Проверка целостности документа: `PaymentOrderRegistry.verifyDocument(paymentId, keccak256(doc))`.

## 3. On-chain данные модулей

| Модуль | Функция / событие | Поля |
|---|---|---|
| Б `RetailPurchaseOrder` | `createPO(poId, supplier, poHash, totalPurchaseCost, itemCount)` — RETAILER | статусы `None → Created → Approved / Cancelled` |
| Б | `approvePO(poId)` — SUPPLIER адресат PO; событие `PurchaseOrderApproved(poId, supplier)` | статус «подтверждён» = `Approved` |
| Б | `getPO(poId)` | `retailer, supplier, poHash, totalPurchaseCost, itemCount, status, createdAt, updatedAt` |
| А `PaymentOrderRegistry` | `registerPayment(paymentId, docHash, amount)` — OPERATOR | `None → Registered → Executed / Rejected / Cancelled` |
| А | `markExecuted / markRejected` — SETTLEMENT (≠ инициатор); событие `PaymentStatusChanged` | |
| Hub `OrderSettlementHub` | `linkPayment(orderId, attempt)` — ORCHESTRATOR; `finalize(orderId)` — любой | `None → AwaitingPayment → Paid / PaymentFailed` |

## 4. Сообщение интеграции (журнал оркестратора и телеметрия)

```json
{ "operationId": "0x…", "orderId": "0x…", "step": "REGISTER_PAYMENT|LINK|FINALIZE|COMPENSATE",
  "attempt": 1, "amount": "15890000", "docHash": "0x…", "resultTx": "0x…", "block": "24", "outcome": "success|reverted", "ts": "…" }
```

Запись телеметрии монитора: `{ ts, correlationId (= orderId), module: retail|bank|hub|orchestrator|web, category, actor, txHash, blockNumber, outcome, errorName, severity }`. Секреты не логируются.

## 5. Источник достоверного состояния

Только блокчейн. Статус заказа — в модуле Б, статус платежа — в модуле А, итоговый статус — в хабе. `state/`, `data/orders`, телеметрия — кеш/журналы; после удаления `state/` оркестратор восстанавливает работу по блокчейну (проверено в AT-6).

## 6. Порядок вызовов и событий

```
createPO (Б, ритейлер) → approvePO (Б, поставщик) → [PurchaseOrderApproved]
  → registerPayment (А, оркестратор: amount = totalPurchaseCost, docHash = poHash, прочитаны из Б)
  → linkPayment (Hub: сверка суммы, хеша и статусов on-chain, CP-4)
  → markExecuted | markRejected (А, расчётный центр) → [PaymentStatusChanged]
  → finalize (Hub: перечитывает А) → Paid | PaymentFailed
```

## 7. Права доступа

| # | Аккаунт | Роли |
|---|---|---|
| 0 | Администратор | DEFAULT_ADMIN_ROLE во всех трёх контрактах (pause/unpause, роли), без операционных ролей |
| 1 | Банк покупателя (оркестратор) | OPERATOR_ROLE (А), ORCHESTRATOR_ROLE (Hub) |
| 2 | Расчётный центр | SETTLEMENT_ROLE (А) |
| 3 | Ритейлер «Magazin Astana» | RETAILER_ROLE (Б) |
| 4 | Поставщик «Agro-Opt LLP» | SUPPLIER_ROLE (Б) |
| 5 | Поставщик «Fresh Products LLP» | SUPPLIER_ROLE (Б) |
| 6 | Нарушитель | нет ролей |

Все проверки выполняют контракты по `msg.sender` (без `tx.origin`). Ключи выводятся из публичной тестовой мнемоники Hardhat в рантайме.

## 8. Обработка ошибок

| Ошибка | Реакция оркестратора |
|---|---|
| `EnforcedPause`, RPC timeout | повтор с backoff 1, 2, 4, 8 с (5 попыток), телеметрия → R-2; затем ожидание, периодическая сверка (15 с) |
| `PaymentAlreadyExists` | шаг уже выполнен (идемпотентность) → переход к `linkPayment` |
| `AlreadyLinked`, `AlreadyFinalized` | шаг выполнен, пропуск |
| `AmountMismatch`, `DocHashMismatch` | **не повторять**; телеметрия → R-3; компенсация `cancelPayment` ошибочного платежа; заказ блокируется до перезапуска с исправленными данными (attempt + 1) |
| `AccessControlUnauthorizedAccount` | телеметрия → R-1, остановка обработки заказа |
| `NotSettledYet` | ждать события `PaymentStatusChanged` |
