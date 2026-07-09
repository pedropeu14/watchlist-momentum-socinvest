# Trading Guide — how to read this app without fooling yourself

## The one-paragraph version

Every number in this app is derived from **past end-of-day prices**. Momentum
signals describe what *has been* happening; they have no knowledge of what
happens next. The value of a tool like this is discipline — predefined
entries, stops and position sizes — not prediction. If a backtest looks
amazing, your first hypothesis should be "what did I get wrong?", not "I
found it".

## The signal engine

Six indicators vote independently at each close:

| # | Indicator | Bullish vote when | Bearish vote when |
|---|---|---|---|
| 1 | SMA 20/50 | close > SMA20 > SMA50 | close < SMA20 < SMA50 |
| 2 | SMA 50/200 | SMA50 > SMA200 and close > SMA200 | inverse |
| 3 | EMA 12/26 | EMA12 > EMA26 | EMA12 < EMA26 |
| 4 | RSI 14 | 55–70 (momentum, not yet overbought) | 30–45 |
| 5 | MACD | histogram positive and not shrinking | negative and not shrinking |
| 6 | Bollinger + Volume/OBV | close above mid-band, confirmed by OBV or >1.2× volume | inverse |

BUY = at least 3 more bullish than bearish votes; SELL = the mirror image.
RSI beyond 70/30 deliberately votes **neutral**: an overbought reading is an
exhaustion warning, not momentum confirmation.

The six votes are correlated (all are functions of the same price series), so
6/6 is *not* six independent confirmations — treat STRONG as "trend is
unambiguous", which is also exactly when reversals surprise the most.

## Risk management (the part that actually matters)

- Stop at −2×ATR(14), target at +4×ATR: a fixed 1:2 risk/reward. With 1:2 you
  can be wrong 60% of the time and still break even.
- Position size = (capital × risk%) / (entry − stop). At the default 2%, a
  full stop-out costs 2% of the account. Ten consecutive stop-outs — which
  WILL eventually happen — cost ~18%. That's survivable; 10% per trade is not.
- Never widen a stop. Recompute the plan; don't negotiate with it.

## Reading a backtest honestly

- **Return vs Buy & Hold** is the only fair benchmark. A +12% strategy in a
  +20% market destroyed value while feeling productive.
- **Profit factor** below ~1.3 is noise. **Max drawdown** is the number your
  stomach will actually feel — ask if you'd keep following signals after
  living through it.
- **Trade count matters.** 180 days of daily bars produces a handful of
  trades; a 4-trade win rate of 75% means nothing statistically.
- This engine avoids lookahead bias (fills happen at the *next* open) and
  uses conservative stop-first tie-breaks, but it still ignores slippage,
  spreads and the psychological cost of following through. Real results will
  be worse than the backtest. Always.

## Paper trading rules of engagement

Treat the paper account like real money or it teaches you nothing:

1. Only take trades the system signals — no overrides.
2. Never touch stop or target after entry.
3. Log why you took each trade (watchlist notes work well).
4. Compare against the S&P 500 benchmark card after 3+ months, not 3 days.
5. If paper results and backtest results diverge wildly, the difference is
   usually you — timing, cherry-picking, or hesitation.

## Known biases you still carry

- **Survivorship**: this universe holds today's winners (NVDA, LLY…). A
  momentum backtest over hand-picked survivors flatters the strategy.
- **EOD granularity**: real intraday stops would fill at different prices.
- **Regime dependence**: even with ~10 years of data, a strategy tuned on one
  window can fail the moment the regime changes — always compare short and
  long backtest windows before trusting a result.

None of this is fixable with more features. It's fixable with humility and
position sizing.
