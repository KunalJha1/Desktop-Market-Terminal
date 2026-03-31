"""
Pure pandas/numpy technical analysis scoring for the watchlist.

Implements the same indicator set and classify_technicals logic as
DailyIQ/backend/build_technical_analysis.py, but reads from this
project's SQLite market DB (ohlcv_1m / ohlcv_1d).
"""

from __future__ import annotations

import json
import logging

import numpy as np
import pandas as pd
from db_utils import sync_db_session

logger = logging.getLogger(__name__)

# Minimum resampled candles required before we attempt indicator math
MIN_BARS = 60
SUPPORTED_TIMEFRAMES = ("1m", "5m", "15m", "1h", "4h", "1d", "1w")
INTRADAY_TIMEFRAMES = {"1m", "5m", "15m", "1h", "4h"}

# How many 1m bars to pull per intraday timeframe (enough for 100+ resampled bars)
_TF_1M_FETCH: dict[str, int] = {
    "5m":  5  * 200,   # 200 × 5m bars
    "15m": 15 * 200,   # 200 × 15m bars
    "1h":  60 * 200,   # 200 × 1h bars
    "4h":  240 * 200,  # 200 × 4h bars
}
_TF_RESAMPLE_MINUTES: dict[str, int] = {
    "5m":  5,
    "15m": 15,
    "1h":  60,
    "4h":  240,
}


# ─── DB helpers ──────────────────────────────────────────────────────

_OHLCV_COLS = ["ts", "open", "high", "low", "close", "volume"]


def _get_1m(conn, symbol: str, limit: int) -> pd.DataFrame:
    rows = conn.execute(
        "SELECT ts, open, high, low, close, volume "
        "FROM ohlcv_1m WHERE symbol = ? ORDER BY ts DESC LIMIT ?",
        [symbol.upper(), limit],
    ).fetchall()
    if not rows:
        return pd.DataFrame(columns=_OHLCV_COLS)
    df = pd.DataFrame(rows, columns=_OHLCV_COLS)
    return df.sort_values("ts").reset_index(drop=True)


def _get_1d(conn, symbol: str, limit: int = 500) -> pd.DataFrame:
    rows = conn.execute(
        "SELECT ts, open, high, low, close, volume "
        "FROM ohlcv_1d WHERE symbol = ? ORDER BY ts DESC LIMIT ?",
        [symbol.upper(), limit],
    ).fetchall()
    if not rows:
        return pd.DataFrame(columns=_OHLCV_COLS)
    df = pd.DataFrame(rows, columns=_OHLCV_COLS)
    return df.sort_values("ts").reset_index(drop=True)


def _resample(df: pd.DataFrame, minutes: int) -> pd.DataFrame:
    """Resample 1-minute OHLCV to `minutes`-minute bars."""
    if df.empty:
        return df
    df = df.copy()
    df["dt"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
    df = df.set_index("dt")
    agg = (
        df.resample(f"{minutes}min", closed="left", label="left")
        .agg({"ts": "first", "open": "first", "high": "max",
              "low": "min", "close": "last", "volume": "sum"})
        .dropna(subset=["open", "close"])
    )
    return agg.reset_index(drop=True)


def _resample_weekly(df: pd.DataFrame) -> pd.DataFrame:
    """Resample daily OHLCV to weekly bars."""
    if df.empty:
        return df
    df = df.copy()
    df["dt"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
    df = df.set_index("dt")
    agg = (
        df.resample("W-MON", closed="left", label="left")
        .agg({"ts": "first", "open": "first", "high": "max",
              "low": "min", "close": "last", "volume": "sum"})
        .dropna(subset=["open", "close"])
    )
    return agg.reset_index(drop=True)


# ─── Indicator primitives ────────────────────────────────────────────

def _atr(high: pd.Series, low: pd.Series, close: pd.Series, length: int = 14) -> pd.Series:
    """Wilder ATR (EWM with alpha = 1/length)."""
    tr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low  - close.shift()).abs(),
    ], axis=1).max(axis=1)
    return tr.ewm(alpha=1.0 / length, adjust=False, min_periods=length).mean()


