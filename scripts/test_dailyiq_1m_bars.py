"""
DailyIQ 1m bar diagnostic — raw API inspection.

Hits /price-bars?timeframe=1m and prints the raw response so we can see:
  - Are timestamps per-minute or date-only (collapsed)?
  - Are OHLCV values per-minute or cumulative/daily aggregate?
  - Is ts_utc present and sensible, or is date_utc the only timestamp field?
  - Do consecutive bars show expected ~60s gaps, or huge gaps (daily steps)?

Run from repo root:
    python scripts/test_dailyiq_1m_bars.py [SYMBOL ...]

Requires DAILYIQ_API_KEY in env or hardcoded fallback below.
"""

import json
import os
import sys
import time
from datetime import datetime, timezone

import requests

# ── Config ───────────────────────────────────────────────────────────────────
API_KEY = os.getenv("DAILYIQ_API_KEY", "")
if not API_KEY:
    sys.exit("ERROR: set DAILYIQ_API_KEY env var first  (or edit the script)")

BASE = f"https://dailyiq.me/v1/{API_KEY}"
SYMBOLS = sys.argv[1:] or ["AAPL", "SPY", "NVDA"]
LIMIT = 20  # how many bars to inspect per symbol

# ── Terminal colours ─────────────────────────────────────────────────────────
RESET = "\033[0m"
BOLD  = "\033[1m"
RED   = "\033[31m"
YLW   = "\033[33m"
GRN   = "\033[32m"
CYN   = "\033[36m"
DIM   = "\033[2m"


def section(title: str) -> None:
    print(f"\n{BOLD}{CYN}{'─'*68}{RESET}")
    print(f"{BOLD}{CYN}  {title}{RESET}")
    print(f"{BOLD}{CYN}{'─'*68}{RESET}")


def fmt_ts(ts_ms: int | None) -> str:
    if ts_ms is None:
        return f"{RED}None{RESET}"
    dt = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
    return dt.strftime("%Y-%m-%d %H:%M:%S UTC")


def get(endpoint: str, params: dict | None = None) -> dict | None:
    url = f"{BASE}/{endpoint.lstrip('/')}"
    try:
        r = requests.get(url, params=params, timeout=15)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        print(f"  {RED}HTTP ERROR{RESET}  {endpoint}: {exc}")
        return None


# ── Core diagnostic ───────────────────────────────────────────────────────────

