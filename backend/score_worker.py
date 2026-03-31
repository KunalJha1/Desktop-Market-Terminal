"""Background technical scoring service.

Runs every INTERVAL_S seconds, computes 0-100 scores for every symbol in the
watchlist across all timeframes (1m, 5m, 15m, 1h, 4h, 1d, 1w), and upserts
results into the `technical_scores` SQLite table.

A secondary "universe" tier scores the full S&P 500 on a slower cadence
(every UNIVERSE_INTERVAL_S seconds) for daily/weekly timeframes only.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from db_utils import execute_many_with_retry, sync_db_session
from technicals import MIN_BARS, SUPPORTED_TIMEFRAMES, inspect_symbol_timeframe, score_symbols

logger = logging.getLogger(__name__)

TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"]
UNIVERSE_TIMEFRAMES = ["1d", "1w"]
INTERVAL_S = 60
UNIVERSE_INTERVAL_S = 300
_SCORE_FIELDS = ("1m", "5m", "15m", "1h", "4h", "1d", "1w")


def _upsert_scores(
    rows: list[tuple[str, int | None, int | None, int | None, int | None, int | None, int | None, int | None]],
    now_utc: datetime,
) -> None:
    """Write scored rows into technical_scores via upsert with retry."""
    if not rows:
        return
    with sync_db_session() as conn:
        execute_many_with_retry(
            conn,
            """
            INSERT INTO technical_scores
                (symbol, score_1m, score_5m, score_15m, score_1h, score_4h, score_1d, score_1w, last_updated_utc)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (symbol) DO UPDATE SET
                score_1m         = excluded.score_1m,
                score_5m         = excluded.score_5m,
                score_15m        = excluded.score_15m,
                score_1h         = excluded.score_1h,
                score_4h         = excluded.score_4h,
                score_1d         = excluded.score_1d,
                score_1w         = excluded.score_1w,
                last_updated_utc = excluded.last_updated_utc
            """,
            [(sym, s1m, s5m, s15m, s1h, s4h, s1d, s1w, now_utc) for sym, s1m, s5m, s15m, s1h, s4h, s1d, s1w in rows],
        )


def _compute_and_upsert(symbols: list[str]) -> None:
    """Blocking: score all symbols then upsert. Runs in executor."""
    if not symbols:
        return
    scored = score_symbols(symbols, TIMEFRAMES)
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    rows = [
        (
            sym,
            scores.get("1m"),
            scores.get("5m"),
            scores.get("15m"),
            scores.get("1h"),
            scores.get("4h"),
            scores.get("1d"),
            scores.get("1w"),
        )
        for sym, scores in scored.items()
    ]
    _upsert_scores(rows, now_utc)
    logger.info("Technical scores updated for %s symbol(s)", len(rows))


def _compute_and_upsert_universe(symbols: list[str]) -> None:
    """Score universe symbols for 1d/1w only. Upserts only those two columns."""
    if not symbols:
        return
    scored = score_symbols(symbols, UNIVERSE_TIMEFRAMES)
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    rows = [
        (sym, None, None, None, None, scores.get("1d"), scores.get("1w"))
        for sym, scores in scored.items()
    ]
    if not rows:
        return
    with sync_db_session() as conn:
        execute_many_with_retry(
            conn,
            """
            INSERT INTO technical_scores
                (symbol, score_1d, score_1w, last_updated_utc)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (symbol) DO UPDATE SET
                score_1d         = excluded.score_1d,
                score_1w         = excluded.score_1w,
                last_updated_utc = excluded.last_updated_utc
            """,
            [(sym, s1d, s1w, now_utc) for sym, _, _, _, _, s1d, s1w in rows],
        )
    logger.info("Universe tech scores (1d/1w) updated for %s symbol(s)", len(rows))


def _normalize_symbols(symbols: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in symbols:
        sym = (raw or "").strip().upper()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        normalized.append(sym)
    return normalized


def _normalize_timeframes(timeframes: list[str] | None) -> list[str]:
    requested = timeframes or list(_SCORE_FIELDS)
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in requested:
        tf = (raw or "").strip().lower()
        if tf not in SUPPORTED_TIMEFRAMES or tf in seen:
            continue
        seen.add(tf)
        normalized.append(tf)
    return normalized or list(_SCORE_FIELDS)


def _row_to_score_map(row: tuple | None) -> dict[str, int | None]:
    if not row:
        return {tf: None for tf in _SCORE_FIELDS}
    return {
        "1m": row[1],
        "5m": row[2],
        "15m": row[3],
        "1h": row[4],
        "1d": row[5],
        "1w": row[6],
    }


def _merge_score_row(
    symbol: str,
    existing: dict[str, int | None],
    updates: dict[str, int | None],
) -> tuple[str, int | None, int | None, int | None, int | None, int | None, int | None]:
    merged = {
        tf: updates[tf] if tf in updates else existing.get(tf)
        for tf in _SCORE_FIELDS
    }
    return (
        symbol,
        merged["1m"],
        merged["5m"],
        merged["15m"],
        merged["1h"],
        merged["1d"],
        merged["1w"],
    )


def read_scores(symbols: list[str]) -> list[dict]:
    """Backward-compatible cache read for all supported timeframes."""
    return read_scores_for_timeframes(symbols, list(_SCORE_FIELDS))


def read_scores_for_timeframes(
    symbols: list[str],
    timeframes: list[str] | None = None,
) -> list[dict]:
    """Read cached scores and surface coverage status without computing on demand."""
    normalized_symbols = _normalize_symbols(symbols)
    if not normalized_symbols:
        return []
    requested_timeframes = _normalize_timeframes(timeframes)
    placeholders = ", ".join("?" * len(normalized_symbols))

    with sync_db_session() as conn:
        rows = conn.execute(
            f"""
            SELECT symbol, score_1m, score_5m, score_15m, score_1h,
                   score_1d, score_1w, last_updated_utc
            FROM technical_scores
            WHERE symbol IN ({placeholders})
            """,
            normalized_symbols,
        ).fetchall()
        row_map = {row[0]: row for row in rows}

    payloads: list[dict] = []
    with sync_db_session() as conn:
        for sym in normalized_symbols:
            row = row_map.get(sym)
            cached = _row_to_score_map(row)
            payload = {
                "symbol": sym,
                "last_updated_utc": row[7].isoformat() if row and hasattr(row[7], "isoformat") else (row[7] if row else None),
            }
            for tf in _SCORE_FIELDS:
                payload[tf] = cached.get(tf)
            for tf in requested_timeframes:
                score = cached.get(tf)
                if score is not None:
                    payload[f"status_{tf}"] = "ok"
                    payload[f"bars_{tf}"] = None
                    payload[f"required_bars_{tf}"] = MIN_BARS
                    continue
                info = inspect_symbol_timeframe(conn, sym, tf)
                payload[f"status_{tf}"] = "error" if info["status"] == "scorable" else info["status"]
                payload[f"bars_{tf}"] = info["bar_count"]
                payload[f"required_bars_{tf}"] = info["required_bars"]
            payloads.append(payload)

    return payloads


class TechnicalsScorer:
    """Async background worker that rescores the watchlist on a fixed interval.

    A secondary universe tier scores all S&P 500 symbols (1d/1w only) every
    UNIVERSE_INTERVAL_S seconds, skipping symbols already covered by the
    watchlist pass.
    """

    def __init__(self) -> None:
        self._symbols: list[str] = []
        self._universe: list[str] = []
        self._task: asyncio.Task | None = None

    def set_symbols(self, symbols: list[str]) -> None:
        self._symbols = _normalize_symbols(symbols)

    def set_universe(self, symbols: list[str]) -> None:
        """Set the broad universe (e.g. S&P 500) for low-frequency 1d/1w scoring."""
        self._universe = _normalize_symbols(symbols)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._loop())

    def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()

    async def _loop(self) -> None:
        logger.info("TechnicalsScorer started")
        iteration = 0
        universe_every = max(1, UNIVERSE_INTERVAL_S // INTERVAL_S)

        while True:
            loop = asyncio.get_event_loop()

            symbols = list(self._symbols)
            if symbols:
                try:
                    await loop.run_in_executor(None, _compute_and_upsert, symbols)
                except Exception as exc:
                    logger.error("TechnicalsScorer watchlist error: %s", exc)

            if iteration % universe_every == 0:
                watchlist_set = set(self._symbols)
                universe_only = [s for s in self._universe if s not in watchlist_set]
                if universe_only:
                    try:
                        await loop.run_in_executor(None, _compute_and_upsert_universe, universe_only)
                    except Exception as exc:
                        logger.error("TechnicalsScorer universe error: %s", exc)

            iteration += 1
            await asyncio.sleep(INTERVAL_S)
