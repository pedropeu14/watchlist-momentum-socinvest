// app.js — Watchlist Momentum (Socinvest) orchestrator.
// Loads the EOD dataset produced by scripts/fetch_data.py, computes
// indicators/signals once per asset, and renders the tabs. All user state
// (paper trades, portfolio, watchlists, alerts) lives in localStorage.

import { computeAll, fpeRollingZ } from "./indicators.js";
import { latestSignal, signalAt, VOTE_NAMES } from "./signals.js";
import { tradePlan, positionSize } from "./risk.js";
import { STRATEGIES } from "./strategies.js";
import { runBacktest, tradesToCsv } from "./backtest.js";
import * as store from "./store.js";
import { priceChart, rsiChart, macdChart, mm200Chart, fpeChart, equityChart, sparkline } from "./charts.js";
import { helpPanel, initHelp } from "./help.js";

// ---------------------------------------------------------------- utilities

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ccySym = c => ({ USD: "$", EUR: "€" }[c] || (c ? c + " " : ""));
const fmtN = (v, d = 2) => v === null || v === undefined || Number.isNaN(v)
  ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (v, d = 1) => v === null || v === undefined || !Number.isFinite(v)
  ? "—" : (v >= 0 ? "+" : "") + v.toFixed(d) + "%";
const pctCls = v => v === null || v === undefined ? "" : v >= 0 ? "pos" : "neg";
// quantities: whole shares for stocks, up to 4 decimals for index fractions
const fmtQty = q => Number.isInteger(q) ? String(q) : q.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
const isIndex = ticker => ASSETS.get(ticker)?.meta.group === "index";
const todayIso = () => new Date().toISOString().slice(0, 10);

