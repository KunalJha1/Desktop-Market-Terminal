"""Background gap scanner.

Periodically scans OHLCV tables for holes in the data and enqueues targeted
fill jobs into historical_priority_queue. The existing watchlist worker pops
those jobs and selects the best available provider (TWS > DailyIQ > Yahoo).

Works regardless of TWS connectivity — provider selection happens at fill time.
"""

import asyncio
import logging
import time
from datetime import datetime

from db_utils import run_db, sync_db_session
from historical import enqueue_historical_priority

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

BAR_STEP_MS: dict[str, int] = {
    "1m":  60_000,
    "5m":  300_000,
    "15m": 900_000,
    "1h":  3_600_000,
    "4h":  14_400_000,
    "1d":  86_400_000,
}

# How far back to look for gaps per bar_size
SCAN_WINDOW_DAYS: dict[str, int] = {
    "1m":  5,
    "5m":  20,
    "15m": 60,
    "1h":  180,
    "4h":  365,
    "1d":  730,
}

# Tables that have a `synthetic` column (off-hours ticks baked into bars)
_HAS_SYNTHETIC = {"1m", "5m", "15m"}

GAP_MULTIPLIER = 2        # gap must be > this many × bar_step to count
MAX_GAPS_PER_SCAN = 50    # SQL LIMIT per gap query
MIN_RESCAN_S = 300        # 5-minute cooldown per symbol+bar_size
ACTIVE_SYMBOL_TTL_S = 3_600   # only scan symbols active within last hour
SCAN_INTERVAL_S = 90      # full pass cadence


# ── DST / ET offset (pure arithmetic, no zoneinfo) ──────────────────────────

def _et_utc_offset(utc_ms: int) -> int:
    """Returns -4 (EDT) or -5 (EST) for a given UTC timestamp in milliseconds."""
    year = datetime.utcfromtimestamp(utc_ms / 1000).year
    mar1 = _utc_ms(year, 3, 1)
    dst_start = mar1 + ((7 - _weekday(mar1)) % 7 + 7) * 86_400_000 + 7 * 3_600_000
    nov1 = _utc_ms(year, 11, 1)
    dst_end = nov1 + ((7 - _weekday(nov1)) % 7) * 86_400_000 + 6 * 3_600_000
    return -4 if dst_start <= utc_ms < dst_end else -5


def _utc_ms(year: int, month: int, day: int) -> int:
    import calendar
    return int(calendar.timegm((year, month, day, 0, 0, 0, 0, 0, 0))) * 1000


def _weekday(utc_ms: int) -> int:
    """0=Mon … 6=Sun"""
    return datetime.utcfromtimestamp(utc_ms / 1000).weekday()


# ── Session check ─────────────────────────────────────────────────────────────

def _gap_has_trading_session(gap_start_ms: int, gap_end_ms: int, bar_step_ms: int) -> bool:
    """Returns True if any moment inside the gap falls within 9:30–16:00 ET Mon–Fri."""
    if bar_step_ms >= BAR_STEP_MS["1d"]:
        return _daily_gap_has_weekday(gap_start_ms, gap_end_ms)

    ts = gap_start_ms + bar_step_ms
    while ts < gap_end_ms:
        dt = datetime.utcfromtimestamp(ts / 1000)
        if dt.weekday() < 5:
            et_frac = (dt.hour + _et_utc_offset(ts)) + dt.minute / 60
            if 9.5 <= et_frac < 16.0:
                return True
        ts += bar_step_ms
    return False


def _daily_gap_has_weekday(gap_start_ms: int, gap_end_ms: int) -> bool:
    """For daily bars: gap is unexpected if ≥2 weekdays pass with no bar."""
    day_ms = 86_400_000
    ts = gap_start_ms + day_ms
    weekday_count = 0
    while ts < gap_end_ms:
        if _weekday(ts) < 5:
            weekday_count += 1
            if weekday_count >= 2:
                return True
        ts += day_ms
    return False


# ── Duration calculation ──────────────────────────────────────────────────────

def _gap_to_duration(gap_start_ms: int) -> str:
    """Return a TWS/DailyIQ-compatible duration string that covers the gap."""
    age_days = (time.time() * 1000 - gap_start_ms) / 86_400_000
    if age_days <= 1:
        return "2 D"
    if age_days <= 30:
        return f"{int(age_days) + 2} D"
    weeks = int(age_days / 7) + 2
    return f"{weeks} W"


