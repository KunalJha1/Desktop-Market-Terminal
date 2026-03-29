from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main


class HeatmapApiTests(unittest.TestCase):
    def test_enrich_with_tech_scores_maps_all_expected_timeframes(self) -> None:
        tmpdir = tempfile.TemporaryDirectory()
        try:
            db_path = Path(tmpdir.name) / "market.db"
            with sqlite3.connect(db_path) as conn:
                conn.execute(
                    """
                    CREATE TABLE technical_scores (
                        symbol TEXT PRIMARY KEY,
                        score_1m INTEGER,
                        score_5m INTEGER,
                        score_15m INTEGER,
                        score_1h INTEGER,
                        score_1d INTEGER,
                        score_1w INTEGER
                    )
                    """
                )
                conn.execute(
                    """
                    INSERT INTO technical_scores (
                        symbol, score_1m, score_5m, score_15m, score_1h, score_1d, score_1w
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    ("AAPL", 10, 20, 30, 40, 50, 60),
                )
                payloads = [{"symbol": "AAPL"}]
                main._enrich_with_tech_scores(conn, payloads)
        finally:
            tmpdir.cleanup()

        self.assertEqual(
            payloads[0]["techScores"],
            {"1m": 10, "5m": 20, "15m": 30, "1h": 40, "1d": 50, "1w": 60},
        )
        self.assertEqual(payloads[0]["techScore1d"], 50)
        self.assertEqual(payloads[0]["techScore1w"], 60)

    def test_enrich_with_tech_scores_handles_short_rows(self) -> None:
        class _Cursor:
            def fetchall(self) -> list[tuple]:
                return [("AAPL", 10, 20, 30)]

        class _Conn:
            def execute(self, *_args, **_kwargs) -> _Cursor:
                return _Cursor()

        payloads = [{"symbol": "AAPL"}]
        main._enrich_with_tech_scores(_Conn(), payloads)

        self.assertEqual(
            payloads[0]["techScores"],
            {"1m": 10, "5m": 20, "15m": 30, "1h": None, "1d": None, "1w": None},
        )
        self.assertIsNone(payloads[0]["techScore1d"])
        self.assertIsNone(payloads[0]["techScore1w"])


if __name__ == "__main__":
    unittest.main()
