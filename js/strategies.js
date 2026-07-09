// strategies.js — entry/exit rules, long-only, evaluated on bar close.
// Each strategy returns {enter, exit} predicates over (ind, bars, i, state).
// The "Dividend Growth" strategy from the original spec is NOT implemented:
// the free EOD source carries no dividend history, and we don't fabricate
// inputs. Buy & Hold serves as the passive benchmark instead.

import { signalAt } from "./signals.js";

export const STRATEGIES = {
  momentum: {
    label: "Momentum (multi-confirmation)",
    describe: "Enter on BUY signal (>=3 of 6 indicators aligned); exit on signal decay, stop or target.",
    enter(ind, bars, i) {
      return signalAt(ind, bars, i).action === "BUY";
    },
    exit(ind, bars, i) {
      const s = signalAt(ind, bars, i);
      return s.bull - s.bear <= 0;
    },
    useStops: true,
  },

  meanReversion: {
    label: "Mean Reversion (RSI + Bollinger)",
    describe: "Enter oversold (RSI<30 and close below lower band) in an uptrend; exit at the middle band or RSI>55.",
    enter(ind, bars, i) {
      const r = ind.rsi14[i], lower = ind.boll.lower[i], s200 = ind.sma200[i];
      return r !== null && lower !== null && r < 30 && bars.close[i] < lower
        && (s200 === null || bars.close[i] > 0.85 * s200); // avoid falling knives far below trend
    },
    exit(ind, bars, i) {
      const r = ind.rsi14[i], mid = ind.boll.mid[i];
      return (r !== null && r > 55) || (mid !== null && bars.close[i] >= mid);
    },
    useStops: true,
  },

  breakout: {
    label: "Breakout (55-day Donchian)",
    describe: "Enter on a close at a new 55-day high with above-average volume; exit on a close below the 20-day low.",
    enter(ind, bars, i) {
      const hi = ind.high55[i - 1]; // breakout vs prior window, not including today
      const volOk = ind.volAvg20[i] > 0 && (bars.volume[i] || 0) > 1.3 * ind.volAvg20[i];
      return hi !== null && bars.close[i] > hi && volOk;
    },
    exit(ind, bars, i) {
      const lo = ind.low20[i - 1];
      return lo !== null && bars.close[i] < lo;
    },
    useStops: true,
  },

  mm200Reversion: {
    label: "MM200 Reversion (±1σ)",
    describe: "Socinvest ruler: buy when price sits 1σ below its own historical distance to the 200-day average, sell at 1σ above. The z-score here is expanding-window (no lookahead), so backtest values can differ slightly from the full-history ruler shown elsewhere. No ATR stops — the pure rule, as stated.",
    enter(ind, bars, i) {
      const z = ind.mm200.zExp[i];
      return z !== null && z <= -1;
    },
    exit(ind, bars, i) {
      const z = ind.mm200.zExp[i];
      return z !== null && z >= 1;
    },
    useStops: false,
  },

  buyHold: {
    label: "Buy & Hold (benchmark)",
    describe: "Buy on the first tradable bar of the window, never sell. The bar every active strategy must beat.",
    enter(ind, bars, i, state) { return !state.everEntered; },
    exit() { return false; },
    useStops: false,
  },
};
