// Runs the whole node:test suite (hub unit, fuzz, invariants, PR5 bank tests) and saves
// reports/tests/test-output.txt + summary.json (parsed from the real runner output).
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const HARDHAT = resolve(ROOT, "node_modules/hardhat/dist/src/cli.js");
const t0 = Date.now();
const r = spawnSync(process.execPath, [HARDHAT, "test", "nodejs"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
const out = (r.stdout + "\n" + r.stderr).replace(/\x1b\[[0-9;]*m/g, "").split("\n").filter((l) => !/hre\.network\.connect\(\) is deprecated/.test(l)).join("\n");
const dir = resolve(ROOT, "reports/tests");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "test-output.txt"), out);

// group test names by suite (spec reporter output)
const suites = {};
let current = null;
for (const line of out.split("\n")) {
  const m = line.match(/^ {2}(\S.*)$/);
  if (m && !/passing|failing|✔|✖/.test(line)) current = m[1].trim();
  const t = line.match(/^\s+(✔|✖)\s+(.*?)(\s\(\d+ms\))?$/);
  if (t && current && !t[2].includes(":\\")) (suites[current] ??= []).push({ name: t[2], pass: t[1] === "✔" });
}
const passing = Number(out.match(/(\d+) passing/)?.[1] ?? 0);
const failing = Number(out.match(/(\d+) failing/)?.[1] ?? 0);
const fuzzLine = out.match(/fuzz: .*/)?.[0];
const invLine = out.match(/invariants: .*/)?.[0];
const summary = { ts: new Date().toISOString(), durationMs: Date.now() - t0, exitCode: r.status, passing, failing, fuzz: fuzzLine, invariants: invLine, suites };
writeFileSync(resolve(dir, "summary.json"), JSON.stringify(summary, null, 2));

const G = "\x1b[32m", R = "\x1b[31m", B = "\x1b[1m", C = "\x1b[36m", D = "\x1b[2m", X = "\x1b[0m";
for (const [s, tests] of Object.entries(suites)) {
  console.log(`\n${B}${C}${s}${X}`);
  for (const t of tests) console.log(t.pass ? `  ${G}✔${X}  ${t.name}` : `  ${R}✘  ${t.name}${X}`);
}
if (fuzzLine) console.log(`\n${D}  ${fuzzLine}${X}`);
if (invLine) console.log(`${D}  ${invLine}${X}`);
console.log(failing === 0 && r.status === 0 ? `\n${G}${B}ALL TESTS PASSED: ${passing} passing, 0 failing${X}` : `\n${R}${B}${failing} FAILING${X}`);
process.exit(r.status ?? 1);
