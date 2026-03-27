"""DailyIQ Sidecar — FastAPI HTTP API for DB-backed market data."""

import argparse
import asyncio
from collections import defaultdict
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from db_utils import run_db, sync_db_session
from historical import (
    DEFAULT_DAILY_DURATION,
    DEFAULT_INTRADAY_DURATION,
    _normalize_bar_size,
    target_duration_for_bar_size,
    URGENT_HISTORICAL_WAIT_S,
    enqueue_historical_priority,
    get_historical_bars,
    read_cached_series,
    read_bars_window,
    seed_duration_for_bar_size,
)
from connection_pool import ConnectionPool, probe_tws_port
from runtime_paths import data_dir, resource_path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

logger = logging.getLogger("sidecar")

DEFAULT_TWS_HOST = "127.0.0.1"
DEFAULT_TWS_PORTS = (7497, 7496)
DEFAULT_TWS_CLIENT_ID = 1000
PORTFOLIO_ROLE = "portfolio:reader"
TICKERS_PATH = resource_path("data", "tickers.json")
SETTINGS_PATH = data_dir() / "tws-settings.json"
FINNHUB_TEST_SYMBOL = "AAPL"
FINNHUB_HTTP_TIMEOUT_S = 10.0


def _now_ms() -> int:
    return int(time.time() * 1000)


def _manual_account_ref(account_id: str) -> str:
    return f"manual:{account_id}"


def _ibkr_account_ref(account_code: str) -> str:
    return f"ibkr:{account_code}"


def _normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper()


def _normalize_currency(currency: str) -> str:
    value = (currency or "USD").strip().upper()
    return value or "USD"


def _load_settings_payload(settings_path: Path | None = None) -> dict:
    path = settings_path or SETTINGS_PATH
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception as exc:
        logger.warning("Failed to read settings from %s: %s", path, exc)
        return {}


def _write_settings_payload(payload: dict, settings_path: Path | None = None) -> None:
    path = settings_path or SETTINGS_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


def _current_finnhub_status(payload: dict | None = None) -> dict:
    data = payload if isinstance(payload, dict) else _load_settings_payload()
    api_key = str(data.get("finnhubApiKey") or "").strip()
    connected = bool(data.get("finnhubConnected")) or bool(api_key)
    if not api_key:
        return {
            "status": "disconnected",
            "message": "No API key saved",
            "hasKey": False,
            "validatedAt": None,
        }
    return {
        "status": "connected" if connected else "disconnected",
        "message": str(data.get("finnhubStatusMessage") or "Finnhub key saved"),
        "hasKey": True,
        "validatedAt": int(data.get("finnhubValidatedAt") or 0) or None,
    }


def _validate_finnhub_key(api_key: str) -> tuple[bool, str]:
    token = str(api_key or "").strip()
    if not token:
        return True, "Finnhub key cleared"

    url = (
        "https://finnhub.io/api/v1/quote?"
        + urlencode({"symbol": FINNHUB_TEST_SYMBOL, "token": token})
    )
    try:
        with urlopen(url, timeout=FINNHUB_HTTP_TIMEOUT_S) as response:
            payload = response.read().decode("utf-8")
        data = json.loads(payload)
        if not isinstance(data, dict):
            return False, "Unexpected Finnhub response"
        if data.get("error"):
            return False, str(data["error"])
        price = float(data.get("c") or 0)
        if price <= 0:
            return False, "Finnhub returned no usable quote"
        return True, f"Finnhub validated with {FINNHUB_TEST_SYMBOL}"
    except HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="ignore").strip()
        except Exception:
            pass
        return False, body or f"HTTP {exc.code}"
    except URLError as exc:
        return False, f"Network error: {exc.reason}"
    except Exception as exc:
        return False, str(exc)


PORTFOLIO_CACHE_TTL_S = 60.0
_portfolio_cache_lock: asyncio.Lock | None = None
_portfolio_cache: dict | None = None
_portfolio_cache_time: float = 0.0
_portfolio_last_good: dict | None = None


async def _ensure_pool_configured(pool: ConnectionPool) -> bool:
    """Probe TWS ports and configure the pool if not yet set up. Returns True if configured."""
    if pool._host is not None:
        return True
    port = await probe_tws_port(DEFAULT_TWS_HOST, DEFAULT_TWS_PORTS)
    if port is None:
        return False
    pool.set_tws_address(DEFAULT_TWS_HOST, port)
    return True


async def read_live_portfolio_snapshot_async(pool: ConnectionPool) -> dict:
    if not await _ensure_pool_configured(pool):
        return {
            "connected": False,
            "host": DEFAULT_TWS_HOST,
            "port": None,
            "accounts": [],
            "positions": [],
            "cashBalances": [],
            "updatedAt": _now_ms(),
            "error": "TWS not reachable",
        }

    try:
        ib = await pool.get_or_create(PORTFOLIO_ROLE)
    except Exception as exc:
        return {
            "connected": False,
            "host": DEFAULT_TWS_HOST,
            "port": None,
            "accounts": [],
            "positions": [],
            "cashBalances": [],
            "updatedAt": _now_ms(),
            "error": str(exc),
        }

    try:
        positions = []
        for item in ib.reqPositions():
            contract = item.contract
            symbol = (getattr(contract, "localSymbol", None) or contract.symbol or "").upper()
            position = float(item.position or 0)
            multiplier = float(getattr(contract, "multiplier", None) or 1)
            raw_avg_cost = float(item.avgCost or 0)
            average_cost = raw_avg_cost / multiplier if multiplier else raw_avg_cost
            cost_basis = average_cost * position
            account_code = item.account

            positions.append({
                "accountId": _ibkr_account_ref(account_code),
                "account": account_code,
                "accountCode": account_code,
                "source": "ibkr",
                "editable": False,
                "symbol": symbol,
                "name": getattr(contract, "description", None) or contract.symbol,
                "currency": contract.currency,
                "exchange": contract.exchange,
                "primaryExchange": getattr(contract, "primaryExchange", None),
                "secType": contract.secType,
                "quantity": position,
                "avgCost": average_cost,
                "costBasis": cost_basis,
                "currentPrice": None,
                "marketValue": None,
                "unrealizedPnl": None,
                "realizedPnl": None,
            })

        positions.sort(key=lambda row: (str(row["account"]), str(row["symbol"])))

        cash_balances = []
        try:
            seen_cash: set[tuple[str, str]] = set()
            for av in ib.accountSummary():
                if av.tag == "CashBalance" and av.currency not in ("BASE", ""):
                    key = (av.account, av.currency)
                    if key not in seen_cash:
                        seen_cash.add(key)
                        balance = float(av.value or 0)
                        if balance != 0:
                            cash_balances.append({
                                "id": f"{_ibkr_account_ref(av.account)}:{av.currency}",
                                "accountId": _ibkr_account_ref(av.account),
                                "account": av.account,
                                "accountCode": av.account,
                                "source": "ibkr",
                                "editable": False,
                                "currency": av.currency,
                                "balance": balance,
                            })
        except Exception:
            pass

        account_codes = sorted({row["accountCode"] for row in positions} | {cash["accountCode"] for cash in cash_balances})
        accounts = [
            {
                "id": _ibkr_account_ref(account_code),
                "name": account_code,
                "source": "ibkr",
                "editable": False,
                "accountCode": account_code,
            }
            for account_code in account_codes
        ]

        return {
            "connected": True,
            "host": pool._host,
            "port": pool._port,
            "accounts": accounts,
            "positions": positions,
            "cashBalances": cash_balances,
            "updatedAt": _now_ms(),
            "clientId": pool.get_client_id(PORTFOLIO_ROLE),
        }
    except Exception as exc:
        # If the connection dropped mid-fetch, the pool will auto-reconnect in background
        return {
            "connected": False,
            "host": DEFAULT_TWS_HOST,
            "port": None,
            "accounts": [],
            "positions": [],
            "cashBalances": [],
            "updatedAt": _now_ms(),
            "error": str(exc),
        }


