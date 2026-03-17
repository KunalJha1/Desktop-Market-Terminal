"""Background historical bar prefetcher.

Runs in a background asyncio task. Priority order:
1. Watchlist symbols (re-checked each loop iteration)
2. All symbols from tickers.json

Sleeps 10s between each symbol fetch to avoid rate-limiting.
Skips symbols whose cache is still fresh (5-min TTL from historical.py).
"""

import asyncio
import json
import logging
from pathlib import Path

from historical import _get_conn, _cache_fresh, CACHE_TTL

logger = logging.getLogger(__name__)

TICKERS_PATH = Path(__file__).parent.parent / "data" / "tickers.json"
SLEEP_BETWEEN = 10  # seconds between each symbol fetch


def _load_all_symbols() -> list[str]:
    """Load all symbols from tickers.json."""
    try:
        with open(TICKERS_PATH) as f:
            data = json.load(f)
        companies = data.get("companies", [])
        return [c["symbol"] for c in companies if c.get("enabled", True)]
    except Exception as e:
        logger.warning(f"Failed to load tickers.json: {e}")
        return []


class Prefetcher:
    """Background task that gradually populates the DuckDB with historical bars."""

    def __init__(self):
        self._task: asyncio.Task | None = None
        self._watchlist: list[str] = []
        self._all_symbols: list[str] = _load_all_symbols()
        self._ib_client = None
        self._tws_connected = False
        self._pool = None

    def set_watchlist(self, symbols: list[str]):
        self._watchlist = list(symbols)

    def set_tws_state(self, connected: bool, pool=None):
        self._tws_connected = connected
        self._pool = pool

    def start(self):
        if self._task is not None:
            return
        logger.info(f"Prefetcher started ({len(self._all_symbols)} symbols in universe)")
        self._task = asyncio.ensure_future(self._loop())

    def stop(self):
        if self._task is None:
            return
        self._task.cancel()
        self._task = None
        logger.info("Prefetcher stopped")

    async def _loop(self):
        """Main loop: watchlist first, then all symbols, then repeat."""
        from historical import get_historical_bars

        # Wait a bit on startup so the sidecar and providers can settle
        await asyncio.sleep(5)

        try:
            while True:
                # Build ordered fetch queue: watchlist first, then remaining symbols
                watchlist_set = set(self._watchlist)
                queue = list(self._watchlist)  # watchlist symbols first
                for sym in self._all_symbols:
                    if sym not in watchlist_set:
                        queue.append(sym)

                for symbol in queue:
                    # Check if cache is already fresh — skip if so
                    try:
                        conn = _get_conn()
                        fresh = _cache_fresh(conn, symbol, "1 min")
                        conn.close()
                        if fresh:
                            continue
                    except Exception:
                        pass

                    # Fetch (the function handles TWS → Yahoo → cache fallback)
                    ib_client = None
                    if self._tws_connected and self._pool:
                        try:
                            ib_client = await self._pool.get_or_create(950)
                        except Exception:
                            ib_client = None

                    try:
                        bars, source = await get_historical_bars(
                            symbol=symbol,
                            ib=ib_client,
                            tws_connected=self._tws_connected,
                            duration="5 D",
                            bar_size="1 min",
                        )
                        if bars:
                            logger.info(f"Prefetched {symbol}: {len(bars)} bars from {source}")
                        else:
                            logger.debug(f"Prefetch {symbol}: no bars available")
                    except Exception as e:
                        logger.debug(f"Prefetch {symbol} failed: {e}")

                    await asyncio.sleep(SLEEP_BETWEEN)

                # After going through all symbols, sleep longer before repeating
                logger.info("Prefetch cycle complete, sleeping 5 minutes before next round")
                await asyncio.sleep(300)

        except asyncio.CancelledError:
            pass
