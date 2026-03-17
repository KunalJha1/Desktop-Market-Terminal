"""DailyIQ Sidecar — FastAPI + ib_insync market data server.

Data priority: TWS (when connected) > Yahoo Finance (fallback).
The frontend sends tws_status messages so the sidecar knows which provider to use.
"""

import argparse
import asyncio
import json
import logging
import math
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from ib_insync import Ticker, util

from connection_pool import ConnectionPool
from subscriptions import SubscriptionManager
from yahoo_provider import YahooProvider
from historical import get_historical_bars, save_realtime_bar
from prefetch import Prefetcher

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("sidecar")

# ── Global state ──────────────────────────────────────────────────────

active_ws: WebSocket | None = None
pending_ticks: dict[str, dict] = {}  # key -> latest tick data
TICK_FLUSH_INTERVAL = 0.25  # 250ms throttle

pool: ConnectionPool | None = None
subs: SubscriptionManager | None = None
yahoo: YahooProvider | None = None
prefetcher: Prefetcher | None = None
flush_task: asyncio.Task | None = None
tws_connected: bool = False

# Desired subscriptions — tracked independently of provider so we can switch
desired_watchlist: list[str] = []
desired_quotes: dict[str, str] = {}  # quoteId -> symbol

# Real-time bar subscriptions: symbol -> set of barSize strings
realtime_bar_subs: dict[str, set[str]] = {}
realtime_bar_tickers: dict[str, object] = {}  # symbol -> ib_insync RealTimeBarList


def _safe(v) -> float | None:
    """Convert ib_insync values (which may be nan or None) to JSON-safe floats."""
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def ticker_to_quote(symbol: str, t: Ticker) -> dict:
    last = _safe(t.last) or _safe(t.close) or 0.0
    bid = _safe(t.bid) or 0.0
    ask = _safe(t.ask) or 0.0
    mid = round((bid + ask) / 2, 4) if bid and ask else last
    open_ = _safe(t.open) or 0.0
    high = _safe(t.high) or 0.0
    low = _safe(t.low) or 0.0
    close = _safe(t.close) or 0.0
    volume = _safe(t.volume) or 0
    change = round(last - close, 4) if close else 0.0
    change_pct = round((change / close) * 100, 4) if close else 0.0
    spread = round(ask - bid, 4) if bid and ask else 0.0

    return {
        "symbol": symbol,
        "last": last,
        "bid": bid,
        "ask": ask,
        "mid": mid,
        "open": open_,
        "high": high,
        "low": low,
        "prevClose": close,
        "change": change,
        "changePct": change_pct,
        "volume": volume,
        "spread": spread,
        "source": "tws",
    }


def on_ib_tick(concern: str, key: str | None, symbol: str, ticker: Ticker):
    """Aggregates IB ticks into pending_ticks for throttled flushing."""
    data = ticker_to_quote(symbol, ticker)
    _queue_tick(concern, key, symbol, data)


def on_yahoo_tick(concern: str, key: str | None, symbol: str, data: dict):
    """Aggregates Yahoo ticks into pending_ticks for throttled flushing."""
    _queue_tick(concern, key, symbol, data)


def _queue_tick(concern: str, key: str | None, symbol: str, data: dict):
    """Shared tick queueing for both providers."""
    if concern == "watchlist":
        pending_ticks[f"wl:{symbol}"] = {
            "type": "watchlist_tick",
            "symbol": symbol,
            "data": data,
        }
    elif concern == "quote" and key:
        pending_ticks[f"qt:{key}"] = {
            "type": "quote_tick",
            "quoteId": key,
            "symbol": symbol,
            "data": data,
        }


def on_status_change(client_id: int, status: str):
    """Queue a connection_status message."""
    pending_ticks[f"status:{client_id}"] = {
        "type": "connection_status",
        "clientId": client_id,
        "status": status,
    }


async def flush_ticks():
    """Periodically flush aggregated ticks to the WebSocket client."""
    while True:
        await asyncio.sleep(TICK_FLUSH_INTERVAL)
        if not active_ws or not pending_ticks:
            continue
        batch = list(pending_ticks.values())
        pending_ticks.clear()
        for msg in batch:
            try:
                await active_ws.send_json(msg)
            except Exception:
                break


# ── Provider switching ────────────────────────────────────────────────

