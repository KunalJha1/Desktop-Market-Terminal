"""Historical bar storage (SQLite) + fetching from TWS / Yahoo Finance."""

import asyncio
import logging
import sqlite3
import time
from datetime import date, datetime, timezone

from db_utils import (
    DB_DIR,
    DB_PATH,
    db_session as _raw_db_session,
    execute_many_with_retry,
    execute_one_tx_with_retry,
    sync_db_session,
)

logger = logging.getLogger(__name__)

# Schema is set up once on the first connection open.
_schema_initialized = False

# How stale cached data can be before we re-fetch (seconds)
CACHE_TTL = 300  # 5 minutes for intraday
CACHE_TTL_DAILY = 21600  # 6 hours for daily bars

# When doing an incremental fetch, overlap by this many days before the last cached bar
# so we don't miss bars at the seam (e.g. partial last day, weekend gaps, etc.)
INCREMENTAL_OVERLAP_DAYS = 5

# Yahoo Finance hard limits for 1m data (API won't return further back)
YAHOO_1M_MAX_DAYS = 29

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


def _table_for_series(bar_size: str, what_to_show: str) -> str:
    base = "ohlcv_1d" if bar_size == "1d" else ("ohlcv_1m" if bar_size == "1m" else "ohlcv_5s")
    mode = _normalize_what_to_show(what_to_show)
    if mode == "TRADES" or base == "ohlcv_5s":
        return base
    return f"{base}_{mode.lower()}"


def _cache_key_for_series(bar_size: str, what_to_show: str) -> str:
    mode = _normalize_what_to_show(what_to_show)
    return bar_size if mode == "TRADES" else f"{bar_size}_{mode.lower()}"


def _latest_bar_ts(conn: sqlite3.Connection, symbol: str, table: str) -> int | None:
    """Return the Unix ms timestamp of the most recent cached bar, or None."""
    row = conn.execute(
        f"SELECT MAX(ts) FROM {table} WHERE symbol = ?", [symbol]
    ).fetchone()
    return row[0] if row and row[0] is not None else None


def _incremental_tws_duration(last_ts_ms: int | None, default: str, is_daily: bool) -> str:
    """
    Return a TWS durationStr that covers only the gap since the last cached bar
    plus INCREMENTAL_OVERLAP_DAYS. Falls back to `default` if there is no prior data.
    """
    if last_ts_ms is None:
        return default
    gap_days = (time.time() - last_ts_ms / 1000) / 86400 + INCREMENTAL_OVERLAP_DAYS
    gap_days = max(gap_days, INCREMENTAL_OVERLAP_DAYS)
    if is_daily:
        if gap_days <= 365:
            months = max(1, int(gap_days / 30) + 1)
            return f"{months} M"
        else:
            years = int(gap_days / 365) + 1
            return f"{years} Y"
    else:
        days = int(gap_days) + 1
        if days <= 365:
            return f"{days} D"
        else:
            months = int(gap_days / 30) + 1
            return f"{months} M"


def _incremental_yahoo_period(last_ts_ms: int | None, default: str, is_daily: bool) -> str:
    """
    Return a yahooquery period string covering only the gap since the last cached bar
    plus INCREMENTAL_OVERLAP_DAYS. Falls back to `default` if there is no prior data.

    For 1m bars Yahoo only goes back ~29 days regardless, so we cap there.
    """
    if last_ts_ms is None:
        return default
    gap_days = (time.time() - last_ts_ms / 1000) / 86400 + INCREMENTAL_OVERLAP_DAYS
    gap_days = max(gap_days, INCREMENTAL_OVERLAP_DAYS)

    if not is_daily:
        # Yahoo 1m hard limit — no point asking for more
        gap_days = min(gap_days, YAHOO_1M_MAX_DAYS)

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
    else:
        return "2y"


def _ensure_schema(conn: sqlite3.Connection):
    """Create tables + indexes on first use."""
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
) -> tuple[bool, str]:
    """Check if cached data is fresh enough. Returns (is_fresh, source)."""
    row = conn.execute(
        "SELECT fetched_at, source FROM fetch_meta WHERE symbol = ? AND bar_size = ?",
        [symbol, bar_size],
    ).fetchone()
    if not row:
        return False, "none"
    fetched_at, source = row[0], row[1] or "yahoo"
    age_s = (int(time.time() * 1000) - fetched_at) / 1000
    return age_s < ttl, source


