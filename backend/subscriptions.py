"""SubscriptionManager — allocates client IDs and manages market data subscriptions."""

import asyncio
import logging
from dataclasses import dataclass, field

from ib_insync import IB, Stock, Ticker

from connection_pool import ConnectionPool

logger = logging.getLogger(__name__)

WATCHLIST_BASE_ID = 1000
WATCHLIST_CAP = 20
QUOTE_BASE_ID = 2000


@dataclass
class WatchlistSlot:
    client_id: int
    symbols: set[str] = field(default_factory=set)
    tickers: dict[str, Ticker] = field(default_factory=dict)


@dataclass
class QuoteSlot:
    client_id: int
    quote_id: str
    symbol: str | None = None
    ticker: Ticker | None = None


class SubscriptionManager:
    def __init__(self, pool: ConnectionPool):
        self._pool = pool
        self._watchlist_slots: list[WatchlistSlot] = []
        self._quote_slots: dict[str, QuoteSlot] = {}  # quoteId -> QuoteSlot
        self._next_quote_id_counter = 0
        self._tick_callback: callable | None = None

    def set_tick_callback(self, cb):
        """Set callback: cb(concern, key, symbol, ticker) called on each tick."""
        self._tick_callback = cb

    # ── Watchlist ──────────────────────────────────────────────────────

    async def update_watchlist(self, symbols: list[str]):
        """Diff-based update: receives full symbol list, computes adds/removes."""
        desired = set(symbols)
        current = set()
        for slot in self._watchlist_slots:
            current |= slot.symbols

        to_add = desired - current
        to_remove = current - desired

        # Remove symbols
        for sym in to_remove:
            await self._watchlist_unsub(sym)

        # Add symbols
        for sym in to_add:
            await self._watchlist_sub(sym)

        # Disconnect empty slots
        empty_slots = [s for s in self._watchlist_slots if not s.symbols]
        for slot in empty_slots:
            await self._pool.disconnect(slot.client_id)
            self._watchlist_slots.remove(slot)

    async def _watchlist_sub(self, symbol: str):
        """Subscribe a single symbol, finding or creating a slot with capacity."""
        slot = self._find_watchlist_slot()
        if not slot:
            slot = await self._create_watchlist_slot()

        try:
            ib = await self._pool.get_or_create(slot.client_id)
            contract = Stock(symbol, "SMART", "USD")
            ticker = ib.reqMktData(contract, genericTickList="", snapshot=False)
            ticker.updateEvent += lambda t: self._on_watchlist_tick(symbol, t)
            slot.symbols.add(symbol)
            slot.tickers[symbol] = ticker
            logger.info(
                f"Watchlist sub: {symbol} on client {slot.client_id} "
                f"({len(slot.symbols)}/{WATCHLIST_CAP})"
            )
        except Exception as e:
            logger.error(f"Failed to subscribe watchlist {symbol}: {e}")

    async def _watchlist_unsub(self, symbol: str):
        """Unsubscribe a single watchlist symbol."""
        for slot in self._watchlist_slots:
            if symbol in slot.symbols:
                ib = self._pool.get_client(slot.client_id)
                ticker = slot.tickers.pop(symbol, None)
                if ib and ticker and ib.isConnected():
                    ib.cancelMktData(ticker.contract)
                slot.symbols.discard(symbol)
                logger.info(f"Watchlist unsub: {symbol} from client {slot.client_id}")
                return

    def _find_watchlist_slot(self) -> WatchlistSlot | None:
        for slot in self._watchlist_slots:
            if len(slot.symbols) < WATCHLIST_CAP:
                return slot
        return None

    async def _create_watchlist_slot(self) -> WatchlistSlot:
        client_id = WATCHLIST_BASE_ID + len(self._watchlist_slots)
        slot = WatchlistSlot(client_id=client_id)
        self._watchlist_slots.append(slot)
        return slot

    def _on_watchlist_tick(self, symbol: str, ticker: Ticker):
        if self._tick_callback:
            self._tick_callback("watchlist", None, symbol, ticker)

    # ── Quote cards ───────────────────────────────────────────────────

    async def quote_subscribe(self, quote_id: str, symbol: str):
        """Subscribe a QuoteCard to a symbol. Each QuoteCard gets its own client ID."""
        # If this quoteId already exists, change its symbol
        if quote_id in self._quote_slots:
            slot = self._quote_slots[quote_id]
            if slot.symbol == symbol:
                return  # Already subscribed to this symbol
            # Cancel old subscription
            await self._quote_cancel_ticker(slot)
            slot.symbol = symbol
        else:
            client_id = QUOTE_BASE_ID + self._next_quote_id_counter
            self._next_quote_id_counter += 1
            slot = QuoteSlot(client_id=client_id, quote_id=quote_id, symbol=symbol)
            self._quote_slots[quote_id] = slot

        try:
            ib = await self._pool.get_or_create(slot.client_id)
            contract = Stock(symbol, "SMART", "USD")
            ticker = ib.reqMktData(contract, genericTickList="", snapshot=False)
            ticker.updateEvent += lambda t: self._on_quote_tick(quote_id, symbol, t)
            slot.ticker = ticker
            logger.info(f"Quote sub: {quote_id} -> {symbol} on client {slot.client_id}")
        except Exception as e:
            logger.error(f"Failed to subscribe quote {quote_id} {symbol}: {e}")

    async def quote_unsubscribe(self, quote_id: str):
        """Unsubscribe and disconnect a QuoteCard's client ID."""
        slot = self._quote_slots.pop(quote_id, None)
        if not slot:
            return
        await self._quote_cancel_ticker(slot)
        await self._pool.disconnect(slot.client_id)
        logger.info(f"Quote unsub: {quote_id}, disconnected client {slot.client_id}")

    async def _quote_cancel_ticker(self, slot: QuoteSlot):
        if slot.ticker:
            ib = self._pool.get_client(slot.client_id)
            if ib and ib.isConnected():
                ib.cancelMktData(slot.ticker.contract)
            slot.ticker = None

    def _on_quote_tick(self, quote_id: str, symbol: str, ticker: Ticker):
        if self._tick_callback:
            self._tick_callback("quote", quote_id, symbol, ticker)

    # ── Current state (for provider switching) ───────────────────────

    def get_watchlist_symbols(self) -> list[str]:
        """Return all currently subscribed watchlist symbols."""
        symbols = []
        for slot in self._watchlist_slots:
            symbols.extend(slot.symbols)
        return symbols

    def get_quote_subscriptions(self) -> dict[str, str]:
        """Return {quoteId: symbol} for all active quote subscriptions."""
        return {
            qid: slot.symbol
            for qid, slot in self._quote_slots.items()
            if slot.symbol
        }

    # ── Resubscribe after reconnect ───────────────────────────────────

    async def resubscribe_all(self):
        """Re-establish all subscriptions (call after reconnect)."""
        # Watchlist
        all_symbols = []
        for slot in self._watchlist_slots:
            all_symbols.extend(slot.symbols)
        # Clear old state
        self._watchlist_slots.clear()
        if all_symbols:
            await self.update_watchlist(all_symbols)

        # Quotes
        old_quotes = list(self._quote_slots.items())
        self._quote_slots.clear()
        self._next_quote_id_counter = 0
        for quote_id, slot in old_quotes:
            if slot.symbol:
                await self.quote_subscribe(quote_id, slot.symbol)
