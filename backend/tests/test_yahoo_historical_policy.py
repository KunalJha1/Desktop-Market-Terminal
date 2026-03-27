import time
import unittest
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from historical import (
    MAX_INCREMENTAL_INTRADAY_DAYS,
    YAHOO_1M_MAX_DAYS,
    _incremental_yahoo_period,
    _yahoo_seed_period,
)


class YahooHistoricalPolicyTests(unittest.TestCase):
    def test_seed_period_uses_native_series_horizons(self) -> None:
        self.assertEqual(_yahoo_seed_period("1 min", 20), "1mo")
        self.assertEqual(_yahoo_seed_period("5 mins", 90), "6mo")
        self.assertEqual(_yahoo_seed_period("15 mins", 270), "1y")
        self.assertEqual(_yahoo_seed_period("1 day", 365 * 30), "max")

    def test_incremental_intraday_minimum_is_one_day(self) -> None:
        recent_ms = int(time.time() * 1000)
        self.assertEqual(_incremental_yahoo_period(recent_ms, "6mo", is_daily=False), "5d")

    def test_incremental_one_minute_is_capped_by_yahoo_limit(self) -> None:
        old_ms = int((time.time() - YAHOO_1M_MAX_DAYS * 86400 * 4) * 1000)
        self.assertEqual(_incremental_yahoo_period(old_ms, "1mo", is_daily=False), "1mo")

    def test_incremental_non_one_minute_intraday_is_capped_at_fourteen_days(self) -> None:
        old_ms = int((time.time() - MAX_INCREMENTAL_INTRADAY_DAYS * 86400 * 10) * 1000)
        self.assertEqual(_incremental_yahoo_period(old_ms, "6mo", is_daily=False), "1mo")

    def test_incremental_daily_preserves_deeper_ranges(self) -> None:
        old_ms = int((time.time() - (365 * 3) * 86400) * 1000)
        self.assertEqual(_incremental_yahoo_period(old_ms, "max", is_daily=True), "5y")


if __name__ == "__main__":
    unittest.main()
