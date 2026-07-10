#!/usr/bin/env python3
"""
build_fpe.py — forward P/E layer from the Socinvest project.

Reads pe_fwd.json published by the Socinvest tool (weekly Bloomberg forward
P/E series since 2002, refreshed manually by the user) and writes
data/fpe.json keyed by this app's tickers.

The ruler matches the Socinvest CHART (not the full series): a ROLLING
3-YEAR window (156 weekly points), centered on the MEDIAN with a robust
sigma of (P84 − P16) / 2, z = (last − median) / sigma. Rationale: multiples
re-rate structurally (META's 2022 crash at 9x would anchor a full-history
ruler forever, so "cheap" would never fire again); a rolling window measures
cheap/expensive vs what the market has been paying in the CURRENT regime.
Percentiles also make outliers (near-zero-earnings P/Es) harmless without
winsorization.

Coverage is whatever the Bloomberg export contains (the original Socinvest
universe); assets without a series simply show "—" in the app.

Deliberate exclusion: "SX7E Index" is the EURO STOXX *Banks* forward P/E,
but this app's SX7E price series tracks the STOXX Europe 600 (^STOXX, per
the original request's description). Attaching a banks multiple to a broad-
index price would be silently wrong, so SX7E gets no forward P/E here.

Stdlib only; runs locally and in CI (continue-on-error — optional layer).
"""

import json
import math
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA_DIR = os.path.join(ROOT, "data")
UNIVERSE = os.path.join(HERE, "universe.json")

SOURCE_URL = "https://pedropeu14.github.io/Socinvest/pe_fwd.json"
SKIP = {
    "SX7E Index": "Bloomberg SX7E = EURO STOXX Banks; app price series is STOXX Europe 600",
    "ARA CN Equity": "Canadian listing — a different company from the delisted US ARA in the universe",
}
# Floor matches the Socinvest source (30 weekly points). Rulers with n < 52
# are statistically thin — the app labels them "still forming" in the modal.
MIN_OBS = 30
WINDOW_WEEKS = 156   # rolling 3-year ruler, same as the Socinvest chart


def pctile(sorted_vals, p):
    k = (len(sorted_vals) - 1) * p
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


def bloomberg_to_ticker(key):
    """'AAPL US Equity' -> 'AAPL', 'SPX Index' -> 'SPX', 'ASML NA Equity' -> 'ASML'."""
    return key.split()[0]


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else SOURCE_URL
    print(f"reading forward P/E source: {src}")
    if os.path.exists(src):
        raw = json.load(open(src, encoding="utf-8"))
    else:
        req = urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = json.load(resp)

    with open(UNIVERSE, encoding="utf-8") as f:
        universe = {a["ticker"] for a in json.load(f)["assets"]}

    out_tickers = {}
    skipped = []
    for key, entry in raw.items():
        if key in SKIP:
            skipped.append((key, SKIP[key]))
            continue
        t = bloomberg_to_ticker(key)
        if t not in universe:
            skipped.append((key, "not in universe"))
            continue
        dates = entry["dates"]
        values = entry["ratio"]
        pairs = [(d, v) for d, v in zip(dates, values) if v is not None]
        if len(pairs) < MIN_OBS:
            skipped.append((key, f"only {len(pairs)} points"))
            continue
        window = pairs[-WINDOW_WEEKS:]
        wvals = sorted(v for _, v in window)
        med = pctile(wvals, 0.5)
        p16, p84 = pctile(wvals, 0.16), pctile(wvals, 0.84)
        sd = (p84 - p16) / 2
        last = pairs[-1][1]
        out_tickers[t] = {
            "dates": [d for d, _ in pairs],
            "values": [round(v, 3) for _, v in pairs],
            "mean": round(med, 3),          # ruler center = rolling-window MEDIAN
            "sd": round(sd, 3),             # robust sigma = (P84 − P16) / 2
            "p16": round(p16, 3),
            "p84": round(p84, 3),
            "window_weeks": len(window),
            "method": "median ± (P84−P16)/2 over rolling 3y window",
            "last": round(last, 3),
            "last_date": pairs[-1][0],
            "z": round((last - med) / sd, 3) if sd else None,
            "n": len(pairs),
        }
        print(f"  {t:8s} {len(pairs):4d} wk (window {len(window):3d})  "
              f"last {last:7.2f}  med {med:6.2f} ± {sd:5.2f}  "
              f"z {((last-med)/sd if sd else 0):+.2f}")

    out = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": SOURCE_URL,
        "cadence": "weekly (Bloomberg export, refreshed manually in the Socinvest project)",
        "note": ("Forward P/E divides price by PROJECTED consensus earnings — "
                 "the denominator moves on estimate revisions, not only on price. "
                 "Ruler = each asset vs its own full history (same method as MM200)."),
        "tickers": out_tickers,
    }
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(os.path.join(DATA_DIR, "fpe.json"), "w", encoding="utf-8") as f:
        json.dump(out, f)

    print(f"\nfpe.json: {len(out_tickers)} tickers with forward P/E rulers")
    for k, why in skipped:
        print(f"  skipped {k}: {why}")
    return 0 if out_tickers else 1


if __name__ == "__main__":
    sys.exit(main())
