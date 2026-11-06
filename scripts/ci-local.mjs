// Local CI pipeline (mirror of .github/workflows/ci.yml): compile -> tests (unit/fuzz/invariants/PR5)
// -> OWASP SC Top 10 check -> secrets scan -> npm audit -> web build. Log: reports/ci/ci-local.log
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", B = "\x1b[1m", C = "\x1b[36m", X = "\x1b[0m";
const log = [];
const steps = [];
function step(name, cmd, args, opts = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd: opts.cwd ?? ROOT, encoding: "utf8", shell: cmd === NPM && process.platform === "win32" });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  log.push(`\n===== ${name} (${cmd} ${args.join(" ")}) exit ${r.status} =====\n${out.replace(/\x1b\[[0-9;]*m/g, "")}`);
  const pass = r.status === 0;
  steps.push({ name, pass, ms: Date.now() - t0, warn: opts.warn && !pass });
  console.log(pass ? `${G}✔${X}  ${name} ${C}(${Date.now() - t0} ms)${X}` : opts.warn ? `${Y}⚠  ${name} - see log${X}` : `${R}✘  ${name}${X}`);
  return { pass, out };
}
function auditCounts(cwd, omitDev) {
  const r = spawnSync(NPM, ["audit", "--json", ...(omitDev ? ["--omit=dev"] : [])], { cwd, encoding: "utf8", shell: process.platform === "win32" });
  try { return JSON.parse(r.stdout).metadata.vulnerabilities; } catch { return null; }
}

console.log(`\n${B}${C}CI LOCAL - PR6 pipeline${X}`);
step("compile contracts (Hardhat 3, solc 0.8.28)", process.execPath, ["node_modules/hardhat/dist/src/cli.js", "compile"]);
step("tests: hub unit + fuzz + invariants + PR5 bank", process.execPath, ["scripts/run-tests.mjs"]);
step("OWASP Smart Contract Top 10 (2025) check", process.execPath, ["scripts/owasp-check.mjs"]);
step("secrets scan", process.execPath, ["scripts/check-secrets.mjs"]);
step("web build (vite)", NPM, ["run", "build"], { cwd: resolve(ROOT, "web") });
const audit = {
  rootProd: auditCounts(ROOT, true), webProd: auditCounts(resolve(ROOT, "web"), true),
  rootAll: auditCounts(ROOT, false), webAll: auditCounts(resolve(ROOT, "web"), false),
};
const prodHigh = (audit.rootProd?.high ?? 0) + (audit.rootProd?.critical ?? 0) + (audit.webProd?.high ?? 0) + (audit.webProd?.critical ?? 0);
steps.push({ name: "npm audit (production deps, high+critical)", pass: prodHigh === 0 });
console.log(prodHigh === 0 ? `${G}✔${X}  npm audit --omit=dev: 0 high/critical in production dependencies` : `${R}✘ npm audit: ${prodHigh} high/critical in production deps${X}`);
const devHigh = (audit.rootAll?.high ?? 0) + (audit.webAll?.high ?? 0);
if (devHigh) console.log(`${Y}⚠ dev toolchain: ${devHigh} high advisories (hardhat -> zod, vite dev server) - local-only tooling, recorded as residual risk${X}`);
console.log(`${Y}⚠ Slither: not installed locally - runs in GitHub Actions (crytic/slither-action, continue-on-error)${X}`);

mkdirSync(resolve(ROOT, "reports/ci"), { recursive: true });
writeFileSync(resolve(ROOT, "reports/ci/ci-local.log"), log.join("\n"));
const allPass = steps.every((s) => s.pass || s.warn);
writeFileSync(resolve(ROOT, "reports/ci/summary.json"), JSON.stringify({ ts: new Date().toISOString(), allPass, steps, audit }, null, 2));
console.log(allPass ? `\n${G}${B}CI LOCAL PASSED${X}` : `\n${R}${B}CI LOCAL FAILED${X}`);
process.exit(allPass ? 0 : 1);
