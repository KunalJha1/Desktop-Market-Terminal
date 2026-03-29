"""Standalone valuation worker.

Runs a dedicated valuation cycle on first local bootstrap and then once
every 24 hours after the last successful run. This keeps valuation and universe
market-cap enrichment out of the TWS watchlist worker.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import time
from pathlib import Path

from dotenv import load_dotenv
from runtime_paths import data_dir
from worker_watchlist import (
    _snapshot_from_quote,
    _upsert_market_snapshot,
    count_null_market_cap_symbols,
    fetch_universe_quotes_from_yahoo,
    load_enabled_symbols_with_etfs,
    read_active_symbols,
    read_watchlist,
    refresh_symbol_valuations_with_fallback,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

logger = logging.getLogger("valuation-worker")

INTERVAL_S = 86400.0
STARTUP_SETTLE_S = 30.0
RETRY_S = 300.0
STATE_PATH = data_dir() / "updated_ytc.json"


def read_last_success_ms(path: Path = STATE_PATH) -> int | None:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except Exception as exc:
        logger.warning("Failed to read valuation worker state from %s: %s", path, exc)
        return None

    value = raw.get("last_success_ms") if isinstance(raw, dict) else None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def write_last_success_ms(last_success_ms: int, path: Path = STATE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"last_success_ms": int(last_success_ms)}, indent=2),
        encoding="utf-8",
    )


def should_run_cycle(now_ms: int, last_success_ms: int | None, interval_s: float = INTERVAL_S) -> bool:
    if last_success_ms is None:
        return True
    return (now_ms - last_success_ms) >= int(interval_s * 1000)


def seconds_until_next_run(now_ms: int, last_success_ms: int | None, interval_s: float = INTERVAL_S) -> float:
    if last_success_ms is None:
        return 0.0
    remaining_ms = int(interval_s * 1000) - (now_ms - last_success_ms)
    return max(0.0, remaining_ms / 1000.0)


def valuation_watchlist_symbols() -> list[str]:
    _, universe_etf_symbols = load_enabled_symbols_with_etfs()
    symbols = list(dict.fromkeys(read_watchlist() + read_active_symbols()))
    return [sym for sym in symbols if sym not in universe_etf_symbols]


def valuation_universe_symbols() -> list[str]:
    universe_symbols, universe_etf_symbols = load_enabled_symbols_with_etfs()
    watchlist_set = set(read_watchlist())
    return [
        sym
        for sym in universe_symbols
        if sym not in watchlist_set and sym not in universe_etf_symbols
    ]


def run_cycle() -> tuple[int, int]:
    valuation_symbols = valuation_watchlist_symbols()
    universe_symbols = valuation_universe_symbols()

    start_msg = (
        "[ValuationWorker] Starting cycle: "
        f"{len(valuation_symbols)} watchlist/active symbols, "
        f"{len(universe_symbols)} universe symbols"
    )
    print(start_msg, flush=True)
    logger.info(start_msg)

    if valuation_symbols:
        refresh_symbol_valuations_with_fallback(valuation_symbols, log=logger, set_valuation_ts=True)

    if universe_symbols:
        refresh_symbol_valuations_with_fallback(universe_symbols, log=logger, set_valuation_ts=True)

    fetched = 0
    if universe_symbols:
        quotes = fetch_universe_quotes_from_yahoo(universe_symbols)
        for quote in quotes:
            _upsert_market_snapshot(_snapshot_from_quote(quote))
        fetched = len(quotes)
        null_count = count_null_market_cap_symbols(universe_symbols)
        universe_msg = (
            "[ValuationWorker] Universe market caps filled for "
            f"{len(universe_symbols) - null_count}/{len(universe_symbols)} symbols; "
            f"missing={null_count}"
        )
        print(universe_msg, flush=True)
        logger.info(universe_msg)

    complete_msg = (
        "[ValuationWorker] Cycle complete: "
        f"{len(valuation_symbols)} valuation symbols, {fetched} universe quotes"
    )
    print(complete_msg, flush=True)
    logger.info(complete_msg)
    return len(valuation_symbols), fetched


async def worker_loop() -> None:
    await asyncio.sleep(STARTUP_SETTLE_S)
    while True:
        now_ms = int(time.time() * 1000)
        last_success_ms = read_last_success_ms()
        if should_run_cycle(now_ms, last_success_ms):
            reason = "first bootstrap" if last_success_ms is None else "interval elapsed"
            cycle_msg = f"[ValuationWorker] Running cycle ({reason})"
            print(cycle_msg, flush=True)
            logger.info(cycle_msg)
            try:
                await asyncio.to_thread(run_cycle)
                finished_ms = int(time.time() * 1000)
                await asyncio.to_thread(write_last_success_ms, finished_ms)
                sleep_s = INTERVAL_S
            except Exception as exc:
                print(f"[ValuationWorker] Cycle failed: {exc}", flush=True)
                logger.warning("[ValuationWorker] Cycle failed: %s", exc)
                sleep_s = RETRY_S
        else:
            sleep_s = min(RETRY_S, seconds_until_next_run(now_ms, last_success_ms))
        next_msg = f"[ValuationWorker] Next check in {int(max(1.0, sleep_s))}s"
        print(next_msg, flush=True)
        logger.info(next_msg)
        await asyncio.sleep(max(1.0, sleep_s))


def main() -> None:
    parser = argparse.ArgumentParser(description="Standalone valuation worker")
    parser.add_argument(
        "--loop",
        action="store_true",
        help="Run the long-lived scheduler loop instead of a one-shot valuation cycle.",
    )
    args = parser.parse_args()
    if args.loop:
        asyncio.run(worker_loop())
        return
    run_cycle()


if __name__ == "__main__":
    main()
