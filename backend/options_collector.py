from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import os
import time
from dataclasses import dataclass
from datetime import datetime, time as dt_time, timedelta
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from db_utils import execute_many_with_retry, sync_db_session
from runtime_paths import resource_path

logger = logging.getLogger("options-collector")

DEFAULT_INTERVAL_MINUTES = 60
DEFAULT_SOURCE = "auto"
DEFAULT_RISK_FREE_RATE = float(os.environ.get("DAILYIQ_OPTIONS_RISK_FREE_RATE", "0.045"))
TICKERS_PATH = resource_path("data", "tickers.json")
MARKET_TZ = ZoneInfo("America/New_York")
MARKET_OPEN = dt_time(hour=9, minute=30)
MARKET_CLOSE = dt_time(hour=16, minute=0)

def _get_brentq():
    try:
        from scipy.optimize import brentq  # type: ignore
        return brentq
    except Exception:
        return None


@dataclass
class OptionComputation:
    implied_volatility: float | None
    delta: float | None
    gamma: float | None
    theta: float | None
    vega: float | None
    rho: float | None
    greeks_source: str | None
    iv_source: str | None
    calc_error: str | None
    intrinsic_value: float | None
    extrinsic_value: float | None
    days_to_expiration: float | None
    risk_free_rate: float | None


def _now_ms() -> int:
    return int(time.time() * 1000)


def _market_now(now: datetime | None = None) -> datetime:
    current = now or datetime.now(MARKET_TZ)
    if current.tzinfo is None:
        return current.replace(tzinfo=MARKET_TZ)
    return current.astimezone(MARKET_TZ)


SESSION_REGULAR     = "REGULAR"
SESSION_PRE_MARKET  = "PRE_MARKET"
SESSION_AFTER_HOURS = "AFTER_HOURS"
SESSION_CLOSED      = "CLOSED"

PRE_MARKET_OPEN   = dt_time(hour=4,  minute=0)
AFTER_HOURS_CLOSE = dt_time(hour=20, minute=0)


def get_market_session(now: datetime | None = None) -> str:
    current = _market_now(now)
    if current.weekday() >= 5:
        return SESSION_CLOSED
    t = current.time()
    if MARKET_OPEN <= t < MARKET_CLOSE:
        return SESSION_REGULAR
    if MARKET_CLOSE <= t < AFTER_HOURS_CLOSE:
        return SESSION_AFTER_HOURS
    if PRE_MARKET_OPEN <= t < MARKET_OPEN:
        return SESSION_PRE_MARKET
    return SESSION_CLOSED


def is_regular_market_hours(now: datetime | None = None) -> bool:
    current = _market_now(now)
    if current.weekday() >= 5:
        return False
    current_time = current.time()
    return MARKET_OPEN <= current_time < MARKET_CLOSE


def seconds_until_next_market_open(now: datetime | None = None) -> float:
    current = _market_now(now)

    if current.weekday() < 5 and current.time() < MARKET_OPEN:
        next_open = current.replace(
            hour=MARKET_OPEN.hour,
            minute=MARKET_OPEN.minute,
            second=0,
            microsecond=0,
        )
    else:
        days_ahead = 1
        while True:
            candidate = current + timedelta(days=days_ahead)
            if candidate.weekday() < 5:
                next_open = candidate.replace(
                    hour=MARKET_OPEN.hour,
                    minute=MARKET_OPEN.minute,
                    second=0,
                    microsecond=0,
                )
                break
            days_ahead += 1

    return max((next_open - current).total_seconds(), 1.0)


def _format_symbol_list(symbols: list[str], *, limit: int = 12) -> str:
    if not symbols:
        return "(none)"
    if len(symbols) <= limit:
        return ", ".join(symbols)
    preview = ", ".join(symbols[:limit])
    return f"{preview}, ... (+{len(symbols) - limit} more)"


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    try:
        parsed = float(value)
    except Exception:
        return None
    if math.isnan(parsed) or math.isinf(parsed):
        return None
    return parsed


def _safe_int(value: Any) -> int | None:
    parsed = _safe_float(value)
    if parsed is None:
        return None
    return int(parsed)


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper()


def _load_enabled_ticker_symbols(path: Path = TICKERS_PATH) -> list[str]:
    try:
        with open(path, encoding="utf-8") as f:
            payload = json.load(f)
    except Exception as exc:
        logger.warning("Failed to load %s: %s", path, exc)
        return []

    symbols: list[str] = []
    for company in payload.get("companies", []):
        symbol = _normalize_symbol(str(company.get("symbol") or ""))
        if symbol and company.get("enabled", True):
            symbols.append(symbol)
    return symbols


