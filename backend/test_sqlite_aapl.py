"""One-shot test: verify SQLite migration works end-to-end for AAPL with live TWS.

Usage:
    cd backend
    python test_sqlite_aapl.py
"""

import asyncio
import os
import sys
import time
import logging
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)

# ── Monkey-patch DB_PATH to use a temp test database ──────────────────
import db_utils

TEST_DB = db_utils.DB_DIR / "test_market.db"
db_utils.DB_PATH = TEST_DB

# Reset schema flag so it re-creates tables in the test DB
db_utils._schema_ready = False

# Now import historical (it reads DB_PATH at call time, not import time)
import historical

historical._schema_initialized = False

# ── Test harness ──────────────────────────────────────────────────────

results: list[tuple[str, bool, str]] = []


def report(name: str, passed: bool, detail: str = ""):
    tag = "PASS" if passed else "FAIL"
    msg = f"  [{tag}] {name}"
    if detail:
        msg += f" — {detail}"
    print(msg)
    results.append((name, passed, detail))


def cleanup():
    """Remove test DB files."""
    for suffix in ("", "-wal", "-shm"):
        p = Path(str(TEST_DB) + suffix)
        if p.exists():
            p.unlink()
            logger.info(f"Cleaned up {p}")


# ── Tests ─────────────────────────────────────────────────────────────


def test_1_db_connection():
    """Test 1: DB connection + schema creation."""
    with db_utils.sync_db_session(TEST_DB) as conn:
        # Verify WAL mode
        mode = conn.execute("PRAGMA journal_mode;").fetchone()[0]
        if mode != "wal":
            report("DB WAL mode", False, f"got '{mode}'")
            return

        # Verify tables exist
        tables = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        expected = {"ohlcv_1m", "ohlcv_1d", "ohlcv_5s", "fetch_meta", "technical_scores"}

        # historical schema tables are created by _ensure_schema, run it
        historical._ensure_schema(conn)

        tables = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        missing = expected - tables
        if missing:
            report("DB schema", False, f"missing tables: {missing}")
            return

    report("DB connection + schema", True, f"WAL={mode}, tables={sorted(expected)}")


async def test_2_tws_connection():
    """Test 2: Connect to TWS."""
    from ib_insync import IB

    ib = IB()
    connected_port = None

    for port, label in [(7497, "paper"), (7496, "live"), (4002, "gw-paper"), (4001, "gw-live")]:
        try:
            await ib.connectAsync("127.0.0.1", port, clientId=9999, readonly=True)
            if ib.isConnected():
                connected_port = port
                report("TWS connection", True, f"connected on :{port} ({label})")
                return ib
        except Exception:
            continue

    report("TWS connection", False, "could not connect on any port (7497/7496/4002/4001)")
    return None


async def test_3_tws_fetch_1m(ib):
    """Test 3: Fetch 1m bars from TWS for AAPL."""
    bars, source = await historical.get_historical_bars(
        "AAPL", ib=ib, tws_connected=True, duration="5 D", bar_size="1 min"
    )

    if not bars:
        report("TWS 1m fetch", False, "no bars returned")
        return bars

    if source != "tws":
        report("TWS 1m fetch", False, f"expected source='tws', got '{source}'")
        return bars

    # Validate bar schema
    required_keys = {"time", "open", "high", "low", "close", "volume"}
    sample = bars[0]
    missing_keys = required_keys - set(sample.keys())
    if missing_keys:
        report("TWS 1m fetch", False, f"bar missing keys: {missing_keys}")
        return bars

    # Validate types
    type_ok = isinstance(sample["time"], int) and all(
        isinstance(sample[k], (int, float)) for k in ["open", "high", "low", "close", "volume"]
    )
    if not type_ok:
        report("TWS 1m fetch", False, f"bad types in bar: {sample}")
        return bars

    first_ts = datetime.fromtimestamp(bars[0]["time"] / 1000, tz=timezone.utc)
    last_ts = datetime.fromtimestamp(bars[-1]["time"] / 1000, tz=timezone.utc)
    report(
        "TWS 1m fetch", True,
        f"{len(bars)} bars, {first_ts:%Y-%m-%d %H:%M} → {last_ts:%Y-%m-%d %H:%M} UTC"
    )
    return bars


def test_4_data_persisted():
    """Test 4: Verify data landed in SQLite."""
    with db_utils.sync_db_session(TEST_DB) as conn:
        row_count = conn.execute(
            "SELECT COUNT(*) FROM ohlcv_1m WHERE symbol = 'AAPL'"
        ).fetchone()[0]

        meta = conn.execute(
            "SELECT source FROM fetch_meta WHERE symbol = 'AAPL' AND bar_size = '1m'"
        ).fetchone()

    if row_count == 0:
        report("Data persisted", False, "0 rows in ohlcv_1m for AAPL")
        return

    if not meta:
        report("Data persisted", False, "no fetch_meta entry for AAPL/1m")
        return

    if meta[0] != "tws":
        report("Data persisted", False, f"fetch_meta source='{meta[0]}', expected 'tws'")
        return

    report("Data persisted", True, f"{row_count} rows in ohlcv_1m, source=tws")


