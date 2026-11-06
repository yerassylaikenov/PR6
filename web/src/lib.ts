// Chain access, wallets (local test accounts / MetaMask), ids, error decoding, telemetry.
import {
  createPublicClient, createWalletClient, http, custom, defineChain, keccak256, toHex, encodeAbiParameters,
  BaseError, ContractFunctionRevertedError, UserRejectedRequestError, type Abi, type Hex, type Address, type WalletClient,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 31337);
export const RPC_URL = import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545";
export const DEMO_MODE = (import.meta.env.VITE_DEMO_MODE ?? "true") === "true";
export const MONITOR = "http://127.0.0.1:8787";
export const ORCH_API = "http://127.0.0.1:8788";

export const chain = defineChain({
  id: CHAIN_ID, name: "Hardhat Local (PR6)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
export const pub = createPublicClient({ chain, transport: http(RPC_URL), pollingInterval: 300 });

export interface Deployment {
  chainId: number;
  contracts: Record<"bank" | "retail" | "hub", { address: Address; abi: Abi }>;
  accounts: { key: string; label: string; address: Address; roles: string }[];
}
export async function loadDeployment(): Promise<Deployment> {
  const r = await fetch("/deployment.json", { cache: "no-store" });
  if (!r.ok) throw new Error("deployment.json not found - run npm run deploy:all");
  return r.json();
}

// PUBLIC Hardhat test mnemonic - demo mode only, chainId 31337 only. Never use on a real network.
const TEST_MNEMONIC = "test test test test test test test test test test test junk";
export function localWallet(index: number): WalletClient {
  if (!DEMO_MODE || CHAIN_ID !== 31337) throw new Error("local test accounts are allowed only in demo mode on chainId 31337");
  return createWalletClient({ account: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: index }), chain, transport: http(RPC_URL) });
}

// ---- MetaMask (EIP-1193) ----
type Eip1193 = { request(a: { method: string; params?: unknown }): Promise<any>; on?(e: string, h: (...a: any[]) => void): void };
export const getProvider = () => (window as any).ethereum as Eip1193 | undefined;
export async function connectMetaMask(): Promise<Address> {
  const p = getProvider();
  if (!p) throw new Error("MetaMask not found - install the MetaMask extension in this browser");
  const [acc] = (await p.request({ method: "eth_requestAccounts" })) as Address[]; // opens the MetaMask popup
  return acc;
}
export async function metaMaskChainId(): Promise<number> {
  const p = getProvider();
  return p ? parseInt(await p.request({ method: "eth_chainId" }), 16) : 0;
}
export async function switchToLocal() {
  const p = getProvider();
  if (!p) return;
  const chainId = "0x" + CHAIN_ID.toString(16);
  try { await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] }); }
  catch (e: any) {
    if (e?.code === 4902) await p.request({ method: "wallet_addEthereumChain", params: [{ chainId, chainName: "Hardhat Local (PR6)", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [RPC_URL] }] });
    else throw e;
  }
}
export function metaMaskWallet(account: Address): WalletClient {
  return createWalletClient({ account, chain, transport: custom(getProvider()!) });
}

// ---- identifiers (DATA_CONTRACT) ----
export const orderIdOf = (orderNo: string) => keccak256(toHex(orderNo));
export const paymentIdOf = (orderId: Hex, attempt: number) =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint32" }], [orderId, attempt]));
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const PO_STATUS = ["None", "Created", "Approved", "Cancelled"];
export const PAY_STATUS = ["None", "Registered", "Executed", "Rejected", "Cancelled"];
export const HUB_STATUS = ["None", "AwaitingPayment", "Paid", "PaymentFailed"];
export const kzt = (tiyn: bigint | number) => (Number(tiyn) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 }) + " KZT";
export const short = (h?: string) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "-");

export function decodeError(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return "UserRejectedRequest (cancelled in MetaMask)";
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? "Reverted";
    return e.shortMessage;
  }
  return String((e as Error)?.message ?? e);
}

export async function telemetry(rec: Record<string, unknown>) {
  try {
    await fetch(`${MONITOR}/log`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ts: new Date().toISOString(), module: "web", category: "app", ...rec }) });
  } catch { /* monitor offline */ }
}