function download(name, text, mime = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function toast(msg, cls = "") {
  const t = document.createElement("div");
  t.className = "toast " + cls;
  t.innerHTML = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

function showModal(html) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal"><button class="btn ghost close" onclick="document.getElementById('modal-root').classList.add('hidden')">✕ close</button>${html}</div>`;
  root.classList.remove("hidden");
}

// ---------------------------------------------------------------- data load

const ASSETS = new Map();   // ticker -> {meta, bars, ind, sig, plan}
let MANIFEST = null;
let F13 = null;             // optional smart-money layer (data/f13.json)
let FPE = null;             // optional forward P/E layer (data/fpe.json)

const f13Of = ticker => F13?.tickers?.[ticker.replace("/", "-")] ?? null;
const f13Net = e => e ? (e.opened + e.increased) - (e.decreased + e.closed) : null;
const fpeOf = ticker => FPE?.tickers?.[ticker] ?? null;

// The MM200 × forward P/E quadrant read: two rulers, one verdict.
// Thresholds mirror the individual rules: cheap ≤ −1σ, stretched ≥ +1σ.
function quadrantVerdict(mmz, fz) {
  if (mmz === null || mmz === undefined || fz === null || fz === undefined) return null;
  const cheapP = mmz <= -1, richP = mmz >= 1, cheapE = fz <= -1, richE = fz >= 1;
  if (cheapP && cheapE) return { cls: "BUY", label: "Classic buy zone",
    text: "Price sits 1σ below its own trend AND the forward multiple is 1σ below its own history — double pessimism. Historically where opportunities (and the worst stresses) concentrate; check the fundamentals story before averaging in." };
  if (richP && richE) return { cls: "SELL", label: "Classic sell zone",
    text: "Price stretched above trend AND the multiple re-rated 1σ above its history — the rally is paying today for earnings that haven't arrived. Maximum caution for new money." };
  if (cheapP && richE) return { cls: "SELL", label: "Possible value trap",
    text: "Price is depressed but the forward multiple is expensive: projected earnings fell faster than the price did. It looks cheap on the chart and is not — suspicion first." };
  if (richP && cheapE) return { cls: "BUY", label: "Earnings-driven rally",
    text: "Price is stretched but the multiple is not: earnings grew into the move. Momentum with valuation support — not automatically a sell." };
  return { cls: "HOLD", label: "No quadrant verdict",
    text: "The two rulers don't BOTH reach ±1σ, so no quadrant is named. A one-legged extreme (price without multiple, or vice-versa) is a lead to investigate — the individual sections above tell you which leg — not a combined signal." };
}

// Sign-based map position — same quadrant labels as the Socinvest scatter,
// which cuts at zero. Position says WHERE the asset sits; the ±1σ verdict
// says whether that position is statistically meaningful.
function quadrantPosition(mmz, fz) {
  if (mmz === null || mmz === undefined || fz === null || fz === undefined) return null;
  return {
    label: `${fz < 0 ? "cheap" : "expensive"} & ${mmz < 0 ? "depressed" : "stretched"}`,
    pBorder: Math.abs(mmz) < 0.25,
    eBorder: Math.abs(fz) < 0.25,
  };
}

async function loadAll() {
  MANIFEST = await (await fetch("data/manifest.json", { cache: "no-store" })).json();
  const jobs = MANIFEST.assets.filter(a => a.available).map(async meta => {
    const raw = await (await fetch("data/" + meta.file, { cache: "no-store" })).json();
    const bars = raw.bars;
    const ind = computeAll(bars);
    const sig = latestSignal(ind, bars);
    const last = bars.close.length - 1;
    const plan = sig.action === "BUY"
      ? tradePlan(bars.close[last], ind.atr14[last]) : null;
    ASSETS.set(meta.ticker, { meta, bars, ind, sig, plan, currency: raw.currency });
  });
  await Promise.all(jobs);
  try {   // smart-money enrichment is optional — the app works without it
    F13 = await (await fetch("data/f13.json", { cache: "no-store" })).json();
  } catch { F13 = null; }
  try {   // forward P/E enrichment (Bloomberg via Socinvest) — also optional
    FPE = await (await fetch("data/fpe.json", { cache: "no-store" })).json();
  } catch { FPE = null; }
  for (const a of ASSETS.values()) {
    a.fpe = fpeOf(a.meta.ticker);
    a.ind.fpeZRoll = a.fpe ? fpeRollingZ(a.bars, a.fpe) : null;
  }

  const lastDates = [...ASSETS.values()].map(a => a.bars.date.at(-1)).sort();
  $("#data-status").textContent =
    `EOD data through ${lastDates.at(-1)} · ${ASSETS.size}/${MANIFEST.assets.length} assets · refreshed ${MANIFEST.fetched_at.replace("T", " ").replace("Z", " UTC")}`;
}

const perf = (bars, days) => {
  const n = bars.close.length;
  return n > days ? (bars.close[n - 1] / bars.close[n - 1 - days] - 1) * 100 : null;
};

// ---------------------------------------------------------------- alerts

function generateAlerts() {
  // Baseline-compare: only emit alerts for state CHANGES since the last visit
  // (first visit stores the baseline silently — no fake "news").
  const seen = store.load("lastSeen", null);
  const next = {};
  const fresh = [];
  const nowTs = Date.now();

  for (const [ticker, a] of ASSETS) {
    const i = a.bars.close.length - 1;
    const r = a.ind.rsi14[i];
    const h = a.ind.macd.hist[i];
    const volRatio = a.ind.volAvg20[i] > 0 ? (a.bars.volume[i] || 0) / a.ind.volAvg20[i] : null;
    const z = a.ind.mm200.z;
    const state = {
      date: a.bars.date[i],
      action: a.sig.action, strength: a.sig.strength,
      rsiZone: r === null ? null : r >= 70 ? "hi" : r <= 30 ? "lo" : "mid",
      macdSign: h === null ? null : h >= 0 ? 1 : -1,
      mmZone: z === null ? null : z <= -1 ? "lo" : z >= 1 ? "hi" : "mid",
      fpeZone: a.fpe?.z == null ? null : a.fpe.z <= -1 ? "lo" : a.fpe.z >= 1 ? "hi" : "mid",
      quad: (() => { const q = a.fpe ? quadrantVerdict(z, a.fpe.z) : null;
        return q && q.cls !== "HOLD" ? q.label : null; })(),
    };
    next[ticker] = state;
    const prev = seen?.[ticker];
    if (!prev || prev.date === state.date) continue; // first run or same bar

    if (state.action !== "HOLD" && state.action !== prev.action)
      fresh.push({ ticker, type: "signal", msg: `${ticker}: new ${state.action} signal (${state.strength}, ${a.sig.confidence}% confidence)` });
    if (state.rsiZone === "hi" && prev.rsiZone !== "hi")
      fresh.push({ ticker, type: "rsi", msg: `${ticker}: RSI crossed above 70 (${r.toFixed(1)}) — overbought` });
    if (state.rsiZone === "lo" && prev.rsiZone !== "lo")
      fresh.push({ ticker, type: "rsi", msg: `${ticker}: RSI crossed below 30 (${r.toFixed(1)}) — oversold` });
    if (state.macdSign !== null && prev.macdSign !== null && state.macdSign !== prev.macdSign)
      fresh.push({ ticker, type: "macd", msg: `${ticker}: MACD histogram flipped ${state.macdSign > 0 ? "positive" : "negative"}` });
    if (volRatio !== null && volRatio > 2)
      fresh.push({ ticker, type: "volume", msg: `${ticker}: volume spike ${volRatio.toFixed(1)}× the 20-day average` });
    if (state.mmZone === "lo" && prev.mmZone !== "lo" && prev.mmZone !== null)
      fresh.push({ ticker, type: "mm200", msg: `${ticker}: dropped 1σ below its MM200 ruler (z=${z.toFixed(2)}) — depressed zone` });
    if (state.mmZone === "hi" && prev.mmZone !== "hi" && prev.mmZone !== null)
      fresh.push({ ticker, type: "mm200", msg: `${ticker}: stretched 1σ above its MM200 ruler (z=${z.toFixed(2)})` });
    if (state.fpeZone === "lo" && prev.fpeZone !== "lo" && prev.fpeZone != null)
      fresh.push({ ticker, type: "fpe", msg: `${ticker}: forward P/E dropped 1σ below its own history (z=${a.fpe.z.toFixed(2)}) — multiple cheap` });
    if (state.fpeZone === "hi" && prev.fpeZone !== "hi" && prev.fpeZone != null)
      fresh.push({ ticker, type: "fpe", msg: `${ticker}: forward P/E stretched 1σ above its own history (z=${a.fpe.z.toFixed(2)})` });
    if (state.quad && state.quad !== prev.quad && prev.quad !== undefined)
      fresh.push({ ticker, type: "quadrant", msg: `${ticker}: entered "${state.quad}" quadrant (MM200 × forward P/E)` });
  }
  store.save("lastSeen", next);

  if (fresh.length) {
    const alerts = store.load("alerts", []);
    for (const f of fresh) alerts.unshift({ id: nowTs + Math.random(), ts: nowTs, read: false, ...f });
    store.save("alerts", alerts.slice(0, 300));
    for (const f of fresh.slice(0, 4)) toast(f.msg);
    if (fresh.length > 4) toast(`…and ${fresh.length - 4} more alerts`);
    notifyDesktop(fresh);
  }
  refreshAlertBadge();
}

function pushAlert(ticker, type, msg) {
  const alerts = store.load("alerts", []);
  alerts.unshift({ id: Date.now() + Math.random(), ts: Date.now(), read: false, ticker, type, msg });
  store.save("alerts", alerts.slice(0, 300));
  toast(msg);
  refreshAlertBadge();
}

function refreshAlertBadge() {
  const unread = store.load("alerts", []).filter(a => !a.read).length;
  const b = $("#alert-badge");
  b.textContent = unread;
  b.classList.toggle("hidden", unread === 0);
}

function notifyDesktop(items) {
  if (!store.settings().desktopNotifications) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  new Notification("Watchlist Momentum — Socinvest",
    { body: items.slice(0, 3).map(i => i.msg).join("\n") });
}

// ---------------------------------------------------------------- signals tab

let sortState = { key: "conf", dir: -1 };
let signalFilter = { text: "", watchlist: "" };

function rowData() {
  return [...ASSETS.values()].map(a => {
    const i = a.bars.close.length - 1;
    return {
      ticker: a.meta.ticker, name: a.meta.name, sector: a.meta.sector,
      close: a.bars.close[i], ccy: a.currency,
      d1: perf(a.bars, 1), m1: perf(a.bars, 21), m3: perf(a.bars, 63),
      rsi: a.ind.rsi14[i], macdH: a.ind.macd.hist[i], mmz: a.ind.mm200.z,
      fpeZ: a.fpe ? a.fpe.z : null,
      f13: f13Of(a.meta.ticker),
      sig: a.sig, conf: a.sig.action === "HOLD" ? 0 : a.sig.confidence,
      a,
    };
  });
}

function renderSignals() {
  const el = $("#tab-signals");
  const rows = rowData();
  const settingsV = store.settings();

  // ---- summary cards
  const buys = rows.filter(r => r.sig.action === "BUY").sort((x, y) => y.conf - x.conf);
  const sells = rows.filter(r => r.sig.action === "SELL").sort((x, y) => y.conf - x.conf);
  const paper = paperState();
  const paperEq = paperEquity(paper);
  const pf = portfolioSummary();
  const sectors = sectorPerf();
  const bestSector = sectors.filter(s => s.sector !== "Indices").sort((a, b) => (b.m1 ?? -1e9) - (a.m1 ?? -1e9))[0];
  const unread = store.load("alerts", []).filter(x => !x.read).length;
  const unavailable = MANIFEST.assets.filter(a => !a.available);

  el.innerHTML = `
    ${helpPanel("signals")}
    ${unavailable.length ? `<div class="banner">⚠ ${unavailable.map(u =>
      `<strong>${esc(u.ticker)}</strong> has no data source — ${esc(u.note || u.reason)}`).join(" · ")}</div>` : ""}
    <div class="cards">
      <div class="card"><div class="k">Top BUY signals</div>
        <div class="v">${buys.length ? buys.slice(0, 3).map(b => b.ticker).join(", ") : "none"}</div>
        <div class="s">${buys.length} BUY / ${sells.length} SELL today</div></div>
      <div class="card"><div class="k">Paper trading</div>
        <div class="v ${pctCls(paperEq - settingsV.paperCapital)}">$${fmtN(paperEq)}</div>
        <div class="s">${paper.positions.length} open · ${fmtPct((paperEq / paper.startCapital - 1) * 100)} since start</div></div>
      <div class="card"><div class="k">Portfolio</div>
        <div class="v">${pf.count ? "$" + fmtN(pf.value) : "—"}</div>
        <div class="s">${pf.count ? `${pf.count} positions · ${fmtPct(pf.pnlPct)} P&L` : "no positions yet"}</div></div>
      <div class="card"><div class="k">Sector leader (1M)</div>
        <div class="v">${bestSector ? esc(bestSector.sector) : "—"}</div>
        <div class="s">${bestSector ? fmtPct(bestSector.m1) + " · led by " + bestSector.leader : ""}</div></div>
      <div class="card"><div class="k">Alerts</div>
        <div class="v">${unread}</div><div class="s">unread — see Alerts tab</div></div>
    </div>

    <div class="panel">
      <div class="controls">
        <label class="f">Filter<input id="sig-filter" placeholder="ticker / name / sector" value="${esc(signalFilter.text)}"></label>
        <label class="f">Watchlist<select id="sig-wl">
          <option value="">All assets</option>
          ${watchlists().map(w => `<option value="${w.id}" ${signalFilter.watchlist === w.id ? "selected" : ""}>${esc(w.name)}</option>`).join("")}
        </select></label>
        <span class="pill">signal = ≥3 of 6 indicators aligned · STRONG 6 · MEDIUM 4-5 · WEAK 3</span>
      </div>
      <div class="tablewrap"><table id="sig-table">
        <thead><tr>
          <th class="l" data-k="ticker">Ticker</th><th class="l" data-k="name">Name</th>
          <th data-k="close">Close</th><th data-k="d1">1D</th><th data-k="m1">1M</th><th data-k="m3">3M</th>
          <th data-k="rsi">RSI</th><th data-k="macdH">MACD-H</th>
          <th data-k="mmz" title="Distance from the 200-day average, in standard deviations of the asset's own history (Socinvest ruler)">MM200 σ</th>
          <th data-k="fpeZ" title="Forward P/E vs the asset's own history, in standard deviations (Bloomberg weekly series via Socinvest). ≤ −1σ = multiple historically cheap; ≥ +1σ = expensive.">P/E fwd σ</th>
          <th data-k="f13" title="How many of the 38 tracked 13F managers held this stock at the last disclosed quarter; ▲/▼ = net adds/trims that quarter. 13F data lags up to 45 days.">13F</th>
          <th>Votes</th><th data-k="sigact">Signal</th><th data-k="conf">Conf.</th>
          <th>6M</th><th></th>
        </tr></thead><tbody></tbody>
      </table></div>
    </div>`;

  const tbody = el.querySelector("#sig-table tbody");
  const wl = watchlists().find(w => w.id === signalFilter.watchlist);
  let list = rows;
  if (wl) list = list.filter(r => wl.tickers.includes(r.ticker));
  const q = signalFilter.text.toLowerCase();
  if (q) list = list.filter(r =>
    r.ticker.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.sector.toLowerCase().includes(q));

  const keyFn = {
    ticker: r => r.ticker, name: r => r.name, close: r => r.close,
    d1: r => r.d1 ?? -1e9, m1: r => r.m1 ?? -1e9, m3: r => r.m3 ?? -1e9,
    rsi: r => r.rsi ?? -1, macdH: r => r.macdH ?? -1e9, mmz: r => r.mmz ?? -1e9,
    fpeZ: r => r.fpeZ ?? -1e9,
    f13: r => r.f13 ? r.f13.holders + f13Net(r.f13) / 100 : -1,
    sigact: r => r.sig.action, conf: r => r.conf,
  }[sortState.key] || (r => r.conf);
  list = [...list].sort((a, b) => {
    const x = keyFn(a), y = keyFn(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sortState.dir;
  });

  tbody.innerHTML = list.map(r => {
    const dots = r.sig.votes.map(v =>
      `<span class="vote ${v === 1 ? "b" : v === -1 ? "s" : ""}"></span>`).join("");
    const spark = sparkline(r.a.bars.close.slice(-126));
    return `<tr class="clickable" data-t="${r.ticker}">
      <td class="l"><strong>${r.ticker}</strong></td>
      <td class="l muted">${esc(r.name)}</td>
      <td>${ccySym(r.ccy)}${fmtN(r.close)}</td>
      <td class="${pctCls(r.d1)}">${fmtPct(r.d1)}</td>
      <td class="${pctCls(r.m1)}">${fmtPct(r.m1)}</td>
      <td class="${pctCls(r.m3)}">${fmtPct(r.m3)}</td>
      <td>${fmtN(r.rsi, 1)}</td>
      <td class="${pctCls(r.macdH)}">${fmtN(r.macdH, 2)}</td>
      <td class="${r.mmz === null ? "" : r.mmz <= -1 ? "pos" : r.mmz >= 1 ? "neg" : "muted"}">${fmtN(r.mmz, 2)}</td>
      <td class="${r.fpeZ === null ? "muted" : r.fpeZ <= -1 ? "pos" : r.fpeZ >= 1 ? "neg" : "muted"}">${fmtN(r.fpeZ, 2)}</td>
      <td class="${!r.f13 ? "muted" : f13Net(r.f13) > 0 ? "pos" : f13Net(r.f13) < 0 ? "neg" : "muted"}">${r.f13 ? r.f13.holders + (f13Net(r.f13) > 0 ? " ▲" : f13Net(r.f13) < 0 ? " ▼" : "") : "—"}</td>
      <td><span class="votes">${dots}</span></td>
      <td><span class="sig ${r.sig.action}">${r.sig.action}${r.sig.strength ? " · " + r.sig.strength : ""}</span></td>
      <td>${r.sig.action === "HOLD" ? "—" : r.conf + "%"}</td>
      <td>${spark}</td>
      <td>${r.sig.action === "BUY"
        ? `<button class="btn small paper-buy" data-t="${r.ticker}">Paper buy</button>` : ""}</td>
    </tr>`;
  }).join("");

  el.querySelectorAll("th[data-k]").forEach(th => th.onclick = () => {
    const k = th.dataset.k;
    sortState = { key: k, dir: sortState.key === k ? -sortState.dir : -1 };
    renderSignals();
  });
  $("#sig-filter").oninput = e => { signalFilter.text = e.target.value; renderSignals(); };
  $("#sig-wl").onchange = e => { signalFilter.watchlist = e.target.value; renderSignals(); };
  tbody.querySelectorAll("tr").forEach(tr => tr.onclick = e => {
    if (e.target.closest(".paper-buy")) return;
    openDetail(tr.dataset.t);
  });
  tbody.querySelectorAll(".paper-buy").forEach(b => b.onclick = () => paperBuy(b.dataset.t));
}

// ---------------------------------------------------------------- detail modal

function openDetail(ticker) {
  const a = ASSETS.get(ticker);
  if (!a) return;
  const i = a.bars.close.length - 1;
  const sym = ccySym(a.currency);
  const plan = tradePlan(a.bars.close[i], a.ind.atr14[i]);
  const s = store.settings();
  const frac = a.meta.group === "index";
  const size = plan ? positionSize(s.paperCapital, s.riskPct, plan, frac) : 0;
  const unit = frac ? "units" : "sh";

  const voteRows = a.sig.votes.map((v, k) =>
    `<tr><td class="l">${VOTE_NAMES[k]}</td>
     <td>${v === 1 ? '<span class="pos">bullish</span>' : v === -1 ? '<span class="neg">bearish</span>' : '<span class="muted">neutral</span>'}</td></tr>`).join("");

  showModal(`
    <h2>${ticker} — ${esc(a.meta.name)}
      <span class="sig ${a.sig.action}">${a.sig.action}${a.sig.strength ? " · " + a.sig.strength : ""}</span></h2>
    <div class="muted" style="margin-bottom:8px">${esc(a.meta.sector)} · ${a.currency} · data through ${a.bars.date[i]}
      ${a.meta.note ? `<div class="banner" style="margin-top:6px">${esc(a.meta.note)}</div>` : ""}</div>
    <div class="legend"><span><i style="background:var(--accent)"></i>Close</span>
      <span><i style="background:#e8b53a"></i>SMA20</span><span><i style="background:#b46bef"></i>SMA50</span>
      <span><i style="background:#6b7891"></i>SMA200</span><span><i style="background:rgba(79,140,255,.35)"></i>Bollinger</span></div>
    ${priceChart(a.bars, a.ind, 252)}
    <h3>RSI 14</h3>${rsiChart(a.bars, a.ind, 252)}
    <h3>MACD 12/26/9</h3>${macdChart(a.bars, a.ind, 252)}
    ${mm200Section(a, sym)}
    ${fpeSection(a)}
    ${f13Section(a)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:10px">
      <div><h3>Indicator votes</h3><table>${voteRows}</table></div>
      <div><h3>ATR trade plan (long)</h3>
        ${plan ? `<table>
          <tr><td class="l">Entry (last close)</td><td>${sym}${fmtN(plan.entry)}</td></tr>
          <tr><td class="l">Stop (−2×ATR)</td><td>${sym}${fmtN(plan.stop)}</td></tr>
          <tr><td class="l">Target (+4×ATR)</td><td>${sym}${fmtN(plan.target)}</td></tr>
          <tr><td class="l">ATR 14</td><td>${sym}${fmtN(plan.atr)}</td></tr>
          <tr><td class="l">Size @ ${s.riskPct}% risk of $${fmtN(s.paperCapital, 0)}</td><td>${fmtQty(size)} ${unit}</td></tr>
        </table>` : '<div class="muted">ATR unavailable</div>'}
      </div>
    </div>`);
}

// MM200 distance block inside the detail modal (Socinvest ruler).
function mm200Section(a, sym) {
  const m = a.ind.mm200;
  if (m.mean === null || m.sd === null || m.z === null) return "";
  const i = a.bars.close.length - 1;
  const s200 = a.ind.sma200[i];
  const buyLvl = s200 * (m.mean - m.sd), sellLvl = s200 * (m.mean + m.sd);
  const zone = m.z <= -1 ? '<span class="sig BUY">−1σ zone (depressed)</span>'
    : m.z >= 1 ? '<span class="sig SELL">+1σ zone (stretched)</span>'
    : '<span class="sig HOLD">inside the band</span>';
  const years = ((a.bars.close.length - 200) / 252).toFixed(1);
  return `
    <h3>MM200 distance — price vs its own 200-day average ${zone}</h3>
    ${mm200Chart(a.bars, a.ind, a.bars.close.length)}
    <div class="muted" style="font-size:12px;margin:4px 0 0">
      Ratio close/SMA200 = <strong>${m.ratio[i].toFixed(3)}</strong> ·
      historical mean ${m.mean.toFixed(3)} ± ${m.sd.toFixed(3)} (1σ) ·
      z-score = <strong>${m.z.toFixed(2)}</strong>.
      At today's SMA200, −1σ ≈ ${sym}${fmtN(buyLvl)} and +1σ ≈ ${sym}${fmtN(sellLvl)}.
      Ruler built from ~${years}y of this asset's own ratio history — trending assets can
      still stay beyond ±1σ for months; backtest "MM200 Reversion" before trusting the rule here.
    </div>`;
}

// Forward P/E block inside the detail modal, incl. the quadrant verdict.
function fpeSection(a) {
  const e = a.fpe;
  if (!e || e.z === null) return "";
  const zone = e.z <= -1 ? '<span class="sig BUY">−1σ (multiple cheap)</span>'
    : e.z >= 1 ? '<span class="sig SELL">+1σ (multiple expensive)</span>'
    : '<span class="sig HOLD">inside the band</span>';
  const v = quadrantVerdict(a.ind.mm200.z, e.z);
  return `
    <h3>Forward P/E — multiple vs its rolling 3-year window ${zone}</h3>
    ${fpeChart(e)}
    <div class="muted" style="font-size:12px;margin:4px 0 0">
      Forward P/E = <strong>${e.last.toFixed(1)}×</strong> (${e.last_date}) ·
      rolling 3y median ${e.mean.toFixed(1)} · ±1σ (P16/P84) ${e.p16.toFixed(1)} / ${e.p84.toFixed(1)}
      over the last ${e.window_weeks} weeks ·
      z-score = <strong>${e.z.toFixed(2)}</strong>.
      ${e.window_weeks < 52 ? "<strong>Short history — this ruler is still forming (under a year of data); read its z with extra suspicion.</strong>" : ""}
      Same ruler as the Socinvest chart (rolling window, percentile bands): "cheap" means cheap vs the
      current regime, not vs a decade-old panic. Bloomberg series via the Socinvest project; the denominator
      is <em>projected</em> consensus earnings — the z moves on estimate revisions, not only on price.
    </div>
    ${v ? (() => {
      const pos = quadrantPosition(a.ind.mm200.z, e.z);
      return `<div class="banner" style="margin-top:10px">
      <div><strong>Quadrant position:</strong> <em>${pos.label}</em>
        — MM200 ${fmtN(a.ind.mm200.z, 2)}σ${pos.pBorder ? " (borderline)" : ""}
        × Fwd P/E ${fmtN(e.z, 2)}σ${pos.eBorder ? " (borderline)" : ""}.
        <span class="muted">Sign-based, as in the Socinvest scatter — location, not strength.</span></div>
      <div style="margin-top:6px"><span class="sig ${v.cls}">${v.label}</span>&nbsp; ${v.text}
        Backtest "Double Depression" on this asset to see how the buy quadrant actually paid.</div>
    </div>`; })() : ""}`;
}

// Smart-money (13F) block inside the detail modal.
function f13Section(a) {
  const e = f13Of(a.meta.ticker);
  if (!e || !F13) return "";
  const net = f13Net(e);
  const actCls = { opened: "pos", increased: "pos", decreased: "neg", closed: "neg", held: "muted" };
  const rows = e.managers.map(m => `<tr>
    <td class="l">${esc(m.name)}</td>
    <td>${m.pct === null ? "—" : (m.pct * 100).toFixed(1) + "% of book"}</td>
    <td class="l ${actCls[m.action] || "muted"}">${m.action}</td></tr>`).join("");
  return `
    <h3>Smart money — 13F holders as of ${F13.as_of}
      <span class="pill">${e.holders} of ${F13.managers_tracked} managers</span>
      ${net ? `<span class="${net > 0 ? "pos" : "neg"}">net ${net > 0 ? "+" : ""}${net} last quarter</span>` : ""}</h3>
    <div class="tablewrap"><table>
      <thead><tr><th class="l">Manager</th><th>Position weight</th><th class="l">Last quarter</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="muted" style="font-size:12px;margin:4px 0 0">
      Source: SEC 13F-HR filings via the 13-Files project. Disclosed up to <strong>45 days after</strong>
      quarter end — these positions may already have changed. Long US-equity positions only.
    </div>`;
}

// ---------------------------------------------------------------- backtest tab

function renderBacktest() {
  const el = $("#tab-backtest");
  const tickers = [...ASSETS.keys()];
  el.innerHTML = `
    ${helpPanel("backtest")}
    <div class="panel">
      <div class="controls">
        <label class="f">Asset<select id="bt-ticker">${tickers.map(t => `<option>${t}</option>`).join("")}</select></label>
        <label class="f">Strategy<select id="bt-strategy">${Object.entries(STRATEGIES).map(([k, s]) =>
          `<option value="${k}">${s.label}</option>`).join("")}</select></label>
        <label class="f">Window<select id="bt-days">
          <option value="90">90 days</option><option value="180" selected>180 days</option>
          <option value="250">1 year</option><option value="500">2 years</option>
          <option value="1250">5 years</option></select></label>
        <label class="f">Capital $<input id="bt-capital" type="number" value="10000" min="100" style="width:90px"></label>
        <label class="f">Risk %<input id="bt-risk" type="number" value="2" min="0.25" max="10" step="0.25" style="width:70px"></label>
        <label class="f">Fee/trade $<input id="bt-fee" type="number" value="0" min="0" step="0.5" style="width:70px"></label>
        <button class="btn" id="bt-run">Run backtest</button>
      </div>
      <div class="muted" id="bt-desc"></div>
    </div>
    <div id="bt-out"></div>`;

  const descr = () => { $("#bt-desc").textContent = STRATEGIES[$("#bt-strategy").value].describe; };
  // strategies that need forward P/E coverage are disabled for assets without it
  const gateOptions = () => {
    const a = ASSETS.get($("#bt-ticker").value);
    [...$("#bt-strategy").options].forEach(o => {
      const s = STRATEGIES[o.value];
      o.disabled = s.requires === "fpe" && !a.ind.fpeZRoll;
      o.textContent = s.label + (o.disabled ? " (no fwd P/E data)" : "");
    });
    if ($("#bt-strategy").selectedOptions[0]?.disabled) $("#bt-strategy").value = "momentum";
    descr();
  };
  $("#bt-strategy").onchange = descr;
  $("#bt-ticker").onchange = gateOptions;
  gateOptions();
  $("#bt-run").onclick = () => {
    const a = ASSETS.get($("#bt-ticker").value);
    const res = runBacktest(a.bars, a.ind, STRATEGIES[$("#bt-strategy").value], {
      days: +$("#bt-days").value, capital: +$("#bt-capital").value,
      riskPct: +$("#bt-risk").value, fee: +$("#bt-fee").value,
      fractional: a.meta.group === "index",
    });
    $("#bt-out").innerHTML = res ? backtestReport(a, res) : '<div class="panel">Not enough history for this window.</div>';
    const btn = $("#bt-csv");
    if (btn) btn.onclick = () => download(`${a.meta.ticker}_trades.csv`, tradesToCsv(res.trades), "text/csv");
  };
}

function metricCards(m, extra = "") {
  const item = (k, v, cls = "") => `<div class="card"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`;
  return `<div class="cards">
    ${item("Trades", m.trades)}
    ${item("Win rate", m.winRate === null ? "—" : m.winRate.toFixed(0) + "%")}
    ${item("Return", fmtPct(m.totalReturnPct), pctCls(m.totalReturnPct))}
    ${item("Buy & hold", fmtPct(m.buyHoldReturnPct), pctCls(m.buyHoldReturnPct))}
    ${item("Profit factor", m.profitFactor === null ? "—" : m.profitFactor === Infinity ? "∞" : m.profitFactor.toFixed(2))}
    ${item("Max drawdown", "−" + m.maxDrawdownPct.toFixed(1) + "%", "neg")}
    ${item("Sharpe (ann.)", m.sharpe === null ? "—" : m.sharpe.toFixed(2))}
    ${extra}
  </div>`;
}

function backtestReport(a, res) {
  const sym = ccySym(a.currency);
  const rows = res.trades.map(t => `<tr>
    <td class="l">${t.entryDate}</td><td>${sym}${fmtN(t.entryPrice)}</td>
    <td class="l">${t.exitDate}</td><td>${sym}${fmtN(t.exitPrice)}</td>
    <td>${fmtQty(t.shares)}</td><td class="${pctCls(t.pnl)}">$${fmtN(t.pnl)}</td>
    <td class="${pctCls(t.pnlPct)}">${fmtPct(t.pnlPct)}</td><td class="l">${t.reason}</td></tr>`).join("");
  return `
    ${metricCards(res.metrics)}
    <div class="panel"><h3>Equity curve ($${fmtN(res.capital0, 0)} start)</h3>
      ${equityChart(res.equity, res.equityDates, res.capital0)}</div>
    <div class="panel"><h3>Trades ${res.trades.length ? `<button class="btn small ghost" id="bt-csv">Export CSV</button>` : ""}</h3>
      ${res.openPosition ? `<div class="banner">Position still open at window end: ${fmtQty(res.openPosition.shares)} from ${res.openPosition.entryDate} @ ${sym}${fmtN(res.openPosition.entryPrice)} (unrealized $${fmtN(res.openPosition.unrealizedPnl)}) — not counted in trade stats.</div>` : ""}
      <div class="tablewrap"><table>
        <thead><tr><th class="l">Entry</th><th>Price</th><th class="l">Exit</th><th>Price</th><th>Sh</th><th>P&L</th><th>%</th><th class="l">Reason</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="muted l">no closed trades in this window</td></tr>'}</tbody>
      </table></div></div>`;
}

// ---------------------------------------------------------------- strategies tab

function renderStrategies() {
  const el = $("#tab-strategies");
  const tickers = [...ASSETS.keys()];
  el.innerHTML = `
    ${helpPanel("strategies")}
    <div class="panel">
      <div class="controls">
        <label class="f">Asset<select id="st-ticker">${tickers.map(t => `<option>${t}</option>`).join("")}</select></label>
        <label class="f">Window<select id="st-days">
          <option value="90">90 days</option><option value="180" selected>180 days</option>
          <option value="250">1 year</option><option value="500">2 years</option>
          <option value="1250">5 years</option></select></label>
        <button class="btn" id="st-run">Compare strategies</button>
        <span class="pill">Dividend Growth from the original spec is omitted: the free EOD source has no dividend history — we don't fabricate inputs.</span>
      </div>
    </div>
    <div id="st-out"></div>`;

  $("#st-run").onclick = () => {
    const a = ASSETS.get($("#st-ticker").value);
    const days = +$("#st-days").value;
    const available = Object.entries(STRATEGIES)
      .filter(([, s]) => !(s.requires === "fpe" && !a.ind.fpeZRoll));
    const skippedNote = available.length < Object.keys(STRATEGIES).length
      ? `<div class="muted" style="margin-top:8px">Fwd P/E strategies skipped: no Bloomberg forward P/E coverage for ${a.meta.ticker}.</div>` : "";
    const results = available.map(([k, s]) =>
      ({ key: k, label: s.label,
         res: runBacktest(a.bars, a.ind, s, { days, fractional: a.meta.group === "index" }) }))
      .filter(r => r.res);

    // equal-weight ensemble: capital split across the three active strategies
    const active = results.filter(r => r.key !== "buyHold");
    let ensembleRow = "";
    if (active.length > 1) {
      const len = Math.min(...active.map(r => r.res.equity.length));
      const eq = Array.from({ length: len }, (_, i) =>
        active.reduce((s, r) => s + r.res.equity[r.res.equity.length - len + i] / active.length, 0));
      const ret = (eq[eq.length - 1] / eq[0] - 1) * 100;
      let peak = -Infinity, dd = 0;
      for (const e of eq) { peak = Math.max(peak, e); dd = Math.max(dd, (peak - e) / peak); }
      ensembleRow = `<tr><td class="l"><strong>Equal-weight ensemble</strong> <span class="muted">(1/${active.length} in each active strategy)</span></td>
        <td>—</td><td>—</td><td>—</td><td class="${pctCls(ret)}">${fmtPct(ret)}</td><td>—</td>
        <td class="neg">−${(dd * 100).toFixed(1)}%</td><td>—</td></tr>`;
    }

    $("#st-out").innerHTML = `<div class="panel"><div class="tablewrap"><table>
      <thead><tr><th class="l">Strategy</th>
        <th title="Finished round-trips — the only trades counted in win rate and profit factor">Closed</th>
        <th title="Position still riding at the window's end; its unrealized return and entry date are shown. Mark-to-market, not banked profit — it IS included in Return.">Open</th>
        <th>Win rate</th><th>Return</th>
        <th>Profit factor</th><th>Max DD</th><th>Sharpe</th></tr></thead>
      <tbody>${results.map(r => { const m = r.res.metrics; const op = r.res.openPosition;
        const opCell = op
          ? `1 <span class="muted">(${fmtPct((op.lastPrice / op.entryPrice - 1) * 100)} since ${op.entryDate})</span>`
          : '<span class="muted">0</span>';
        return `<tr>
        <td class="l">${r.label}</td><td>${m.trades}</td>
        <td style="white-space:nowrap">${opCell}</td>
        <td>${m.winRate === null ? "—" : m.winRate.toFixed(0) + "%"}</td>
        <td class="${pctCls(m.totalReturnPct)}">${fmtPct(m.totalReturnPct)}</td>
        <td>${m.profitFactor === null ? "—" : m.profitFactor === Infinity ? "∞" : m.profitFactor.toFixed(2)}</td>
        <td class="neg">−${m.maxDrawdownPct.toFixed(1)}%</td>
        <td>${m.sharpe === null ? "—" : m.sharpe.toFixed(2)}</td></tr>`; }).join("")}
      ${ensembleRow}</tbody></table></div>
      <div class="muted" style="margin-top:8px">Same engine, same window, same no-lookahead execution for every strategy. A strategy that doesn't beat Buy & Hold after drawdown isn't earning its complexity.</div>
      ${skippedNote}
    </div>`;
  };
}

// ---------------------------------------------------------------- paper trading

function paperState() {
  const s = store.settings();
  return store.load("paper", {
    startCapital: s.paperCapital, cash: s.paperCapital,
    startDate: todayIso(), positions: [], history: [],
  });
}

function paperEquity(p) {
  return p.cash + p.positions.reduce((sum, pos) => {
    const a = ASSETS.get(pos.ticker);
    return sum + (a ? pos.shares * a.bars.close.at(-1) : pos.shares * pos.entry);
  }, 0);
}

function paperBuy(ticker) {
  const a = ASSETS.get(ticker);
  if (!a) return;
  const p = paperState();
  const s = store.settings();
  const i = a.bars.close.length - 1;
  const plan = tradePlan(a.bars.close[i], a.ind.atr14[i]);
  if (!plan) { toast("ATR unavailable for " + ticker, "bad"); return; }
  if (p.positions.some(x => x.ticker === ticker)) { toast(ticker + " already open in paper account", "bad"); return; }
  const frac = a.meta.group === "index";
  const qty = positionSize(Math.min(p.cash, paperEquity(p)), s.riskPct, plan, frac);
  if (qty <= 0 || qty * plan.entry > p.cash) {
    toast(`Not enough paper cash for ${frac ? "a fraction" : "1 share"} of ${ticker}`, "bad");
    return;
  }
  p.cash -= qty * plan.entry;
  p.positions.push({
    id: Date.now() + Math.random(), ticker, shares: qty,
    entry: plan.entry, stop: plan.stop, target: plan.target,
    entryDate: a.bars.date[i], signalConfidence: a.sig.confidence,
  });
  store.save("paper", p);
  toast(`Paper BUY ${fmtQty(qty)} ${ticker} @ ${fmtN(plan.entry)} (stop ${fmtN(plan.stop)}, target ${fmtN(plan.target)})`, "good");
  renderActive();
}

function paperCheckStops() {
  // EOD simulator: on each new dataset, replay bars since entry and honor
  // stop/target (stop first when both are inside one bar — conservative).
  const p = paperState();
  let changed = false;
  p.positions = p.positions.filter(pos => {
    const a = ASSETS.get(pos.ticker);
    if (!a) return true;
    const from = a.bars.date.findIndex(d => d > pos.entryDate);
    if (from === -1) return true;
    for (let i = from; i < a.bars.close.length; i++) {
      const lo = a.bars.low[i] ?? a.bars.close[i];
      const hi = a.bars.high[i] ?? a.bars.close[i];
      let exit = null, reason = null;
      if (lo <= pos.stop) { exit = pos.stop; reason = "stop"; }
      else if (hi >= pos.target) { exit = pos.target; reason = "target"; }
      if (exit !== null) {
        p.cash += pos.shares * exit;
        p.history.unshift({ ...pos, exitDate: a.bars.date[i], exit, reason,
          pnl: (exit - pos.entry) * pos.shares });
        pushAlert(pos.ticker, "paper",
          `${pos.ticker}: paper position hit ${reason} @ ${fmtN(exit)} (${fmtPct((exit / pos.entry - 1) * 100)})`);
        changed = true;
        return false;
      }
    }
    return true;
  });
  if (changed) store.save("paper", p);
}

function paperClose(id) {
  const p = paperState();
  const pos = p.positions.find(x => x.id === id);
  if (!pos) return;
  const a = ASSETS.get(pos.ticker);
  const price = a.bars.close.at(-1);
  p.cash += pos.shares * price;
  p.positions = p.positions.filter(x => x.id !== id);
  p.history.unshift({ ...pos, exitDate: a.bars.date.at(-1), exit: price,
    reason: "manual", pnl: (price - pos.entry) * pos.shares });
  store.save("paper", p);
  toast(`Closed ${pos.ticker} @ ${fmtN(price)}`, "good");
  renderActive();
}

function renderPaper() {
  const el = $("#tab-paper");
  const p = paperState();
  const eq = paperEquity(p);
  const realized = p.history.reduce((s, h) => s + h.pnl, 0);
  const wins = p.history.filter(h => h.pnl > 0).length;

  // benchmark: SPX over the same period as the paper account
  let benchTxt = "—";
  const spx = ASSETS.get("SPX");
  if (spx) {
    const i0 = spx.bars.date.findIndex(d => d >= p.startDate);
    if (i0 > -1 && i0 < spx.bars.close.length - 1) {
      const b = (spx.bars.close.at(-1) / spx.bars.close[i0] - 1) * 100;
      benchTxt = `S&P 500 over the same period: ${fmtPct(b)}`;
    }
  }

  const posRows = p.positions.map(pos => {
    const a = ASSETS.get(pos.ticker);
    const last = a ? a.bars.close.at(-1) : pos.entry;
    const pnl = (last - pos.entry) * pos.shares;
    return `<tr>
      <td class="l"><strong>${pos.ticker}</strong></td><td>${pos.entryDate}</td>
      <td>${fmtQty(pos.shares)}</td><td>${fmtN(pos.entry)}</td><td>${fmtN(last)}</td>
      <td>${fmtN(pos.stop)}</td><td>${fmtN(pos.target)}</td>
      <td class="${pctCls(pnl)}">$${fmtN(pnl)} (${fmtPct((last / pos.entry - 1) * 100)})</td>
      <td><button class="btn small ghost pc" data-id="${pos.id}">Close</button></td></tr>`;
  }).join("");

  const histRows = p.history.slice(0, 50).map(h => `<tr>
    <td class="l">${h.ticker}</td><td>${h.entryDate}</td><td>${h.exitDate}</td>
    <td>${fmtQty(h.shares)}</td><td>${fmtN(h.entry)}</td><td>${fmtN(h.exit)}</td>
    <td class="l">${h.reason}</td><td class="${pctCls(h.pnl)}">$${fmtN(h.pnl)}</td></tr>`).join("");

  el.innerHTML = `
    ${helpPanel("paper")}
    <div class="cards">
      <div class="card"><div class="k">Equity</div><div class="v">$${fmtN(eq)}</div>
        <div class="s ${pctCls(eq - p.startCapital)}">${fmtPct((eq / p.startCapital - 1) * 100)} since ${p.startDate}</div></div>
      <div class="card"><div class="k">Cash</div><div class="v">$${fmtN(p.cash)}</div></div>
      <div class="card"><div class="k">Realized P&L</div><div class="v ${pctCls(realized)}">$${fmtN(realized)}</div>
        <div class="s">${p.history.length} closed · ${p.history.length ? Math.round(100 * wins / p.history.length) + "% wins" : "—"}</div></div>
      <div class="card"><div class="k">Benchmark</div><div class="v" style="font-size:14px">${benchTxt}</div>
        <div class="s">a strategy must beat doing nothing</div></div>
    </div>
    <div class="panel"><h3>Open positions</h3>
      <div class="tablewrap"><table><thead><tr><th class="l">Ticker</th><th>Entry date</th><th>Sh</th>
        <th>Entry</th><th>Last</th><th>Stop</th><th>Target</th><th>Unrealized</th><th></th></tr></thead>
        <tbody>${posRows || '<tr><td colspan="9" class="l muted">none — execute a BUY signal from the Signals tab</td></tr>'}</tbody></table></div>
      <div class="muted" style="margin-top:6px">Fills are simulated at the last EOD close; stops/targets are honored against subsequent daily highs/lows when the dataset refreshes. No intraday fills exist in an EOD system.</div>
    </div>
    <div class="panel"><h3>Closed trades</h3>
      <div class="tablewrap"><table><thead><tr><th class="l">Ticker</th><th>Entry</th><th>Exit date</th>
        <th>Sh</th><th>In</th><th>Out</th><th class="l">Reason</th><th>P&L</th></tr></thead>
        <tbody>${histRows || '<tr><td colspan="8" class="l muted">no closed trades yet</td></tr>'}</tbody></table></div>
    </div>
    <button class="btn danger" id="paper-reset">Reset paper account</button>`;

  el.querySelectorAll(".pc").forEach(b => b.onclick = () => paperClose(+b.dataset.id));
  $("#paper-reset").onclick = () => {
    if (!confirm("Reset the paper account? All simulated positions and history will be erased.")) return;
    store.remove("paper");
    renderActive();
  };
}

// ---------------------------------------------------------------- portfolio

function portfolio() { return store.load("portfolio", []); }

function portfolioSummary() {
  const pf = portfolio();
  let value = 0, cost = 0;
  for (const pos of pf) {
    const a = ASSETS.get(pos.ticker);
    if (!a) continue;
    value += pos.shares * a.bars.close.at(-1);
    cost += pos.shares * pos.cost;
  }
  return { count: pf.length, value, cost,
    pnlPct: cost > 0 ? (value / cost - 1) * 100 : null };
}

function portfolioSeries(pf, window = 120) {
  // Weighted daily return series (static current-value weights). Assets are
  // aligned by position from the series end — a close approximation for
  // same-calendar markets; noted in the UI.
  const rows = pf.map(p => ({ p, a: ASSETS.get(p.ticker) })).filter(x => x.a);
  if (!rows.length) return null;
  const len = Math.min(window, ...rows.map(x => x.a.bars.close.length - 1));
  const values = rows.map(x => x.p.shares * x.a.bars.close.at(-1));
  const total = values.reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  const rets = [];
  for (let k = len; k >= 1; k--) {
    let r = 0;
    rows.forEach((x, j) => {
      const c = x.a.bars.close;
      r += (values[j] / total) * (c[c.length - k] / c[c.length - k - 1] - 1);
    });
    rets.push(r);
  }
  return rets;
}

function renderPortfolio() {
  const el = $("#tab-portfolio");
  const pf = portfolio();
  const sum = portfolioSummary();
  const rets = portfolioSeries(pf);

  let beta = null, sharpe = null;
  const spx = ASSETS.get("SPX");
  if (rets && spx) {
    const c = spx.bars.close;
    const m = [];
    for (let k = rets.length; k >= 1; k--) m.push(c[c.length - k] / c[c.length - k - 1] - 1);
    const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
    const mp = mean(rets), mm = mean(m);
    let cov = 0, varm = 0, varp = 0;
    for (let i = 0; i < rets.length; i++) {
      cov += (rets[i] - mp) * (m[i] - mm);
      varm += (m[i] - mm) ** 2;
      varp += (rets[i] - mp) ** 2;
    }
    beta = varm > 0 ? cov / varm : null;
    const sd = Math.sqrt(varp / rets.length);
    sharpe = sd > 0 ? (mp / sd) * Math.sqrt(252) : null;
  }

  // sector allocation
  const bySector = {};
  for (const pos of pf) {
    const a = ASSETS.get(pos.ticker);
    if (!a) continue;
    bySector[a.meta.sector] = (bySector[a.meta.sector] || 0) + pos.shares * a.bars.close.at(-1);
  }
  const sectorBars = Object.entries(bySector).sort((a, b) => b[1] - a[1]).map(([s, v]) => {
    const w = sum.value > 0 ? v / sum.value * 100 : 0;
    return `<div style="margin:4px 0"><span class="muted" style="display:inline-block;width:110px">${esc(s)}</span>
      <span style="display:inline-block;background:var(--accent);height:10px;border-radius:4px;width:${Math.max(2, w * 2.2)}px;vertical-align:middle"></span>
      ${w.toFixed(1)}%</div>`;
  }).join("");

  const rebalance = Object.entries(bySector).filter(([, v]) => sum.value > 0 && v / sum.value > 0.4)
    .map(([s, v]) => `<div class="banner">⚖ ${esc(s)} is ${(100 * v / sum.value).toFixed(0)}% of the portfolio — consider trimming for diversification.</div>`).join("");

  const rows = pf.map(pos => {
    const a = ASSETS.get(pos.ticker);
    const last = a ? a.bars.close.at(-1) : null;
    const val = last !== null ? pos.shares * last : null;
    const pnl = last !== null ? (last - pos.cost) * pos.shares : null;
    return `<tr>
      <td class="l"><strong>${esc(pos.ticker)}</strong></td>
      <td>${pos.shares}</td><td>${fmtN(pos.cost)}</td><td>${last === null ? "—" : fmtN(last)}</td>
      <td>${val === null ? "—" : "$" + fmtN(val)}</td>
      <td>${val !== null && sum.value > 0 ? (100 * val / sum.value).toFixed(1) + "%" : "—"}</td>
      <td class="${pctCls(pnl)}">${pnl === null ? "—" : "$" + fmtN(pnl) + " (" + fmtPct(last / pos.cost * 100 - 100) + ")"}</td>
      <td><button class="btn small ghost pf-del" data-id="${pos.id}">✕</button></td></tr>`;
  }).join("");

  el.innerHTML = `
    ${helpPanel("portfolio")}
    <div class="cards">
      <div class="card"><div class="k">Market value</div><div class="v">${sum.count ? "$" + fmtN(sum.value) : "—"}</div></div>
      <div class="card"><div class="k">Total P&L</div><div class="v ${pctCls(sum.pnlPct)}">${sum.count ? fmtPct(sum.pnlPct) : "—"}</div>
        <div class="s">vs cost basis</div></div>
      <div class="card"><div class="k">Beta vs S&P 500</div><div class="v">${beta === null ? "—" : beta.toFixed(2)}</div>
        <div class="s">120-day daily returns</div></div>
      <div class="card"><div class="k">Sharpe (ann.)</div><div class="v">${sharpe === null ? "—" : sharpe.toFixed(2)}</div>
        <div class="s">rf=0 assumption</div></div>
    </div>
    ${rebalance}
    <div class="panel">
      <div class="controls">
        <label class="f">Ticker<select id="pf-ticker">${[...ASSETS.keys()].map(t => `<option>${t}</option>`).join("")}</select></label>
        <label class="f">Shares<input id="pf-shares" type="number" min="0.0001" step="any" style="width:90px"></label>
        <label class="f">Cost basis / share<input id="pf-cost" type="number" min="0" step="any" style="width:110px"></label>
        <button class="btn" id="pf-add">Add position</button>
        <button class="btn ghost" id="pf-export">Export CSV</button>
        <label class="btn ghost" style="display:inline-block">Import CSV<input id="pf-import" type="file" accept=".csv" class="hidden"></label>
      </div>
      <div class="tablewrap"><table>
        <thead><tr><th class="l">Ticker</th><th>Shares</th><th>Cost</th><th>Last</th><th>Value</th><th>Weight</th><th>P&L</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="l muted">no positions — add your real holdings above (stored only in this browser)</td></tr>'}</tbody>
      </table></div>
      <div class="muted" style="margin-top:6px">Positions live only in your browser's localStorage — nothing is uploaded anywhere. Beta/Sharpe align series by trading-day offset from today (approximation across mixed calendars).</div>
    </div>
    ${sectorBars ? `<div class="panel"><h3>Sector allocation</h3>${sectorBars}</div>` : ""}`;

  $("#pf-add").onclick = () => {
    const t = $("#pf-ticker").value, sh = +$("#pf-shares").value, c = +$("#pf-cost").value;
    if (!sh || sh <= 0 || !c || c <= 0) { toast("Fill shares and cost basis with positive numbers", "bad"); return; }
    const list = portfolio();
    list.push({ id: Date.now(), ticker: t, shares: sh, cost: c });
    store.save("portfolio", list);
    renderActive();
  };
  el.querySelectorAll(".pf-del").forEach(b => b.onclick = () => {
    store.save("portfolio", portfolio().filter(p => p.id !== +b.dataset.id));
    renderActive();
  });
  $("#pf-export").onclick = () =>
    download("portfolio.csv", "ticker,shares,cost\n" +
      portfolio().map(p => `${p.ticker},${p.shares},${p.cost}`).join("\n"), "text/csv");
  $("#pf-import").onchange = async e => {
    const text = await e.target.files[0].text();
    const list = portfolio();
    let added = 0;
    for (const line of text.split(/\r?\n/).slice(1)) {
      const [t, sh, c] = line.split(",");
      if (t && ASSETS.has(t.trim()) && +sh > 0 && +c > 0) {
        list.push({ id: Date.now() + added, ticker: t.trim(), shares: +sh, cost: +c });
        added++;
      }
    }
    store.save("portfolio", list);
    toast(`Imported ${added} positions`, added ? "good" : "bad");
    renderActive();
  };
}

// ---------------------------------------------------------------- sectors

function sectorPerf() {
  const by = {};
  for (const a of ASSETS.values()) {
    (by[a.meta.sector] ??= []).push(a);
  }
  return Object.entries(by).map(([sector, list]) => {
    const avg = days => {
      const vals = list.map(a => perf(a.bars, days)).filter(v => v !== null);
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    };
    const leader = [...list].sort((x, y) => (perf(y.bars, 21) ?? -1e9) - (perf(x.bars, 21) ?? -1e9))[0];
    const fz = list.map(a => a.fpe?.z).filter(v => v !== null && v !== undefined).sort((x, y) => x - y);
    const fpeMed = fz.length ? fz[Math.floor(fz.length / 2)] : null;
    return { sector, count: list.length, w1: avg(5), m1: avg(21), m3: avg(63),
             leader: leader.meta.ticker, fpeMed, fpeN: fz.length, list };
  });
}

function heatColor(p) {
  if (p === null) return "var(--panel2)";
  const t = Math.max(-8, Math.min(8, p)) / 8; // clamp ±8%
  return t >= 0
    ? `rgba(34,192,122,${0.25 + 0.6 * t})`
    : `rgba(239,85,97,${0.25 + 0.6 * -t})`;
}

function renderSectors() {
  const el = $("#tab-sectors");
  const sectors = sectorPerf().sort((a, b) => (b.m1 ?? -1e9) - (a.m1 ?? -1e9));
  el.innerHTML = `
    ${helpPanel("sectors")}
    <div class="panel"><h3>Sector heatmap — 1-month average performance (click a sector)</h3>
      <div class="heatmap">${sectors.map(s => `
        <div class="tile" style="background:${heatColor(s.m1)}" data-s="${esc(s.sector)}">
          <div class="t">${esc(s.sector)}</div>
          <div class="p">${fmtPct(s.m1)} 1M · ${s.count} assets<br>leader: ${s.leader}</div>
        </div>`).join("")}</div>
    </div>
    <div class="panel"><div class="tablewrap"><table>
      <thead><tr><th class="l">Sector</th><th>Assets</th><th>1W avg</th><th>1M avg</th><th>3M avg</th>
        <th title="Median forward P/E z-score of members with Bloomberg coverage">Fwd P/E σ (med)</th><th class="l">1M leader</th></tr></thead>
      <tbody>${sectors.map(s => `<tr>
        <td class="l">${esc(s.sector)}</td><td>${s.count}</td>
        <td class="${pctCls(s.w1)}">${fmtPct(s.w1)}</td>
        <td class="${pctCls(s.m1)}">${fmtPct(s.m1)}</td>
        <td class="${pctCls(s.m3)}">${fmtPct(s.m3)}</td>
        <td class="${s.fpeMed === null ? "muted" : s.fpeMed <= -1 ? "pos" : s.fpeMed >= 1 ? "neg" : "muted"}">${s.fpeMed === null ? "—" : fmtN(s.fpeMed, 2) + " (" + s.fpeN + ")"}</td>
        <td class="l">${s.leader}</td></tr>`).join("")}</tbody>
    </table></div></div>
    <div id="sector-detail"></div>`;

  el.querySelectorAll(".tile").forEach(t => t.onclick = () => {
    const s = sectors.find(x => x.sector === t.dataset.s);
    $("#sector-detail").innerHTML = `<div class="panel"><h3>${esc(s.sector)} — members</h3>
      <div class="tablewrap"><table>
        <thead><tr><th class="l">Ticker</th><th class="l">Name</th><th>1W</th><th>1M</th><th>3M</th><th>Signal</th></tr></thead>
        <tbody>${s.list.map(a => `<tr class="clickable" data-t="${a.meta.ticker}">
          <td class="l"><strong>${a.meta.ticker}</strong></td><td class="l muted">${esc(a.meta.name)}</td>
          <td class="${pctCls(perf(a.bars, 5))}">${fmtPct(perf(a.bars, 5))}</td>
          <td class="${pctCls(perf(a.bars, 21))}">${fmtPct(perf(a.bars, 21))}</td>
          <td class="${pctCls(perf(a.bars, 63))}">${fmtPct(perf(a.bars, 63))}</td>
          <td><span class="sig ${a.sig.action}">${a.sig.action}</span></td></tr>`).join("")}</tbody>
      </table></div></div>`;
    $("#sector-detail").querySelectorAll("tr.clickable").forEach(tr =>
      tr.onclick = () => openDetail(tr.dataset.t));
  });
}

// ---------------------------------------------------------------- watchlists

const DEFAULT_WATCHLISTS = [
  { id: "day", name: "Day Trading", color: "#ef5561", tickers: [], notes: {} },
  { id: "swing", name: "Swing Trading", color: "#e8b53a", tickers: [], notes: {} },
  { id: "long", name: "Long Term", color: "#22c07a", tickers: [], notes: {} },
  { id: "fav", name: "My Favorites", color: "#4f8cff", tickers: [], notes: {} },
];

function watchlists() { return store.load("watchlists", DEFAULT_WATCHLISTS); }

function renderWatchlists() {
  const el = $("#tab-watchlists");
  const lists = watchlists();
  el.innerHTML = `
    ${helpPanel("watchlists")}
    <div class="panel"><div class="controls">
      <label class="f">New list name<input id="wl-name" placeholder="e.g. Semis"></label>
      <label class="f">Color<input id="wl-color" type="color" value="#4f8cff" style="height:33px"></label>
      <button class="btn" id="wl-create">Create list</button>
      <button class="btn ghost" id="wl-export">Export JSON</button>
      <label class="btn ghost">Import JSON<input id="wl-import" type="file" accept=".json" class="hidden"></label>
      <span class="pill">drag tickers between lists</span>
    </div></div>
    <div class="wl-board">${lists.map(w => `
      <div class="wl" style="border-top-color:${esc(w.color)}" data-id="${esc(w.id)}">
        <strong>${esc(w.name)}</strong>
        <button class="btn small ghost wl-del" data-id="${esc(w.id)}" style="float:right">✕</button>
        <ul data-id="${esc(w.id)}">${w.tickers.map(t => {
          const a = ASSETS.get(t);
          return `<li draggable="true" data-t="${esc(t)}" data-l="${esc(w.id)}">
            <strong>${esc(t)}</strong>
            ${a ? `<span class="sig ${a.sig.action}">${a.sig.action}</span>` : '<span class="pill">n/a</span>'}
            <span class="note" title="${esc(w.notes[t] || "")}">${esc(w.notes[t] || "")}</span>
            <button class="btn small ghost wl-note" data-t="${esc(t)}" data-l="${esc(w.id)}">✎</button>
            <button class="btn small ghost wl-rm" data-t="${esc(t)}" data-l="${esc(w.id)}">✕</button></li>`;
        }).join("")}</ul>
        <div class="controls" style="margin:0">
          <select class="wl-addsel" data-id="${esc(w.id)}">
            ${[...ASSETS.keys()].filter(t => !w.tickers.includes(t)).map(t => `<option>${t}</option>`).join("")}
          </select>
          <button class="btn small wl-add" data-id="${esc(w.id)}">Add</button>
        </div>
      </div>`).join("")}</div>`;

  const saveLists = ls => { store.save("watchlists", ls); renderWatchlists(); };

  $("#wl-create").onclick = () => {
    const name = $("#wl-name").value.trim();
    if (!name) return;
    const ls = watchlists();
    ls.push({ id: "wl" + Date.now(), name, color: $("#wl-color").value, tickers: [], notes: {} });
    saveLists(ls);
  };
  $("#wl-export").onclick = () => download("watchlists.json", JSON.stringify(watchlists(), null, 2), "application/json");
  $("#wl-import").onchange = async e => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (Array.isArray(data)) { saveLists(data); toast("Watchlists imported", "good"); }
    } catch { toast("Invalid JSON file", "bad"); }
  };
  el.querySelectorAll(".wl-del").forEach(b => b.onclick = () => {
    if (!confirm("Delete this watchlist?")) return;
    saveLists(watchlists().filter(w => w.id !== b.dataset.id));
  });
  el.querySelectorAll(".wl-add").forEach(b => b.onclick = () => {
    const ls = watchlists();
    const w = ls.find(x => x.id === b.dataset.id);
    const sel = el.querySelector(`.wl-addsel[data-id="${b.dataset.id}"]`);
    if (sel.value && !w.tickers.includes(sel.value)) w.tickers.push(sel.value);
    saveLists(ls);
  });
  el.querySelectorAll(".wl-rm").forEach(b => b.onclick = () => {
    const ls = watchlists();
    const w = ls.find(x => x.id === b.dataset.l);
    w.tickers = w.tickers.filter(t => t !== b.dataset.t);
    delete w.notes[b.dataset.t];
    saveLists(ls);
  });
  el.querySelectorAll(".wl-note").forEach(b => b.onclick = () => {
    const ls = watchlists();
    const w = ls.find(x => x.id === b.dataset.l);
    const cur = w.notes[b.dataset.t] || "";
    const note = prompt(`Note for ${b.dataset.t}:`, cur);
    if (note === null) return;
    if (note.trim()) w.notes[b.dataset.t] = note.trim(); else delete w.notes[b.dataset.t];
    saveLists(ls);
  });

  // drag & drop between lists
  el.querySelectorAll("li[draggable]").forEach(li => {
    li.ondragstart = e => e.dataTransfer.setData("text/plain",
      JSON.stringify({ t: li.dataset.t, from: li.dataset.l }));
  });
  el.querySelectorAll(".wl ul").forEach(ul => {
    ul.ondragover = e => { e.preventDefault(); ul.classList.add("dragover"); };
    ul.ondragleave = () => ul.classList.remove("dragover");
    ul.ondrop = e => {
      e.preventDefault();
      ul.classList.remove("dragover");
      try {
        const { t, from } = JSON.parse(e.dataTransfer.getData("text/plain"));
        if (from === ul.dataset.id) return;
        const ls = watchlists();
        const src = ls.find(x => x.id === from), dst = ls.find(x => x.id === ul.dataset.id);
        if (!src || !dst || dst.tickers.includes(t)) return;
        src.tickers = src.tickers.filter(x => x !== t);
        dst.tickers.push(t);
        if (src.notes[t]) { dst.notes[t] = src.notes[t]; delete src.notes[t]; }
        saveLists(ls);
      } catch { /* not our payload */ }
    };
  });
}