# ── DB helpers (sync, called via run_db) ──────────────────────────────────────

def _get_scan_targets(active_ttl_ms: int) -> list[tuple[str, str]]:
    """Return (symbol, bar_size) pairs for recently active symbols."""
    with sync_db_session() as conn:
        rows = conn.execute(
            "SELECT symbol, bar_size FROM active_symbols WHERE last_requested > ?",
            (active_ttl_ms,),
        ).fetchall()

    targets: set[tuple[str, str]] = set()
    for symbol, bar_size in rows:
        size = bar_size or "1m"
        targets.add((symbol, size))
        # Always scan 1m (underpins all intraday aggregations) and daily
        targets.add((symbol, "1m"))
        targets.add((symbol, "1d"))

    return list(targets)


def _find_gaps(symbol: str, bar_size: str, since_ms: int) -> list[dict]:
    """Return gaps in ohlcv_{bar_size} for symbol since since_ms."""
    step = BAR_STEP_MS.get(bar_size)
    if step is None:
        return []

    threshold = step * GAP_MULTIPLIER
    table = f"ohlcv_{bar_size.replace(' ', '')}"
    synthetic_clause = "AND synthetic = 0" if bar_size in _HAS_SYNTHETIC else ""

    with sync_db_session() as conn:
        # Verify table exists before querying
        exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            (table,),
        ).fetchone()
        if not exists:
            return []

        rows = conn.execute(
            f"""
            WITH ordered AS (
                SELECT ts, LAG(ts) OVER (ORDER BY ts) AS prev_ts
                FROM {table}
                WHERE symbol = ? AND ts >= ?
                {synthetic_clause}
            )
            SELECT prev_ts AS gap_start_ms, ts AS gap_end_ms
            FROM ordered
            WHERE prev_ts IS NOT NULL
              AND (ts - prev_ts) > ?
            ORDER BY prev_ts ASC
            LIMIT {MAX_GAPS_PER_SCAN}
            """,
            (symbol, since_ms, threshold),
        ).fetchall()

    return [{"gap_start_ms": r[0], "gap_end_ms": r[1]} for r in rows]


# ── GapScanner ────────────────────────────────────────────────────────────────

class GapScanner:
    """Background asyncio task that detects and enqueues gap fills."""

    def __init__(self):
        self._task: asyncio.Task | None = None
        self._last_scanned: dict[str, float] = {}

    def start(self) -> None:
        if self._task is not None:
            return
        logger.info("GapScanner started")
        self._task = asyncio.get_running_loop().create_task(self._loop())

    def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        self._task = None
        logger.info("GapScanner stopped")

    async def _loop(self) -> None:
        await asyncio.sleep(15)  # let providers settle on startup
        try:
            while True:
                try:
                    await self._scan_pass()
                except Exception as exc:
                    logger.debug(f"GapScanner pass error: {exc}")
                await asyncio.sleep(SCAN_INTERVAL_S)
        except asyncio.CancelledError:
            pass

    async def _scan_pass(self) -> None:
        active_since_ms = int((time.time() - ACTIVE_SYMBOL_TTL_S) * 1000)
        targets = await run_db(_get_scan_targets, active_since_ms)

        for symbol, bar_size in targets:
            key = f"{symbol}:{bar_size}"
            now = time.time()
            if now - self._last_scanned.get(key, 0) < MIN_RESCAN_S:
                continue
            self._last_scanned[key] = now
            await self._scan_symbol(symbol, bar_size)

    async def _scan_symbol(self, symbol: str, bar_size: str) -> None:
        window_days = SCAN_WINDOW_DAYS.get(bar_size, 5)
        since_ms = int((time.time() - window_days * 86_400) * 1000)

        gaps = await run_db(_find_gaps, symbol, bar_size, since_ms)
        if not gaps:
            return

        step = BAR_STEP_MS.get(bar_size, 60_000)
        enqueued = 0
        for gap in gaps:
            if not _gap_has_trading_session(gap["gap_start_ms"], gap["gap_end_ms"], step):
                continue
            duration = _gap_to_duration(gap["gap_start_ms"])
            await run_db(enqueue_historical_priority, symbol, bar_size, "TRADES", duration)
            enqueued += 1

        if enqueued:
            logger.info(
                f"GapScanner: {symbol} {bar_size} — {enqueued}/{len(gaps)} gaps enqueued for fill"
            )
