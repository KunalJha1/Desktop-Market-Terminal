"""Historical bar storage (DuckDB) + fetching from TWS / Yahoo Finance."""

import asyncio
import logging
import time
from pathlib import Path

import duckdb

logger = logging.getLogger(__name__)

DB_DIR = Path(__file__).parent.parent / "data"
DB_PATH = DB_DIR / "market.duckdb"

# How stale cached data can be before we re-fetch (seconds)
CACHE_TTL = 300  # 5 minutes


def _get_conn() -> duckdb.DuckDBPyConnection:
    DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = duckdb.connect(str(DB_PATH))
    _ensure_schema(conn)
    return conn


def _ensure_schema(conn: duckdb.DuckDBPyConnection):
    """Create tables + indexes on first use."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_1m (
            symbol   VARCHAR NOT NULL,
            ts       BIGINT  NOT NULL,   -- Unix ms
            open     DOUBLE  NOT NULL,
            high     DOUBLE  NOT NULL,
            low      DOUBLE  NOT NULL,
            close    DOUBLE  NOT NULL,
            volume   DOUBLE  NOT NULL,
            PRIMARY KEY (symbol, ts)
        )
    """)
    # Covering index: symbol + ts descending → fast range scans for chart rendering
    # DuckDB sorts the primary key automatically, but explicit index helps queries
    # that filter by symbol and order by ts
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_1m_sym_ts
        ON ohlcv_1m (symbol, ts)
    """)

    # Secondary 5s bars for active chart symbols (30-day cache per CLAUDE.md)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_5s (
            symbol   VARCHAR NOT NULL,
            ts       BIGINT  NOT NULL,
            open     DOUBLE  NOT NULL,
            high     DOUBLE  NOT NULL,
            low      DOUBLE  NOT NULL,
            close    DOUBLE  NOT NULL,
            volume   DOUBLE  NOT NULL,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_5s_sym_ts
        ON ohlcv_5s (symbol, ts)
    """)

    # Metadata: track when each symbol was last fetched
    conn.execute("""
        CREATE TABLE IF NOT EXISTS fetch_meta (
            symbol     VARCHAR NOT NULL,
            bar_size   VARCHAR NOT NULL,
            fetched_at BIGINT  NOT NULL,  -- Unix ms
            PRIMARY KEY (symbol, bar_size)
        )
    """)


def _cache_fresh(conn: duckdb.DuckDBPyConnection, symbol: str, bar_size: str) -> bool:
    """Check if cached data is fresh enough."""
    row = conn.execute(
        "SELECT fetched_at FROM fetch_meta WHERE symbol = ? AND bar_size = ?",
        [symbol, bar_size],
    ).fetchone()
    if not row:
        return False
    age_s = (int(time.time() * 1000) - row[0]) / 1000
    return age_s < CACHE_TTL


def _read_cached(conn: duckdb.DuckDBPyConnection, symbol: str, limit_days: int = 5) -> list[dict]:
    """Read cached 1m bars, most recent `limit_days` days."""
    cutoff_ms = int((time.time() - limit_days * 86400) * 1000)
    rows = conn.execute(
        """
        SELECT ts, open, high, low, close, volume
        FROM ohlcv_1m
        WHERE symbol = ? AND ts >= ?
        ORDER BY ts ASC
        """,
        [symbol, cutoff_ms],
    ).fetchall()
    return [
        {"time": r[0], "open": r[1], "high": r[2], "low": r[3], "close": r[4], "volume": r[5]}
        for r in rows
    ]


def _write_bars(conn: duckdb.DuckDBPyConnection, symbol: str, bars: list[dict], bar_size: str = "1m"):
    """Upsert bars into DuckDB."""
    if not bars:
        return
    table = "ohlcv_1m" if bar_size == "1m" else "ohlcv_5s"
    conn.executemany(
        f"""
        INSERT OR REPLACE INTO {table} (symbol, ts, open, high, low, close, volume)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (symbol, b["time"], b["open"], b["high"], b["low"], b["close"], b["volume"])
            for b in bars
        ],
    )
    conn.execute(
        """
        INSERT OR REPLACE INTO fetch_meta (symbol, bar_size, fetched_at)
        VALUES (?, ?, ?)
        """,
        [symbol, bar_size, int(time.time() * 1000)],
    )


# ── TWS historical fetch ─────────────────────────────────────────────

async def fetch_from_tws(ib, symbol: str, duration: str = "5 D", bar_size: str = "1 min") -> list[dict]:
    """Fetch historical bars from TWS via ib_insync."""
    from ib_insync import Stock

    contract = Stock(symbol, "SMART", "USD")
    bars = await ib.reqHistoricalDataAsync(
        contract,
        endDateTime="",
        durationStr=duration,
        barSizeSetting=bar_size,
        whatToShow="TRADES",
        useRTH=False,
        formatDate=2,  # UTC timestamp
    )

    result = []
    for b in bars:
        # ib_insync returns datetime objects; convert to Unix ms
        ts_ms = int(b.date.timestamp() * 1000) if hasattr(b.date, 'timestamp') else int(b.date) * 1000
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

    t = Ticker(symbol, asynchronous=True)
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
) -> tuple[list[dict], str]:
    """
    Get historical bars for a symbol. Returns (bars, source).

    Strategy:
    1. Check DuckDB cache — if fresh, return immediately
    2. If TWS connected, fetch from TWS → save to DuckDB → return
    3. Else, fetch from Yahoo → save to DuckDB → return
    4. If fetch fails, return stale cache if available
    """
    conn = _get_conn()
    try:
        # 1. Check cache
        if _cache_fresh(conn, symbol, bar_size):
            cached = _read_cached(conn, symbol)
            if cached:
                logger.info(f"Cache hit for {symbol} ({len(cached)} bars)")
                return cached, "cache"

        # 2. Try TWS
        if tws_connected and ib is not None:
            try:
                bars = await fetch_from_tws(ib, symbol, duration, bar_size)
                if bars:
                    _write_bars(conn, symbol, bars, "1m")
                    logger.info(f"Fetched {len(bars)} bars from TWS for {symbol}")
                    return bars, "tws"
            except Exception as e:
                logger.warning(f"TWS historical fetch failed for {symbol}: {e}")

        # 3. Try Yahoo
        try:
            yf_period = "5d" if "D" in duration else "1mo"
            bars = await fetch_from_yahoo(symbol, period=yf_period, interval="1m")
            if bars:
                _write_bars(conn, symbol, bars, "1m")
                logger.info(f"Fetched {len(bars)} bars from Yahoo for {symbol}")
                return bars, "yahoo"
        except Exception as e:
            logger.warning(f"Yahoo historical fetch failed for {symbol}: {e}")

        # 4. Stale cache fallback
        cached = _read_cached(conn, symbol)
        if cached:
            logger.info(f"Returning stale cache for {symbol} ({len(cached)} bars)")
            return cached, "cache"

        return [], "none"
    finally:
        conn.close()


def save_realtime_bar(symbol: str, bar: dict):
    """Save a single real-time bar to DuckDB (called from the flush loop)."""
    conn = _get_conn()
    try:
        _write_bars(conn, symbol, [bar], "1m")
    finally:
        conn.close()
