// Alert sink with de-duplication (cooldown 5 min per key). Carried over from PR5 (Aikenov)
// and extended: key = `${rule}:${key}` where key = actor (R-1), "global" (R-2) or orderId (R-3).
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const COOLDOWN_MS = 5 * 60 * 1000;

export interface Alert {
  rule: "R-1" | "R-2" | "R-3";
  severity: "High" | "Medium";
  key: string;
  correlationId?: string;
  ts: string;
  message: string;
  evidence?: unknown;
}

export class AlertSink {
  private cooldowns = new Map<string, number>();
  public readonly recent: Alert[] = [];
  constructor(private readonly path: string) { mkdirSync(dirname(path), { recursive: true }); }

  fire(a: Alert): boolean {
    const k = `${a.rule}:${a.key}`;
    const now = Date.now();
    if ((this.cooldowns.get(k) ?? 0) > now) return false; // suppressed (anti-duplicate)
    this.cooldowns.set(k, now + COOLDOWN_MS);
    this.recent.unshift(a);
    if (this.recent.length > 50) this.recent.pop();
    const head = a.severity === "High" ? `\x1b[41m\x1b[1m ALERT ${a.rule} [HIGH] \x1b[0m` : `\x1b[43m\x1b[30m\x1b[1m ALERT ${a.rule} [MEDIUM] \x1b[0m`;
    console.log(`${head} \x1b[31m${a.message}\x1b[0m`);
    appendFileSync(this.path, JSON.stringify(a) + "\n");
    return true;
  }
}
