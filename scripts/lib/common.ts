// Shared helpers for deploy / seed / orchestrator / monitor / acceptance / load scripts.
// SECURITY: no private keys are stored anywhere. All accounts are derived at runtime
// from the PUBLIC Hardhat test mnemonic (world-known, local network only).
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createPublicClient, createWalletClient, http, defineChain, keccak256, toHex, encodeAbiParameters,
  BaseError, ContractFunctionRevertedError, type Abi, type Hex, type Address,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";

export const ROOT = resolve(import.meta.dirname, "..", "..");
export const TEST_MNEMONIC = "test test test test test test test test test test test junk";
export const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
export const MONITOR_URL = `http://127.0.0.1:${process.env.MONITOR_PORT ?? 8787}`;
export const API_URL = `http://127.0.0.1:${process.env.API_PORT ?? 8788}`;
export const DEPLOYMENT_FILE = resolve(ROOT, process.env.DEPLOYMENT_FILE ?? "deployments/localhost.json");
export const STATE_DIR = resolve(ROOT, process.env.STATE_DIR ?? "state");

export const chain = defineChain({
  id: 31337, name: "Hardhat Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

// Role layout (prompt section 4.4)
export const ACCOUNTS = [
  { index: 0, key: "admin", label: "Administrator", roles: "DEFAULT_ADMIN_ROLE (all 3 contracts)" },
  { index: 1, key: "orchestrator", label: "Buyer's bank (orchestrator)", roles: "OPERATOR_ROLE (A), ORCHESTRATOR_ROLE (Hub)" },
  { index: 2, key: "settlement", label: "Clearing center", roles: "SETTLEMENT_ROLE (A)" },
  { index: 3, key: "retailer", label: "Retailer 'Magazin Astana'", roles: "RETAILER_ROLE (B)" },
  { index: 4, key: "supplier1", label: "Supplier 'Agro-Opt LLP'", roles: "SUPPLIER_ROLE (B)" },
  { index: 5, key: "supplier2", label: "Supplier 'Fresh Products LLP'", roles: "SUPPLIER_ROLE (B)" },
  { index: 6, key: "attacker", label: "Attacker", roles: "none" },
] as const;
export type AccountKey = (typeof ACCOUNTS)[number]["key"];

export function account(key: AccountKey) {
  const a = ACCOUNTS.find((x) => x.key === key)!;
  return mnemonicToAccount(TEST_MNEMONIC, { addressIndex: a.index });
}

export const pub = createPublicClient({ chain, transport: http(RPC_URL), pollingInterval: 250 });
export function wallet(key: AccountKey) {
  return createWalletClient({ account: account(key), chain, transport: http(RPC_URL) });
}

export function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const map: Record<string, string> = {
    PaymentOrderRegistry: "bank/PaymentOrderRegistry.sol",
    RetailPurchaseOrder: "retail/RetailPurchaseOrder.sol",
    OrderSettlementHub: "integration/OrderSettlementHub.sol",
  };
  const j = JSON.parse(readFileSync(resolve(ROOT, "artifacts/contracts", map[name], `${name}.json`), "utf8"));
  return { abi: j.abi, bytecode: j.bytecode };
}

export interface Deployment {
  chainId: number;
  deployedAt: string;
  contracts: Record<"bank" | "retail" | "hub", { address: Address; abi: Abi; txHash: Hex; block: string }>;
  accounts: { key: string; label: string; address: Address; roles: string }[];
}

export function loadDeployment(): Deployment {
  if (!existsSync(DEPLOYMENT_FILE)) throw new Error(`${DEPLOYMENT_FILE} not found - run npm run deploy:all`);
  return JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf8"));
}

// Identifiers (DATA_CONTRACT.md)
export const orderIdOf = (orderNo: string) => keccak256(toHex(orderNo));
export const paymentIdOf = (orderId: Hex, attempt: number) =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint32" }], [orderId, attempt]));
export const operationIdOf = (orderId: Hex, step: string, attempt: number) =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "string" }, { type: "uint32" }], [orderId, step, attempt]));
export const ROLE = (name: string) => keccak256(toHex(name));

export const PO_STATUS = ["None", "Created", "Approved", "Cancelled"] as const;
export const PAY_STATUS = ["None", "Registered", "Executed", "Rejected", "Cancelled"] as const;
export const HUB_STATUS = ["None", "AwaitingPayment", "Paid", "PaymentFailed"] as const;

// Canonical JSON: sorted keys, no whitespace
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as any)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export function decodeError(err: unknown): string {
  if (err instanceof BaseError) {
    const r = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? "Reverted";
    const msg = err.shortMessage ?? err.message;
    if (/fetch failed|ECONNREFUSED|timed out/i.test(msg)) return "RpcUnavailable";
    return msg.split("\n")[0];
  }
  return String((err as Error)?.message ?? err);
}

export function writeJson(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

export function appendLine(path: string, line: string) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, line + "\n");
}

export async function telemetry(rec: Record<string, unknown>) {
  try {
    await fetch(`${MONITOR_URL}/log`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ts: new Date().toISOString(), ...rec }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
      signal: AbortSignal.timeout(1000),
    });
  } catch { /* monitor offline: telemetry is best-effort */ }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Terminal output helpers (English, green check marks)
export const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m", b: "\x1b[1m", d: "\x1b[2m", x: "\x1b[0m" };
export const ok = (s: string) => console.log(`${C.g}✔${C.x}  ${s}`);
export const fail = (s: string) => console.log(`${C.r}✘  ${s}${C.x}`);
export const info = (s: string) => console.log(`${C.d}  ${s}${C.x}`);
export const head = (s: string) => console.log(`\n${C.b}${C.c}${s}${C.x}`);
