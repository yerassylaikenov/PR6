// npm run load:e2e - 30 sequential repetitions of the full business scenario through the LIVE
// orchestrator on a fresh isolated stand (node :8547). 2 warm-up runs are not counted.
import { standEnv, type StandConfig } from "../scripts/lib/stand.ts";

const CFG: StandConfig = { name: "load", rpcPort: 8547, monitorPort: 8807, apiPort: 8808 };
Object.assign(process.env, standEnv(CFG));
const { run } = await import("./metrics.ts");
await run(CFG);
