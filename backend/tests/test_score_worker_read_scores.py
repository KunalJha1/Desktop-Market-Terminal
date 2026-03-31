"""Regression: read_scores_for_timeframes must return score_4h from SQLite."""

from __future__ import annotations

import sqlite3
import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import score_worker

# Shared in-memory DB so two sync_db_session() blocks in read_scores_for_timeframes
# see the same data without Windows file-lock issues from temp files.
_MEM_DB_URI = "file:score_worker_4h_test?mode=memory&cache=shared"


class ReadScoresFourHourTests(unittest.TestCase):
    def test_read_scores_for_timeframes_returns_4h_when_cached(self) -> None:
        with sqlite3.connect(_MEM_DB_URI, uri=True) as conn:
            conn.execute(
                """
                CREATE TABLE technical_scores (
                    symbol TEXT PRIMARY KEY,
                    score_1m INTEGER,
                    score_5m INTEGER,
                    score_15m INTEGER,
                    score_1h INTEGER,
                    score_4h INTEGER,
                    score_1d INTEGER,
                    score_1w INTEGER,
                    last_updated_utc TEXT
                )
                """
            )
            conn.execute(
                """
                INSERT INTO technical_scores (
                    symbol, score_1m, score_5m, score_15m, score_1h, score_4h,
                    score_1d, score_1w, last_updated_utc
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ("AAPL", 10, 20, 30, 40, 72, 50, 60, "2026-01-01T00:00:00"),
            )
            conn.commit()

        @contextmanager
        def _tmp_session(_path=None):
            c = sqlite3.connect(_MEM_DB_URI, uri=True)
            try:
                yield c
                c.commit()
            except Exception:
                c.rollback()
                raise
            finally:
                c.close()

        with patch.object(score_worker, "sync_db_session", _tmp_session):
            rows = score_worker.read_scores_for_timeframes(["AAPL"], ["4h"])

        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["symbol"], "AAPL")
        self.assertEqual(row["4h"], 72)
        self.assertEqual(row["status_4h"], "ok")
        self.assertIsNone(row.get("bars_4h"))


if __name__ == "__main__":
    unittest.main()