def _read_cached(conn: sqlite3.Connection, symbol: str, limit_days: int = 5, table: str = "ohlcv_1m") -> list[dict]:
    """Read cached bars, most recent `limit_days` days."""
    cutoff_ms = int((time.time() - limit_days * 86400) * 1000)
    rows = conn.execute(
        f"""
        SELECT ts, open, high, low, close, volume
        FROM {table}
        WHERE symbol = ? AND ts >= ?
        ORDER BY ts ASC
        """,
        [symbol, cutoff_ms],
    ).fetchall()
    return [
        {"time": r[0], "open": r[1], "high": r[2], "low": r[3], "close": r[4], "volume": r[5]}
        for r in rows
    ]


def _write_bars(
    conn: sqlite3.Connection,
    symbol: str,
    bars: list[dict],
    bar_size: str = "1m",
    source: str = "yahoo",
    what_to_show: str = "TRADES",
):
    """
    Upsert bars into SQLite.

    TWS writes use INSERT OR REPLACE (authoritative — always overwrites).
    Yahoo writes use INSERT OR IGNORE (gap-fill only — never overwrites TWS bars).
    """
    if not bars:
        return
    table = _table_for_series(bar_size, what_to_show)
    cache_key = _cache_key_for_series(bar_size, what_to_show)

    bar_params = [
        (symbol, b["time"], b["open"], b["high"], b["low"], b["close"], b["volume"])
        for b in bars
    ]

    if source == "tws":
        # TWS is authoritative — overwrite any existing bar
        execute_many_with_retry(
            conn,
            f"""
            INSERT OR REPLACE INTO {table} (symbol, ts, open, high, low, close, volume)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            bar_params,
        )
        # TWS always updates fetch_meta unconditionally
        execute_one_tx_with_retry(
            conn,
            """
            INSERT OR REPLACE INTO fetch_meta (symbol, bar_size, fetched_at, source)
            VALUES (?, ?, ?, ?)
            """,
                (symbol, cache_key, int(time.time() * 1000), "tws"),
            )
    else:
        # Yahoo — gap-fill only: never overwrite bars that may be from TWS
        execute_many_with_retry(
            conn,
            f"""
            INSERT OR IGNORE INTO {table} (symbol, ts, open, high, low, close, volume)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            bar_params,
        )
        # Yahoo only updates fetch_meta if the current source is not TWS
        existing = conn.execute(
            "SELECT source FROM fetch_meta WHERE symbol = ? AND bar_size = ?",
            [symbol, cache_key],
        ).fetchone()
        if not existing or existing[0] != "tws":
            execute_one_tx_with_retry(
                conn,
                """
                INSERT OR REPLACE INTO fetch_meta (symbol, bar_size, fetched_at, source)
                VALUES (?, ?, ?, ?)
                """,
                (symbol, cache_key, int(time.time() * 1000), "yahoo"),
            )


# ── TWS historical fetch ─────────────────────────────────────────────

