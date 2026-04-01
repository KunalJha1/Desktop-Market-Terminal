"""Historical bar storage (SQLite) + fetching from TWS / Yahoo Finance."""

import asyncio
import json
import logging
import sqlite3
import time
from datetime import date, datetime, timezone
from pathlib import Path

from db_utils import (
    DB_DIR,
    DB_PATH,
    db_session as _raw_db_session,
    execute_many_with_retry,
    execute_one_tx_with_retry,
    sync_db_session,
)
from runtime_paths import data_dir
from schema import ensure_historical_schema

logger = logging.getLogger(__name__)

# Schema is set up once on the first connection open.
_schema_initialized = False

# How stale cached data can be before we re-fetch (seconds)
CACHE_TTL = 300  # 5 minutes for intraday
CACHE_TTL_DAILY = 21600  # 6 hours for daily bars

# Yahoo Finance hard limits for 1m data (API won't return further back)
YAHOO_1M_MAX_DAYS = 29

# Default/maximum horizons for deeper history pulls.
DEFAULT_INTRADAY_DURATION = "30 D"
DEFAULT_DAILY_DURATION = "30 Y"
BACKGROUND_INTRADAY_DURATION = "2 Y"
SEED_INTRADAY_DURATION = "5 D"
SEED_DAILY_DURATION = "2 Y"
MAX_INTRADAY_LOOKBACK_DAYS = 365 * 30
MAX_DAILY_LOOKBACK_DAYS = 365 * 30
# 1-minute historical requests start timing out on some TWS sessions when the
# chunk is too large; keep the pagination window modest so deep backfills can
# progress reliably.
TWS_INTRADAY_CHUNK_DAYS = 14
TWS_DAILY_CHUNK_YEARS = 10
URGENT_HISTORICAL_WAIT_S = 4.0
BACKGROUND_INTRADAY_MAX_YEARS = 30
BACKGROUND_INTRADAY_MIN_YEARS = 1
BACKGROUND_INTRADAY_DEFAULT_YEARS = 2
SETTINGS_PATH = data_dir() / "tws-settings.json"
BAR_SIZE_TARGET_DURATIONS = {
    "1m": "20 D",
    "5m": "90 D",
    "15m": "270 D",
    "1d": "30 Y",
}
MIN_INCREMENTAL_DAYS = 1
MIN_INCREMENTAL_DAILY_DAYS = 30  # 1m minimum window for daily bar incremental fetches
MAX_INCREMENTAL_INTRADAY_DAYS = 14

# Per-symbol async locks to prevent concurrent fetches for the same symbol+bar_size.
# Key: "{symbol}:{bar_size}" (e.g. "HIMS:1m")
_fetch_locks: dict[str, asyncio.Lock] = {}


def _get_fetch_lock(symbol: str, bar_size: str) -> asyncio.Lock:
    key = f"{symbol}:{bar_size}"
    if key not in _fetch_locks:
        _fetch_locks[key] = asyncio.Lock()
    return _fetch_locks[key]


def _normalize_what_to_show(what_to_show: str) -> str:
    mode = (what_to_show or "TRADES").upper()
    if mode not in {"TRADES", "BID", "ASK"}:
        return "TRADES"
    return mode


def _normalize_bar_size(bar_size: str) -> str:
    raw = (bar_size or "1 min").strip().lower()
    mapping = {
        "1m": "1m",
        "1 min": "1m",
        "1 mins": "1m",
        "5m": "5m",
        "5 min": "5m",
        "5 mins": "5m",
        "15m": "15m",
        "15 min": "15m",
        "15 mins": "15m",
        "1d": "1d",
        "1 day": "1d",
        "5s": "5s",
        "5 sec": "5s",
        "5 secs": "5s",
    }
    return mapping.get(raw, "1d" if "day" in raw else "1m")


def _is_daily_bar_size(bar_size: str) -> bool:
    return _normalize_bar_size(bar_size) == "1d"


def _ib_bar_size_setting(bar_size: str) -> str:
    normalized = _normalize_bar_size(bar_size)
    if normalized == "5m":
        return "5 mins"
    if normalized == "15m":
        return "15 mins"
    if normalized == "1d":
        return "1 day"
    if normalized == "5s":
        return "5 secs"
    return "1 min"


def _table_for_series(bar_size: str, what_to_show: str) -> str:
    normalized = _normalize_bar_size(bar_size)
    base_map = {
        "1m": "ohlcv_1m",
        "5m": "ohlcv_5m",
        "15m": "ohlcv_15m",
        "1d": "ohlcv_1d",
        "5s": "ohlcv_5s",
    }
    base = base_map.get(normalized, "ohlcv_1m")
    mode = _normalize_what_to_show(what_to_show)
    if mode == "TRADES" or base == "ohlcv_5s" or normalized not in {"1m", "1d"}:
        return base
    return f"{base}_{mode.lower()}"


def _cache_key_for_series(bar_size: str, what_to_show: str) -> str:
    normalized = _normalize_bar_size(bar_size)
    mode = _normalize_what_to_show(what_to_show)
    if mode == "TRADES" or normalized not in {"1m", "1d"}:
        return normalized
    return f"{normalized}_{mode.lower()}"


def _latest_bar_ts(conn: sqlite3.Connection, symbol: str, table: str) -> int | None:
    """Return the Unix ms timestamp of the most recent cached bar, or None."""
    row = conn.execute(
        f"SELECT MAX(ts) FROM {table} WHERE symbol = ?", [symbol]
    ).fetchone()
    return row[0] if row and row[0] is not None else None


def _earliest_bar_ts(conn: sqlite3.Connection, symbol: str, table: str) -> int | None:
    """Return the Unix ms timestamp of the earliest cached bar, or None."""
    row = conn.execute(
        f"SELECT MIN(ts) FROM {table} WHERE symbol = ?", [symbol]
    ).fetchone()
    return row[0] if row and row[0] is not None else None


def _duration_to_days(duration: str | None, fallback_days: int) -> int:
    """Convert an IB duration string like '30 D' or '20 Y' into days."""
    if not duration:
        return fallback_days
    try:
        value_raw, unit_raw = duration.strip().split(maxsplit=1)
        value = int(value_raw)
    except Exception:
        return fallback_days

    unit = unit_raw.strip().upper()
    if unit.startswith("D"):
        return value
    if unit.startswith("W"):
        return value * 7
    if unit.startswith("M"):
        return value * 30
    if unit.startswith("Y"):
        return value * 365
    return fallback_days


