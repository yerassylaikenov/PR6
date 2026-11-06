// npm run demo:reset - stops the demo processes (ports 8545/8787/8788/5173) and clears the
// state of the current run: state/, deployments/, generated order documents, live telemetry.
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const ports = [8545, 8787, 8788, 5173];
if (!process.argv.includes("--keep-processes")) {
  for (const p of ports) {
    try {
      // IPv4 and IPv6 (Vite listens on [::1]:5173)
      const out = execSync(`netstat -ano | findstr LISTENING | findstr /C:":${p} "`, { encoding: "utf8" });
      const pids = new Set(out.split("\n").map((l) => l.trim().split(/\s+/)).filter((c) => c[1]?.endsWith(`:${p}`)).map((c) => c.pop()).filter((x) => x && /^\d+$/.test(x) && x !== "0"));
      for (const pid of pids) { try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); console.log(`\x1b[32m✔\x1b[0m  stopped process ${pid} on port ${p}`); } catch {} }
    } catch { /* nothing on this port */ }
  }
}
for (const d of ["state", "data/orders", "reports/monitoring"]) rmSync(resolve(ROOT, d), { recursive: true, force: true });
rmSync(resolve(ROOT, "deployments/localhost.json"), { force: true });
rmSync(resolve(ROOT, "web/public/deployment.json"), { force: true });
mkdirSync(resolve(ROOT, "data/orders"), { recursive: true });
writeFileSync(resolve(ROOT, "data/orders/.gitkeep"), "");
console.log("\x1b[32m✔\x1b[0m  demo state cleared (state/, deployments/, data/orders/, reports/monitoring/)");