def _load_portfolio_symbols() -> list[str]:
    from main import build_unified_portfolio_snapshot

    try:
        snapshot = build_unified_portfolio_snapshot()
    except Exception as exc:
        logger.warning("Failed to read portfolio snapshot: %s", exc)
        return []

    symbols: list[str] = []
    for position in snapshot.get("positions", []):
        sec_type = str(position.get("secType") or "STK").upper()
        if sec_type not in {"STK", "ETF"}:
            continue
        symbol = _normalize_symbol(str(position.get("symbol") or ""))
        if symbol:
            symbols.append(symbol)
    return symbols


def build_symbol_queue(
    portfolio_symbols: Iterable[str],
    watchlist_symbols: Iterable[str],
    ticker_symbols: Iterable[str],
) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()
    for symbol in [*portfolio_symbols, *watchlist_symbols, *ticker_symbols]:
        normalized = _normalize_symbol(symbol)
        if normalized and normalized not in seen:
            seen.add(normalized)
            ordered.append(normalized)
    return ordered


def load_symbol_queue() -> list[str]:
    from worker_watchlist import read_watchlist

    return build_symbol_queue(
        _load_portfolio_symbols(),
        read_watchlist(),
        _load_enabled_ticker_symbols(),
    )


def _parse_expiration_ms(value: Any) -> int | None:
    import pandas as pd

    if value is None:
        return None
    if isinstance(value, pd.Timestamp):
        ts = value.to_pydatetime().replace(tzinfo=None)
        return int(ts.timestamp() * 1000)
    if hasattr(value, "timestamp"):
        try:
            return int(value.timestamp() * 1000)
        except Exception:
            return None
    parsed = _safe_float(value)
    if parsed is None:
        text = _clean_text(value)
        if not text:
            return None
        try:
            return int(pd.Timestamp(text).timestamp() * 1000)
        except Exception:
            return None
    if parsed > 10_000_000_000:
        return int(parsed)
    return int(parsed * 1000)


def _normalize_provider_iv(value: Any) -> float | None:
    iv = _safe_float(value)
    if iv is None or iv <= 0:
        return None
    if iv > 1.0 and iv <= 100.0:
        return iv / 100.0
    return iv


def _pick_market_price(bid: float | None, ask: float | None, mid: float | None, last_price: float | None) -> float | None:
    for candidate in (mid, last_price, bid, ask):
        if candidate is not None and candidate > 0:
            return candidate
    return None


def _compute_intrinsic_value(option_type: str, spot: float, strike: float) -> float:
    if option_type == "call":
        return max(spot - strike, 0.0)
    return max(strike - spot, 0.0)


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _norm_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def _black_scholes_price(option_type: str, spot: float, strike: float, rate: float, time_years: float, sigma: float) -> float:
    if sigma <= 0 or time_years <= 0 or spot <= 0 or strike <= 0:
        return _compute_intrinsic_value(option_type, spot, strike)
    root_t = math.sqrt(time_years)
    d1 = (math.log(spot / strike) + (rate + 0.5 * sigma * sigma) * time_years) / (sigma * root_t)
    d2 = d1 - sigma * root_t
    if option_type == "call":
        return spot * _norm_cdf(d1) - strike * math.exp(-rate * time_years) * _norm_cdf(d2)
    return strike * math.exp(-rate * time_years) * _norm_cdf(-d2) - spot * _norm_cdf(-d1)


def _black_scholes_greeks(option_type: str, spot: float, strike: float, rate: float, time_years: float, sigma: float) -> tuple[float, float, float, float, float]:
    root_t = math.sqrt(time_years)
    d1 = (math.log(spot / strike) + (rate + 0.5 * sigma * sigma) * time_years) / (sigma * root_t)
    d2 = d1 - sigma * root_t
    pdf_d1 = _norm_pdf(d1)
    if option_type == "call":
        delta = _norm_cdf(d1)
        theta = (
            -(spot * pdf_d1 * sigma) / (2 * root_t)
            - rate * strike * math.exp(-rate * time_years) * _norm_cdf(d2)
        ) / 365.0
        rho = strike * time_years * math.exp(-rate * time_years) * _norm_cdf(d2) / 100.0
    else:
        delta = _norm_cdf(d1) - 1.0
        theta = (
            -(spot * pdf_d1 * sigma) / (2 * root_t)
            + rate * strike * math.exp(-rate * time_years) * _norm_cdf(-d2)
        ) / 365.0
        rho = -strike * time_years * math.exp(-rate * time_years) * _norm_cdf(-d2) / 100.0
    gamma = pdf_d1 / (spot * sigma * root_t)
    vega = spot * pdf_d1 * root_t / 100.0
    return delta, gamma, theta, vega, rho


