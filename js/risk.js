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

export function positionSize(capital, riskPct, plan) {
  if (!plan || plan.riskPerShare <= 0) return 0;
  const riskBudget = capital * (riskPct / 100);
  const shares = Math.floor(riskBudget / plan.riskPerShare);
  // never allocate more than the whole capital
  return Math.max(0, Math.min(shares, Math.floor(capital / plan.entry)));
}
