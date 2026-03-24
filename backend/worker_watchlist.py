"""Background worker: keeps watchlist_quotes updated via TWS or Yahoo fallback."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import random
import time
from collections import deque
from pathlib import Path
from typing import Dict, List
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

from ib_insync import IB, Stock, Ticker
from yahooquery import Ticker as YahooTicker

from db_utils import sync_db_session
from historical import (
    BACKGROUND_INTRADAY_DURATION,
    DEFAULT_DAILY_DURATION,
    enqueue_historical_priority,
    get_historical_bars,
    invalidate_yahoo_cache,
    pop_historical_priority_requests,
    save_realtime_bar,
    save_realtime_bar_1m,
)
from ibkr_utils import (
    IbkrClientIdManager,
    connect_with_client_id_fallback,
    is_client_id_in_use_error,
)
from runtime_paths import data_dir, resource_path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

logger = logging.getLogger("watchlist-worker")
logging.getLogger("ib_insync.client").setLevel(logging.CRITICAL)

WATCHLIST_REFRESH_S = 2.0
YAHOO_POLL_S = 600.0
YAHOO_SYMBOL_SLEEP_S = 3.0
YAHOO_VALUATION_CHECK_S = 300.0
YAHOO_VALUATION_SYMBOL_SLEEP_S = 60.0
YAHOO_VALUATION_MAX_AGE_S = 86400.0
YAHOO_VALUATION_FAST_RETRY_S = 10.0   # Retry interval when market_cap still NULL for some symbols
FINNHUB_WATCHLIST_POLL_S = 600.0
FINNHUB_WATCHLIST_SYMBOL_SLEEP_S = 1.5
FINNHUB_UNIVERSE_SYMBOL_SLEEP_S = 4.0
FINNHUB_HTTP_TIMEOUT_S = 10.0
TICK_THROTTLE_S = 3.0
ACTIVE_REFRESH_S = 3.0
ACTIVE_TTL_S = 120
STATUS_SUMMARY_S = 30.0
UNIVERSE_REFRESH_S = 300.0
SNAPSHOT_LOOP_SLEEP_S = 5.0
SNAPSHOT_STALE_S = 300.0
UNIVERSE_BATCH_SIZE = 8
YAHOO_HISTORICAL_REQUEST_SLEEP_S = 5.0
YAHOO_HISTORICAL_SYMBOL_SLEEP_S = 10.0
TWS_HISTORICAL_REQUEST_SLEEP_S = 1.0
URGENT_HISTORICAL_BATCH_SIZE = 4
SUBSCRIPTION_PACE_S = 2.0
REALTIME_PACE_S = 3.0
REALTIME_BACKOFF_BASE_S = 10.0
REALTIME_BACKOFF_MAX_S = 30.0
MAX_REALTIME_BAR_SUBSCRIPTIONS = 25
SHARD_THRESHOLD = 20
MAX_SHARDS = 3
UNIVERSE_SNAPSHOT_SLEEP_S = 10.0
UNIVERSE_SNAPSHOT_CYCLE_PAUSE_S = 60.0
UNIVERSE_YAHOO_INTERVAL_S = 43200.0  # Re-fetch Yahoo prices/market-caps for full universe every 12h
UNIVERSE_YAHOO_FAST_RETRY_S = 10.0   # Retry interval when market_cap still NULL for some symbols

STATE_QUEUED = "queued"
STATE_SUBSCRIBED = "subscribed"
STATE_WAITING = "waiting_for_valid_quote"
STATE_LIVE = "live_quote_active"
STATE_ERROR = "subscription_error"
CLIENT_ID_SCAN_LIMIT = 10000
WORKER_ROLE = "watchlist-worker"
TICKERS_PATH = resource_path("data", "tickers.json")
SETTINGS_PATH = data_dir() / "tws-settings.json"


def default_client_id() -> int:
    return random.randint(1000, 9999)


def _safe(v) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _price(v) -> float | None:
    f = _safe(v)
    return f if f is not None and f > 0 else None


def ticker_to_quote(symbol: str, t: Ticker) -> dict | None:
    last = _price(t.last)
    bid = _price(t.bid)
    ask = _price(t.ask)
    close = _price(t.close)
    mid = round((bid + ask) / 2, 4) if bid is not None and ask is not None else None
    display = last if last is not None else (mid if mid is not None else close)
    if display is None:
        return None

    open_ = _price(t.open)
    high = _price(t.high)
    low = _price(t.low)
    volume = _safe(t.volume) or 0
    change = round(display - close, 4) if close is not None else 0.0
    change_pct = round((change / close) * 100, 4) if close is not None else 0.0
    spread = round(ask - bid, 4) if bid is not None and ask is not None else 0.0

    return {
        "symbol": symbol,
        "last": display,
        "bid": bid,
        "ask": ask,
        "mid": mid if mid is not None else display,
        "open": open_,
        "high": high,
        "low": low,
        "prev_close": close,
        "change": change,
        "change_pct": change_pct,
        "volume": volume,
        "spread": spread,
        "source": "tws",
    }


def yahoo_to_quote(symbol: str, data: dict) -> dict:
    last = float(data.get("regularMarketPrice", 0) or 0)
    prev_close = float(data.get("regularMarketPreviousClose", 0) or 0)
    open_ = float(data.get("regularMarketOpen", 0) or 0)
    high = float(data.get("regularMarketDayHigh", 0) or 0)
    low = float(data.get("regularMarketDayLow", 0) or 0)
    volume = float(data.get("regularMarketVolume", 0) or 0)
    change = round(last - prev_close, 4) if prev_close else 0.0
    change_pct = round((change / prev_close) * 100, 4) if prev_close else 0.0

    # Yahoo doesn't provide reliable bid/ask — leave as None so the frontend
    # shows a "TWS required" indicator instead of misleading zeros.
    return {
        "symbol": symbol,
        "last": last,
        "bid": None,
        "ask": None,
        "mid": None,
        "open": open_,
        "high": high,
        "low": low,
        "prev_close": prev_close,
        "change": change,
        "change_pct": change_pct,
        "volume": volume,
        "spread": None,
        "source": "yahoo",
    }


def _load_finnhub_api_key(settings_path: Path = SETTINGS_PATH) -> str:
    try:
        with open(settings_path, encoding="utf-8") as f:
            raw = json.load(f)
    except FileNotFoundError:
        return ""
    except Exception as exc:
        logger.warning("Failed to read Finnhub settings from %s: %s", settings_path, exc)
        return ""

    api_key = raw.get("finnhubApiKey") if isinstance(raw, dict) else ""
    return str(api_key or "").strip()


def _finnhub_get_json(path: str, params: dict[str, str]) -> dict:
    query = urlencode(params)
    url = f"https://finnhub.io/api/v1/{path}?{query}"
    with urlopen(url, timeout=FINNHUB_HTTP_TIMEOUT_S) as response:
        payload = response.read().decode("utf-8")
    data = json.loads(payload)
    if not isinstance(data, dict):
        raise RuntimeError(f"Unexpected Finnhub payload type for {path}")
    if data.get("error"):
        raise RuntimeError(str(data["error"]))
    return data


def _finnhub_quote_to_quote(symbol: str, data: dict) -> dict | None:
    last = _price(data.get("c"))
    if last is None:
        return None

    prev_close = _price(data.get("pc"))
    open_ = _price(data.get("o"))
    high = _price(data.get("h"))
    low = _price(data.get("l"))
    change = _safe(data.get("d"))
    change_pct = _safe(data.get("dp"))
    if change is None and prev_close is not None:
        change = round(last - prev_close, 4)
    if change_pct is None and prev_close is not None and prev_close > 0 and change is not None:
        change_pct = round((change / prev_close) * 100, 4)

    return {
        "symbol": symbol,
        "last": last,
        "bid": None,
        "ask": None,
        "mid": None,
        "open": open_,
        "high": high,
        "low": low,
        "prev_close": prev_close,
        "change": change if change is not None else 0.0,
        "change_pct": change_pct if change_pct is not None else 0.0,
        "volume": 0.0,
        "spread": None,
        "source": "finnhub",
    }


def fetch_quotes_from_finnhub(
    symbols: List[str],
    *,
    api_key: str,
    sleep_s: float,
    label: str,
) -> List[dict]:
    quotes: List[dict] = []
    total = len(symbols)
    for idx, sym in enumerate(symbols, start=1):
        msg = f"[{label}] Fetching {sym} ({idx}/{total})"
        print(msg, flush=True)
        logger.info(msg)
        try:
            data = _finnhub_get_json("quote", {"symbol": sym, "token": api_key})
            quote = _finnhub_quote_to_quote(sym, data)
            if quote is None:
                raise RuntimeError("Finnhub quote payload missing current price")
            quotes.append(quote)
            if label == "Finnhub watchlist":
                quote_msg = (
                    f"[Finnhub watchlist] Quote {sym}: "
                    f"last={quote.get('last')} open={quote.get('open')} "
                    f"high={quote.get('high')} low={quote.get('low')} "
                    f"prev_close={quote.get('prev_close')} change_pct={quote.get('change_pct')}"
                )
                print(quote_msg, flush=True)
                logger.info(quote_msg)
        except HTTPError as exc:
            body = ""
            try:
                body = exc.read().decode("utf-8", errors="ignore").strip()
            except Exception:
                pass
            detail = f"HTTP {exc.code}"
            if body:
                detail = f"{detail}: {body}"
            raise RuntimeError(detail) from exc
        except URLError as exc:
            raise RuntimeError(f"network error: {exc.reason}") from exc
        except json.JSONDecodeError as exc:
            raise RuntimeError("invalid JSON from Finnhub") from exc

        if idx < total:
            time.sleep(sleep_s)
    return quotes


def fetch_watchlist_quotes_from_yahoo(symbols: List[str]) -> List[dict]:
    """Fetch Yahoo watchlist quotes one symbol at a time with a fixed pause."""
    quotes: List[dict] = []
    total = len(symbols)
    for idx, sym in enumerate(symbols, start=1):
        msg = f"[Yahoo watchlist] Fetching {sym} ({idx}/{total})"
        print(msg, flush=True)
        logger.info(msg)
        try:
            ticker = YahooTicker(sym, asynchronous=False)
            price_data = ticker.price
            data = price_data.get(sym) if isinstance(price_data, dict) else None
            if isinstance(data, dict):
                quotes.append(yahoo_to_quote(sym, data))
            else:
                logger.warning("Yahoo returned no price payload for %s", sym)
        except Exception as exc:
            logger.warning("Yahoo fetch failed for %s: %s", sym, exc)
        if idx < total:
            time.sleep(YAHOO_SYMBOL_SLEEP_S)
    return quotes


def fetch_universe_quotes_from_yahoo(symbols: List[str]) -> List[dict]:
    quotes: List[dict] = []
    total = len(symbols)
    for idx, sym in enumerate(symbols, start=1):
        msg = f"[UniverseYahoo] Fetching {sym} ({idx}/{total})"
        print(msg, flush=True)
        logger.info(msg)
        try:
            ticker = YahooTicker(sym, asynchronous=False)
            price_data = ticker.price
            data = price_data.get(sym) if isinstance(price_data, dict) else None
            if isinstance(data, dict):
                quote = yahoo_to_quote(sym, data)
                if quote.get("last"):
                    quotes.append(quote)
                _, _, market_cap = _extract_yahoo_valuation({}, data)
                if market_cap:
                    upsert_quote_valuation(sym, None, None, market_cap)
            else:
                logger.warning("Yahoo returned no universe payload for %s", sym)
        except Exception as exc:
            logger.warning("Yahoo universe fetch failed for %s: %s", sym, exc)
        if idx < total:
            time.sleep(YAHOO_SYMBOL_SLEEP_S)
    return quotes


def fetch_watchlist_quotes_with_fallback(symbols: List[str]) -> tuple[str, List[dict]]:
    api_key = _load_finnhub_api_key()
    if api_key:
        try:
            quotes = fetch_quotes_from_finnhub(
                symbols,
                api_key=api_key,
                sleep_s=FINNHUB_WATCHLIST_SYMBOL_SLEEP_S,
                label="Finnhub watchlist",
            )
            return "finnhub", quotes
        except Exception as exc:
            logger.warning("Finnhub watchlist cycle failed, falling back to Yahoo: %s", exc)
    return "yahoo", fetch_watchlist_quotes_from_yahoo(symbols)


def fetch_universe_quotes_with_fallback(symbols: List[str]) -> tuple[str, List[dict]]:
    api_key = _load_finnhub_api_key()
    if api_key:
        try:
            quotes = fetch_quotes_from_finnhub(
                symbols,
                api_key=api_key,
                sleep_s=FINNHUB_UNIVERSE_SYMBOL_SLEEP_S,
                label="Finnhub universe",
            )
            return "finnhub", quotes
        except Exception as exc:
            logger.warning("Finnhub universe cycle failed, falling back to Yahoo: %s", exc)
    return "yahoo", fetch_universe_quotes_from_yahoo(symbols)


def refresh_watchlist_valuations_from_yahoo(symbols: List[str]) -> None:
    """Fetch Yahoo valuation fields one symbol at a time with a long pause."""
    total = len(symbols)
    for idx, sym in enumerate(symbols, start=1):
        msg = f"[Valuation loop] symbol {idx}/{total}: {sym}"
        print(msg, flush=True)
        logger.info(msg)
        try:
            ticker = YahooTicker(sym, asynchronous=False)
            summary_data = ticker.summary_detail
            price_data = ticker.price
            data = summary_data.get(sym) if isinstance(summary_data, dict) else None
            pd = price_data.get(sym) if isinstance(price_data, dict) else None
            trailing_pe, forward_pe, market_cap = _extract_yahoo_valuation(
                data if isinstance(data, dict) else {},
                pd if isinstance(pd, dict) else None,
            )
            upsert_quote_valuation(sym, trailing_pe, forward_pe, market_cap)
            cap_str = f"${market_cap/1e9:.2f}B" if market_cap else "N/A"
            logger.info(
                f"[Valuation] {sym}: P/E={trailing_pe}, Fwd P/E={forward_pe}, MktCap={cap_str}"
            )
        except Exception as exc:
            logger.warning("Yahoo valuation fetch failed for %s: %s", sym, exc)
        if idx < total:
            time.sleep(YAHOO_VALUATION_SYMBOL_SLEEP_S)


def _extract_yahoo_valuation(
    data: dict, price_data: dict | None = None,
) -> tuple[float | None, float | None, float | None]:
    if not isinstance(data, dict):
        return None, None, None
    market_cap = _safe(data.get("marketCap"))
    if market_cap is None and isinstance(price_data, dict):
        market_cap = _safe(price_data.get("marketCap"))
    return (
        _safe(data.get("trailingPE")),
        _safe(data.get("forwardPE")),
        market_cap,
    )


def load_enabled_symbols() -> list[str]:
    try:
        with open(TICKERS_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except Exception as exc:
        logger.warning(f"Failed to load tickers.json: {exc}")
        return []

    seen: set[str] = set()
    symbols: list[str] = []
    for company in data.get("companies", []):
        if not company.get("enabled", True):
            continue
        symbol = str(company.get("symbol") or "").strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        symbols.append(symbol)
    return symbols


def _upsert_market_snapshot(snapshot: dict) -> None:
    now_ms = int(time.time() * 1000)
    with sync_db_session() as conn:
        conn.execute(
            """
            INSERT INTO market_snapshots (
                symbol, last, open, high, low, prev_close, change, change_pct, volume,
                bid, ask, mid, spread, source, status,
                quote_updated_at, intraday_updated_at, daily_updated_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(symbol) DO UPDATE SET
                last = COALESCE(excluded.last, market_snapshots.last),
                open = COALESCE(excluded.open, market_snapshots.open),
                high = COALESCE(excluded.high, market_snapshots.high),
                low = COALESCE(excluded.low, market_snapshots.low),
                prev_close = COALESCE(excluded.prev_close, market_snapshots.prev_close),
                change = COALESCE(excluded.change, market_snapshots.change),
                change_pct = COALESCE(excluded.change_pct, market_snapshots.change_pct),
                volume = COALESCE(excluded.volume, market_snapshots.volume),
                bid = COALESCE(excluded.bid, market_snapshots.bid),
                ask = COALESCE(excluded.ask, market_snapshots.ask),
                mid = COALESCE(excluded.mid, market_snapshots.mid),
                spread = COALESCE(excluded.spread, market_snapshots.spread),
                source = COALESCE(excluded.source, market_snapshots.source),
                status = COALESCE(excluded.status, market_snapshots.status),
                quote_updated_at = COALESCE(excluded.quote_updated_at, market_snapshots.quote_updated_at),
                intraday_updated_at = COALESCE(excluded.intraday_updated_at, market_snapshots.intraday_updated_at),
                daily_updated_at = COALESCE(excluded.daily_updated_at, market_snapshots.daily_updated_at),
                updated_at = excluded.updated_at
            """,
            (
                snapshot["symbol"],
                snapshot.get("last"),
                snapshot.get("open"),
                snapshot.get("high"),
                snapshot.get("low"),
                snapshot.get("prev_close"),
                snapshot.get("change"),
                snapshot.get("change_pct"),
                snapshot.get("volume"),
                snapshot.get("bid"),
                snapshot.get("ask"),
                snapshot.get("mid"),
                snapshot.get("spread"),
                snapshot.get("source"),
                snapshot.get("status"),
                snapshot.get("quote_updated_at"),
                snapshot.get("intraday_updated_at"),
                snapshot.get("daily_updated_at"),
                now_ms,
            ),
        )


def _snapshot_from_quote(q: dict) -> dict:
    now_ms = int(time.time() * 1000)
    return {
        "symbol": q["symbol"],
        "last": q.get("last"),
        "open": q.get("open"),
        "high": q.get("high"),
        "low": q.get("low"),
        "prev_close": q.get("prev_close"),
        "change": q.get("change"),
        "change_pct": q.get("change_pct"),
        "volume": q.get("volume"),
        "bid": q.get("bid"),
        "ask": q.get("ask"),
        "mid": q.get("mid"),
        "spread": q.get("spread"),
        "source": q.get("source", "unknown"),
        "status": "ok" if q.get("last") else "pending",
        "quote_updated_at": now_ms,
        "intraday_updated_at": None,
        "daily_updated_at": None,
    }


def refresh_snapshot_from_db(symbol: str) -> None:
    now_ms = int(time.time() * 1000)
    with sync_db_session() as conn:
        quote_row = conn.execute(
            """
            SELECT last, bid, ask, mid, open, high, low, prev_close, change, change_pct,
                   volume, spread, source, updated_at
            FROM watchlist_quotes
            WHERE symbol = ?
            """,
            (symbol,),
        ).fetchone()
        intraday_row = conn.execute(
            """
            SELECT ts, open, high, low, close, volume
            FROM ohlcv_1m
            WHERE symbol = ?
            ORDER BY ts DESC
            LIMIT 1
            """,
            (symbol,),
        ).fetchone()
        daily_row = conn.execute(
            """
            SELECT ts, close
            FROM ohlcv_1d
            WHERE symbol = ?
            ORDER BY ts DESC
            LIMIT 1
            """,
            (symbol,),
        ).fetchone()
        existing_row = conn.execute(
            """
            SELECT bid, ask, mid, spread, source, status, quote_updated_at,
                   intraday_updated_at, daily_updated_at
            FROM market_snapshots
            WHERE symbol = ?
            """,
            (symbol,),
        ).fetchone()

    prev_close = None
    daily_updated_at = None
    if daily_row:
        daily_updated_at = int(daily_row[0] or 0)
        prev_close = _price(daily_row[1])

    intraday_updated_at = None
    last = None
    open_ = None
    high = None
    low = None
    volume = None
    if intraday_row:
        intraday_updated_at = int(intraday_row[0] or 0)
        open_ = _price(intraday_row[1])
        high = _price(intraday_row[2])
        low = _price(intraday_row[3])
        last = _price(intraday_row[4])
        volume = _safe(intraday_row[5])

    bid = ask = mid = spread = None
    source = "bars"
    quote_updated_at = None
    if quote_row:
        bid = _price(quote_row[1])
        ask = _price(quote_row[2])
        mid = _price(quote_row[3])
        open_ = _price(quote_row[4]) or open_
        high = _price(quote_row[5]) or high
        low = _price(quote_row[6]) or low
        prev_close = _price(quote_row[7]) or prev_close
        quote_last = _price(quote_row[0])
        if quote_last is not None:
            last = quote_last
        volume = _safe(quote_row[10]) or volume
        spread = _price(quote_row[11])
        source = str(quote_row[12] or "quote")
        quote_updated_at = int(quote_row[13] or 0) or None
        change = _safe(quote_row[8])
        change_pct = _safe(quote_row[9])
    else:
        change = None
        change_pct = None

    if (change is None or change_pct is None) and last is not None and prev_close is not None and prev_close > 0:
        change = round(last - prev_close, 4)
        change_pct = round((change / prev_close) * 100, 4)

    if existing_row:
        if bid is None:
            bid = _price(existing_row[0])
        if ask is None:
            ask = _price(existing_row[1])
        if mid is None:
            mid = _price(existing_row[2])
        if spread is None:
            spread = _price(existing_row[3])
        if source == "bars":
            source = str(existing_row[4] or "bars")
        if quote_updated_at is None:
            quote_updated_at = int(existing_row[6] or 0) or None
        if intraday_updated_at is None:
            intraday_updated_at = int(existing_row[7] or 0) or None
        if daily_updated_at is None:
            daily_updated_at = int(existing_row[8] or 0) or None

    status = "ok"
    if last is None:
        status = "pending"
    elif prev_close is None:
        status = "stale"
    elif intraday_updated_at and (now_ms - intraday_updated_at) > int(SNAPSHOT_STALE_S * 1000):
        status = "stale"

    _upsert_market_snapshot(
        {
            "symbol": symbol,
            "last": last,
            "open": open_,
            "high": high,
            "low": low,
            "prev_close": prev_close,
            "change": change,
            "change_pct": change_pct,
            "volume": volume,
            "bid": bid,
            "ask": ask,
            "mid": mid,
            "spread": spread,
            "source": source,
            "status": status,
            "quote_updated_at": quote_updated_at,
            "intraday_updated_at": intraday_updated_at,
            "daily_updated_at": daily_updated_at,
        }
    )


def upsert_quote(q: dict) -> None:
    now_ms = int(time.time() * 1000)
    with sync_db_session() as conn:
        # TWS is authoritative — write exactly what it sends (including None).
        # Yahoo should never overwrite valid TWS bid/ask with None/0.
        if q.get("source") == "tws":
            conn.execute(
                """
                INSERT INTO watchlist_quotes (
                    symbol, last, bid, ask, mid, open, high, low, prev_close,
                    change, change_pct, volume, spread, source, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol) DO UPDATE SET
                    last = excluded.last,
                    bid = excluded.bid,
                    ask = excluded.ask,
                    mid = excluded.mid,
                    open = excluded.open,
                    high = excluded.high,
                    low = excluded.low,
                    prev_close = excluded.prev_close,
                    change = excluded.change,
                    change_pct = excluded.change_pct,
                    volume = excluded.volume,
                    spread = excluded.spread,
                    source = excluded.source,
                    updated_at = excluded.updated_at
                """,
                (
                    q["symbol"], q["last"], q["bid"], q["ask"], q["mid"],
                    q["open"], q["high"], q["low"], q["prev_close"],
                    q["change"], q["change_pct"], q["volume"], q["spread"],
                    q["source"], now_ms,
                ),
            )
        else:
            # Yahoo: never clobber bid/ask/mid/spread that TWS already set
            conn.execute(
                """
                INSERT INTO watchlist_quotes (
                    symbol, last, bid, ask, mid, open, high, low, prev_close,
                    change, change_pct, volume, spread, source, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol) DO UPDATE SET
                    last = excluded.last,
                    bid = CASE WHEN watchlist_quotes.source = 'tws'
                                   AND watchlist_quotes.bid IS NOT NULL
                                   AND watchlist_quotes.bid > 0
                               THEN watchlist_quotes.bid
                               ELSE excluded.bid END,
                    ask = CASE WHEN watchlist_quotes.source = 'tws'
                                   AND watchlist_quotes.ask IS NOT NULL
                                   AND watchlist_quotes.ask > 0
                               THEN watchlist_quotes.ask
                               ELSE excluded.ask END,
                    mid = CASE WHEN watchlist_quotes.source = 'tws'
                                   AND watchlist_quotes.mid IS NOT NULL
                                   AND watchlist_quotes.mid > 0
                               THEN watchlist_quotes.mid
                               ELSE excluded.mid END,
                    open = excluded.open,
                    high = excluded.high,
                    low = excluded.low,
                    prev_close = excluded.prev_close,
                    change = excluded.change,
                    change_pct = excluded.change_pct,
                    volume = excluded.volume,
                    spread = CASE WHEN watchlist_quotes.source = 'tws'
                                      AND watchlist_quotes.spread IS NOT NULL
                                      AND watchlist_quotes.spread > 0
                                  THEN watchlist_quotes.spread
                                  ELSE excluded.spread END,
                    source = excluded.source,
                    updated_at = excluded.updated_at
                """,
                (
                    q["symbol"], q["last"], q["bid"], q["ask"], q["mid"],
                    q["open"], q["high"], q["low"], q["prev_close"],
                    q["change"], q["change_pct"], q["volume"], q["spread"],
                    q["source"], now_ms,
                ),
            )
    _upsert_market_snapshot(_snapshot_from_quote(q))


def upsert_quote_valuation(symbol: str, trailing_pe: float | None, forward_pe: float | None, market_cap: float | None = None) -> None:
    now_ms = int(time.time() * 1000)
    with sync_db_session() as conn:
        conn.execute(
            """
            INSERT INTO watchlist_quotes (
                symbol, trailing_pe, forward_pe, market_cap, valuation_updated_at, source, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(symbol) DO UPDATE SET
                trailing_pe = COALESCE(excluded.trailing_pe, watchlist_quotes.trailing_pe),
                forward_pe = COALESCE(excluded.forward_pe, watchlist_quotes.forward_pe),
                market_cap = COALESCE(excluded.market_cap, watchlist_quotes.market_cap),
                valuation_updated_at = excluded.valuation_updated_at
            """,
            (symbol, trailing_pe, forward_pe, market_cap, now_ms, "yahoo", now_ms),
        )


def get_stale_valuation_symbols(symbols: List[str], max_age_s: float) -> List[str]:
    if not symbols:
        return []
    cutoff_ms = int(time.time() * 1000 - (max_age_s * 1000))
    placeholders = ", ".join("?" * len(symbols))
    with sync_db_session() as conn:
        rows = conn.execute(
            f"""
            SELECT symbol
            FROM watchlist_quotes
            WHERE symbol IN ({placeholders})
              AND (
                  valuation_updated_at IS NULL
                  OR valuation_updated_at < ?
                  OR market_cap IS NULL
              )
            """,
            (*symbols, cutoff_ms),
        ).fetchall()
    return [row[0] for row in rows]


def count_null_market_cap_symbols(symbols: List[str]) -> int:
    """Return how many of the given symbols have NULL market_cap in watchlist_quotes."""
    if not symbols:
        return 0
    placeholders = ", ".join("?" * len(symbols))
    with sync_db_session() as conn:
        row = conn.execute(
            f"""
            SELECT COUNT(*)
            FROM watchlist_quotes
            WHERE symbol IN ({placeholders})
              AND market_cap IS NOT NULL
            """,
            (*symbols,),
        ).fetchone()
    filled = row[0] if row else 0
    return len(symbols) - filled


def read_latest_bid_ask(symbol: str) -> tuple[float | None, float | None]:
    with sync_db_session() as conn:
        bid_row = conn.execute(
            "SELECT close FROM ohlcv_1m_bid WHERE symbol = ? ORDER BY ts DESC LIMIT 1",
            (symbol,),
        ).fetchone()
        ask_row = conn.execute(
            "SELECT close FROM ohlcv_1m_ask WHERE symbol = ? ORDER BY ts DESC LIMIT 1",
            (symbol,),
        ).fetchone()
    bid = _price(bid_row[0]) if bid_row else None
    ask = _price(ask_row[0]) if ask_row else None
    return bid, ask


def normalize_watchlist_symbols(rows: List[str]) -> List[str]:
    symbols: list[str] = []
    seen: set[str] = set()
    for raw in rows:
        sym = (raw or "").strip().upper()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        symbols.append(sym)
    return symbols


def write_status(symbol: str, state: str, detail: str | None = None) -> None:
    now_ms = int(time.time() * 1000)
    with sync_db_session() as conn:
        conn.execute(
            """
            INSERT INTO watchlist_status (symbol, state, detail, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(symbol) DO UPDATE SET
                state = excluded.state,
                detail = excluded.detail,
                updated_at = excluded.updated_at
            """,
            (symbol, state, detail, now_ms),
        )


def delete_status(symbol: str) -> None:
    with sync_db_session() as conn:
        conn.execute("DELETE FROM watchlist_status WHERE symbol = ?", (symbol,))


def clear_statuses_not_in(symbols: list[str]) -> None:
    with sync_db_session() as conn:
        if symbols:
            placeholders = ", ".join("?" * len(symbols))
            conn.execute(
                f"DELETE FROM watchlist_status WHERE symbol NOT IN ({placeholders})",
                symbols,
            )
        else:
            conn.execute("DELETE FROM watchlist_status")


def read_watchlist() -> List[str]:
    with sync_db_session() as conn:
        rows = conn.execute(
            "SELECT symbol FROM watchlist_symbols ORDER BY position"
        ).fetchall()
    return normalize_watchlist_symbols([r[0] for r in rows])


def read_active_symbols() -> List[str]:
    cutoff_ms = int(time.time() * 1000) - (ACTIVE_TTL_S * 1000)
    with sync_db_session() as conn:
        rows = conn.execute(
            """
            SELECT symbol
            FROM active_symbols
            WHERE last_requested >= ?
            ORDER BY last_requested DESC
            """,
            (cutoff_ms,),
        ).fetchall()
    return [r[0] for r in rows]


async def connect_ib(ib: IB, host: str, ports: List[int], client_id: int) -> bool:
    manager = IbkrClientIdManager(client_id, CLIENT_ID_SCAN_LIMIT)
    ok, _ = await connect_ib_with_manager(ib, host, ports, client_id, manager)
    return ok


async def connect_ib_with_manager(
    ib: IB,
    host: str,
    ports: List[int],
    client_id: int,
    manager: IbkrClientIdManager,
) -> tuple[bool, int]:
    try:
        candidate = manager.acquire(WORKER_ROLE, preferred_id=client_id)
    except RuntimeError:
        logger.error("No available TWS clientId in manager range")
        return False, client_id

    while True:
        for port in ports:
            try:
                await connect_with_client_id_fallback(
                    ib, host, port, candidate, readonly=True
                )
                if ib.isConnected():
                    try:
                        ib.reqMarketDataType(1)
                    except Exception as exc:
                        logger.debug(f"Failed to request live market data type: {exc}")
                    logger.info(f"Connected to TWS {host}:{port} (clientId={candidate})")
                    return True, candidate
            except Exception as exc:
                if is_client_id_in_use_error(exc):
                    logger.warning(
                        f"TWS rejected clientId {candidate} (in use). Searching for next available ID."
                    )
                    manager.mark_rejected(candidate)
                    try:
                        candidate = manager.acquire(WORKER_ROLE, preferred_id=candidate + 1)
                    except RuntimeError:
                        logger.error("Exhausted TWS clientId range while attempting to connect")
                        return False, client_id
                    break
                logger.debug(f"TWS connect failed {host}:{port} (clientId={candidate}): {exc}")
        else:
            # Exhausted ports without a clientId-in-use signal; wait for reconnect loop.
            return False, candidate


async def worker_loop(host: str, ports: List[int], client_id: int) -> None:
    # ── Sharded IB connections ──
    # shard 0 is the "primary" — always created. Extra shards added when watchlist > SHARD_THRESHOLD.
    ib_shards: List[IB] = [IB()]
    shard_client_ids: List[int] = [client_id]
    client_id_mgr = IbkrClientIdManager(client_id, CLIENT_ID_SCAN_LIMIT)
    last_write: Dict[str, float] = {}
    tickers: Dict[str, Ticker] = {}
    quote_contracts: Dict[str, Stock] = {}
    symbol_to_shard: Dict[str, int] = {}  # which shard owns each symbol's quote subscription
    watchlist: List[str] = []
    active_symbols: List[str] = []
    universe_symbols: List[str] = load_enabled_symbols()
    rt_bars: Dict[str, object] = {}
    current_1m: Dict[str, dict] = {}
    symbol_states: Dict[str, str] = {}
    subscription_queue: deque[tuple[str, str, str]] = deque()
    queued_quote_symbols: set[str] = set()
    queued_realtime_symbols: set[str] = set()

    def _primary_ib() -> IB:
        return ib_shards[0]

    def _num_shards() -> int:
        return len(ib_shards)

    def _quote_symbols() -> List[str]:
        return list(dict.fromkeys(watchlist + active_symbols))

    def _quote_symbol_set() -> set[str]:
        return set(_quote_symbols())

    def _shard_for_symbol(sym: str) -> int:
        """Determine which shard a symbol should be assigned to (round-robin by watchlist index)."""
        if sym in symbol_to_shard:
            return symbol_to_shard[sym]
        try:
            idx = watchlist.index(sym)
        except ValueError:
            try:
                idx = _quote_symbols().index(sym)
            except ValueError:
                idx = hash(sym)
        shard_idx = idx % _num_shards()
        return shard_idx

    def _any_shard_connected() -> bool:
        return any(ib.isConnected() for ib in ib_shards)

    def set_symbol_state(symbol: str, state: str, detail: str | None = None) -> None:
        if symbol_states.get(symbol) == state and detail is None:
            return
        symbol_states[symbol] = state
        asyncio.create_task(asyncio.to_thread(write_status, symbol, state, detail))

    def drop_symbol_state(symbol: str) -> None:
        symbol_states.pop(symbol, None)
        asyncio.create_task(asyncio.to_thread(delete_status, symbol))

    def queue_subscription(kind: str, sym: str, reason: str) -> None:
        if kind == "quote":
            if sym in tickers or sym in queued_quote_symbols:
                return
            queued_quote_symbols.add(sym)
        elif kind == "realtime":
            if sym in rt_bars or sym in queued_realtime_symbols:
                return
            queued_realtime_symbols.add(sym)
        else:
            return
        subscription_queue.append((kind, sym, reason))
        logger.info("Queued %s subscription for %s (%s)", kind, sym, reason)

    def cancel_quote_subscription(sym: str) -> None:
        t = tickers.pop(sym, None)
        quote_contracts.pop(sym, None)
        queued_quote_symbols.discard(sym)
        shard_idx = symbol_to_shard.pop(sym, 0)
        if t is not None and shard_idx < len(ib_shards) and ib_shards[shard_idx].isConnected():
            try:
                ib_shards[shard_idx].cancelMktData(t.contract)
            except Exception:
                pass

    def cancel_realtime_subscription(sym: str) -> None:
        existing = rt_bars.pop(sym, None)
        queued_realtime_symbols.discard(sym)
        current_1m.pop(sym, None)
        if existing and _primary_ib().isConnected():
            try:
                _primary_ib().cancelRealTimeBars(existing)
            except Exception:
                pass

    def subscribe_realtime(sym: str) -> None:
        cancel_realtime_subscription(sym)
        ib = _primary_ib()
        contract = Stock(sym, "SMART", "USD")
        bars = ib.reqRealTimeBars(
            contract, barSize=5, whatToShow="TRADES", useRTH=False
        )
        rt_bars[sym] = bars

        def on_rt_bar(bars_list, hasNewBar, s=sym):
            if not hasNewBar:
                return
            b = bars_list[-1]
            ts_ms = int(b.time.timestamp() * 1000)
            bar_5s = {
                "time": ts_ms,
                "open": float(b.open_),
                "high": float(b.high),
                "low": float(b.low),
                "close": float(b.close),
                "volume": float(b.volume),
            }
            asyncio.create_task(asyncio.to_thread(save_realtime_bar, s, bar_5s))

            minute_start = ts_ms - (ts_ms % 60_000)
            agg = current_1m.get(s)
            if not agg or agg.get("time") != minute_start:
                agg = {
                    "time": minute_start,
                    "open": float(b.open_),
                    "high": float(b.high),
                    "low": float(b.low),
                    "close": float(b.close),
                    "volume": float(b.volume),
                }
                current_1m[s] = agg
            else:
                agg["high"] = max(agg["high"], float(b.high))
                agg["low"] = min(agg["low"], float(b.low))
                agg["close"] = float(b.close)
                agg["volume"] = float(agg["volume"]) + float(b.volume)
            bar_1m = agg
            asyncio.create_task(asyncio.to_thread(save_realtime_bar_1m, s, bar_1m))

        bars.updateEvent += on_rt_bar

    def subscribe_quote(sym: str) -> None:
        shard_idx = _shard_for_symbol(sym)
        if shard_idx >= len(ib_shards) or not ib_shards[shard_idx].isConnected():
            # Fall back to any connected shard
            shard_idx = 0
            for i, ib in enumerate(ib_shards):
                if ib.isConnected():
                    shard_idx = i
                    break
        ib = ib_shards[shard_idx]
        contract = Stock(sym, "SMART", "USD")
        ticker = ib.reqMktData(contract, genericTickList="", snapshot=False)
        ticker.updateEvent += lambda updated_ticker, s=sym: asyncio.create_task(on_tick(s, updated_ticker))
        tickers[sym] = ticker
        quote_contracts[sym] = contract
        symbol_to_shard[sym] = shard_idx
        set_symbol_state(sym, STATE_SUBSCRIBED, "subscription active; waiting for first valid quote")
        set_symbol_state(sym, STATE_WAITING, "subscription active; waiting for first valid quote")
        logger.info("Watchlist subscribed %s (shard %d)", sym, shard_idx)

    async def on_tick(symbol: str, ticker: Ticker):
        now = time.time()
        last = last_write.get(symbol, 0)
        if now - last < TICK_THROTTLE_S:
            return
        q = ticker_to_quote(symbol, ticker)
        if q is None:
            if symbol in tickers:
                set_symbol_state(symbol, STATE_WAITING, "ticker update received without usable price")
            return
        if q["bid"] is None or q["ask"] is None:
            hist_bid, hist_ask = await asyncio.to_thread(read_latest_bid_ask, symbol)
            if q["bid"] is None and hist_bid is not None:
                q["bid"] = hist_bid
            if q["ask"] is None and hist_ask is not None:
                q["ask"] = hist_ask
            if q["bid"] is not None and q["ask"] is not None:
                q["mid"] = round((q["bid"] + q["ask"]) / 2, 4)
                q["spread"] = round(q["ask"] - q["bid"], 4)
        last_write[symbol] = now
        set_symbol_state(symbol, STATE_LIVE, f"last={q['last']} mid={q['mid']}")
        logger.debug(
            "Quote %s: last=%s bid=%s ask=%s mid=%s prev_close=%s volume=%s",
            symbol,
            q["last"],
            q["bid"],
            q["ask"],
            q["mid"],
            q["prev_close"],
            q["volume"],
        )
        asyncio.create_task(asyncio.to_thread(upsert_quote, q))

    async def subscription_loop():
        backoff_streak = 0
        while True:
            if not subscription_queue:
                await asyncio.sleep(0.25)
                continue
            if not _any_shard_connected():
                await asyncio.sleep(1.0)
                continue

            kind, sym, reason = subscription_queue.popleft()
            pace = SUBSCRIPTION_PACE_S

            if kind == "quote":
                queued_quote_symbols.discard(sym)
                if sym not in _quote_symbol_set():
                    continue
                if sym in tickers:
                    logger.debug("Skipping quote subscribe for %s; already subscribed", sym)
                    continue
                try:
                    subscribe_quote(sym)
                    backoff_streak = 0
                except Exception as exc:
                    exc_str = str(exc)
                    if "456" in exc_str or "Max number" in exc_str:
                        backoff_streak += 1
                        delay = min(REALTIME_BACKOFF_BASE_S * backoff_streak, REALTIME_BACKOFF_MAX_S)
                        logger.warning("Rate limit hit for quote %s, backing off %.0fs (streak %d)", sym, delay, backoff_streak)
                        queue_subscription("quote", sym, "rate_limit_retry")
                        await asyncio.sleep(delay)
                        continue
                    set_symbol_state(sym, STATE_ERROR, exc_str)
                    logger.warning(f"Failed to subscribe quote for {sym}: {exc}")
            elif kind == "realtime":
                pace = REALTIME_PACE_S
                queued_realtime_symbols.discard(sym)
                if sym not in active_symbols:
                    continue
                if sym in rt_bars:
                    logger.debug("Skipping realtime subscribe for %s; already subscribed", sym)
                    continue
                if len(rt_bars) >= MAX_REALTIME_BAR_SUBSCRIPTIONS:
                    logger.debug(
                        "Skipping realtime bars for %s; cap reached (%s active bars)",
                        sym,
                        len(rt_bars),
                    )
                    # Don't re-queue — just drop it. The universe price loop
                    # will handle snapshot prices for these symbols instead.
                    continue
                try:
                    subscribe_realtime(sym)
                    logger.info("Started realtime bars for %s (%s)", sym, reason)
                    backoff_streak = 0
                except Exception as exc:
                    exc_str = str(exc)
                    if "456" in exc_str or "Max number" in exc_str:
                        # TWS hard limit — don't retry, just drop it
                        logger.debug("Realtime bars limit reached for %s, skipping", sym)
                        continue
                    logger.warning(f"Failed to start realtime bars for {sym}: {exc}")

            await asyncio.sleep(pace)

    async def refresh_watchlist():
        nonlocal watchlist
        while True:
            try:
                current = read_watchlist()
            except Exception as exc:
                logger.warning(f"Watchlist read failed: {exc}")
                current = []

            if current != watchlist:
                previous_symbols = _quote_symbol_set()
                watchlist = current
                current_symbols = _quote_symbol_set()
                added = current_symbols - previous_symbols
                removed = previous_symbols - current_symbols
                await asyncio.to_thread(clear_statuses_not_in, list(current_symbols))
                logger.info(
                    "Watchlist refresh: watchlist=%s quote_universe=%s +%s -%s symbols=%s",
                    len(watchlist),
                    len(current_symbols),
                    len(added),
                    len(removed),
                    ",".join(watchlist) if watchlist else "(empty)",
                )

                for sym in removed:
                    cancel_quote_subscription(sym)
                    drop_symbol_state(sym)
                    logger.info("Watchlist unsubscribed %s", sym)

                # Adjust shard count if needed (may connect new shards)
                await _adjust_shards()

                if _any_shard_connected():
                    for sym in added:
                        set_symbol_state(sym, STATE_QUEUED, "queued for paced quote subscription")
                        queue_subscription("quote", sym, "watchlist_refresh")
                else:
                    for sym in added:
                        set_symbol_state(sym, STATE_QUEUED, "watchlist loaded before IB connection")
                        logger.info("Watchlist queued before connect %s", sym)

            await asyncio.sleep(WATCHLIST_REFRESH_S)

    async def _adjust_shards():
        """Spin up or tear down extra IB shards based on quote-subscription demand."""
        quote_symbols = _quote_symbols()
        desired = 1
        if len(quote_symbols) > SHARD_THRESHOLD:
            desired = min(math.ceil(len(quote_symbols) / SHARD_THRESHOLD), MAX_SHARDS)

        # Spin up new shards
        while len(ib_shards) < desired:
            new_idx = len(ib_shards)
            new_ib = IB()
            try:
                new_cid = client_id_mgr.acquire(
                    f"{WORKER_ROLE}:shard{new_idx}",
                    preferred_id=shard_client_ids[-1] + 1,
                )
                shard_client_ids.append(new_cid)
                ib_shards.append(new_ib)
                ok, final_cid = await connect_ib_with_manager(
                    new_ib, host, ports, new_cid, client_id_mgr
                )
                if ok:
                    shard_client_ids[new_idx] = final_cid
                    logger.info(
                        "Shard %d connected (clientId=%d) for %d-symbol quote universe",
                        new_idx, final_cid, len(quote_symbols),
                    )
                else:
                    logger.warning("Shard %d failed to connect, will retry on reconnect", new_idx)
            except Exception as exc:
                logger.warning(f"Failed to create shard {new_idx}: {exc}")
                break

        # Tear down excess shards
        while len(ib_shards) > desired and len(ib_shards) > 1:
            removed_idx = len(ib_shards) - 1
            removed_ib = ib_shards.pop()
            removed_cid = shard_client_ids.pop()
            # Move subscriptions from removed shard back to remaining shards
            syms_on_removed = [s for s, idx in list(symbol_to_shard.items()) if idx == removed_idx]
            for sym in syms_on_removed:
                cancel_quote_subscription(sym)
                queue_subscription("quote", sym, "shard_rebalance")
            if removed_ib.isConnected():
                try:
                    removed_ib.disconnect()
                except Exception:
                    pass
            client_id_mgr.release(removed_cid)
            logger.info("Shard %d removed (clientId=%d)", removed_idx, removed_cid)

    async def refresh_active_symbols():
        nonlocal active_symbols
        while True:
            try:
                current = read_active_symbols()
            except Exception as exc:
                logger.warning(f"Active symbols read failed: {exc}")
                current = []

            if current != active_symbols:
                previous_quote_symbols = _quote_symbol_set()
                previous_active_symbols = set(active_symbols)
                active_symbols = current
                current_quote_symbols = _quote_symbol_set()
                active_added = set(active_symbols) - previous_active_symbols
                active_removed = previous_active_symbols - set(active_symbols)
                quote_added = current_quote_symbols - previous_quote_symbols
                quote_removed = previous_quote_symbols - current_quote_symbols

                await asyncio.to_thread(clear_statuses_not_in, list(current_quote_symbols))

                for sym in active_removed:
                    cancel_realtime_subscription(sym)

                for sym in quote_removed:
                    cancel_quote_subscription(sym)
                    drop_symbol_state(sym)

                await _adjust_shards()

                if _primary_ib().isConnected():
                    for sym in quote_added:
                        set_symbol_state(sym, STATE_QUEUED, "queued for paced quote subscription")
                        queue_subscription("quote", sym, "active_symbol")
                    for sym in active_added:
                        queue_subscription("realtime", sym, "active_symbol")
                else:
                    for sym in quote_added:
                        set_symbol_state(sym, STATE_QUEUED, "active symbol loaded before IB connection")

            await asyncio.sleep(ACTIVE_REFRESH_S)

    async def refresh_universe_symbols():
        nonlocal universe_symbols
        while True:
            try:
                current = load_enabled_symbols()
                if current and current != universe_symbols:
                    universe_symbols = current
                    logger.info("Universe refresh: %s enabled symbols", len(universe_symbols))
            except Exception as exc:
                logger.warning(f"Universe refresh failed: {exc}")
            await asyncio.sleep(UNIVERSE_REFRESH_S)

    async def status_summary_loop():
        while True:
            await asyncio.sleep(STATUS_SUMMARY_S)
            quote_symbols = _quote_symbols()
            if not quote_symbols:
                continue
            waiting = [sym for sym in quote_symbols if symbol_states.get(sym) == STATE_WAITING]
            queued = [sym for sym in quote_symbols if symbol_states.get(sym) == STATE_QUEUED]
            live = [sym for sym in quote_symbols if symbol_states.get(sym) == STATE_LIVE]
            errors = [sym for sym in quote_symbols if symbol_states.get(sym) == STATE_ERROR]
            missing = [sym for sym in quote_symbols if sym not in tickers]
            shard_info = f" shards={_num_shards()}" if _num_shards() > 1 else ""
            logger.info(
                "Quote status summary: total=%s subscribed=%s live=%s waiting=%s queued=%s errors=%s missing_ticker=%s%s",
                len(quote_symbols),
                len(tickers),
                len(live),
                len(waiting),
                len(queued),
                len(errors),
                len(missing),
                shard_info,
            )
            if waiting:
                logger.info("Waiting for valid quote: %s", ",".join(waiting))
            if queued:
                logger.info("Queued before connect: %s", ",".join(queued))
            if errors:
                logger.info("Subscription errors: %s", ",".join(errors))
            if missing:
                logger.info("Missing ticker objects: %s", ",".join(missing))

    async def yahoo_loop():
        while True:
            cycle_started = time.monotonic()
            if _any_shard_connected():
                await asyncio.sleep(FINNHUB_WATCHLIST_POLL_S)
                continue
            symbols = _quote_symbols()
            if not symbols:
                await asyncio.sleep(FINNHUB_WATCHLIST_POLL_S)
                continue
            try:
                source = "Finnhub" if _load_finnhub_api_key() else "Yahoo"
                start_msg = (
                    f"[Quote fallback] Starting {source} refresh for {len(symbols)} symbols; "
                    f"next cycle in {int(FINNHUB_WATCHLIST_POLL_S)}s"
                )
                print(start_msg, flush=True)
                logger.info(start_msg)
                selected_source, quotes = await asyncio.to_thread(
                    fetch_watchlist_quotes_with_fallback, symbols
                )
                for q in quotes:
                    await asyncio.to_thread(upsert_quote, q)
                logger.info(
                    "[Quote fallback] %s returned %d/%d quotes",
                    selected_source,
                    len(quotes),
                    len(symbols),
                )
            except Exception as exc:
                logger.warning(f"Quote fallback poll failed: {exc}")
            elapsed = time.monotonic() - cycle_started
            await asyncio.sleep(max(0.0, FINNHUB_WATCHLIST_POLL_S - elapsed))

    async def yahoo_valuation_loop():
        while True:
            symbols = _quote_symbols()
            if not symbols:
                await asyncio.sleep(YAHOO_VALUATION_CHECK_S)
                continue
            stale_symbols = await asyncio.to_thread(
                get_stale_valuation_symbols, symbols, YAHOO_VALUATION_MAX_AGE_S
            )
            if not stale_symbols:
                logger.info(f"[Valuation] All {len(symbols)} quote symbols up-to-date, next check in {YAHOO_VALUATION_CHECK_S}s")
                await asyncio.sleep(YAHOO_VALUATION_CHECK_S)
                continue
            loop_msg = (
                f"[Valuation loop] Starting Yahoo valuation refresh for {len(stale_symbols)} symbols: "
                f"{','.join(stale_symbols[:10])}{'...' if len(stale_symbols) > 10 else ''}"
            )
            print(loop_msg, flush=True)
            logger.info(loop_msg)
            await asyncio.to_thread(refresh_watchlist_valuations_from_yahoo, stale_symbols)
            null_count = await asyncio.to_thread(count_null_market_cap_symbols, symbols)
            if null_count > 0:
                logger.info(f"[Valuation] {null_count}/{len(symbols)} quote symbols still missing market_cap, retrying in {YAHOO_VALUATION_FAST_RETRY_S}s")
                await asyncio.sleep(YAHOO_VALUATION_FAST_RETRY_S)
            else:
                logger.info(f"[Valuation] All quote symbols market caps filled, next check in {YAHOO_VALUATION_CHECK_S}s")
                await asyncio.sleep(YAHOO_VALUATION_CHECK_S)

    async def backfill_loop():
        last_backfill: Dict[str, float] = {}
        tail_cursor = 0
        while True:
            await asyncio.sleep(1.0)
            ib = _primary_ib()
            tws_connected = ib.isConnected()
            urgent_requests = await asyncio.to_thread(
                pop_historical_priority_requests,
                URGENT_HISTORICAL_BATCH_SIZE,
            )
            for request in urgent_requests:
                sym = request["symbol"]
                request_bar_size = "1 day" if request["bar_size"] == "1d" else "1 min"
                request_what = request["what_to_show"]
                request_duration = request["duration"]
                try:
                    if tws_connected and request_bar_size == "1 min" and request_what == "TRADES":
                        await asyncio.to_thread(invalidate_yahoo_cache, [sym])
                    await get_historical_bars(
                        symbol=sym,
                        ib=ib,
                        tws_connected=tws_connected,
                        duration=request_duration,
                        bar_size=request_bar_size,
                        what_to_show=request_what,
                    )
                    await asyncio.to_thread(refresh_snapshot_from_db, sym)
                except Exception as exc:
                    logger.debug(f"Urgent historical fetch failed for {sym}: {exc}")
                    await asyncio.to_thread(
                        enqueue_historical_priority,
                        sym,
                        request["bar_size"],
                        request_what,
                        request_duration,
                    )
                if tws_connected:
                    await asyncio.sleep(TWS_HISTORICAL_REQUEST_SLEEP_S)
                else:
                    await asyncio.sleep(YAHOO_HISTORICAL_REQUEST_SLEEP_S)

            priority = list(dict.fromkeys(active_symbols + watchlist))
            tail = [sym for sym in universe_symbols if sym not in set(priority)]
            batch = priority[:UNIVERSE_BATCH_SIZE]

            while len(batch) < UNIVERSE_BATCH_SIZE and tail:
                if tail_cursor >= len(tail):
                    tail_cursor = 0
                batch.append(tail[tail_cursor])
                tail_cursor = (tail_cursor + 1) % len(tail)

            for sym in list(dict.fromkeys(batch)):
                now = time.time()
                if now - last_backfill.get(sym, 0) < 300:
                    continue
                try:
                    await asyncio.to_thread(invalidate_yahoo_cache, [sym])
                    await get_historical_bars(
                        symbol=sym,
                        ib=ib,
                        tws_connected=tws_connected,
                        duration=BACKGROUND_INTRADAY_DURATION,
                        bar_size="1 min",
                    )
                    if tws_connected:
                        await asyncio.sleep(TWS_HISTORICAL_REQUEST_SLEEP_S)
                        await get_historical_bars(
                            symbol=sym,
                            ib=ib,
                            tws_connected=True,
                            duration="30 D",
                            bar_size="1 min",
                            what_to_show="BID",
                        )
                        await asyncio.sleep(TWS_HISTORICAL_REQUEST_SLEEP_S)
                        await get_historical_bars(
                            symbol=sym,
                            ib=ib,
                            tws_connected=True,
                            duration="30 D",
                            bar_size="1 min",
                            what_to_show="ASK",
                        )
                        await asyncio.sleep(TWS_HISTORICAL_REQUEST_SLEEP_S)
                    else:
                        await asyncio.sleep(YAHOO_HISTORICAL_REQUEST_SLEEP_S)
                    await get_historical_bars(
                        symbol=sym,
                        ib=ib,
                        tws_connected=tws_connected,
                        duration=DEFAULT_DAILY_DURATION,
                        bar_size="1 day",
                    )
                    last_backfill[sym] = now
                    await asyncio.to_thread(refresh_snapshot_from_db, sym)
                except Exception as exc:
                    logger.warning(f"Backfill failed for {sym}: {exc}")
                if not tws_connected:
                    await asyncio.sleep(YAHOO_HISTORICAL_SYMBOL_SLEEP_S)

    async def snapshot_loop():
        cursor = 0
        while True:
            await asyncio.sleep(SNAPSHOT_LOOP_SLEEP_S)
            symbols = list(dict.fromkeys(active_symbols + watchlist + universe_symbols))
            if not symbols:
                continue
            if cursor >= len(symbols):
                cursor = 0
            batch = symbols[cursor:cursor + UNIVERSE_BATCH_SIZE]
            if len(batch) < UNIVERSE_BATCH_SIZE and cursor > 0:
                batch += symbols[:UNIVERSE_BATCH_SIZE - len(batch)]
            cursor = (cursor + UNIVERSE_BATCH_SIZE) % max(len(symbols), 1)
            for sym in batch:
                try:
                    await asyncio.to_thread(refresh_snapshot_from_db, sym)
                except Exception as exc:
                    logger.debug(f"Snapshot refresh failed for {sym}: {exc}")

    async def universe_yahoo_loop():
        """Fetch Yahoo prices and market caps for all non-watchlist universe symbols.

        Runs every UNIVERSE_YAHOO_INTERVAL_S (1 hour by default). This ensures the
        heatmap has price data even for symbols that TWS snapshots fail on, and
        populates market_cap in watchlist_quotes so the heatmap can size by market cap.
        """
        await asyncio.sleep(30)  # Let primary loops settle first
        while True:
            watchlist_set = set(watchlist)
            queue = [sym for sym in universe_symbols if sym not in watchlist_set]
            if not queue:
                await asyncio.sleep(UNIVERSE_YAHOO_INTERVAL_S)
                continue

            logger.info("[UniverseYahoo] Fetching Yahoo price+marketcap for %d non-watchlist symbols", len(queue))
            batch_size = 50
            fetched = 0
            for i in range(0, len(queue), batch_size):
                batch = queue[i:i + batch_size]
                try:
                    t = YahooTicker(batch, asynchronous=True)
                    price_data = t.price
                    summary_data = t.summary_detail
                    if isinstance(price_data, dict):
                        for sym in batch:
                            data = price_data.get(sym)
                            if not isinstance(data, dict):
                                continue
                            q = yahoo_to_quote(sym, data)
                            if q.get("last"):
                                snapshot = _snapshot_from_quote(q)
                                await asyncio.to_thread(_upsert_market_snapshot, snapshot)
                                fetched += 1
                            # Market cap from summary_detail or price
                            sd = summary_data.get(sym) if isinstance(summary_data, dict) else None
                            _, _, market_cap = _extract_yahoo_valuation(
                                sd if isinstance(sd, dict) else {}, data
                            )
                            if market_cap:
                                await asyncio.to_thread(
                                    upsert_quote_valuation, sym, None, None, market_cap
                                )
                except Exception as exc:
                    logger.warning("[UniverseYahoo] Batch %d failed: %s", i // batch_size, exc)
                if i + batch_size < len(queue):
                    await asyncio.sleep(1.5)

            logger.info("[UniverseYahoo] Done: %d/%d symbols with prices", fetched, len(queue))
            null_count = await asyncio.to_thread(count_null_market_cap_symbols, queue)
            if null_count > 0:
                logger.info("[UniverseYahoo] %d/%d symbols still missing market_cap, retrying in %ds",
                            null_count, len(queue), int(UNIVERSE_YAHOO_FAST_RETRY_S))
                await asyncio.sleep(UNIVERSE_YAHOO_FAST_RETRY_S)
            else:
                logger.info("[UniverseYahoo] All market caps filled, next run in %ds",
                            int(UNIVERSE_YAHOO_INTERVAL_S))
                await asyncio.sleep(UNIVERSE_YAHOO_INTERVAL_S)

    async def universe_price_loop():
        """Slowly pull snapshot quotes for the full ticker universe (for heatmap).

        Iterates one symbol at a time. When TWS is connected it uses snapshots.
        When TWS is disconnected it falls back to Finnhub first, then Yahoo.
        """
        await asyncio.sleep(15)  # Let other loops settle first
        while True:
            ib = _primary_ib()
            watchlist_set = set(watchlist)
            queue = [sym for sym in universe_symbols if sym not in watchlist_set]
            if not queue:
                await asyncio.sleep(UNIVERSE_SNAPSHOT_CYCLE_PAUSE_S)
                continue

            if ib.isConnected():
                logger.info("[UniversePrice] Starting slow TWS cycle: %d symbols (skipping %d watchlist)",
                            len(queue), len(watchlist_set))
                fetched = 0
                total = len(queue)
                for i, sym in enumerate(queue):
                    if not ib.isConnected():
                        break
                    q = None
                    try:
                        contract = Stock(sym, "SMART", "USD")
                        snap_ticker = ib.reqMktData(contract, genericTickList="", snapshot=True)
                        # Give TWS time to fill the snapshot; yield to event loop
                        for _ in range(5):
                            await asyncio.sleep(0.1)
                        q = ticker_to_quote(sym, snap_ticker)
                        if q is not None:
                            snapshot = _snapshot_from_quote(q)
                            await asyncio.to_thread(_upsert_market_snapshot, snapshot)
                            fetched += 1
                        else:
                            # Even without a valid quote, write what we have so the
                            # heatmap shows the symbol exists (with stale/pending status)
                            await asyncio.to_thread(refresh_snapshot_from_db, sym)
                        try:
                            ib.cancelMktData(contract)
                        except Exception:
                            pass
                    except Exception as exc:
                        logger.debug(f"[UniversePrice] Snapshot failed for {sym}: {exc}")

                    await asyncio.sleep(UNIVERSE_SNAPSHOT_SLEEP_S)

                    logger.info("[UniversePrice] %d/%d %s %s",
                                i + 1, total, sym,
                                f"last={q['last']}" if q else "no data")

                logger.info("[UniversePrice] TWS cycle complete: %d/%d symbols updated, next cycle in %ds",
                            fetched, len(queue), int(UNIVERSE_SNAPSHOT_CYCLE_PAUSE_S))
            else:
                source_hint = "Finnhub" if _load_finnhub_api_key() else "Yahoo"
                logger.info(
                    "[UniversePrice] Starting %s fallback cycle: %d symbols (skipping %d watchlist)",
                    source_hint,
                    len(queue),
                    len(watchlist_set),
                )
                try:
                    selected_source, quotes = await asyncio.to_thread(
                        fetch_universe_quotes_with_fallback, queue
                    )
                    for q in quotes:
                        await asyncio.to_thread(upsert_quote, q)
                    logger.info(
                        "[UniversePrice] %s fallback cycle complete: %d/%d symbols updated, next cycle in %ds",
                        selected_source,
                        len(quotes),
                        len(queue),
                        int(UNIVERSE_SNAPSHOT_CYCLE_PAUSE_S),
                    )
                except Exception as exc:
                    logger.warning("[UniversePrice] Fallback cycle failed: %s", exc)
            await asyncio.sleep(UNIVERSE_SNAPSHOT_CYCLE_PAUSE_S)

    async def reconnect_loop():
        while True:
            for i, ib in enumerate(ib_shards):
                if not ib.isConnected():
                    ok, new_id = await connect_ib_with_manager(
                        ib, host, ports, shard_client_ids[i], client_id_mgr
                    )
                    if ok:
                        shard_client_ids[i] = new_id
                        if i == 0:
                            # Primary shard reconnected — clear and re-subscribe everything
                            tickers.clear()
                            quote_contracts.clear()
                            symbol_to_shard.clear()
                            rt_bars.clear()
                            current_1m.clear()
                            queued_quote_symbols.clear()
                            queued_realtime_symbols.clear()
                            subscription_queue.clear()
                            quote_symbols = _quote_symbols()
                            if quote_symbols:
                                await asyncio.to_thread(invalidate_yahoo_cache, quote_symbols)
                            for sym in quote_symbols:
                                queue_subscription("quote", sym, "reconnect")
                            for sym in active_symbols:
                                queue_subscription("realtime", sym, "reconnect")
                        else:
                            # Secondary shard reconnected — re-subscribe its symbols
                            syms_for_shard = [s for s, idx in list(symbol_to_shard.items()) if idx == i]
                            for sym in syms_for_shard:
                                cancel_quote_subscription(sym)
                                queue_subscription("quote", sym, f"shard{i}_reconnect")
                        logger.info("Shard %d reconnected (clientId=%d)", i, new_id)
                    else:
                        logger.debug("Shard %d not connected, will retry in 10s", i)
            await asyncio.sleep(10.0)

    try:
        # Connect primary shard
        ok, new_id = await connect_ib_with_manager(
            ib_shards[0], host, ports, shard_client_ids[0], client_id_mgr
        )
        if ok:
            shard_client_ids[0] = new_id

        await asyncio.gather(
            subscription_loop(),
            refresh_watchlist(),
            refresh_active_symbols(),
            refresh_universe_symbols(),
            status_summary_loop(),
            yahoo_loop(),
            yahoo_valuation_loop(),
            backfill_loop(),
            snapshot_loop(),
            universe_price_loop(),
            universe_yahoo_loop(),
            reconnect_loop(),
        )
    finally:
        for i, ib in enumerate(ib_shards):
            if ib.isConnected():
                ib.disconnect()
            if i < len(shard_client_ids):
                client_id_mgr.release(shard_client_ids[i])


def main() -> None:
    global CLIENT_ID_SCAN_LIMIT
    parser = argparse.ArgumentParser(description="Watchlist worker")
    parser.add_argument("--tws-host", default="127.0.0.1")
    parser.add_argument("--tws-port", type=int, default=0)
    parser.add_argument("--client-id", type=int, default=default_client_id())
    parser.add_argument("--client-id-max", type=int, default=CLIENT_ID_SCAN_LIMIT)
    args = parser.parse_args()

    ports = [args.tws_port] if args.tws_port else [7497, 7496]
    CLIENT_ID_SCAN_LIMIT = args.client_id_max
    asyncio.run(worker_loop(args.tws_host, ports, args.client_id))


if __name__ == "__main__":
    main()
