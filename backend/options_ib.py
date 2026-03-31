"""TWS / ib_insync options chain fetch for US equity options (OPT on SMART).

Runs synchronously (typically via asyncio.to_thread from the options collector).
"""

from __future__ import annotations

import json
import logging
import math
import os
import socket
import time
from datetime import datetime
from typing import Any

from zoneinfo import ZoneInfo

logger = logging.getLogger("options-ib")

DEFAULT_TWS_HOST = "127.0.0.1"
DEFAULT_TWS_PORTS = (7497, 7496)
OPTIONS_IB_CLIENT_ID_BASE = int(os.environ.get("DAILYIQ_OPTIONS_IB_CLIENT_ID", "9210"))
OPTIONS_IB_CLIENT_ID_TRIES = 8
MAX_EXPIRIES = 4
STRIKES_BELOW = 10
STRIKES_ABOVE = 10
GENERIC_TICKS = "100,101,106"
BATCH_SIZE = 22
UNDERLYING_MKT_SLEEP_S = 2.0
OPTION_BATCH_SLEEP_S = 4.0
CONNECT_TIMEOUT_S = 15

_MARKET_TZ = ZoneInfo("America/New_York")


def _data_dir() -> Any:
    from runtime_paths import data_dir

    return data_dir()


def resolve_tws_endpoint() -> tuple[str, tuple[int, ...]]:
    """Host and port probe order: settings file, then defaults."""
    host = os.environ.get("DAILYIQ_TWS_HOST", DEFAULT_TWS_HOST)
    ports_list = list(DEFAULT_TWS_PORTS)
    path = _data_dir() / "tws-settings.json"
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            host = str(data.get("host") or host)
            p = data.get("port")
            if p is not None:
                pi = int(p)
                ports_list = [pi] + [x for x in ports_list if x != pi]
        except Exception as exc:
            logger.debug("Could not read tws-settings.json: %s", exc)
    return host, tuple(ports_list)


def probe_tws_tcp(host: str, ports: tuple[int, ...], timeout: float = 2.0) -> int | None:
    for port in ports:
        try:
            with socket.create_connection((host, port), timeout=timeout) as s:
                s.close()
            return port
        except OSError:
            continue
    return None


def tws_tcp_reachable() -> tuple[bool, str | None, int | None]:
    host, ports = resolve_tws_endpoint()
    port = probe_tws_tcp(host, ports)
    if port is None:
        return False, None, None
    return True, host, port


def _normalize_expiry(expiry: str) -> str:
    return str(expiry).strip()


def filter_upcoming_expiries(expiries: list[str] | set[str], count: int = MAX_EXPIRIES) -> list[str]:
    if not expiries:
        return []
    today = datetime.now(_MARKET_TZ).strftime("%Y%m%d")
    cleaned = sorted(set(_normalize_expiry(e) for e in expiries if e))
    upcoming: list[str] = []
    for e in cleaned:
        compare_key = e + "31" if len(e) == 6 else e
        if compare_key >= today:
            upcoming.append(e)
    if upcoming:
        return upcoming[:count]
    return cleaned[:count]


def yyyymmdd_to_expiration_ms(expiry: str) -> int | None:
    s = _normalize_expiry(expiry)
    if len(s) >= 8:
        y, m, d = int(s[:4]), int(s[4:6]), int(s[6:8])
        dt = datetime(y, m, d, 0, 0, 0, tzinfo=ZoneInfo("UTC"))
        return int(dt.timestamp() * 1000)
    return None


def _contract_id_for_ib(c: Any) -> str:
    ls = getattr(c, "localSymbol", None) or ""
    ls = str(ls).strip()
    if ls and len(ls) >= 12:
        return ls
    con_id = getattr(c, "conId", None)
    if con_id:
        return f"IB:{int(con_id)}"
    return f"IB:{id(c)}"


def _extract_greeks(t: Any) -> dict[str, Any]:
    def _pick(field: str):
        bid = getattr(getattr(t, "bidGreeks", None), field, None)
        ask = getattr(getattr(t, "askGreeks", None), field, None)
        mdl = getattr(getattr(t, "modelGreeks", None), field, None)
        if bid is not None and ask is not None:
            try:
                if not (isinstance(bid, float) and math.isnan(bid)) and not (
                    isinstance(ask, float) and math.isnan(ask)
                ):
                    return (float(bid) + float(ask)) / 2.0
            except (TypeError, ValueError):
                pass
        if bid is not None:
            return bid
        if ask is not None:
            return ask
        return mdl

    und_bid = getattr(getattr(t, "bidGreeks", None), "undPrice", None)
    und_ask = getattr(getattr(t, "askGreeks", None), "undPrice", None)
    und_mdl = getattr(getattr(t, "modelGreeks", None), "undPrice", None)
    if und_bid is not None and und_ask is not None:
        try:
            und_price = (float(und_bid) + float(und_ask)) / 2.0
        except (TypeError, ValueError):
            und_price = und_bid or und_ask or und_mdl
    else:
        und_price = und_bid if und_bid is not None else (und_ask if und_ask is not None else und_mdl)

    return {
        "delta": _pick("delta"),
        "gamma": _pick("gamma"),
        "vega": _pick("vega"),
        "theta": _pick("theta"),
        "iv": _pick("impliedVol"),
        "undPrice": und_price,
    }


