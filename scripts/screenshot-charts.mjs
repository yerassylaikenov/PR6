// Screenshot of the 30-run charts page (reports/load/charts-view.html) rendered in Edge.
import { chromium } from "playwright-core";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1520, height: 900 } });
await page.goto(pathToFileURL(resolve(ROOT, "reports/load/charts-view.html")).href);
await page.waitForTimeout(800);
await page.screenshot({ path: resolve(ROOT, "reports/screenshots/charts_30_runs.png"), fullPage: true });
await browser.close();
console.log("\x1b[32m✔\x1b[0m  saved reports/screenshots/charts_30_runs.png");
