"""Background worker: keeps watchlist_quotes updated via TWS or Yahoo fallback."""

from __future__ import annotations

import argparse
import asyncio
import logging
import math
import time
from typing import Dict, List

from ib_insync import IB, Stock, Ticker
from yahooquery import Ticker as YahooTicker

from db_utils import sync_db_session
from historical import get_historical_bars, save_realtime_bar, save_realtime_bar_1m, invalidate_yahoo_cache

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

logger = logging.getLogger("watchlist-worker")

WATCHLIST_REFRESH_S = 2.0
YAHOO_POLL_S = 5.0
TICK_THROTTLE_S = 1.0
ACTIVE_REFRESH_S = 3.0
ACTIVE_TTL_S = 120
STATUS_SUMMARY_S = 5.0

STATE_QUEUED = "queued"
STATE_SUBSCRIBED = "subscribed"
STATE_WAITING = "waiting_for_valid_quote"
STATE_LIVE = "live_quote_active"
STATE_ERROR = "subscription_error"
CLIENT_ID_SCAN_LIMIT = 10000


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

    return {
        "symbol": symbol,
        "last": last,
        "bid": 0.0,
        "ask": 0.0,
        "mid": last,
        "open": open_,
        "high": high,
        "low": low,
        "prev_close": prev_close,
        "change": change,
        "change_pct": change_pct,
        "volume": volume,
        "spread": 0.0,
        "source": "yahoo",
    }


def upsert_quote(q: dict) -> None:
    now_ms = int(time.time() * 1000)
    with sync_db_session() as conn:
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
                q["symbol"],
                q["last"],
                q["bid"],
                q["ask"],
                q["mid"],
                q["open"],
                q["high"],
                q["low"],
                q["prev_close"],
                q["change"],
                q["change_pct"],
                q["volume"],
                q["spread"],
                q["source"],
                now_ms,
            ),
        )


class ClientIdManager:
    def __init__(self, start: int, max_id: int = CLIENT_ID_SCAN_LIMIT):
        self._start = start
        self._max = max_id
        self._retired: set[int] = set()
        self._next = start

    def mark_in_use(self, client_id: int) -> None:
        self._retired.add(client_id)
        if client_id >= self._next:
            self._next = client_id + 1

    def next(self, preferred: int | None = None) -> int | None:
        if preferred is not None and preferred not in self._retired:
            return preferred
        candidate = max(self._next, self._start)
        while candidate <= self._max and candidate in self._retired:
            candidate += 1
        if candidate > self._max:
            return None
        self._next = candidate + 1
        return candidate


def _client_id_in_use(exc: Exception) -> bool:
    err = str(exc).lower()
    return "already in use" in err or "clientid" in err and "in use" in err or "326" in err


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
            "SELECT symbol FROM active_symbols WHERE last_requested >= ?",
            (cutoff_ms,),
        ).fetchall()
    return [r[0] for r in rows]


async def connect_ib(ib: IB, host: str, ports: List[int], client_id: int) -> bool:
    manager = ClientIdManager(client_id, CLIENT_ID_SCAN_LIMIT)
    ok, _ = await connect_ib_with_manager(ib, host, ports, client_id, manager)
    return ok


async def connect_ib_with_manager(
    ib: IB,
    host: str,
    ports: List[int],
    client_id: int,
    manager: ClientIdManager,
) -> tuple[bool, int]:
    candidate = manager.next(client_id)
    if candidate is None:
        logger.error("No available TWS clientId in manager range")
        return False, client_id

    while candidate is not None:
        for port in ports:
            try:
                await ib.connectAsync(host, port, clientId=candidate, readonly=True)
                if ib.isConnected():
                    try:
                        ib.reqMarketDataType(1)
                    except Exception as exc:
                        logger.debug(f"Failed to request live market data type: {exc}")
                    logger.info(f"Connected to TWS {host}:{port} (clientId={candidate})")
                    return True, candidate
            except Exception as exc:
                if _client_id_in_use(exc):
                    logger.warning(
                        f"TWS rejected clientId {candidate} (in use). Searching for next available ID."
                    )
                    manager.mark_in_use(candidate)
                    candidate = manager.next()
                    break
                logger.warning(f"TWS connect failed {host}:{port} (clientId={candidate}): {exc}")
        else:
            # Exhausted ports without a clientId-in-use signal; wait for reconnect loop.
            return False, candidate

    logger.error("Exhausted TWS clientId range while attempting to connect")
    return False, client_id


