"""Test script: fetch fundamental data (P/E, forward P/E, market cap) from Yahoo Finance.

Run standalone:
    cd backend && python tests/test_yahoo_fundamentals.py
"""

import time

from yahooquery import Ticker

TEST_SYMBOLS = ["AAPL", "MSFT", "NVDA", "JPM", "XOM"]

FIELDS = ["trailingPE", "forwardPE", "marketCap"]


def _safe(val):
    """Return None for NaN / non-numeric sentinel values."""
    if val is None:
        return None
    try:
        f = float(val)
        if f != f:  # NaN check
            return None
        return f
    except (TypeError, ValueError):
        return None


def fmt_cap(v):
    if v is None:
        return "N/A"
    if v >= 1e12:
        return f"${v / 1e12:.2f}T"
    if v >= 1e9:
        return f"${v / 1e9:.1f}B"
    if v >= 1e6:
        return f"${v / 1e6:.0f}M"
    return f"${v:.0f}"


def main():
    print(f"Fetching fundamentals for {', '.join(TEST_SYMBOLS)}...")
    print(f"{'Symbol':<8} {'Trailing P/E':>14} {'Forward P/E':>14} {'Market Cap':>14}")
    print("-" * 54)

    # Batch fetch with yahooquery
    t = Ticker(TEST_SYMBOLS, asynchronous=True)
    summary = t.summary_detail
    price_data = t.price

    if not isinstance(summary, dict):
        print(f"ERROR: summary_detail returned {type(summary).__name__}, expected dict")
        return

    for sym in TEST_SYMBOLS:
        sd = summary.get(sym, {})
        pd = price_data.get(sym, {}) if isinstance(price_data, dict) else {}

        trailing_pe = _safe(sd.get("trailingPE")) if isinstance(sd, dict) else None
        forward_pe = _safe(sd.get("forwardPE")) if isinstance(sd, dict) else None
        # marketCap can be in summary_detail or in price
        market_cap = _safe(sd.get("marketCap")) if isinstance(sd, dict) else None
        if market_cap is None and isinstance(pd, dict):
            market_cap = _safe(pd.get("marketCap"))

        tpe_str = f"{trailing_pe:.2f}" if trailing_pe is not None else "N/A"
        fpe_str = f"{forward_pe:.2f}" if forward_pe is not None else "N/A"

        print(f"{sym:<8} {tpe_str:>14} {fpe_str:>14} {fmt_cap(market_cap):>14}")

        if trailing_pe is None:
            print(f"  WARNING: trailingPE missing for {sym}")
        if market_cap is None:
            print(f"  WARNING: marketCap missing for {sym}")

        # Rate-limit between lookups
        time.sleep(1.0)

    print()
    print("Also testing valuation_measures (DataFrame-based endpoint)...")
    time.sleep(1.0)
    try:
        vm = t.valuation_measures
        print(f"  Type: {type(vm).__name__}")
        if hasattr(vm, "columns"):
            print(f"  Columns: {list(vm.columns)}")
            print(f"  Shape: {vm.shape}")
            print(vm.head(5).to_string())
        elif isinstance(vm, dict):
            for k, v in vm.items():
                print(f"  {k}: {type(v).__name__}")
    except Exception as exc:
        print(f"  valuation_measures failed: {exc}")


if __name__ == "__main__":
    main()
