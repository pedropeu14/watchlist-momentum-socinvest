// store.js — namespaced localStorage persistence (paper trading, portfolio,
// watchlists, alerts, settings). Everything the app "remembers" lives here;
// clearing browser storage resets the app to factory state.

const NS = "mtpe:"; // legacy prefix kept stable so existing browser data survives renames

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

export function save(key, value) {
  localStorage.setItem(NS + key, JSON.stringify(value));
}

export function remove(key) {
  localStorage.removeItem(NS + key);
}

export function exportAll() {
  const dump = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(NS)) dump[k.slice(NS.length)] = JSON.parse(localStorage.getItem(k));
  }
  return dump;
}

export function importAll(dump) {
  for (const [k, v] of Object.entries(dump)) save(k, v);
}

export const DEFAULT_SETTINGS = {
  theme: "light",
  paperCapital: 10000,
  riskPct: 2,
  minVotes: 3,
};

export function settings() {
  return { ...DEFAULT_SETTINGS, ...load("settings", {}) };
}
