// Isolated test stand (own Hardhat node + monitor + orchestrator on separate ports) used by
// the acceptance tests and the 30-run load experiment, so the live demo is never disturbed.
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createConnection } from "node:net";

const ROOT = resolve(import.meta.dirname, "..", "..");
const TSX = resolve(ROOT, "node_modules/tsx/dist/cli.mjs");
const HARDHAT = resolve(ROOT, "node_modules/hardhat/dist/src/cli.js");

export interface StandConfig { name: string; rpcPort: number; monitorPort: number; apiPort: number; r3DelayMs?: number }

export function standEnv(cfg: StandConfig): Record<string, string> {
  return {
    RPC_URL: `http://127.0.0.1:${cfg.rpcPort}`,
    MONITOR_PORT: String(cfg.monitorPort),
    API_PORT: String(cfg.apiPort),
    DEPLOYMENT_FILE: `state/${cfg.name}/deployment.json`,
    STATE_DIR: `state/${cfg.name}/orchestrator`,
    ORDERS_DIR: `state/${cfg.name}/orders`,
    MONITOR_DIR: `reports/${cfg.name}/monitoring`,
    R3_DELAY_MS: String(cfg.r3DelayMs ?? 30000),
  };
}

const children: ChildProcess[] = [];
export function killTree(p?: ChildProcess) {
  if (!p?.pid || p.exitCode !== null) return;
  try {
    if (process.platform === "win32") execSync(`taskkill /PID ${p.pid} /T /F`, { stdio: "ignore" });
    else process.kill(-p.pid, "SIGKILL"); // whole process group (spawned detached)
  } catch { /* already gone */ }
}
const DETACHED = process.platform !== "win32";
process.on("exit", () => children.forEach(killTree));

function waitPort(port: number, timeoutMs: number) {
  const t0 = Date.now();
  return new Promise<void>((res, rej) => {
    const tryOnce = () => {
      const s = createConnection({ port, host: "127.0.0.1" });
      s.once("connect", () => { s.end(); res(); });
      s.once("error", () => { s.destroy(); Date.now() - t0 > timeoutMs ? rej(new Error(`port ${port} not open`)) : setTimeout(tryOnce, 300); });
    };
    tryOnce();
  });
}

export function startProc(cfg: StandConfig, label: string, script: string, extraEnv: Record<string, string> = {}, onLine?: (l: string) => void) {
  const logDir = resolve(ROOT, `reports/${cfg.name}/logs`);
  mkdirSync(logDir, { recursive: true });
  const out = createWriteStream(resolve(logDir, `${label}.log`), { flags: "a" });
  const p = spawn(process.execPath, [TSX, script], { cwd: ROOT, detached: DETACHED, env: { ...process.env, ...standEnv(cfg), ...extraEnv, FORCE_COLOR: "0" } });
  const handle = (d: Buffer) => {
    const text = d.toString();
    out.write(text.replace(/\x1b\[[0-9;]*m/g, ""));
    if (onLine) text.split("\n").filter((l) => l.trim()).forEach(onLine);
  };
  p.stdout?.on("data", handle);
  p.stderr?.on("data", handle);
  children.push(p);
  return p;
}

export async function startStand(cfg: StandConfig) {
  rmSync(resolve(ROOT, `state/${cfg.name}`), { recursive: true, force: true });
  rmSync(resolve(ROOT, `reports/${cfg.name}/monitoring`), { recursive: true, force: true });
  rmSync(resolve(ROOT, `reports/${cfg.name}/logs`), { recursive: true, force: true });
  const node = spawn(process.execPath, [HARDHAT, "node", "--port", String(cfg.rpcPort)], { cwd: ROOT, stdio: "ignore", detached: DETACHED });
  children.push(node);
  await waitPort(cfg.rpcPort, 60000);
  execSync(`"${process.execPath}" "${TSX}" scripts/deploy-all.ts`, { cwd: ROOT, env: { ...process.env, ...standEnv(cfg) }, stdio: "ignore" });
  const monitor = startProc(cfg, "monitor", "monitor/collector.ts");
  await waitPort(cfg.monitorPort, 30000);
  return { node, monitor };
}

export async function startOrchestrator(cfg: StandConfig, extraEnv: Record<string, string> = {}, onLine?: (l: string) => void) {
  const p = startProc(cfg, "orchestrator", "orchestrator/index.ts", extraEnv, onLine);
  await waitPort(cfg.apiPort, 30000);
  return p;
}

export function stopAll() { children.forEach(killTree); }
