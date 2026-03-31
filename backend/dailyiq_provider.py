"""DailyIQ API provider — middle-tier data source between TWS and Yahoo.

Supports: snapshot (quotes), price-bars (OHLCV), fundamentals, technicals,
news, and earnings endpoints.  Responses are cached locally in SQLite to
reduce API calls.

Timeframe support for bars: 5m, 15m, 1d, 1w (no 1m or 5s).
"""

from __future__ import annotations

import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Sequence

import requests

from db_utils import sync_db_session, execute_one_tx_with_retry

logger = logging.getLogger(__name__)

# ── Cache TTLs (seconds) ─────────────────────────────────────────────
CACHE_TTL_BARS_INTRADAY = 300       # 5 min
CACHE_TTL_BARS_DAILY = 21_600       # 6 hr
CACHE_TTL_SNAPSHOT = 60             # 1 min
CACHE_TTL_FUNDAMENTALS = 86_400     # 24 hr

# Supported bar timeframes
SUPPORTED_TIMEFRAMES = {"5m", "15m", "1d", "1w"}

HTTP_TIMEOUT_QUOTE = 5   # seconds — fast path for quotes
HTTP_TIMEOUT = 15        # seconds — bars and other endpoints
HTTP_TIMEOUT_BARS = 15   # alias for clarity


# ── API key ──────────────────────────────────────────────────────────

def _load_api_key() -> str | None:
    return os.getenv("DAILYIQ_API_KEY") or None


def _base_url() -> str | None:
    key = _load_api_key()
    if not key:
        return None
    return f"https://dailyiq.me/v1/{key}"


# ── Response cache (SQLite) ──────────────────────────────────────────

def _read_cache(cache_key: str, ttl_s: float) -> dict | None:
    """Return cached JSON if fresh, else None."""
    with sync_db_session() as conn:
        row = conn.execute(
            "SELECT response, fetched_at FROM dailyiq_cache WHERE cache_key = ?",
            (cache_key,),
        ).fetchone()
    if not row:
        return None
    age_s = (time.time() * 1000 - row[1]) / 1000
    if age_s >= ttl_s:
        return None
    try:
        return json.loads(row[0])
    except (json.JSONDecodeError, TypeError):
        return None


def _write_cache(cache_key: str, data: dict) -> None:
    now_ms = int(time.time() * 1000)
    with sync_db_session() as conn:
        execute_one_tx_with_retry(
            conn,
            """
            INSERT OR REPLACE INTO dailyiq_cache (cache_key, response, fetched_at)
            VALUES (?, ?, ?)
            """,
            (cache_key, json.dumps(data, default=str), now_ms),
        )


# ── HTTP helper ──────────────────────────────────────────────────────

def _dailyiq_get_json(
    endpoint: str,
    params: dict | None = None,
    ttl_s: float = CACHE_TTL_SNAPSHOT,
    timeout: float = HTTP_TIMEOUT,
) -> dict | None:
    """GET a DailyIQ endpoint with local response cache.

    Returns parsed JSON dict on success, None on failure or missing API key.
    """
    base = _base_url()
    if not base:
        return None

    # Build cache key from endpoint + sorted params
    parts = [endpoint]
    if params:
        parts.extend(f"{k}={v}" for k, v in sorted(params.items()))
    cache_key = ":".join(parts)

    cached = _read_cache(cache_key, ttl_s)
    if cached is not None:
        logger.debug("DailyIQ cache hit: %s", cache_key)
        return cached

    url = f"{base}/{endpoint.lstrip('/')}"
    try:
        r = requests.get(url, params=params, timeout=timeout)
        if r.status_code == 429:
            logger.warning("DailyIQ rate limited on %s — backing off", endpoint)
            return None
        if r.status_code != 200:
            logger.warning("DailyIQ %s returned %d", endpoint, r.status_code)
            return None
        data = r.json()
        _write_cache(cache_key, data)
        return data
    except requests.RequestException as exc:
        logger.warning("DailyIQ request failed for %s: %s", endpoint, exc)
        return None
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("DailyIQ response not JSON for %s: %s", endpoint, exc)
        return None


# ── Date parsing ─────────────────────────────────────────────────────