def _rsi(close: pd.Series, length: int = 14) -> pd.Series:
    delta = close.diff()
    gain  = delta.clip(lower=0)
    loss  = (-delta).clip(lower=0)
    ag = gain.ewm(alpha=1.0 / length, adjust=False, min_periods=length).mean()
    al = loss.ewm(alpha=1.0 / length, adjust=False, min_periods=length).mean()
    rs = ag / al.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50)


# ─── Compute helpers (mirror DailyIQ signatures) ─────────────────────

def _v(s: pd.Series) -> float | None:
    x = s.iloc[-1]
    return None if (x is None or (isinstance(x, float) and np.isnan(x))) else float(x)


def compute_rsi(df: pd.DataFrame, length: int = 14) -> dict:
    return {"value": _v(_rsi(df["close"], length))}


def compute_stoch_k(df: pd.DataFrame, k: int = 14, smooth_k: int = 3) -> dict:
    lo  = df["low"].rolling(k).min()
    hi  = df["high"].rolling(k).max()
    raw = 100 * (df["close"] - lo) / (hi - lo).replace(0, np.nan)
    return {"k": _v(raw.rolling(smooth_k).mean())}


def compute_stochrsi(df: pd.DataFrame, length: int = 14, k: int = 3) -> dict:
    rsi = _rsi(df["close"], length)
    lo  = rsi.rolling(length).min()
    hi  = rsi.rolling(length).max()
    raw = (rsi - lo) / (hi - lo + 1e-10) * 100
    return {"k": _v(raw.rolling(k).mean())}


def compute_cci(df: pd.DataFrame, length: int = 20) -> dict:
    tp  = (df["high"] + df["low"] + df["close"]) / 3
    sma = tp.rolling(length).mean()
    mad = tp.rolling(length).apply(lambda x: np.abs(x - x.mean()).mean(), raw=True)
    cci = (tp - sma) / (0.015 * mad.replace(0, np.nan))
    return {"value": _v(cci)}


def compute_bb(df: pd.DataFrame, length: int = 20, std: float = 2.0) -> dict:
    sma   = df["close"].rolling(length).mean()
    sigma = df["close"].rolling(length).std(ddof=0)
    upper = sma + std * sigma
    lower = sma - std * sigma
    return {
        "upper": _v(upper),
        "mid":   _v(sma),
        "lower": _v(lower),
        "close": float(df["close"].iloc[-1]),
    }


def compute_bbp(df: pd.DataFrame, length: int = 20, std: float = 2.0) -> dict:
    bb = compute_bb(df, length, std)
    c, u, l = bb["close"], bb["upper"], bb["lower"]
    if None in (c, u, l) or (u - l) == 0:
        return {"value": None}
    return {"value": float((c - l) / (u - l))}


def compute_ma(df: pd.DataFrame, length: int = 20) -> dict:
    return {"value": _v(df["close"].rolling(length).mean())}


def compute_ema(df: pd.DataFrame, length: int = 20) -> dict:
    return {"value": _v(df["close"].ewm(span=length, adjust=False).mean())}


def compute_vwap(df: pd.DataFrame) -> dict:
    tp     = (df["high"] + df["low"] + df["close"]) / 3
    cum_pv = (tp * df["volume"]).cumsum()
    cum_v  = df["volume"].cumsum().replace(0, np.nan)
    return {"value": _v(cum_pv / cum_v)}


def compute_macd(df: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9) -> dict:
    ema_fast = df["close"].ewm(span=fast, adjust=False).mean()
    ema_slow = df["close"].ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return {
        "macd": _v(macd_line),
        "signal": _v(signal_line),
        "histogram": _v(histogram),
    }


