// npm run report:data - collects REPORT_DATA.md from the real run artefacts in reports/.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const j = (p) => (existsSync(resolve(ROOT, p)) ? JSON.parse(readFileSync(resolve(ROOT, p), "utf8")) : null);
const pkg = j("package.json"), e2e = j("reports/e2e/demo-e2e.json"), at = j("reports/acceptance/summary.json");
const load = j("reports/load/e2e-metrics.json"), tests = j("reports/tests/summary.json"), owasp = j("reports/security/owasp.json"), ci = j("reports/ci/summary.json");
const v = (cmd) => { try { return execSync(cmd, { encoding: "utf8" }).trim(); } catch { return "n/a"; } };
const L = [];
L.push("# REPORT_DATA — данные для отчёта (собраны автоматически из reports/)", "", `Сформировано: ${new Date().toISOString()}`, "");
L.push("## Версии", "", "| Компонент | Версия |", "|---|---|",
  `| Node.js | ${process.version} |`, `| Hardhat | ${pkg.devDependencies.hardhat} |`, `| viem | ${pkg.devDependencies.viem} |`,
  `| OpenZeppelin | ${pkg.devDependencies["@openzeppelin/contracts"]} |`, "| solc | 0.8.28 (optimizer 200) |", `| OS | ${v("ver")} |`, "");
if (e2e) {
  L.push("## Адреса контрактов и роли (локальная сеть 31337, сквозной сценарий)", "", "| Контракт | Адрес | Блок |", "|---|---|---|");
  for (const [k, c] of Object.entries(e2e.deployment.contracts)) L.push(`| ${k} | \`${c.address}\` | ${c.block} |`);
  L.push("", "| # | Аккаунт | Адрес | Роли |", "|---|---|---|---|");
  e2e.deployment.accounts.forEach((a, i) => L.push(`| ${i} | ${a.label} | \`${a.address}\` | ${a.roles} |`));
  L.push("", `## Сквозной сценарий ${e2e.orderNo} (\`npm run demo:e2e\`, ${e2e.ts})`, "", "| Шаг | Модуль | Блок | txHash | Детали |", "|---|---|---|---|---|");
  for (const s of e2e.summary.steps) L.push(`| ${s.step} | ${s.module} | ${s.block} | \`${s.txHash}\` | ${s.detail ?? ""} |`);
  L.push("", `Итог: PO **${e2e.summary.po.status}**, платёж **${e2e.summary.payment.status}**, хаб **${e2e.summary.hub.status}**; сумма ${e2e.summary.po.total} тиын; авто-регистрация платежа через ${e2e.registrationLatencyMs} мс; сквозная задержка ${e2e.endToEndMs} мс.`, "");
}
if (at) {
  L.push(`## Приёмочные проверки (${at.ts})`, "", "| ID | Проверка | Результат |", "|---|---|---|");
  for (const r of at.results) L.push(`| ${r.id} | ${r.title} | **${r.result}** |`);
  L.push("", `Итого ${at.passed}/${at.total} PASS; расхождений после сверки: ${at.discrepancies} (${at.orders} заказов).`, "", "### Алерты монитора", "");
  for (const a of at.alerts) L.push(`- **${a.rule}** [${a.severity}] ${a.message}`);
  L.push("");
}
if (load) {
  L.push(`## 30 повторов (${load.ts})`, "", "| Метрика | Значение |", "|---|---|",
    `| Доля успешных | ${load.successCount}/${load.runs} (${(load.successRate * 100).toFixed(1)}%) |`, `| Расхождения | ${load.discrepancies} |`,
    `| p50 / p95 | ${load.latencyMs.p50} / ${load.latencyMs.p95} мс |`, `| min / max / mean | ${load.latencyMs.min} / ${load.latencyMs.max} / ${load.latencyMs.mean} мс |`,
    `| Этапы (среднее) | Б ${load.stagesMeanMs.moduleB} · передача ${load.stagesMeanMs.transfer} · А ${load.stagesMeanMs.moduleA} · финализация ${load.stagesMeanMs.finalize} мс |`,
    `| gasUsed | ${Object.entries(load.gasMean).map(([k, g]) => `${k} ${g}`).join(" · ")} |`, "");
}
if (tests) L.push("## Тесты и безопасность", "", `- node:test: **${tests.passing} passing, ${tests.failing} failing** (${tests.ts})`, `- ${tests.fuzz}`, `- ${tests.invariants}`);
if (owasp) L.push(`- OWASP SC Top 10 (2025): **${owasp.passed}/${owasp.total} PASS**`);
if (ci) L.push(`- CI local: ${ci.allPass ? "PASSED" : "FAILED"}; npm audit (prod) high+critical = ${(ci.audit.rootProd?.high ?? 0) + (ci.audit.webProd?.high ?? 0)}; dev toolchain high = ${(ci.audit.rootAll?.high ?? 0) + (ci.audit.webAll?.high ?? 0)}`);
L.push("");
writeFileSync(resolve(ROOT, "REPORT_DATA.md"), L.join("\n"));
console.log("\x1b[32m✔\x1b[0m  REPORT_DATA.md generated");
