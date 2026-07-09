// backtest.js — event-driven daily backtester, long-only, no lookahead:
// a decision made on the close of bar i executes at the OPEN of bar i+1.
// While in a position, ATR stop/target are checked against each bar's
// low/high; if both could hit in the same bar, the STOP is assumed first
// (conservative). Results are only as good as EOD data allows — no intraday
// fills, no slippage model beyond a flat fee, splits/dividends not adjusted
// beyond what Yahoo already adjusts.

import { tradePlan, positionSize } from "./risk.js";

export function runBacktest(bars, ind, strategy, opts = {}) {
  const days = opts.days ?? 180;
  const capital0 = opts.capital ?? 10000;
  const riskPct = opts.riskPct ?? 2;
  const feePerTrade = opts.fee ?? 0;
  const fractional = opts.fractional ?? false; // index assets trade in fractions

  const n = bars.close.length;
  const warmup = 205; // sma200 + margin
  const start = Math.max(warmup, n - days);
  if (start >= n - 2) return null;

  let cash = capital0, shares = 0, plan = null, entryInfo = null;
  const state = { everEntered: false };
  const trades = [];
  const equity = [], equityDates = [];

  const openOf = i => bars.open[i] ?? bars.close[i];

  function closePosition(i, price, reason) {
    const proceeds = shares * price - feePerTrade;
    cash += proceeds;
    trades.push({
      entryDate: entryInfo.date, entryPrice: entryInfo.price,
      exitDate: bars.date[i], exitPrice: price, shares,
      pnl: proceeds - entryInfo.cost,
      pnlPct: (price / entryInfo.price - 1) * 100,
      reason,
    });
    shares = 0; plan = null; entryInfo = null;
  }

  for (let i = start; i < n; i++) {
    // 1) intra-bar stop/target on existing position
    if (shares > 0 && plan) {
      const lo = bars.low[i] ?? bars.close[i];
      const hi = bars.high[i] ?? bars.close[i];
      if (lo <= plan.stop) closePosition(i, plan.stop, "stop");
      else if (hi >= plan.target) closePosition(i, plan.target, "target");
    }

    // 2) decision on close of bar i, executed at open of bar i+1
    const hasNext = i + 1 < n;
    if (shares > 0) {
      if (hasNext && strategy.exit(ind, bars, i, state)) {
        closePosition(i + 1, openOf(i + 1), "signal");
      }
    } else if (hasNext && strategy.enter(ind, bars, i, state)) {
      const entryPrice = openOf(i + 1);
      const p = strategy.useStops ? tradePlan(entryPrice, ind.atr14[i]) : null;
      const qty = strategy.useStops
        ? positionSize(cash, riskPct, p, fractional)
        : (fractional ? Math.floor((cash / entryPrice) * 1e4) / 1e4
                      : Math.floor(cash / entryPrice));
      if (qty > 0) {
        const cost = qty * entryPrice + feePerTrade;
        cash -= cost;
        shares = qty; plan = p;
        entryInfo = { date: bars.date[i + 1], price: entryPrice, cost };
        state.everEntered = true;
      }
    }

    equity.push(cash + shares * bars.close[i]);
    equityDates.push(bars.date[i]);
  }

  // mark-to-market any open position at the last close (not a realized trade)
  const openPosition = shares > 0 ? {
    entryDate: entryInfo.date, entryPrice: entryInfo.price, shares,
    lastPrice: bars.close[n - 1],
    unrealizedPnl: shares * bars.close[n - 1] - entryInfo.cost,
  } : null;

  return { trades, equity, equityDates, openPosition,
           finalEquity: equity[equity.length - 1], capital0,
           metrics: computeMetrics(trades, equity, capital0, bars, start) };
}

export function computeMetrics(trades, equity, capital0, bars, start) {
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  let peak = -Infinity, maxDD = 0;
  for (const e of equity) {
    peak = Math.max(peak, e);
    maxDD = Math.max(maxDD, (peak - e) / peak);
  }

  const daily = [];
  for (let i = 1; i < equity.length; i++) daily.push(equity[i] / equity[i - 1] - 1);
  const mean = daily.reduce((s, x) => s + x, 0) / (daily.length || 1);
  const sd = Math.sqrt(daily.reduce((s, x) => s + (x - mean) ** 2, 0) / (daily.length || 1));
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : null;

  const last = equity[equity.length - 1];
  const bh = bars.close[bars.close.length - 1] / bars.close[start] - 1;

  return {
    trades: trades.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : null,
    totalReturnPct: (last / capital0 - 1) * 100,
    buyHoldReturnPct: bh * 100,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null),
    maxDrawdownPct: maxDD * 100,
    sharpe,
    avgWin: wins.length ? grossWin / wins.length : null,
    avgLoss: losses.length ? -grossLoss / losses.length : null,
    expectancy: trades.length
      ? trades.reduce((s, t) => s + t.pnl, 0) / trades.length : null,
  };
}

export function tradesToCsv(trades) {
  const head = "entry_date,entry_price,exit_date,exit_price,shares,pnl,pnl_pct,reason";
  const rows = trades.map(t =>
    [t.entryDate, t.entryPrice.toFixed(4), t.exitDate, t.exitPrice.toFixed(4),
     t.shares, t.pnl.toFixed(2), t.pnlPct.toFixed(2), t.reason].join(","));
  return [head, ...rows].join("\n");
}
