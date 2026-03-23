"""
Test script: verify 52W H/L data flow for a symbol like NFLX.

Run from the backend/ directory:
    python3 tests/test_52w_hl.py [SYMBOL]

Checks:
  1. What yahooquery returns for 52W H/L fields (raw source)
  2. What's in ohlcv_1d (the source for 52W queries)
  3. What's in watchlist_quotes and market_snapshots
  4. Simulates the /market/snapshots endpoint (what the frontend actually calls)
"""

import sqlite3
import sys
import time
from pathlib import Path

# Make sure we can import from backend/
sys.path.insert(0, str(Path(__file__).parent.parent))

from db_utils import DB_PATH


# ── 1. Check yahooquery price data ───────────────────────────────────

def check_yahoo(symbol: str) -> None:
    print(f"\n=== [1] yahooquery price data for {symbol} ===")
    try:
        from yahooquery import Ticker
        t = Ticker(symbol)
        price = t.price
        if not isinstance(price, dict):
            print(f"  ERROR: price returned {type(price)}: {price}")
            return
        data = price.get(symbol)
        if not isinstance(data, dict):
            print(f"  ERROR: no price dict for {symbol}: {data}")
            return

        fields = {
            "regularMarketPrice":   data.get("regularMarketPrice"),
            "regularMarketDayHigh": data.get("regularMarketDayHigh"),
            "regularMarketDayLow":  data.get("regularMarketDayLow"),
            "fiftyTwoWeekHigh":     data.get("fiftyTwoWeekHigh"),
            "fiftyTwoWeekLow":      data.get("fiftyTwoWeekLow"),
        }
        for k, v in fields.items():
            status = "OK" if v is not None else "MISSING"
            print(f"  {status:7}  {k}: {v}")

        w52h = data.get("fiftyTwoWeekHigh")
        w52l = data.get("fiftyTwoWeekLow")
        if w52h and w52l:
            print(f"\n  52W H/L from Yahoo: {w52h:.2f} / {w52l:.2f}  ✓")
        else:
            print(f"\n  52W H/L from Yahoo: NOT AVAILABLE  ✗")

    except Exception as e:
        print(f"  ERROR: {e}")


# ── 2. Check ohlcv_1d in SQLite ──────────────────────────────────────

def check_ohlcv_1d(symbol: str) -> None:
    print(f"\n=== [2] ohlcv_1d table for {symbol} ===")
    if not DB_PATH.exists():
        print(f"  DB not found at {DB_PATH}")
        return
    try:
        conn = sqlite3.connect(str(DB_PATH))
        # Does the table even exist?
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='ohlcv_1d'"
        ).fetchall()]
        if not tables:
            print("  Table ohlcv_1d does NOT EXIST — 52W queries will always return null")
            conn.close()
            return

        count = conn.execute(
            "SELECT COUNT(*) FROM ohlcv_1d WHERE symbol = ?", (symbol,)
        ).fetchone()[0]
        print(f"  Row count for {symbol}: {count}")

        if count == 0:
            print("  NO daily bars for this symbol — this is why 52W H/L is blank!")
        else:
            ts_52w_ago = int((time.time() - 52 * 7 * 86400) * 1000)
            row = conn.execute(
                "SELECT MAX(high), MIN(low), MIN(ts), MAX(ts) FROM ohlcv_1d "
                "WHERE symbol = ? AND ts >= ?",
                (symbol, ts_52w_ago),
            ).fetchone()
            print(f"  52W MAX(high): {row[0]}, MIN(low): {row[1]}")
            if row[2]:
                from datetime import datetime, timezone
                oldest = datetime.fromtimestamp(row[2]/1000, tz=timezone.utc).date()
                newest = datetime.fromtimestamp(row[3]/1000, tz=timezone.utc).date()
                print(f"  Date range: {oldest} → {newest}")
        conn.close()
    except Exception as e:
        print(f"  ERROR: {e}")