def _solve_implied_volatility(
    option_type: str,
    market_price: float,
    spot: float,
    strike: float,
    rate: float,
    time_years: float,
) -> float:
    def objective(vol: float) -> float:
        return _black_scholes_price(option_type, spot, strike, rate, time_years, vol) - market_price

    lower = 1e-6
    upper = 5.0
    brentq = _get_brentq()
    if brentq is not None:
        try:
            return float(brentq(objective, lower, upper, maxiter=200))
        except Exception:
            # Deep ITM fallback: return lower bound if it gives the closer price
            f_lo = objective(lower)
            f_hi = objective(upper)
            if abs(f_lo) < abs(f_hi):
                return lower
            raise

    lo = lower
    hi = upper
    f_lo = objective(lo)
    f_hi = objective(hi)
    if f_lo == 0:
        return lo
    if f_hi == 0:
        return hi
    if f_lo * f_hi > 0:
        # Deep ITM case: market price ≈ intrinsic value, so extrinsic ≈ 0.
        # BS price at near-zero vol already ≈ intrinsic, so both f_lo and f_hi
        # are positive and bracketing fails.  Return a very small IV so that
        # Black-Scholes greeks (especially delta near ±1) can still be computed.
        if abs(f_lo) < abs(f_hi):
            return lo  # lower bound (1e-6) gives the closest price match
        raise ValueError("Unable to bracket implied volatility")
    for _ in range(200):
        mid = (lo + hi) / 2.0
        f_mid = objective(mid)
        if abs(f_mid) < 1e-8:
            return mid
        if f_lo * f_mid <= 0:
            hi = mid
            f_hi = f_mid
        else:
            lo = mid
            f_lo = f_mid
    return (lo + hi) / 2.0


def estimate_option_price(
    *,
    option_type: str,
    spot: float,
    strike: float,
    iv: float,
    rate: float,
    dte_days: float,
) -> dict:
    """Estimate option price and greeks using Black-Scholes with updated spot and adjusted DTE."""
    dte_years = max(dte_days / 365.0, 1e-6)
    try:
        price = _black_scholes_price(option_type, spot, strike, rate, dte_years, iv)
        delta, gamma, theta, vega, rho = _black_scholes_greeks(option_type, spot, strike, rate, dte_years, iv)
        return {
            "estPrice": round(price, 4),
            "estDelta": round(delta, 4),
            "estGamma": round(gamma, 6),
            "estTheta": round(theta, 4),
            "estVega":  round(vega, 4),
            "error": None,
        }
    except Exception as e:
        return {"estPrice": None, "estDelta": None, "estGamma": None,
                "estTheta": None, "estVega": None, "error": str(e)}