def _parse_date_to_ms(date_str: str) -> int | None:
    """Parse a DailyIQ date string to Unix ms.

    Handles: "2025-03-28", "2025-03-28T14:30:00", "2025-03-28T14:30:00Z"
    """
    if not date_str:
        return None
    try:
        # Try ISO with time
        for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(date_str, fmt).replace(tzinfo=timezone.utc)
                return int(dt.timestamp() * 1000)
            except ValueError:
                continue
    except Exception:
        pass
    return None


# ── Bars ─────────────────────────────────────────────────────────────

def fetch_bars_from_dailyiq(
    symbol: str,
    timeframe: str = "1d",
    limit: int = 365,
) -> list[dict]:
    """Fetch OHLCV bars from DailyIQ.

    Returns list of {time, open, high, low, close, volume} dicts
    matching the TWS/Yahoo bar format, or empty list if unsupported/failed.
    """
    if timeframe not in SUPPORTED_TIMEFRAMES:
        return []

    # DailyIQ requires limit in [50, 5000]
    limit = max(50, min(5000, limit))

    ttl = CACHE_TTL_BARS_DAILY if timeframe in ("1d", "1w") else CACHE_TTL_BARS_INTRADAY
    data = _dailyiq_get_json(
        "price-bars",
        params={"symbol": symbol, "timeframe": timeframe, "limit": limit, "order": "asc"},
        ttl_s=ttl,
    )
    if not data or "items" not in data:
        return []

    bars = []
    for item in data["items"]:
        ts_ms = _parse_date_to_ms(item.get("date_utc", ""))
        if ts_ms is None:
            continue
        bars.append({
            "time": ts_ms,
            "open": float(item.get("open", 0)),
            "high": float(item.get("high", 0)),
            "low": float(item.get("low", 0)),
            "close": float(item.get("close", 0)),
            "volume": float(item.get("volume", 0)),
        })

    if bars:
        logger.info(
            "Fetched %d %s bars from DailyIQ for %s", len(bars), timeframe, symbol
        )
    return bars


async def fetch_bars_from_dailyiq_async(
    symbol: str,
    timeframe: str = "1d",
    limit: int = 365,
) -> list[dict]:
    """Async wrapper — runs the sync fetch in an executor."""
    import asyncio
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, fetch_bars_from_dailyiq, symbol, timeframe, limit,
    )


# ── Quotes (snapshot) ────────────────────────────────────────────────

def fetch_quote_from_dailyiq(symbol: str) -> dict | None:
    """Fetch a quote from DailyIQ /snapshot endpoint.

    Returns a dict matching the yahoo_to_quote() shape, or None on failure.
    """
    data = _dailyiq_get_json(f"snapshot/{symbol}", ttl_s=CACHE_TTL_SNAPSHOT, timeout=HTTP_TIMEOUT_QUOTE)
    if not data:
        return None

    price = float(data.get("price", 0) or 0)
    open_ = float(data.get("open", 0) or 0)
    high = float(data.get("high", 0) or 0)
    low = float(data.get("low", 0) or 0)
    change = float(data.get("change", 0) or 0)
    change_pct = float(data.get("changePct", 0) or 0)

    # Derive prev_close from price and change
    prev_close = round(price - change, 4) if change else 0.0

    sentiment_raw = data.get("sentimentScore")
    sentiment_score = int(sentiment_raw) if sentiment_raw is not None else None

    return {
        "symbol": symbol,
        "last": price,
        "bid": None,
        "ask": None,
        "mid": None,
        "open": open_,
        "high": high,
        "low": low,
        "prev_close": prev_close,
        "change": change,
        "change_pct": change_pct,
        "volume": None,  # snapshot doesn't include volume
        "spread": None,
        "source": "dailyiq",
        "sentimentScore": sentiment_score,
    }


def fetch_watchlist_quotes_from_dailyiq(symbols: list[str]) -> list[dict]:
    """Fetch quotes for multiple symbols from DailyIQ (sequential)."""
    quotes = []
    for sym in symbols:
        q = fetch_quote_from_dailyiq(sym)
        if q and q.get("last"):
            quotes.append(q)
    return quotes


