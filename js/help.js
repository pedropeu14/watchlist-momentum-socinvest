// help.js — collapsible per-tab explainers.
// Each tab opens with a plain-English "how this works" panel; the collapse
// state is remembered per tab in localStorage, so it teaches first-timers
// without nagging returning users. Content is deliberately complete — every
// column, control and metric is defined, with its formula where it has one —
// and honest about what a number can and cannot tell you.

import * as store from "./store.js";

const HELP = {
  signals: {
    q: "What am I looking at?",
    html: `
      <p>This is the <strong>scanner</strong>: one row per asset, evaluated at the last daily close
      (end-of-day data — nothing here is intraday). Six classic indicators each cast an independent vote;
      when at least <strong>3 votes point the same way</strong>, the row gets a
      <span class="sig BUY">BUY</span> or <span class="sig SELL">SELL</span> badge
      (6/6 = STRONG, 4–5 = MEDIUM, 3 = WEAK). Everything else is <span class="sig HOLD">HOLD</span> —
      which is a perfectly good answer.</p>

      <h4>Every column, defined</h4>
      <table class="gloss">
        <tr><td>Close</td><td>Last end-of-day closing price, in the asset's own currency ($ or €).</td></tr>
        <tr><td>1D / 1M / 3M</td><td>Price change over 1, 21 and 63 <em>trading</em> days (≈ 1 day, 1 month, 1 quarter).</td></tr>
        <tr><td>RSI</td><td>Relative Strength Index (14 days), 0–100. Above 70 = overbought territory, below 30 = oversold. Between 55–70 it confirms upward momentum; extremes are exhaustion warnings, not buy/sell triggers by themselves.</td></tr>
        <tr><td>MACD-H</td><td>MACD histogram: the gap between the MACD line (EMA12 − EMA26) and its 9-day signal line. Positive and growing = accelerating up-move; negative and growing = accelerating down-move.</td></tr>
        <tr><td>MM200 σ</td><td>The Socinvest ruler: price ÷ its 200-day average, z-scored against that asset's own ~10-year history. <strong>−1σ or lower (green)</strong> = statistically depressed; <strong>+1σ or higher (red)</strong> = stretched. A mean-reversion lens — the opposite of momentum — so treat it as context and backtest "MM200 Reversion" before trading it.</td></tr>
        <tr><td>Votes</td><td>Six dots, in fixed order: ① SMA trend 20/50 · ② long trend 50/200 · ③ EMA cross 12/26 · ④ RSI regime · ⑤ MACD · ⑥ Bollinger confirmed by Volume/OBV. Green = bullish, red = bearish, grey = neutral.</td></tr>
        <tr><td>Signal</td><td>BUY when bullish votes exceed bearish by ≥3; SELL is the mirror. Strength counts the aligned votes.</td></tr>
        <tr><td>Conf.</td><td>Confidence = (aligned votes − ½ × opposing votes) ÷ 6. A 4-vote BUY with 2 votes against scores lower than a clean 4-0.</td></tr>
        <tr><td>6M</td><td>Sparkline of the last ~6 months of closes — green if up over the window, red if down.</td></tr>
      </table>

      <h4>How to use it</h4>
      <ul>
        <li><strong>Click any row</strong> for the full picture: price chart with SMAs and Bollinger bands, RSI, MACD, the MM200 ruler with its ±1σ band, each vote explained, and an ATR trade plan (entry / stop / target / position size).</li>
        <li><strong>Paper buy</strong> executes a BUY signal in the simulator with virtual money — the safe way to test the system before trusting it.</li>
        <li>Sort by clicking any column header (click again to invert); filter by text or by one of your watchlists.</li>
        <li>The cards on top are shortcuts: strongest BUYs, your paper account, your portfolio, the leading sector, unread alerts.</li>
      </ul>
      <p class="help-caveat">A signal describes what prices <em>have been</em> doing — it predicts nothing. The six votes
      are all functions of the same price series, so 6/6 is not six independent confirmations; treat STRONG as
      "the trend is unambiguous", which is also exactly when reversals surprise the most. Before acting on any signal,
      check the Backtest tab to see how often it actually worked on that asset.</p>`,
  },

  backtest: {
    q: "What is a backtest and what does every field mean?",
    html: `
      <p>A backtest replays the past as if you had traded the chosen strategy <em>mechanically</em>.
      The engine is deliberately honest: every decision uses the close of one day and is filled at the
      <strong>open of the next day</strong> (it cannot peek at the future), and stops/targets are checked
      against each day's high/low — when both could hit inside the same bar, the <strong>stop is assumed
      first</strong> (the pessimistic tie-break).</p>

      <h4>The controls</h4>
      <table class="gloss">
        <tr><td>Asset / Strategy</td><td>What to trade and which rule-set to follow (rules spelled out in the Strategies tab help).</td></tr>
        <tr><td>Window</td><td>How many trading days to replay (90d to 5 years). Longer windows produce more trades and therefore more meaningful statistics — a 4-trade result is an anecdote, not evidence.</td></tr>
        <tr><td>Capital $</td><td>Starting cash of the simulation.</td></tr>
        <tr><td>Risk %</td><td><strong>Loss per trade if the stop hits — not how much you invest.</strong> The sizing formula is: risk budget = capital × risk% ; shares = budget ÷ (entry − stop). Example at 2% of $10,000: budget $200; entry $313.39 with stop $296.70 → $16.69 risk/share → 11 shares. Those 11 shares cost ~$3,450 (34% of capital <em>invested</em>) but only 2% is <em>at risk</em>. Low-volatility assets (tight ATR stop) get big positions, volatile ones get small positions — equal risk either way. Strategies without stops (Buy & Hold, MM200 Reversion) ignore this field and invest available cash. <strong>Stocks trade in whole shares; index assets (SPX, NDX, SOX…) trade in fractional units</strong> — you can't buy "1 Nasdaq" in real life anyway; actual exposure comes via ETFs or futures.</td></tr>
        <tr><td>Fee / trade $</td><td>Flat cost charged on each entry and exit — a crude stand-in for commissions and slippage.</td></tr>
      </table>

      <h4>The metrics</h4>
      <table class="gloss">
        <tr><td>Trades</td><td>Closed round-trips. A position still open at the window's end is shown in a banner and marked to market in Return, but excluded from trade stats.</td></tr>
        <tr><td>Win rate</td><td>% of closed trades with positive P&L. Meaningless by itself — a 30% win rate with 1:2 risk/reward is profitable; a 70% win rate with inverted payoffs is not.</td></tr>
        <tr><td>Return</td><td>Final equity vs starting capital, including open-position value.</td></tr>
        <tr><td>Buy & hold</td><td>What the asset itself did over the same window. <strong>The only fair benchmark</strong> — a +12% strategy in a +20% market destroyed value while feeling productive.</td></tr>
        <tr><td>Profit factor</td><td>Gross wins ÷ gross losses. Below ~1.3 is statistical noise; ∞ means no losing trade (usually: too few trades).</td></tr>
        <tr><td>Max drawdown</td><td>Worst peak-to-valley fall of the equity curve — the number your stomach actually feels. Ask yourself if you'd keep following signals after living through it.</td></tr>
        <tr><td>Sharpe (ann.)</td><td>Mean daily return ÷ daily volatility × √252 (risk-free rate assumed 0). Rough scale: &lt;0 lost money per unit of risk, ~1 solid, &gt;2 suspicious — check for too-few trades.</td></tr>
      </table>

      <h4>The trades table</h4>
      <p>Each row is one round-trip. The <strong>Reason</strong> column tells you how it ended:
      <em>stop</em> (ATR stop hit), <em>target</em> (+4×ATR reached), <em>signal</em> (the strategy's own
      exit rule fired). Export everything as CSV for your own analysis.</p>
      <p class="help-caveat">Real trading adds slippage, spreads, partial fills and — above all — hesitation.
      Reality is always worse than the backtest. If a result looks amazing, your first hypothesis should be
      "what did I get wrong?", not "I found it".</p>`,
  },

  strategies: {
    q: "What exactly does each strategy do?",
    html: `
      <p>The same backtest engine, the same window, the same no-lookahead execution — five rule-sets side by
      side, so differences come from the <em>rules</em>, not from test conditions.</p>
      <table class="gloss">
        <tr><td>Momentum</td><td>Enters when the 6-vote signal says BUY (≥3 net bullish votes); exits when the edge decays to zero or the ATR stop/target hits. This app's headline strategy — follows strength.</td></tr>
        <tr><td>Mean Reversion</td><td>Buys panic: RSI(14) below 30 <em>and</em> close under the lower Bollinger band (skipped if price has collapsed far below its 200-day trend — no falling knives). Exits at the middle band or RSI &gt; 55. ATR stops on.</td></tr>
        <tr><td>Breakout</td><td>Buys a close above the previous 55-day high on volume ≥1.3× its 20-day average; exits on a close below the previous 20-day low. ATR stops on. Classic Donchian/turtle logic.</td></tr>
        <tr><td>MM200 Reversion</td><td>The Socinvest ±1σ rule, pure: buy when the MM200 z-score ≤ −1, sell when ≥ +1. No stops. The z-score is computed with an <em>expanding window</em> (only data available up to each day) — the full-history ruler shown elsewhere would leak the future into the past and flatter the results.</td></tr>
        <tr><td>Buy & Hold</td><td>Buys the first tradable bar, never sells. The benchmark: any active strategy that loses to it after drawdown isn't earning its complexity.</td></tr>
        <tr><td>Ensemble</td><td>Capital split equally across the active strategies — shows whether diversifying <em>rules</em> (not assets) smooths the ride.</td></tr>
      </table>
      <h4>How to compare honestly</h4>
      <ul>
        <li>Run <strong>short and long windows</strong> (180d, 2y, 5y). A strategy that only wins in one window is fitted to that window's regime.</li>
        <li>Check <strong>trade counts</strong> before win rates — 100% of 1 trade is an anecdote.</li>
        <li>Trending markets favor Momentum/Breakout; choppy, range-bound markets favor the reversion strategies. Knowing <em>which regime you're in</em> is the hard part no backtest solves.</li>
      </ul>
      <p class="help-caveat">Picking whichever strategy won <em>after</em> seeing the results is itself a trap
      (overfitting). Use this tab to understand behavior, not to crown a winner from one window.
      A "Dividend Growth" strategy is deliberately absent: the free data source has no dividend history,
      and we don't fabricate inputs.</p>`,
  },

  paper: {
    q: "How does paper trading work, mechanically?",
    html: `
      <p>A practice account with <strong>virtual money</strong> ($10,000 by default — change it in Settings).
      You execute real signals at real prices with zero risk: the honest way to discover whether you'd
      actually follow the system before any real money is involved.</p>
      <h4>Mechanics</h4>
      <ul>
        <li><strong>Buys fill at the last daily close</strong> (this is an EOD system — there are no intraday fills to simulate). Position size follows your Risk % setting, exactly as in the Backtest help. Stocks buy whole shares; index assets buy fractional units (like an ETF would).</li>
        <li>Every position carries its ATR plan: stop at −2×ATR, target at +4×ATR (1:2 risk/reward).</li>
        <li>When the dataset refreshes (once per trading day via CI), each open position is checked against the new daily bars: if a day's low touched the stop it closes at the stop (stop wins ties), if the high touched the target it closes there — and you get an alert either way.</li>
        <li><strong>Close</strong> exits manually at the last close; <strong>Reset</strong> wipes the account back to starting capital.</li>
      </ul>
      <h4>The cards</h4>
      <table class="gloss">
        <tr><td>Equity</td><td>Cash + open positions valued at the last close — the number to judge.</td></tr>
        <tr><td>Cash</td><td>Uninvested balance available for new trades.</td></tr>
        <tr><td>Realized P&L</td><td>Sum of closed trades only; the win % counts closed trades.</td></tr>
        <tr><td>Benchmark</td><td>What the S&P 500 did since your account started — the bar to beat. If the paper account lags it for months, the system (or the discipline) isn't adding value.</td></tr>
      </table>
      <p class="help-caveat">Treat it like real money or it teaches you nothing: take only system signals, never
      move a stop after entry, and judge results after 3+ months — not 3 days. If paper results diverge wildly
      from the backtest, the difference is usually you: timing, cherry-picking, or hesitation.</p>`,
  },

  portfolio: {
    q: "What goes in here and what do the metrics mean?",
    html: `
      <p>Your <strong>real holdings</strong>, entered manually: pick the ticker, type how many shares and your
      average cost per share. Everything stays in this browser's localStorage — <strong>nothing is uploaded
      anywhere</strong> (this is a static site; there is no server to receive it).</p>
      <h4>Columns and metrics</h4>
      <table class="gloss">
        <tr><td>Value / Weight</td><td>Position marked at the last EOD close, and its share of the portfolio total.</td></tr>
        <tr><td>P&L</td><td>Gain/loss vs your cost basis, in $ and %.</td></tr>
        <tr><td>Beta vs S&P 500</td><td>How much the portfolio moves when the market moves, estimated from 120 days of daily returns: 1.0 = market-like, 1.5 = amplifies market moves by half, 0.5 = dampens them, &lt;0 = moves against the market.</td></tr>
        <tr><td>Sharpe (ann.)</td><td>Portfolio return per unit of volatility (annualized, risk-free rate 0). Below 0 means you took risk to lose money over the window.</td></tr>
        <tr><td>Sector allocation</td><td>Value-weighted split by sector. A warning appears when a single sector exceeds 40% — concentration is how good years become terrible ones.</td></tr>
      </table>
      <h4>Import / export</h4>
      <p>CSV format is <code>ticker,shares,cost</code> (one header line, then one row per position). Export first
      to see a template. Only tickers in this app's universe can be tracked.</p>
      <p class="help-caveat">Prices are end-of-day, and Beta/Sharpe align mixed-currency series by trading-day
      offset — a small approximation if you mix US assets with the European index. This is a tracker, not a
      brokerage statement: dividends and fees are not accounted for.</p>`,
  },

  sectors: {
    q: "How do I read the heatmap?",
    html: `
      <p>Assets grouped by sector. Tile color is the <strong>equal-weighted average 1-month performance</strong>
      of the members: green = up, red = down, intensity scales up to ±8% (beyond that it saturates).
      Click a tile to list its members with their current signals; click a member to open its full chart.</p>
      <ul>
        <li>The table below shows 1-week, 1-month and 3-month averages side by side — divergence between them
        (e.g. 3M strong but 1W weak) is early rotation evidence.</li>
        <li><strong>Leader</strong> is the member with the best 1-month return.</li>
        <li>Sector rotation is often steadier information than any single stock's move: money leaving Technology
        for Energy says more than one red day on one ticker.</li>
      </ul>
      <p class="help-caveat">Several sectors here hold only one or two names (Healthcare ≈ LLY, Materials = VALE),
      so their "average" is really just that stock — always read the member list, not only the tile. And the
      Indices group mixes US and European benchmarks; it's a reference row, not a tradable sector.</p>`,
  },

  watchlists: {
    q: "What are watchlists for?",
    html: `
      <p>Organize the 29-asset universe by <em>your</em> logic — time horizon, theme, conviction. Four starter
      lists are provided (Day Trading, Swing Trading, Long Term, My Favorites); create as many as you want,
      each with its own color.</p>
      <ul>
        <li><strong>Add</strong> tickers from the dropdown in each list; <strong>drag</strong> a ticker between lists to move it (its note travels along).</li>
        <li>Use <strong>✎</strong> to attach a note — e.g. <em>why</em> you're watching it and at what price it gets interesting. Future-you will thank you; the note shows in the row and on hover.</li>
        <li>Each ticker shows its live signal badge, so a list doubles as a mini-scanner.</li>
        <li><strong>The main power</strong>: the Signals tab can be filtered by any watchlist — your shortlist becomes the default view.</li>
        <li>Export/import as JSON to back up or share lists between browsers.</li>
      </ul>
      <p class="help-caveat">Lists live in this browser only (localStorage). Deleting a list or clearing site data
      removes them — use Export as your backup.</p>`,
  },

  alerts: {
    q: "When exactly does each alert fire?",
    html: `
      <p>Alerts are <strong>state changes between your visits</strong>. On load, the app compares today's EOD
      state of every asset against the state saved on your previous visit and reports what flipped —
      it is <em>not</em> an intraday feed, and your first visit sets the baseline silently (no fake news).</p>
      <h4>The trigger rules</h4>
      <table class="gloss">
        <tr><td>signal</td><td>An asset's badge changed to BUY or SELL since your last visit (includes strength and confidence).</td></tr>
        <tr><td>rsi</td><td>RSI(14) crossed above 70 (overbought) or below 30 (oversold).</td></tr>
        <tr><td>macd</td><td>The MACD histogram changed sign — an early momentum-direction flip.</td></tr>
        <tr><td>volume</td><td>Daily volume exceeded 2× its 20-day average — something happened, find out what.</td></tr>
        <tr><td>mm200</td><td>The asset entered the −1σ zone (statistically depressed) or the +1σ zone (stretched) of its MM200 ruler.</td></tr>
        <tr><td>paper</td><td>One of your paper positions hit its stop or target during the data refresh.</td></tr>
      </table>
      <ul>
        <li>Opening this tab marks everything read; the tab-bar badge counts unread items.</li>
        <li>The list shows the last 30 days (up to 300 stored); filter by type or ticker.</li>
        <li>Enable <strong>desktop notifications</strong> in Settings to get new alerts without opening the app.</li>
      </ul>
      <p class="help-caveat">Since data updates once per trading day, nothing here is ever urgent by construction —
      that's a feature: it removes the pressure to react in minutes, which is where most retail money dies.</p>`,
  },

  settings: {
    q: "What can I configure, and where does my data live?",
    html: `
      <h4>Preferences</h4>
      <table class="gloss">
        <tr><td>Theme</td><td>Light (default) or dark; the 🌓 button in the top bar toggles it too. Your choice always wins over the default.</td></tr>
        <tr><td>Paper starting capital</td><td>Applied the next time you reset the paper account.</td></tr>
        <tr><td>Risk per trade %</td><td>The position-sizing budget used everywhere (trade plans, paper buys, backtests' default): the % of capital lost if a stop hits — see the Backtest tab help for the formula and a worked example.</td></tr>
        <tr><td>Desktop notifications</td><td>Browser notifications for new alerts; your browser will ask permission once.</td></tr>
      </table>
      <h4>Your data</h4>
      <p>Everything you create — paper account, portfolio, watchlists, alerts, settings — lives in this browser's
      localStorage. <strong>Export all app data</strong> produces one JSON backup; import it in another browser to
      migrate. <strong>Wipe</strong> is the factory reset. Nothing is ever sent to a server.</p>
      <h4>Market data</h4>
      <p>Prices are end-of-day from Yahoo Finance, ~10 years per asset, refreshed once per trading day by a
      GitHub Actions job (weekdays 22:30 UTC, after the US close) that commits the JSONs this site reads.
      Every number shown traces to a real exchange close — when a source doesn't exist (ARA, delisted 2021),
      the asset is shown as unavailable rather than filled with synthetic data.</p>
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
