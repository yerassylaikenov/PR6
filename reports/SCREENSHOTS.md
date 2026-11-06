# Скриншоты для отчёта (в порядке отчёта)

Все снимки сделаны на этом ноутбуке скриптом `scripts/take-screenshots.ps1`: реальные окна консоли (захват окна через PrintWindow) и реальный веб-интерфейс в Microsoft Edge на работающем стенде. Папка: `reports/screenshots/`.

| № | Файл | Что на скриншоте | Раздел отчёта |
|---|---|---|---|
| 1 | `../docs/architecture/PR6_Architecture_MVP.drawio.png` | архитектура: уровни 0–5, ГД-1…ГД-5, CP-1…CP-6 | Задание 1.3 |
| 2 | `show_01_task1_design.png` | окно «Task 1»: сценарий, контракт данных, критерии К1–К4 с фактическими значениями | Задание 1 |
| 3 | `term_01_start_all_deploy_seed.png` | запуск `1_START_DEMO.cmd`: деплой трёх контрактов, роли, seed | Задание 2.4 |
| 4 | `web_01_catalog_cart.png` | ритейлер: каталог и корзина, авто-сумма | Задание 2.2 |
| 5 | `web_02_po_created.png` | PO создан: стадии транзакции, txHash, блок, gasUsed | Задание 2.2 |
| 6 | `web_03_supplier_incoming.png` | поставщик: входящие PO, кнопка Approve | Задание 2.2 |
| 7 | `web_04_settlement_registered_auto.png` | расчётный центр: платёж создан **автоматически**, сумма и хеш только для чтения | Задание 2.2, К1 |
| 8 | `term_03_orchestrator_auto_steps.png` | окно оркестратора: REGISTER_PAYMENT → LINK → FINALIZE без ручных действий | Задание 2.2–2.3 |
| 9 | `web_05_auditor_paid_timeline.png` | аудитор: **Paid**, три модуля, сверка суммы/хеша, verifyDocument, таймлайн txHash | Задание 2.4 |
| 10 | `web_06_supplier_payment_received.png` | поставщик: «Payment received - ready to ship» | Задание 2.4 |
| 11 | `term_02_demo_e2e_paid.png` | `demo_e2e`: сквозной сценарий одной командой, цепочка txHash, состояния трёх контрактов | Задание 2.4 |
| 12 | `term_06_trace_order.png` | `trace`: история заказа из блокчейна и телеметрии по orderId | Задание 3.1 |
| 13 | `web_07_unauthorized_attempt.png` | негатив: нарушитель → `AccessControlUnauthorizedAccount`, состояние не изменилось | Задание 3.2 (AT-2) |
| 14 | `term_04_monitor_telemetry_R1.png` | окно монитора: единая телеметрия, ALERT R-1 | Задание 3.1 |
| 15 | `web_08_monitoring.png` | вкладка Monitoring: статус оркестратора и алерты | Задание 3.1 |
| 16 | `term_07_acceptance_summary.png` | живой прогон приёмки: AT-6 (R-3, восстановление), AT-7, итог 7/7 PASS | Задание 3.2 |
| 17 | `show_03_task3_acceptance.png` | окно «Task 3»: R-1/R-2/R-3, AT-1…AT-7, 30 прогонов, решение о готовности | Задание 3.2–3.4 |
| 18 | `charts_30_runs.png` | 30 повторов: доля успеха, p50/p95, задержка по прогонам, вклад этапов | Задание 3.3 |
| 19 | `show_02_task2_mvp.png` | окно «Task 2»: неизменность контракта А (sha256), цепочка tx, согласованность | Задание 2 |
| 20 | `show_04_security_tests.png` | окно «Security 1»: unit-тесты хаба, fuzz, инварианты, тесты PR5 — 31 passing | Безопасность |
| 21 | `show_05_security_owasp.png` | окно «Security 2»: OWASP SC Top 10 (2025) 10/10, секреты, npm audit | Безопасность |
| 22 | `term_08_ci_local.png` | локальный CI: compile → тесты → OWASP → секреты → build → audit | Задание 3 / DevSecOps |
| 23 | `term_05_hardhat_node.png` | окно Hardhat node: реальные транзакции в локальной сети | Задание 2 |
| 24 | `web_09_metamask_guard_no_extension.png` | кнопка MetaMask в браузере без расширения (guard) | Задание 2.1 |
| 25 | *сделать вручную* | окно MetaMask после нажатия **Connect MetaMask** в Chrome (расширение установлено в профиле Chrome) | Задание 2.1 |
