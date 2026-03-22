"""YahooProvider — fallback quote polling via yahooquery when TWS is unavailable."""

import asyncio
import logging
from typing import Callable

from yahooquery import Ticker

logger = logging.getLogger(__name__)

POLL_INTERVAL = 5.0  # seconds between polls


def _fetch_quotes(symbols: list[str]) -> dict[str, dict]:
    """Synchronous yahooquery fetch — runs in executor."""
    results: dict[str, dict] = {}
    if not symbols:
        return results

    try:
        t = Ticker(symbols, asynchronous=True)
        price_data = t.price
    except Exception as e:
        logger.warning(f"yahooquery batch fetch failed: {e}")
        return results

    if not isinstance(price_data, dict):
        return results

    for sym in symbols:
        try:
            p = price_data.get(sym)
            if not isinstance(p, dict):
                continue

            last = float(p.get("regularMarketPrice", 0) or 0)
            prev_close = float(p.get("regularMarketPreviousClose", 0) or 0)
            open_ = float(p.get("regularMarketOpen", 0) or 0)
            high = float(p.get("regularMarketDayHigh", 0) or 0)
            low = float(p.get("regularMarketDayLow", 0) or 0)
            volume = int(p.get("regularMarketVolume", 0) or 0)

            change = round(last - prev_close, 4) if prev_close else 0.0
            change_pct = round((change / prev_close) * 100, 4) if prev_close else 0.0

            results[sym] = {
                "symbol": sym,
                "last": last,
                "bid": 0.0,
                "ask": 0.0,
                "mid": last,
                "open": open_,
                "high": high,
                "low": low,
                "prevClose": prev_close,
                "change": change,
                "changePct": change_pct,
                "volume": volume,
                "spread": 0.0,
                "source": "yahoo",
            }
        except Exception as e:
            logger.warning(f"Yahoo parse failed for {sym}: {e}")

    return results


class YahooProvider:
    """Polls Yahoo Finance on an interval and emits ticks via callback."""

    def __init__(self):
        self._watchlist: list[str] = []
        self._quotes: dict[str, str] = {}  # quoteId -> symbol
        self._task: asyncio.Task | None = None
        self._tick_callback: Callable | None = None

    def set_tick_callback(self, cb: Callable):
        """cb(concern, key, symbol, data_dict) — same signature as IB on_tick."""
        self._tick_callback = cb

    def set_watchlist(self, symbols: list[str]):
        self._watchlist = [s for s in symbols if s]
        # Trigger an immediate fetch if running, so new symbols don't wait for next poll
        if self._task is not None and symbols:
            try:
                asyncio.get_running_loop().create_task(self._fetch_and_emit())
            except RuntimeError:
                pass

    def add_quote(self, quote_id: str, symbol: str):
        self._quotes[quote_id] = symbol
        if self._task is not None:
            try:
                asyncio.get_running_loop().create_task(self._fetch_and_emit())
            except RuntimeError:
                pass

    def remove_quote(self, quote_id: str):
        self._quotes.pop(quote_id, None)

    def start(self):
        if self._task is not None:
            return
        logger.info("Yahoo provider started")
        self._task = asyncio.get_running_loop().create_task(self._poll_loop())

    def stop(self):
        if self._task is None:
            return
        logger.info("Yahoo provider stopped")
        self._task.cancel()
        self._task = None

    @property
    def active(self) -> bool:
        return self._task is not None

    async def _poll_loop(self):
        try:
            while True:
                await self._fetch_and_emit()
                await asyncio.sleep(POLL_INTERVAL)
        except asyncio.CancelledError:
            pass

    async def _fetch_and_emit(self):
        # Collect all unique symbols
        all_symbols = set(self._watchlist)
        for sym in self._quotes.values():
            all_symbols.add(sym)

        if not all_symbols:
            return

        loop = asyncio.get_event_loop()
        quotes = await loop.run_in_executor(None, _fetch_quotes, list(all_symbols))

        if not self._tick_callback:
            return

        # Emit watchlist ticks
        for sym in self._watchlist:
            if sym in quotes:
                self._tick_callback("watchlist", None, sym, quotes[sym])

        # Emit quote card ticks
        for quote_id, sym in self._quotes.items():
            if sym in quotes:
                self._tick_callback("quote", quote_id, sym, quotes[sym])
