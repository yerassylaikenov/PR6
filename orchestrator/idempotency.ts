// CP-3 idempotency cache: processed event keys (txHash:logIndex) and operationIds.
// This file is ONLY a cache - deleting state/ is safe, the blockchain is the source of truth.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { STATE_DIR, writeJson, appendLine } from "../scripts/lib/common.ts";

const FILE = resolve(STATE_DIR, "outbox.json");
const JOURNAL = resolve(STATE_DIR, "journal.jsonl");

interface Outbox { processedEvents: string[]; operations: Record<string, unknown> }

export class Idempotency {
  private data: Outbox = { processedEvents: [], operations: {} };
  constructor() {
    if (existsSync(FILE)) {
      try { this.data = JSON.parse(readFileSync(FILE, "utf8")); } catch { /* corrupted cache - rebuild from chain */ }
    }
  }
  seenEvent(key: string) { return this.data.processedEvents.includes(key); }
  markEvent(key: string) {
    if (!this.seenEvent(key)) { this.data.processedEvents.push(key); this.save(); }
  }
  recordOperation(operationId: string, msg: Record<string, unknown>) {
    this.data.operations[operationId] = msg;
    this.save();
    appendLine(JOURNAL, JSON.stringify(msg, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  }
  private save() { writeJson(FILE, this.data); }
}
