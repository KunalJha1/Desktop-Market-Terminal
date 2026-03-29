"""
DailyIQ API — Endpoint smoke tests
Reads DAILYIQ_API_KEY from .env and hits every documented endpoint once.
"""

import os, sys, json
import requests
from env_loader import env_candidates, load_local_backend_env

LOADED_ENV_PATHS = load_local_backend_env()
ENV_CANDIDATES = env_candidates()

API_KEY = os.getenv("DAILYIQ_API_KEY")
if not API_KEY:
    searched = "\n".join(f"  - {path}" for path in ENV_CANDIDATES)
    sys.exit(f"DAILYIQ_API_KEY not found in environment or searched .env paths:\n{searched}")

BASE = f"https://dailyiq.me/v1/{API_KEY}"
SYMBOL = "AAPL"
PASS, FAIL = 0, 0


def test(name, url, params=None):
    global PASS, FAIL
    try:
        r = requests.get(url, params=params, timeout=15)
        ok = r.status_code == 200
        try:
            data = r.json()
        except ValueError:
            ok = False
            data = f"[status {r.status_code}] {r.text[:300]}"
        status = "PASS" if ok else f"FAIL ({r.status_code})"
    except Exception as e:
        ok, status, data = False, "ERROR", str(e)

    if ok:
        PASS += 1
    else:
        FAIL += 1

    print(f"[{status}] {name}")
    if ok:
        # Print a compact preview of the response
        preview = json.dumps(data, default=str)
        print(f"       {preview[:200]}{'...' if len(preview) > 200 else ''}")
    else:
        print(f"       {data}")
    print()


if __name__ == "__main__":
    print(f"Testing DailyIQ API  |  symbol={SYMBOL}\n{'='*50}\n")
    if LOADED_ENV_PATHS:
        print("Loaded .env paths:")
        for env_path in LOADED_ENV_PATHS:
            print(f"  - {env_path}")
        print()

    test("Snapshot",      f"{BASE}/snapshot/{SYMBOL}")
    test("Price",         f"{BASE}/price/{SYMBOL}")
    test("Stock",         f"{BASE}/stock/{SYMBOL}")
    test("Price Bars",    f"{BASE}/price-bars", {"symbol": SYMBOL, "timeframe": "1d", "limit": 50, "order": "desc"})
    test("Fundamentals",  f"{BASE}/fundamentals/{SYMBOL}")
    test("Technicals",    f"{BASE}/technicals/{SYMBOL}")
    test("News",          f"{BASE}/news/{SYMBOL}", {"page_size": 3})
    test("Earnings",      f"{BASE}/earnings/{SYMBOL}")

    print(f"{'='*50}")
    print(f"Results: {PASS} passed, {FAIL} failed out of {PASS+FAIL}")
    sys.exit(1 if FAIL else 0)
