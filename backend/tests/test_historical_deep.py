"""Test script: verify deep historical data fetch for AAPL back to 2020.

Run standalone:
    cd backend && python tests/test_historical_deep.py
"""

import asyncio
import sys
import os
from datetime import datetime, timezone

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from historical import (
    _fetch_from_yahoo_sync,
    get_historical_bars,
    _ensure_schema,
    _read_cached,
    DEFAULT_DAILY_DURATION,
)
from db_utils import get_db_connection, DB_PATH


def test_yahoo_daily_max_range():
    """Test that yahooquery can return AAPL daily bars back to 2020."""
    print("=" * 60)
    print("TEST 1: Raw Yahoo fetch — AAPL daily, period='max'")
    print("=" * 60)

    bars = _fetch_from_yahoo_sync("AAPL", period="max", interval="1d")
    if not bars:
        print("FAIL: No bars returned from Yahoo")
        return False

    earliest = datetime.fromtimestamp(bars[0]["time"] / 1000, tz=timezone.utc)
    latest = datetime.fromtimestamp(bars[-1]["time"] / 1000, tz=timezone.utc)
    print(f"  Total bars: {len(bars)}")
    print(f"  Earliest:   {earliest.strftime('%Y-%m-%d')}")
    print(f"  Latest:     {latest.strftime('%Y-%m-%d')}")
    print(f"  First bar:  O={bars[0]['open']:.2f} H={bars[0]['high']:.2f} "
          f"L={bars[0]['low']:.2f} C={bars[0]['close']:.2f} V={bars[0]['volume']:.0f}")

    if earliest.year <= 2020:
        print("  PASS: Data goes back to 2020 or earlier")
        return True
    else:
        print(f"  FAIL: Earliest bar is {earliest.year}, expected <= 2020")
        return False


def test_yahoo_10y_range():
    """Test with period='10y' which is what DEFAULT_DAILY_DURATION should map to."""
    print()
    print("=" * 60)
    print("TEST 2: Raw Yahoo fetch — AAPL daily, period='10y'")
    print("=" * 60)

    bars = _fetch_from_yahoo_sync("AAPL", period="10y", interval="1d")
    if not bars:
        print("FAIL: No bars returned from Yahoo")
        return False

    earliest = datetime.fromtimestamp(bars[0]["time"] / 1000, tz=timezone.utc)
    latest = datetime.fromtimestamp(bars[-1]["time"] / 1000, tz=timezone.utc)
    print(f"  Total bars: {len(bars)}")
    print(f"  Earliest:   {earliest.strftime('%Y-%m-%d')}")
    print(f"  Latest:     {latest.strftime('%Y-%m-%d')}")

    if earliest.year <= 2020:
        print("  PASS: Data goes back to 2020 or earlier")
        return True
    else:
        print(f"  FAIL: Earliest bar is {earliest.year}, expected <= 2020")
        return False


async def test_get_historical_bars_daily():
    """Test the full get_historical_bars pipeline for daily AAPL."""
    print()
    print("=" * 60)
    print("TEST 3: Full pipeline — get_historical_bars(AAPL, 1d, 30Y)")
    print("=" * 60)

    bars, source = await get_historical_bars(
        symbol="AAPL",
        ib=None,
        tws_connected=False,
        duration="30 Y",
        bar_size="1 day",
        what_to_show="TRADES",
    )

    if not bars:
        print("FAIL: No bars returned")
        return False

    earliest = datetime.fromtimestamp(bars[0]["time"] / 1000, tz=timezone.utc)
    latest = datetime.fromtimestamp(bars[-1]["time"] / 1000, tz=timezone.utc)
    print(f"  Source:     {source}")
    print(f"  Total bars: {len(bars)}")
    print(f"  Earliest:   {earliest.strftime('%Y-%m-%d')}")
    print(f"  Latest:     {latest.strftime('%Y-%m-%d')}")

    if earliest.year <= 2020:
        print("  PASS: Data goes back to 2020 or earlier")
    else:
        print(f"  WARN: Earliest bar is {earliest.year}")

    # Verify bars are in the database
    print()
    print("  Checking database...")
    conn = get_db_connection()
    _ensure_schema(conn)
    row = conn.execute(
        "SELECT COUNT(*), MIN(ts), MAX(ts) FROM ohlcv_1d WHERE symbol = 'AAPL'"
    ).fetchone()
    conn.close()

    if row and row[0] > 0:
        db_earliest = datetime.fromtimestamp(row[1] / 1000, tz=timezone.utc)
        db_latest = datetime.fromtimestamp(row[2] / 1000, tz=timezone.utc)
        print(f"  DB rows:    {row[0]}")
        print(f"  DB earliest:{db_earliest.strftime('%Y-%m-%d')}")
        print(f"  DB latest:  {db_latest.strftime('%Y-%m-%d')}")

        if db_earliest.year <= 2020:
            print("  PASS: Database has data back to 2020")
            return True
        else:
            print(f"  FAIL: DB earliest is {db_earliest.year}")
            return False
    else:
        print("  FAIL: No rows in ohlcv_1d for AAPL")
        return False


def main():
    print(f"DB path: {DB_PATH}")
    print()

    r1 = test_yahoo_daily_max_range()
    r2 = test_yahoo_10y_range()
    r3 = asyncio.run(test_get_historical_bars_daily())

    print()
    print("=" * 60)
    print(f"Results: TEST1={'PASS' if r1 else 'FAIL'} "
          f"TEST2={'PASS' if r2 else 'FAIL'} "
          f"TEST3={'PASS' if r3 else 'FAIL'}")
    print("=" * 60)


if __name__ == "__main__":
    main()
