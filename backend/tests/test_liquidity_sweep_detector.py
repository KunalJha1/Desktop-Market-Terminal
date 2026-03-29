from __future__ import annotations

import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import technicals


def _build_df(rows: list[tuple[int, float, float, float, float]]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "ts": ts,
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "volume": 1000,
            }
            for ts, open_, high, low, close in rows
        ]
    )


class LiquiditySweepDetectorTests(unittest.TestCase):
    def test_detects_recent_bullish_sweep(self) -> None:
        df = _build_df(
            [
                (0, 100, 105, 95, 102),
                (60_000, 102, 106, 101, 105),
                (120_000, 105, 108, 104, 107),
                (180_000, 107, 107.5, 94, 103),
                (240_000, 103, 105, 100, 104),
            ]
        )

        result = technicals.detect_latest_liquidity_sweep(df, lookback_bars=3)

        self.assertEqual(result["direction"], "bull")
        self.assertEqual(result["eventTs"], 180_000)
        self.assertEqual(result["ageBars"], 1)
        self.assertEqual(result["source"], "today")

    def test_detects_recent_bearish_sweep(self) -> None:
        df = _build_df(
            [
                (0, 100, 105, 95, 102),
                (60_000, 102, 106, 101, 105),
                (120_000, 105, 108, 104, 107),
                (180_000, 107, 110, 106, 109),
                (240_000, 109, 111, 103, 104),
            ]
        )

        result = technicals.detect_latest_liquidity_sweep(df, lookback_bars=3)

        self.assertEqual(result["direction"], "bear")
        self.assertEqual(result["eventTs"], 240_000)
        self.assertEqual(result["ageBars"], 0)
        self.assertEqual(result["source"], "today")

    def test_clears_stale_sweep_outside_lookback(self) -> None:
        df = _build_df(
            [
                (0, 100, 105, 95, 102),
                (60_000, 102, 106, 101, 105),
                (120_000, 105, 108, 104, 107),
                (180_000, 107, 109, 94, 103),
                (240_000, 103, 105, 100, 104),
                (300_000, 104, 106, 102, 105),
                (360_000, 105, 107, 103, 106),
            ]
        )

        result = technicals.detect_latest_liquidity_sweep(df, lookback_bars=2)

        self.assertIsNone(result["direction"])
        self.assertIsNone(result["eventTs"])
        self.assertIsNone(result["ageBars"])
        self.assertIsNone(result["source"])

    def test_returns_empty_for_short_series(self) -> None:
        df = _build_df([(0, 100, 101, 99, 100)])

        result = technicals.detect_latest_liquidity_sweep(df, lookback_bars=3)

        self.assertIsNone(result["direction"])
        self.assertIsNone(result["eventTs"])
        self.assertIsNone(result["ageBars"])
        self.assertIsNone(result["source"])


if __name__ == "__main__":
    unittest.main()