# ── 3. Check watchlist_quotes ─────────────────────────────────────────

def check_watchlist_quotes(symbol: str) -> None:
    print(f"\n=== [3] watchlist_quotes for {symbol} ===")
    if not DB_PATH.exists():
        print(f"  DB not found at {DB_PATH}")
        return
    try:
        conn = sqlite3.connect(str(DB_PATH))
        # Check if 52W columns exist in the table
        cols = [r[1] for r in conn.execute("PRAGMA table_info(watchlist_quotes)").fetchall()]
        has_w52h = "week52_high" in cols
        has_w52l = "week52_low" in cols
        print(f"  Columns: {cols}")
        print(f"  Has week52_high column: {has_w52h}")
        print(f"  Has week52_low column:  {has_w52l}")

        row = conn.execute(
            "SELECT last, high, low, source, updated_at FROM watchlist_quotes WHERE symbol = ?",
            (symbol,)
        ).fetchone()
        if row:
            from datetime import datetime, timezone
            updated = datetime.fromtimestamp(row[4]/1000, tz=timezone.utc) if row[4] else None
            print(f"  last={row[0]}, high={row[1]}, low={row[2]}, source={row[3]}, updated={updated}")
        else:
            print(f"  No row for {symbol} in watchlist_quotes")
        conn.close()
    except Exception as e:
        print(f"  ERROR: {e}")


# ── 4. Simulate /market/snapshots endpoint (what frontend calls) ──────

def simulate_snapshots_endpoint(symbol: str) -> None:
    print(f"\n=== [4] Simulated /market/snapshots result for {symbol} ===")
    if not DB_PATH.exists():
        print(f"  DB not found at {DB_PATH}")
        return
    try:
        conn = sqlite3.connect(str(DB_PATH))

        # Check market_snapshots
        snap = conn.execute(
            "SELECT symbol, last, source FROM market_snapshots WHERE symbol = ?",
            (symbol,)
        ).fetchone()
        if not snap:
            print(f"  {symbol} not in market_snapshots → endpoint returns nothing")
            conn.close()
            return

        print(f"  In market_snapshots: last={snap[1]}, source={snap[2]}")

        # 52W query (the fix: batch query ohlcv_1d)
        ts_52w_ago = int((time.time() - 52 * 7 * 86400) * 1000)
        w52_row = conn.execute(
            "SELECT MAX(high), MIN(low) FROM ohlcv_1d WHERE symbol = ? AND ts >= ?",
            (symbol, ts_52w_ago),
        ).fetchone()
        week52_high = round(w52_row[0], 2) if w52_row and w52_row[0] is not None else None
        week52_low  = round(w52_row[1], 2) if w52_row and w52_row[1] is not None else None

        print(f"  week52High: {week52_high}")
        print(f"  week52Low:  {week52_low}")

        if week52_high is not None:
            print(f"\n  52W H/L would be returned correctly after the fix ✓")
        else:
            print(f"\n  52W H/L still None — ohlcv_1d may be empty for this symbol")
            print("  Trigger a daily bar fetch to populate it.")
        conn.close()
    except Exception as e:
        print(f"  ERROR: {e}")


# ── Main ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    symbol = sys.argv[1].upper() if len(sys.argv) > 1 else "NFLX"
    print(f"Testing 52W H/L data flow for: {symbol}")
    print(f"DB path: {DB_PATH}")

    check_yahoo(symbol)
    check_ohlcv_1d(symbol)
    check_watchlist_quotes(symbol)
    simulate_snapshots_endpoint(symbol)

    print("\n=== SUMMARY ===")
    print("Root cause: frontend calls /market/snapshots, which never included 52W H/L.")
    print("Fix applied: /market/snapshots now batch-queries ohlcv_1d for week52High/Low.")
    print("Note: yahooquery .price does NOT return fiftyTwoWeekHigh — ohlcv_1d is the source.")
