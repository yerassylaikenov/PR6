// Seed: catalog is static (data/catalog.json); creates 2 already completed orders for history
// (one Paid, one PaymentFailed). The orchestrator core is used in-process, so data still
// moves between modules automatically - no manual transfer of amount/hash.
import { loadDeployment, pub, ok, head, info, C, HUB_STATUS } from "./lib/common.ts";
import { createOrder, approveOrder, send } from "./lib/flow.ts";
import { createOrchestrator } from "../orchestrator/core.ts";
import { toHex } from "viem";

const dep = loadDeployment();
head("SEED - catalog + 2 completed historical orders");
const orch = createOrchestrator(dep, { quiet: true });

async function run(supplier: "supplier1" | "supplier2", lines: { sku: string; qty: number }[], execute: boolean) {
  const o = await createOrder(dep, supplier, lines);
  await approveOrder(dep, o.orderId, supplier);
  await orch.processOrder(o.orderId, "seed");
  const link: any = await pub.readContract({ ...dep.contracts.hub, functionName: "getOrder", args: [o.orderId] });
  await send(dep, "settlement", "bank", execute ? "markExecuted" : "markRejected", execute ? [link.paymentId] : [link.paymentId, toHex("AC04", { size: 32 })]);
  await orch.processOrder(o.orderId, "seed");
  const fin: any = await pub.readContract({ ...dep.contracts.hub, functionName: "getOrder", args: [o.orderId] });
  ok(`${o.orderNo}  total ${(o.total / 100).toLocaleString("en-US")} KZT  -> hub ${HUB_STATUS[fin.status]}`);
}

await run("supplier1", [{ sku: "AGR-001", qty: 10 }, { sku: "AGR-003", qty: 4 }], true);
await run("supplier2", [{ sku: "FRS-001", qty: 20 }, { sku: "FRS-004", qty: 15 }], false);
info("catalog: 10 items of 2 suppliers (data/catalog.json)");
console.log(`${C.g}${C.b}SEED COMPLETE${C.x}`);
process.exit(0);
