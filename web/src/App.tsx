import { useCallback, useEffect, useMemo, useState } from "react";
import { keccak256, toHex, type Address, type Hex } from "viem";
import {
  pub, loadDeployment, localWallet, connectMetaMask, metaMaskChainId, switchToLocal, metaMaskWallet, getProvider,
  orderIdOf, paymentIdOf, canonicalJson, decodeError, telemetry, kzt, short,
  PO_STATUS, PAY_STATUS, HUB_STATUS, CHAIN_ID, DEMO_MODE, MONITOR, ORCH_API, type Deployment,
} from "./lib";

type Tab = "retailer" | "supplier" | "clearing" | "auditor" | "monitor";
type Stage = "simulating" | "signing" | "pending" | "confirmed" | "reverted";
interface TxRec { id: number; label: string; stage: Stage; hash?: Hex; block?: bigint; gas?: bigint; error?: string; from: string }
interface OrderRow { orderNo: string; orderId: Hex; po: any; link: any; payments: { attempt: number; pid: Hex; p: any }[] }

const TABS: { key: Tab; label: string; role: string }[] = [
  { key: "retailer", label: "Catalog & Cart", role: "Retailer" },
  { key: "supplier", label: "Orders", role: "Supplier" },
  { key: "clearing", label: "Settlement", role: "Clearing center" },
  { key: "auditor", label: "End-to-end status", role: "Auditor" },
  { key: "monitor", label: "Monitoring", role: "Admin" },
];

let txSeq = 0;