async def fetch_from_tws(
    ib,
    symbol: str,
    duration: str = "5 D",
    bar_size: str = "1 min",
    what_to_show: str = "TRADES",
) -> list[dict]:
    """Fetch historical bars from TWS via ib_insync."""
    from ib_insync import Stock

    contract = Stock(symbol, "SMART", "USD")
    bars = await ib.reqHistoricalDataAsync(
        contract,
        endDateTime="",
        durationStr=duration,
        barSizeSetting=bar_size,
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

async def get_historical_bars(
    symbol: str,
    ib=None,
    tws_connected: bool = False,
    duration: str = "5 D",
    bar_size: str = "1 min",
    what_to_show: str = "TRADES",
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
    is_daily = bar_size in ("1 day", "1d")
    db_bar_size = "1d" if is_daily else "1m"
    what_to_show = _normalize_what_to_show(what_to_show)
    cache_key = _cache_key_for_series(db_bar_size, what_to_show)
    ttl = CACHE_TTL_DAILY if is_daily else CACHE_TTL
    table = _table_for_series(db_bar_size, what_to_show)
    lookback_days = 730 if is_daily else 7

    lock = _get_fetch_lock(symbol, db_bar_size)
    async with lock:
        # ── Step 1: DB read (lock held briefly) ──────────────────────────
        async with _raw_db_session() as conn:
            _init_schema(conn)
            is_fresh, cached_source = _cache_fresh(conn, symbol, cache_key, ttl)
            if is_fresh:
                cached = _read_cached(conn, symbol, limit_days=lookback_days, table=table)
                if cached:
                    logger.info(
                        f"Cache hit for {symbol} {cache_key} ({len(cached)} bars, source={cached_source})"
                    )
                    return cached, "cache"
            last_ts_ms = _latest_bar_ts(conn, symbol, table)
            if last_ts_ms is not None:
                gap_days = (time.time() - last_ts_ms / 1000) / 86400
                logger.info(
                    f"Incremental fetch for {symbol}: last bar {gap_days:.1f} days ago, "
                    f"requesting ~{gap_days + INCREMENTAL_OVERLAP_DAYS:.0f} days"
                )
        # Lock released — network fetches happen outside the DB lock so other
        # coroutines (e.g. the frontend's historical request) can read the DB
        # while the prefetcher is waiting on TWS or Yahoo.

        # ── Step 2: Network fetch (no DB lock held) ───────────────────────
        fetched_bars: list[dict] = []
        fetch_source: str = ""

        if tws_connected and ib is not None:
            try:
                tws_bar = "1 day" if is_daily else bar_size
                tws_default_dur = "2 Y" if is_daily else duration
                tws_dur = _incremental_tws_duration(last_ts_ms, tws_default_dur, is_daily)
                fetched_bars = await fetch_from_tws(ib, symbol, tws_dur, tws_bar, what_to_show)
                if fetched_bars:
                    fetch_source = "tws"
                    logger.info(
                        f"Fetched {len(fetched_bars)} {cache_key} bars from TWS for {symbol} "
                        f"(duration={tws_dur}, whatToShow={what_to_show})"
                    )
            except Exception as e:
                logger.warning(f"TWS historical fetch failed for {symbol}: {e}")

        if not fetched_bars:
            if what_to_show != "TRADES":
                async with _raw_db_session() as conn:
                    _init_schema(conn)
                    cached = _read_cached(conn, symbol, limit_days=lookback_days, table=table)
                if cached:
                    logger.info(f"Returning stale {what_to_show} cache for {symbol} ({len(cached)} bars)")
                    return cached, "cache"
                return [], "none"
            # If cached source is TWS and we're offline, return stale TWS data
            # rather than overwriting with Yahoo (TWS data is authoritative).
            if cached_source == "tws":
                async with _raw_db_session() as conn:
                    _init_schema(conn)
                    cached = _read_cached(conn, symbol, limit_days=lookback_days, table=table)
                if cached:
                    logger.info(
                        f"Returning stale TWS cache for {symbol} ({len(cached)} bars) — "
                        f"Yahoo will not overwrite TWS-sourced bars"
                    )
                    return cached, "cache"

            try:
                yf_interval = "1d" if is_daily else "1m"
                yf_default = "2y" if is_daily else ("5d" if "D" in duration else "1mo")
                yf_period = _incremental_yahoo_period(last_ts_ms, yf_default, is_daily)
                fetched_bars = await fetch_from_yahoo(symbol, period=yf_period, interval=yf_interval)
                if fetched_bars:
                    fetch_source = "yahoo"
                    logger.info(
                        f"Fetched {len(fetched_bars)} {cache_key} bars from Yahoo for {symbol} "
                        f"(period={yf_period})"
                    )
            except Exception as e:
                logger.warning(f"Yahoo historical fetch failed for {symbol}: {e}")

        # ── Step 3: DB write + read (lock held briefly) ───────────────────
        if fetched_bars:
            async with _raw_db_session() as conn:
                _init_schema(conn)
                _write_bars(conn, symbol, fetched_bars, db_bar_size, source=fetch_source, what_to_show=what_to_show)
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
    """
    with sync_db_session() as conn:
        _init_schema(conn)
        _write_bars(conn, symbol, [bar], "5s", source="tws")


def save_realtime_bar_1m(symbol: str, bar: dict):
    """Upsert a single 1m bar to SQLite (partial bars overwrite)."""
    with sync_db_session() as conn:
        _init_schema(conn)
        _write_bars(conn, symbol, [bar], "1m", source="tws")


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
                    f"UPDATE fetch_meta SET fetched_at = 0 WHERE source = 'yahoo' AND symbol IN ({placeholders})",
                    symbols,
                )
                logger.info(f"Invalidated Yahoo cache for {symbols}")
            else:
                conn.execute("UPDATE fetch_meta SET fetched_at = 0 WHERE source = 'yahoo'")
                logger.info("Invalidated all Yahoo-sourced cache entries")
    except Exception as e:
        logger.warning(f"Yahoo cache invalidation failed: {e}")


def shutdown_db():
    """No-op — SQLite WAL does not require explicit checkpoint on shutdown."""
    pass