def calculate_option_metrics(
    *,
    option_type: str,
    underlying_price: float | None,
    strike: float | None,
    expiration_ms: int | None,
    captured_at_ms: int,
    bid: float | None,
    ask: float | None,
    mid: float | None,
    last_price: float | None,
    provider_iv: float | None,
    provider_delta: float | None,
    provider_gamma: float | None,
    provider_theta: float | None,
    provider_vega: float | None,
    provider_rho: float | None,
    risk_free_rate: float = DEFAULT_RISK_FREE_RATE,
) -> OptionComputation:
    spot = underlying_price
    strike_price = strike
    if spot is None or strike_price is None or spot <= 0 or strike_price <= 0:
        return OptionComputation(
            implied_volatility=provider_iv,
            delta=provider_delta,
            gamma=provider_gamma,
            theta=provider_theta,
            vega=provider_vega,
            rho=provider_rho,
            greeks_source="provider" if any(v is not None for v in (provider_delta, provider_gamma, provider_theta, provider_vega, provider_rho)) else None,
            iv_source="provider" if provider_iv is not None else None,
            calc_error="missing_underlying_or_strike",
            intrinsic_value=None,
            extrinsic_value=None,
            days_to_expiration=None,
            risk_free_rate=risk_free_rate if provider_iv is not None else None,
        )

    intrinsic_value = _compute_intrinsic_value(option_type, spot, strike_price)
    market_price = _pick_market_price(bid, ask, mid, last_price)
    if expiration_ms is None:
        return OptionComputation(
            implied_volatility=provider_iv,
            delta=provider_delta,
            gamma=provider_gamma,
            theta=provider_theta,
            vega=provider_vega,
            rho=provider_rho,
            greeks_source="provider" if any(v is not None for v in (provider_delta, provider_gamma, provider_theta, provider_vega, provider_rho)) else None,
            iv_source="provider" if provider_iv is not None else None,
            calc_error="missing_expiration",
            intrinsic_value=intrinsic_value,
            extrinsic_value=(market_price - intrinsic_value) if market_price is not None else None,
            days_to_expiration=None,
            risk_free_rate=risk_free_rate if provider_iv is not None else None,
        )

    time_years = max((expiration_ms - captured_at_ms) / 1000.0 / 60.0 / 60.0 / 24.0 / 365.0, 0.0)
    days_to_expiration = max((expiration_ms - captured_at_ms) / 1000.0 / 60.0 / 60.0 / 24.0, 0.0)
    extrinsic_value = (market_price - intrinsic_value) if market_price is not None else None
    provider_has_all_greeks = all(
        value is not None
        for value in (provider_delta, provider_gamma, provider_theta, provider_vega, provider_rho)
    )
    if provider_iv is not None and provider_has_all_greeks:
        return OptionComputation(
            implied_volatility=provider_iv,
            delta=provider_delta,
            gamma=provider_gamma,
            theta=provider_theta,
            vega=provider_vega,
            rho=provider_rho,
            greeks_source="provider",
            iv_source="provider",
            calc_error=None,
            intrinsic_value=intrinsic_value,
            extrinsic_value=extrinsic_value,
            days_to_expiration=days_to_expiration,
            risk_free_rate=risk_free_rate,
        )

    if market_price is None or market_price <= 0:
        return OptionComputation(
            implied_volatility=provider_iv,
            delta=provider_delta,
            gamma=provider_gamma,
            theta=provider_theta,
            vega=provider_vega,
            rho=provider_rho,
            greeks_source="provider" if provider_has_all_greeks else None,
            iv_source="provider" if provider_iv is not None else None,
            calc_error="missing_market_price",
            intrinsic_value=intrinsic_value,
            extrinsic_value=extrinsic_value,
            days_to_expiration=days_to_expiration,
            risk_free_rate=risk_free_rate if provider_iv is not None or provider_has_all_greeks else None,
        )
    if time_years <= 0:
        return OptionComputation(
            implied_volatility=provider_iv,
            delta=provider_delta,
            gamma=provider_gamma,
            theta=provider_theta,
            vega=provider_vega,
            rho=provider_rho,
            greeks_source="provider" if provider_has_all_greeks else None,
            iv_source="provider" if provider_iv is not None else None,
            calc_error="expired_contract",
            intrinsic_value=intrinsic_value,
            extrinsic_value=extrinsic_value,
            days_to_expiration=days_to_expiration,
            risk_free_rate=risk_free_rate if provider_iv is not None or provider_has_all_greeks else None,
        )
    if market_price < intrinsic_value:
        return OptionComputation(
            implied_volatility=provider_iv,
            delta=provider_delta,
            gamma=provider_gamma,
            theta=provider_theta,
            vega=provider_vega,
            rho=provider_rho,
            greeks_source="provider" if provider_has_all_greeks else None,
            iv_source="provider" if provider_iv is not None else None,
            calc_error="price_below_intrinsic",
            intrinsic_value=intrinsic_value,
            extrinsic_value=extrinsic_value,
            days_to_expiration=days_to_expiration,
            risk_free_rate=risk_free_rate if provider_iv is not None or provider_has_all_greeks else None,
        )

    try:
        sigma = provider_iv or _solve_implied_volatility(
            option_type,
            market_price,
            spot,
            strike_price,
            risk_free_rate,
            time_years,
        )
        delta, gamma, theta, vega, rho = _black_scholes_greeks(
            option_type,
            spot,
            strike_price,
            risk_free_rate,
            time_years,
            sigma,
        )
    except Exception as exc:
        return OptionComputation(
            implied_volatility=provider_iv,
            delta=provider_delta,
            gamma=provider_gamma,
            theta=provider_theta,
            vega=provider_vega,
            rho=provider_rho,
            greeks_source="provider" if provider_has_all_greeks else None,
            iv_source="provider" if provider_iv is not None else None,
            calc_error=str(exc),
            intrinsic_value=intrinsic_value,
            extrinsic_value=extrinsic_value,
            days_to_expiration=days_to_expiration,
            risk_free_rate=risk_free_rate if provider_iv is not None or provider_has_all_greeks else None,
        )

    return OptionComputation(
        implied_volatility=sigma,
        delta=provider_delta if provider_delta is not None else delta,
        gamma=provider_gamma if provider_gamma is not None else gamma,
        theta=provider_theta if provider_theta is not None else theta,
        vega=provider_vega if provider_vega is not None else vega,
        rho=provider_rho if provider_rho is not None else rho,
        greeks_source="provider" if provider_has_all_greeks else "calculated",
        iv_source="provider" if provider_iv is not None else "calculated",
        calc_error=None,
        intrinsic_value=intrinsic_value,
        extrinsic_value=extrinsic_value,
        days_to_expiration=days_to_expiration,
        risk_free_rate=risk_free_rate,
    )


