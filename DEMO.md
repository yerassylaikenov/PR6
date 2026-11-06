# Сценарий защиты (10–15 минут, Windows-ноутбук)

## 1. Подготовка (заранее, один раз)

```
node -v                 (24.x)
npm ci
npm --prefix web ci
npm run compile
```

## 2. Старт

Двойной клик **`1_START_DEMO.cmd`**. Что появится:

| Окно | Что должно быть |
|---|---|
| `PR6 - START ALL` | шаги 0–6, зелёные ✔ деплоя (адреса трёх контрактов, 6 ролей), seed: `PO-2026-000001 → Paid`, `PO-2026-000002 → PaymentFailed`, в конце `STACK IS UP` |
| `PR6 - 1 Hardhat node :8545` | лог JSON-RPC, блоки транзакций |
| `PR6 - 2 Orchestrator :8788` | `startup reconciliation done (CP-6)`, `listening … (polling 250 ms)` |
| `PR6 - 3 Monitor :8787` | поток телеметрии (● зелёные — успех, красные — откат), алерты R-1/R-2/R-3 |
| `PR6 - 4 Web UI :5173` | Vite ready; браузер откроет http://localhost:5173 |

## 3. Браузер

http://localhost:5173 → режим **Local test account** (жёлтая плашка DEMO MODE — это нормально). Для показа MetaMask нажать **🦊 Connect MetaMask** — откроется окно MetaMask.

## 4. Живой сценарий по ролям

| Шаг | Действие | Ожидаемый результат |
|---|---|---|
| 1 | Аккаунт **#3 Retailer**, вкладка **Catalog & Cart**: поставщик Agro-Opt, ввести количества | сумма считается автоматически |
| 2 | **Place purchase order** | справа транзакция: simulating → signing → pending → **confirmed**, txHash, блок, gasUsed; сообщение `PO-2026-00000N created` |
| 3 | Аккаунт **#4 Supplier Agro-Opt**, вкладка **Orders** → **Approve** | PO `Approved` |
| 4 | Показать окно **Orchestrator** | сам появился `REGISTER_PAYMENT … LINK … AwaitingPayment` (≈ 0,2–0,4 с) |
| 5 | Аккаунт **#2 Clearing center**, вкладка **Settlement** | платёж `Registered`, сумма и docHash серые (только чтение) → **Execute** |
| 6 | Окно **Orchestrator** | `FINALIZE hub.finalize -> Paid` |
| 7 | Вкладка **End-to-end status** | большая плашка **Paid**, три карточки модулей, ✔ сумма, ✔ хеш, ✔ verifyDocument, таймлайн 6 транзакций |
| 8 | Вкладка **Orders** у поставщика | «Payment received - ready to ship» |

## 5. История заказа в терминале

`launchers\trace.cmd` → ввести номер (например `PO-2026-000003`) — 6 шагов с txHash/блоками и записи телеметрии по `orderId`.

## 6. Безопасность

- Вкладка **Orders** → **Unauthorized attempt** (3 раза): транзакция `REVERTED AccessControlUnauthorizedAccount`, статус PO не изменился; в окне Monitor — **ALERT R-1 [HIGH]**.
- **`2_SHOW_RESULTS.cmd`** → окна *Security 1* (unit, fuzz, инварианты) и *Security 2* (OWASP SC Top 10 2025, секреты, audit).
- Живой прогон приёмки: `launchers\acceptance.cmd` (~1,5 мин) → `ALL 7/7 ACCEPTANCE CHECKS PASSED`.

## 7. Отказ и восстановление вживую (по желанию)

- **Пауза банка:** `launchers\bank_pause.cmd` → поставщик подтверждает новый PO → в окне Orchestrator повторы `EnforcedPause, retry 1/4…`, в окне Monitor **ALERT R-2** → `launchers\bank_unpause.cmd` → в течение ≤ 15 с (периодическая сверка) заказ регистрируется; после Execute — `Paid`. То же автоматически проверяет AT-4.
- **Падение оркестратора:** закрыть окно `PR6 - 2 Orchestrator`; поставщик подтверждает новый PO (платёж не регистрируется); снова запустить `npx tsx orchestrator\index.ts` → `startup reconcile` доводит заказ до конца.

## 8. Результаты 30 повторов

`reports\load\charts-view.html` (p50/p95, задержка по прогонам, вклад этапов) и окно *Task 3*.

## 9. Если что-то пошло не так

| Проблема | Решение |
|---|---|
| Порт занят (8545, 5173, 8787, 8788) | `3_STOP_DEMO.cmd`, затем `1_START_DEMO.cmd` |
| Веб пишет `deployment.json not found` | стек не задеплоен — перезапустить `1_START_DEMO.cmd` |
| MetaMask: nonce too high / застряла транзакция | MetaMask → Settings → Advanced → **Clear activity tab data** (после перезапуска node) |
| MetaMask не на той сети | кнопка «Switch to Hardhat Local (31337)» в веб-интерфейсе |
| Нужно всё перепроверить | `launchers\run_all_checks.cmd` |
