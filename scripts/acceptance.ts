// npm run acceptance - AT-1..AT-7 on an isolated stand (node :8546, monitor :8797, API :8798).
// Environment must be set BEFORE the shared modules are imported (they read it at load time).
import { standEnv, type StandConfig } from "./lib/stand.ts";

export const AT_CFG: StandConfig = { name: "acceptance", rpcPort: 8546, monitorPort: 8797, apiPort: 8798, r3DelayMs: 30000 };
Object.assign(process.env, standEnv(AT_CFG));
await import("./lib/acceptance-run.ts");