async def read_live_portfolio_snapshot_cached_async(pool: ConnectionPool, force: bool = False) -> dict:
    global _portfolio_cache, _portfolio_cache_time, _portfolio_last_good

    now = time.monotonic()
    if not force:
        async with _portfolio_cache_lock:
            if _portfolio_cache is not None and (now - _portfolio_cache_time) < PORTFOLIO_CACHE_TTL_S:
                return _portfolio_cache

    result = await read_live_portfolio_snapshot_async(pool)

    async with _portfolio_cache_lock:
        if result.get("connected"):
            _portfolio_last_good = result
            _portfolio_cache = result
        else:
            if _portfolio_last_good is not None:
                _portfolio_cache = {
                    **_portfolio_last_good,
                    "connected": False,
                    "stale": True,
                    "staleSince": result.get("updatedAt", _now_ms()),
                    "error": result.get("error"),
                }
            else:
                _portfolio_cache = result
        _portfolio_cache_time = now

    return _portfolio_cache


def build_unified_portfolio_snapshot() -> dict:
    """Sync shim for background workers (options_collector, etc.) — reads from in-memory cache only, no IB connection."""
    live = _portfolio_cache or {
        "connected": False,
        "host": DEFAULT_TWS_HOST,
        "port": None,
        "accounts": [],
        "positions": [],
        "cashBalances": [],
        "updatedAt": _now_ms(),
    }
    manual = read_manual_portfolio_state()
    accounts = [*live.get("accounts", []), *manual["accounts"]]
    groups = manual["groups"]
    accounts_by_ref = {account["id"]: account for account in accounts}
    for account in accounts:
        account["groupIds"] = []
        account["groupNames"] = []
    for group in groups:
        group_account_refs = [ref for ref in group.get("accountRefs", []) if ref in accounts_by_ref]
        group["accountIds"] = group_account_refs
        group["accountNames"] = [accounts_by_ref[ref]["name"] for ref in group_account_refs]
        for account_ref in group_account_refs:
            acct = accounts_by_ref[account_ref]
            acct["groupIds"].append(group["id"])
            acct["groupNames"].append(group["name"])
    return {
        "connected": live.get("connected", False),
        "host": live.get("host", DEFAULT_TWS_HOST),
        "port": live.get("port"),
        "accounts": sorted(accounts, key=lambda a: (a["source"], a["name"].lower(), a["id"])),
        "groups": sorted(groups, key=lambda g: g["name"].lower()),
        "positions": [*live.get("positions", []), *manual["positions"]],
        "cashBalances": [*live.get("cashBalances", []), *manual["cashBalances"]],
        "updatedAt": max(live.get("updatedAt", 0), _now_ms()),
        "error": live.get("error"),
    }


def _read_manual_accounts(conn) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, name, created_at, updated_at
        FROM portfolio_manual_accounts
        ORDER BY LOWER(name), id
        """
    ).fetchall()
    return [
        {
            "id": _manual_account_ref(row[0]),
            "name": row[1],
            "source": "manual",
            "editable": True,
            "accountCode": None,
            "createdAt": row[2],
            "updatedAt": row[3],
        }
        for row in rows
    ]


def _read_manual_positions(conn, account_names: dict[str, str]) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, account_id, symbol, name, currency, exchange, primary_exchange,
               sec_type, quantity, avg_cost
        FROM portfolio_manual_positions
        ORDER BY account_id, symbol
        """
    ).fetchall()
    positions = []
    for row in rows:
        quantity = float(row[8] or 0)
        avg_cost = float(row[9] or 0)
        positions.append({
            "id": row[0],
            "accountId": _manual_account_ref(row[1]),
            "account": account_names.get(row[1], row[1]),
            "accountCode": None,
            "source": "manual",
            "editable": True,
            "symbol": row[2],
            "name": row[3] or row[2],
            "currency": row[4],
            "exchange": row[5] or "",
            "primaryExchange": row[6],
            "secType": row[7] or "STK",
            "quantity": quantity,
            "avgCost": avg_cost,
            "costBasis": quantity * avg_cost,
            "currentPrice": None,
            "marketValue": None,
            "unrealizedPnl": None,
            "realizedPnl": None,
        })
    return positions