async def activate_tws():
    """Switch to TWS: stop Yahoo, re-subscribe via IB."""
    global tws_connected
    tws_connected = True
    yahoo.stop()
    prefetcher.set_tws_state(True, pool)
    logger.info("Switching to TWS provider")

    # Re-subscribe everything through IB
    if desired_watchlist:
        try:
            await subs.update_watchlist(desired_watchlist)
        except Exception as e:
            logger.error(f"Failed to resubscribe watchlist via TWS: {e}")
    for qid, sym in desired_quotes.items():
        try:
            await subs.quote_subscribe(qid, sym)
        except Exception as e:
            logger.error(f"Failed to resubscribe quote {qid} via TWS: {e}")

    # Notify frontend
    pending_ticks["provider"] = {
        "type": "provider_status",
        "provider": "tws",
    }


async def activate_yahoo():
    """Switch to Yahoo: cancel IB subscriptions, start Yahoo polling."""
    global tws_connected
    tws_connected = False
    prefetcher.set_tws_state(False)
    logger.info("Switching to Yahoo Finance fallback")

    # Cancel IB subscriptions (they'll fail anyway if TWS is down)
    try:
        await subs.update_watchlist([])
        for qid in list(desired_quotes.keys()):
            await subs.quote_unsubscribe(qid)
    except Exception:
        pass  # TWS is down, these may fail

    # Configure Yahoo with the same subscriptions
    yahoo.set_watchlist(desired_watchlist)
    for qid, sym in desired_quotes.items():
        yahoo.add_quote(qid, sym)
    yahoo.start()

    # Notify frontend
    pending_ticks["provider"] = {
        "type": "provider_status",
        "provider": "yahoo",
    }