def test_5_yahoo_no_overwrite(tws_bars):
    """Test 5: Yahoo INSERT OR IGNORE doesn't overwrite TWS bars."""
    if not tws_bars or len(tws_bars) < 3:
        report("Yahoo no-overwrite", False, "not enough TWS bars to test")
        return

    # Pick 3 bars and create modified copies with same timestamps
    originals = tws_bars[:3]
    fakes = []
    for b in originals:
        fakes.append({
            "time": b["time"],
            "open": b["open"] + 999.0,
            "high": b["high"] + 999.0,
            "low": b["low"] + 999.0,
            "close": b["close"] + 999.0,
            "volume": b["volume"] + 999.0,
        })

    with db_utils.sync_db_session(TEST_DB) as conn:
        historical._init_schema(conn)
        # Write fakes as yahoo — should be ignored (INSERT OR IGNORE)
        historical._write_bars(conn, "AAPL", fakes, "1m", source="yahoo")

        # Read back the bars at those timestamps
        for i, orig in enumerate(originals):
            row = conn.execute(
                "SELECT open, high, low, close, volume FROM ohlcv_1m WHERE symbol = 'AAPL' AND ts = ?",
                [orig["time"]],
            ).fetchone()
            if row is None:
                report("Yahoo no-overwrite", False, f"bar at ts={orig['time']} disappeared")
                return
            if abs(row[0] - orig["open"]) > 0.001:
                report(
                    "Yahoo no-overwrite", False,
                    f"bar at ts={orig['time']} was overwritten: open={row[0]}, expected={orig['open']}"
                )
                return

        # Verify source stays tws
        meta = conn.execute(
            "SELECT source FROM fetch_meta WHERE symbol = 'AAPL' AND bar_size = '1m'"
        ).fetchone()
        if not meta or meta[0] != "tws":
            report("Yahoo no-overwrite", False, f"fetch_meta source changed to '{meta[0] if meta else 'None'}'")
            return

    report("Yahoo no-overwrite", True, "3 bars unchanged after Yahoo write, source still 'tws'")


async def test_6_daily_bars(ib):
    """Test 6: Fetch daily bars from TWS."""
    bars, source = await historical.get_historical_bars(
        "AAPL", ib=ib, tws_connected=True, duration="2 Y", bar_size="1 day"
    )

    if not bars:
        report("TWS daily fetch", False, "no bars returned")
        return

    if source != "tws":
        report("TWS daily fetch", False, f"expected source='tws', got '{source}'")
        return

    with db_utils.sync_db_session(TEST_DB) as conn:
        row_count = conn.execute(
            "SELECT COUNT(*) FROM ohlcv_1d WHERE symbol = 'AAPL'"
        ).fetchone()[0]
        meta = conn.execute(
            "SELECT source FROM fetch_meta WHERE symbol = 'AAPL' AND bar_size = '1d'"
        ).fetchone()

    if row_count == 0:
        report("TWS daily fetch", False, "0 rows in ohlcv_1d")
        return
    if not meta or meta[0] != "tws":
        report("TWS daily fetch", False, f"fetch_meta source='{meta[0] if meta else 'None'}'")
        return

    first_ts = datetime.fromtimestamp(bars[0]["time"] / 1000, tz=timezone.utc)
    last_ts = datetime.fromtimestamp(bars[-1]["time"] / 1000, tz=timezone.utc)
    report(
        "TWS daily fetch", True,
        f"{len(bars)} bars ({row_count} in DB), {first_ts:%Y-%m-%d} → {last_ts:%Y-%m-%d}, source=tws"
    )


def test_7_schema_validation():
    """Test 7: Read-back schema validation."""
    with db_utils.sync_db_session(TEST_DB) as conn:
        rows = conn.execute(
            "SELECT ts, open, high, low, close, volume FROM ohlcv_1m WHERE symbol = 'AAPL' ORDER BY ts ASC"
        ).fetchall()

    if not rows:
        report("Schema validation", False, "no rows to validate")
        return

    sample = rows[len(rows) // 2]  # middle row
    ts, o, h, l, c, v = sample

    type_ok = (
        isinstance(ts, int)
        and isinstance(o, (int, float))
        and isinstance(h, (int, float))
        and isinstance(l, (int, float))
        and isinstance(c, (int, float))
        and isinstance(v, (int, float))
    )
    if not type_ok:
        report("Schema validation", False, f"bad types: {sample}")
        return

    # Sanity: high >= low, all prices > 0
    if h < l:
        report("Schema validation", False, f"high < low: {h} < {l}")
        return
    if any(x <= 0 for x in [o, h, l, c]):
        report("Schema validation", False, f"non-positive price in {sample}")
        return

    dt = datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
    report(
        "Schema validation", True,
        f"{len(rows)} total bars | sample @ {dt:%Y-%m-%d %H:%M}: O={o:.2f} H={h:.2f} L={l:.2f} C={c:.2f} V={v:.0f}"
    )


# ── Main ──────────────────────────────────────────────────────────────

async def main():
    print("\n=== SQLite Migration Test — AAPL via Live TWS ===\n")

    ib = None
    try:
        # Test 1
        test_1_db_connection()

        # Test 2
        ib = await test_2_tws_connection()
        if ib is None:
            print("\n  Cannot continue without TWS connection.")
            return

        # Test 3
        tws_bars = await test_3_tws_fetch_1m(ib)

        # Test 4
        test_4_data_persisted()

        # Test 5
        test_5_yahoo_no_overwrite(tws_bars)

        # Test 6
        await test_6_daily_bars(ib)

        # Test 7
        test_7_schema_validation()

    finally:
        if ib and ib.isConnected():
            ib.disconnect()
        cleanup()

    # Summary
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\n{'='*50}")
    print(f"  Results: {passed}/{total} passed")
    if passed == total:
        print("  All tests PASSED")
    else:
        failed = [name for name, ok, _ in results if not ok]
        print(f"  FAILED: {', '.join(failed)}")
    print(f"{'='*50}\n")

    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    asyncio.run(main())
