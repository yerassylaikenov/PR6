# Угрозы интеграции (STRIDE + OWASP Smart Contract Top 10 2025)

| # | Угроза (STRIDE) | OWASP SC 2025 | Мера | Проверка |
|---|---|---|---|---|
| 1 | Подмена суммы оркестратором / скомпрометированной интеграцией (Tampering) | SC04 Input Validation | хаб сам читает `totalPurchaseCost` из Б и `amount` из А, `AmountMismatch` → не связывает; компенсация `cancelPayment` | AT-5, unit `AmountMismatch`, fuzz (40 случайных uint128), R-3 (б) |
| 2 | Подмена документа / хеша (Tampering) | SC04 | `DocHashMismatch` в хабе; `verifyDocument` по каноническому JSON | unit `DocHashMismatch`, fuzz, аудитор в UI |
| 3 | Повтор сообщения / события (Repudiation / Tampering) | SC03 Logic Errors | дедуп `txHash:logIndex`, `operationId`, on-chain проверки перед шагом, `PaymentAlreadyExists`, `AlreadyLinked`, `AlreadyFinalized` | AT-3, unit `AlreadyLinked/AlreadyFinalized` |
| 4 | Рассинхронизация модулей (платёж исполнен, хаб не финализирован) | SC03 | reconciliation при старте и каждые 15 с; `finalize` доступен любому; R-3 (а) через 30 с | AT-6, инварианты I1–I4 (300 случайных шагов) |
| 5 | Компрометация ключа оркестратора (Elevation of Privilege) | SC01 Access Control | оркестратор не может объявить заказ оплаченным: `Paid` только при `Executed` от расчётного центра (≠ инициатор, «4 глаза»); сумма/хеш сверяются хабом | unit `finalize → Paid`, инварианты; остаточный риск — см. ACCEPTANCE_REPORT |
| 6 | Действия без полномочий (EoP) | SC01 | `onlyRole` по `msg.sender` во всех трёх контрактах, без `tx.origin`; админ без операционных ролей | AT-2, fuzz «random unprivileged callers», R-1 |
| 7 | Отказ модуля (Denial of Service) | SC10 DoS | повтор с backoff 1/2/4/8 с, R-2, reconciliation; пауза только у админа | AT-4 |
| 8 | Подмена адреса контракта модуля (Spoofing) | SC01 / SC06 | адреса модулей `immutable` в конструкторе хаба; только `view`-вызовы `getPO`/`getPayment`; клиенты читают адреса из `deployment.json` и проверяют `chainId` | OWASP-check SC06, ревью кода |
| 9 | DoS спамом заказов | SC10 | нет циклов в изменяющих функциях (O(1) mapping), создание PO только с RETAILER_ROLE; оркестратор обрабатывает очередь последовательно | OWASP-check SC10, нагрузка 30 прогонов |
| 10 | Раскрытие коммерческих данных (Information Disclosure) | — | on-chain только хеши, суммы, адреса; позиции и цены — off-chain `data/orders`; телеметрия без секретов | ревью, `check:secrets` |