async def worker_loop(host: str, ports: List[int], client_id: int) -> None:
    ib = IB()
    client_id_mgr = ClientIdManager(client_id, CLIENT_ID_SCAN_LIMIT)
    current_client_id = client_id
    last_write: Dict[str, float] = {}
    tickers: Dict[str, Ticker] = {}
    watchlist: List[str] = []
    active_symbols: List[str] = []
    rt_bars: Dict[str, object] = {}
    current_1m: Dict[str, dict] = {}
    symbol_states: Dict[str, str] = {}

    def set_symbol_state(symbol: str, state: str, detail: str | None = None) -> None:
        if symbol_states.get(symbol) == state and detail is None:
            return
        symbol_states[symbol] = state
        asyncio.create_task(asyncio.to_thread(write_status, symbol, state, detail))

    def drop_symbol_state(symbol: str) -> None:
        symbol_states.pop(symbol, None)
        asyncio.create_task(asyncio.to_thread(delete_status, symbol))

    def subscribe_realtime(sym: str) -> None:
        existing = rt_bars.pop(sym, None)
        if existing and ib.isConnected():
            try:
                ib.cancelRealTimeBars(existing)
            except Exception:
                pass
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
        logger.info(
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

    async def refresh_watchlist():
        nonlocal watchlist
        while True:
            try:
                current = read_watchlist()
            except Exception as exc:
                logger.warning(f"Watchlist read failed: {exc}")
                current = []

            if current != watchlist:
                added = set(current) - set(watchlist)
                removed = set(watchlist) - set(current)
                watchlist = current
                await asyncio.to_thread(clear_statuses_not_in, watchlist)
                logger.info(
                    "Watchlist refresh: %s symbols total, +%s, -%s, symbols=%s",
                    len(watchlist),
                    len(added),
                    len(removed),
                    ",".join(watchlist) if watchlist else "(empty)",
                )

                for sym in removed:
                    t = tickers.pop(sym, None)
                    if t is not None and ib.isConnected():
                        try:
                            ib.cancelMktData(t.contract)
                        except Exception:
                            pass
                    drop_symbol_state(sym)
                    logger.info("Watchlist unsubscribed %s", sym)

                if not ib.isConnected():
                    for sym in added:
                        set_symbol_state(sym, STATE_QUEUED, "watchlist loaded before IB connection")
                        logger.info("Watchlist queued before connect %s", sym)

                if ib.isConnected():
                    for sym in added:
                        try:
                            contract = Stock(sym, "SMART", "USD")
                            t = ib.reqMktData(contract, genericTickList="", snapshot=False)
                            t.updateEvent += lambda ticker, s=sym: asyncio.create_task(on_tick(s, ticker))
                            tickers[sym] = t
                            set_symbol_state(sym, STATE_SUBSCRIBED, "subscribed after watchlist refresh")
                            set_symbol_state(sym, STATE_WAITING, "subscription active; waiting for first valid quote")
                            logger.info("Watchlist subscribed %s", sym)
                        except Exception as exc:
                            set_symbol_state(sym, STATE_ERROR, str(exc))
                            logger.warning(f"Failed to subscribe {sym}: {exc}")

            await asyncio.sleep(WATCHLIST_REFRESH_S)

    async def refresh_active_symbols():
        nonlocal active_symbols
        while True:
            try:
                current = read_active_symbols()
            except Exception as exc:
                logger.warning(f"Active symbols read failed: {exc}")
                current = []

            if current != active_symbols:
                added = set(current) - set(active_symbols)
                removed = set(active_symbols) - set(current)
                active_symbols = current

                for sym in removed:
                    bars = rt_bars.pop(sym, None)
                    current_1m.pop(sym, None)
                    if bars and ib.isConnected():
                        try:
                            ib.cancelRealTimeBars(bars)
                        except Exception:
                            pass

                if ib.isConnected():
                    for sym in added:
                        try:
                            subscribe_realtime(sym)
                        except Exception as exc:
                            logger.warning(f"Failed to start realtime bars for {sym}: {exc}")

            await asyncio.sleep(ACTIVE_REFRESH_S)

    async def status_summary_loop():
        while True:
            await asyncio.sleep(STATUS_SUMMARY_S)
            if not watchlist:
                continue
            waiting = [sym for sym in watchlist if symbol_states.get(sym) == STATE_WAITING]
            queued = [sym for sym in watchlist if symbol_states.get(sym) == STATE_QUEUED]
            live = [sym for sym in watchlist if symbol_states.get(sym) == STATE_LIVE]
            errors = [sym for sym in watchlist if symbol_states.get(sym) == STATE_ERROR]
            missing = [sym for sym in watchlist if sym not in tickers]
            logger.info(
                "Watchlist status summary: total=%s subscribed=%s live=%s waiting=%s queued=%s errors=%s missing_ticker=%s",
                len(watchlist),
                len(tickers),
                len(live),
                len(waiting),
                len(queued),
                len(errors),
                len(missing),
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
            await asyncio.sleep(YAHOO_POLL_S)
            if ib.isConnected():
                continue
            if not watchlist:
                continue
            try:
                t = YahooTicker(watchlist, asynchronous=True)
                price_data = t.price
                if isinstance(price_data, dict):
                    for sym in watchlist:
                        data = price_data.get(sym)
                        if isinstance(data, dict):
                            q = yahoo_to_quote(sym, data)
                            await asyncio.to_thread(upsert_quote, q)
            except Exception as exc:
                logger.warning(f"Yahoo poll failed: {exc}")

    async def backfill_loop():
        last_backfill: Dict[str, float] = {}
        while True:
            await asyncio.sleep(2.0)
            if not ib.isConnected():
                continue
            symbols = list(dict.fromkeys(watchlist + active_symbols))
            if not symbols:
                continue
            for sym in symbols:
                now = time.time()
                if now - last_backfill.get(sym, 0) < 300:
                    continue
                try:
                    await asyncio.to_thread(invalidate_yahoo_cache, [sym])
                    await get_historical_bars(
                        symbol=sym,
                        ib=ib,
                        tws_connected=True,
                        duration="5 D",
                        bar_size="1 min",
                    )
                    await get_historical_bars(
                        symbol=sym,
                        ib=ib,
                        tws_connected=True,
                        duration="5 D",
                        bar_size="1 min",
                        what_to_show="BID",
                    )
                    await get_historical_bars(
                        symbol=sym,
                        ib=ib,
                        tws_connected=True,
                        duration="5 D",
                        bar_size="1 min",
                        what_to_show="ASK",
                    )
                    await get_historical_bars(
                        symbol=sym,
                        ib=ib,
                        tws_connected=True,
                        duration="2 Y",
                        bar_size="1 day",
                    )
                    last_backfill[sym] = now
                except Exception as exc:
                    logger.debug(f"Backfill failed for {sym}: {exc}")

    async def reconnect_loop():
        nonlocal current_client_id
        while True:
            if not ib.isConnected():
                ok, new_id = await connect_ib_with_manager(
                    ib, host, ports, current_client_id, client_id_mgr
                )
                if ok:
                    current_client_id = new_id
                    if watchlist:
                        await asyncio.to_thread(invalidate_yahoo_cache, watchlist)
                    # Re-subscribe to current watchlist
                    for sym in watchlist:
                        try:
                            contract = Stock(sym, "SMART", "USD")
                            t = ib.reqMktData(contract, genericTickList="", snapshot=False)
                            t.updateEvent += lambda ticker, s=sym: asyncio.create_task(on_tick(s, ticker))
                            tickers[sym] = t
                            set_symbol_state(sym, STATE_SUBSCRIBED, "resubscribed after reconnect")
                            set_symbol_state(sym, STATE_WAITING, "resubscription active; waiting for first valid quote")
                            logger.info("Watchlist resubscribed %s", sym)
                        except Exception as exc:
                            set_symbol_state(sym, STATE_ERROR, str(exc))
                            logger.warning(f"Failed to resubscribe {sym}: {exc}")
                    # Re-subscribe realtime bars for active symbols
                    for sym in active_symbols:
                        try:
                            subscribe_realtime(sym)
                        except Exception as exc:
                            logger.warning(f"Failed to resubscribe realtime bars for {sym}: {exc}")
            await asyncio.sleep(2.0)

    ok, new_id = await connect_ib_with_manager(ib, host, ports, current_client_id, client_id_mgr)
    if ok:
        current_client_id = new_id

    await asyncio.gather(
        refresh_watchlist(),
        refresh_active_symbols(),
        status_summary_loop(),
        yahoo_loop(),
        backfill_loop(),
        reconnect_loop(),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Watchlist worker")
    parser.add_argument("--tws-host", default="127.0.0.1")
    parser.add_argument("--tws-port", type=int, default=0)
    parser.add_argument("--client-id", type=int, default=3)
    parser.add_argument("--client-id-max", type=int, default=CLIENT_ID_SCAN_LIMIT)
    args = parser.parse_args()

    ports = [args.tws_port] if args.tws_port else [7497, 7496]
    global CLIENT_ID_SCAN_LIMIT
    CLIENT_ID_SCAN_LIMIT = args.client_id_max
    asyncio.run(worker_loop(args.tws_host, ports, args.client_id))


if __name__ == "__main__":
    main()
