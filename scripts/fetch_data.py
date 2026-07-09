#!/usr/bin/env python3
"""
fetch_data.py — daily OHLCV snapshot for the Watchlist Momentum universe.

Pulls up to 10 years of daily bars per asset from the Yahoo Finance chart API
(no key required) and writes one JSON per ticker under data/, plus a
manifest.json the web app reads. Stdlib only.

GitHub Pages cannot call market APIs from the browser (CORS), so this script
runs server-side: locally before `python -m http.server`, and daily in CI via
.github/workflows/update-data.yml. The site only ever reads its own data/.

Every number in data/ is a real exchange close as reported by Yahoo. Assets
whose source is unavailable (e.g. delisted) are listed in the manifest with
available=false — never filled with synthetic values.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA_DIR = os.path.join(ROOT, "data")
UNIVERSE = os.path.join(HERE, "universe.json")

# 10y of daily bars: long enough for a meaningful MM200 ruler (~9y of ratio
# observations) and multi-year backtests, small enough (~250KB/asset) that the
# static site still loads fast. "max" would be 3-8x heavier for little gain.
CHART_URL = ("https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
             "?interval=1d&range=10y")
HEADERS = {"User-Agent": "Mozilla/5.0"}
PAUSE_S = 0.35          # be polite; ~3 req/s max
RETRIES = 2


def fetch_bars(yahoo_symbol: str) -> dict:
    """Daily OHLCV for one symbol. Raises on failure after retries."""
    url = CHART_URL.format(symbol=urllib.parse.quote(yahoo_symbol))
    last_err = None
    for attempt in range(RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = json.load(resp)
            result = payload["chart"]["result"][0]
            meta = result["meta"]
            ts = result.get("timestamp") or []
            quote = result["indicators"]["quote"][0]
            bars = {"date": [], "open": [], "high": [], "low": [],
                    "close": [], "volume": []}
            for i, t in enumerate(ts):
                c = quote["close"][i]
                if c is None:          # holiday/half-session artifacts
                    continue
                bars["date"].append(
                    datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m-%d"))
                bars["open"].append(quote["open"][i])
                bars["high"].append(quote["high"][i])
                bars["low"].append(quote["low"][i])
                bars["close"].append(c)
                bars["volume"].append(quote["volume"][i])
            if len(bars["close"]) < 60:
                raise ValueError(f"only {len(bars['close'])} usable bars")
            return {
                "currency": meta.get("currency"),
                "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
                "regular_market_price": meta.get("regularMarketPrice"),
                "bars": bars,
            }
        except Exception as e:   # noqa: BLE001 — retried, then surfaced to caller
            last_err = e
            if attempt < RETRIES:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{yahoo_symbol}: {last_err}")


def main() -> int:
    with open(UNIVERSE, encoding="utf-8") as f:
        assets = json.load(f)["assets"]

    os.makedirs(DATA_DIR, exist_ok=True)
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest = {"fetched_at": fetched_at, "source": "Yahoo Finance (EOD)",
                "assets": []}
    failures = []

    for asset in assets:
        entry = {k: asset[k] for k in ("ticker", "name", "sector", "group")}
        if asset.get("note"):
            entry["note"] = asset["note"]
        entry["yahoo"] = asset["yahoo"]

        if not asset["yahoo"]:
            entry["available"] = False
            entry["reason"] = "no data source (see note)"
            manifest["assets"].append(entry)
            print(f"SKIP  {asset['ticker']:8s} no data source")
            continue

        try:
            data = fetch_bars(asset["yahoo"])
        except RuntimeError as e:
            entry["available"] = False
            entry["reason"] = str(e)
            failures.append(asset["ticker"])
            manifest["assets"].append(entry)
            print(f"FAIL  {asset['ticker']:8s} {e}")
            time.sleep(PAUSE_S)
            continue

        fname = asset["ticker"].replace("/", "-") + ".json"
        with open(os.path.join(DATA_DIR, fname), "w", encoding="utf-8") as f:
            json.dump({"ticker": asset["ticker"], "fetched_at": fetched_at,
                       **data}, f)
        entry["available"] = True
        entry["file"] = fname
        entry["currency"] = data["currency"]
        entry["last_date"] = data["bars"]["date"][-1]
        entry["last_close"] = data["bars"]["close"][-1]
        entry["bar_count"] = len(data["bars"]["close"])
        manifest["assets"].append(entry)
        print(f"OK    {asset['ticker']:8s} {entry['bar_count']} bars, "
              f"last {entry['last_date']} close {entry['last_close']}")
        time.sleep(PAUSE_S)

    with open(os.path.join(DATA_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)

    ok = sum(1 for a in manifest["assets"] if a.get("available"))
    print(f"\n{ok}/{len(assets)} assets written to data/ "
          f"({len(failures)} failed: {', '.join(failures) or 'none'})")
    # Only hard-fail when nothing could be fetched; partial data is still useful.
    return 0 if ok > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
