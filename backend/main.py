"""DailyIQ Sidecar — FastAPI HTTP API for DB-backed market data."""

import argparse
import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from db_utils import run_db, sync_db_session
from historical import get_historical_bars
from score_worker import TechnicalsScorer, read_scores
from technicals import compute_indicators_for_symbols

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

logger = logging.getLogger("sidecar")


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


def create_app() -> FastAPI:
    scorer = TechnicalsScorer()

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
                           change, change_pct, volume, spread, source, updated_at
                    FROM watchlist_quotes
                    WHERE symbol IN ({placeholders})
                    """,
                    sym_list,
                ).fetchall()
            return [
                {
                    "symbol": r[0],
                    "last": r[1],
                    "bid": r[2],
                    "ask": r[3],
                    "mid": r[4],
                    "open": r[5],
                    "high": r[6],
                    "low": r[7],
                    "prevClose": r[8],
                    "change": r[9],
                    "changePct": r[10],
                    "volume": r[11],
                    "spread": r[12],
                    "source": r[13],
                    "updatedAt": r[14],
                }
                for r in rows
                if _is_valid_quote_row(r)
            ]

        return {"quotes": await run_db(_read)}

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
        duration: str = "5 D",
        what_to_show: str = "TRADES",
    ):
        """Return historical bars for a symbol using Yahoo fallback."""
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
    args = parser.parse_args()
    import uvicorn

    uvicorn.run(create_app(), host="127.0.0.1", port=args.port, log_level="info")
