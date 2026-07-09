#!/usr/bin/env python3
"""
build_13f.py — smart-money layer from the user's own 13F dashboard.

Reads the embedded dataset of https://pedropeu14.github.io/13-Files/
(13f_dashboard.html, `const D = {...}`), maps CUSIPs to tickers, and writes
data/f13.json with, for every ticker in our universe: how many of the 38
tracked managers hold it, what they did last quarter (opened / increased /
decreased / closed), and each position's share of that manager's portfolio.

CUSIP -> ticker mapping is deliberately paranoid:
 1. candidate tickers come from name-matching the 13F issuer against the
    SEC's own company_tickers.json (same source the fundamentals pipeline
    uses);
 2. every candidate is VERIFIED by price: the 13F implied price
    (value/shares, median across managers) must sit within 12% of the real
    Yahoo close at the quarter end. No verification, no mapping — a wrong
    ticker is worse than a missing one.

Also prints the "consensus picks" (most-held stocks not yet in the universe)
so they can be reviewed and added to universe.json by hand — the universe is
curated, never auto-mutated.

Stdlib only. Run after (or before) fetch_data.py; the app treats f13.json as
optional enrichment.
"""

import json
import os
import re
import sys
import time
import urllib.request
from collections import defaultdict
from statistics import median

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA_DIR = os.path.join(ROOT, "data")
UNIVERSE = os.path.join(HERE, "universe.json")

DASHBOARD_URL = "https://pedropeu14.github.io/13-Files/13f_dashboard.html"
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
CHART_URL = ("https://query1.finance.yahoo.com/v8/finance/chart/{t}"
             "?interval=1d&range=2y")
HEADERS = {"User-Agent": "Mozilla/5.0"}
# SEC requires a User-Agent with real contact info (name + email)
SEC_HEADERS = {"User-Agent": os.environ.get(
    "SEC_USER_AGENT", "Pedro Amorim pedrof.amorim@gmail.com")}
PRICE_TOLERANCE = 0.12     # implied vs real close, relative
MIN_HOLDERS_PICK = 4       # consensus picks: held by at least N managers
MAX_PICKS = 30

STOPWORDS = {"INC", "CORP", "CORPORATION", "INCORPORATED", "CO", "COMPANY",
             "COMPANIES", "LTD", "PLC", "HOLDINGS", "HOLDING", "HLDGS",
             "HLDG", "GROUP", "GRP", "THE", "COM", "NEW", "DEL", "CL", "A",
             "B", "C", "SA", "NV", "SE", "LP", "TRUST", "TR", "ADR", "ADS",
             "INTERNATIONAL", "INTL"}

# Same company, different share class of a name already in the universe —
# mapped and shown, but never proposed as a "new pick".
SAME_COMPANY = {"GOOG", "BRK-A", "BRK-B"}

# Name matching fails on a few (renames, word games); candidates listed here
# still go through the same price verification — a wrong guess is rejected.
OVERRIDES = {
    "57636Q104": ["MA"],    # MASTERCARD INCORPORATED
    "369604301": ["GE"],    # GE AEROSPACE (SEC title: General Electric)
    "254687106": ["DIS"],   # DISNEY WALT CO
    "09857L108": ["BKNG"],  # BOOKING HOLDINGS
    "14040H105": ["COF"],   # CAPITAL ONE FINL
    "146869102": ["CVNA"],  # CARVANA
    "038222105": ["AMAT"],  # APPLIED MATLS
    "538034109": ["LYV"],   # LIVE NATION
    "253393102": ["DKS"],   # DICKS SPORTING GOODS
    "060505104": ["BAC"],   # BK OF AMERICA
    "674599105": ["OXY"],   # OCCIDENTAL PETE
    "136375102": ["CNI"],   # CANADIAN NATL RY
}


def _words(s):
    s = re.sub(r"[^A-Z0-9 ]", " ", s.upper())
    return [w for w in s.split() if w not in STOPWORDS]


def norm_sorted(s):
    return " ".join(sorted(_words(s)))   # word order doesn't matter


def norm_seq(s):
    return " ".join(_words(s))           # keeps order, for prefix matches