def normalize_option_chain_df(
    symbol: str,
    chain_df: pd.DataFrame,
    *,
    underlying_price: float | None,
    captured_at_ms: int,
    source: str,
    risk_free_rate: float = DEFAULT_RISK_FREE_RATE,
) -> tuple[list[tuple[Any, ...]], list[tuple[Any, ...]], int]:
    import pandas as pd

    if not isinstance(chain_df.index, pd.MultiIndex):
        raise ValueError("Expected yahooquery option_chain dataframe with a MultiIndex")

    contract_rows: list[tuple[Any, ...]] = []
    snapshot_rows: list[tuple[Any, ...]] = []
    expiration_values: set[int] = set()

    for idx, row in chain_df.iterrows():
        underlying = _normalize_symbol(str(idx[0] if isinstance(idx, tuple) else symbol))
        expiration_ms = _parse_expiration_ms(idx[1] if isinstance(idx, tuple) and len(idx) > 1 else row.get("expiration"))
        option_type = str(idx[2] if isinstance(idx, tuple) and len(idx) > 2 else row.get("optionType") or "").lower().rstrip("s")
        if option_type not in {"call", "put"}:
            continue

        contract_id = _clean_text(row.get("contractSymbol")) or _clean_text(row.get("contract_id"))
        strike = _safe_float(row.get("strike"))
        if not contract_id or strike is None or expiration_ms is None:
            continue

        bid = _safe_float(row.get("bid"))
        ask = _safe_float(row.get("ask"))
        last_price = _safe_float(row.get("lastPrice"))
        mid = None
        if bid is not None and ask is not None and bid > 0 and ask > 0:
            mid = round((bid + ask) / 2.0, 8)

        metrics = calculate_option_metrics(
            option_type=option_type,
            underlying_price=underlying_price,
            strike=strike,
            expiration_ms=expiration_ms,
            captured_at_ms=captured_at_ms,
            bid=bid,
            ask=ask,
            mid=mid,
            last_price=last_price,
            provider_iv=_normalize_provider_iv(row.get("impliedVolatility")),
            provider_delta=_safe_float(row.get("delta")),
            provider_gamma=_safe_float(row.get("gamma")),
            provider_theta=_safe_float(row.get("theta")),
            provider_vega=_safe_float(row.get("vega")),
            provider_rho=_safe_float(row.get("rho")),
            risk_free_rate=risk_free_rate,
        )

        contract_rows.append((
            contract_id,
            underlying,
            expiration_ms,
            strike,
            option_type,
            _clean_text(row.get("contractSize")) or "REGULAR",
            _clean_text(row.get("currency")) or "USD",
            _clean_text(row.get("exchange")),
            _clean_text(row.get("exerciseStyle")),
            captured_at_ms,
            captured_at_ms,
        ))
        snapshot_rows.append((
            contract_id,
            captured_at_ms,
            underlying_price,
            bid,
            ask,
            _safe_int(row.get("bidSize")),
            _safe_int(row.get("askSize")),
            mid,
            last_price,
            _safe_float(row.get("change")),
            _safe_float(row.get("percentChange")),
            _safe_int(row.get("volume")),
            _safe_int(row.get("openInterest")),
            metrics.implied_volatility,
            1 if bool(row.get("inTheMoney")) else 0,
            _parse_expiration_ms(row.get("lastTradeDate")),
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
            source,
        ))
        expiration_values.add(expiration_ms)

    return contract_rows, snapshot_rows, len(expiration_values)


class YahooOptionsProvider:
    source = "yahoo"

    def fetch_chain(self, symbol: str) -> tuple[pd.DataFrame, float | None]:
        from yahooquery import Ticker

        ticker = Ticker(symbol, asynchronous=False)
        chain_df = ticker.option_chain
        if isinstance(chain_df, str):
            raise ValueError(chain_df)
        price_payload = ticker.price
        underlying_price = None
        if isinstance(price_payload, dict):
            payload = price_payload.get(symbol) if symbol in price_payload else next(iter(price_payload.values()), {})
            if isinstance(payload, dict):
                underlying_price = _safe_float(payload.get("regularMarketPrice"))
        return chain_df, underlying_price


def _probe_tws_for_options_cycle() -> tuple[bool, str | None, int | None]:
    from options_ib import tws_tcp_reachable

    return tws_tcp_reachable()


