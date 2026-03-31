from __future__ import annotations

import tempfile
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import db_utils


class SchemaInitTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "market.db"
        db_utils._schema_ready = False

    def tearDown(self) -> None:
        db_utils._schema_ready = False
        self.tmpdir.cleanup()

    def test_sync_db_session_creates_base_and_historical_tables(self) -> None:
        with db_utils.sync_db_session(self.db_path) as conn:
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }

        expected = {
            "technical_scores",
            "watchlist_symbols",
            "watchlist_quotes",
            "watchlist_status",
            "market_snapshots",
            "active_symbols",
            "ibkr_client_leases",
            "portfolio_manual_accounts",
            "portfolio_manual_positions",
            "portfolio_manual_cash_balances",
            "portfolio_groups",
            "portfolio_group_memberships",
            "portfolio_ibkr_snapshot",
            "ohlcv_1m",
            "ohlcv_1m_bid",
            "ohlcv_1m_ask",
            "ohlcv_1d",
            "ohlcv_1d_bid",
            "ohlcv_1d_ask",
            "ohlcv_5s",
            "fetch_meta",
            "option_contracts",
            "option_snapshots",
            "option_chain_fetch_meta",
        }
        self.assertTrue(expected.issubset(tables), expected - tables)

    def test_fresh_db_has_ohlcv_1d_before_snapshot_queries(self) -> None:
        with db_utils.sync_db_session(self.db_path) as conn:
            conn.execute("""
                INSERT INTO market_snapshots (
                    symbol, last, source, status, updated_at
                ) VALUES (?, ?, ?, ?, ?)
            """, ("NVDA", 100.0, "test", "ok", 0))
            row = conn.execute(
                "SELECT MAX(high), MIN(low) FROM ohlcv_1d WHERE symbol = ? AND ts >= ?",
                ("NVDA", 0),
            ).fetchone()

        self.assertEqual(row, (None, None))


if __name__ == "__main__":
    unittest.main()