def fetch(url, timeout=60):
    hdrs = SEC_HEADERS if "sec.gov" in url else HEADERS
    req = urllib.request.Request(url, headers=hdrs)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def yahoo_close_at(ticker, date):
    """Real close on `date` (or the nearest earlier session); None if n/a."""
    try:
        raw = json.loads(fetch(CHART_URL.format(t=urllib.request.quote(ticker)), 30))
        res = raw["chart"]["result"][0]
        ts, quote = res.get("timestamp") or [], res["indicators"]["quote"][0]
        best = None
        for i, t in enumerate(ts):
            d = time.strftime("%Y-%m-%d", time.gmtime(t))
            c = quote["close"][i]
            if c is not None and d <= date:
                best = c
        return best
    except Exception:
        return None


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DASHBOARD_URL
    print(f"reading 13F dashboard: {src}")
    html = open(src, encoding="utf-8", errors="replace").read() \
        if os.path.exists(src) else fetch(src)
    start = html.index("{", html.find("const D = "))
    D, _ = json.JSONDecoder().raw_decode(html[start:])

    periods = D["periods"]
    as_of = periods[-1]
    pair = f"{periods[-2]}__{periods[-1]}"
    mgr_name = {m["slug"]: m["manager"] for m in D["managers"]}
    mgr_total = {m["slug"]: m["latest"]["total"] for m in D["managers"]}

    # --- aggregate latest-quarter holdings per CUSIP (common shares only) ---
    by_cusip = defaultdict(list)   # cusip -> [(slug, value, shares)]
    issuer = {}
    for slug, per in D["holdings"].items():
        for row in per.get(as_of, []):
            cusip, name, cls, put_call, value, shares = row
            if put_call or not shares:
                continue
            by_cusip[cusip].append((slug, value, shares))
            issuer[cusip] = name

    # last-quarter consensus actions per CUSIP
    actions = {}
    for row in D["consensus"].get(pair, []):
        if row["put_call"]:
            continue
        actions[row["cusip"]] = row

    # --- SEC name -> ticker candidates ---
    print("loading SEC company_tickers.json…")
    sec = json.loads(fetch(SEC_TICKERS_URL))
    cand_sorted = defaultdict(list)   # order-insensitive exact match
    cand_seq = defaultdict(list)      # order-preserving, for prefix match
    for e in sec.values():
        cand_sorted[norm_sorted(e["title"])].append(e["ticker"])
        cand_seq[norm_seq(e["title"])].append(e["ticker"])

    # --- map the cusips that matter (universe names + consensus picks) ---
    with open(UNIVERSE, encoding="utf-8") as f:
        # universe uses BRK/B, Yahoo uses BRK-B — compare in Yahoo notation
        universe = {a["ticker"].replace("/", "-")
                    for a in json.load(f)["assets"]}
    ranked = sorted(by_cusip.items(),
                    key=lambda kv: (-len(kv[1]), -sum(v for _, v, _ in kv[1])))

    mapping, unmapped = {}, []
    for cusip, rows in ranked:
        if len(rows) < 2:      # nobody cares about single-holder names here
            continue
        tickers = (OVERRIDES.get(cusip)
                   or cand_sorted.get(norm_sorted(issuer[cusip]))
                   or cand_seq.get(norm_seq(issuer[cusip])) or [])
        if not tickers:        # relaxed: SEC title starting with the (often
            nseq = norm_seq(issuer[cusip])  # truncated) 13F issuer name
            tickers = [t for k, ts in cand_seq.items()
                       if k.startswith(nseq) and len(nseq) >= 6 for t in ts]
        if not tickers:
            unmapped.append((cusip, issuer[cusip], len(rows)))
            continue
        implied = median(v / s for _, v, s in rows)
        best, best_dev = None, PRICE_TOLERANCE
        for t in sorted(set(tickers))[:4]:
            close = yahoo_close_at(t, as_of)
            time.sleep(0.3)
            if not close:
                continue
            dev = abs(implied / close - 1)
            if dev < best_dev:
                best, best_dev = t, dev
        if best:
            mapping[cusip] = best
            print(f"  map {cusip} {issuer[cusip][:32]:34s} -> {best:6s} "
                  f"(implied {implied:,.2f}, dev {best_dev:.1%}, {len(rows)} mgrs)")
        else:
            unmapped.append((cusip, issuer[cusip], len(rows)))

    # --- build per-ticker output ---
    tickers_out = {}
    for cusip, t in mapping.items():
        rows = by_cusip[cusip]
        act = actions.get(cusip, {})
        act_of = {}
        for verb in ("opened", "closed", "increased", "decreased"):
            for slug in act.get(verb, []):
                act_of[slug] = verb
        managers = sorted(
            ({"slug": s, "name": mgr_name[s],
              "pct": round(v / mgr_total[s], 4) if mgr_total.get(s) else None,
              "action": act_of.get(s, "held")}
             for s, v, _ in rows),
            key=lambda m: -(m["pct"] or 0))
        # closers no longer appear in holdings — add them explicitly
        for slug in act.get("closed", []):
            managers.append({"slug": slug, "name": mgr_name[slug],
                             "pct": None, "action": "closed"})
        entry = {
            "holders": len(rows),
            "value_total": sum(v for _, v, _ in rows),
            "opened": len(act.get("opened", [])),
            "increased": len(act.get("increased", [])),
            "decreased": len(act.get("decreased", [])),
            "closed": len(act.get("closed", [])),
            "managers": managers,
        }
        prev = tickers_out.get(t)
        if not prev or entry["value_total"] > prev["value_total"]:
            tickers_out[t] = entry   # dual-class dupes: keep the larger line

    picks = [t for t, e in sorted(tickers_out.items(),
                                  key=lambda kv: (-kv[1]["holders"],
                                                  -kv[1]["value_total"]))
             if e["holders"] >= MIN_HOLDERS_PICK and t not in universe
             and t not in SAME_COMPANY][:MAX_PICKS]

    out = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": DASHBOARD_URL,
        "source_generated": D.get("generated"),
        "as_of": as_of,
        "quarter_pair": pair,
        "managers_tracked": len(mgr_name),
        "note": ("13F-HR filings disclose long US-equity positions only, up to "
                 "45 days after quarter end. Options excluded upstream."),
        "tickers": tickers_out,
        "picks": picks,
    }
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(os.path.join(DATA_DIR, "f13.json"), "w", encoding="utf-8") as f:
        json.dump(out, f)

    print(f"\nf13.json: {len(tickers_out)} tickers mapped & verified, as of {as_of}")
    print(f"unmapped (kept out, review if important): "
          f"{[(c, n, k) for c, n, k in unmapped[:12]]}")
    print(f"\nconsensus picks not in universe (holders >= {MIN_HOLDERS_PICK}):")
    for t in picks:
        e = tickers_out[t]
        print(f"  {t:6s} holders={e['holders']:2d} "
              f"+{e['opened']}/{e['increased']} -{e['decreased']}/{e['closed']} "
              f"${e['value_total']/1e9:.1f}B")
    return 0


if __name__ == "__main__":
    sys.exit(main())
