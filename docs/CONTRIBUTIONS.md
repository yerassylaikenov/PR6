# Вклад участников

## Айкенов Ерасыл — модуль А «Банки и финтех»

| Файлы | Технические решения, которые защищает |
|---|---|
| `contracts/bank/PaymentOrderRegistry.sol` (без изменений из PR5) | автомат статусов, «4 глаза» (`SelfSettlementForbidden`), уникальность `paymentId`, пауза, `verifyDocument` |
| `orchestrator/bankAdapter.ts` | регистрация платежа строго по данным PO из модуля Б, компенсация `cancelPayment` |
| `web/src/App.tsx` — вкладка «Settlement» | поля суммы и хеша только для чтения (К1), кнопки Execute / Reject |
| `monitor/rules.ts`, `monitor/alerts.ts` (R-1, R-2, cooldown — перенос из PR5) | правила по квитанциям и журналам, а не только `eth_getLogs` |
| `contracts/integration/OrderSettlementHub.sol` — сверка платежа | `AmountMismatch`, `DocHashMismatch`, `paymentId = keccak256(orderId, attempt)` |
| `test/bank/*` (13 тестов PR5) | регресс модуля А в общем проекте |

## [ФИО сокомандника] — модуль Б «Розничная торговля»

| Файлы | Технические решения |
|---|---|
| `contracts/retail/RetailPurchaseOrder.sol` | роли RETAILER / SUPPLIER, PO с `poHash` и `totalPurchaseCost` (см. DISCOVERY.md — заменить на контракт из PR5 сокомандника) |
| `orchestrator/retailAdapter.ts` | чтение PO, подписка на `PurchaseOrderApproved` |
| `data/catalog.json`, `web/src/App.tsx` — «Catalog & Cart», «Orders» | каталог, корзина одного поставщика, авто-расчёт суммы, подтверждение PO |
| мониторинг модуля Б | ошибки `NotOrderSupplier` / `NotOrderRetailer` включены в R-1 |

## Совместно

| Файлы | Решения |
|---|---|
| `docs/DATA_CONTRACT.md`, `docs/PASSPORT.md`, архитектура | общий `orderId`, канонический JSON, порядок вызовов, таблица ошибок |
| `contracts/integration/OrderSettlementHub.sol` | итоговый статус только по данным обоих модулей, `finalize` без прав |
| `orchestrator/*` | идемпотентность (CP-3), повторы с backoff, reconciliation (CP-6), флаги отказов |
| `monitor/collector.ts`, правило **R-3** | единая телеметрия по `orderId`, межмодульное расхождение |
| `scripts/acceptance.ts`, `loadtest/*`, `test/unit`, `test/security` | AT-1…AT-7, 30 прогонов, unit/fuzz/invariant тесты, OWASP-проверка |