def compute_supertrend(df: pd.DataFrame, atr_len: int = 10, mult: float = 3.0) -> dict:
    hl2 = (df["high"] + df["low"]) / 2
    atr  = _atr(df["high"], df["low"], df["close"], atr_len)
    ub   = (hl2 + mult * atr).values
    lb   = (hl2 - mult * atr).values
    cl   = df["close"].values
    atrv = atr.values
    n    = len(cl)

    final_ub = ub.copy()
    final_lb = lb.copy()
    for i in range(1, n):
        if np.isnan(atrv[i]):
            continue
        final_ub[i] = ub[i] if (ub[i] < final_ub[i-1] or cl[i-1] > final_ub[i-1]) else final_ub[i-1]
        final_lb[i] = lb[i] if (lb[i] > final_lb[i-1] or cl[i-1] < final_lb[i-1]) else final_lb[i-1]

    direction = np.zeros(n, dtype=int)
    valid = int(np.argmax(~np.isnan(atrv))) if np.any(~np.isnan(atrv)) else n
    if valid < n:
        direction[valid] = 1
        for i in range(valid + 1, n):
            if direction[i-1] == 1:
                direction[i] = -1 if cl[i] < final_lb[i] else 1
            else:
                direction[i] =  1 if cl[i] > final_ub[i] else -1

    return {"direction": "BULL" if direction[-1] == 1 else "BEAR"}


def compute_reg(df: pd.DataFrame, length: int = 50) -> dict:
    cl = df["close"].values
    if len(cl) < length:
        return {"slope": None}
    y = cl[-length:]
    if np.any(np.isnan(y)):
        return {"slope": None}
    x = np.arange(length, dtype=float)
    return {"slope": float(np.polyfit(x, y, 1)[0])}


def compute_ms(df: pd.DataFrame, length: int = 50) -> dict:
    slope = compute_reg(df, length).get("slope")
    if slope is None:
        return {"value": None}
    a = _atr(df["high"], df["low"], df["close"], length)
    av = a.iloc[-1]
    if np.isnan(av) or av == 0:
        return {"value": None}
    return {"value": float(slope / av)}


# ─── Full indicator set ───────────────────────────────────────────────

def compute_all_technicals(df: pd.DataFrame) -> dict:
    return {
        "RSI":   compute_rsi(df),
        "%K":    compute_stoch_k(df),
        "STRSI": compute_stochrsi(df),
        "CCI":   compute_cci(df),
        "BB":    compute_bb(df),
        "BBP":   compute_bbp(df),
        "MA":    compute_ma(df),
        "VWAP":  compute_vwap(df),
        "ST":    compute_supertrend(df),
        "REG":   compute_reg(df),
        "MS":    compute_ms(df),
    }


def classify_technicals(technicals: dict, last_close: float) -> dict:
    """Returns score_0_100 in [0, 100]. Mirrors DailyIQ classify_technicals."""
    signals: dict[str, int] = {}
    for name, payload in (technicals or {}).items():
        sig = 0
        nu  = name.upper()
        try:
            if nu == "RSI":
                v = payload.get("value")
                if v is not None: sig = 1 if v >= 55 else (-1 if v <= 45 else 0)
            elif nu in ("%K", "STRSI"):
                k = payload.get("k")
                if k is not None: sig = 1 if k >= 60 else (-1 if k <= 40 else 0)
            elif nu == "CCI":
                v = payload.get("value")
                if v is not None: sig = 1 if v >= 100 else (-1 if v <= -100 else 0)
            elif nu == "BBP":
                v = payload.get("value")
                if v is not None: sig = 1 if v >= 0.60 else (-1 if v <= 0.40 else 0)
            elif nu == "MA":
                ma = payload.get("value")
                if ma is not None: sig = 1 if last_close > ma else -1
            elif nu == "VWAP":
                vwap = payload.get("value")
                if vwap is not None: sig = 1 if last_close > vwap else -1
            elif nu == "BB":
                c, u, l = payload.get("close"), payload.get("upper"), payload.get("lower")
                if None not in (c, u, l): sig = 1 if c > u else (-1 if c < l else 0)
            elif nu == "ST":
                d = payload.get("direction")
                sig = 1 if d == "BULL" else (-1 if d == "BEAR" else 0)
            elif nu == "REG":
                s = payload.get("slope")
                if s is not None: sig = 1 if s > 0 else -1
            elif nu == "MS":
                v = payload.get("value")
                if v is not None: sig = 1 if v > 0 else -1
        except Exception:
            sig = 0
        signals[name] = sig

    if not signals:
        return {"score_0_100": 50, "avg_signal": 0.0}
    avg   = sum(signals.values()) / len(signals)
    score = max(0, min(100, int(round(50 + 50 * avg))))
    return {"score_0_100": score, "avg_signal": avg}


