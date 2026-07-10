// charts.js — dependency-free SVG charts (price+overlays, RSI, MACD, equity).
// Returns SVG markup strings; the caller injects them into the DOM.

const M = { top: 10, right: 52, bottom: 22, left: 8 };

function scales(width, height, xs, ysMin, ysMax) {
  const iw = width - M.left - M.right, ih = height - M.top - M.bottom;
  const x = i => M.left + (xs <= 1 ? 0 : (i / (xs - 1)) * iw);
  const pad = (ysMax - ysMin) * 0.05 || 1;
  const lo = ysMin - pad, hi = ysMax + pad;
  const y = v => M.top + ih - ((v - lo) / (hi - lo)) * ih;
  return { x, y, lo, hi, iw, ih };
}

function pathOf(values, x, y, from = 0) {
  let d = "", pen = false;
  for (let i = from; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined || Number.isNaN(v)) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${x(i - from).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  }
  return d;
}

function axisLabels(y, lo, hi, width, fmt) {
  let out = "";
  for (let k = 0; k <= 4; k++) {
    const v = lo + (k / 4) * (hi - lo);
    out += `<text x="${width - M.right + 4}" y="${y(v) + 3}" class="ax">${fmt(v)}</text>`;
    out += `<line x1="${M.left}" x2="${width - M.right}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`;
  }
  return out;
}

function dateTicks(dates, x, height) {
  let out = "";
  const step = Math.max(1, Math.floor(dates.length / 6));
  for (let i = 0; i < dates.length; i += step) {
    out += `<text x="${x(i)}" y="${height - 6}" class="ax mid">${dates[i].slice(2)}</text>`;
  }
  return out;
}

const fmtP = v => Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2);

// Price chart: close line, SMA20/50/200, Bollinger band, volume footer.
export function priceChart(bars, ind, days, width = 860, height = 340) {
  const n = bars.close.length, from = Math.max(0, n - days);
  const dates = bars.date.slice(from);
  const len = dates.length;
  const series = [bars.close, ind.sma20, ind.sma50, ind.sma200,
                  ind.boll.upper, ind.boll.lower]
    .flatMap(s => s.slice(from).filter(v => v !== null));
  const { x, y, lo, hi } = scales(width, height - 50, len,
    Math.min(...series), Math.max(...series));

  const slice = s => s.slice(from);
  // Bollinger band fill
  let band = "";
  const up = slice(ind.boll.upper), lw = slice(ind.boll.lower);
  if (up.some(v => v !== null)) {
    const back = [...lw.keys()].reverse()
      .filter(i => lw[i] !== null)
      .map(i => `L${x(i).toFixed(1)},${y(lw[i]).toFixed(1)}`).join("");
    band = `<path d="${pathOf(up, x, y)}${back}Z" class="bollband"/>`;
  }

  // volume footer
  const vols = slice(bars.volume).map(v => v || 0);
  const vmax = Math.max(...vols, 1);
  const vh = 36, vy0 = height - M.bottom;
  const bw = Math.max(1, (width - M.left - M.right) / len - 1);
  let volBars = "";
  for (let i = 0; i < len; i++) {
    const hgt = (vols[i] / vmax) * vh;
    const upDay = i > 0 ? slice(bars.close)[i] >= slice(bars.close)[i - 1] : true;
    volBars += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${(vy0 - hgt).toFixed(1)}" width="${bw.toFixed(1)}" height="${hgt.toFixed(1)}" class="${upDay ? "volu" : "vold"}"/>`;
  }

  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="chart">
    ${axisLabels(y, lo, hi, width, fmtP)}
    ${band}
    <path d="${pathOf(slice(ind.sma200), x, y)}" class="l200"/>
    <path d="${pathOf(slice(ind.sma50), x, y)}" class="l50"/>
    <path d="${pathOf(slice(ind.sma20), x, y)}" class="l20"/>
    <path d="${pathOf(slice(bars.close), x, y)}" class="lprice"/>
    ${volBars}
    ${dateTicks(dates, x, height)}
  </svg>`;
}

export function rsiChart(bars, ind, days, width = 860, height = 110) {
  const n = bars.close.length, from = Math.max(0, n - days);
  const vals = ind.rsi14.slice(from);
  const { x, y } = scales(width, height, vals.length, 0, 100);
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="chart">
    <rect x="${M.left}" y="${y(70)}" width="${width - M.left - M.right}" height="${y(30) - y(70)}" class="rsiband"/>
    <line x1="${M.left}" x2="${width - M.right}" y1="${y(70)}" y2="${y(70)}" class="lim"/>
    <line x1="${M.left}" x2="${width - M.right}" y1="${y(30)}" y2="${y(30)}" class="lim"/>
    <text x="${width - M.right + 4}" y="${y(70) + 3}" class="ax">70</text>
    <text x="${width - M.right + 4}" y="${y(30) + 3}" class="ax">30</text>
    <path d="${pathOf(vals, x, y)}" class="lrsi"/>
  </svg>`;
}