export default function App() {
  const [dep, setDep] = useState<Deployment | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [mode, setMode] = useState<"local" | "metamask">("local");
  const [localIdx, setLocalIdx] = useState(3);
  const [mm, setMm] = useState<{ account?: Address; chainId?: number; error?: string }>({});
  const [tab, setTab] = useState<Tab>("retailer");
  const [txs, setTxs] = useState<TxRec[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [block, setBlock] = useState<bigint>(0n);

  useEffect(() => { loadDeployment().then(setDep).catch((e) => setLoadErr(String(e.message))); }, []);

  const account: Address | undefined = mode === "local" ? dep?.accounts[localIdx]?.address : mm.account;
  const accountInfo = dep?.accounts.find((a) => a.address.toLowerCase() === account?.toLowerCase());

  // ---- read all orders from the three contracts ----
  const refresh = useCallback(async () => {
    if (!dep) return;
    const names: string[] = await fetch("/api/orders").then((r) => r.json()).catch(() => []);
    const nameOf = new Map(names.map((n) => [orderIdOf(n).toLowerCase(), n]));
    const n = Number(await pub.readContract({ ...dep.contracts.retail, functionName: "orderCount" }));
    const rows: OrderRow[] = [];
    for (let i = 0; i < n; i++) {
      const orderId = (await pub.readContract({ ...dep.contracts.retail, functionName: "orderIdAt", args: [BigInt(i)] })) as Hex;
      const po: any = await pub.readContract({ ...dep.contracts.retail, functionName: "getPO", args: [orderId] });
      const link: any = await pub.readContract({ ...dep.contracts.hub, functionName: "getOrder", args: [orderId] });
      const payments = [];
      for (let a = 1; a <= 10; a++) {
        const pid = paymentIdOf(orderId, a);
        const p: any = await pub.readContract({ ...dep.contracts.bank, functionName: "getPayment", args: [pid] });
        if (p.status === 0) break;
        payments.push({ attempt: a, pid, p });
      }
      rows.push({ orderNo: nameOf.get(orderId.toLowerCase()) ?? short(orderId), orderId, po, link, payments });
    }
    setOrders(rows.reverse());
    setBlock(await pub.getBlockNumber());
  }, [dep]);
  useEffect(() => { refresh(); const t = setInterval(refresh, 1500); return () => clearInterval(t); }, [refresh]);

  // ---- MetaMask ----
  useEffect(() => {
    const p = getProvider();
    p?.on?.("accountsChanged", (a: Address[]) => setMm((s) => ({ ...s, account: a[0] })));
    p?.on?.("chainChanged", (c: string) => setMm((s) => ({ ...s, chainId: parseInt(c, 16) })));
  }, []);
  async function onConnectMetaMask() {
    try {
      const acc = await connectMetaMask();
      setMm({ account: acc, chainId: await metaMaskChainId() });
      setMode("metamask");
    } catch (e) { setMm({ error: decodeError(e) }); }
  }
  const wrongNetwork = mode === "metamask" && mm.account && mm.chainId !== CHAIN_ID;

  // ---- transaction state machine ----
  async function runTx(label: string, c: "bank" | "retail" | "hub", fn: string, args: unknown[], asIndex?: number): Promise<boolean> {
    if (!dep) return false;
    const id = ++txSeq;
    const useLocal = asIndex !== undefined || mode === "local";
    const idx = asIndex ?? localIdx;
    const from = useLocal ? dep.accounts[idx].address : mm.account;
    if (!from) { alert("Connect a wallet first"); return false; }
    if (!useLocal && wrongNetwork) { alert(`Switch MetaMask to chainId ${CHAIN_ID}`); return false; }
    const upd = (p: Partial<TxRec>) => setTxs((l) => l.map((t) => (t.id === id ? { ...t, ...p } : t)));
    setTxs((l) => [{ id, label, stage: "simulating" as Stage, from }, ...l].slice(0, 12));
    try {
      const { request } = await pub.simulateContract({ ...dep.contracts[c], functionName: fn, args, account: from } as any);
      upd({ stage: "signing" });
      const wc = useLocal ? localWallet(idx) : metaMaskWallet(from);
      const hash = await wc.writeContract(useLocal ? ({ ...request, account: wc.account } as any) : (request as any));
      upd({ stage: "pending", hash });
      const r = await pub.waitForTransactionReceipt({ hash });
      upd({ stage: r.status === "success" ? "confirmed" : "reverted", block: r.blockNumber, gas: r.gasUsed });
      void telemetry({ correlationId: args[0], step: `${c}.${fn}`, actor: from, txHash: hash, blockNumber: String(r.blockNumber), outcome: r.status === "success" ? "success" : "reverted" });
      refresh();
      return r.status === "success";
    } catch (e) {
      const err = decodeError(e);
      upd({ stage: "reverted", error: err });
      void telemetry({ correlationId: args[0], step: `${c}.${fn}`, actor: from, outcome: "reverted", errorName: err.split(" ")[0], severity: "High" });
      return false;
    }
  }

  if (loadErr) return <div className="page"><div className="banner err">{loadErr}</div></div>;
  if (!dep) return <div className="page">Loading deployment…</div>;

  return (
    <div className="page">
      <header>
        <div>
          <h1>B2B Procurement Marketplace <span className="muted">with bank payment</span></h1>
          <div className="muted small">PR6 MVP · Module B (Retail) → Hub → Module A (Bank) · chainId {CHAIN_ID} · block {block.toString()}</div>
        </div>
        <div className="wallet">
          <div className="seg">
            <button className={mode === "local" ? "on" : ""} onClick={() => setMode("local")}>Local test account</button>
            <button className={mode === "metamask" ? "on" : ""} onClick={onConnectMetaMask}>🦊 {mm.account ? "MetaMask: " + short(mm.account) : "Connect MetaMask"}</button>
          </div>
          {mode === "local" && (
            <select value={localIdx} onChange={(e) => setLocalIdx(Number(e.target.value))}>
              {dep.accounts.map((a, i) => <option key={a.key} value={i}>#{i} {a.label} — {a.roles}</option>)}
            </select>
          )}
          <div className="small">Active: <b>{accountInfo?.label ?? (account ? short(account) : "not connected")}</b> {account && <span className="mono muted">{short(account)}</span>}</div>
        </div>
      </header>

      {mode === "local" && DEMO_MODE && <div className="banner warn">⚠ DEMO MODE: transactions are signed with PUBLIC Hardhat test keys (works only on chainId 31337). Never use these keys on a real network.</div>}
      {mm.error && <div className="banner err">MetaMask: {mm.error}</div>}
      {wrongNetwork && <div className="banner err">MetaMask is on chainId {mm.chainId}. <button onClick={() => switchToLocal().then(async () => setMm((s) => ({ ...s, chainId: CHAIN_ID })))}>Switch to Hardhat Local (31337)</button></div>}

      <nav>
        {TABS.map((t) => <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>{t.label}<span>{t.role}</span></button>)}
      </nav>

      <div className="layout">
        <main>
          {tab === "retailer" && <Retailer dep={dep} orders={orders} runTx={runTx} account={account} />}
          {tab === "supplier" && <Supplier dep={dep} orders={orders} runTx={runTx} account={account} />}
          {tab === "clearing" && <Clearing orders={orders} runTx={runTx} />}
          {tab === "auditor" && <Auditor dep={dep} orders={orders} />}
          {tab === "monitor" && <Monitor />}
        </main>
        <aside>
          <h3>Transactions</h3>
          {txs.length === 0 && <div className="muted small">No transactions yet. Every action is a real transaction on the local chain.</div>}
          {txs.map((t) => (
            <div key={t.id} className={`tx ${t.stage}`}>
              <div className="txl"><b>{t.label}</b><span className={`stage ${t.stage}`}>{t.stage}</span></div>
              <Stages stage={t.stage} />
              <div className="small mono">from {short(t.from)}</div>
              {t.hash && <div className="small mono">tx {short(t.hash)}</div>}
              {t.block !== undefined && <div className="small">block {t.block.toString()} · gasUsed {t.gas?.toString()}</div>}
              {t.error && <div className="small errtxt">✘ {t.error}</div>}
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

function Stages({ stage }: { stage: Stage }) {
  const order: Stage[] = ["simulating", "signing", "pending", "confirmed"];
  const idx = stage === "reverted" ? -1 : order.indexOf(stage);
  return <div className="stages">{order.map((s, i) => <span key={s} className={i <= idx ? "done" : stage === "reverted" ? "bad" : ""}>{s}</span>)}</div>;
}

function Badge({ s }: { s: string }) {
  const cls = ["Paid", "Approved", "Executed"].includes(s) ? "ok" : ["PaymentFailed", "Rejected", "Cancelled"].includes(s) ? "bad" : s === "None" ? "none" : "wait";
  return <span className={`badge ${cls}`}>{s}</span>;
}

// ===================== Retailer =====================
function Retailer({ dep, orders, runTx, account }: { dep: Deployment; orders: OrderRow[]; runTx: any; account?: Address }) {
  const [catalog, setCatalog] = useState<any>(null);
  const [supplier, setSupplier] = useState("supplier1");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState("");
  useEffect(() => { fetch("/api/catalog").then((r) => r.json()).then(setCatalog); }, []);
  if (!catalog) return <div>Loading catalog…</div>;
  const items = catalog.items.filter((i: any) => i.supplier === supplier);
  const lines = Object.entries(cart).filter(([, q]) => q > 0).map(([sku, qty]) => ({ ...catalog.items.find((i: any) => i.sku === sku), qty }));
  const total = lines.reduce((s, l) => s + l.qty * l.unitPurchasePrice, 0);
  const supAddr = dep.accounts.find((a) => a.key === supplier)!.address;

  async function placeOrder() {
    const n = Number(await pub.readContract({ ...dep.contracts.retail, functionName: "orderCount" }));
    const orderNo = `PO-2026-${String(n + 1).padStart(6, "0")}`;
    const doc = {
      orderNo, orderId: orderIdOf(orderNo), retailer: account, supplier: supAddr, currency: "KZT",
      items: lines.map((l) => ({ sku: l.sku, name: l.name, qty: l.qty, unitPurchasePrice: l.unitPurchasePrice })),
      totalPurchaseCost: total, createdAt: new Date().toISOString(),
    };
    const json = canonicalJson(doc);
    const poHash = keccak256(toHex(json));
    await fetch(`/api/orders/${orderNo}`, { method: "POST", body: json }); // off-chain document
    const ok = await runTx(`createPO ${orderNo}`, "retail", "createPO", [doc.orderId, supAddr, poHash, BigInt(total), lines.length]);
    if (ok) { setCart({}); setMsg(`✔ ${orderNo} created: total ${kzt(total)}, poHash ${short(poHash)}. Now switch to the supplier (#${supplier === "supplier1" ? 4 : 5}) → Orders → Approve.`); }
  }

  return (
    <div>
      <h2>Catalog <span className="muted small">(purchase prices, synthetic data)</span></h2>
      <div className="row">
        Supplier:&nbsp;
        <select value={supplier} onChange={(e) => { setSupplier(e.target.value); setCart({}); }}>
          {catalog.suppliers.map((s: any) => <option key={s.key} value={s.key}>{s.name}</option>)}
        </select>
        <span className="muted small">&nbsp;A cart may contain goods of one supplier only.</span>
      </div>
      <table>
        <thead><tr><th>SKU</th><th>Item</th><th>Unit</th><th className="r">Price</th><th>Qty</th></tr></thead>
        <tbody>{items.map((i: any) => (
          <tr key={i.sku}><td className="mono">{i.sku}</td><td>{i.name}</td><td>{i.unit}</td><td className="r">{kzt(i.unitPurchasePrice)}</td>
            <td><input type="number" min={0} value={cart[i.sku] ?? 0} onChange={(e) => setCart({ ...cart, [i.sku]: Math.max(0, Number(e.target.value)) })} /></td></tr>
        ))}</tbody>
      </table>
      <div className="card">
        <h3>Cart</h3>
        {lines.length === 0 ? <div className="muted">Empty - set quantities above.</div> : (
          <table><tbody>{lines.map((l) => <tr key={l.sku}><td>{l.name}</td><td className="r">{l.qty} × {kzt(l.unitPurchasePrice)}</td><td className="r">{kzt(l.qty * l.unitPurchasePrice)}</td></tr>)}</tbody></table>
        )}
        <div className="total">Total purchase cost: <b>{kzt(total)}</b> <span className="muted small">(computed automatically = Σ qty × unit price)</span></div>
        <button className="primary" disabled={!lines.length} onClick={placeOrder}>Place purchase order</button>
        {msg && <div className="okmsg">{msg}</div>}
      </div>
      <h3>My orders</h3>
      <OrdersTable orders={orders.filter((o) => o.po.retailer.toLowerCase() === account?.toLowerCase())} />
    </div>
  );
}

function OrdersTable({ orders, actions }: { orders: OrderRow[]; actions?: (o: OrderRow) => any }) {
  if (!orders.length) return <div className="muted">No orders.</div>;
  return (
    <table>
      <thead><tr><th>Order</th><th className="r">Total</th><th>PO (B)</th><th>Payment (A)</th><th>Hub</th>{actions && <th />}</tr></thead>
      <tbody>{orders.map((o) => {
        const p = o.payments[o.payments.length - 1];
        return (<tr key={o.orderId}><td className="mono">{o.orderNo}</td><td className="r">{kzt(o.po.totalPurchaseCost)}</td>
          <td><Badge s={PO_STATUS[o.po.status]} /></td><td><Badge s={p ? PAY_STATUS[p.p.status] : "None"} /></td><td><Badge s={HUB_STATUS[o.link.status]} /></td>
          {actions && <td>{actions(o)}</td>}</tr>);
      })}</tbody>
    </table>
  );
}

// ===================== Supplier =====================
function Supplier({ dep, orders, runTx, account }: { dep: Deployment; orders: OrderRow[]; runTx: any; account?: Address }) {
  const mine = orders.filter((o) => o.po.supplier.toLowerCase() === account?.toLowerCase());
  const [neg, setNeg] = useState<string>("");
  const target = orders.find((o) => o.po.status === 1) ?? orders[0];

  async function unauthorized() {
    if (!target) { setNeg("Create an order first."); return; }
    const before = PO_STATUS[target.po.status];
    const ok = await runTx(`ATTACK approvePO ${target.orderNo}`, "retail", "approvePO", [target.orderId], 6);
    const po: any = await pub.readContract({ ...dep.contracts.retail, functionName: "getPO", args: [target.orderId] });
    setNeg(ok ? "✘ UNEXPECTED: attack succeeded" : `✔ Blocked by the contract (see decoded error in Transactions). PO ${target.orderNo} status: ${before} → ${PO_STATUS[po.status]} (unchanged).`);
  }

  return (
    <div>
      <h2>Incoming purchase orders</h2>
      {!dep.accounts.slice(4, 6).some((a) => a.address.toLowerCase() === account?.toLowerCase()) && <div className="banner warn">Active account is not a supplier. Choose #4 Agro-Opt LLP or #5 Fresh Products LLP.</div>}
      <OrdersTable orders={mine} actions={(o) => o.po.status === 1
        ? <button className="primary" onClick={() => runTx(`approvePO ${o.orderNo}`, "retail", "approvePO", [o.orderId])}>Approve</button>
        : o.link.status === 2 ? <span className="okmsg">Payment received - ready to ship</span>
        : o.link.status === 3 ? <span className="errtxt">Payment failed</span>
        : o.po.status === 2 ? <span className="muted">awaiting payment…</span> : null} />
      <div className="card neg">
        <h3>Negative check</h3>
        <p className="small">The attacker account (#6, no roles) tries to approve someone else's PO. The contract must revert and the state must not change.</p>
        <button className="danger" onClick={unauthorized}>Unauthorized attempt</button>
        {neg && <div className={neg.startsWith("✔") ? "okmsg" : "errtxt"}>{neg}</div>}
      </div>
    </div>
  );
}

// ===================== Clearing =====================
function Clearing({ orders, runTx }: { orders: OrderRow[]; runTx: any }) {
  const pays = orders.flatMap((o) => o.payments.map((p) => ({ ...p, o })));
  const open = pays.filter((x) => x.p.status === 1);
  const done = pays.filter((x) => x.p.status !== 1);
  return (
    <div>
      <h2>Payments to settle <span className="muted small">(registered automatically by the buyer's bank / orchestrator)</span></h2>
      <div className="muted small">Amount and document hash are read-only - they were taken from the approved PO on-chain. There is no manual input.</div>
      {open.length === 0 ? <div className="muted">No registered payments.</div> : (
        <table>
          <thead><tr><th>Order</th><th>paymentId</th><th className="r">Amount</th><th>docHash</th><th>Registered by</th><th /></tr></thead>
          <tbody>{open.map((x) => (
            <tr key={x.pid}><td className="mono">{x.o.orderNo} #{x.attempt}</td><td className="mono">{short(x.pid)}</td><td className="r"><input readOnly value={kzt(x.p.amount)} /></td>
              <td className="mono"><input readOnly value={short(x.p.docHash)} /></td><td className="mono">{short(x.p.registeredBy)}</td>
              <td className="nowrap"><button className="primary" onClick={() => runTx(`markExecuted ${x.o.orderNo}`, "bank", "markExecuted", [x.pid])}>Execute</button>{" "}
                <button onClick={() => runTx(`markRejected ${x.o.orderNo}`, "bank", "markRejected", [x.pid, toHex("AC04", { size: 32 })])}>Reject</button></td></tr>
          ))}</tbody>
        </table>
      )}
      <h3>History</h3>
      <table><thead><tr><th>Order</th><th className="r">Amount</th><th>Status</th><th>Settled by</th></tr></thead>
        <tbody>{done.map((x) => <tr key={x.pid}><td className="mono">{x.o.orderNo} #{x.attempt}</td><td className="r">{kzt(x.p.amount)}</td><td><Badge s={PAY_STATUS[x.p.status]} /></td><td className="mono">{short(x.p.settledBy)}</td></tr>)}</tbody></table>
    </div>
  );
}

// ===================== Auditor =====================
function Auditor({ dep, orders }: { dep: Deployment; orders: OrderRow[] }) {
  const [sel, setSel] = useState<string>("");
  const [steps, setSteps] = useState<any[]>([]);
  const [docOk, setDocOk] = useState<boolean | null>(null);
  const o = useMemo(() => orders.find((x) => x.orderNo === sel) ?? orders[0], [orders, sel]);

  useEffect(() => {
    if (!o) return;
    (async () => {
      const { retail, bank, hub } = dep.contracts;
      const ev = (c: any, eventName: string, args: any) => pub.getContractEvents({ ...c, eventName, args, fromBlock: 0n } as any);
      const out: any[] = [];
      const push = async (label: string, module: string, logs: any[], detail?: (l: any) => string) => {
        for (const l of logs) { const b = await pub.getBlock({ blockNumber: l.blockNumber }); out.push({ label, module, hash: l.transactionHash, block: l.blockNumber, ts: Number(b.timestamp), detail: detail?.(l), actor: l.args.retailer ?? l.args.supplier ?? l.args.operator ?? l.args.actor }); }
      };
      await push("PO created", "Retail (B)", await ev(retail, "PurchaseOrderCreated", { poId: o.orderId }), (l) => kzt(l.args.totalPurchaseCost));
      await push("PO approved", "Retail (B)", await ev(retail, "PurchaseOrderApproved", { poId: o.orderId }));
      for (const p of o.payments) {
        await push(`Payment registered #${p.attempt}`, "Bank (A)", await ev(bank, "PaymentRegistered", { paymentId: p.pid }), (l) => kzt(l.args.amount));
        await push(`Payment status #${p.attempt}`, "Bank (A)", await ev(bank, "PaymentStatusChanged", { paymentId: p.pid }), (l) => `${PAY_STATUS[l.args.from]} → ${PAY_STATUS[l.args.to]}`);
      }
      await push("Linked to payment", "Hub", await ev(hub, "OrderPaymentLinked", { orderId: o.orderId }), (l) => `attempt ${l.args.attempt}`);
      await push("Finalized", "Hub", await ev(hub, "OrderFinalized", { orderId: o.orderId }), (l) => HUB_STATUS[l.args.finalStatus]);
      out.sort((a, b) => Number(a.block - b.block));
      setSteps(out);
      // verify the off-chain PO document against the bank record
      const doc = await fetch(`/api/orders/${o.orderNo}`).then((r) => (r.ok ? r.text() : "")).catch(() => "");
      const pid = o.link.status ? o.link.paymentId : o.payments[o.payments.length - 1]?.pid;
      if (doc && pid) setDocOk((await pub.readContract({ ...bank, functionName: "verifyDocument", args: [pid, keccak256(toHex(doc))] })) as boolean);
      else setDocOk(null);
    })();
  }, [o?.orderId, o?.link.status, o?.payments.length, dep]);

  if (!o) return <div className="muted">No orders yet.</div>;
  const pay = o.link.status ? o.payments.find((p) => p.pid === o.link.paymentId)?.p : o.payments[o.payments.length - 1]?.p;
  const hubS = HUB_STATUS[o.link.status];
  return (
    <div>
      <h2>End-to-end order status</h2>
      <div className="row">Order:&nbsp;<select value={o.orderNo} onChange={(e) => setSel(e.target.value)}>{orders.map((x) => <option key={x.orderId}>{x.orderNo}</option>)}</select></div>
      <div className={`final ${hubS}`}>{hubS === "None" ? "Not linked yet" : hubS}</div>
      <div className="grid3">
        <div className="card"><div className="muted small">Module B · Retail</div><Badge s={PO_STATUS[o.po.status]} /><div className="small">total {kzt(o.po.totalPurchaseCost)}</div><div className="small mono">poHash {short(o.po.poHash)}</div></div>
        <div className="card"><div className="muted small">Module A · Bank</div><Badge s={pay ? PAY_STATUS[pay.status] : "None"} /><div className="small">amount {pay ? kzt(pay.amount) : "-"}</div><div className="small mono">docHash {short(pay?.docHash)}</div></div>
        <div className="card"><div className="muted small">Integration Hub</div><Badge s={hubS} /><div className="small">attempt {o.link.attempt}</div><div className="small mono">paymentId {short(o.link.paymentId)}</div></div>
      </div>
      <div className="checks">
        <div>{pay && pay.amount === o.po.totalPurchaseCost ? "✔" : "✘"} PO total = payment amount</div>
        <div>{pay && pay.docHash === o.po.poHash ? "✔" : "✘"} poHash = payment docHash</div>
        <div>{docOk === null ? "…" : docOk ? "✔" : "✘"} bank.verifyDocument(keccak256(PO document)) {docOk === null ? "(no payment yet)" : ""}</div>
      </div>
      <h3>Timeline (from blockchain events)</h3>
      <table><thead><tr><th>Step</th><th>Module</th><th>Block</th><th>Time</th><th>txHash</th><th>Actor</th><th>Detail</th></tr></thead>
        <tbody>{steps.map((s) => <tr key={s.hash + s.label}><td>✔ {s.label}</td><td>{s.module}</td><td>{s.block.toString()}</td><td>{new Date(s.ts * 1000).toLocaleTimeString()}</td><td className="mono">{short(s.hash)}</td><td className="mono">{short(s.actor)}</td><td>{s.detail}</td></tr>)}</tbody></table>
    </div>
  );
}

// ===================== Monitoring =====================
function Monitor() {
  const [alerts, setAlerts] = useState<any[] | null>(null);
  const [health, setHealth] = useState<any>(null);
  const [mon, setMon] = useState<any>(null);
  useEffect(() => {
    const load = () => {
      fetch(`${MONITOR}/alerts`).then((r) => r.json()).then(setAlerts).catch(() => setAlerts(null));
      fetch(`${MONITOR}/health`).then((r) => r.json()).then(setMon).catch(() => setMon(null));
      fetch(`${ORCH_API}/health`).then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
    };
    load(); const t = setInterval(load, 2000); return () => clearInterval(t);
  }, []);
  return (
    <div>
      <h2>Monitoring</h2>
      <div className="grid3">
        <div className="card"><div className="muted small">Orchestrator (GET /health)</div>{health ? <><span className="badge ok">online</span><div className="small">processed {health.processedCount} · last error {health.lastError ?? "none"}</div></> : <span className="badge bad">offline</span>}</div>
        <div className="card"><div className="muted small">Monitor collector</div>{mon ? <><span className="badge ok">online</span><div className="small">{mon.records} telemetry records</div></> : <span className="badge bad">offline</span>}</div>
        <div className="card"><div className="muted small">Rules</div><div className="small">R-1 access violation (High)<br />R-2 operational failure (Medium)<br />R-3 cross-module discrepancy (High)</div></div>
      </div>
      <h3>Recent alerts</h3>
      {!alerts ? <div className="muted">monitor offline</div> : alerts.length === 0 ? <div className="okmsg">No alerts - normal operation.</div> :
        alerts.map((a, i) => <div key={i} className={`alert ${a.severity}`}><b>{a.rule}</b> [{a.severity}] {a.message} <span className="muted small">{a.ts}</span></div>)}
    </div>
  );
}