# ─── Public API ───────────────────────────────────────────────────────

def _load_df(conn, symbol: str, timeframe: str) -> pd.DataFrame:
    """Load and resample OHLCV for the given timeframe. Returns empty df on failure."""
    if timeframe == "1m":
        return _get_1m(conn, symbol, 200)
    if timeframe == "1d":
        return _get_1d(conn, symbol, 200)
    if timeframe == "1w":
        return _resample_weekly(_get_1d(conn, symbol, 600))
    minutes = _TF_RESAMPLE_MINUTES.get(timeframe)
    if minutes is None:
        return pd.DataFrame()
    limit = min(_TF_1M_FETCH.get(timeframe, minutes * 200), 20_000)
    return _resample(_get_1m(conn, symbol, limit), minutes)


def inspect_symbol_timeframe(conn, symbol: str, timeframe: str) -> dict[str, int | str | None]:
    """Explain why a score is or is not available for a symbol/timeframe pair."""
    if timeframe not in SUPPORTED_TIMEFRAMES:
        return {
            "status": "unsupported_timeframe",
            "bar_count": 0,
            "required_bars": MIN_BARS,
        }
    try:
        df = _load_df(conn, symbol, timeframe)
    except Exception:
        logger.exception("inspect_symbol_timeframe(%s, %s) failed", symbol, timeframe)
        return {
            "status": "error",
            "bar_count": None,
            "required_bars": MIN_BARS,
        }

    bar_count = 0 if df is None else int(len(df))
    return {
        "status": "scorable" if bar_count >= MIN_BARS else "insufficient_bars",
        "bar_count": bar_count,
        "required_bars": MIN_BARS,
    }


def score_symbols(
    symbols: list[str],
    timeframes: list[str],
) -> dict[str, dict[str, int | None]]:
    """
    Compute 0-100 technical scores for every (symbol, timeframe) pair.
    Returns { symbol: { timeframe: score_or_null } }.
    Uses sync_db_session so scoring is safe from any thread.
    """
    result: dict[str, dict[str, int | None]] = {}
    try:
        with sync_db_session() as conn:
            for sym in symbols:
                result[sym] = {}
                for tf in timeframes:
                    try:
                        df = _load_df(conn, sym, tf)
                        if df is None or len(df) < MIN_BARS:
                            result[sym][tf] = None
                            continue
                        technicals  = compute_all_technicals(df)
                        last_close  = float(df["close"].iloc[-1])
                        classification = classify_technicals(technicals, last_close)
                        result[sym][tf] = classification.get("score_0_100")
                    except Exception as e:
                        logger.warning(f"score({sym}, {tf}): {e}")
                        result[sym][tf] = None
    except Exception as e:
        logger.error(f"technicals: cannot access DB: {e}")
        return {s: {tf: None for tf in timeframes} for s in symbols}

    return result


# ─── Individual indicator dispatcher ─────────────────────────────────

def indicator_key(spec: dict) -> str:
    return json.dumps(
        {
            "type": spec.get("type", ""),
            "timeframe": spec.get("timeframe", "1h"),
            "params": dict(sorted((spec.get("params", {}) or {}).items())),
            "output": spec.get("output"),
        },
        sort_keys=True,
        separators=(",", ":"),
    )