def fetch_watchlist_quotes_from_dailyiq_concurrent(
    symbols: Sequence[str],
    max_workers: int = 10,
) -> list[dict]:
    """Fetch quotes for multiple symbols from DailyIQ concurrently.

    Uses a ThreadPoolExecutor so all symbols are fetched in parallel,
    reducing wall-clock time from O(n * network_latency) to ~O(network_latency).
    """
    if not symbols:
        return []
    quotes: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(max_workers, len(symbols))) as pool:
        futures = {pool.submit(fetch_quote_from_dailyiq, sym): sym for sym in symbols}
        for fut in as_completed(futures):
            try:
                q = fut.result()
                if q and q.get("last"):
                    quotes.append(q)
            except Exception as exc:
                logger.debug("DailyIQ concurrent quote failed for %s: %s", futures[fut], exc)
    return quotes


def fetch_bars_batch_concurrent(
    symbol_timeframe_pairs: Sequence[tuple[str, str]],
    limit: int = 365,
    max_workers: int = 8,
) -> list[tuple[str, str, list[dict]]]:
    """Fetch bars for multiple (symbol, timeframe) pairs concurrently.

    Returns list of (symbol, timeframe, bars) tuples (empty bars on failure).
    Only fetches supported timeframes; unsupported pairs return empty bars.
    """
    if not symbol_timeframe_pairs:
        return []

    supported = [(s, tf) for s, tf in symbol_timeframe_pairs if tf in SUPPORTED_TIMEFRAMES]
    if not supported:
        return []

    results: list[tuple[str, str, list[dict]]] = []
    with ThreadPoolExecutor(max_workers=min(max_workers, len(supported))) as pool:
        futures = {
            pool.submit(fetch_bars_from_dailyiq, sym, tf, limit): (sym, tf)
            for sym, tf in supported
        }
        for fut in as_completed(futures):
            sym, tf = futures[fut]
            try:
                bars = fut.result()
                results.append((sym, tf, bars))
            except Exception as exc:
                logger.debug("DailyIQ concurrent bars failed for %s/%s: %s", sym, tf, exc)
                results.append((sym, tf, []))
    return results


# ── Sentiment scores (from cached snapshots) ─────────────────────────

def fetch_sentiment_scores_from_cache(symbols: list[str]) -> dict[str, int | None]:
    """Read sentimentScore from cached DailyIQ snapshot responses.

    Uses existing cache entries only — no new API calls.
    Returns a dict mapping symbol → score (None if not cached or missing).
    """
    result: dict[str, int | None] = {}
    for sym in symbols:
        cache_key = f"snapshot/{sym}"
        cached = _read_cache(cache_key, ttl_s=float("inf"))
        if cached and cached.get("sentimentScore") is not None:
            try:
                result[sym] = int(cached["sentimentScore"])
            except (TypeError, ValueError):
                result[sym] = None
        else:
            result[sym] = None
    return result


# ── Fundamentals ─────────────────────────────────────────────────────

def fetch_fundamentals_from_dailyiq(
    symbol: str,
) -> tuple[float | None, float | None, float | None]:
    """Fetch PE ratio and market cap from DailyIQ /fundamentals.

    Returns (trailing_pe, forward_pe, market_cap) — forward_pe is None
    since DailyIQ doesn't provide it.
    """
    data = _dailyiq_get_json(f"fundamentals/{symbol}", ttl_s=CACHE_TTL_FUNDAMENTALS)
    if not data:
        return None, None, None

    pe_ratio = data.get("peRatio")
    trailing_pe = float(pe_ratio) if pe_ratio is not None else None

    # Extract market cap — DailyIQ returns nested object or display string
    market_cap = None
    mc = data.get("marketCap")
    if isinstance(mc, dict):
        market_cap = mc.get("usd")
    elif isinstance(mc, (int, float)):
        market_cap = float(mc)
    elif isinstance(data.get("marketCapDisplay"), str):
        # Parse "3251.40B" style
        cap_str = data["marketCapDisplay"]
        try:
            if cap_str.endswith("B"):
                market_cap = float(cap_str[:-1]) * 1e9
            elif cap_str.endswith("M"):
                market_cap = float(cap_str[:-1]) * 1e6
            elif cap_str.endswith("T"):
                market_cap = float(cap_str[:-1]) * 1e12
        except (ValueError, TypeError):
            pass

    # DailyIQ doesn't provide forward PE
    return trailing_pe, None, market_cap
