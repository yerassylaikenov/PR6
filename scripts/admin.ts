// npx tsx scripts/admin.ts pause|unpause  - admin (DEFAULT_ADMIN_ROLE) pauses/unpauses Module A (bank)
// for the live failure/recovery demonstration.
import { loadDeployment, ok, head, C } from "./lib/common.ts";
import { send } from "./lib/flow.ts";

const action = process.argv[2];
if (action !== "pause" && action !== "unpause") { console.log("usage: npx tsx scripts/admin.ts pause|unpause"); process.exit(1); }
const dep = loadDeployment();
head(`ADMIN - ${action} Module A (bank)`);
const r = await send(dep, "admin", "bank", action, []);
ok(`bank.${action}() tx ${r.hash} block ${r.block}`);
console.log(action === "pause"
  ? `${C.y}Bank is paused: the orchestrator will retry (1/2/4/8 s), the monitor raises R-2, orders wait.${C.x}`
  : `${C.g}Bank is running: reconciliation (<= 15 s) completes the waiting orders automatically.${C.x}`);