def _read_manual_cash(conn, account_names: dict[str, str]) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, account_id, currency, balance
        FROM portfolio_manual_cash_balances
        ORDER BY account_id, currency
        """
    ).fetchall()
    return [
        {
            "id": row[0],
            "accountId": _manual_account_ref(row[1]),
            "account": account_names.get(row[1], row[1]),
            "accountCode": None,
            "source": "manual",
            "editable": True,
            "currency": row[2],
            "balance": float(row[3] or 0),
        }
        for row in rows
    ]


def _read_portfolio_groups(conn) -> list[dict]:
    rows = conn.execute(
        """
        SELECT g.id, g.name, m.account_ref
        FROM portfolio_groups g
        LEFT JOIN portfolio_group_memberships m ON m.group_id = g.id
        ORDER BY LOWER(g.name), g.id, m.account_ref
        """
    ).fetchall()
    groups: dict[str, dict] = {}
    for group_id, name, account_ref in rows:
        group = groups.setdefault(group_id, {
            "id": group_id,
            "name": name,
            "accountRefs": [],
        })
        if account_ref:
            group["accountRefs"].append(account_ref)
    return list(groups.values())


def read_manual_portfolio_state() -> dict:
    with sync_db_session() as conn:
        accounts = _read_manual_accounts(conn)
        manual_name_map = {account["id"].replace("manual:", ""): account["name"] for account in accounts}
        positions = _read_manual_positions(conn, manual_name_map)
        cash_balances = _read_manual_cash(conn, manual_name_map)
        groups = _read_portfolio_groups(conn)
    return {
        "accounts": accounts,
        "positions": positions,
        "cashBalances": cash_balances,
        "groups": groups,
    }


async def build_unified_portfolio_snapshot_async(pool: ConnectionPool, force: bool = False) -> dict:
    live = await read_live_portfolio_snapshot_cached_async(pool, force=force)
    manual = await run_db(read_manual_portfolio_state)
    accounts = [*live.get("accounts", []), *manual["accounts"]]
    groups = manual["groups"]
    accounts_by_ref = {account["id"]: account for account in accounts}
    for account in accounts:
        account["groupIds"] = []
        account["groupNames"] = []
    for group in groups:
        group_account_refs = [ref for ref in group["accountRefs"] if ref in accounts_by_ref]
        group["accountIds"] = group_account_refs
        group["accountNames"] = [accounts_by_ref[ref]["name"] for ref in group_account_refs]
        for account_ref in group_account_refs:
            account = accounts_by_ref[account_ref]
            account["groupIds"].append(group["id"])
            account["groupNames"].append(group["name"])
    return {
        "connected": live.get("connected", False),
        "host": live.get("host", DEFAULT_TWS_HOST),
        "port": live.get("port"),
        "accounts": sorted(accounts, key=lambda account: (account["source"], account["name"].lower(), account["id"])),
        "groups": sorted(groups, key=lambda group: group["name"].lower()),
        "positions": [*live.get("positions", []), *manual["positions"]],
        "cashBalances": [*live.get("cashBalances", []), *manual["cashBalances"]],
        "updatedAt": max(live.get("updatedAt", 0), _now_ms()),
        "error": live.get("error"),
    }


def _is_valid_quote_row(row: tuple) -> bool:
    prices = [row[1], row[2], row[3], row[4], row[8]]
    for value in prices:
        if isinstance(value, (int, float)) and value > 0:
            return True
    return False


def read_watchlist_symbols() -> list[str]:
    with sync_db_session() as conn:
        rows = conn.execute(
            "SELECT symbol FROM watchlist_symbols ORDER BY position"
        ).fetchall()
        return [r[0] for r in rows]


def read_watchlist_diagnostics() -> dict:
    with sync_db_session() as conn:
        watchlist_rows = conn.execute(
            "SELECT position, symbol FROM watchlist_symbols ORDER BY position"
        ).fetchall()
        status_rows = conn.execute(
            "SELECT symbol, state, detail, updated_at FROM watchlist_status ORDER BY symbol"
        ).fetchall()

    symbols = [r[1] for r in watchlist_rows if (r[1] or "").strip()]
    status_by_symbol = {
        r[0]: {
            "symbol": r[0],
            "state": r[1],
            "detail": r[2],
            "updatedAt": r[3],
        }
        for r in status_rows
    }
    missing = [sym for sym in symbols if sym not in status_by_symbol]
    return {
        "watchlistCount": len(watchlist_rows),
        "nonEmptyCount": len(symbols),
        "blankCount": len(watchlist_rows) - len(symbols),
        "symbols": symbols,
        "statuses": [status_by_symbol[sym] for sym in symbols if sym in status_by_symbol],
        "missingStatuses": missing,
    }


def _load_ticker_metadata() -> dict[str, dict]:
    try:
        with open(TICKERS_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {}

    out: dict[str, dict] = {}
    for company in data.get("companies", []):
        symbol = str(company.get("symbol") or "").strip().upper()
        if not symbol:
            continue
        out[symbol] = {
            "symbol": symbol,
            "name": company.get("name") or symbol,
            "sector": company.get("sector") or "",
            "industry": company.get("industry") or "",
            "theme": company.get("theme") or "#1f2937",
            "groups": company.get("groups") or [],
            "sp500Weight": float(company.get("sp500_weight") or 0),
            "enabled": bool(company.get("enabled", True)),
        }
    return out


CUSTOM_HEATMAP_MAX_SYMBOLS = 100


def _parse_heatmap_symbol_query(raw: str, limit: int = CUSTOM_HEATMAP_MAX_SYMBOLS) -> list[str]:
    """Parse comma/newline-separated symbols for custom heatmap/screener (uppercase, deduped, order preserved)."""
    if not raw or not str(raw).strip():
        return []
    seen: set[str] = set()
    out: list[str] = []
    for part in str(raw).replace("\n", ",").split(","):
        s = part.strip().upper()
        if not s or len(s) > 12:
            continue
        if not all(c.isalnum() or c in ".-" for c in s):
            continue
        if s in seen:
            continue
        seen.add(s)
        out.append(s)
        if len(out) >= limit:
            break
    return out


def _heatmap_pending_tile(
    sym: str,
    metadata: dict | None = None,
    week52_high: float | None = None,
    week52_low: float | None = None,
) -> dict:
    """Tile row when there is no market_snapshots row yet (worker will fill after /active-symbols)."""
    meta = metadata or {}
    return {
        "symbol": sym,
        "name": meta.get("name") or sym,
        "sector": meta.get("sector") or "",
        "industry": meta.get("industry") or "",
        "theme": meta.get("theme") or "#1f2937",
        "groups": meta.get("groups") or [],
        "sp500Weight": float(meta.get("sp500Weight") or 0),
        "last": None,
        "open": None,
        "high": None,
        "low": None,
        "prevClose": None,
        "change": None,
        "changePct": None,
        "volume": None,
        "bid": None,
        "ask": None,
        "mid": None,
        "spread": None,
        "source": None,
        "status": "pending",
        "quoteUpdatedAt": None,
        "intradayUpdatedAt": None,
        "dailyUpdatedAt": None,
        "updatedAt": None,
        "week52High": week52_high,
        "week52Low": week52_low,
    }


def _snapshot_row_to_payload(
    row: tuple,
    metadata: dict | None = None,
    week52_high: float | None = None,
    week52_low: float | None = None,
) -> dict:
    meta = metadata or {}
    return {
        "symbol": row[0],
        "name": meta.get("name") or row[0],
        "sector": meta.get("sector") or "",
        "industry": meta.get("industry") or "",
        "theme": meta.get("theme") or "#1f2937",
        "groups": meta.get("groups") or [],
        "sp500Weight": meta.get("sp500Weight") or 0,
        "last": row[1],
        "open": row[2],
        "high": row[3],
        "low": row[4],
        "prevClose": row[5],
        "change": row[6],
        "changePct": row[7],
        "volume": row[8],
        "bid": row[9],
        "ask": row[10],
        "mid": row[11],
        "spread": row[12],
        "source": row[13],
        "status": row[14],
        "quoteUpdatedAt": row[15],
        "intradayUpdatedAt": row[16],
        "dailyUpdatedAt": row[17],
        "updatedAt": row[18],
        "week52High": week52_high,
        "week52Low": week52_low,
    }


def _fetch_week52(conn, symbols: list[str]) -> dict[str, tuple[float | None, float | None]]:
    """Batch-query ohlcv_1d for 52-week high/low for a list of symbols."""
    if not symbols:
        return {}
    ts_52w_ago = int((time.time() - 52 * 7 * 86400) * 1000)
    placeholders = ", ".join("?" * len(symbols))
    try:
        rows = conn.execute(
            f"""
            SELECT symbol, MAX(high), MIN(low)
            FROM ohlcv_1d
            WHERE symbol IN ({placeholders}) AND ts >= ?
            GROUP BY symbol
            """,
            (*symbols, ts_52w_ago),
        ).fetchall()
        return {
            r[0]: (round(r[1], 2) if r[1] is not None else None,
                   round(r[2], 2) if r[2] is not None else None)
            for r in rows
        }
    except Exception as e:
        logger.warning(f"52W H/L batch query failed: {e}")
        return {}


def _fetch_valuation_map(conn, symbols: list[str]) -> dict[str, dict]:
    """Fetch trailing_pe, forward_pe, market_cap from watchlist_quotes for given symbols."""
    if not symbols:
        return {}
    placeholders = ", ".join("?" * len(symbols))
    rows = conn.execute(
        f"""
        SELECT symbol, trailing_pe, forward_pe, market_cap
        FROM watchlist_quotes
        WHERE symbol IN ({placeholders})
        """,
        symbols,
    ).fetchall()
    return {r[0]: {"trailingPE": r[1], "forwardPE": r[2], "marketCap": r[3]} for r in rows}


def _enrich_with_valuations(payloads: list[dict], valuation_map: dict[str, dict]) -> None:
    """Merge valuation fields into snapshot payloads in-place."""
    for p in payloads:
        v = valuation_map.get(p["symbol"], {})
        p["trailingPE"] = v.get("trailingPE")
        p["forwardPE"] = v.get("forwardPE")
        p["marketCap"] = v.get("marketCap")


def _enrich_with_tech_scores(conn, payloads: list[dict]) -> None:
    """Merge cached technical scores (all timeframes) into snapshot payloads in-place."""
    symbols = [p["symbol"] for p in payloads]
    if not symbols:
        return
    placeholders = ", ".join("?" * len(symbols))
    try:
        rows = conn.execute(
            f"""
            SELECT symbol, score_1m, score_5m, score_15m, score_1h, score_4h,
                   score_1d, score_1w
            FROM technical_scores
            WHERE symbol IN ({placeholders})
            """,
            symbols,
        ).fetchall()
        score_map = {r[0]: r[1:8] for r in rows}
    except Exception:
        score_map = {}
    tf_keys = ("1m", "5m", "15m", "1h", "4h", "1d", "1w")
    for p in payloads:
        tup = score_map.get(p["symbol"])
        if tup is None:
            p["techScores"] = {k: None for k in tf_keys}
            p["techScore1d"] = None
            p["techScore1w"] = None
            continue
        p["techScores"] = {tf_keys[i]: tup[i] for i in range(7)}
        p["techScore1d"] = tup[5]
        p["techScore1w"] = tup[6]


def _format_option_expiration_label(expiration_ms: int) -> str:
    dt = datetime.fromtimestamp(expiration_ms / 1000, tz=timezone.utc)
    return dt.strftime("%b %d")


def _format_option_month_label(expiration_ms: int) -> str:
    dt = datetime.fromtimestamp(expiration_ms / 1000, tz=timezone.utc)
    return dt.strftime("%b %Y")


def _option_snapshot_payload(row) -> dict:
    return {
        "contractId": row[0],
        "underlyingPrice": row[1],
        "bid": row[2],
        "ask": row[3],
        "bidSize": row[4],
        "askSize": row[5],
        "mid": row[6],
        "lastPrice": row[7],
        "change": row[8],
        "changePct": row[9],
        "volume": row[10],
        "openInterest": row[11],
        "impliedVolatility": row[12],
        "inTheMoney": bool(row[13]) if row[13] is not None else None,
        "lastTradeDate": row[14],
        "delta": row[15],
        "gamma": row[16],
        "theta": row[17],
        "vega": row[18],
        "rho": row[19],
        "intrinsicValue": row[20],
        "extrinsicValue": row[21],
        "daysToExpiration": row[22],
        "riskFreeRate": row[23],
        "greeksSource": row[24],
        "ivSource": row[25],
        "calcError": row[26],
        "source": row[27],
    }


def read_options_summary(symbol: str) -> dict:
    normalized = symbol.strip().upper()
    if not normalized:
        return {
            "symbol": "",
            "hasData": False,
            "underlyingPrice": None,
            "capturedAt": None,
            "source": None,
            "months": [],
        }

    with sync_db_session() as conn:
        latest = conn.execute(
            """
            SELECT MAX(s.captured_at)
            FROM option_snapshots s
            JOIN option_contracts c ON c.contract_id = s.contract_id
            WHERE c.underlying = ?
            """,
            (normalized,),
        ).fetchone()
        captured_at = latest[0] if latest and latest[0] is not None else None
        if captured_at is None:
            return {
                "symbol": normalized,
                "hasData": False,
                "underlyingPrice": None,
                "capturedAt": None,
                "source": None,
                "months": [],
            }

        rows = conn.execute(
            """
            SELECT
                c.expiration,
                COUNT(*) AS contract_count,
                MAX(s.underlying_price) AS underlying_price,
                MAX(s.source) AS source
            FROM option_contracts c
            JOIN option_snapshots s ON s.contract_id = c.contract_id
            WHERE c.underlying = ? AND s.captured_at = ?
            GROUP BY c.expiration
            ORDER BY c.expiration ASC
            """,
            (normalized, captured_at),
        ).fetchall()

    months: dict[str, dict] = {}
    underlying_price = None
    source = None
    for expiration, contract_count, exp_underlying_price, exp_source in rows:
        month_key = datetime.fromtimestamp(expiration / 1000, tz=timezone.utc).strftime("%Y-%m")
        month_bucket = months.setdefault(
            month_key,
            {
                "monthKey": month_key,
                "monthLabel": _format_option_month_label(expiration),
                "expirations": [],
            },
        )
        month_bucket["expirations"].append({
            "expiration": expiration,
            "label": _format_option_expiration_label(expiration),
            "contractCount": contract_count,
        })
        if underlying_price is None and exp_underlying_price is not None:
            underlying_price = exp_underlying_price
        if source is None and exp_source:
            source = exp_source

    return {
        "symbol": normalized,
        "hasData": bool(rows),
        "underlyingPrice": underlying_price,
        "capturedAt": captured_at,
        "source": source,
        "months": list(months.values()),
    }


def read_options_chain(symbol: str, expiration: int | None = None) -> dict:
    normalized = symbol.strip().upper()
    if not normalized:
        return {
            "symbol": "",
            "hasData": False,
            "expiration": None,
            "expirationLabel": None,
            "capturedAt": None,
            "rows": [],
        }

    with sync_db_session() as conn:
        latest = conn.execute(
            """
            SELECT MAX(s.captured_at)
            FROM option_snapshots s
            JOIN option_contracts c ON c.contract_id = s.contract_id
            WHERE c.underlying = ?
            """,
            (normalized,),
        ).fetchone()
        captured_at = latest[0] if latest and latest[0] is not None else None
        if captured_at is None:
            return {
                "symbol": normalized,
                "hasData": False,
                "expiration": None,
                "expirationLabel": None,
                "capturedAt": None,
                "rows": [],
            }

        selected_expiration = expiration
        if selected_expiration is None:
            exp_row = conn.execute(
                """
                SELECT MIN(c.expiration)
                FROM option_contracts c
                JOIN option_snapshots s ON s.contract_id = c.contract_id
                WHERE c.underlying = ? AND s.captured_at = ?
                """,
                (normalized, captured_at),
            ).fetchone()
            selected_expiration = exp_row[0] if exp_row and exp_row[0] is not None else None

        if selected_expiration is None:
            return {
                "symbol": normalized,
                "hasData": False,
                "expiration": None,
                "expirationLabel": None,
                "capturedAt": captured_at,
                "rows": [],
            }

        rows = conn.execute(
            """
            SELECT
                c.strike,
                c.option_type,
                s.contract_id,
                s.underlying_price,
                s.bid,
                s.ask,
                s.bid_size,
                s.ask_size,
                s.mid,
                s.last_price,
                s.change,
                s.change_pct,
                s.volume,
                s.open_interest,
                s.implied_volatility,
                s.in_the_money,
                s.last_trade_date,
                s.delta,
                s.gamma,
                s.theta,
                s.vega,
                s.rho,
                s.intrinsic_value,
                s.extrinsic_value,
                s.days_to_expiration,
                s.risk_free_rate,
                s.greeks_source,
                s.iv_source,
                s.calc_error,
                s.source
            FROM option_contracts c
            JOIN option_snapshots s ON s.contract_id = c.contract_id
            WHERE c.underlying = ? AND c.expiration = ? AND s.captured_at = ?
            ORDER BY c.strike ASC, c.option_type ASC
            """,
            (normalized, selected_expiration, captured_at),
        ).fetchall()

    ladder: dict[float, dict] = defaultdict(lambda: {"strike": None, "call": None, "put": None})
    for row in rows:
        strike = row[0]
        option_type = row[1]
        payload = _option_snapshot_payload(row[2:])
        ladder[strike]["strike"] = strike
        ladder[strike][option_type] = payload

    ordered_rows = [ladder[strike] for strike in sorted(ladder)]
    return {
        "symbol": normalized,
        "hasData": bool(ordered_rows),
        "expiration": selected_expiration,
        "expirationLabel": _format_option_expiration_label(selected_expiration),
        "capturedAt": captured_at,
        "rows": ordered_rows,
    }


def create_app() -> FastAPI:
    from options_collector import (
        DEFAULT_INTERVAL_MINUTES as OPTIONS_DEFAULT_INTERVAL_MINUTES,
        DEFAULT_RISK_FREE_RATE as OPTIONS_DEFAULT_RISK_FREE_RATE,
        DEFAULT_SOURCE as OPTIONS_DEFAULT_SOURCE,
        OptionsCollectorWorker,
    )
    from score_worker import TechnicalsScorer

    scorer = TechnicalsScorer()
    options_worker = OptionsCollectorWorker(
        source=OPTIONS_DEFAULT_SOURCE,
        interval_minutes=OPTIONS_DEFAULT_INTERVAL_MINUTES,
        risk_free_rate=OPTIONS_DEFAULT_RISK_FREE_RATE,
    )
    ticker_metadata = _load_ticker_metadata()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        global _portfolio_cache_lock
        # Create asyncio primitives inside the running event loop to avoid
        # "Future attached to a different loop" errors on Windows (ProactorEventLoop).
        _portfolio_cache_lock = asyncio.Lock()
        pool = ConnectionPool()

        scorer.set_symbols(await run_db(read_watchlist_symbols))
        sp500_symbols = [
            sym for sym, meta in ticker_metadata.items()
            if meta.get("enabled") and float(meta.get("sp500Weight") or 0) > 0
        ]
        scorer.set_universe(sp500_symbols)
        scorer.start()
        options_worker.start()

        # Pre-warm persistent IB connection for portfolio reads
        port = await probe_tws_port(DEFAULT_TWS_HOST, DEFAULT_TWS_PORTS)
        if port is not None:
            pool.set_tws_address(DEFAULT_TWS_HOST, port)
            try:
                await pool.get_or_create(PORTFOLIO_ROLE)
                logger.info(f"Persistent IB connection established on port {port}")
            except Exception:
                logger.warning("TWS not available at startup; portfolio connection will be attempted on first request")
        else:
            logger.warning("TWS not reachable at startup; portfolio connection will be attempted on first request")

        _app.state.pool = pool
        try:
            yield
        finally:
            await pool.disconnect_all()
            scorer.stop()
            options_worker.stop()

    app = FastAPI(lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
        max_age=86400,
    )

    @app.get("/health")
    async def health():
        return {"status": "ok", "finnhub": _current_finnhub_status()}

    @app.get("/settings/finnhub/status")
    async def finnhub_status():
        return _current_finnhub_status()

    class FinnhubValidationPayload(BaseModel):
        apiKey: str = ""

    @app.post("/settings/finnhub/validate")
    async def validate_finnhub(payload: FinnhubValidationPayload):
        settings = _load_settings_payload()
        candidate_key = str(payload.apiKey or "").strip()
        ok, message = _validate_finnhub_key(candidate_key)

        if not ok:
            return {
                "ok": False,
                **_current_finnhub_status(settings),
                "message": message,
            }

        settings["finnhubApiKey"] = candidate_key
        settings["finnhubConnected"] = bool(candidate_key)
        settings["finnhubStatusMessage"] = (
            message if candidate_key else "Finnhub key cleared"
        )
        settings["finnhubValidatedAt"] = _now_ms() if candidate_key else None
        _write_settings_payload(settings)

        return {
            "ok": True,
            **_current_finnhub_status(settings),
        }

    class ManualAccountPayload(BaseModel):
        name: str
        groupIds: list[str] = []

    class ManualPositionPayload(BaseModel):
        symbol: str
        quantity: float
        avgCost: float
        currency: str = "USD"
        name: str = ""
        exchange: str = ""
        primaryExchange: str | None = None
        secType: str = "STK"

    class ManualCashPayload(BaseModel):
        currency: str = "USD"
        balance: float

    class PortfolioGroupPayload(BaseModel):
        name: str
        accountIds: list[str] = []

    @app.get("/portfolio/positions")
    async def get_portfolio_positions():
        return await read_live_portfolio_snapshot_async(app.state.pool)

    @app.get("/portfolio")
    async def get_portfolio(force: bool = False):
        return await build_unified_portfolio_snapshot_async(app.state.pool, force)

    @app.get("/portfolio/manual")
    async def get_manual_portfolio():
        return await run_db(read_manual_portfolio_state)

    @app.post("/portfolio/manual/accounts")
    async def create_manual_account(payload: ManualAccountPayload):
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Account name is required.")

        def _create():
            with sync_db_session() as conn:
                now = _now_ms()
                account_id = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO portfolio_manual_accounts (id, name, created_at, updated_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (account_id, name, now, now),
                )
                for group_id in payload.groupIds:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO portfolio_group_memberships (group_id, account_ref, created_at)
                        VALUES (?, ?, ?)
                        """,
                        (group_id, _manual_account_ref(account_id), now),
                    )
                return {"id": account_id, "name": name}

        return await run_db(_create)

    @app.put("/portfolio/manual/accounts/{account_id}")
    async def update_manual_account(account_id: str, payload: ManualAccountPayload):
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Account name is required.")

        def _update():
            with sync_db_session() as conn:
                row = conn.execute(
                    "SELECT id FROM portfolio_manual_accounts WHERE id = ?",
                    (account_id,),
                ).fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Manual account not found.")
                now = _now_ms()
                conn.execute(
                    "UPDATE portfolio_manual_accounts SET name = ?, updated_at = ? WHERE id = ?",
                    (name, now, account_id),
                )
                conn.execute(
                    "DELETE FROM portfolio_group_memberships WHERE account_ref = ?",
                    (_manual_account_ref(account_id),),
                )
                for group_id in payload.groupIds:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO portfolio_group_memberships (group_id, account_ref, created_at)
                        VALUES (?, ?, ?)
                        """,
                        (group_id, _manual_account_ref(account_id), now),
                    )
                return {"id": account_id, "name": name}

        return await run_db(_update)

    @app.delete("/portfolio/manual/accounts/{account_id}")
    async def delete_manual_account(account_id: str):
        def _delete():
            with sync_db_session() as conn:
                row = conn.execute(
                    "SELECT id FROM portfolio_manual_accounts WHERE id = ?",
                    (account_id,),
                ).fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Manual account not found.")
                conn.execute("DELETE FROM portfolio_manual_accounts WHERE id = ?", (account_id,))
                conn.execute(
                    "DELETE FROM portfolio_group_memberships WHERE account_ref = ?",
                    (_manual_account_ref(account_id),),
                )
                return {"deleted": True}

        return await run_db(_delete)

    @app.post("/portfolio/manual/accounts/{account_id}/positions")
    async def create_manual_position(account_id: str, payload: ManualPositionPayload):
        symbol = _normalize_symbol(payload.symbol)
        if not symbol:
            raise HTTPException(status_code=400, detail="Symbol is required.")

        def _create():
            with sync_db_session() as conn:
                account_row = conn.execute(
                    "SELECT id FROM portfolio_manual_accounts WHERE id = ?",
                    (account_id,),
                ).fetchone()
                if not account_row:
                    raise HTTPException(status_code=404, detail="Manual account not found.")
                existing = conn.execute(
                    """
                    SELECT id FROM portfolio_manual_positions
                    WHERE account_id = ? AND symbol = ?
                    """,
                    (account_id, symbol),
                ).fetchone()
                if existing:
                    raise HTTPException(status_code=400, detail="Position already exists for that symbol.")
                now = _now_ms()
                position_id = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO portfolio_manual_positions (
                        id, account_id, symbol, name, currency, exchange, primary_exchange,
                        sec_type, quantity, avg_cost, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        position_id,
                        account_id,
                        symbol,
                        payload.name.strip(),
                        _normalize_currency(payload.currency),
                        payload.exchange.strip(),
                        payload.primaryExchange.strip() if payload.primaryExchange else None,
                        (payload.secType or "STK").strip().upper(),
                        payload.quantity,
                        payload.avgCost,
                        now,
                        now,
                    ),
                )
                return {"id": position_id, "symbol": symbol}

        return await run_db(_create)

    @app.put("/portfolio/manual/positions/{position_id}")
    async def update_manual_position(position_id: str, payload: ManualPositionPayload):
        symbol = _normalize_symbol(payload.symbol)
        if not symbol:
            raise HTTPException(status_code=400, detail="Symbol is required.")

        def _update():
            with sync_db_session() as conn:
                row = conn.execute(
                    "SELECT id, account_id FROM portfolio_manual_positions WHERE id = ?",
                    (position_id,),
                ).fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Manual position not found.")
                duplicate = conn.execute(
                    """
                    SELECT id FROM portfolio_manual_positions
                    WHERE account_id = ? AND symbol = ? AND id <> ?
                    """,
                    (row[1], symbol, position_id),
                ).fetchone()
                if duplicate:
                    raise HTTPException(status_code=400, detail="Another position already uses that symbol.")
                conn.execute(
                    """
                    UPDATE portfolio_manual_positions
                    SET symbol = ?, name = ?, currency = ?, exchange = ?, primary_exchange = ?,
                        sec_type = ?, quantity = ?, avg_cost = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        symbol,
                        payload.name.strip(),
                        _normalize_currency(payload.currency),
                        payload.exchange.strip(),
                        payload.primaryExchange.strip() if payload.primaryExchange else None,
                        (payload.secType or "STK").strip().upper(),
                        payload.quantity,
                        payload.avgCost,
                        _now_ms(),
                        position_id,
                    ),
                )
                return {"id": position_id, "symbol": symbol}

        return await run_db(_update)

    @app.delete("/portfolio/manual/positions/{position_id}")
    async def delete_manual_position(position_id: str):
        def _delete():
            with sync_db_session() as conn:
                row = conn.execute(
                    "SELECT id FROM portfolio_manual_positions WHERE id = ?",
                    (position_id,),
                ).fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Manual position not found.")
                conn.execute("DELETE FROM portfolio_manual_positions WHERE id = ?", (position_id,))
                return {"deleted": True}

        return await run_db(_delete)

    @app.post("/portfolio/manual/accounts/{account_id}/cash-balances")
    async def create_manual_cash_balance(account_id: str, payload: ManualCashPayload):
        currency = _normalize_currency(payload.currency)

        def _create():
            with sync_db_session() as conn:
                account_row = conn.execute(
                    "SELECT id FROM portfolio_manual_accounts WHERE id = ?",
                    (account_id,),
                ).fetchone()
                if not account_row:
                    raise HTTPException(status_code=404, detail="Manual account not found.")
                existing = conn.execute(
                    """
                    SELECT id FROM portfolio_manual_cash_balances
                    WHERE account_id = ? AND currency = ?
                    """,
                    (account_id, currency),
                ).fetchone()
                if existing:
                    raise HTTPException(status_code=400, detail="Cash balance already exists for that currency.")
                now = _now_ms()
                cash_id = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO portfolio_manual_cash_balances (
                        id, account_id, currency, balance, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (cash_id, account_id, currency, payload.balance, now, now),
                )
                return {"id": cash_id, "currency": currency}

        return await run_db(_create)

    @app.put("/portfolio/manual/cash-balances/{cash_id}")
    async def update_manual_cash_balance(cash_id: str, payload: ManualCashPayload):
        currency = _normalize_currency(payload.currency)

        def _update():
            with sync_db_session() as conn:
                row = conn.execute(
                    "SELECT id, account_id FROM portfolio_manual_cash_balances WHERE id = ?",
                    (cash_id,),
                ).fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Manual cash balance not found.")
                duplicate = conn.execute(
                    """
                    SELECT id FROM portfolio_manual_cash_balances
                    WHERE account_id = ? AND currency = ? AND id <> ?
                    """,
                    (row[1], currency, cash_id),
                ).fetchone()
                if duplicate:
                    raise HTTPException(status_code=400, detail="Another cash balance already uses that currency.")
                conn.execute(
                    """
                    UPDATE portfolio_manual_cash_balances
                    SET currency = ?, balance = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (currency, payload.balance, _now_ms(), cash_id),
                )
                return {"id": cash_id, "currency": currency}

        return await run_db(_update)

    @app.delete("/portfolio/manual/cash-balances/{cash_id}")
    async def delete_manual_cash_balance(cash_id: str):
        def _delete():
            with sync_db_session() as conn:
                row = conn.execute(
                    "SELECT id FROM portfolio_manual_cash_balances WHERE id = ?",
                    (cash_id,),
                ).fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Manual cash balance not found.")
                conn.execute("DELETE FROM portfolio_manual_cash_balances WHERE id = ?", (cash_id,))
                return {"deleted": True}

        return await run_db(_delete)

    @app.post("/portfolio/manual/groups")
    async def create_portfolio_group(payload: PortfolioGroupPayload):
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Group name is required.")

        def _create():
            with sync_db_session() as conn:
                now = _now_ms()
                group_id = str(uuid.uuid4())
                conn.execute(
                    "INSERT INTO portfolio_groups (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
                    (group_id, name, now, now),
                )
                for account_ref in payload.accountIds:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO portfolio_group_memberships (group_id, account_ref, created_at)
                        VALUES (?, ?, ?)
                        """,
                        (group_id, account_ref, now),
                    )
                return {"id": group_id, "name": name}

        return await run_db(_create)

    @app.put("/portfolio/manual/groups/{group_id}")
    async def update_portfolio_group(group_id: str, payload: PortfolioGroupPayload):
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Group name is required.")

        def _update():
            with sync_db_session() as conn:
                row = conn.execute(
                    "SELECT id FROM portfolio_groups WHERE id = ?",
                    (group_id,),
                ).fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Portfolio group not found.")
                now = _now_ms()
                conn.execute(
                    "UPDATE portfolio_groups SET name = ?, updated_at = ? WHERE id = ?",
                    (name, now, group_id),
                )
                conn.execute("DELETE FROM portfolio_group_memberships WHERE group_id = ?", (group_id,))
                for account_ref in payload.accountIds:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO portfolio_group_memberships (group_id, account_ref, created_at)
                        VALUES (?, ?, ?)
                        """,
                        (group_id, account_ref, now),
                    )
                return {"id": group_id, "name": name}

        return await run_db(_update)

    @app.delete("/portfolio/manual/groups/{group_id}")
    async def delete_portfolio_group(group_id: str):
        def _delete():
            with sync_db_session() as conn:
                row = conn.execute(
                    "SELECT id FROM portfolio_groups WHERE id = ?",
                    (group_id,),
                ).fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Portfolio group not found.")
                conn.execute("DELETE FROM portfolio_groups WHERE id = ?", (group_id,))
                return {"deleted": True}

        return await run_db(_delete)

    class WatchlistPayload(BaseModel):
        symbols: list[str]

    @app.get("/watchlist")
    async def get_watchlist():
        """Return the persisted watchlist symbol list in order."""
        return {"symbols": await run_db(read_watchlist_symbols)}

    @app.get("/watchlist/diagnostics")
    async def get_watchlist_diagnostics():
        return await run_db(read_watchlist_diagnostics)

    @app.put("/watchlist")
    async def put_watchlist(payload: WatchlistPayload):
        """Replace the entire watchlist with the provided ordered symbol list."""
        symbols = [s.strip().upper() for s in payload.symbols]

        def _replace():
            with sync_db_session() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE;")
                cur.execute("DELETE FROM watchlist_symbols")
                if symbols:
                    cur.executemany(
                        "INSERT INTO watchlist_symbols (position, symbol) VALUES (?, ?)",
                        [(i, s) for i, s in enumerate(symbols)],
                    )
                conn.commit()

        await run_db(_replace)
        scorer.set_symbols(symbols)
        return {"symbols": symbols}

    @app.get("/quotes")
    async def get_quotes(symbols: str = ""):
        """Return latest quotes for the requested symbols from SQLite."""
        if not symbols:
            return {"quotes": []}
        sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
        if not sym_list:
            return {"quotes": []}

        def _read():
            placeholders = ", ".join("?" * len(sym_list))
            with sync_db_session() as conn:
                rows = conn.execute(
                    f"""
                    SELECT symbol, last, bid, ask, mid, open, high, low, prev_close,
                           change, change_pct, volume, spread, trailing_pe, forward_pe,
                           market_cap, valuation_updated_at,
                           source, updated_at
                    FROM watchlist_quotes
                    WHERE symbol IN ({placeholders})
                    """,
                    sym_list,
                ).fetchall()
                quotes = []
                for r in rows:
                    if not _is_valid_quote_row(r):
                        continue
                    bid = r[2]
                    ask = r[3]
                    # Fill bid/ask from historical bar tables when missing
                    if not bid or bid <= 0 or not ask or ask <= 0:
                        sym = r[0]
                        try:
                            if not bid or bid <= 0:
                                bid_row = conn.execute(
                                    "SELECT close FROM ohlcv_1m_bid WHERE symbol = ? ORDER BY ts DESC LIMIT 1",
                                    (sym,),
                                ).fetchone()
                                bid = bid_row[0] if bid_row and bid_row[0] and bid_row[0] > 0 else None
                            if not ask or ask <= 0:
                                ask_row = conn.execute(
                                    "SELECT close FROM ohlcv_1m_ask WHERE symbol = ? ORDER BY ts DESC LIMIT 1",
                                    (sym,),
                                ).fetchone()
                                ask = ask_row[0] if ask_row and ask_row[0] and ask_row[0] > 0 else None
                        except Exception:
                            bid = bid if bid and bid > 0 else None
                            ask = ask if ask and ask > 0 else None
                    mid = round((bid + ask) / 2, 4) if bid and ask else r[4]
                    spread = round(ask - bid, 4) if bid and ask else None
                    # 52-week high/low from daily bars
                    week52_high = None
                    week52_low = None
                    try:
                        ts_52w_ago = int((time.time() - 52 * 7 * 86400) * 1000)
                        w52_row = conn.execute(
                            "SELECT MAX(high), MIN(low) FROM ohlcv_1d WHERE symbol = ? AND ts >= ?",
                            (r[0], ts_52w_ago),
                        ).fetchone()
                        if w52_row and w52_row[0] is not None:
                            week52_high = round(w52_row[0], 2)
                            week52_low = round(w52_row[1], 2)
                    except Exception as e:
                        logger.warning(f"52W H/L query failed for {r[0]}: {e}")

                    quotes.append({
                        "symbol": r[0],
                        "last": r[1],
                        "bid": bid,
                        "ask": ask,
                        "mid": mid,
                        "open": r[5],
                        "high": r[6],
                        "low": r[7],
                        "prevClose": r[8],
                        "change": r[9],
                        "changePct": r[10],
                        "volume": r[11],
                        "spread": spread,
                        "trailingPE": r[13],
                        "forwardPE": r[14],
                        "marketCap": r[15],
                        "valuationUpdatedAt": r[16],
                        "week52High": week52_high,
                        "week52Low": week52_low,
                        "source": r[17],
                        "updatedAt": r[18],
                    })
                return quotes

        return {"quotes": await run_db(_read)}

    @app.get("/market/snapshots")
    async def get_market_snapshots(symbols: str = ""):
        if not symbols:
            return {"snapshots": []}
        sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
        if not sym_list:
            return {"snapshots": []}

        def _read():
            placeholders = ", ".join("?" * len(sym_list))
            with sync_db_session() as conn:
                rows = conn.execute(
                    f"""
                    SELECT symbol, last, open, high, low, prev_close, change, change_pct,
                           volume, bid, ask, mid, spread, source, status,
                           quote_updated_at, intraday_updated_at, daily_updated_at, updated_at
                    FROM market_snapshots
                    WHERE symbol IN ({placeholders})
                    """,
                    sym_list,
                ).fetchall()
                row_map = {row[0]: row for row in rows}
                present = [sym for sym in sym_list if sym in row_map]
                w52_map = _fetch_week52(conn, present)
                payloads = [
                    _snapshot_row_to_payload(
                        row_map[sym], ticker_metadata.get(sym),
                        *w52_map.get(sym, (None, None)),
                    )
                    for sym in present
                ]
                val_map = _fetch_valuation_map(conn, [p["symbol"] for p in payloads])
                _enrich_with_valuations(payloads, val_map)
                return payloads

        return {"snapshots": await run_db(_read)}

    @app.get("/heatmap/sp500")
    async def get_sp500_heatmap():
        sp500_symbols = [
            sym for sym, meta in ticker_metadata.items()
            if meta.get("enabled") and float(meta.get("sp500Weight") or 0) > 0
        ]

        def _read():
            if not sp500_symbols:
                return []
            placeholders = ", ".join("?" * len(sp500_symbols))
            with sync_db_session() as conn:
                rows = conn.execute(
                    f"""
                    SELECT symbol, last, open, high, low, prev_close, change, change_pct,
                           volume, bid, ask, mid, spread, source, status,
                           quote_updated_at, intraday_updated_at, daily_updated_at, updated_at
                    FROM market_snapshots
                    WHERE symbol IN ({placeholders})
                    """,
                    sp500_symbols,
                ).fetchall()
                row_map = {row[0]: row for row in rows}
                present = [sym for sym in sp500_symbols if sym in row_map]
                w52_map = _fetch_week52(conn, present)
                tiles = []
                for sym in present:
                    row = row_map[sym]
                    tiles.append(_snapshot_row_to_payload(
                        row, ticker_metadata.get(sym), *w52_map.get(sym, (None, None))
                    ))
                val_map = _fetch_valuation_map(conn, [t["symbol"] for t in tiles])
                _enrich_with_valuations(tiles, val_map)
                _enrich_with_tech_scores(conn, tiles)
                tiles.sort(key=lambda item: float(item.get("sp500Weight") or 0), reverse=True)
                return tiles

        tiles = await run_db(_read)
        return {
            "asOf": int(time.time() * 1000),
            "universe": "sp500",
            "count": len(tiles),
            "tiles": tiles,
        }

    @app.get("/heatmap/custom")
    async def get_custom_heatmap(symbols: str = ""):
        sym_list = _parse_heatmap_symbol_query(symbols)

        def _read():
            if not sym_list:
                return []
            placeholders = ", ".join("?" * len(sym_list))
            with sync_db_session() as conn:
                rows = conn.execute(
                    f"""
                    SELECT symbol, last, open, high, low, prev_close, change, change_pct,
                           volume, bid, ask, mid, spread, source, status,
                           quote_updated_at, intraday_updated_at, daily_updated_at, updated_at
                    FROM market_snapshots
                    WHERE symbol IN ({placeholders})
                    """,
                    sym_list,
                ).fetchall()
                row_map = {row[0]: row for row in rows}
                w52_map = _fetch_week52(conn, sym_list)
                tiles: list[dict] = []
                for sym in sym_list:
                    meta = ticker_metadata.get(sym)
                    wh, wl = w52_map.get(sym, (None, None))
                    if sym in row_map:
                        tiles.append(
                            _snapshot_row_to_payload(row_map[sym], meta, wh, wl),
                        )
                    else:
                        tiles.append(_heatmap_pending_tile(sym, meta, wh, wl))
                val_map = _fetch_valuation_map(conn, [t["symbol"] for t in tiles])
                _enrich_with_valuations(tiles, val_map)
                _enrich_with_tech_scores(conn, tiles)
                return tiles

        tiles = await run_db(_read)
        return {
            "asOf": int(time.time() * 1000),
            "universe": "custom",
            "requested": len(sym_list),
            "count": len(tiles),
            "tiles": tiles,
        }

    @app.get("/options/summary")
    async def get_options_summary(symbol: str = ""):
        return await run_db(read_options_summary, symbol)

    @app.get("/options/chain")
    async def get_options_chain(symbol: str = "", expiration: int | None = None):
        return await run_db(read_options_chain, symbol, expiration)

    class ActiveSymbolsPayload(BaseModel):
        symbols: list[str]

    @app.post("/active-symbols")
    async def post_active_symbols(payload: ActiveSymbolsPayload):
        """Register symbols as active so the watchlist worker subscribes them for live quotes."""
        sym_list = [s.strip().upper() for s in payload.symbols if s.strip()]
        if not sym_list:
            return {"registered": 0}

        now_ms = int(time.time() * 1000)

        def _touch():
            with sync_db_session() as conn:
                conn.executemany(
                    """
                    INSERT INTO active_symbols (symbol, last_requested)
                    VALUES (?, ?)
                    ON CONFLICT(symbol) DO UPDATE SET
                        last_requested = excluded.last_requested
                    """,
                    [(sym, now_ms) for sym in sym_list],
                )

        await run_db(_touch)
        return {"registered": len(sym_list)}

    @app.get("/technicals/scores")
    async def get_technical_scores(symbols: str = "", timeframes: str = ""):
        if not symbols:
            return []
        sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
        tf_list = [tf.strip().lower() for tf in timeframes.split(",") if tf.strip()]
        from score_worker import read_scores_for_timeframes
        return await run_db(read_scores_for_timeframes, sym_list, tf_list)

    @app.get("/technicals/indicators")
    async def get_technical_indicators(symbols: str = "", indicators: str = "[]"):
        if not symbols:
            return {}
        sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
        if not sym_list:
            return {}
        try:
            indicator_specs = json.loads(indicators)
            if not isinstance(indicator_specs, list):
                indicator_specs = []
        except json.JSONDecodeError:
            indicator_specs = []
        if not indicator_specs:
            return {sym: {} for sym in sym_list}
        from technicals import compute_indicators_for_symbols
        return await run_db(compute_indicators_for_symbols, sym_list, indicator_specs)

    @app.get("/historical")
    async def get_historical(
        symbol: str,
        bar_size: str = "1 min",
        duration: str = DEFAULT_INTRADAY_DURATION,
        what_to_show: str = "TRADES",
        ts_start: int | None = None,
        ts_end: int | None = None,
        limit: int | None = None,
    ):
        """Return historical bars for a symbol.

        When ts_start/ts_end/limit are provided, returns a windowed slice
        directly from the DB cache (fast path for viewport-based loading).
        Otherwise falls back to the full fetch+cache flow.
        """
        symbol = symbol.upper()
        db_bar_size = _normalize_bar_size(bar_size)
        requested_duration = duration if duration else target_duration_for_bar_size(db_bar_size)
        # Mark symbol as active so the worker can prioritize TWS backfill + realtime bars.
        def _touch_active():
            with sync_db_session() as conn:
                conn.execute(
                    """
                    INSERT INTO active_symbols (symbol, last_requested)
                    VALUES (?, ?)
                    ON CONFLICT(symbol) DO UPDATE SET
                        last_requested = excluded.last_requested
                    """,
                    (symbol, int(time.time() * 1000)),
                )

        await run_db(_touch_active)

        # Fast path: windowed read from DB cache (no network fetch)
        if ts_start is not None or ts_end is not None or limit is not None:
            result = await run_db(
                read_bars_window,
                symbol,
                db_bar_size,
                what_to_show,
                ts_start,
                ts_end,
                limit,
            )
            payload = {
                "symbol": symbol,
                "bars": result["bars"],
                "source": "cache",
                "count": result["count"],
                "whatToShow": what_to_show.upper(),
                "ts_min": result["ts_min"],
                "ts_max": result["ts_max"],
            }
            if result["count"] > 0:
                return payload

            await run_db(
                enqueue_historical_priority,
                symbol,
                db_bar_size,
                what_to_show,
                requested_duration,
            )
            try:
                await asyncio.wait_for(
                    get_historical_bars(
                        symbol=symbol,
                        ib=None,
                        tws_connected=False,
                        duration=seed_duration_for_bar_size(bar_size),
                        bar_size=bar_size,
                        what_to_show=what_to_show,
                    ),
                    timeout=URGENT_HISTORICAL_WAIT_S,
                )
            except Exception:
                pass

            result = await run_db(
                read_bars_window,
                symbol,
                db_bar_size,
                what_to_show,
                ts_start,
                ts_end,
                limit,
            )
            return {
                "symbol": symbol,
                "bars": result["bars"],
                "source": "cache" if result["count"] else "none",
                "count": result["count"],
                "whatToShow": what_to_show.upper(),
                "ts_min": result["ts_min"],
                "ts_max": result["ts_max"],
            }

        cached = await run_db(
            read_cached_series,
            symbol,
            db_bar_size,
            what_to_show,
            requested_duration,
        )
        if cached["count"] > 0:
            if not cached["is_fresh"] or not cached.get("has_full_coverage", False):
                await run_db(
                    enqueue_historical_priority,
                    symbol,
                    db_bar_size,
                    what_to_show,
                    requested_duration,
                )
            bars, source = cached["bars"], "cache"
        else:
            await run_db(
                enqueue_historical_priority,
                symbol,
                db_bar_size,
                what_to_show,
                requested_duration,
            )
            bars: list[dict] = []
            source = "none"
            try:
                bars, source = await asyncio.wait_for(
                    get_historical_bars(
                        symbol=symbol,
                        ib=None,
                        tws_connected=False,
                        duration=seed_duration_for_bar_size(bar_size),
                        bar_size=bar_size,
                        what_to_show=what_to_show,
                    ),
                    timeout=URGENT_HISTORICAL_WAIT_S,
                )
            except Exception:
                pass
        return {
            "symbol": symbol,
            "bars": bars,
            "source": source,
            "count": len(bars),
            "whatToShow": what_to_show.upper(),
            "ts_min": cached.get("ts_min") if isinstance(cached, dict) else None,
            "ts_max": cached.get("ts_max") if isinstance(cached, dict) else None,
        }

    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DailyIQ Sidecar")
    parser.add_argument("--port", type=int, default=18100, help="HTTP port")
    parser.add_argument("--tws-host", default=DEFAULT_TWS_HOST, help="Reserved for future TWS config")
    parser.add_argument("--tws-port", type=int, default=0, help="Reserved for future TWS config")
    parser.add_argument("--client-id", type=int, default=DEFAULT_TWS_CLIENT_ID, help="Reserved for future TWS config")
    args = parser.parse_args()
    import uvicorn

    uvicorn.run(create_app(), host="127.0.0.1", port=args.port, log_level="info")
