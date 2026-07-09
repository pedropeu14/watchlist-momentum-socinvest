// signals.js — multi-confirmation signal engine.
// Six independent indicator "votes" at a given bar; each votes +1 (bullish),
// -1 (bearish) or 0 (neutral). A signal requires >= 3 aligned votes:
//   BUY  : bull - bear >= 3        SELL : bear - bull >= 3
//   STRONG 6 aligned | MEDIUM 4-5 | WEAK 3
// Confidence = aligned/6, penalized by opposing votes.

export const VOTE_NAMES = [
  "SMA trend (20/50)", "Long trend (50/200)", "EMA cross (12/26)",
  "RSI (14)", "MACD", "Bollinger + Volume/OBV",
];

export function votesAt(ind, bars, i) {
  const c = bars.close[i];
  const votes = [];

  // 1. Short/medium SMA structure
  if (ind.sma20[i] === null || ind.sma50[i] === null) votes.push(0);
  else if (c > ind.sma20[i] && ind.sma20[i] > ind.sma50[i]) votes.push(1);
  else if (c < ind.sma20[i] && ind.sma20[i] < ind.sma50[i]) votes.push(-1);
  else votes.push(0);

  // 2. Long-term structure (golden/death cross state)
  if (ind.sma50[i] === null || ind.sma200[i] === null) votes.push(0);
  else if (ind.sma50[i] > ind.sma200[i] && c > ind.sma200[i]) votes.push(1);
  else if (ind.sma50[i] < ind.sma200[i] && c < ind.sma200[i]) votes.push(-1);
  else votes.push(0);

  // 3. EMA 12/26 cross state
  if (ind.ema12[i] === null || ind.ema26[i] === null) votes.push(0);
  else votes.push(ind.ema12[i] > ind.ema26[i] ? 1 : -1);

  // 4. RSI regime: 55-70 bullish momentum, 30-45 bearish; extremes are
  //    exhaustion warnings, not momentum confirmation -> neutral.
  const r = ind.rsi14[i];
  if (r === null) votes.push(0);
  else if (r >= 55 && r < 70) votes.push(1);
  else if (r <= 45 && r > 30) votes.push(-1);
  else votes.push(0);

  // 5. MACD: line vs signal, weighted by histogram direction
  const h = ind.macd.hist[i], hPrev = ind.macd.hist[i - 1];
  if (h === null) votes.push(0);
  else if (h > 0 && (hPrev === null || h >= hPrev)) votes.push(1);
  else if (h < 0 && (hPrev === null || h <= hPrev)) votes.push(-1);
  else votes.push(0);

  // 6. Bollinger position confirmed by volume/OBV
  const mid = ind.boll.mid[i];
  const volOk = (bars.volume[i] || 0) > 0 && ind.volAvg20[i] > 0
    ? (bars.volume[i] / ind.volAvg20[i]) : null;
  const obvRising = i >= 5 && ind.obv[i] !== null && ind.obv[i - 5] !== null
    ? ind.obv[i] > ind.obv[i - 5] : null;
  if (mid === null) votes.push(0);
  else if (c > mid && (obvRising === true || (volOk !== null && volOk > 1.2))) votes.push(1);
  else if (c < mid && (obvRising === false || (volOk !== null && volOk > 1.2))) votes.push(-1);
  else votes.push(0);

  return votes;
}

export function signalAt(ind, bars, i) {
  const votes = votesAt(ind, bars, i);
  const bull = votes.filter(v => v === 1).length;
  const bear = votes.filter(v => v === -1).length;
  let action = "HOLD", aligned = 0;
  if (bull - bear >= 3) { action = "BUY"; aligned = bull; }
  else if (bear - bull >= 3) { action = "SELL"; aligned = bear; }
  const strength = aligned >= 6 ? "STRONG" : aligned >= 4 ? "MEDIUM"
    : aligned >= 3 ? "WEAK" : null;
  const opposing = action === "BUY" ? bear : action === "SELL" ? bull : 0;
  const confidence = action === "HOLD" ? 0
    : Math.round(100 * (aligned - 0.5 * opposing) / 6);
  return { action, strength, confidence, votes, bull, bear, index: i };
}

export function latestSignal(ind, bars) {
  return signalAt(ind, bars, bars.close.length - 1);
}
