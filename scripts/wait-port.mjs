// Waits until <port> accepts connections on 127.0.0.1 or ::1 (Vite listens on "localhost",
// which may resolve to IPv6 only). Used by the .cmd launchers.
import { createConnection } from "node:net";
const port = Number(process.argv[2]);
const deadline = Date.now() + Number(process.argv[3] ?? 90000);
const hosts = ["127.0.0.1", "::1"];
let i = 0;
(function tryOnce() {
  const s = createConnection({ port, host: hosts[i++ % hosts.length] });
  s.once("connect", () => { s.end(); process.exit(0); });
  s.once("error", () => { s.destroy(); if (Date.now() > deadline) { console.error(`port ${port} not open`); process.exit(1); } setTimeout(tryOnce, 200); });
})();
