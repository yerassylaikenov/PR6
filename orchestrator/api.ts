// Read-only orchestrator API on 127.0.0.1 (no state-changing endpoints).
import { createServer } from "node:http";
import { pub, type Deployment } from "../scripts/lib/common.ts";
import { orderSummary } from "../scripts/lib/trace.ts";
import { orderNoMap } from "../scripts/lib/flow.ts";
import { retailAdapter } from "./retailAdapter.ts";

export function startApi(dep: Deployment, port: number, stats: () => unknown) {
  const startedAt = new Date().toISOString();
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("content-type", "application/json");
    if (req.method !== "GET") { res.writeHead(405); res.end('{"error":"read-only API"}'); return; }
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname === "/health") {
        const block = await pub.getBlockNumber();
        res.end(JSON.stringify({ ok: true, startedAt, block: block.toString(), ...(stats() as object) }));
      } else if (url.pathname === "/orders") {
        const names = orderNoMap();
        const ids = await retailAdapter(dep).allOrderIds();
        const out = [];
        for (const id of ids) out.push(await orderSummary(dep, names.get(id.toLowerCase()) ?? id));
        res.end(JSON.stringify(out.map((o) => ({ orderNo: o.orderNo, po: o.po.status, payment: o.payment?.status ?? "None", hub: o.hub.status }))));
      } else if (url.pathname.startsWith("/orders/")) {
        res.end(JSON.stringify(await orderSummary(dep, decodeURIComponent(url.pathname.slice(8)))));
      } else { res.writeHead(404); res.end('{"error":"not found"}'); }
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String((e as Error).message) })); }
  });
  server.listen(port, "127.0.0.1");
  return server;
}