# ── App lifecycle ─────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global pool, subs, yahoo, prefetcher, flush_task
    pool = ConnectionPool(on_status_change=on_status_change)
    subs = SubscriptionManager(pool)
    subs.set_tick_callback(on_ib_tick)

    yahoo = YahooProvider()
    yahoo.set_tick_callback(on_yahoo_tick)

    prefetcher = Prefetcher()

    # Start ib_insync event loop integration
    util.patchAsyncio()

    flush_task = asyncio.ensure_future(flush_ticks())
    prefetcher.start()
    yield

    flush_task.cancel()
    prefetcher.stop()
    yahoo.stop()
    if pool:
        await pool.disconnect_all()


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    global active_ws
    await websocket.accept()
    active_ws = websocket
    logger.info("Frontend WebSocket connected")

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json(
                    {"type": "error", "message": "Invalid JSON", "code": "PARSE_ERROR"}
                )
                continue

            msg_type = msg.get("type")

            if msg_type == "connect":
                host = msg.get("host", "127.0.0.1")
                port = msg.get("port", 7497)
                pool.set_tws_address(host, port)
                logger.info(f"TWS address set to {host}:{port}")
                await websocket.send_json(
                    {"type": "connection_status", "clientId": 0, "status": "configured"}
                )

            elif msg_type == "tws_status":
                status = msg.get("status")
                logger.info(f"TWS status from frontend: {status}")
                if status == "connected" and not tws_connected:
                    await activate_tws()
                elif status == "disconnected" and tws_connected:
                    await activate_yahoo()
                elif status == "disconnected" and not tws_connected and not yahoo.active:
                    # First message — TWS was never up, start Yahoo
                    yahoo.set_watchlist(desired_watchlist)
                    for qid, sym in desired_quotes.items():
                        yahoo.add_quote(qid, sym)
                    yahoo.start()

            elif msg_type == "watchlist_subscribe":
                symbols = msg.get("symbols", [])
                logger.info(f"Watchlist subscribe: {symbols}")

                # Always track desired state
                desired_watchlist.clear()
                desired_watchlist.extend(symbols)

                # Update prefetcher so watchlist symbols get priority
                prefetcher.set_watchlist(symbols)

                if tws_connected:
                    # Route to TWS
                    try:
                        await subs.update_watchlist(symbols)
                    except Exception as e:
                        logger.warning(f"TWS watchlist failed, falling back to Yahoo: {e}")
                        await activate_yahoo()
                else:
                    # Route to Yahoo
                    yahoo.set_watchlist(symbols)
                    if not yahoo.active:
                        yahoo.start()

            elif msg_type == "quote_subscribe":
                quote_id = msg.get("quoteId")
                symbol = msg.get("symbol")
                if quote_id and symbol:
                    logger.info(f"Quote subscribe: {quote_id} -> {symbol}")
                    desired_quotes[quote_id] = symbol

                    if tws_connected:
                        try:
                            await subs.quote_subscribe(quote_id, symbol)
                        except Exception as e:
                            logger.warning(f"TWS quote sub failed, falling back to Yahoo: {e}")
                            await activate_yahoo()
                    else:
                        yahoo.add_quote(quote_id, symbol)
                        if not yahoo.active:
                            yahoo.start()

            elif msg_type == "quote_unsubscribe":
                quote_id = msg.get("quoteId")
                if quote_id:
                    logger.info(f"Quote unsubscribe: {quote_id}")
                    desired_quotes.pop(quote_id, None)

                    if tws_connected:
                        await subs.quote_unsubscribe(quote_id)
                    else:
                        yahoo.remove_quote(quote_id)

            elif msg_type == "historical_request":
                symbol = msg.get("symbol", "")
                request_id = msg.get("requestId", "")
                duration = msg.get("duration", "5 D")
                bar_size = msg.get("barSize", "1 min")
                logger.info(f"Historical request: {symbol} {duration} {bar_size} (id={request_id})")

                # Get an IB client for the fetch if TWS is up
                ib_client = None
                if tws_connected:
                    try:
                        ib_client = await pool.get_or_create(900)  # dedicated client for historical
                    except Exception:
                        ib_client = None

                try:
                    bars, source = await get_historical_bars(
                        symbol=symbol,
                        ib=ib_client,
                        tws_connected=tws_connected,
                        duration=duration,
                        bar_size=bar_size,
                    )
                    await websocket.send_json({
                        "type": "historical_data",
                        "requestId": request_id,
                        "symbol": symbol,
                        "bars": bars,
                        "source": source,
                        "count": len(bars),
                    })
                except Exception as e:
                    logger.error(f"Historical fetch error for {symbol}: {e}")
                    await websocket.send_json({
                        "type": "historical_error",
                        "requestId": request_id,
                        "symbol": symbol,
                        "error": str(e),
                    })

            elif msg_type == "realtime_bars_subscribe":
                symbol = msg.get("symbol", "")
                bar_size = msg.get("barSize", "1 min")
                logger.info(f"Realtime bars subscribe: {symbol}")

                if symbol not in realtime_bar_subs:
                    realtime_bar_subs[symbol] = set()
                realtime_bar_subs[symbol].add(bar_size)

                # Start real-time bar streaming if TWS is connected
                if tws_connected and symbol not in realtime_bar_tickers:
                    try:
                        from ib_insync import Stock
                        ib_client = await pool.get_or_create(901)  # dedicated client for RT bars
                        contract = Stock(symbol, "SMART", "USD")
                        rt_bars = ib_client.reqRealTimeBars(
                            contract, barSize=5, whatToShow="TRADES", useRTH=False
                        )
                        realtime_bar_tickers[symbol] = rt_bars

                        def on_rt_bar(bars, hasNewBar):
                            if not hasNewBar:
                                return
                            b = bars[-1]
                            ts_ms = int(b.time.timestamp() * 1000)
                            bar_data = {
                                "time": ts_ms,
                                "open": float(b.open_),
                                "high": float(b.high),
                                "low": float(b.low),
                                "close": float(b.close),
                                "volume": float(b.volume),
                            }
                            # Queue for WebSocket flush
                            pending_ticks[f"rt:{symbol}"] = {
                                "type": "realtime_bar",
                                "symbol": symbol,
                                **bar_data,
                            }
                            # Persist to DuckDB
                            save_realtime_bar(symbol, bar_data)

                        rt_bars.updateEvent += on_rt_bar
                        logger.info(f"Started realtime bars for {symbol}")
                    except Exception as e:
                        logger.error(f"Failed to start realtime bars for {symbol}: {e}")

            elif msg_type == "realtime_bars_unsubscribe":
                symbol = msg.get("symbol", "")
                logger.info(f"Realtime bars unsubscribe: {symbol}")
                realtime_bar_subs.pop(symbol, None)

                rt = realtime_bar_tickers.pop(symbol, None)
                if rt and tws_connected:
                    try:
                        ib_client = pool.get_client(901)
                        if ib_client and ib_client.isConnected():
                            ib_client.cancelRealTimeBars(rt)
                    except Exception:
                        pass

            else:
                await websocket.send_json(
                    {
                        "type": "error",
                        "message": f"Unknown message type: {msg_type}",
                        "code": "UNKNOWN_TYPE",
                    }
                )

    except WebSocketDisconnect:
        logger.info("Frontend WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        active_ws = None


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DailyIQ Sidecar")
    parser.add_argument("--port", type=int, default=18100, help="HTTP port")
    args = parser.parse_args()
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")