def compute_indicator(
    df: pd.DataFrame,
    indicator_type: str,
    params: dict,
    output: str | None,
) -> float | None:
    """Compute a single indicator's scalar value from params/output."""
    try:
        if indicator_type == "RSI":
            return compute_rsi(df, int(params.get("period", 14))).get("value")
        if indicator_type == "EMA":
            return compute_ema(df, int(params.get("period", 20))).get("value")
        if indicator_type == "SMA":
            return compute_ma(df, int(params.get("period", 20))).get("value")
        if indicator_type == "CCI":
            return compute_cci(df, int(params.get("period", 20))).get("value")
        if indicator_type == "StochK":
            return compute_stoch_k(
                df,
                int(params.get("period", 14)),
                int(params.get("smooth", 3)),
            ).get("k")
        if indicator_type == "StochRSI":
            return compute_stochrsi(
                df,
                int(params.get("period", 14)),
                int(params.get("smooth", 3)),
            ).get("k")
        if indicator_type == "BBP":
            return compute_bbp(
                df,
                int(params.get("period", 20)),
                float(params.get("stdDev", 2)),
            ).get("value")
        if indicator_type == "VWAP":
            return compute_vwap(df).get("value")
        if indicator_type == "ATR":
            return _v(_atr(df["high"], df["low"], df["close"], int(params.get("period", 14))))
        if indicator_type == "MACD":
            macd = compute_macd(
                df,
                int(params.get("fast", 12)),
                int(params.get("slow", 26)),
                int(params.get("signal", 9)),
            )
            return macd.get(output or "macd")
        return None
    except Exception as e:
        logger.warning(f"compute_indicator({indicator_type}, {params}, {output}): {e}")
        return None


def compute_indicators_for_symbols(
    symbols: list[str],
    indicators: list[dict],
) -> dict[str, dict[str, float | None]]:
    """
    Compute individual indicator values for multiple symbols.

    indicators: list of {"type": "RSI", "params": {"period": 14}, "timeframe": "1h", "output": "value"}
    Returns: { symbol: { "<serialized spec>": 62.3, ... } }
    """
    result: dict[str, dict[str, float | None]] = {}
    try:
        with sync_db_session() as conn:
            # Group indicators by timeframe to reuse loaded DataFrames
            tf_groups: dict[str, list[dict]] = {}
            for spec in indicators:
                tf = spec.get("timeframe", "1h")
                tf_groups.setdefault(tf, []).append(spec)

            for sym in symbols:
                result[sym] = {}
                # Cache loaded DataFrames per timeframe
                df_cache: dict[str, pd.DataFrame | None] = {}
                for tf, specs in tf_groups.items():
                    if tf not in df_cache:
                        df = _load_df(conn, sym, tf)
                        df_cache[tf] = df if (df is not None and len(df) >= MIN_BARS) else None
                    df = df_cache[tf]
                    for spec in specs:
                        itype = spec.get("type", "")
                        params = spec.get("params", {}) or {}
                        output = spec.get("output")
                        key = indicator_key(spec)
                        if df is None:
                            result[sym][key] = None
                        else:
                            result[sym][key] = compute_indicator(df, itype, params, output)
    except Exception as e:
        logger.error(f"compute_indicators_for_symbols: {e}")
        return {s: {} for s in symbols}

    return result


def _fill_nan(length: int) -> list[float]:
    return [float("nan")] * length


def _estimate_tick_size(df: pd.DataFrame) -> float:
    best = float("inf")

    def consider(value: float) -> None:
        nonlocal best
        if not np.isfinite(value) or value <= 0:
            return
        rounded = round(float(value), 8)
        if rounded > 0:
            best = min(best, rounded)

    for i in range(1, len(df)):
        prev = df.iloc[i - 1]
        cur = df.iloc[i]
        consider(abs(float(cur["open"]) - float(prev["open"])))
        consider(abs(float(cur["high"]) - float(prev["high"])))
        consider(abs(float(cur["low"]) - float(prev["low"])))
        consider(abs(float(cur["close"]) - float(prev["close"])))
        consider(abs(float(cur["high"]) - float(cur["low"])))

    if best != float("inf"):
        return best
    fallback = abs(float(df["close"].iloc[0]) / 10000) if len(df) else 0.0
    return fallback if fallback > 0 else 0.01