def inspect_1m_bars(symbol: str) -> None:
    section(f"{symbol} — raw /price-bars?timeframe=1m (last {LIMIT} bars)")

    data = get("price-bars", {"symbol": symbol, "timeframe": "1m",
                               "limit": LIMIT, "order": "desc"})
    if not data:
        print(f"  {RED}No response{RESET}")
        return

    # Print full raw JSON of the first 3 items so we can see every field
    items = data.get("items", [])
    total_returned = len(items)
    print(f"\n  Total items returned: {BOLD}{total_returned}{RESET}")
    print(f"  Top-level keys: {list(data.keys())}\n")

    print(f"  {BOLD}--- Raw JSON of first 3 items ---------------------------{RESET}")
    for idx, item in enumerate(items[:3]):
        print(f"  [{idx}] {json.dumps(item, indent=6)}")

    if not items:
        print(f"  {YLW}No items in response{RESET}")
        return

    # Reverse to chronological for gap analysis
    items_chron = list(reversed(items))

    print(f"\n  {BOLD}--- Timestamp & OHLCV analysis (chronological) ----------{RESET}")
    print(f"  {'#':>3}  {'ts_utc raw':>14}  {'date_utc':>22}  {'parsed time (UTC)':>22}  "
          f"{'open':>8}  {'high':>8}  {'low':>8}  {'close':>8}  {'volume':>12}  {'gap_s':>7}")
    print(f"  {'─'*3}  {'─'*14}  {'─'*22}  {'─'*22}  {'─'*8}  {'─'*8}  {'─'*8}  {'─'*8}  {'─'*12}  {'─'*7}")

    prev_parsed_ms: int | None = None
    problems: list[str] = []

    for idx, item in enumerate(items_chron):
        ts_raw   = item.get("ts_utc")
        date_utc = item.get("date_utc", "")
        open_    = item.get("open", "?")
        high     = item.get("high", "?")
        low      = item.get("low", "?")
        close    = item.get("close", "?")
        volume   = item.get("volume", "?")

        # Replicate provider logic: prefer ts_utc
        parsed_ms: int | None = None
        if ts_raw is not None:
            try:
                ts_int = int(ts_raw)
                parsed_ms = ts_int if ts_int > 10**12 else ts_int * 1000
            except (TypeError, ValueError):
                pass
        if parsed_ms is None and date_utc:
            for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
                try:
                    dt = datetime.strptime(date_utc, fmt).replace(tzinfo=timezone.utc)
                    parsed_ms = int(dt.timestamp() * 1000)
                    break
                except ValueError:
                    continue

        gap_str = ""
        gap_flag = ""
        if prev_parsed_ms is not None and parsed_ms is not None:
            gap_ms = parsed_ms - prev_parsed_ms
            gap_s  = gap_ms / 1000
            gap_str = f"{gap_s:>7.0f}"
            if gap_s < 30:
                gap_flag = f" {RED}⚠ dup/overlap{RESET}"
            elif gap_s < 55:
                gap_flag = f" {YLW}⚠ short gap{RESET}"
            elif 55 <= gap_s <= 75:
                gap_flag = f" {GRN}✓{RESET}"
            elif gap_s > 3600:
                gap_flag = f" {RED}⚠ HUGE GAP — daily aggregate?{RESET}"
                problems.append(f"Bar {idx}: gap {gap_s:.0f}s — likely daily/aggregate data")
            else:
                gap_flag = f" {YLW}gap {gap_s:.0f}s{RESET}"

        parsed_str = fmt_ts(parsed_ms) if parsed_ms is not None else f"{RED}unparseable{RESET}"
        ts_raw_str = str(ts_raw)[:14] if ts_raw is not None else f"{DIM}None{DIM}"
        date_str   = str(date_utc)[:22] if date_utc else f"{DIM}None{DIM}"

        print(f"  {idx:>3}  {ts_raw_str:>14}  {date_str:>22}  {parsed_str:>22}  "
              f"{str(open_):>8}  {str(high):>8}  {str(low):>8}  {str(close):>8}  "
              f"{str(volume):>12}  {gap_str}{gap_flag}")

        prev_parsed_ms = parsed_ms

    # ── Aggregate-data heuristic ─────────────────────────────────────────────
    print(f"\n  {BOLD}--- Heuristic checks ------------------------------------{RESET}")

    # 1. Are all timestamps on the same day? (Collapsed date-only regression)
    parsed_times = []
    for item in items_chron:
        ts_raw = item.get("ts_utc")
        parsed_ms = None
        if ts_raw is not None:
            try:
                ts_int = int(ts_raw)
                parsed_ms = ts_int if ts_int > 10**12 else ts_int * 1000
            except (TypeError, ValueError):
                pass
        if parsed_ms is None:
            date_utc = item.get("date_utc", "")
            for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
                try:
                    dt = datetime.strptime(date_utc, fmt).replace(tzinfo=timezone.utc)
                    parsed_ms = int(dt.timestamp() * 1000)
                    break
                except ValueError:
                    continue
        if parsed_ms is not None:
            parsed_times.append(parsed_ms)

    if parsed_times:
        unique_days = {ts // 86_400_000 for ts in parsed_times}
        if len(unique_days) == 1 and len(parsed_times) > 1:
            print(f"  {RED}⚠ ALL {len(parsed_times)} bars share the same UTC day — date-only timestamp collapse!{RESET}")
            problems.append("Date-only timestamp collapse: all bars on same day")
        else:
            print(f"  {GRN}✓ Bars span {len(unique_days)} distinct UTC day(s){RESET}")

        unique_ts = len(set(parsed_times))
        if unique_ts < len(parsed_times):
            dupes = len(parsed_times) - unique_ts
            print(f"  {RED}⚠ {dupes} duplicate timestamps detected{RESET}")
            problems.append(f"{dupes} duplicate timestamps")
        else:
            print(f"  {GRN}✓ All {unique_ts} timestamps are unique{RESET}")

    # 2. Are OHLCV values suspiciously wide (spanning the full day's range)?
    if items_chron:
        try:
            all_highs  = [float(i["high"])  for i in items_chron if i.get("high")]
            all_lows   = [float(i["low"])   for i in items_chron if i.get("low")]
            all_ranges = [float(i["high"]) - float(i["low"]) for i in items_chron
                          if i.get("high") and i.get("low")]
            if all_ranges:
                avg_range = sum(all_ranges) / len(all_ranges)
                max_range = max(all_ranges)
                total_span = max(all_highs) - min(all_lows)
                print(f"  Per-bar H-L range:  avg={avg_range:.3f}  max={max_range:.3f}")
                print(f"  Full dataset span:  {total_span:.3f}")
                if max_range > total_span * 0.8:
                    print(f"  {RED}⚠ Bars have near-full daily range — these look like daily aggregate bars{RESET}")
                    problems.append("Per-bar H-L range equals full day range — aggregate data returned")
                else:
                    print(f"  {GRN}✓ Per-bar range is smaller than full span — looks like genuine 1m bars{RESET}")
        except Exception as exc:
            print(f"  {YLW}Range check skipped: {exc}{RESET}")

    # 3. Does ts_utc exist at all?
    has_ts_utc = sum(1 for i in items if i.get("ts_utc") is not None)
    if has_ts_utc == 0:
        print(f"  {YLW}⚠ ts_utc is absent in all items — relying on date_utc only{RESET}")
        if items and "T" not in str(items[0].get("date_utc", "")):
            print(f"  {RED}⚠ date_utc has no time component — timestamps will collapse to midnight UTC!{RESET}")
            problems.append("date_utc is date-only (no time) — will collapse to midnight")
    else:
        print(f"  {GRN}✓ ts_utc present in {has_ts_utc}/{len(items)} items{RESET}")

    # ── Summary ──────────────────────────────────────────────────────────────
    print(f"\n  {BOLD}--- Summary ---------------------------------------------{RESET}")
    if problems:
        for p in problems:
            print(f"  {RED}✗{RESET} {p}")
    else:
        print(f"  {GRN}✓ No obvious issues detected in raw API response{RESET}")
        print(f"  {DIM}(If bars still look wrong on-chart, the issue is in bar rendering or viewport logic){RESET}")


def main() -> None:
    print(f"\n{BOLD}DailyIQ 1m Bar Diagnostic{RESET}")
    print(f"API key: {API_KEY[:12]}…")
    print(f"Time:    {datetime.now(tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC")
    print(f"Symbols: {', '.join(SYMBOLS)}")

    for sym in SYMBOLS:
        inspect_1m_bars(sym)

    print(f"\n{DIM}Done.{RESET}\n")


if __name__ == "__main__":
    main()
