import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Small dev-server API for the OFF-CHAIN part only: catalog and PO documents (data/orders).
// On-chain state is always read directly from the blockchain by the browser.
const DATA = resolve(__dirname, "..", "data");
const ORDERS = resolve(DATA, "orders");

function offchainApi(): Plugin {
  return {
    name: "offchain-api",
    configureServer(server) {
      server.middlewares.use("/api", (req, res) => {
        res.setHeader("content-type", "application/json");
        const url = req.url ?? "/";
        if (url === "/catalog") { res.end(readFileSync(resolve(DATA, "catalog.json"))); return; }
        if (url === "/orders" && req.method === "GET") {
          mkdirSync(ORDERS, { recursive: true });
          res.end(JSON.stringify(readdirSync(ORDERS).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))));
          return;
        }
        const m = url.match(/^\/orders\/(PO-2026-\d{6})$/);
        if (m && req.method === "GET") {
          const p = resolve(ORDERS, `${m[1]}.json`);
          if (!existsSync(p)) { res.statusCode = 404; res.end("{}"); return; }
          res.end(readFileSync(p)); return;
        }
        if (m && req.method === "POST") {
          let body = "";
          req.on("data", (c) => { body += c; });
          req.on("end", () => {
            try { JSON.parse(body); mkdirSync(ORDERS, { recursive: true }); writeFileSync(resolve(ORDERS, `${m[1]}.json`), body); res.end('{"ok":true}'); }
            catch { res.statusCode = 400; res.end('{"error":"invalid json"}'); }
          });
          return;
        }
        res.statusCode = 404; res.end("{}");
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), offchainApi()],
  server: { port: 5173, strictPort: true },
});
