// help.js — collapsible per-tab explainers.
// Each tab opens with a plain-English "how this works" panel; the collapse
// state is remembered per tab in localStorage, so it teaches first-timers
// without nagging returning users. Content is honest about limitations —
// the explanations say what a number can and cannot tell you.

import * as store from "./store.js";

const HELP = {
  signals: {
    q: "What am I looking at?",
    html: `
      <p>This is the <strong>scanner</strong>: one row per asset, evaluated at the last daily close.
      Six classic indicators each cast a vote — <strong>green dot</strong> bullish, <strong>red</strong> bearish, grey neutral.
      When at least <strong>3 votes point the same way</strong>, the row gets a
      <span class="sig BUY">BUY</span> or <span class="sig SELL">SELL</span> badge
      (6/6 = STRONG, 4–5 = MEDIUM, 3 = WEAK). Everything else is <span class="sig HOLD">HOLD</span> — which is a perfectly good answer.</p>
      <ul>
        <li><strong>Click any row</strong> to open the full chart, each vote explained, and an ATR trade plan (entry / stop / target / position size).</li>
        <li><strong>Paper buy</strong> executes the signal in the simulator with virtual money — the safe way to test the system before trusting it.</li>
        <li>Sort by clicking column headers; filter by text or by one of your watchlists.</li>
      </ul>
      <p class="help-caveat">A signal describes what prices <em>have been</em> doing — it predicts nothing.
      Before acting on one, check the Backtest tab to see how often it actually worked on that asset.</p>`,
  },

  backtest: {
    q: "What is a backtest?",
    html: `
      <p>It replays the last N days as if you had traded the chosen strategy mechanically:
      every decision uses the close of one day and is filled at the <strong>open of the next</strong> —
      the engine cannot peek at the future. Stops and targets are checked against each day's high/low
      (and when both could hit in the same day, the <strong>stop wins</strong> — the pessimistic assumption).</p>
      <ul>
        <li><strong>Return vs Buy &amp; Hold</strong> is the only fair comparison. Beating zero is easy; beating "do nothing" is the actual job.</li>
        <li><strong>Max drawdown</strong> is the worst peak-to-valley loss — the number your stomach feels.</li>
        <li><strong>Profit factor</strong> = gross wins ÷ gross losses (below ~1.3 is basically noise); <strong>Sharpe</strong> = return per unit of volatility.</li>
      </ul>
      <p class="help-caveat">Few trades = meaningless statistics (a 75% win rate over 4 trades tells you nothing).
      And real trading adds slippage, spreads and hesitation — reality is always worse than the backtest.</p>`,
  },

  strategies: {
    q: "What does this comparison show?",
    html: `
      <p>The same backtest engine, the same window, four different rule-sets — so the differences come
      from the <em>rules</em>, not from lucky test conditions:</p>
      <ul>
        <li><strong>Momentum</strong> — buys when the 6-vote signal says BUY, exits when it decays (this app's headline strategy).</li>
        <li><strong>Mean Reversion</strong> — buys panic (RSI &lt; 30, below the lower Bollinger band), sells the bounce.</li>
        <li><strong>Breakout</strong> — buys new 55-day highs on strong volume, exits below the 20-day low.</li>
        <li><strong>Buy &amp; Hold</strong> — the benchmark. Any strategy that loses to it after drawdown isn't earning its complexity.</li>
      </ul>
      <p class="help-caveat">Picking whichever strategy won <em>after</em> seeing the results is itself a trap
      (overfitting). Use this to understand behavior — trend markets favor momentum/breakout, choppy ones favor mean reversion — not to crown a winner from one window.</p>`,
  },

  paper: {
    q: "How does paper trading work?",
    html: `
      <p>A practice account with <strong>virtual money</strong> ($10,000 by default). You execute real signals,
      at real prices, with zero risk — the honest way to find out whether you'd actually follow the system.</p>
      <ul>
        <li>Buys fill at the <strong>last daily close</strong>; each position carries its ATR stop and target.</li>
        <li>When the dataset refreshes (once per trading day), stops/targets are checked against the new daily bars and positions close automatically — you'll get an alert.</li>
        <li>The <strong>benchmark card</strong> shows what the S&amp;P 500 did over the same period: the bar to beat.</li>
      </ul>
      <p class="help-caveat">Treat it like real money or it teaches you nothing: take only system signals,
      never move a stop, and judge results after months, not days.</p>`,
  },

  portfolio: {
    q: "What goes in here?",
    html: `
      <p>Your <strong>real holdings</strong>, entered manually (shares + cost per share). Everything stays in this
      browser's local storage — nothing is uploaded anywhere.</p>
      <ul>
        <li><strong>Weight</strong> shows concentration; a warning appears when one sector exceeds 40% of the total.</li>
        <li><strong>Beta vs S&amp;P 500</strong>: 1.0 moves with the market, above 1 amplifies it, below 1 dampens it.</li>
        <li><strong>Sharpe</strong>: return per unit of volatility over the last ~6 months — higher is better, below 0 means you took risk to lose money.</li>
        <li>Import/export CSV to move data between machines.</li>
      </ul>
      <p class="help-caveat">Prices are end-of-day, and only assets in this app's 29-asset universe can be tracked.</p>`,
  },

  sectors: {
    q: "How do I read the heatmap?",
    html: `
      <p>Assets grouped by sector; tile color is the <strong>average 1-month performance</strong> of the members
      (green = up, red = down). Click a tile to list its members with their current signals.</p>
      <ul>
        <li>Sector rotation is often earlier and steadier information than any single stock's move.</li>
        <li>The "leader" is the member with the best 1-month return.</li>
      </ul>
      <p class="help-caveat">Some sectors here hold only one or two names (e.g. Healthcare ≈ LLY), so their
      "average" is really just that stock — read the member list, not only the tile.</p>`,
  },

  watchlists: {
    q: "What are watchlists for?",
    html: `
      <p>Organize the universe by <em>your</em> logic — time horizon, theme, conviction. Four starter lists are
      provided; create as many as you want, each with its own color.</p>
      <ul>
        <li><strong>Drag tickers</strong> between lists; use ✎ to attach a note (e.g. why you're watching it — future-you will thank you).</li>
        <li>The <strong>Signals tab can be filtered</strong> by any watchlist — that's their main power.</li>
        <li>Export/import as JSON to share or back up.</li>
      </ul>`,
  },

  alerts: {
    q: "When do alerts fire?",
    html: `
      <p>Alerts are <strong>state changes between your visits</strong>, computed when the app loads fresh EOD data:
      a signal flipping to BUY/SELL, RSI crossing 30 or 70, the MACD histogram changing sign, volume above
      2× its 20-day average, or a paper position hitting its stop/target.</p>
      <ul>
        <li>Opening this tab marks everything as read; the badge in the tab bar counts unread items.</li>
        <li>Turn on <strong>desktop notifications</strong> in Settings to get them without opening the app.</li>
      </ul>
      <p class="help-caveat">This is <em>not</em> an intraday feed — data updates once per trading day.
      Nothing here is urgent by construction; that's a feature, not a bug.</p>`,
  },

  settings: {
    q: "What can I configure?",
    html: `
      <p>Theme, paper-account starting capital, risk per trade (used for position sizing everywhere),
      and desktop notifications.</p>
      <ul>
        <li><strong>Export all app data</strong> saves your paper account, portfolio, watchlists and alerts as one JSON — your backup and your way to move between browsers.</li>
        <li><strong>Wipe all local data</strong> is the factory reset.</li>
      </ul>
      <p class="help-caveat">Also read "What this app deliberately does NOT do" below — knowing a tool's limits
      is what makes its numbers trustworthy.</p>`,
  },
};

export function helpPanel(tab) {
  const h = HELP[tab];
  if (!h) return "";
  const open = store.load("helpOpen", {})[tab] ?? true;
  return `<div class="help ${open ? "" : "closed"}" data-help="${tab}">
    <button class="help-toggle" data-tab="${tab}" aria-expanded="${open}">
      <span>💡 ${h.q}</span><span class="chev">${open ? "▴ hide" : "▾ show"}</span>
    </button>
    <div class="help-body">${h.html}</div>
  </div>`;
}

// One delegated listener survives every tab re-render.
export function initHelp() {
  document.addEventListener("click", e => {
    const btn = e.target.closest(".help-toggle");
    if (!btn) return;
    const tab = btn.dataset.tab;
    const state = store.load("helpOpen", {});
    const open = !(state[tab] ?? true);
    state[tab] = open;
    store.save("helpOpen", state);
    btn.closest(".help").classList.toggle("closed", !open);
    btn.setAttribute("aria-expanded", open);
    btn.querySelector(".chev").textContent = open ? "▴ hide" : "▾ show";
  });
}