def collect_symbol(
    provider: YahooOptionsProvider | None,
    symbol: str,
    *,
    captured_at_ms: int,
    risk_free_rate: float,
    source_mode: str,
    tws_reachable: bool,
    tws_host: str | None,
    tws_port: int | None,
) -> tuple[int, int]:
    """Collect one symbol. source_mode: auto | yahoo | tws."""
    from options_ib import collect_tws_option_chain_sync

    mode = (source_mode or DEFAULT_SOURCE).strip().lower()
    sym = _normalize_symbol(symbol)
    started_at = _now_ms()

    def _yahoo() -> tuple[int, int]:
        yahoo = provider or YahooOptionsProvider()
        return _collect_yahoo_symbol(yahoo, sym, captured_at_ms=captured_at_ms, risk_free_rate=risk_free_rate)

    if mode == "yahoo":
        return _yahoo()

    if mode == "tws":
        if not tws_reachable or tws_host is None or tws_port is None:
            duration_ms = _now_ms() - started_at
            _write_fetch_meta(sym, "tws", captured_at_ms, 0, 0, False, "TWS not reachable", duration_ms)
            logger.warning("Options source=tws but TWS not reachable for %s", sym)
            return 0, 0
        c_rows, s_rows, exp_count = collect_tws_option_chain_sync(
            sym, captured_at_ms, tws_host, tws_port, risk_free_rate
        )
        if c_rows and s_rows:
            _write_option_rows(c_rows, s_rows)
            duration_ms = _now_ms() - started_at
            _write_fetch_meta(
                sym, "tws", captured_at_ms, exp_count, len(s_rows), True, None, duration_ms
            )
            logger.info(
                "Stored %s options chain (tws): %s contracts across %s expirations in %sms",
                sym,
                len(s_rows),
                exp_count,
                duration_ms,
            )
            return exp_count, len(s_rows)
        duration_ms = _now_ms() - started_at
        _write_fetch_meta(
            sym, "tws", captured_at_ms, 0, 0, False, "TWS fetch returned no contracts", duration_ms
        )
        logger.warning("TWS options fetch produced no rows for %s", sym)
        return 0, 0

    # auto: TWS first when reachable, else Yahoo
    if tws_reachable and tws_host is not None and tws_port is not None:
        c_rows, s_rows, exp_count = collect_tws_option_chain_sync(
            sym, captured_at_ms, tws_host, tws_port, risk_free_rate
        )
        if c_rows and s_rows:
            _write_option_rows(c_rows, s_rows)
            duration_ms = _now_ms() - started_at
            _write_fetch_meta(
                sym, "tws", captured_at_ms, exp_count, len(s_rows), True, None, duration_ms
            )
            logger.info(
                "Stored %s options chain (tws): %s contracts across %s expirations in %sms",
                sym,
                len(s_rows),
                exp_count,
                duration_ms,
            )
            return exp_count, len(s_rows)
        logger.info("TWS options failed or empty for %s; falling back to Yahoo", sym)

    return _yahoo()


def _collect_yahoo_symbol(
    provider: YahooOptionsProvider,
    symbol: str,
    *,
    captured_at_ms: int,
    risk_free_rate: float,
) -> tuple[int, int]:
    started_at = _now_ms()
    try:
        chain_df, underlying_price = provider.fetch_chain(symbol)
        contract_rows, snapshot_rows, expiration_count = normalize_option_chain_df(
            symbol,
            chain_df,
            underlying_price=underlying_price,
            captured_at_ms=captured_at_ms,
            source=provider.source,
            risk_free_rate=risk_free_rate,
        )
        _write_option_rows(contract_rows, snapshot_rows)
        duration_ms = _now_ms() - started_at
        _write_fetch_meta(
            symbol,
            provider.source,
            captured_at_ms,
            expiration_count,
            len(snapshot_rows),
            True,
            None,
            duration_ms,
        )
        logger.info(
            "Stored %s options chain: %s contracts across %s expirations in %sms",
            symbol,
            len(snapshot_rows),
            expiration_count,
            duration_ms,
        )
        return expiration_count, len(snapshot_rows)
    except Exception as exc:
        duration_ms = _now_ms() - started_at
        _write_fetch_meta(symbol, provider.source, captured_at_ms, 0, 0, False, str(exc), duration_ms)
        logger.warning("Failed to collect options for %s: %s", symbol, exc)
        return 0, 0


