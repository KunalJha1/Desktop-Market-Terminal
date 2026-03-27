"""Benchmark TWS historical pulls for the chart scenarios the app uses.

Usage:
    cd backend
    python tests/test_tws_intraday_depth.py
    python tests/test_tws_intraday_depth.py --symbol SPY
    python tests/test_tws_intraday_depth.py --scenario "1 min|20 D" --scenario "1 day|30 Y"

Each scenario is formatted as:
    "<bar_size>|<duration>"

Examples:
    "1 min|20 D"
    "1 min|90 D"
    "1 min|270 D"
    "1 day|30 Y"
"""

from __future__ import annotations

import argparse
import asyncio
import os
import random
import sys
import time
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ib_insync import IB, Stock

from historical import (
    TWS_DAILY_CHUNK_YEARS,
    TWS_INTRADAY_CHUNK_DAYS,
    _dedupe_bars,
    _duration_to_days,
    _ib_datetime_utc,
)


DEFAULT_SCENARIOS = ["1 min|20 D", "5 mins|90 D", "15 mins|270 D", "1 day|30 Y"]
DEFAULT_TRIALS = 1
PORT_ATTEMPTS = [
    (7497, "TWS paper"),
    (7496, "TWS live"),
    (4002, "Gateway paper"),
    (4001, "Gateway live"),
]