export function macdChart(bars, ind, days, width = 860, height = 110) {
  const n = bars.close.length, from = Math.max(0, n - days);
  const line = ind.macd.line.slice(from), sig = ind.macd.signal.slice(from),
        hist = ind.macd.hist.slice(from);
  const all = [...line, ...sig, ...hist].filter(v => v !== null);
  if (!all.length) return "";
  const { x, y } = scales(width, height, line.length, Math.min(...all), Math.max(...all));
  const bw = Math.max(1, (width - M.left - M.right) / line.length - 1);
  let bars_ = "";
  for (let i = 0; i < hist.length; i++) {
    if (hist[i] === null) continue;
    const y0 = y(0), y1 = y(hist[i]);
    bars_ += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.abs(y1 - y0).toFixed(1)}" class="${hist[i] >= 0 ? "volu" : "vold"}"/>`;
  }
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="chart">
    <line x1="${M.left}" x2="${width - M.right}" y1="${y(0)}" y2="${y(0)}" class="lim"/>
    ${bars_}
    <path d="${pathOf(line, x, y)}" class="lmacd"/>
    <path d="${pathOf(sig, x, y)}" class="lsig"/>
  </svg>`;
}

// MM200 ratio (close / SMA200) with the asset's own historical mean and ±1σ
// band — the Socinvest ruler. Dashed lines: mean (grey), ±1σ (amber).
export function mm200Chart(bars, ind, days, width = 860, height = 150) {
  const m = ind.mm200;
  if (m.mean === null || m.sd === null) return "";
  const n = bars.close.length, from = Math.max(0, n - days);
  const vals = m.ratio.slice(from);
  const clean = vals.filter(v => v !== null);
  if (clean.length < 2) return "";
  const lo = Math.min(...clean, m.mean - m.sd), hi = Math.max(...clean, m.mean + m.sd);
  const { x, y } = scales(width, height, vals.length, lo, hi);
  const line = lv => `<line x1="${M.left}" x2="${width - M.right}" y1="${y(lv)}" y2="${y(lv)}" class="lim"/>
    <text x="${width - M.right + 4}" y="${y(lv) + 3}" class="ax">${lv.toFixed(2)}</text>`;
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="chart">
    <rect x="${M.left}" y="${y(m.mean + m.sd)}" width="${width - M.left - M.right}"
      height="${Math.abs(y(m.mean - m.sd) - y(m.mean + m.sd)).toFixed(1)}" class="rsiband"/>
    ${line(m.mean + m.sd)}${line(m.mean)}${line(m.mean - m.sd)}
    <path d="${pathOf(vals, x, y)}" class="lprice"/>
  </svg>`;
}

// Forward P/E — shows the SAME window the ruler is computed on (rolling 3y,
// like the Socinvest chart), with median and P16/P84 percentile bands.
// Display clamped to median ± 4σ so an outlier can't squash the chart flat.
export function fpeChart(entry, width = 860, height = 150) {
  if (!entry || entry.sd === null) return "";
  const from = Math.max(0, entry.values.length - (entry.window_weeks || 156));
  const cap = entry.mean + 4 * entry.sd;
  const floor0 = Math.max(0, entry.mean - 4 * entry.sd);
  const vals = entry.values.slice(from).map(v => Math.min(Math.max(v, floor0), cap));
  const dates = entry.dates.slice(from);
  const lo = Math.min(...vals, entry.p16 ?? entry.mean - entry.sd);
  const hi = Math.max(...vals, entry.p84 ?? entry.mean + entry.sd);
  const { x, y } = scales(width, height, vals.length, lo, hi);
  const upper = entry.p84 ?? entry.mean + entry.sd;
  const lower = entry.p16 ?? entry.mean - entry.sd;
  const line = lv => `<line x1="${M.left}" x2="${width - M.right}" y1="${y(lv)}" y2="${y(lv)}" class="lim"/>
    <text x="${width - M.right + 4}" y="${y(lv) + 3}" class="ax">${lv.toFixed(1)}</text>`;
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="chart">
    <rect x="${M.left}" y="${y(upper)}" width="${width - M.left - M.right}"
      height="${Math.abs(y(lower) - y(upper)).toFixed(1)}" class="rsiband"/>
    ${line(upper)}${line(entry.mean)}${line(lower)}
    <path d="${pathOf(vals, x, y)}" class="lprice"/>
    ${dateTicks(dates, x, height)}
  </svg>`;
}

export function equityChart(equity, dates, capital0, width = 860, height = 220) {
  if (!equity.length) return "";
  const { x, y, lo, hi } = scales(width, height, equity.length,
    Math.min(...equity, capital0), Math.max(...equity, capital0));
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="chart">
    ${axisLabels(y, lo, hi, width, v => "$" + v.toFixed(0))}
    <line x1="${M.left}" x2="${width - M.right}" y1="${y(capital0)}" y2="${y(capital0)}" class="lim"/>
    <path d="${pathOf(equity, x, y)}" class="lequity"/>
    ${dateTicks(dates, x, height)}
  </svg>`;
}

export function sparkline(values, width = 120, height = 32) {
  const clean = values.filter(v => v !== null);
  if (clean.length < 2) return "";
  const { x, y } = scales(width, height, values.length,
    Math.min(...clean), Math.max(...clean));
  const up = clean[clean.length - 1] >= clean[0];
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="spark">
    <path d="${pathOf(values, x, y)}" class="${up ? "sup" : "sdn"}"/>
  </svg>`;
}