def _write_option_rows(
    contract_rows: list[tuple[Any, ...]],
    snapshot_rows: list[tuple[Any, ...]],
) -> None:
    if not contract_rows and not snapshot_rows:
        return
    with sync_db_session() as conn:
        execute_many_with_retry(
            conn,
            """
            INSERT INTO option_contracts (
                contract_id, underlying, expiration, strike, option_type,
                contract_size, currency, exchange, exercise_style, created_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(contract_id) DO UPDATE SET
                underlying = excluded.underlying,
                expiration = excluded.expiration,
                strike = excluded.strike,
                option_type = excluded.option_type,
                contract_size = excluded.contract_size,
                currency = excluded.currency,
                exchange = excluded.exchange,
                exercise_style = excluded.exercise_style,
                last_seen_at = excluded.last_seen_at
            """,
            contract_rows,
        )
        execute_many_with_retry(
            conn,
            """
            INSERT INTO option_snapshots (
                contract_id, captured_at, underlying_price, bid, ask, bid_size, ask_size, mid,
                last_price, change, change_pct, volume, open_interest, implied_volatility,
                in_the_money, last_trade_date, delta, gamma, theta, vega, rho,
                intrinsic_value, extrinsic_value, days_to_expiration, risk_free_rate,
                greeks_source, iv_source, calc_error, source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(contract_id, captured_at) DO UPDATE SET
                underlying_price = excluded.underlying_price,
                bid = excluded.bid,
                ask = excluded.ask,
                bid_size = excluded.bid_size,
                ask_size = excluded.ask_size,
                mid = excluded.mid,
                last_price = excluded.last_price,
                change = excluded.change,
                change_pct = excluded.change_pct,
                volume = excluded.volume,
                open_interest = excluded.open_interest,
                implied_volatility = excluded.implied_volatility,
                in_the_money = excluded.in_the_money,
                last_trade_date = excluded.last_trade_date,
                delta = excluded.delta,
                gamma = excluded.gamma,
                theta = excluded.theta,
                vega = excluded.vega,
                rho = excluded.rho,
                intrinsic_value = excluded.intrinsic_value,
                extrinsic_value = excluded.extrinsic_value,
                days_to_expiration = excluded.days_to_expiration,
                risk_free_rate = excluded.risk_free_rate,
                greeks_source = excluded.greeks_source,
                iv_source = excluded.iv_source,
                calc_error = excluded.calc_error,
                source = excluded.source
            """,
            snapshot_rows,
        )


def _write_fetch_meta(
    symbol: str,
    source: str,
    fetched_at: int,
    expiration_count: int,
    contract_count: int,
    success: bool,
    error_message: str | None,
    duration_ms: int,
) -> None:
    with sync_db_session() as conn:
        conn.execute(
            """
            INSERT INTO option_chain_fetch_meta (
                underlying, source, fetched_at, expiration_count, contract_count,
                success, error_message, duration_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(underlying, source) DO UPDATE SET
                fetched_at = excluded.fetched_at,
                expiration_count = excluded.expiration_count,
                contract_count = excluded.contract_count,
                success = excluded.success,
                error_message = excluded.error_message,
                duration_ms = excluded.duration_ms
            """,
            (
                symbol,
                source,
                fetched_at,
                expiration_count,
                contract_count,
                1 if success else 0,
                error_message,
                duration_ms,
            ),
        )


def options_data_present(db_path: str | Path | None = None) -> bool:
    with sync_db_session(db_path) as conn:
        row = conn.execute(
            "SELECT 1 FROM option_snapshots LIMIT 1"
        ).fetchone()
    return row is not None