def _normalize_background_intraday_years(value) -> int:
    try:
        years = int(value)
    except (TypeError, ValueError):
        years = BACKGROUND_INTRADAY_DEFAULT_YEARS
    return max(BACKGROUND_INTRADAY_MIN_YEARS, min(BACKGROUND_INTRADAY_MAX_YEARS, years))


def get_background_intraday_years(settings_path: Path | None = None) -> int:
    path = settings_path or SETTINGS_PATH
    try:
        with open(path, encoding="utf-8") as f:
            payload = json.load(f)
    except FileNotFoundError:
        return BACKGROUND_INTRADAY_DEFAULT_YEARS
    except Exception as exc:
        logger.warning("Failed to read intraday backfill settings from %s: %s", path, exc)
        return BACKGROUND_INTRADAY_DEFAULT_YEARS

    if not isinstance(payload, dict):
        return BACKGROUND_INTRADAY_DEFAULT_YEARS
    return _normalize_background_intraday_years(payload.get("intradayBackfillYears"))


def get_background_intraday_duration(settings_path: Path | None = None) -> str:
    return f"{get_background_intraday_years(settings_path)} Y"


def target_duration_for_bar_size(bar_size: str) -> str:
    normalized = _normalize_bar_size(bar_size)
    return BAR_SIZE_TARGET_DURATIONS.get(normalized, BAR_SIZE_TARGET_DURATIONS["1m"])


def _ib_datetime_utc(ts_ms: int) -> str:
    """Format a UTC timestamp for IB historical pagination."""
    dt = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
    return dt.strftime("%Y%m%d %H:%M:%S UTC")


def _dedupe_bars(bars: list[dict]) -> list[dict]:
    if not bars:
        return []
    deduped: dict[int, dict] = {}
    for bar in bars:
        deduped[bar["time"]] = bar
    return [deduped[ts] for ts in sorted(deduped)]


def _days_to_ib_duration(days: int, is_daily: bool) -> str:
    _min = MIN_INCREMENTAL_DAILY_DAYS if is_daily else MIN_INCREMENTAL_DAYS
    days = max(_min, int(days))
    if not is_daily:
        return f"{min(days, MAX_INCREMENTAL_INTRADAY_DAYS)} D"
    if days <= 365:
        return f"{days} D"
    return f"{max(1, (days + 364) // 365)} Y"


def _incremental_tws_duration(last_ts_ms: int | None, default: str, is_daily: bool) -> str:
    """Return the gap-to-now duration, with 1D minimum and 14D intraday cap."""
    if last_ts_ms is None:
        return default
    gap_days = int((time.time() - last_ts_ms / 1000) / 86400) + 1
    return _days_to_ib_duration(gap_days, is_daily)


def _incremental_yahoo_period(last_ts_ms: int | None, default: str, is_daily: bool) -> str:
    """
    Return a yahooquery period string covering only the gap since the last cached bar
    with a minimum 1D window. Falls back to `default` if there is no prior data.

    For 1m bars Yahoo only goes back ~29 days regardless, so we cap there.
    """
    if last_ts_ms is None:
        return default
    gap_days = int((time.time() - last_ts_ms / 1000) / 86400) + 1
    gap_days = max(gap_days, MIN_INCREMENTAL_DAYS)

    if not is_daily:
        # Yahoo 1m hard limit — no point asking for more
        gap_days = min(gap_days, YAHOO_1M_MAX_DAYS if default in {"5d", "1mo"} else MAX_INCREMENTAL_INTRADAY_DAYS)

    if gap_days <= 5:
        return "5d"
    elif gap_days <= 29:
        return "1mo"
    elif gap_days <= 89:
        return "3mo"
    elif gap_days <= 179:
        return "6mo"
    elif gap_days <= 364:
        return "1y"
    elif gap_days <= 729:
        return "2y"
    elif gap_days <= 1825:
        return "5y"
    elif gap_days <= 3650:
        return "10y"
    else:
        return "max"


def _yahoo_seed_period(bar_size: str, lookback_days: int) -> str:
    """Map the requested native series horizon to the best Yahoo period token."""
    normalized = _normalize_bar_size(bar_size)
    days = max(1, int(lookback_days))

    if normalized == "1m":
        # Yahoo 1m data is limited to about 29 days.
        return "1mo"
    if days <= 5:
        return "5d"
    if days <= 29:
        return "1mo"
    if days <= 89:
        return "3mo"
    if days <= 179:
        return "6mo"
    if days <= 364:
        return "1y"
    if days <= 729:
        return "2y"
    if days <= 1825:
        return "5y"
    if days <= 3650:
        return "10y"
    return "max"