def _period_key_day(ts: int) -> str:
    dt = pd.to_datetime(ts, unit="ms", utc=True)
    return f"{dt.year}-{dt.month}-{dt.day}"


def _period_key_week(ts: int) -> str:
    dt = pd.to_datetime(ts, unit="ms", utc=True)
    monday = dt.normalize() - pd.Timedelta(days=dt.weekday())
    return f"{monday.year}-{monday.month}-{monday.day}"


def _period_key_month(ts: int) -> str:
    dt = pd.to_datetime(ts, unit="ms", utc=True)
    return f"{dt.year}-{dt.month}"


def _compute_period_levels(
    df: pd.DataFrame,
    get_key,
) -> tuple[list[float], list[float], list[float], list[float]]:
    length = len(df)
    current_high = _fill_nan(length)
    current_low = _fill_nan(length)
    previous_high = _fill_nan(length)
    previous_low = _fill_nan(length)

    active_key = ""
    period_high = float("nan")
    period_low = float("nan")
    last_high = float("nan")
    last_low = float("nan")

    for i, row in enumerate(df.itertuples(index=False)):
        key = get_key(int(row.ts))
        if key != active_key:
            active_key = key
            if np.isfinite(period_high):
                last_high = period_high
                last_low = period_low
            period_high = float(row.high)
            period_low = float(row.low)
        else:
            period_high = max(period_high, float(row.high))
            period_low = min(period_low, float(row.low))

        current_high[i] = period_high
        current_low[i] = period_low
        previous_high[i] = last_high
        previous_low[i] = last_low

    return current_high, current_low, previous_high, previous_low


def _compute_liquidity_levels(df: pd.DataFrame) -> dict[str, list[float]]:
    day = _compute_period_levels(df, _period_key_day)
    week = _compute_period_levels(df, _period_key_week)
    month = _compute_period_levels(df, _period_key_month)
    return {
        "todayHigh": day[0],
        "todayLow": day[1],
        "prevDayHigh": day[2],
        "prevDayLow": day[3],
        "prevWeekHigh": week[2],
        "prevWeekLow": week[3],
        "prevMonthHigh": month[2],
        "prevMonthLow": month[3],
    }