class OptionsCollectorWorker:
    """Run options collection on an interval in the background."""

    def __init__(
        self,
        *,
        source: str = DEFAULT_SOURCE,
        interval_minutes: int = DEFAULT_INTERVAL_MINUTES,
        risk_free_rate: float = DEFAULT_RISK_FREE_RATE,
    ) -> None:
        self._source = source
        self._interval_seconds = max(interval_minutes, 1) * 60
        self._risk_free_rate = risk_free_rate
        self._task: Any | None = None

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._loop())

    def stop(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()

    async def _loop(self) -> None:
        has_existing_data = False
        try:
            has_existing_data = await asyncio.to_thread(options_data_present)
        except Exception as exc:
            logger.warning("Failed to check existing options data before startup: %s", exc)

        logger.info(
            "OptionsCollectorWorker started: source=%s interval_minutes=%s existing_data=%s",
            self._source,
            int(self._interval_seconds / 60),
            has_existing_data,
        )

        while True:
            if not is_regular_market_hours():
                sleep_for = seconds_until_next_market_open()
                logger.info(
                    "Skipping options collection outside market hours; sleeping %.1fs until next regular session",
                    sleep_for,
                )
                await asyncio.sleep(sleep_for)
                continue

            try:
                logger.info(
                    "Options collector background cycle queued; next scheduled interval is %s minutes",
                    int(self._interval_seconds / 60),
                )
                await asyncio.to_thread(
                    run_collection_cycle,
                    source=self._source,
                    symbols_override=None,
                    max_symbols=None,
                    risk_free_rate=self._risk_free_rate,
                )
            except Exception as exc:
                logger.error("Options collector cycle failed: %s", exc)
            await asyncio.sleep(self._interval_seconds)


def run_collection_cycle(
    *,
    source: str,
    symbols_override: list[str] | None = None,
    max_symbols: int | None = None,
    risk_free_rate: float = DEFAULT_RISK_FREE_RATE,
) -> tuple[int, int]:
    mode = (source or DEFAULT_SOURCE).strip().lower()
    if mode not in ("yahoo", "tws", "auto"):
        raise ValueError(f"Unsupported options source: {source}")

    provider: YahooOptionsProvider | None = None
    if mode in ("yahoo", "auto"):
        provider = YahooOptionsProvider()

    if mode == "yahoo":
        tws_reachable, tws_host, tws_port = False, None, None
    else:
        tws_reachable, tws_host, tws_port = _probe_tws_for_options_cycle()

    log_label = mode if mode != "auto" else f"auto(tws_up={tws_reachable})"
    queue = build_symbol_queue(
        symbols_override or [],
        [],
        [],
    ) if symbols_override else load_symbol_queue()
    if max_symbols is not None and max_symbols > 0:
        queue = queue[:max_symbols]

    captured_at_ms = _now_ms()
    total_expirations = 0
    total_contracts = 0
    logger.info(
        "Starting options collection cycle: source=%s symbols=%s queue=%s",
        log_label,
        len(queue),
        _format_symbol_list(queue),
    )
    for idx, symbol in enumerate(queue, start=1):
        logger.info("Collecting %s (%s/%s)", symbol, idx, len(queue))
        expiration_count, contract_count = collect_symbol(
            provider,
            symbol,
            captured_at_ms=captured_at_ms,
            risk_free_rate=risk_free_rate,
            source_mode=mode,
            tws_reachable=tws_reachable,
            tws_host=tws_host,
            tws_port=tws_port,
        )
        total_expirations += expiration_count
        total_contracts += contract_count
    logger.info(
        "Options collection cycle complete: %s symbols, %s expirations, %s contracts",
        len(queue),
        total_expirations,
        total_contracts,
    )
    return total_expirations, total_contracts


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect and store options chain snapshots")
    parser.add_argument("--once", action="store_true", help="Run a single collection cycle and exit")
    parser.add_argument(
        "--interval-minutes",
        type=int,
        default=DEFAULT_INTERVAL_MINUTES,
        help="Minutes between collection cycles when running continuously",
    )
    parser.add_argument(
        "--source",
        default=DEFAULT_SOURCE,
        choices=["yahoo", "tws", "auto"],
        help="Options data source: yahoo only, TWS only, or TWS-first with Yahoo fallback",
    )
    parser.add_argument(
        "--symbols",
        default="",
        help="Comma-separated symbols to override the default priority queue",
    )
    parser.add_argument(
        "--max-symbols",
        type=int,
        default=0,
        help="Limit the number of symbols processed in each cycle",
    )
    parser.add_argument(
        "--risk-free-rate",
        type=float,
        default=DEFAULT_RISK_FREE_RATE,
        help="Annualized rate used when calculating implied vol and greeks",
    )
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )
    args = parse_args()
    symbols_override = build_symbol_queue(
        [sym for sym in args.symbols.split(",") if sym.strip()],
        [],
        [],
    ) if args.symbols else None
    max_symbols = args.max_symbols if args.max_symbols > 0 else None
    logger.info(
        "Options collector starting: mode=%s source=%s interval_minutes=%s max_symbols=%s risk_free_rate=%.6f symbols_override=%s",
        "once" if args.once else "loop",
        args.source,
        args.interval_minutes,
        max_symbols if max_symbols is not None else "all",
        args.risk_free_rate,
        _format_symbol_list(symbols_override or []),
    )

    if args.once:
        run_collection_cycle(
            source=args.source,
            symbols_override=symbols_override,
            max_symbols=max_symbols,
            risk_free_rate=args.risk_free_rate,
        )
        return

    interval_seconds = max(args.interval_minutes, 1) * 60
    while True:
        if not is_regular_market_hours():
            sleep_for = seconds_until_next_market_open()
            logger.info(
                "Skipping options collection outside market hours; sleeping %.1fs until next regular session",
                sleep_for,
            )
            time.sleep(sleep_for)
            continue

        started = time.time()
        run_collection_cycle(
            source=args.source,
            symbols_override=symbols_override,
            max_symbols=max_symbols,
            risk_free_rate=args.risk_free_rate,
        )
        elapsed = time.time() - started
        sleep_for = max(interval_seconds - elapsed, 1.0)
        logger.info("Sleeping %.1fs before next options collection cycle", sleep_for)
        time.sleep(sleep_for)


if __name__ == "__main__":
    main()
