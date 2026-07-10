#!/usr/bin/env python3
"""
build_fpe.py — forward P/E layer from the Socinvest project.

Reads pe_fwd.json published by the Socinvest tool (weekly Bloomberg forward
P/E series since 2002, refreshed manually by the user) and writes
data/fpe.json keyed by this app's tickers. The statistical ruler is the same
one used for the MM200: each asset against its OWN history — mean and
population SD over the full series, z = (last − mean) / sd.

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
MIN_OBS = 52   # at least a year of weekly points before the ruler means anything


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
        # The Socinvest source computes ROBUST mean/sd (outlier-resistant) —
        # essential for series like SOX, where the dot-com era had near-zero
        # earnings and four-digit P/Es that wreck naive statistics. Use theirs.
        mean, sd = entry["mean"], entry["sd"]
        last = pairs[-1][1]
        out_tickers[t] = {
            "dates": [d for d, _ in pairs],
            "values": [round(v, 3) for _, v in pairs],
            "mean": round(mean, 3),
            "sd": round(sd, 3),
            "robust": bool(entry.get("robust")),
            "last": round(last, 3),
            "last_date": pairs[-1][0],
            "z": round((last - mean) / sd, 3) if sd else None,
            "n": len(pairs),
        }
        print(f"  {t:8s} {len(pairs):4d} wk  {pairs[0][0]} -> {pairs[-1][0]}  "
              f"last {last:7.2f}  mean {mean:6.2f} ± {sd:5.2f}  z {(last-mean)/sd:+.2f}")

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
