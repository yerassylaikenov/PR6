// Business-flow helpers shared by seed / demo-e2e / acceptance / load test.
// Every step is a REAL transaction on the local chain.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { keccak256, toHex, type Hex } from "viem";
import {
  ROOT, pub, wallet, account, canonicalJson, orderIdOf, paymentIdOf, writeJson, sleep,
  type AccountKey, type Deployment,
} from "./common.ts";

export const ORDERS_DIR = resolve(ROOT, process.env.ORDERS_DIR ?? "data/orders");
export const catalog = JSON.parse(readFileSync(resolve(ROOT, "data/catalog.json"), "utf8"));

export interface PoDoc {
  orderNo: string; orderId: Hex; retailer: string; supplier: string; currency: "KZT";
  items: { sku: string; name: string; qty: number; unitPurchasePrice: number }[];
  totalPurchaseCost: number; createdAt: string;
}

export function buildPo(orderNo: string, supplierKey: AccountKey, lines: { sku: string; qty: number }[]) {
  const items = lines.map((l) => {
    const it = catalog.items.find((x: any) => x.sku === l.sku);
    if (!it || it.supplier !== supplierKey) throw new Error(`SKU ${l.sku} is not offered by ${supplierKey}`);
    return { sku: it.sku, name: it.name, qty: l.qty, unitPurchasePrice: it.unitPurchasePrice };
  });
  const doc: PoDoc = {
    orderNo, orderId: orderIdOf(orderNo),
    retailer: account("retailer").address, supplier: account(supplierKey).address,
    currency: "KZT", items,
    totalPurchaseCost: items.reduce((s, i) => s + i.qty * i.unitPurchasePrice, 0),
    createdAt: new Date().toISOString(),
  };
  const json = canonicalJson(doc);
  return { doc, json, poHash: keccak256(toHex(json)) };
}

export async function nextOrderNo(dep: Deployment) {
  const n = (await pub.readContract({ ...dep.contracts.retail, functionName: "orderCount" })) as bigint;
  return `PO-2026-${String(Number(n) + 1).padStart(6, "0")}`;
}

export function orderNoMap(): Map<string, string> {
  const m = new Map<string, string>();
  if (!existsSync(ORDERS_DIR)) return m;
  for (const f of readdirSync(ORDERS_DIR)) {
    if (f.endsWith(".json")) m.set(orderIdOf(f.replace(/\.json$/, "")).toLowerCase(), f.replace(/\.json$/, ""));
  }
  return m;
}

export async function send(dep: Deployment, who: AccountKey, c: "bank" | "retail" | "hub", fn: string, args: unknown[]) {
  const w = wallet(who);
  const { request } = await pub.simulateContract({
    ...dep.contracts[c], functionName: fn, args, account: w.account,
  } as any);
  const hash = await w.writeContract(request as any);
  const r = await pub.waitForTransactionReceipt({ hash });
  return { hash, block: r.blockNumber, gasUsed: r.gasUsed, status: r.status };
}

export async function createOrder(dep: Deployment, supplierKey: AccountKey, lines: { sku: string; qty: number }[], orderNo?: string) {
  const no = orderNo ?? (await nextOrderNo(dep));
  const { doc, json, poHash } = buildPo(no, supplierKey, lines);
  writeJson(resolve(ORDERS_DIR, `${no}.json`), JSON.parse(json));
  const tx = await send(dep, "retailer", "retail", "createPO",
    [doc.orderId, doc.supplier, poHash, BigInt(doc.totalPurchaseCost), doc.items.length]);
  return { orderNo: no, orderId: doc.orderId, poHash, total: doc.totalPurchaseCost, tx };
}

export const approveOrder = (dep: Deployment, orderId: Hex, supplierKey: AccountKey) =>
  send(dep, supplierKey, "retail", "approvePO", [orderId]);

export async function readAll(dep: Deployment, orderId: Hex) {
  const po: any = await pub.readContract({ ...dep.contracts.retail, functionName: "getPO", args: [orderId] });
  const link: any = await pub.readContract({ ...dep.contracts.hub, functionName: "getOrder", args: [orderId] });
  const pid = link.status !== 0 ? link.paymentId : paymentIdOf(orderId, 1);
  const pay: any = await pub.readContract({ ...dep.contracts.bank, functionName: "getPayment", args: [pid] });
  return { po, link, pay, paymentId: pid as Hex };
}

/** Wait until predicate holds for the on-chain state (polls every 100 ms). */
export async function waitFor<T>(fn: () => Promise<T | undefined | false>, timeoutMs: number): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await fn().catch(() => undefined);
    if (v) return v as T;
    await sleep(100);
  }
  throw new Error(`timeout after ${timeoutMs} ms`);
}

export async function waitPaymentRegistered(dep: Deployment, orderId: Hex, attempt = 1, timeoutMs = 15000) {
  const pid = paymentIdOf(orderId, attempt);
  return waitFor(async () => {
    const p: any = await pub.readContract({ ...dep.contracts.bank, functionName: "getPayment", args: [pid] });
    return p.status !== 0 ? { pid, p } : undefined;
  }, timeoutMs);
}

export async function waitLinked(dep: Deployment, orderId: Hex, timeoutMs = 15000) {
  return waitFor(async () => {
    const l: any = await pub.readContract({ ...dep.contracts.hub, functionName: "getOrder", args: [orderId] });
    return l.status >= 1 ? l : undefined;
  }, timeoutMs);
}

export async function waitHubFinal(dep: Deployment, orderId: Hex, timeoutMs = 15000) {
  return waitFor(async () => {
    const l: any = await pub.readContract({ ...dep.contracts.hub, functionName: "getOrder", args: [orderId] });
    return l.status >= 2 ? l : undefined;
  }, timeoutMs);
}