def _fmt_ts(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _parse_ib_bar(bar) -> dict:
    if isinstance(bar.date, datetime):
        ts_ms = int(bar.date.timestamp() * 1000)
    elif isinstance(bar.date, date):
        ts_ms = int(datetime.combine(bar.date, datetime.min.time(), tzinfo=timezone.utc).timestamp() * 1000)
    else:
        ts_ms = int(bar.date) * 1000
    return {
        "time": ts_ms,
        "open": float(bar.open),
        "high": float(bar.high),
        "low": float(bar.low),
        "close": float(bar.close),
        "volume": float(bar.volume),
    }


def _parse_scenario(raw: str) -> tuple[str, str]:
    if "|" not in raw:
        raise ValueError(f"Invalid scenario '{raw}'. Expected 'bar_size|duration'.")
    bar_size, duration = raw.split("|", 1)
    return bar_size.strip(), duration.strip()


async def _connect_ib(client_id: int) -> tuple[IB | None, str | None]:
    for port, label in PORT_ATTEMPTS:
        ib = IB()
        try:
            await ib.connectAsync("127.0.0.1", port, clientId=client_id, readonly=True, timeout=10)
            if ib.isConnected():
                return ib, f"{label} :{port}"
        except Exception:
            try:
                ib.disconnect()
            except Exception:
                pass
    return None, None


async def _fetch_paginated_no_timeout(
    ib: IB,
    symbol: str,
    bar_size: str,
    duration: str,
    client_id: int,
) -> tuple[list[dict], list[dict]]:
    is_daily = bar_size in ("1 day", "1d")
    requested_days = max(1, _duration_to_days(duration, 365 * 30))
    cutoff_ms = int((time.time() - requested_days * 86400) * 1000)
    if is_daily:
        chunk_years = min(TWS_DAILY_CHUNK_YEARS, max(1, (requested_days + 364) // 365))
        chunk_duration = f"{chunk_years} Y"
    else:
        chunk_days = min(TWS_INTRADAY_CHUNK_DAYS, requested_days)
        chunk_duration = f"{chunk_days} D"
    contract = Stock(symbol, "SMART", "USD")

    all_bars: list[dict] = []
    chunks: list[dict] = []
    end_date_time = ""
    seen_earliest: set[int] = set()
    chunk_index = 0

    while True:
        chunk_index += 1
        chunk_started = time.time()
        bars = await ib.reqHistoricalDataAsync(
            contract,
            endDateTime=end_date_time,
            durationStr=chunk_duration,
            barSizeSetting=bar_size,
            whatToShow="TRADES",
            useRTH=False,
            formatDate=2,
            timeout=0,
        )
        chunk_elapsed = time.time() - chunk_started

        parsed = [_parse_ib_bar(b) for b in bars]
        chunks.append({
            "index": chunk_index,
            "clientId": client_id,
            "duration": chunk_duration,
            "barSize": bar_size,
            "elapsed_s": chunk_elapsed,
            "count": len(parsed),
            "earliest": parsed[0]["time"] if parsed else None,
            "latest": parsed[-1]["time"] if parsed else None,
        })

        if not parsed:
            break

        all_bars.extend(parsed)
        earliest_ts = parsed[0]["time"]
        if earliest_ts <= cutoff_ms:
            break
        if earliest_ts in seen_earliest:
            break
        seen_earliest.add(earliest_ts)
        end_date_time = _ib_datetime_utc(max(0, earliest_ts - 1000))

    bars = [bar for bar in _dedupe_bars(all_bars) if bar["time"] >= cutoff_ms]
    return bars, chunks


async def _run_single(symbol: str, bar_size: str, duration: str, trial: int, client_id: int) -> dict:
    started = time.time()
    ib, target = await _connect_ib(client_id)
    if ib is None:
        return {
            "barSize": bar_size,
            "duration": duration,
            "trial": trial,
            "clientId": client_id,
            "ok": False,
            "error": "could not connect to local TWS/Gateway on 7497/7496/4002/4001",
        }

    try:
        bars, chunks = await _fetch_paginated_no_timeout(ib, symbol, bar_size, duration, client_id)
    except Exception as exc:
        try:
            ib.disconnect()
        except Exception:
            pass
        return {
            "barSize": bar_size,
            "duration": duration,
            "trial": trial,
            "clientId": client_id,
            "target": target,
            "ok": False,
            "elapsed_s": time.time() - started,
            "error": str(exc),
        }
    finally:
        try:
            ib.disconnect()
        except Exception:
            pass

    elapsed = time.time() - started
    if not bars:
        return {
            "barSize": bar_size,
            "duration": duration,
            "trial": trial,
            "clientId": client_id,
            "target": target,
            "ok": False,
            "elapsed_s": elapsed,
            "chunks": chunks,
            "error": "TWS returned no bars",
        }

    first_bar = bars[0]
    last_bar = bars[-1]
    span_days = (last_bar["time"] - first_bar["time"]) / 1000 / 86400
    return {
        "barSize": bar_size,
        "duration": duration,
        "trial": trial,
        "clientId": client_id,
        "target": target,
        "ok": True,
        "elapsed_s": elapsed,
        "bars": len(bars),
        "earliest": first_bar["time"],
        "latest": last_bar["time"],
        "span_days": span_days,
        "chunks": chunks,
    }


def _print_result(result: dict) -> None:
    print("=" * 72)
    print(
        f"[{result['barSize']} / {result['duration']}] "
        f"trial {result['trial']} clientId={result['clientId']}"
    )
    if result.get("target"):
        print(f"Connected: {result['target']}")
    print(f"Elapsed: {result.get('elapsed_s', 0.0):.1f}s")

    if not result["ok"]:
        print(f"FAIL: {result['error']}")
    else:
        print(f"Bars returned: {result['bars']:,}")
        print(f"Earliest bar: {_fmt_ts(result['earliest'])}")
        print(f"Latest bar:   {_fmt_ts(result['latest'])}")
        print(f"Observed span: {result['span_days']:.1f} days ({result['span_days'] / 365.0:.2f} years)")

    for chunk in result.get("chunks", []):
        earliest = _fmt_ts(chunk["earliest"]) if chunk["earliest"] else "none"
        latest = _fmt_ts(chunk["latest"]) if chunk["latest"] else "none"
        print(
            f"  chunk {chunk['index']:02d}: {chunk['barSize']} {chunk['duration']} "
            f"{chunk['count']:,} bars in {chunk['elapsed_s']:.1f}s "
            f"[{earliest} -> {latest}]"
        )


def _print_summary(results: list[dict]) -> None:
    print("\n" + "#" * 72)
    print("Summary")
    print("#" * 72)
    for result in results:
        status = "OK" if result["ok"] else "FAIL"
        if result["ok"]:
            print(
                f"{status:4}  {result['barSize']:>5}  {result['duration']:>5}  "
                f"trial={result['trial']}  clientId={result['clientId']}  "
                f"elapsed={result['elapsed_s']:.1f}s  bars={result['bars']:,}  "
                f"span={result['span_days']:.1f}d"
            )
        else:
            print(
                f"{status:4}  {result['barSize']:>5}  {result['duration']:>5}  "
                f"trial={result['trial']}  clientId={result['clientId']}  "
                f"elapsed={result.get('elapsed_s', 0.0):.1f}s  error={result['error']}"
            )


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", default="AAPL")
    parser.add_argument("--scenario", action="append", dest="scenarios")
    parser.add_argument("--trials", type=int, default=DEFAULT_TRIALS)
    args = parser.parse_args()

    symbol = args.symbol.upper()
    scenarios_raw = args.scenarios or DEFAULT_SCENARIOS
    scenarios = [_parse_scenario(raw) for raw in scenarios_raw]

    print(f"Symbol: {symbol}")
    print("Scenarios:")
    for bar_size, duration in scenarios:
        print(f"  {bar_size} / {duration}")
    print(f"Trials per scenario: {args.trials}")
    print("Historical timeout override: timeout=0 (disabled)\n")

    results: list[dict] = []
    used_client_ids: set[int] = set()

    for bar_size, duration in scenarios:
        for trial in range(1, args.trials + 1):
            client_id = random.randint(9000, 9999)
            while client_id in used_client_ids:
                client_id = random.randint(9000, 9999)
            used_client_ids.add(client_id)

            result = await _run_single(symbol, bar_size, duration, trial, client_id)
            results.append(result)
            _print_result(result)

    _print_summary(results)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
