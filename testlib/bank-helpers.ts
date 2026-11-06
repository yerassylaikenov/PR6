// Shared fixtures for the Node.js (node:test + viem) suites on the in-process
// Hardhat network. Each call deploys a fresh registry and grants the roles.
import { network } from "hardhat";
import { keccak256, toHex } from "viem";

export const OPERATOR_ROLE = keccak256(toHex("OPERATOR_ROLE"));
export const SETTLEMENT_ROLE = keccak256(toHex("SETTLEMENT_ROLE"));
export const DEFAULT_ADMIN_ROLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export function pid(label: string) {
  return keccak256(toHex(label));
}
export function dhash(label: string) {
  return keccak256(toHex("doc:" + label));
}
export function reason(code: string) {
  return toHex(code, { size: 32 });
}

export async function deployRegistry() {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [admin, operator, settlement, outsider] = await viem.getWalletClients();

  const registry = await viem.deployContract("PaymentOrderRegistry", [
    admin.account.address,
  ]);

  const h1 = await registry.write.grantRole([
    OPERATOR_ROLE,
    operator.account.address,
  ]);
  const h2 = await registry.write.grantRole([
    SETTLEMENT_ROLE,
    settlement.account.address,
  ]);
  await publicClient.waitForTransactionReceipt({ hash: h1 });
  await publicClient.waitForTransactionReceipt({ hash: h2 });

  return { viem, publicClient, admin, operator, settlement, outsider, registry };
}

// Status enum mirror (contract order).
export const Status = {
  None: 0,
  Registered: 1,
  Executed: 2,
  Rejected: 3,
  Cancelled: 4,
} as const;
