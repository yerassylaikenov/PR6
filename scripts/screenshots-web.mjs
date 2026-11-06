// Drives the REAL web UI (http://localhost:5173) in Microsoft Edge on this laptop and saves
// screenshots for the report: the full scenario Retailer -> Supplier -> (auto) -> Clearing -> Auditor.
// Requires the running stack (launchers\start_all.cmd).
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(import.meta.dirname, "..", "reports/screenshots");
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: resolve(OUT, name), fullPage: true }); console.log(`\x1b[32m✔\x1b[0m  saved reports/screenshots/${name}`); };
const account = (i) => page.locator("header select").selectOption(String(i));
const tab = (t) => page.locator("nav button", { hasText: t }).click();
const waitTx = async () => { await page.locator(".tx").first().locator(".stage.confirmed, .stage.reverted").waitFor({ timeout: 20000 }); };

await page.goto("http://localhost:5173");
await page.locator("h1").waitFor();

// 1. Retailer: catalog + cart
await account(3);
await tab("Catalog & Cart");
const qty = page.locator("tbody input[type=number]");
await qty.nth(0).fill("4");
await qty.nth(1).fill("2");
await qty.nth(3).fill("12");
await shot("web_01_catalog_cart.png");
await page.locator("button", { hasText: "Place purchase order" }).click();
await waitTx();
await page.locator(".okmsg").first().waitFor();
await shot("web_02_po_created.png");
const orderNo = (await page.locator(".okmsg").first().innerText()).match(/PO-2026-\d{6}/)[0];

// 2. Supplier approves
await account(4);
await tab("Orders");
await page.locator("tr", { hasText: orderNo }).locator("button", { hasText: "Approve" }).waitFor();
await shot("web_03_supplier_incoming.png");
await page.locator("tr", { hasText: orderNo }).locator("button", { hasText: "Approve" }).click();
await waitTx();

// 3. Orchestrator registers the payment automatically -> clearing center sees it
await account(2);
await tab("Settlement");
await page.locator("tr", { hasText: orderNo }).locator("button", { hasText: "Execute" }).waitFor({ timeout: 20000 });
await shot("web_04_settlement_registered_auto.png");
await page.locator("tr", { hasText: orderNo }).locator("button", { hasText: "Execute" }).click();
await waitTx();

// 4. Auditor: end-to-end status Paid
await tab("End-to-end status");
await page.locator("main select").selectOption(orderNo);
await page.locator(".final.Paid").waitFor({ timeout: 20000 });
await page.waitForTimeout(1500);
await shot("web_05_auditor_paid_timeline.png");

// 5. Supplier sees "payment received"
await account(4);
await tab("Orders");
await page.locator("tr", { hasText: orderNo }).locator("text=Payment received").waitFor({ timeout: 10000 });
await shot("web_06_supplier_payment_received.png");

// 6. Negative: unauthorized attempt
// clicked 3 times within 60 s -> the monitor raises R-1 (>= 3 access violations from one actor)
for (let i = 0; i < 3; i++) {
  await page.locator("button", { hasText: "Unauthorized attempt" }).click();
  await page.locator(".tx").first().locator(".stage.reverted").waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
}
await page.locator(".card.neg .okmsg, .card.neg .errtxt").waitFor({ timeout: 20000 });
await shot("web_07_unauthorized_attempt.png");

// 7. Monitoring
await tab("Monitoring");
await page.locator("text=Recent alerts").waitFor();
await page.waitForTimeout(2500);
await shot("web_08_monitoring.png");

// 8. MetaMask button in a browser WITHOUT the extension (guard message)
await tab("Catalog & Cart");
await page.locator("button", { hasText: "Connect MetaMask" }).click();
await page.locator(".banner.err").waitFor();
await shot("web_09_metamask_guard_no_extension.png");

await browser.close();
console.log(`\x1b[32m\x1b[1mWEB SCREENSHOTS DONE (order ${orderNo})\x1b[0m`);
