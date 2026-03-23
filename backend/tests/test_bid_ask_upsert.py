"""
Test script: verify bid/ask historical bars are correctly fetched and upserted
for AAPL into ohlcv_1m_bid / ohlcv_1m_ask tables.

Run from backend/:
    python test_bid_ask_upsert.py
"""

import asyncio
import logging
import sqlite3
import sys
import time
from pathlib import Path

# Ensure backend is on the path
sys.path.insert(0, str(Path(__file__).parent))

from db_utils import DB_PATH, sync_db_session
from historical import (
    _ensure_schema,
    _table_for_series,
    _cache_key_for_series,
    _normalize_what_to_show,
    get_historical_bars,
    _write_bars,
    _read_cached,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("test_bid_ask")

SYMBOL = "AAPL"


def inspect_db_state():
    """Check current state of bid/ask tables and fetch_meta for AAPL."""
    logger.info(f"=== DB State for {SYMBOL} ===")
    logger.info(f"DB path: {DB_PATH} (exists: {DB_PATH.exists()})")

    if not DB_PATH.exists():
        logger.warning("Database does not exist yet!")
        return

    with sync_db_session() as conn:
        _ensure_schema(conn)

        # Check all relevant tables
        for table in ["ohlcv_1m", "ohlcv_1m_bid", "ohlcv_1m_ask", "ohlcv_1d"]:
            try:
                row = conn.execute(
                    f"SELECT COUNT(*), MIN(ts), MAX(ts) FROM {table} WHERE symbol = ?",
                    (SYMBOL,),
                ).fetchone()
                count, min_ts, max_ts = row
                if count > 0:
                    from datetime import datetime, timezone
                    min_dt = datetime.fromtimestamp(min_ts / 1000, tz=timezone.utc).isoformat()
                    max_dt = datetime.fromtimestamp(max_ts / 1000, tz=timezone.utc).isoformat()
                    logger.info(f"  {table}: {count} rows, range [{min_dt} -> {max_dt}]")

                    # Show last 3 rows
                    last_rows = conn.execute(
                        f"SELECT ts, open, high, low, close, volume FROM {table} WHERE symbol = ? ORDER BY ts DESC LIMIT 3",
                        (SYMBOL,),
                    ).fetchall()
                    for r in last_rows:
                        ts_dt = datetime.fromtimestamp(r[0] / 1000, tz=timezone.utc).isoformat()
                        logger.info(f"    {ts_dt} O={r[1]} H={r[2]} L={r[3]} C={r[4]} V={r[5]}")
                else:
                    logger.info(f"  {table}: EMPTY")
            except Exception as e:
                logger.info(f"  {table}: ERROR - {e}")

        # Check fetch_meta
        logger.info("  fetch_meta entries:")
        rows = conn.execute(
            "SELECT bar_size, fetched_at, source FROM fetch_meta WHERE symbol = ?",
            (SYMBOL,),
        ).fetchall()
        if not rows:
            logger.info("    (none)")
        for r in rows:
            from datetime import datetime, timezone
            if r[1] > 0:
                dt = datetime.fromtimestamp(r[1] / 1000, tz=timezone.utc).isoformat()
            else:
                dt = "INVALIDATED"
            logger.info(f"    bar_size={r[0]}, fetched_at={dt}, source={r[1]}")


def test_table_routing():
    """Verify _table_for_series routes BID/ASK correctly."""
    logger.info("=== Table Routing Tests ===")
    cases = [
        ("1m", "TRADES", "ohlcv_1m"),
        ("1m", "BID", "ohlcv_1m_bid"),
        ("1m", "ASK", "ohlcv_1m_ask"),
        ("1d", "TRADES", "ohlcv_1d"),
        ("1d", "BID", "ohlcv_1d_bid"),
        ("1d", "ASK", "ohlcv_1d_ask"),
        ("5s", "BID", "ohlcv_5s"),  # 5s ignores BID/ASK per code
    ]
    all_ok = True
    for bar_size, wts, expected in cases:
        actual = _table_for_series(bar_size, wts)
        ok = "OK" if actual == expected else "FAIL"
        if actual != expected:
            all_ok = False
        logger.info(f"  _table_for_series({bar_size!r}, {wts!r}) = {actual!r} (expected {expected!r}) [{ok}]")

    cases_cache = [
        ("1m", "TRADES", "1m"),
        ("1m", "BID", "1m_bid"),
        ("1m", "ASK", "1m_ask"),
    ]
    for bar_size, wts, expected in cases_cache:
        actual = _cache_key_for_series(bar_size, wts)
        ok = "OK" if actual == expected else "FAIL"
        if actual != expected:
            all_ok = False
        logger.info(f"  _cache_key_for_series({bar_size!r}, {wts!r}) = {actual!r} (expected {expected!r}) [{ok}]")

    return all_ok


async def test_fetch_bid_ask_no_tws():
    """
    Test fetching BID/ASK bars WITHOUT TWS connected.
    Since Yahoo doesn't provide BID/ASK bars, this should return empty or stale cache.
    This verifies the fallback path.
    """
    logger.info("=== Fetch BID/ASK without TWS ===")

    bars_bid, src_bid = await get_historical_bars(
        symbol=SYMBOL,
        ib=None,
        tws_connected=False,
        duration="5 D",
        bar_size="1 min",
        what_to_show="BID",
    )
    logger.info(f"  BID: {len(bars_bid)} bars, source={src_bid}")

    bars_ask, src_ask = await get_historical_bars(
        symbol=SYMBOL,
        ib=None,
        tws_connected=False,
        duration="5 D",
        bar_size="1 min",
        what_to_show="ASK",
    )
    logger.info(f"  ASK: {len(bars_ask)} bars, source={src_ask}")

    return bars_bid, bars_ask


async def test_synthetic_write_and_read():
    """
    Write synthetic bid/ask bars to verify the upsert path works correctly,
    then read them back.
    """
    logger.info("=== Synthetic Write + Read Test ===")
    now_ms = int(time.time() * 1000)
    # Create 5 synthetic 1m bars
    fake_bid_bars = [
        {"time": now_ms - (5 - i) * 60000, "open": 170.0 + i * 0.1, "high": 170.5 + i * 0.1,
         "low": 169.5 + i * 0.1, "close": 170.2 + i * 0.1, "volume": 1000.0}
        for i in range(5)
    ]
    fake_ask_bars = [
        {"time": now_ms - (5 - i) * 60000, "open": 170.1 + i * 0.1, "high": 170.6 + i * 0.1,
         "low": 169.6 + i * 0.1, "close": 170.3 + i * 0.1, "volume": 1000.0}
        for i in range(5)
    ]

    with sync_db_session() as conn:
        _ensure_schema(conn)

        # Write BID bars
        _write_bars(conn, SYMBOL, fake_bid_bars, "1m", source="tws", what_to_show="BID")
        logger.info(f"  Wrote {len(fake_bid_bars)} synthetic BID bars")

        # Write ASK bars
        _write_bars(conn, SYMBOL, fake_ask_bars, "1m", source="tws", what_to_show="ASK")
        logger.info(f"  Wrote {len(fake_ask_bars)} synthetic ASK bars")

        # Read them back
        bid_read = _read_cached(conn, SYMBOL, limit_days=1, table="ohlcv_1m_bid")
        ask_read = _read_cached(conn, SYMBOL, limit_days=1, table="ohlcv_1m_ask")
        logger.info(f"  Read back: {len(bid_read)} BID bars, {len(ask_read)} ASK bars")

        # Verify content
        if bid_read:
            last_bid = bid_read[-1]
            logger.info(f"  Last BID bar: close={last_bid['close']}")
        if ask_read:
            last_ask = ask_read[-1]
            logger.info(f"  Last ASK bar: close={last_ask['close']}")

        # Verify via read_latest_bid_ask (the function used by worker_watchlist)
        from worker_watchlist import read_latest_bid_ask
        bid_val, ask_val = read_latest_bid_ask(SYMBOL)
        logger.info(f"  read_latest_bid_ask({SYMBOL}): bid={bid_val}, ask={ask_val}")

        if bid_val is None or ask_val is None:
            logger.error("  FAIL: read_latest_bid_ask returned None!")
            return False
        if abs(bid_val - fake_bid_bars[-1]["close"]) > 0.01:
            logger.error(f"  FAIL: bid mismatch: {bid_val} vs {fake_bid_bars[-1]['close']}")
            return False
        if abs(ask_val - fake_ask_bars[-1]["close"]) > 0.01:
            logger.error(f"  FAIL: ask mismatch: {ask_val} vs {fake_ask_bars[-1]['close']}")
            return False

        logger.info("  PASS: synthetic write + read matches")
        return True


async def test_fetch_meta_keying():
    """
    Verify that BID/ASK fetches use separate cache keys from TRADES,
    so they don't interfere with each other's freshness checks.
    """
    logger.info("=== fetch_meta Cache Key Isolation ===")
    with sync_db_session() as conn:
        _ensure_schema(conn)
        rows = conn.execute(
            "SELECT bar_size, source FROM fetch_meta WHERE symbol = ?",
            (SYMBOL,),
        ).fetchall()
        keys = {r[0]: r[1] for r in rows}
        logger.info(f"  fetch_meta keys for {SYMBOL}: {keys}")

        # After synthetic write, we should have 1m_bid and 1m_ask
        if "1m_bid" in keys:
            logger.info("  PASS: 1m_bid cache key exists")
        else:
            logger.warning("  WARN: 1m_bid cache key missing (expected after synthetic write)")
        if "1m_ask" in keys:
            logger.info("  PASS: 1m_ask cache key exists")
        else:
            logger.warning("  WARN: 1m_ask cache key missing (expected after synthetic write)")


async def main():
    logger.info(f"Testing bid/ask upsert for {SYMBOL}")
    logger.info(f"DB: {DB_PATH}")
    logger.info("")

    # 1. Inspect current state
    inspect_db_state()
    logger.info("")

    # 2. Test table routing logic
    routing_ok = test_table_routing()
    logger.info("")

    # 3. Synthetic write/read test
    synth_ok = await test_synthetic_write_and_read()
    logger.info("")

    # 4. Check fetch_meta keying
    await test_fetch_meta_keying()
    logger.info("")

    # 5. Test fetch without TWS (Yahoo fallback for bid/ask)
    await test_fetch_bid_ask_no_tws()
    logger.info("")

    # 6. Final DB state
    inspect_db_state()
    logger.info("")

    if routing_ok and synth_ok:
        logger.info("=== ALL CORE TESTS PASSED ===")
    else:
        logger.error("=== SOME TESTS FAILED ===")


if __name__ == "__main__":
    asyncio.run(main())
