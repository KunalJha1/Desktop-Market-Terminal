"""
Pure pandas/numpy technical analysis scoring for the watchlist.

Implements the same indicator set and classify_technicals logic as
DailyIQ/backend/build_technical_analysis.py, but reads from this
project's DuckDB (ohlcv_1m / ohlcv_1d) instead of SQLite price_bars.
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd
from db_utils import sync_db_session

logger = logging.getLogger(__name__)

# Minimum resampled candles required before we attempt indicator math
MIN_BARS = 60

# How many 1m bars to pull per intraday timeframe (enough for 100+ resampled bars)
_TF_1M_FETCH: dict[str, int] = {
    "5m":  5  * 200,   # 200 × 5m bars
    "15m": 15 * 200,   # 200 × 15m bars
    "1h":  60 * 200,   # 200 × 1h bars
    "4h":  240 * 150,  # 150 × 4h bars (cap at 15 000)
}
_TF_RESAMPLE_MINUTES: dict[str, int] = {
    "5m":  5,
    "15m": 15,
    "1h":  60,
    "4h":  240,
}


# ─── DB helpers ──────────────────────────────────────────────────────

def _get_1m(conn, symbol: str, limit: int) -> pd.DataFrame:
    df = conn.execute(
        "SELECT ts, open, high, low, close, volume "
        "FROM ohlcv_1m WHERE symbol = ? ORDER BY ts DESC LIMIT ?",
        [symbol.upper(), limit],
    ).fetchdf()
    return df.sort_values("ts").reset_index(drop=True) if not df.empty else df


def _get_1d(conn, symbol: str, limit: int = 500) -> pd.DataFrame:
    df = conn.execute(
        "SELECT ts, open, high, low, close, volume "
        "FROM ohlcv_1d WHERE symbol = ? ORDER BY ts DESC LIMIT ?",
        [symbol.upper(), limit],
    ).fetchdf()
    return df.sort_values("ts").reset_index(drop=True) if not df.empty else df


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


def compute_vwap(df: pd.DataFrame) -> dict:
    tp     = (df["high"] + df["low"] + df["close"]) / 3
    cum_pv = (tp * df["volume"]).cumsum()
    cum_v  = df["volume"].cumsum().replace(0, np.nan)
    return {"value": _v(cum_pv / cum_v)}


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
    if timeframe == "1d":
        return _get_1d(conn, symbol, 200)
    if timeframe == "1w":
        return _resample_weekly(_get_1d(conn, symbol, 600))
    minutes = _TF_RESAMPLE_MINUTES.get(timeframe)
    if minutes is None:
        return pd.DataFrame()
    limit = min(_TF_1M_FETCH.get(timeframe, minutes * 200), 20_000)
    return _resample(_get_1m(conn, symbol, limit), minutes)


def score_symbols(
    symbols: list[str],
    timeframes: list[str],
) -> dict[str, dict[str, int | None]]:
    """
    Compute 0-100 technical scores for every (symbol, timeframe) pair.
    Returns { symbol: { timeframe: score_or_null } }.
    Uses the process-wide DuckDB manager so scoring cannot race other sidecar DB
    work on Windows.
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
        logger.error(f"technicals: cannot access DuckDB: {e}")
        return {s: {tf: None for tf in timeframes} for s in symbols}

    return result