def _underlying_ltp(ib: Any, stock: Any) -> float | None:
    t = ib.reqMktData(stock, "", False, False)
    ib.sleep(UNDERLYING_MKT_SLEEP_S)
    ltp = t.last
    if ltp is None or (isinstance(ltp, float) and (math.isnan(ltp) or ltp <= 0)):
        ltp = t.close
    if ltp is None or (isinstance(ltp, float) and (math.isnan(ltp) or ltp <= 0)):
        bid, ask = t.bid, t.ask
        if bid is not None and ask is not None and bid > 0 and ask > 0:
            ltp = (bid + ask) / 2.0
        elif bid is not None and bid > 0:
            ltp = bid
        elif ask is not None and ask > 0:
            ltp = ask
    try:
        ib.cancelMktData(stock)
    except Exception:
        pass
    if ltp is None or (isinstance(ltp, float) and math.isnan(ltp)) or ltp == 0:
        return None
    return float(ltp)


def _pick_strike_window(contracts: list[Any], ltp: float | None) -> list[Any]:
    if not contracts:
        return []
    uniq: dict[Any, Any] = {}
    for c in contracts:
        key = getattr(c, "conId", None) or (c.symbol, c.lastTradeDateOrContractMonth, c.strike, c.right)
        uniq[key] = c
    sorted_c = sorted(uniq.values(), key=lambda x: float(x.strike))
    if ltp is None or ltp <= 0:
        mid = len(sorted_c) // 2
        lo = max(0, mid - STRIKES_BELOW)
        hi = min(len(sorted_c), mid + STRIKES_ABOVE + 1)
        return sorted_c[lo:hi]
    lower = [c for c in sorted_c if float(c.strike) < float(ltp)]
    upper = [c for c in sorted_c if float(c.strike) >= float(ltp)]
    return lower[-STRIKES_BELOW:] + upper[:STRIKES_ABOVE]