def detect_latest_liquidity_sweep(
    df: pd.DataFrame,
    lookback_bars: int,
    params: dict | None = None,
) -> dict[str, int | float | str | None]:
    params = params or {}
    if df is None or len(df) < 2:
        return {
            "direction": None,
            "eventTs": None,
            "ageBars": None,
            "source": None,
        }

    liq_use_close_confirm = float(params.get("liqUseCloseConfirm", 1)) >= 0.5
    liq_show_today_hl = float(params.get("liqShowTodayHL", 1)) >= 0.5
    liq_show_pdh_pdl = float(params.get("liqShowPDH_PDL", 1)) >= 0.5
    liq_show_pwh_pwl = float(params.get("liqShowPWH_PWL", 1)) >= 0.5
    liq_show_pmh_pml = float(params.get("liqShowPMH_PML", 1)) >= 0.5
    liq_use_external_only = float(params.get("liqUseExternalOnly", 1)) >= 0.5
    liq_pad_ticks = max(0, int(round(float(params.get("liqPadTicks", 0)))))

    levels = _compute_liquidity_levels(df)
    tick_size = _estimate_tick_size(df)
    pad = tick_size * liq_pad_ticks
    tol = tick_size * 2

    latest_event: dict[str, int | float | str | None] | None = None

    def allow_bear(level: float, base_high: float) -> bool:
        return (
            not liq_use_external_only
            or (np.isfinite(level) and np.isfinite(base_high) and level >= (base_high - tol))
        )

    def allow_bull(level: float, base_low: float) -> bool:
        return (
            not liq_use_external_only
            or (np.isfinite(level) and np.isfinite(base_low) and level <= (base_low + tol))
        )

    def bull_sweep(index: int, level: float) -> bool:
        return (
            np.isfinite(level)
            and float(df["low"].iloc[index]) < (level - pad)
            and (not liq_use_close_confirm or float(df["close"].iloc[index]) > level)
        )

    def bear_sweep(index: int, level: float) -> bool:
        return (
            np.isfinite(level)
            and float(df["high"].iloc[index]) > (level + pad)
            and (not liq_use_close_confirm or float(df["close"].iloc[index]) < level)
        )

    for i in range(1, len(df)):
        base_high = levels["todayHigh"][i - 1]
        base_low = levels["todayLow"][i - 1]

        bull_source = None
        if liq_show_today_hl and bull_sweep(i, base_low):
            bull_source = "today"
        elif liq_show_pdh_pdl and allow_bull(levels["prevDayLow"][i], base_low) and bull_sweep(i, levels["prevDayLow"][i]):
            bull_source = "prevDay"
        elif liq_show_pwh_pwl and allow_bull(levels["prevWeekLow"][i], base_low) and bull_sweep(i, levels["prevWeekLow"][i]):
            bull_source = "prevWeek"
        elif liq_show_pmh_pml and allow_bull(levels["prevMonthLow"][i], base_low) and bull_sweep(i, levels["prevMonthLow"][i]):
            bull_source = "prevMonth"

        bear_source = None
        if liq_show_today_hl and bear_sweep(i, base_high):
            bear_source = "today"
        elif liq_show_pdh_pdl and allow_bear(levels["prevDayHigh"][i], base_high) and bear_sweep(i, levels["prevDayHigh"][i]):
            bear_source = "prevDay"
        elif liq_show_pwh_pwl and allow_bear(levels["prevWeekHigh"][i], base_high) and bear_sweep(i, levels["prevWeekHigh"][i]):
            bear_source = "prevWeek"
        elif liq_show_pmh_pml and allow_bear(levels["prevMonthHigh"][i], base_high) and bear_sweep(i, levels["prevMonthHigh"][i]):
            bear_source = "prevMonth"

        if bull_source and not bear_source:
            latest_event = {
                "direction": "bull",
                "eventTs": int(df["ts"].iloc[i]),
                "ageBars": len(df) - 1 - i,
                "source": bull_source,
            }
        elif bear_source and not bull_source:
            latest_event = {
                "direction": "bear",
                "eventTs": int(df["ts"].iloc[i]),
                "ageBars": len(df) - 1 - i,
                "source": bear_source,
            }

    if latest_event is None:
        return {
            "direction": None,
            "eventTs": None,
            "ageBars": None,
            "source": None,
        }

    age_bars = latest_event["ageBars"]
    if not isinstance(age_bars, int) or age_bars >= max(1, lookback_bars):
        return {
            "direction": None,
            "eventTs": None,
            "ageBars": None,
            "source": None,
        }

    return latest_event


def detect_liquidity_sweeps_for_symbols(
    symbols: list[str],
    timeframe: str,
    lookback_bars: int,
    params: dict | None = None,
) -> dict[str, dict[str, int | float | str | None]]:
    result: dict[str, dict[str, int | float | str | None]] = {}
    normalized_timeframe = timeframe.strip().lower()
    if normalized_timeframe not in {"5m", "15m", "1h", "4h", "1d", "1w"}:
        return {
            sym: {"direction": None, "eventTs": None, "ageBars": None, "source": None}
            for sym in symbols
        }

    try:
        with sync_db_session() as conn:
            for sym in symbols:
                df = _load_df(conn, sym, normalized_timeframe)
                if df is None or len(df) < 2:
                    result[sym] = {"direction": None, "eventTs": None, "ageBars": None, "source": None}
                    continue
                result[sym] = detect_latest_liquidity_sweep(df, lookback_bars, params)
    except Exception as e:
        logger.error(f"detect_liquidity_sweeps_for_symbols: {e}")
        return {
            sym: {"direction": None, "eventTs": None, "ageBars": None, "source": None}
            for sym in symbols
        }

    return result