def _ensure_schema(conn: sqlite3.Connection):
    """Create tables + indexes on first use."""
    ensure_historical_schema(conn)
    conn.commit()
    return
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_1m (
            symbol   TEXT    NOT NULL,
            ts       INTEGER NOT NULL,   -- Unix ms
            open     REAL    NOT NULL,
            high     REAL    NOT NULL,
            low      REAL    NOT NULL,
            close    REAL    NOT NULL,
            volume   REAL    NOT NULL,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_1m_sym_ts
        ON ohlcv_1m (symbol, ts)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_1m_bid (
            symbol   TEXT    NOT NULL,
            ts       INTEGER NOT NULL,
            open     REAL    NOT NULL,
            high     REAL    NOT NULL,
            low      REAL    NOT NULL,
            close    REAL    NOT NULL,
            volume   REAL    NOT NULL,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_1m_bid_sym_ts
        ON ohlcv_1m_bid (symbol, ts)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_1m_ask (
            symbol   TEXT    NOT NULL,
            ts       INTEGER NOT NULL,
            open     REAL    NOT NULL,
            high     REAL    NOT NULL,
            low      REAL    NOT NULL,
            close    REAL    NOT NULL,
            volume   REAL    NOT NULL,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_1m_ask_sym_ts
        ON ohlcv_1m_ask (symbol, ts)
    """)

    # Daily bars for longer-term charts (1D, 1W, 1M timeframes)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_1d (
            symbol   TEXT    NOT NULL,
            ts       INTEGER NOT NULL,   -- Unix ms
            open     REAL    NOT NULL,
            high     REAL    NOT NULL,
            low      REAL    NOT NULL,
            close    REAL    NOT NULL,
            volume   REAL    NOT NULL,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_1d_sym_ts
        ON ohlcv_1d (symbol, ts)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_1d_bid (
            symbol   TEXT    NOT NULL,
            ts       INTEGER NOT NULL,
            open     REAL    NOT NULL,
            high     REAL    NOT NULL,
            low      REAL    NOT NULL,
            close    REAL    NOT NULL,
            volume   REAL    NOT NULL,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_1d_bid_sym_ts
        ON ohlcv_1d_bid (symbol, ts)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_1d_ask (
            symbol   TEXT    NOT NULL,
            ts       INTEGER NOT NULL,
            open     REAL    NOT NULL,
            high     REAL    NOT NULL,
            low      REAL    NOT NULL,
            close    REAL    NOT NULL,
            volume   REAL    NOT NULL,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_1d_ask_sym_ts
        ON ohlcv_1d_ask (symbol, ts)
    """)

    # Secondary 5s bars for active chart symbols (30-day cache per CLAUDE.md)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_5s (
            symbol   TEXT    NOT NULL,
            ts       INTEGER NOT NULL,
            open     REAL    NOT NULL,
            high     REAL    NOT NULL,
            low      REAL    NOT NULL,
            close    REAL    NOT NULL,
            volume   REAL    NOT NULL,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_5s_sym_ts
        ON ohlcv_5s (symbol, ts)
    """)

    # Metadata: track when each symbol was last fetched and from which source
    conn.execute("""
        CREATE TABLE IF NOT EXISTS fetch_meta (
            symbol     TEXT    NOT NULL,
            bar_size   TEXT    NOT NULL,
            fetched_at INTEGER NOT NULL,  -- Unix ms
            source     TEXT    NOT NULL DEFAULT 'yahoo',
            PRIMARY KEY (symbol, bar_size)
        )
    """)
    conn.commit()


def _init_schema(conn: sqlite3.Connection):
    """Initialise schema once per process."""
    global _schema_initialized
    if not _schema_initialized:
        _ensure_schema(conn)
        _schema_initialized = True


def _cache_fresh(
    conn: sqlite3.Connection, symbol: str, bar_size: str, ttl: float = CACHE_TTL
) -> tuple[bool, str, bool]:
    """Check if cached data is fresh enough. Returns (is_fresh, source, depth_complete)."""
    row = conn.execute(
        "SELECT fetched_at, source, depth_complete FROM fetch_meta WHERE symbol = ? AND bar_size = ?",
        [symbol, bar_size],
    ).fetchone()
    if not row:
        return False, "none", False
    fetched_at, source = row[0], row[1] or "yahoo"
    depth_complete = bool(row[2]) if row[2] is not None else False
    age_s = (int(time.time() * 1000) - fetched_at) / 1000
    return age_s < ttl, source, depth_complete


def _read_cached(conn: sqlite3.Connection, symbol: str, limit_days: int = 5, table: str = "ohlcv_1m") -> list[dict]:
    """Read cached bars, most recent `limit_days` days."""
    cutoff_ms = int((time.time() - limit_days * 86400) * 1000)
    _synthetic_tables = {"ohlcv_1m", "ohlcv_5m", "ohlcv_15m"}
    has_synthetic = table in _synthetic_tables
    select_cols = "ts, open, high, low, close, volume, synthetic" if has_synthetic else "ts, open, high, low, close, volume"
    rows = conn.execute(
        f"""
        SELECT {select_cols}
        FROM {table}
        WHERE symbol = ? AND ts >= ?
        ORDER BY ts ASC
        """,
        [symbol, cutoff_ms],
    ).fetchall()
    if has_synthetic:
        bars = [
            {"time": r[0], "open": r[1], "high": r[2], "low": r[3], "close": r[4], "volume": r[5], "synthetic": bool(r[6])}
            for r in rows
        ]
    else:
        bars = [
            {"time": r[0], "open": r[1], "high": r[2], "low": r[3], "close": r[4], "volume": r[5]}
            for r in rows
        ]

    # For daily bars, fill in any days that have 1m data but no ohlcv_1d entry.
    if table == "ohlcv_1d":
        bars = _fill_daily_gaps_from_1m(conn, symbol, cutoff_ms, bars)

    return bars


def _fill_daily_gaps_from_1m(
    conn: sqlite3.Connection,
    symbol: str,
    cutoff_ms: int,
    daily_bars: list[dict],
) -> list[dict]:
    """Supplement daily bars with aggregated 1m data for any missing days."""
    MS_PER_DAY = 86_400_000
    existing_days = {b["time"] // MS_PER_DAY for b in daily_bars}

    # Aggregate 1m bars by UTC day bucket
    rows = conn.execute(
        """
        SELECT
            (ts / 86400000) * 86400000 AS day_ts,
            open,
            high,
            low,
            close,
            volume,
            ts
        FROM ohlcv_1m
        WHERE symbol = ? AND ts >= ?
        ORDER BY ts ASC
        """,
        [symbol, cutoff_ms],
    ).fetchall()

    # Group rows by day_ts, keeping first open, max high, min low, last close, sum volume
    day_data: dict[int, dict] = {}
    for day_ts, open_, high, low, close, volume, ts in rows:
        if day_ts // MS_PER_DAY in existing_days:
            continue  # already have a native daily bar for this day
        if day_ts not in day_data:
            day_data[day_ts] = {
                "time": day_ts,
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
            }
        else:
            d = day_data[day_ts]
            d["high"] = max(d["high"], high)
            d["low"] = min(d["low"], low)
            d["close"] = close
            d["volume"] += volume

    if not day_data:
        return daily_bars

    merged = daily_bars + list(day_data.values())
    merged.sort(key=lambda b: b["time"])
    return merged


def _read_cached_window(
    conn: sqlite3.Connection,
    symbol: str,
    ts_start: int | None = None,
    ts_end: int | None = None,
    limit: int | None = None,
    table: str = "ohlcv_1m",
) -> list[dict]:
    """Read a windowed slice of cached bars for viewport-based loading.

    Uses the (symbol, ts) composite index for fast range scans.
    When only `limit` is provided (no ts_start/ts_end), returns the most recent N bars.
    """
    conditions = ["symbol = ?"]
    params: list = [symbol]

    if ts_start is not None:
        conditions.append("ts >= ?")
        params.append(ts_start)
    if ts_end is not None:
        conditions.append("ts <= ?")
        params.append(ts_end)

    where = " AND ".join(conditions)

    _synthetic_tables = {"ohlcv_1m", "ohlcv_5m", "ohlcv_15m"}
    has_synthetic = table in _synthetic_tables
    select_cols = "ts, open, high, low, close, volume, synthetic" if has_synthetic else "ts, open, high, low, close, volume"

    # When only limit is given (no time bounds), fetch the most recent bars
    if limit is not None and ts_start is None and ts_end is None:
        rows = conn.execute(
            f"""
            SELECT {select_cols}
            FROM {table}
            WHERE {where}
            ORDER BY ts DESC
            LIMIT ?
            """,
            params + [limit],
        ).fetchall()
        rows.reverse()  # restore chronological order
    else:
        query = f"""
            SELECT {select_cols}
            FROM {table}
            WHERE {where}
            ORDER BY ts ASC
        """
        if limit is not None:
            query += " LIMIT ?"
            params.append(limit)
        rows = conn.execute(query, params).fetchall()

    if has_synthetic:
        return [
            {"time": r[0], "open": r[1], "high": r[2], "low": r[3], "close": r[4], "volume": r[5], "synthetic": bool(r[6])}
            for r in rows
        ]
    return [
        {"time": r[0], "open": r[1], "high": r[2], "low": r[3], "close": r[4], "volume": r[5]}
        for r in rows
    ]


def _cached_extent(
    conn: sqlite3.Connection, symbol: str, table: str
) -> tuple[int | None, int | None]:
    """Return (min_ts, max_ts) for a symbol's cached bars, or (None, None)."""
    row = conn.execute(
        f"SELECT MIN(ts), MAX(ts) FROM {table} WHERE symbol = ?", [symbol]
    ).fetchone()
    if row and row[0] is not None:
        return row[0], row[1]
    return None, None


def _has_full_coverage(ts_min: int | None, lookback_days: int, depth_complete: bool = False) -> bool:
    if ts_min is None:
        return False
    if depth_complete:
        return True
    cached_span_days = (time.time() - ts_min / 1000) / 86400
    return cached_span_days >= (lookback_days * 0.8)


def read_cached_series(
    symbol: str,
    bar_size: str = "1m",
    what_to_show: str = "TRADES",
    duration: str = DEFAULT_INTRADAY_DURATION,
) -> dict:
    """Return cached bars plus freshness metadata for a series."""
    db_bar_size = _normalize_bar_size(bar_size)
    is_daily = db_bar_size == "1d"
    what_to_show = _normalize_what_to_show(what_to_show)
    cache_key = _cache_key_for_series(db_bar_size, what_to_show)
    ttl = CACHE_TTL_DAILY if is_daily else CACHE_TTL
    table = _table_for_series(db_bar_size, what_to_show)
    lookback_days = _duration_to_days(
        duration,
        MAX_DAILY_LOOKBACK_DAYS if is_daily else MAX_INTRADAY_LOOKBACK_DAYS,
    )
    lookback_days = max(1, min(
        lookback_days,
        MAX_DAILY_LOOKBACK_DAYS if is_daily else MAX_INTRADAY_LOOKBACK_DAYS,
    ))

    with sync_db_session() as conn:
        _init_schema(conn)
        is_fresh, source, depth_complete = _cache_fresh(conn, symbol, cache_key, ttl)
        bars = _read_cached(conn, symbol, limit_days=lookback_days, table=table)
        ts_min, ts_max = _cached_extent(conn, symbol, table)

    return {
        "bars": bars,
        "count": len(bars),
        "is_fresh": is_fresh,
        "has_full_coverage": _has_full_coverage(ts_min, lookback_days, depth_complete),
        "source": source,
        "ts_min": ts_min,
        "ts_max": ts_max,
    }


def enqueue_historical_priority(
    symbol: str,
    bar_size: str = "1m",
    what_to_show: str = "TRADES",
    duration: str = DEFAULT_INTRADAY_DURATION,
) -> None:
    """Upsert an urgent historical fetch request visible across processes."""
    db_bar_size = _normalize_bar_size(bar_size)
    mode = _normalize_what_to_show(what_to_show)
    now_ms = int(time.time() * 1000)
    with sync_db_session() as conn:
        _init_schema(conn)
        execute_one_tx_with_retry(
            conn,
            """
            INSERT INTO historical_priority_queue (
                symbol, bar_size, what_to_show, duration, requested_at
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(symbol, bar_size, what_to_show) DO UPDATE SET
                duration = excluded.duration,
                requested_at = excluded.requested_at
            """,
            (symbol, db_bar_size, mode, duration, now_ms),
        )


def pop_historical_priority_requests(limit: int = 4) -> list[dict]:
    """Atomically claim the most recently requested urgent historical jobs."""
    if limit <= 0:
        return []

    with sync_db_session() as conn:
        _init_schema(conn)
        cur = conn.cursor()
        cur.execute("BEGIN IMMEDIATE;")
        rows = cur.execute(
            """
            SELECT symbol, bar_size, what_to_show, duration, requested_at
            FROM historical_priority_queue
            ORDER BY requested_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        if rows:
            cur.executemany(
                """
                DELETE FROM historical_priority_queue
                WHERE symbol = ? AND bar_size = ? AND what_to_show = ?
                """,
                [(row[0], row[1], row[2]) for row in rows],
            )
        conn.commit()

    return [
        {
            "symbol": row[0],
            "bar_size": row[1],
            "what_to_show": row[2],
            "duration": row[3],
            "requested_at": row[4],
        }
        for row in rows
    ]


def seed_duration_for_bar_size(bar_size: str) -> str:
    """Return a smaller first-response fetch window for cold-cache requests."""
    normalized = _normalize_bar_size(bar_size)
    if normalized == "1d":
        return SEED_DAILY_DURATION
    if normalized == "5m":
        return "30 D"
    if normalized == "15m":
        return "90 D"
    return SEED_INTRADAY_DURATION


def _write_bars(
    conn: sqlite3.Connection,
    symbol: str,
    bars: list[dict],
    bar_size: str = "1m",
    source: str = "yahoo",
    what_to_show: str = "TRADES",
    update_meta: bool = True,
    synthetic: bool = False,
    depth_complete: bool | None = None,
):
    """
    Upsert bars into SQLite.

    TWS writes use INSERT OR REPLACE (authoritative — always overwrites).
    Yahoo writes use INSERT OR IGNORE (gap-fill only — never overwrites TWS bars).

    Set update_meta=False for real-time bar writes so fetch_meta is not refreshed.
    Cache freshness should only reflect completed historical fetches, not streaming bars.

    Set synthetic=True for bars built from quote ticks (off-hours fallback).

    Set depth_complete=True when the fetch has reached the earliest available history for
    this series (i.e. the source returned all it has). When None, the existing flag is
    preserved (important: INSERT OR REPLACE would otherwise reset it to 0).
    """
    if not bars:
        return
    table = _table_for_series(bar_size, what_to_show)
    cache_key = _cache_key_for_series(bar_size, what_to_show)
    synthetic_flag = 1 if synthetic else 0

    # Only intraday tables carry the synthetic column; daily/5s tables do not.
    _synthetic_tables = {"ohlcv_1m", "ohlcv_5m", "ohlcv_15m"}
    has_synthetic_col = table in _synthetic_tables

    if has_synthetic_col:
        bar_params = [
            (symbol, b["time"], b["open"], b["high"], b["low"], b["close"], b["volume"], synthetic_flag)
            for b in bars
        ]
    else:
        bar_params = [
            (symbol, b["time"], b["open"], b["high"], b["low"], b["close"], b["volume"])
            for b in bars
        ]

    if source == "tws":
        # TWS is authoritative — overwrite any existing bar
        if has_synthetic_col:
            execute_many_with_retry(
                conn,
                f"""
                INSERT OR REPLACE INTO {table} (symbol, ts, open, high, low, close, volume, synthetic)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                bar_params,
            )
        else:
            execute_many_with_retry(
                conn,
                f"""
                INSERT OR REPLACE INTO {table} (symbol, ts, open, high, low, close, volume)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                bar_params,
            )
        if update_meta:
            if depth_complete is None:
                existing = conn.execute(
                    "SELECT depth_complete FROM fetch_meta WHERE symbol = ? AND bar_size = ?",
                    [symbol, cache_key],
                ).fetchone()
                dc_val = existing[0] if existing and existing[0] is not None else 0
            else:
                dc_val = 1 if depth_complete else 0
            execute_one_tx_with_retry(
                conn,
                """
                INSERT OR REPLACE INTO fetch_meta (symbol, bar_size, fetched_at, source, depth_complete)
                VALUES (?, ?, ?, ?, ?)
                """,
                (symbol, cache_key, int(time.time() * 1000), "tws", dc_val),
            )
    else:
        # Yahoo — gap-fill only: never overwrite bars that may be from TWS
        if has_synthetic_col:
            execute_many_with_retry(
                conn,
                f"""
                INSERT OR IGNORE INTO {table} (symbol, ts, open, high, low, close, volume, synthetic)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                bar_params,
            )
        else:
            execute_many_with_retry(
                conn,
                f"""
                INSERT OR IGNORE INTO {table} (symbol, ts, open, high, low, close, volume)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                bar_params,
            )
        if update_meta:
            # Always update fetch_meta so the cache is marked fresh.
            # Bar-level protection (INSERT OR IGNORE above) already prevents Yahoo
            # from overwriting TWS bars — the metadata must still be updated so
            # _cache_fresh() doesn't loop forever when TWS was the prior source.
            if depth_complete is None:
                existing = conn.execute(
                    "SELECT depth_complete FROM fetch_meta WHERE symbol = ? AND bar_size = ?",
                    [symbol, cache_key],
                ).fetchone()
                dc_val = existing[0] if existing and existing[0] is not None else 0
            else:
                dc_val = 1 if depth_complete else 0
            execute_one_tx_with_retry(
                conn,
                """
                INSERT OR REPLACE INTO fetch_meta (symbol, bar_size, fetched_at, source, depth_complete)
                VALUES (?, ?, ?, ?, ?)
                """,
                (symbol, cache_key, int(time.time() * 1000), "yahoo", dc_val),
            )


# ── TWS historical fetch ─────────────────────────────────────────────

async def fetch_from_tws(
    ib,
    symbol: str,
    duration: str = "5 D",
    bar_size: str = "1 min",
    what_to_show: str = "TRADES",
    end_date_time: str = "",
) -> list[dict]:
    """Fetch historical bars from TWS via ib_insync."""
    from ib_insync import Stock

    contract = Stock(symbol, "SMART", "USD")
    ib_bar_size = _ib_bar_size_setting(bar_size)
    bars = await ib.reqHistoricalDataAsync(
        contract,
        endDateTime=end_date_time,
        durationStr=duration,
        barSizeSetting=ib_bar_size,
        whatToShow=_normalize_what_to_show(what_to_show),
        useRTH=False,
        formatDate=2,  # UTC timestamp
    )

    result = []
    for b in bars:
        # ib_insync returns datetime for intraday, date for daily bars
        if isinstance(b.date, datetime):
            ts_ms = int(b.date.timestamp() * 1000)
        elif isinstance(b.date, date):
            ts_ms = int(datetime.combine(b.date, datetime.min.time(), tzinfo=timezone.utc).timestamp() * 1000)
        else:
            ts_ms = int(b.date) * 1000
        result.append({
            "time": ts_ms,
            "open": float(b.open),
            "high": float(b.high),
            "low": float(b.low),
            "close": float(b.close),
            "volume": float(b.volume),
        })

    return result


async def fetch_from_tws_paginated(
    ib,
    symbol: str,
    duration: str,
    bar_size: str = "1 min",
    what_to_show: str = "TRADES",
) -> list[dict]:
    """
    Walk backwards through TWS history in chunks so first-time backfills can
    collect materially more than a single IB request window.
    """
    normalized_bar_size = _normalize_bar_size(bar_size)
    is_daily = normalized_bar_size == "1d"
    requested_days = _duration_to_days(
        duration,
        MAX_DAILY_LOOKBACK_DAYS if is_daily else MAX_INTRADAY_LOOKBACK_DAYS,
    )
    max_days = MAX_DAILY_LOOKBACK_DAYS if is_daily else MAX_INTRADAY_LOOKBACK_DAYS
    requested_days = max(1, min(requested_days, max_days))
    cutoff_ms = int((time.time() - requested_days * 86400) * 1000)

    if is_daily:
        chunk_years = min(TWS_DAILY_CHUNK_YEARS, max(1, (requested_days + 364) // 365))
        chunk_duration = f"{chunk_years} Y"
    else:
        chunk_days = min(TWS_INTRADAY_CHUNK_DAYS, requested_days)
        chunk_duration = f"{chunk_days} D"

    all_bars: list[dict] = []
    end_date_time = ""
    seen_earliest: set[int] = set()

    while True:
        batch = await fetch_from_tws(
            ib,
            symbol,
            duration=chunk_duration,
            bar_size=normalized_bar_size,
            what_to_show=what_to_show,
            end_date_time=end_date_time,
        )
        if not batch:
            break

        all_bars.extend(batch)
        earliest_ts = batch[0]["time"]
        if earliest_ts <= cutoff_ms:
            break
        if earliest_ts in seen_earliest:
            break
        seen_earliest.add(earliest_ts)
        end_date_time = _ib_datetime_utc(max(0, earliest_ts - 1000))

    return [bar for bar in _dedupe_bars(all_bars) if bar["time"] >= cutoff_ms]


# ── Yahoo historical fetch (yahooquery) ──────────────────────────────

def _fetch_from_yahoo_sync(symbol: str, period: str = "5d", interval: str = "1m") -> list[dict]:
    """Synchronous yahooquery historical fetch — runs in executor."""
    from yahooquery import Ticker

    t = Ticker(symbol)
    df = t.history(period=period, interval=interval)

    if df is None or (hasattr(df, 'empty') and df.empty):
        return []

    # yahooquery returns a DataFrame (possibly MultiIndex with symbol level)
    # Flatten MultiIndex if present
    if hasattr(df.index, 'names') and 'symbol' in (df.index.names or []):
        # Drop the symbol level, keep just the date index
        df = df.droplevel('symbol')

    # If result is a string (error message), return empty
    if isinstance(df, str):
        logger.warning(f"yahooquery history returned error for {symbol}: {df}")
        return []

    result = []
    for idx, row in df.iterrows():
        try:
            # Daily bars return datetime.date objects which lack .timestamp()
            if isinstance(idx, date) and not isinstance(idx, datetime):
                idx = datetime(idx.year, idx.month, idx.day, tzinfo=timezone.utc)
            ts_ms = int(idx.timestamp() * 1000)
            result.append({
                "time": ts_ms,
                "open": float(row.get("open", row.get("Open", 0))),
                "high": float(row.get("high", row.get("High", 0))),
                "low": float(row.get("low", row.get("Low", 0))),
                "close": float(row.get("close", row.get("Close", 0))),
                "volume": float(row.get("volume", row.get("Volume", 0))),
            })
        except Exception as e:
            logger.debug(f"Skipping bar for {symbol}: {e}")
            continue

    return result


async def fetch_from_yahoo(symbol: str, period: str = "5d", interval: str = "1m") -> list[dict]:
    """Async wrapper for yahooquery historical fetch."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _fetch_from_yahoo_sync, symbol, period, interval)


# ── Public API ────────────────────────────────────────────────────────


def read_bars_window(
    symbol: str,
    bar_size: str = "1m",
    what_to_show: str = "TRADES",
    ts_start: int | None = None,
    ts_end: int | None = None,
    limit: int | None = None,
) -> dict:
    """Synchronous windowed read for viewport-based chart loading.

    Returns { bars, count, ts_min, ts_max } from the DB cache.
    Designed for fast reads — no network fetches, no lock contention.
    """
    table = _table_for_series(bar_size, _normalize_what_to_show(what_to_show))
    with sync_db_session() as conn:
        _init_schema(conn)
        bars = _read_cached_window(
            conn, symbol,
            ts_start=ts_start, ts_end=ts_end, limit=limit,
            table=table,
        )
        ts_min, ts_max = _cached_extent(conn, symbol, table)
    return {
        "bars": bars,
        "count": len(bars),
        "ts_min": ts_min,
        "ts_max": ts_max,
    }


async def get_historical_bars(
    symbol: str,
    ib=None,
    tws_connected: bool = False,
    duration: str = DEFAULT_INTRADAY_DURATION,
    bar_size: str = "1 min",
    what_to_show: str = "TRADES",
    force_deep: bool = False,
) -> tuple[list[dict], str]:
    """
    Get historical bars for a symbol. Returns (bars, source).

    Strategy:
    1. Acquire per-symbol lock (prevents duplicate concurrent fetches)
    2. Check cache — if fresh, return immediately
       - If cached source is 'tws', skip Yahoo even if TWS is now disconnected
    3. If TWS connected, fetch from TWS → save → return
    4. Else, fetch from Yahoo → save → return
       - Yahoo uses INSERT OR IGNORE so it never overwrites TWS bars
    5. If fetch fails, return stale cache if available
    """
    db_bar_size = _normalize_bar_size(bar_size)
    is_daily = db_bar_size == "1d"
    what_to_show = _normalize_what_to_show(what_to_show)
    cache_key = _cache_key_for_series(db_bar_size, what_to_show)
    ttl = CACHE_TTL_DAILY if is_daily else CACHE_TTL
    table = _table_for_series(db_bar_size, what_to_show)
    lookback_days = _duration_to_days(
        duration,
        MAX_DAILY_LOOKBACK_DAYS if is_daily else MAX_INTRADAY_LOOKBACK_DAYS,
    )
    lookback_days = max(1, min(
        lookback_days,
        MAX_DAILY_LOOKBACK_DAYS if is_daily else MAX_INTRADAY_LOOKBACK_DAYS,
    ))

    lock = _get_fetch_lock(symbol, db_bar_size)
    async with lock:
        # ── Step 1: DB read (lock held briefly) ──────────────────────────
        async with _raw_db_session() as conn:
            _init_schema(conn)
            is_fresh, cached_source, depth_complete = _cache_fresh(conn, symbol, cache_key, ttl)
            last_ts_ms = _latest_bar_ts(conn, symbol, table)
            earliest_ts_ms = _earliest_bar_ts(conn, symbol, table)
            if is_fresh:
                cached = _read_cached(conn, symbol, limit_days=lookback_days, table=table)
                if cached:
                    has_full_coverage = _has_full_coverage(earliest_ts_ms, lookback_days, depth_complete)
                    if has_full_coverage:
                        logger.info(
                            f"Cache hit for {symbol} {cache_key} ({len(cached)} bars, source={cached_source})"
                        )
                        return cached, "cache"
                    logger.info(
                        f"Fresh cache for {symbol} {cache_key} is too shallow for {lookback_days}d; "
                        "requesting deeper history"
                    )
                    last_ts_ms = None
            if last_ts_ms is not None:
                gap_days = (time.time() - last_ts_ms / 1000) / 86400
                requested_duration = _incremental_tws_duration(last_ts_ms, duration, is_daily)
                logger.info(
                    f"Incremental fetch for {symbol}: last bar {gap_days:.1f} days ago, "
                    f"requesting {requested_duration}"
                )
        # Lock released — network fetches happen outside the DB lock so other
        # coroutines (e.g. the frontend's historical request) can read the DB
        # while the prefetcher is waiting on TWS or Yahoo.

        # ── Step 2: Network fetch (no DB lock held) ───────────────────────
        fetched_bars: list[dict] = []
        fetch_source: str = ""
        mark_depth_complete: bool | None = None  # None = preserve existing flag

        # For supported bar sizes on a cold cache (no bars at all), try DailyIQ
        # first — it is fast (often a warm SQLite cache hit from startup warmup)
        # and lets the frontend show data immediately while IBKR backfills in
        # the background.  For incremental updates (last_ts_ms set) TWS is
        # preferred because it delivers precise gap fills.
        _diq_supported = what_to_show == "TRADES" and db_bar_size in ("1m", "5m", "15m", "1h", "4h", "1d", "1w")
        if _diq_supported and last_ts_ms is None:
            try:
                from dailyiq_provider import fetch_bars_from_dailyiq_async
                diq_limit = max(50, min(5000, lookback_days * ({"1m": 390, "5m": 78, "15m": 26, "1h": 7, "4h": 2, "1d": 1, "1w": 1}.get(db_bar_size, 1))))
                diq_bars = await fetch_bars_from_dailyiq_async(symbol, timeframe=db_bar_size, limit=diq_limit)
                if diq_bars:
                    fetched_bars = diq_bars
                    fetch_source = "dailyiq"
                    logger.info(
                        f"Fetched {len(diq_bars)} {cache_key} bars from DailyIQ for {symbol} (fast path)"
                    )
            except Exception as e:
                logger.warning(f"DailyIQ historical fast-path failed for {symbol}: {e}")

        if tws_connected and ib is not None:
            try:
                tws_bar = db_bar_size
                tws_default_dur = DEFAULT_DAILY_DURATION if is_daily else duration
                tws_dur = _incremental_tws_duration(last_ts_ms, tws_default_dur, is_daily)
                # On a cold cache, we already have DailyIQ bars; use TWS for incremental
                # gap-fill (authoritative) rather than a slow full paginated fetch.
                tws_last_ts = last_ts_ms if fetched_bars else None
                if tws_last_ts is None and not fetched_bars:
                    if is_daily or force_deep:
                        # Daily or explicit deep-backfill request: paginate the full duration.
                        tws_bars = await fetch_from_tws_paginated(
                            ib,
                            symbol,
                            duration=tws_dur,
                            bar_size=tws_bar,
                            what_to_show=what_to_show,
                        )
                    else:
                        # Fast seed for cold-cache intraday: return a small window
                        # immediately so the chart isn't blank. The background
                        # backfill_loop fills out the full history with force_deep=True.
                        _cold_seed = {"1m": "1 D", "5m": "1 D", "15m": "1 D"}
                        seed_dur = _cold_seed.get(db_bar_size, "1 D")
                        tws_bars = await fetch_from_tws(
                            ib, symbol, seed_dur, tws_bar, what_to_show
                        )
                else:
                    # Incremental fetch: either we have cached bars (last_ts_ms set)
                    # or DailyIQ already seeded the cache (use DailyIQ's max time as anchor).
                    anchor_ts = last_ts_ms or (max(b["time"] for b in fetched_bars) if fetched_bars else None)
                    tws_dur = _incremental_tws_duration(anchor_ts, tws_default_dur, is_daily)
                    tws_bars = await fetch_from_tws(ib, symbol, tws_dur, tws_bar, what_to_show)
                if tws_bars:
                    fetch_source = "tws"
                    # TWS bars are authoritative: merge with DailyIQ seed if present
                    if fetched_bars:
                        existing_times = {b["time"] for b in fetched_bars}
                        fetched_bars = fetched_bars + [b for b in tws_bars if b["time"] not in existing_times]
                    else:
                        fetched_bars = tws_bars
                    logger.info(
                        f"Fetched {len(tws_bars)} {cache_key} bars from TWS for {symbol} "
                        f"(duration={tws_dur}, whatToShow={what_to_show})"
                    )
                    if last_ts_ms is None and tws_last_ts is None:
                        new_earliest = min(b["time"] for b in tws_bars)
                        if earliest_ts_ms is None or new_earliest >= earliest_ts_ms - 86400_000:
                            mark_depth_complete = True
                            logger.info(f"Depth complete (TWS) for {symbol} {cache_key}")
            except Exception as e:
                logger.warning(f"TWS historical fetch failed for {symbol}: {e}")

        # ── Step 2b: DailyIQ fallback for incremental / non-cold paths ──
        if not fetched_bars and _diq_supported:
            try:
                from dailyiq_provider import fetch_bars_from_dailyiq_async
                diq_limit = max(50, min(5000, lookback_days * ({"1m": 390, "5m": 78, "15m": 26, "1h": 7, "4h": 2, "1d": 1, "1w": 1}.get(db_bar_size, 1))))
                diq_bars = await fetch_bars_from_dailyiq_async(symbol, timeframe=db_bar_size, limit=diq_limit)
                if diq_bars:
                    fetched_bars = diq_bars
                    fetch_source = "dailyiq"
                    logger.info(
                        f"Fetched {len(diq_bars)} {cache_key} bars from DailyIQ for {symbol}"
                    )
            except Exception as e:
                logger.warning(f"DailyIQ historical fetch failed for {symbol}: {e}")

        if not fetched_bars:
            if what_to_show != "TRADES":
                async with _raw_db_session() as conn:
                    _init_schema(conn)
                    cached = _read_cached(conn, symbol, limit_days=lookback_days, table=table)
                if cached:
                    logger.info(f"Returning stale {what_to_show} cache for {symbol} ({len(cached)} bars)")
                    return cached, "cache"
                return [], "none"
            # Even if cached source is TWS, still fetch from Yahoo to gap-fill
            # older history. Yahoo uses INSERT OR IGNORE so TWS bars stay intact.
            try:
                yf_interval = "1d" if is_daily else ("15m" if db_bar_size == "15m" else ("5m" if db_bar_size == "5m" else "1m"))
                yf_default = _yahoo_seed_period(db_bar_size, lookback_days)
                # If we have cached bars but they don't go back far enough, and depth is
                # not already known to be complete, use the full period to backfill.
                need_backfill = False
                if not depth_complete and earliest_ts_ms is not None:
                    cached_span_days = (time.time() - earliest_ts_ms / 1000) / 86400
                    if cached_span_days < lookback_days * 0.8:  # less than 80% of requested range
                        need_backfill = True
                        logger.info(
                            f"Cached data for {symbol} only spans {cached_span_days:.0f} days "
                            f"but {lookback_days} requested — doing full backfill"
                        )
                if need_backfill:
                    yf_period = yf_default
                else:
                    yf_period = _incremental_yahoo_period(last_ts_ms, yf_default, is_daily)
                fetched_bars = await fetch_from_yahoo(symbol, period=yf_period, interval=yf_interval)
                if fetched_bars:
                    fetch_source = "yahoo"
                    logger.info(
                        f"Fetched {len(fetched_bars)} {cache_key} bars from Yahoo for {symbol} "
                        f"(period={yf_period})"
                    )
                    # If earliest bar didn't move backwards, Yahoo has given us all it has.
                    new_earliest = min(b["time"] for b in fetched_bars)
                    if earliest_ts_ms is None or new_earliest >= earliest_ts_ms - 86400_000:
                        mark_depth_complete = True
                        logger.info(f"Depth complete (Yahoo) for {symbol} {cache_key}")
            except Exception as e:
                logger.warning(f"Yahoo historical fetch failed for {symbol}: {e}")

        # ── Step 3: DB write + read (lock held briefly) ───────────────────
        if fetched_bars:
            async with _raw_db_session() as conn:
                _init_schema(conn)
                _write_bars(conn, symbol, fetched_bars, db_bar_size, source=fetch_source,
                            what_to_show=what_to_show, depth_complete=mark_depth_complete)
                return _read_cached(conn, symbol, limit_days=lookback_days, table=table), fetch_source

        # Stale cache fallback
        async with _raw_db_session() as conn:
            _init_schema(conn)
            cached = _read_cached(conn, symbol, limit_days=lookback_days, table=table)
        if cached:
            logger.info(f"Returning stale cache for {symbol} ({len(cached)} bars)")
            return cached, "cache"

        return [], "none"


def save_realtime_bar(symbol: str, bar: dict):
    """Save a single real-time bar to SQLite (called from the RT bar callback).

    Uses sync_db_session so callback writes are safe from any thread.
    Does not update fetch_meta — cache freshness must only reflect historical fetches,
    not streaming bars, so the backfill loop can detect and fill intraday gaps.
    """
    with sync_db_session() as conn:
        _init_schema(conn)
        _write_bars(conn, symbol, [bar], "5s", source="tws", update_meta=False)


def save_realtime_bar_1m(symbol: str, bar: dict, synthetic: bool = False):
    """Upsert a single 1m bar to SQLite (partial bars overwrite).

    Does not update fetch_meta — cache freshness must only reflect historical fetches,
    not streaming bars, so the backfill loop can detect and fill intraday gaps.
    """
    with sync_db_session() as conn:
        _init_schema(conn)
        _write_bars(conn, symbol, [bar], "1m", source="tws", update_meta=False, synthetic=synthetic)


def save_realtime_bar_5m(symbol: str, bar: dict, synthetic: bool = False):
    """Upsert a single 5m bar to SQLite without refreshing fetch metadata."""
    with sync_db_session() as conn:
        _init_schema(conn)
        _write_bars(conn, symbol, [bar], "5m", source="tws", update_meta=False, synthetic=synthetic)


def save_realtime_bar_15m(symbol: str, bar: dict, synthetic: bool = False):
    """Upsert a single 15m bar to SQLite without refreshing fetch metadata."""
    with sync_db_session() as conn:
        _init_schema(conn)
        _write_bars(conn, symbol, [bar], "15m", source="tws", update_meta=False, synthetic=synthetic)


def invalidate_yahoo_cache(symbols: list[str] | None = None):
    """
    Force-expire fetch_meta entries that were sourced from Yahoo so the prefetcher
    will re-fetch them from TWS on the next cycle.

    If `symbols` is provided, only those symbols are invalidated.
    If None, ALL Yahoo-sourced entries are invalidated.

    Does NOT touch TWS-sourced rows — they stay authoritative.
    """
    try:
        with sync_db_session() as conn:
            _init_schema(conn)
            if symbols:
                placeholders = ", ".join("?" * len(symbols))
                conn.execute(
                    f"UPDATE fetch_meta SET fetched_at = 0, depth_complete = 0 WHERE source = 'yahoo' AND symbol IN ({placeholders})",
                    symbols,
                )
                logger.info(f"Invalidated Yahoo cache for {symbols}")
            else:
                conn.execute("UPDATE fetch_meta SET fetched_at = 0, depth_complete = 0 WHERE source = 'yahoo'")
                logger.info("Invalidated all Yahoo-sourced cache entries")
    except Exception as e:
        logger.warning(f"Yahoo cache invalidation failed: {e}")


def shutdown_db():
    """No-op — SQLite WAL does not require explicit checkpoint on shutdown."""
    pass
