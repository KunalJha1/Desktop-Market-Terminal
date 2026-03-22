"""Regression test for watchlist quote normalization and live TWS quote intake.

Usage:
    cd backend
    python3 test_watchlist_quotes.py

This script runs:
1. Unit-style checks proving placeholder IB values are rejected.
2. A live TWS smoke test that waits for a usable quote for AAPL.
"""

from __future__ import annotations

import asyncio
import logging
import math
from types import SimpleNamespace

from ib_insync import IB, Stock

from worker_watchlist import connect_ib, normalize_watchlist_symbols, ticker_to_quote

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)

results: list[tuple[str, bool, str]] = []


def report(name: str, passed: bool, detail: str = "") -> None:
    tag = "PASS" if passed else "FAIL"
    msg = f"  [{tag}] {name}"
    if detail:
        msg += f" — {detail}"
    print(msg)
    results.append((name, passed, detail))


def fake_ticker(**kwargs):
    defaults = {
        "last": math.nan,
        "bid": -1,
        "ask": -1,
        "close": math.nan,
        "open": math.nan,
        "high": math.nan,
        "low": math.nan,
        "volume": math.nan,
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_placeholder_snapshot_rejected() -> None:
    ticker = fake_ticker(last=0, bid=-1, ask=-1, close=0)
    quote = ticker_to_quote("AAPL", ticker)
    report(
        "Placeholder snapshot rejected",
        quote is None,
        "ticker_to_quote should return None for 0/-1 placeholder values",
    )


def test_midpoint_fallback() -> None:
    ticker = fake_ticker(last=math.nan, bid=101.25, ask=101.75, close=100.5, volume=1000)
    quote = ticker_to_quote("AAPL", ticker)
    ok = (
        quote is not None
        and abs(quote["last"] - 101.5) < 1e-9
        and abs(quote["mid"] - 101.5) < 1e-9
        and quote["prev_close"] == 100.5
    )
    report("Midpoint fallback", ok, f"quote={quote}")


def test_close_fallback() -> None:
    ticker = fake_ticker(last=math.nan, bid=-1, ask=-1, close=99.9, volume=500)
    quote = ticker_to_quote("AAPL", ticker)
    ok = quote is not None and quote["last"] == 99.9 and quote["mid"] == 99.9
    report("Close fallback", ok, f"quote={quote}")


def test_watchlist_normalization() -> None:
    normalized = normalize_watchlist_symbols(["AAPL", "", " aapl ", "MSFT", " ", "msft", "QQQ"])
    report("Watchlist normalization", normalized == ["AAPL", "MSFT", "QQQ"], f"normalized={normalized}")


async def test_live_tws_quote() -> None:
    ib = IB()
    try:
        ok = await connect_ib(ib, "127.0.0.1", [7497, 7496, 4002, 4001], 9998)
        if not ok:
            report("Live TWS quote", False, "could not connect to TWS/Gateway")
            return

        contract = Stock("AAPL", "SMART", "USD")
        ticker = ib.reqMktData(contract, genericTickList="", snapshot=False)

        quote = None
        deadline = asyncio.get_running_loop().time() + 15
        while asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(0.25)
            quote = ticker_to_quote("AAPL", ticker)
            if quote is not None:
                break

        if quote is None:
            report("Live TWS quote", False, f"ticker never became usable: {ticker}")
            return

        detail = (
            f"last={quote['last']} bid={quote['bid']} ask={quote['ask']} "
            f"mid={quote['mid']} prev_close={quote['prev_close']}"
        )
        report("Live TWS quote", quote["last"] > 0, detail)
        ib.cancelMktData(contract)
    except Exception as exc:
        report("Live TWS quote", False, str(exc))
    finally:
        if ib.isConnected():
            ib.disconnect()


async def main() -> None:
    test_placeholder_snapshot_rejected()
    test_midpoint_fallback()
    test_close_fallback()
    test_watchlist_normalization()
    await test_live_tws_quote()

    failed = [name for name, passed, _ in results if not passed]
    print()
    if failed:
      print(f"FAILED {len(failed)}/{len(results)}: {', '.join(failed)}")
      raise SystemExit(1)
    print(f"ALL PASSED ({len(results)} checks)")


if __name__ == "__main__":
    asyncio.run(main())