def collect_tws_option_chain_sync(
    symbol: str,
    captured_at_ms: int,
    host: str,
    port: int,
    risk_free_rate: float,
) -> tuple[list[tuple[Any, ...]], list[tuple[Any, ...]], int]:
    """Fetch option chain via TWS; returns DB row tuples. Empty lists on failure."""
    from ib_insync import IB, Option, Stock

    # Lazy import to avoid circular import with options_collector
    from options_collector import (
        calculate_option_metrics,
        _clean_text,
        _normalize_provider_iv,
        _normalize_symbol,
        _safe_float,
        _safe_int,
    )

    sym = _normalize_symbol(symbol)
    if not sym:
        return [], [], 0

    ib: Any = None
    all_tickers: list[Any] = []
    connected = False
    try:
        ib = IB()
        for offset in range(OPTIONS_IB_CLIENT_ID_TRIES):
            cid = OPTIONS_IB_CLIENT_ID_BASE + offset
            try:
                ib.connect(host, port, clientId=cid, readonly=True, timeout=CONNECT_TIMEOUT_S)
                connected = True
                break
            except Exception as exc:
                err = str(exc).lower()
                if "326" in err or "in use" in err or "client id" in err:
                    logger.debug("TWS clientId %s busy, trying next", cid)
                    continue
                logger.warning("TWS connect failed for options (%s:%s): %s", host, port, exc)
                return [], [], 0
        if not connected:
            logger.warning("Exhausted TWS client IDs for options collector")
            return [], [], 0

        ib.reqMarketDataType(1)

        stock = Stock(sym, "SMART", "USD")
        ib.qualifyContracts(stock)
        if not stock.conId:
            logger.warning("Could not qualify underlying %s", sym)
            return [], [], 0

        chains = ib.reqSecDefOptParams(sym, "", "STK", stock.conId)
        chain = next((c for c in chains if c.exchange == "SMART"), None)
        if not chain:
            logger.warning("No SMART option chain for %s", sym)
            return [], [], 0

        expiries = filter_upcoming_expiries(chain.expirations, MAX_EXPIRIES)
        if not expiries:
            logger.warning("No upcoming expiries for %s", sym)
            return [], [], 0

        ltp = _underlying_ltp(ib, stock)
        trading_class = getattr(chain, "tradingClass", sym) or sym
        multiplier = getattr(chain, "multiplier", "100") or "100"

        contract_rows: list[tuple[Any, ...]] = []
        snapshot_rows: list[tuple[Any, ...]] = []
        expiration_ms_seen: set[int] = set()

        for expiry in expiries:
            expiration_ms = yyyymmdd_to_expiration_ms(expiry)
            if expiration_ms is None:
                continue

            for right in ("C", "P"):
                option_type = "call" if right == "C" else "put"
                probe = Option(
                    symbol=sym,
                    lastTradeDateOrContractMonth=expiry,
                    strike=0.0,
                    right=right,
                    exchange="SMART",
                    currency="USD",
                    multiplier=str(multiplier),
                    tradingClass=trading_class,
                )
                try:
                    details = ib.reqContractDetails(probe)
                except Exception as exc:
                    logger.warning("reqContractDetails failed %s %s %s: %s", sym, expiry, right, exc)
                    continue

                valid: list[Any] = []
                for d in details or []:
                    c = d.contract
                    if (
                        c.symbol == sym
                        and str(c.lastTradeDateOrContractMonth) == str(expiry)
                        and c.right == right
                    ):
                        valid.append(c)
                if not valid:
                    continue

                qualified = _pick_strike_window(valid, ltp)
                if not qualified:
                    continue

                for i in range(0, len(qualified), BATCH_SIZE):
                    batch = qualified[i : i + BATCH_SIZE]
                    tickers = [ib.reqMktData(c, GENERIC_TICKS, False, False) for c in batch]
                    all_tickers.extend(tickers)
                    ib.sleep(OPTION_BATCH_SLEEP_S)

                    for c, t in zip(batch, tickers):
                        bid = _safe_float(getattr(t, "bid", None))
                        ask = _safe_float(getattr(t, "ask", None))
                        last_price = _safe_float(getattr(t, "last", None))
                        mid = None
                        if bid is not None and ask is not None and bid > 0 and ask > 0:
                            mid = round((bid + ask) / 2.0, 8)

                        vol = getattr(t, "optionVolume", None)
                        if vol is None:
                            vol = getattr(t, "volume", None)
                        oi = getattr(t, "openInterest", None)
                        if oi is None:
                            oi = getattr(t, "callOpenInterest", None) or getattr(t, "putOpenInterest", None)

                        g = _extract_greeks(t)
                        spot = ltp if ltp is not None else _safe_float(g.get("undPrice"))

                        itm = None
                        if spot is not None and c.strike is not None:
                            k = float(c.strike)
                            if option_type == "call":
                                itm = 1 if spot > k else 0
                            else:
                                itm = 1 if spot < k else 0

                        metrics = calculate_option_metrics(
                            option_type=option_type,
                            underlying_price=spot,
                            strike=_safe_float(c.strike),
                            expiration_ms=expiration_ms,
                            captured_at_ms=captured_at_ms,
                            bid=bid,
                            ask=ask,
                            mid=mid,
                            last_price=last_price,
                            provider_iv=_normalize_provider_iv(g.get("iv")),
                            provider_delta=_safe_float(g.get("delta")),
                            provider_gamma=_safe_float(g.get("gamma")),
                            provider_theta=_safe_float(g.get("theta")),
                            provider_vega=_safe_float(g.get("vega")),
                            provider_rho=None,
                            risk_free_rate=risk_free_rate,
                        )

                        cid = _contract_id_for_ib(c)
                        exch = _clean_text(getattr(c, "exchange", None))
                        contract_rows.append(
                            (
                                cid,
                                sym,
                                expiration_ms,
                                float(c.strike),
                                option_type,
                                "REGULAR",
                                "USD",
                                exch,
                                None,
                                captured_at_ms,
                                captured_at_ms,
                            )
                        )
                        snapshot_rows.append(
                            (
                                cid,
                                captured_at_ms,
                                spot,
                                bid,
                                ask,
                                _safe_int(getattr(t, "bidSize", None)),
                                _safe_int(getattr(t, "askSize", None)),
                                mid,
                                last_price,
                                None,
                                None,
                                _safe_int(vol),
                                _safe_int(oi),
                                metrics.implied_volatility,
                                (1 if itm else 0) if itm is not None else 0,
                                None,
                                metrics.delta,
                                metrics.gamma,
                                metrics.theta,
                                metrics.vega,
                                metrics.rho,
                                metrics.intrinsic_value,
                                metrics.extrinsic_value,
                                metrics.days_to_expiration,
                                metrics.risk_free_rate,
                                metrics.greeks_source,
                                metrics.iv_source,
                                metrics.calc_error,
                                "tws",
                            )
                        )
                        expiration_ms_seen.add(expiration_ms)

        return contract_rows, snapshot_rows, len(expiration_ms_seen)

    except Exception as exc:
        logger.warning("TWS options fetch failed for %s: %s", sym, exc)
        return [], [], 0
    finally:
        if ib is not None:
            try:
                for tkr in all_tickers:
                    c = getattr(tkr, "contract", None)
                    if c is not None:
                        ib.cancelMktData(c)
            except Exception:
                pass
            if ib.isConnected():
                try:
                    ib.disconnect()
                except Exception:
                    pass
