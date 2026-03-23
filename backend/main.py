"""DailyIQ Sidecar — FastAPI HTTP API for DB-backed market data."""

import argparse
import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from ib_insync import IB

from db_utils import run_db, sync_db_session
from historical import (
    DEFAULT_INTRADAY_DURATION,
    get_historical_bars,
    read_bars_window,
)
from ibkr_utils import IbkrClientIdManager, is_client_id_in_use_error
from score_worker import TechnicalsScorer, read_scores
from technicals import compute_indicators_for_symbols

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

logger = logging.getLogger("sidecar")

DEFAULT_TWS_HOST = "127.0.0.1"
DEFAULT_TWS_PORTS = (7497, 7496)
DEFAULT_TWS_CLIENT_ID = 1000
PORTFOLIO_ROLE = "portfolio:reader"
TICKERS_PATH = Path(__file__).parent.parent / "data" / "tickers.json"


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


def create_app() -> FastAPI:
    scorer = TechnicalsScorer()
    ticker_metadata = _load_ticker_metadata()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        scorer.set_symbols(await run_db(read_watchlist_symbols))
        scorer.start()
        try:
            yield
        finally:
            scorer.stop()

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
        return {"status": "ok"}

    @app.get("/portfolio/positions")
    async def get_portfolio_positions():
        def _read_positions_sync() -> dict:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            ib = IB()
            manager = IbkrClientIdManager(start=DEFAULT_TWS_CLIENT_ID)
            last_error: str | None = None
            leased_client_id: int | None = None

            try:
                leased_client_id = manager.acquire(PORTFOLIO_ROLE, preferred_id=DEFAULT_TWS_CLIENT_ID)
                for tws_port in DEFAULT_TWS_PORTS:
                    try:
                        ib.connect(
                            DEFAULT_TWS_HOST,
                            tws_port,
                            clientId=leased_client_id,
                            readonly=True,
                            timeout=4,
                        )

                        positions = []
                        for item in ib.reqPositions():
                            contract = item.contract
                            symbol = (getattr(contract, "localSymbol", None) or contract.symbol or "").upper()
                            position = float(item.position or 0)
                            multiplier = float(getattr(contract, "multiplier", None) or 1)
                            raw_avg_cost = float(item.avgCost or 0)
                            average_cost = raw_avg_cost / multiplier if multiplier else raw_avg_cost
                            cost_basis = average_cost * position

                            positions.append({
                                "account": item.account,
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

                        positions.sort(key=lambda row: str(row["symbol"]))

                        # Fetch cash balances per currency from account summary
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
                                                "account": av.account,
                                                "currency": av.currency,
                                                "balance": balance,
                                            })
                        except Exception:
                            pass

                        return {
                            "connected": True,
                            "host": DEFAULT_TWS_HOST,
                            "port": tws_port,
                            "positions": positions,
                            "cashBalances": cash_balances,
                            "updatedAt": int(time.time() * 1000),
                            "clientId": leased_client_id,
                        }
                    except Exception as exc:
                        last_error = str(exc)
                        if is_client_id_in_use_error(exc) and leased_client_id is not None:
                            manager.mark_rejected(leased_client_id)
                            leased_client_id = manager.acquire(
                                PORTFOLIO_ROLE,
                                preferred_id=leased_client_id + 1,
                            )
                    finally:
                        if ib.isConnected():
                            ib.disconnect()
            finally:
                try:
                    pending = asyncio.all_tasks(loop)
                    for task in pending:
                        task.cancel()
                    if pending:
                        loop.run_until_complete(
                            asyncio.gather(*pending, return_exceptions=True)
                        )
                except Exception:
                    pass
                asyncio.set_event_loop(None)
                loop.close()
                if leased_client_id is not None:
                    manager.release(leased_client_id)

            return {
                "connected": False,
                "host": DEFAULT_TWS_HOST,
                "port": None,
                "positions": [],
                "cashBalances": [],
                "updatedAt": int(time.time() * 1000),
                "error": last_error,
            }

        return await asyncio.to_thread(_read_positions_sync)

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
                tiles.sort(key=lambda item: float(item.get("sp500Weight") or 0), reverse=True)
                return tiles

        tiles = await run_db(_read)
        return {
            "asOf": int(time.time() * 1000),
            "universe": "sp500",
            "count": len(tiles),
            "tiles": tiles,
        }

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
    async def get_technical_scores(symbols: str = ""):
        if not symbols:
            return []
        sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
        return await run_db(read_scores, sym_list)

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
            db_bar_size = "1d" if bar_size in ("1 day", "1d") else "1m"
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
                "source": "cache",
                "count": result["count"],
                "whatToShow": what_to_show.upper(),
                "ts_min": result["ts_min"],
                "ts_max": result["ts_max"],
            }

        # Full path: fetch from TWS/Yahoo if cache is stale, then return
        bars, source = await get_historical_bars(
            symbol=symbol,
            ib=None,
            tws_connected=False,
            duration=duration,
            bar_size=bar_size,
            what_to_show=what_to_show,
        )
        return {
            "symbol": symbol,
            "bars": bars,
            "source": source,
            "count": len(bars),
            "whatToShow": what_to_show.upper(),
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
