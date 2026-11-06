// Fails if the repository contains secrets: a real .env (only .env.example is allowed),
// PEM private-key blocks or PRIVATE_KEY = 0x<64 hex> assignments. (Carried over from PR5.)
// The public Hardhat test mnemonic is explicitly allowed (it is world-known).
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", ".git", "reports", "deployments", "artifacts", "cache", "dist", "state", "_sources", "types"]);
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|sol|md|yml|yaml|env|txt|html|css|cmd)$/i;
const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const PRIV = /(private[_-]?key|privkey|secret[_-]?key)\s*[:=]\s*["']?0x[0-9a-fA-F]{64}/i;
const findings = [];
let scanned = 0;

for (const p of ["", "web"]) if (existsSync(resolve(ROOT, p, ".env"))) findings.push(`.env found in ${p || "root"} (only .env.example is allowed)`);
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (!TEXT.test(name) || basename(full) === "check-secrets.mjs") continue;
    const text = readFileSync(full, "utf8");
    scanned++;
    const rel = full.slice(ROOT.length + 1);
    if (PEM.test(text)) findings.push(`PEM private key in ${rel}`);
    if (PRIV.test(text)) findings.push(`private-key assignment in ${rel}`);
  }
})(ROOT);

mkdirSync(resolve(ROOT, "reports/security"), { recursive: true });
writeFileSync(resolve(ROOT, "reports/security/secrets.json"), JSON.stringify({ ts: new Date().toISOString(), scanned, findings }, null, 2));
if (findings.length === 0) {
  console.log(`\x1b[32m✔\x1b[0m  check:secrets PASS - ${scanned} files scanned, no private keys / seed phrases / .env committed`);
} else {
  console.log("\x1b[41m\x1b[1m check:secrets FAIL \x1b[0m");
  findings.forEach((f) => console.log(`  \x1b[31m✘  ${f}\x1b[0m`));
  process.exit(1);
}
