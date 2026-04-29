from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import db_utils
import historical
import main
from fastapi.testclient import TestClient


class ChartIntentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "market.db"
        db_utils._schema_ready = False
        historical._schema_initialized = False
        self.db_patch = patch.object(db_utils, "DB_PATH", self.db_path)
        self.db_patch.start()

    def tearDown(self) -> None:
        self.db_patch.stop()
        db_utils._schema_ready = False
        historical._schema_initialized = False
        self.tmpdir.cleanup()

    def _read_chart_intents(self) -> list[tuple]:
        with db_utils.sync_db_session(self.db_path) as conn:
            return conn.execute(
                """
                SELECT symbol, bar_size, what_to_show, priority_rank
                FROM chart_intents
                ORDER BY priority_rank ASC
                """
            ).fetchall()

    def test_touch_updates_existing_intent_in_place(self) -> None:
        with patch.object(historical.time, "time", side_effect=[1000.0, 1005.0, 1005.5]):
            historical.touch_chart_intent("AAPL", "1 min", "TRADES")
            historical.touch_chart_intent("AAPL", "1m", "TRADES")
            intents = historical.read_fresh_chart_intents(6)

        self.assertEqual(len(intents), 1)
        self.assertEqual(intents[0]["symbol"], "AAPL")
        self.assertEqual(intents[0]["bar_size"], "1m")
        self.assertEqual(intents[0]["priority_rank"], 1)

    def test_rapid_switches_preserve_recent_intents_in_order(self) -> None:
        with patch.object(historical.time, "time", side_effect=[1000.0, 1001.0, 1002.0, 1002.5]):
            historical.touch_chart_intent("AAPL", "1 min", "TRADES")
            historical.touch_chart_intent("AAPL", "15 mins", "TRADES")
            historical.touch_chart_intent("MSFT", "1 day", "TRADES")
            intents = historical.read_fresh_chart_intents(6)

        self.assertEqual(
            [(item["symbol"], item["bar_size"], item["priority_rank"]) for item in intents],
            [("MSFT", "1d", 1), ("AAPL", "15m", 2), ("AAPL", "1m", 3)],
        )

    def test_prune_removes_expired_and_trims_to_latest_six(self) -> None:
        with db_utils.sync_db_session(self.db_path) as conn:
            rows = [("OLD", "1m", "TRADES", 900000, None, 8)]
            rows.extend(
                (f"S{idx}", "1m", "TRADES", (1000 + idx) * 1000, None, 7 - idx)
                for idx in range(7)
            )
            conn.executemany(
                """
                INSERT INTO chart_intents (
                    symbol, bar_size, what_to_show, last_requested, last_served, priority_rank
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                rows,
            )

        with patch.object(historical.time, "time", return_value=1060.0):
            pruned = historical.prune_chart_intents(ttl_s=90.0, max_rows=6)
            intents = historical.read_fresh_chart_intents(10)

        self.assertEqual(pruned, 2)
        self.assertEqual(len(intents), 6)
        self.assertNotIn("OLD", [row[0] for row in self._read_chart_intents()])
        self.assertEqual([item["symbol"] for item in intents], ["S6", "S5", "S4", "S3", "S2", "S1"])

    def test_main_reads_refresh_intents_from_chart_intents_not_active_symbols(self) -> None:
        with patch.object(historical.time, "time", return_value=2000.0):
            historical.touch_chart_intent("NVDA", "15 mins", "TRADES")

        with db_utils.sync_db_session(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO active_symbols (symbol, last_requested, bar_size)
                VALUES (?, ?, ?)
                """,
                ("TSLA", 999999999999, "1d"),
            )

        with patch.object(historical.time, "time", return_value=2000.5):
            intents = main._read_chart_refresh_intents()

        self.assertEqual(len(intents), 1)
        self.assertEqual(intents[0]["symbol"], "NVDA")
        self.assertEqual(intents[0]["bar_size"], "15m")

    def test_refresh_plan_collapses_intraday_and_daily_fetches_per_symbol(self) -> None:
        plan = main._build_chart_refresh_plan(
            [
                {"symbol": "AAPL", "bar_size": "1m"},
                {"symbol": "AAPL", "bar_size": "15m"},
                {"symbol": "AAPL", "bar_size": "1d"},
                {"symbol": "MSFT", "bar_size": "1d"},
            ]
        )

        self.assertEqual(
            plan,
            [
                {
                    "symbol": "AAPL",
                    "fetch_1m": True,
                    "fetch_1d": True,
                    "bar_sizes": ["1m", "15m", "1d"],
                },
                {
                    "symbol": "MSFT",
                    "fetch_1m": False,
                    "fetch_1d": True,
                    "bar_sizes": ["1d"],
                },
            ],
        )

    def test_historical_window_returns_cached_bars_before_live_refresh(self) -> None:
        with db_utils.sync_db_session(self.db_path) as conn:
            historical._init_schema(conn)
            historical._write_bars(
                conn,
                "AAPL",
                [
                    {"time": 1_000, "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.5, "volume": 100},
                ],
                bar_size="1m",
                source="cache",
            )

        def _fake_dailyiq_refresh(*args, **kwargs):
            with db_utils.sync_db_session(self.db_path) as conn:
                historical._init_schema(conn)
                historical._write_bars(
                    conn,
                    "AAPL",
                    [
                        {"time": 2_000, "open": 10.6, "high": 11.2, "low": 10.4, "close": 11.0, "volume": 150},
                    ],
                    bar_size="1m",
                    source="dailyiq",
                )
            return (
                [
                    {"time": 2_000, "open": 10.6, "high": 11.2, "low": 10.4, "close": 11.0, "volume": 150},
                ],
                "dailyiq",
            )

        with patch.object(main, "sync_db_session", db_utils.sync_db_session), \
             patch.object(main, "run_db", db_utils.run_db), \
             patch.object(main, "get_historical_bars", side_effect=_fake_dailyiq_refresh):
            with TestClient(main.create_app()) as client:
                response = client.get(
                    "/historical",
                    params={
                        "symbol": "AAPL",
                        "bar_size": "1 min",
                        "ts_start": 0,
                        "prefer_live_refresh": "1",
                    },
                )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["source"], "cache")
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["bars"][-1]["time"], 1_000)


if __name__ == "__main__":
    unittest.main()
