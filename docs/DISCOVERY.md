# Этап 0 — разбор исходных PR5

## Модуль А — PR5 Айкенова (тема 1 «Банки и финтех»)

- Репозиторий: https://github.com/yerassylaikenov/PR_5 (клонирован в `_sources/pr5_bank/`, в git не входит).
- Стек: Hardhat 3.18.1 + viem 2.57.3 + TypeScript, OpenZeppelin 5.6.1, solc 0.8.28, Vite + React dApp, мониторинг `monitor/` (R-1, R-2, cooldown), нагрузка, лаунчеры `.cmd`.
- Контракт `PaymentOrderRegistry.sol` перенесён **без изменений**: sha256 (LF) = `13c4f8891ca3b601fbb02045f12d1cc226c6af3c54d5700fb336898ad270bfc2` — совпадает с эталоном (проверяется в окне Task 2).
- Переиспользовано: контракт, 13 тестов PR5 (`test/bank/`), правила R-1/R-2 и антидубль (`monitor/`), машина состояний транзакции, декодирование ошибок, MetaMask-guard сети (`web/src/lib.ts`), проверка секретов, стиль терминальных отчётов и лаунчеров.

## Модуль Б — PR5 сокомандника (тема 10 «Розничная торговля»)

> **Важно.** На момент сборки архива PR5 сокомандника в папке проекта **не было**. Чтобы MVP работал целиком, модуль Б реализован как минимальный контракт `contracts/retail/RetailPurchaseOrder.sol` строго по предметной области темы 10 и по архитектурной схеме (уровень 4: «pold, retailer, supplier, poHash (позиции), totalPurchaseCost, статусы Created → Approved, onlyRole RETAILER / SUPPLIER»). Перед защитой его нужно заменить/сверить с реальным контрактом сокомандника (см. ниже).

| Вопрос | Ответ (текущий модуль Б) |
|---|---|
| Инструменты | Hardhat 3 (общий тулчейн), solc 0.8.28, OpenZeppelin AccessControl |
| Роли | `RETAILER_ROLE` (создаёт/отменяет свои PO), `SUPPLIER_ROLE` (подтверждает адресованные ему PO), `DEFAULT_ADMIN_ROLE` |
| Структура PurchaseOrder | `retailer, supplier, poHash, totalPurchaseCost (uint128, тиын), itemCount, status, createdAt, updatedAt` |
| Идентификатор | `bytes32 poId = orderId` (соответствие `orderId → poId` не требуется) |
| Хеш документа | `poHash = keccak256(канонический JSON позиций)` хранится в поле |
| Статусы | `None → Created → Approved / Cancelled` |
| Функции | `createPO`, `approvePO`, `cancelPO`, `getPO`, `orderCount`, `orderIdAt` |
| События | `PurchaseOrderCreated`, `PurchaseOrderApproved`, `PurchaseOrderCancelled` |
| Ошибки | `InvalidPoId, InvalidPoHash, InvalidAmount, InvalidSupplier, PurchaseOrderExists, PurchaseOrderNotFound, InvalidPOStatus, NotOrderSupplier, NotOrderRetailer` |

## Таблица сопоставления под дизайн интеграции

| Что нужно интеграции | Источник в модуле Б |
|---|---|
| Создание PO | `createPO(poId, supplier, poHash, totalPurchaseCost, itemCount)` |
| Подтверждение поставщиком | `approvePO(poId)` → событие `PurchaseOrderApproved` |
| `totalPurchaseCost`, `poHash` | `getPO(poId).totalPurchaseCost`, `getPO(poId).poHash` |
| Статус «подтверждён» | `POStatus.Approved` (= 2) |
| `orderId` | `poId` = `keccak256("PO-2026-NNNNNN")` |

## Как подключить реальный контракт сокомандника

1. Распаковать архив в `_sources/pr5_retail/`, положить контракт в `contracts/retail/`.
2. Если имена функций отличаются — поправить только `orchestrator/retailAdapter.ts`, `scripts/lib/flow.ts` (createPO/approvePO) и чтение `getPO` в `OrderSettlementHub.sol`.
3. Если в контракте нет хеша PO или суммы в геттере — минимальное изменение: добавить поле `poHash` / геттер (согласовать).
4. Если там Foundry — тесты сокомандника положить в `contracts/retail/test/` и запускать `forge test` в CI только при наличии Foundry.

## Риски объединения и решения

| Риск | Решение |
|---|---|
| Разные версии solc / OpenZeppelin | один профиль Hardhat: solc 0.8.28, OZ 5.6.1 |
| Foundry vs Hardhat | основной стек — Hardhat 3; Foundry-тесты опционально в CI |
| Разные типы id (uint256 vs bytes32) | хаб хранит `orderId`; при uint256 — добавить mapping `orderId → poId` |
| Нет хеша документа в модуле Б | хеш канонического JSON в поле/событии |
