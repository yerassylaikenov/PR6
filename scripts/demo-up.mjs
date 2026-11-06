// npm run demo:up - one command: reset -> Hardhat node -> wait port -> deploy:all -> seed ->
// orchestrator + monitor + web, all in this terminal with colored prefixes (Ctrl+C stops all).
import { spawn, execSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const TSX = resolve(ROOT, "node_modules/tsx/dist/cli.mjs");
const HH = resolve(ROOT, "node_modules/hardhat/dist/src/cli.js");
const node = process.execPath;
const kids = [];
function run(name, color, cmd, args, opts = {}) {
  const p = spawn(cmd, args, { cwd: opts.cwd ?? ROOT, shell: opts.shell ?? false, env: { ...process.env, FORCE_COLOR: "1" } });
  const pre = `\x1b[${color}m[${name}]\x1b[0m `;
  const out = (d) => d.toString().split("\n").filter((l) => l.trim()).forEach((l) => console.log(pre + l));
  p.stdout.on("data", out); p.stderr.on("data", out);
  kids.push(p);
  return p;
}
const stop = () => { kids.forEach((k) => { try { execSync(`taskkill /PID ${k.pid} /T /F`, { stdio: "ignore" }); } catch {} }); process.exit(0); };
process.on("SIGINT", stop);

execSync(`"${node}" scripts/reset.mjs`, { cwd: ROOT, stdio: "inherit" });
run("node", "90", node, [HH, "node"]);
execSync(`"${node}" scripts/wait-port.mjs 8545`, { cwd: ROOT, stdio: "inherit" });
execSync(`"${node}" "${TSX}" scripts/deploy-all.ts`, { cwd: ROOT, stdio: "inherit" });
execSync(`"${node}" "${TSX}" scripts/seed.ts`, { cwd: ROOT, stdio: "inherit" });
run("monitor", "35", node, [TSX, "monitor/collector.ts"]);
run("orchestrator", "33", node, [TSX, "orchestrator/index.ts"]);
run("web", "36", "npm", ["run", "dev"], { cwd: resolve(ROOT, "web"), shell: true });
console.log("\n\x1b[32m\x1b[1mDEMO IS UP: open http://localhost:5173  (Ctrl+C to stop everything)\x1b[0m\n");
