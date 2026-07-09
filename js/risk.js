// risk.js — ATR-based trade plan and position sizing.
// Long plan: stop = entry - 2*ATR, target = entry + 4*ATR (1:2 risk/reward).
// Size caps risk at riskPct of capital (default 2%).

export function tradePlan(entry, atrValue, side = "long") {
  if (entry == null || atrValue == null || atrValue <= 0) return null;
  const dir = side === "short" ? -1 : 1;
  const stop = entry - dir * 2 * atrValue;
  const target = entry + dir * 4 * atrValue;
  return {
    side, entry, stop, target, atr: atrValue,
    riskPerShare: Math.abs(entry - stop),
    rewardRisk: 2,
  };
}

// fractional=true is used for index assets: nobody buys "1 Nasdaq" — real
// exposure comes via ETFs/futures where any dollar amount works. Quantities
// are floored to 4 decimals so a position never overspends available cash.
export function positionSize(capital, riskPct, plan, fractional = false) {
  if (!plan || plan.riskPerShare <= 0) return 0;
  const riskBudget = capital * (riskPct / 100);
  const raw = riskBudget / plan.riskPerShare;
  const affordable = capital / plan.entry; // never allocate more than the whole capital
  if (fractional) return Math.max(0, Math.floor(Math.min(raw, affordable) * 1e4) / 1e4);
  return Math.max(0, Math.min(Math.floor(raw), Math.floor(affordable)));
}
