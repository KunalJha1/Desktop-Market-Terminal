"""Background technical scoring service.

Runs every INTERVAL_S seconds, computes 0-100 scores for every symbol in the
watchlist across four fixed timeframes (1m, 5m, 1h, 4h), and upserts results
into the `technical_scores` SQLite table.

The heavy lifting (indicator math) runs in a thread-pool executor so it never
blocks the asyncio event loop.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from db_utils import execute_many_with_retry, sync_db_session
from technicals import score_symbols

logger = logging.getLogger(__name__)

TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"]
INTERVAL_S = 60


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
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)  # store as naive UTC
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
    logger.info(f"Technical scores updated for {len(rows)} symbol(s)")


def read_scores(symbols: list[str]) -> list[dict]:
    """Synchronous read — returns rows from cache for the given symbols."""
    if not symbols:
        return []
    placeholders = ", ".join("?" * len(symbols))
    with sync_db_session() as conn:
        rows = conn.execute(
            f"""
            SELECT symbol, score_1m, score_5m, score_15m, score_1h, score_4h,
                   score_1d, score_1w, last_updated_utc
            FROM technical_scores
            WHERE symbol IN ({placeholders})
            """,
            [s.upper() for s in symbols],
        ).fetchall()
    return [
        {
            "symbol": r[0],
            "1m": r[1],
            "5m": r[2],
            "15m": r[3],
            "1h": r[4],
            "4h": r[5],
            "1d": r[6],
            "1w": r[7],
            "last_updated_utc": r[8].isoformat() if hasattr(r[8], "isoformat") else r[8],
        }
        for r in rows
    ]


class TechnicalsScorer:
    """Async background worker that rescores the watchlist on a fixed interval."""

    def __init__(self) -> None:
        self._symbols: list[str] = []
        self._task: asyncio.Task | None = None

    def set_symbols(self, symbols: list[str]) -> None:
        self._symbols = list(symbols)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._loop())

    def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()

    async def _loop(self) -> None:
        logger.info("TechnicalsScorer started")
        while True:
            symbols = list(self._symbols)
            if symbols:
                loop = asyncio.get_event_loop()
                try:
                    await loop.run_in_executor(None, _compute_and_upsert, symbols)
                except Exception as exc:
                    logger.error(f"TechnicalsScorer error: {exc}")
            await asyncio.sleep(INTERVAL_S)