// ---------------------------------------------------------------- alerts tab

let alertFilter = { type: "", ticker: "" };

function renderAlerts() {
  const el = $("#tab-alerts");
  const all = store.load("alerts", []);
  const cutoff = Date.now() - 30 * 86400e3;
  let list = all.filter(a => a.ts >= cutoff);
  if (alertFilter.type) list = list.filter(a => a.type === alertFilter.type);
  if (alertFilter.ticker) list = list.filter(a => a.ticker === alertFilter.ticker);
  const types = [...new Set(all.map(a => a.type))];
  const tickers = [...new Set(all.map(a => a.ticker))].sort();

  el.innerHTML = `
    ${helpPanel("alerts")}
    <div class="panel"><div class="controls">
      <label class="f">Type<select id="al-type"><option value="">all</option>
        ${types.map(t => `<option ${alertFilter.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="f">Ticker<select id="al-ticker"><option value="">all</option>
        ${tickers.map(t => `<option ${alertFilter.ticker === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <button class="btn ghost" id="al-read">Mark all read</button>
      <button class="btn ghost danger" id="al-clear">Clear history</button>
      <span class="pill">alerts are generated when the EOD dataset changes state vs your last visit — this is not an intraday feed</span>
    </div>
    ${list.length ? list.map(a => `
      <div class="alert-item ${a.read ? "" : "unread"}">
        <span class="when">${new Date(a.ts).toISOString().slice(0, 16).replace("T", " ")}</span>
        <span class="pill">${esc(a.type)}</span>
        <span>${esc(a.msg)}</span>
      </div>`).join("")
    : '<div class="muted" style="padding:12px">No alerts in the last 30 days. They appear when signals flip, RSI crosses 30/70, MACD flips sign, volume spikes >2× average, or a paper position hits stop/target.</div>'}
    </div>`;

  $("#al-type").onchange = e => { alertFilter.type = e.target.value; renderAlerts(); };
  $("#al-ticker").onchange = e => { alertFilter.ticker = e.target.value; renderAlerts(); };
  $("#al-read").onclick = () => {
    store.save("alerts", all.map(a => ({ ...a, read: true })));
    refreshAlertBadge(); renderAlerts();
  };
  $("#al-clear").onclick = () => {
    if (!confirm("Delete all alert history?")) return;
    store.save("alerts", []);
    refreshAlertBadge(); renderAlerts();
  };
}

// ---------------------------------------------------------------- settings

function renderSettings() {
  const el = $("#tab-settings");
  const s = store.settings();
  el.innerHTML = `
    ${helpPanel("settings")}
    <div class="panel"><h3>Preferences</h3>
      <div class="controls">
        <label class="f">Theme<select id="set-theme">
          <option value="dark" ${s.theme === "dark" ? "selected" : ""}>Dark</option>
          <option value="light" ${s.theme === "light" ? "selected" : ""}>Light</option></select></label>
        <label class="f">Paper starting capital $<input id="set-capital" type="number" value="${s.paperCapital}" min="100" style="width:110px"></label>
        <label class="f">Risk per trade %<input id="set-risk" type="number" value="${s.riskPct}" min="0.25" max="10" step="0.25" style="width:80px"></label>
        <label class="f">Desktop notifications<select id="set-notif">
          <option value="" ${!s.desktopNotifications ? "selected" : ""}>off</option>
          <option value="1" ${s.desktopNotifications ? "selected" : ""}>on</option></select></label>
        <button class="btn" id="set-save">Save</button>
      </div>
      <div class="muted">Capital applies to the paper account on next reset; risk % applies to new paper trades and trade plans immediately.</div>
    </div>
    <div class="panel"><h3>Data</h3>
      <div class="controls">
        <button class="btn ghost" id="set-export">Export all app data (JSON)</button>
        <label class="btn ghost">Import app data<input id="set-import" type="file" accept=".json" class="hidden"></label>
        <button class="btn danger" id="set-wipe">Wipe all local data</button>
      </div>
      <div class="muted">
        Market data: ${esc(MANIFEST.source)}, refreshed ${esc(MANIFEST.fetched_at)} by the CI workflow
        (<code>scripts/fetch_data.py</code> → <code>data/*.json</code>). Prices are end-of-day; the site never
        calls external APIs from your browser. Universe: ${MANIFEST.assets.length} assets
        (${MANIFEST.assets.filter(a => a.available).length} with data).
      </div>
    </div>
    <div class="panel"><h3>What this app deliberately does NOT do</h3>
      <div class="muted">
        No real-time quotes (EOD only). No broker connection or auto-trading — a public static site
        cannot hold broker keys safely. No social-sentiment or ML price predictions — those need paid
        data and would be decoration, not signal. No dividend-growth strategy — the free source has no
        dividend history. Every number shown traces to a real exchange close.
      </div>
    </div>`;

  $("#set-save").onclick = () => {
    store.save("settings", {
      ...s, theme: $("#set-theme").value,
      paperCapital: Math.max(100, +$("#set-capital").value || 10000),
      riskPct: Math.min(10, Math.max(0.25, +$("#set-risk").value || 2)),
      desktopNotifications: !!$("#set-notif").value,
    });
    applyTheme();
    if ($("#set-notif").value && typeof Notification !== "undefined" && Notification.permission === "default")
      Notification.requestPermission();
    toast("Settings saved", "good");
  };
  $("#set-export").onclick = () =>
    download("watchlist-momentum-data.json", JSON.stringify(store.exportAll(), null, 2), "application/json");
  $("#set-import").onchange = async e => {
    try {
      store.importAll(JSON.parse(await e.target.files[0].text()));
      toast("Data imported — reloading", "good");
      setTimeout(() => location.reload(), 800);
    } catch { toast("Invalid JSON file", "bad"); }
  };
  $("#set-wipe").onclick = () => {
    if (!confirm("Erase ALL local data (paper account, portfolio, watchlists, alerts, settings)?")) return;
    Object.keys(localStorage).filter(k => k.startsWith("mtpe:")).forEach(k => localStorage.removeItem(k));
    location.reload();
  };
}

// ---------------------------------------------------------------- shell

function applyTheme() {
  document.documentElement.dataset.theme = store.settings().theme;
}

const RENDERERS = {
  signals: renderSignals, backtest: renderBacktest, strategies: renderStrategies,
  paper: renderPaper, portfolio: renderPortfolio, sectors: renderSectors,
  watchlists: renderWatchlists, alerts: renderAlerts, settings: renderSettings,
};
let activeTab = "signals";

function renderActive() { RENDERERS[activeTab](); }

function initTabs() {
  $("#tabs").querySelectorAll("button").forEach(btn => btn.onclick = () => {
    activeTab = btn.dataset.tab;
    $("#tabs").querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab").forEach(t =>
      t.classList.toggle("active", t.id === "tab-" + activeTab));
    renderActive();
    if (activeTab === "alerts") {
      // opening the tab marks alerts as read
      store.save("alerts", store.load("alerts", []).map(a => ({ ...a, read: true })));
      refreshAlertBadge();
    }
  });
  $("#theme-toggle").onclick = () => {
    const s = store.settings();
    store.save("settings", { ...s, theme: s.theme === "dark" ? "light" : "dark" });
    applyTheme();
  };
  $("#modal-root").onclick = e => {
    if (e.target.id === "modal-root") e.target.classList.add("hidden");
  };
}

async function boot() {
  applyTheme();
  initTabs();
  initHelp();
  try {
    await loadAll();
  } catch (e) {
    $("#data-status").textContent = "data load failed";
    $("#tab-signals").innerHTML = `<div class="banner">Could not load <code>data/manifest.json</code> — run
      <code>python scripts/fetch_data.py</code> first, then serve this folder over HTTP
      (<code>python -m http.server</code>). Error: ${esc(e.message)}</div>`;
    return;
  }
  seed13fWatchlist();
  paperCheckStops();
  generateAlerts();
  renderActive();
}

// One-time (per seed version): materialize a "13F Picks" watchlist with every
// universe asset that entered via 13F consensus. Merges new names into an
// existing list; after the seed, the list is the user's to edit or delete.
function seed13fWatchlist() {
  if (store.load("wl13fSeeded_v2", false)) return;
  const picks = [...ASSETS.values()]
    .filter(a => a.meta.via === "13F").map(a => a.meta.ticker);
  if (!picks.length) return;
  const lists = watchlists();
  let wl = lists.find(w => w.id === "13f");
  if (!wl) {
    wl = { id: "13f", name: "13F Picks", color: "#8e44ad", tickers: [], notes: {} };
    lists.push(wl);
  }
  for (const t of picks) if (!wl.tickers.includes(t)) wl.tickers.push(t);
  store.save("watchlists", lists);
  store.save("wl13fSeeded_v2", true);
}

boot();
