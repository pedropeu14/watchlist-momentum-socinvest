# Watchlist Momentum — Socinvest

End-of-day signal scanner, backtester and paper-trading simulator for a fixed
29-asset universe. Pure static site (vanilla JS, zero dependencies, no build
step) designed for GitHub Pages, with a Python-stdlib data pipeline refreshed
daily by GitHub Actions.

> **This is an educational tool, not investment advice.** Signals are
> statistics over past prices; they predict nothing. Paper trading is
> simulated money. Read `TRADING_GUIDE.md` before trusting any number here.

## Architecture

```
scripts/universe.json ──▶ scripts/fetch_data.py ──▶ data/<TICKER>.json + manifest.json
                              (Yahoo Finance chart API, EOD, stdlib only)
                                        │
                        GitHub Action (daily 22:30 UTC) commits data/
                                        │
index.html + js/* ◀── reads data/ same-origin ──▶ deployed to GitHub Pages
```

Why this shape: browsers cannot call market APIs from a static page (CORS),
and a public site can never hold an API key safely. So the *server-side* step
is a scheduled CI job, and the site only ever reads its own `data/` folder.
Same pattern as a data pipeline: fetch once, serve snapshots.

## Features (all real, all client-side)

- **Signals** — 6 indicators (SMA 20/50/200, EMA 12/26, RSI 14, MACD 12/26/9,
  Bollinger 20/2, Volume+OBV) vote independently; a signal needs ≥3 aligned
  votes. STRONG 6/6, MEDIUM 4-5, WEAK 3. Confidence penalizes opposing votes.
- **Backtesting** — event-driven daily engine, long-only, **no lookahead**
  (decision on close of day *i*, fill at open of day *i+1*), ATR stop/target
  checked against daily high/low with stop-first tie-break. Win rate, ROI vs
  buy-&-hold, profit factor, max drawdown, annualized Sharpe, CSV export.
- **Risk management** — ATR(14) trade plans: stop −2×ATR, target +4×ATR (1:2),
  position sizing capped at a configurable % of capital (default 2%).
- **4 strategies compared** — Momentum (multi-confirmation), Mean Reversion
  (RSI+Bollinger), Breakout (55-day Donchian + volume), Buy & Hold benchmark,
  plus an equal-weight ensemble row.
- **Paper trading** — $10k virtual account. Fills at last EOD close;
  stops/targets honored against subsequent daily bars on each data refresh.
- **Portfolio** — track real holdings (localStorage only, never uploaded):
  P&L, weights, sector allocation, beta vs S&P 500, Sharpe, concentration
  warnings. CSV import/export.
- **Sectors** — heatmap + leaders over 1W/1M/3M.
- **Watchlists** — multiple lists, colors, per-ticker notes, drag-and-drop
  between lists, JSON export/import.
- **Alerts** — generated on state *changes* between visits: signal flips,
  RSI 30/70 crossings, MACD sign flips, volume >2× average, paper stop/target
  hits. Toasts + optional desktop notifications. **Not an intraday feed.**
- Dark/light theme, responsive layout, full data export/import.

## What was deliberately left out (and why)

The original spec asked for more. These are omitted because a static site
cannot do them honestly:

| Requested | Why it's not here |
|---|---|
| Real-time quotes | Free EOD only. "Real-time" on a free static site is fiction. |
| Broker integration / auto-trading | A public page cannot hold broker keys; anyone could read them and trade your account. Needs a server you control. |
| Social sentiment | Twitter/X API is paid; anything else would be made-up numbers. |
| ML predictions (LSTM etc.) | In-browser toy models produce decoration, not signal. Omitted rather than faked. |
| Email/SMS alerts | Requires a backend. Desktop notifications are included instead. |
| Economic calendar | No free, licensable earnings/dividend feed; fabricating dates is worse than omitting them. |
| Dividend Growth strategy | The free EOD source carries no dividend history. |

## Universe notes (the requested list had errors — corrected, not hidden)

- **SX7E** is the EURO STOXX *Banks* code; the requested name was "STOXX
  Europe 600", so the app tracks `^STOXX` (the actual Europe 600).
- **S5ENRS** / **S5FINL** are Bloomberg codes for the S&P 500 Energy and
  Financials sectors (`^GSPE`, `^SP500-40`) — not iSTOXX indices.
- **ARA** (American Renal Associates) was delisted in 2021: shown as
  unavailable, never filled with synthetic data. 28 of 29 assets have data.
- **BNT** is Brookfield Wealth Solutions (BioNTech is BNTX).
- **VRT** is Vertiv (Virtus Investment Partners is VRTS).

## Run locally

```bash
python scripts/fetch_data.py     # fetch EOD data (~30s, stdlib only)
python -m http.server 8000       # any static server works
# open http://localhost:8000
```

## Deploy to GitHub Pages

1. Push this folder to a GitHub repo (branch `main`).
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. Done. `.github/workflows/update-data.yml` refreshes `data/` every weekday
   after the US close and redeploys the site. Run it manually anytime via
   the *Actions* tab (workflow_dispatch).

## Limitations

- EOD granularity: paper-trading fills and backtest stops are daily
  approximations; no intraday fills, no slippage model beyond a flat fee.
- Yahoo's free chart API is unofficial and can change without notice.
- Portfolio beta/Sharpe align mixed-calendar series by trading-day offset —
  a small approximation when mixing US and European assets.
- All user state lives in the browser's localStorage: clearing site data
  resets the app (use Settings → Export to back up).

## Files

```
index.html            app shell
css/style.css         dark/light enterprise UI
js/indicators.js      SMA/EMA/RSI/MACD/Bollinger/OBV/ATR (pure functions)
js/signals.js         6-vote multi-confirmation engine
js/risk.js            ATR trade plans + position sizing
js/strategies.js      momentum / mean-reversion / breakout / buy-hold
js/backtest.js        no-lookahead daily backtester + metrics
js/charts.js          dependency-free SVG charts
js/store.js           namespaced localStorage
js/app.js             tabs, paper trading, portfolio, alerts, watchlists
scripts/universe.json 29-asset universe (single source of truth)
scripts/fetch_data.py EOD fetcher (Python stdlib)
data/                 committed EOD snapshots the site reads
```
