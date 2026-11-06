// Deploys Module A (bank), Module B (retail) and the OrderSettlementHub, grants roles
// (prompt 4.4) and writes deployments/localhost.json + web/public/deployment.json.
import { resolve } from "node:path";
import type { Address, Hex } from "viem";
import {
  ROOT, DEPLOYMENT_FILE, pub, wallet, account, artifact, ACCOUNTS, ROLE, writeJson, ok, head, info, C,
  type AccountKey, type Deployment,
} from "./lib/common.ts";

async function deploy(name: string, args: unknown[]) {
  const { abi, bytecode } = artifact(name);
  const hash = await wallet("admin").deployContract({ abi, bytecode, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  ok(`${name.padEnd(22)} ${r.contractAddress}  tx ${hash.slice(0, 18)}…  block ${r.blockNumber}`);
  return { address: r.contractAddress as Address, abi, txHash: hash, block: r.blockNumber.toString() };
}

async function grant(c: { address: Address; abi: any }, role: string, who: AccountKey, label: string) {
  const hash = await wallet("admin").writeContract({
    address: c.address, abi: c.abi, functionName: "grantRole", args: [ROLE(role), account(who).address],
  });
  await pub.waitForTransactionReceipt({ hash });
  ok(`${label.padEnd(8)} ${role.padEnd(18)} -> ${who.padEnd(12)} ${account(who).address}`);
}

async function main() {
  head("DEPLOY ALL - Module A (bank) + Module B (retail) + Integration Hub");
  const chainId = await pub.getChainId();
  if (chainId !== 31337) throw new Error(`wrong chainId ${chainId}`);
  ok(`connected to local node, chainId ${chainId}`);
  const admin = account("admin").address;

  const bank = await deploy("PaymentOrderRegistry", [admin]);
  const retail = await deploy("RetailPurchaseOrder", [admin]);
  const hub = await deploy("OrderSettlementHub", [retail.address, bank.address, admin]);

  head("Granting roles (admin has NO operational roles)");
  await grant(bank, "OPERATOR_ROLE", "orchestrator", "bank");
  await grant(bank, "SETTLEMENT_ROLE", "settlement", "bank");
  await grant(hub, "ORCHESTRATOR_ROLE", "orchestrator", "hub");
  await grant(retail, "RETAILER_ROLE", "retailer", "retail");
  await grant(retail, "SUPPLIER_ROLE", "supplier1", "retail");
  await grant(retail, "SUPPLIER_ROLE", "supplier2", "retail");

  const dep: Deployment = {
    chainId,
    deployedAt: new Date().toISOString(),
    contracts: { bank, retail, hub },
    accounts: ACCOUNTS.map((a) => ({ key: a.key, label: a.label, address: account(a.key).address, roles: a.roles })),
  };
  writeJson(DEPLOYMENT_FILE, dep);
  if (!process.env.DEPLOYMENT_FILE) writeJson(resolve(ROOT, "web/public/deployment.json"), dep);
  ok(`deployment saved -> ${DEPLOYMENT_FILE.replace(ROOT, ".")}`);
  info("keys are derived from the public Hardhat test mnemonic at runtime; nothing secret is written");
  console.log(`${C.g}${C.b}DEPLOY COMPLETE${C.x}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
