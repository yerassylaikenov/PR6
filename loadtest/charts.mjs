// Builds SVG charts + charts-view.html from reports/load/e2e-metrics.json and e2e-raw.csv.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(import.meta.dirname, "..", "reports/load");
const m = JSON.parse(readFileSync(resolve(DIR, "e2e-metrics.json"), "utf8"));
const [head, ...lines] = readFileSync(resolve(DIR, "e2e-raw.csv"), "utf8").trim().split("\n");
const cols = head.split(",");
const rows = lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])));
const W = 720, H = 320, P = 50;
const svg = (body, title) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Segoe UI, sans-serif" font-size="12"><rect width="100%" height="100%" fill="#fff"/><text x="${W / 2}" y="22" text-anchor="middle" font-size="15" font-weight="600">${title}</text>${body}</svg>`;

// 1. latency per run
const lat = rows.map((r) => Number(r.totalMs));
const maxL = Math.max(...lat, m.latencyMs.p95) * 1.15;
const x = (i) => P + (i * (W - 2 * P)) / Math.max(1, lat.length - 1);
const y = (v) => H - P - (v / maxL) * (H - 2 * P);
let b1 = `<line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="#999"/><line x1="${P}" y1="${P}" x2="${P}" y2="${H - P}" stroke="#999"/>`;
for (let t = 0; t <= 4; t++) { const v = Math.round((maxL * t) / 4); b1 += `<text x="${P - 6}" y="${y(v) + 4}" text-anchor="end" fill="#666">${v}</text><line x1="${P}" x2="${W - P}" y1="${y(v)}" y2="${y(v)}" stroke="#eee"/>`; }
b1 += `<polyline fill="none" stroke="#2457d6" stroke-width="2" points="${lat.map((v, i) => `${x(i)},${y(v)}`).join(" ")}"/>`;
b1 += lat.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="#2457d6"/>`).join("");
for (const [k, c] of [["p50", "#1a8a4a"], ["p95", "#c62f2f"]]) b1 += `<line x1="${P}" x2="${W - P}" y1="${y(m.latencyMs[k])}" y2="${y(m.latencyMs[k])}" stroke="${c}" stroke-dasharray="5 4"/><text x="${W - P + 4}" y="${y(m.latencyMs[k]) + 4}" fill="${c}">${k}</text>`;
b1 += `<text x="${W / 2}" y="${H - 12}" text-anchor="middle" fill="#666">run # (1..${lat.length})</text><text x="14" y="${H / 2}" transform="rotate(-90 14 ${H / 2})" text-anchor="middle" fill="#666">end-to-end latency, ms</text>`;
writeFileSync(resolve(DIR, "latency-per-run.svg"), svg(b1, "End-to-end latency per run (createPO → OrderFinalized)"));

// 2. p50/p95/min/max bars
const bars = [["min", m.latencyMs.min], ["p50", m.latencyMs.p50], ["mean", m.latencyMs.mean], ["p95", m.latencyMs.p95], ["max", m.latencyMs.max]];
const mx = Math.max(...bars.map((b) => b[1])) * 1.2;
const bw = (W - 2 * P) / bars.length;
let b2 = `<line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="#999"/>`;
bars.forEach(([k, v], i) => { const h = (v / mx) * (H - 2 * P); b2 += `<rect x="${P + i * bw + 15}" y="${H - P - h}" width="${bw - 30}" height="${h}" fill="${k === "p95" ? "#c62f2f" : k === "p50" ? "#1a8a4a" : "#8fa6d9"}"/><text x="${P + i * bw + bw / 2}" y="${H - P - h - 6}" text-anchor="middle" font-weight="600">${v} ms</text><text x="${P + i * bw + bw / 2}" y="${H - P + 18}" text-anchor="middle">${k}</text>`; });
writeFileSync(resolve(DIR, "latency-percentiles.svg"), svg(b2, `Latency percentiles (n = ${m.successCount}, nearest rank)`));

// 3. stage contribution
const st = [["Module B: createPO + approvePO", m.stagesMeanMs.moduleB, "#4c9f70"], ["Transfer B→A: register + link (auto)", m.stagesMeanMs.transfer, "#e0a030"], ["Module A: markExecuted", m.stagesMeanMs.moduleA, "#2457d6"], ["Finalization: hub.finalize (auto)", m.stagesMeanMs.finalize, "#8a4fd6"]];
const tot = st.reduce((s, r) => s + r[1], 0);
let b3 = ""; let cx = P;
st.forEach(([k, v, c], i) => { const w = (v / tot) * (W - 2 * P); b3 += `<rect x="${cx}" y="70" width="${w}" height="50" fill="${c}"/>`; cx += w; b3 += `<rect x="${P}" y="${150 + i * 32}" width="14" height="14" fill="${c}"/><text x="${P + 22}" y="${162 + i * 32}">${k}: ${v} ms (${((v / tot) * 100).toFixed(0)}%)</text>`; });
writeFileSync(resolve(DIR, "stage-contribution.svg"), svg(b3, "Mean contribution of stages to end-to-end latency"));

writeFileSync(resolve(DIR, "charts-view.html"), `<!doctype html><html><head><meta charset="utf-8"><title>PR6 E2E experiment</title><style>body{font-family:Segoe UI,sans-serif;background:#f5f7fb;margin:20px}img{background:#fff;border:1px solid #ddd;margin:8px}table{border-collapse:collapse;background:#fff}td,th{border:1px solid #ddd;padding:5px 10px}</style></head><body>
<h2>PR6 - 30 runs of the end-to-end business scenario</h2>
<table><tr><th>Success</th><th>Discrepancies</th><th>p50</th><th>p95</th><th>min</th><th>max</th></tr><tr><td>${m.successCount}/${m.runs} (${(m.successRate * 100).toFixed(1)}%)</td><td>${m.discrepancies}</td><td>${m.latencyMs.p50} ms</td><td>${m.latencyMs.p95} ms</td><td>${m.latencyMs.min} ms</td><td>${m.latencyMs.max} ms</td></tr></table>
<div><img src="latency-per-run.svg"><img src="latency-percentiles.svg"></div><div><img src="stage-contribution.svg"></div><p style="color:#666">${m.method}</p></body></html>`);
console.log("\x1b[32m✔\x1b[0m  charts: latency-per-run.svg, latency-percentiles.svg, stage-contribution.svg, charts-view.html");
