// indicators.js — technical indicators as pure functions over aligned arrays.
// Every function returns an array the same length as the input, with null
// where the indicator is not yet defined (warm-up period). No value is ever
// extrapolated or back-filled.

export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(values, n) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null;
  let seed = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < n - 1) { seed += values[i]; continue; }
    if (i === n - 1) { prev = (seed + values[i]) / n; }
    else { prev = values[i] * k + prev * (1 - k); }
    out[i] = prev;
  }
  return out;
}

// Wilder's RSI
export function rsi(values, n = 14) {
  const out = new Array(values.length).fill(null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    const gain = Math.max(ch, 0), loss = Math.max(-ch, 0);
    if (i <= n) {
      avgGain += gain / n;
      avgLoss += loss / n;
      if (i === n) out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    } else {
      avgGain = (avgGain * (n - 1) + gain) / n;
      avgLoss = (avgLoss * (n - 1) + loss) / n;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

export function macd(values, fast = 12, slow = 26, signalN = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const line = values.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i] - emaSlow[i] : null);

  // signal = EMA of the MACD line, computed only where the line exists
  const signal = new Array(values.length).fill(null);
  const k = 2 / (signalN + 1);
  let prev = null, seed = 0, count = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === null) continue;
    count++;
    if (count < signalN) { seed += line[i]; continue; }
    if (count === signalN) prev = (seed + line[i]) / signalN;
    else prev = line[i] * k + prev * (1 - k);
    signal[i] = prev;
  }
  const hist = line.map((v, i) =>
    v !== null && signal[i] !== null ? v - signal[i] : null);
  return { line, signal, hist };
}

export function bollinger(values, n = 20, mult = 2) {
  const mid = sma(values, n);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (values[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / n);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

export function obv(closes, volumes) {
  const out = new Array(closes.length).fill(null);
  let acc = 0;
  out[0] = 0;
  for (let i = 1; i < closes.length; i++) {
    const v = volumes[i] || 0;
    if (closes[i] > closes[i - 1]) acc += v;
    else if (closes[i] < closes[i - 1]) acc -= v;
    out[i] = acc;
  }
  return out;
}

// Wilder's ATR; falls back to |close-close| range when high/low are missing
// (index series sometimes lack intraday extremes).
export function atr(highs, lows, closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  let prev = null;
  for (let i = 1; i < closes.length; i++) {
    const h = highs[i] ?? closes[i];
    const l = lows[i] ?? closes[i];
    const tr = Math.max(h - l, Math.abs(h - closes[i - 1]), Math.abs(l - closes[i - 1]));
    if (i <= n) {
      prev = prev === null ? tr : prev + tr;
      if (i === n) { prev /= n; out[i] = prev; }
    } else {
      prev = (prev * (n - 1) + tr) / n;
      out[i] = prev;
    }
  }
  return out;
}

export function rollingMax(values, n) {
  const out = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    let m = -Infinity;
    for (let j = i - n + 1; j <= i; j++) m = Math.max(m, values[j]);
    out[i] = m;
  }
  return out;
}

export function rollingMin(values, n) {
  const out = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    let m = Infinity;
    for (let j = i - n + 1; j <= i; j++) m = Math.min(m, values[j]);
    out[i] = m;
  }
  return out;
}

// MM200 distance (Socinvest ruler): ratio = close / SMA200, measured against
// the asset's OWN history — z = (ratio − historical mean) / historical SD.
// Two z variants are returned:
//   zSeries  — full-sample mean/SD (matches the Socinvest app; display only)
//   zExp     — expanding window up to each bar (no lookahead; what backtests
//              must use, since the full-sample ruler peeks at the future)
export function mm200(closes, sma200arr, minObs = 60) {
  const n = closes.length;
  const ratio = closes.map((v, i) => sma200arr[i] ? v / sma200arr[i] : null);
  const obs = ratio.filter(v => v !== null);
  const out = { ratio, mean: null, sd: null, z: null,
                zSeries: new Array(n).fill(null), zExp: new Array(n).fill(null) };
  if (obs.length < minObs) return out;

  const mean = obs.reduce((s, v) => s + v, 0) / obs.length;
  const sd = Math.sqrt(obs.reduce((s, v) => s + (v - mean) ** 2, 0) / obs.length);
  out.mean = mean; out.sd = sd;
  if (sd > 0) {
    for (let i = 0; i < n; i++)
      if (ratio[i] !== null) out.zSeries[i] = (ratio[i] - mean) / sd;
    out.z = out.zSeries[n - 1];
  }

  let cnt = 0, sum = 0, sumsq = 0;
  for (let i = 0; i < n; i++) {
    const r = ratio[i];
    if (r === null) continue;
    cnt++; sum += r; sumsq += r * r;
    if (cnt < minObs) continue;
    const m = sum / cnt;
    const s = Math.sqrt(Math.max(sumsq / cnt - m * m, 0));
    if (s > 0) out.zExp[i] = (r - m) / s;
  }
  return out;
}

// Forward P/E expanding z aligned to daily bars (weekly source series).
// As-of join: each bar sees the latest weekly value published on or before
// its date, and the mean/SD use only values seen so far — no lookahead.
// Values are winsorized to [2, 100] before entering the statistics: near-zero
// earnings produce four-digit P/Es (SOX in the dot-com era) that would wreck
// a naive expanding mean.
export function fpeExpandingZ(bars, entry, minObs = 30) {
  if (!entry) return null;
  const zExp = new Array(bars.date.length).fill(null);
  const D = entry.dates, V = entry.values;
  let i = 0, n = 0, sum = 0, sumsq = 0, lastVal = null;
  for (let b = 0; b < bars.date.length; b++) {
    const d = bars.date[b];
    while (i < D.length && D[i] <= d) {
      let v = V[i];
      if (v !== null && v !== undefined) {
        v = Math.min(Math.max(v, 2), 100);
        n++; sum += v; sumsq += v * v; lastVal = v;
      }
      i++;
    }
    if (lastVal !== null && n >= minObs) {
      const m = sum / n;
      const s = Math.sqrt(Math.max(sumsq / n - m * m, 0));
      if (s > 0) zExp[b] = (lastVal - m) / s;
    }
  }
  return zExp;
}

// Convenience bundle: everything the app needs for one asset, computed once.
export function computeAll(bars) {
  const c = bars.close, v = bars.volume, h = bars.high, l = bars.low;
  const sma200v = sma(c, 200);
  return {
    sma20: sma(c, 20), sma50: sma(c, 50), sma200: sma200v,
    mm200: mm200(c, sma200v),
    ema12: ema(c, 12), ema26: ema(c, 26),
    rsi14: rsi(c, 14),
    macd: macd(c),
    boll: bollinger(c),
    obv: obv(c, v),
    volAvg20: sma(v.map(x => x || 0), 20),
    atr14: atr(h, l, c, 14),
    high55: rollingMax(c, 55),
    low20: rollingMin(c, 20),
  };
}
