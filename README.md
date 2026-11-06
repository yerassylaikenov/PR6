# ПР №6 — MVP «B2B-маркетплейс закупок с банковской оплатой»

Объединение двух PR5: **модуль А** — тема 1 «Банки и финтех» (Айкенов Ерасыл, `PaymentOrderRegistry`) и **модуль Б** — тема 10 «Розничная торговля» (`RetailPurchaseOrder`). Интеграционный контракт `OrderSettlementHub` и оркестратор связывают их в один процесс: заказ ритейлера у поставщика автоматически оплачивается банковским платёжным поручением, итоговый статус фиксируется в блокчейне.

```
Ритейлер ─createPO─► [Модуль Б] ─approvePO (поставщик)─► событие
          оркестратор (авто) ─registerPayment(amount, docHash из Б)─► [Модуль А] ─linkPayment─► [Hub: сверка суммы/хеша]
          расчётный центр ─markExecuted─► [Модуль А] ─событие─► оркестратор ─finalize─► [Hub] = Paid
```

## Быстрый старт (Windows)

| Действие | Как |
|---|---|
| Установка (один раз) | `npm ci` и `npm --prefix web ci`, затем `npm run compile` |
| **Запустить всё** | двойной клик **`1_START_DEMO.cmd`** (окна: Hardhat node, Orchestrator, Monitor, Web) → откроется http://localhost:5173 |
| **Показать результаты в терминалах** (зелёные галочки) | двойной клик **`2_SHOW_RESULTS.cmd`** — 5 окон, работает в любой момент, даже когда всё закрыто |
| Остановить | **`3_STOP_DEMO.cmd`** |
| Сквозной сценарий одной командой | `launchers\demo_e2e.cmd` (или `npm run demo:e2e`) — при запущенном стеке |
| История заказа | `launchers\trace.cmd` (или `npm run trace -- PO-2026-000003`) |
| Приёмка AT-1…AT-7 | `launchers\acceptance.cmd` (отдельный стенд на :8546, ~1,5 мин) |
| 30 повторов + графики | `launchers\load.cmd` |
| Тесты + fuzz + инварианты + OWASP | `launchers\tests_security.cmd` |
| Пауза / снятие паузы банка (живой отказ) | `launchers\bank_pause.cmd`, `launchers\bank_unpause.cmd` |
| Переснять скриншоты для отчёта | `npm run screenshots` (≈ 6 мин, окна откроются на экране) |
| Перепроверить всё заново | `launchers\run_all_checks.cmd` (~4 мин, затем откроет окна результатов) |
| Альтернатива одной командой | `npm run demo:up` (всё в одном терминале с цветными префиксами) |

## Состав

| Папка | Что |
|---|---|
| `contracts/bank` | модуль А из PR5 — **без изменений** (sha256 проверяется) |
| `contracts/retail` | модуль Б (см. `docs/DISCOVERY.md`) |
| `contracts/integration` | `OrderSettlementHub` — связь заказа и платежа, итоговый статус |
| `orchestrator/` | авто-передача Б→А→Hub, идемпотентность, повторы, reconciliation, API `:8788` (только чтение) |
| `monitor/` | единый коллектор `:8787`, правила R-1, R-2, **R-3** |
| `web/` | единая точка входа: каталог/корзина, заказы, расчёты, сквозной статус, мониторинг; **локальные тестовые аккаунты** или **MetaMask** |
| `scripts/` | deploy, seed, demo-e2e, trace, acceptance, OWASP-проверка, show-results, скриншоты |
| `test/` | unit хаба (13), fuzz (4), инварианты (300 случайных шагов), тесты модуля А из PR5 (13) |
| `loadtest/` | 30 прогонов, p50/p95, SVG-графики |
| `reports/` | фактические результаты всех прогонов и скриншоты |
| `docs/` | паспорт, контракт данных, критерии, угрозы, отчёт о приёмке, вклад, ответы |

## MetaMask

Кнопка **«Connect MetaMask»** вызывает `eth_requestAccounts` — открывается окно MetaMask. Если сеть не 31337, появится кнопка «Switch to Hardhat Local» (`wallet_addEthereumChain`). Для подписи в MetaMask импортируйте нужный тестовый аккаунт Hardhat (например, #3 ритейлер). Основной режим для защиты — «Local test account» (без переключений в MetaMask).

## Безопасность

Только тестовые аккаунты из публичной мнемоники Hardhat (выводятся в рантайме), синтетические данные, `.env` в `.gitignore`. Проверки: `npm run check:secrets`, `npm run owasp`, `npm run ci:local`, CI — `.github/workflows/ci.yml`.
