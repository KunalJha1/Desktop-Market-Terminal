from __future__ import annotations

import tempfile
import unittest
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import db_utils
import options_collector


class OptionsCollectorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "market.db"
        db_utils._schema_ready = False

    def tearDown(self) -> None:
        db_utils._schema_ready = False
        self.tmpdir.cleanup()

    def test_schema_includes_expanded_options_columns(self) -> None:
        with db_utils.sync_db_session(self.db_path) as conn:
            contract_cols = {
                row[1]
                for row in conn.execute("PRAGMA table_info(option_contracts)").fetchall()
            }
            snapshot_cols = {
                row[1]
                for row in conn.execute("PRAGMA table_info(option_snapshots)").fetchall()
            }
            fetch_meta_cols = {
                row[1]
                for row in conn.execute("PRAGMA table_info(option_chain_fetch_meta)").fetchall()
            }

        self.assertTrue(
            {"exchange", "exercise_style", "last_seen_at"}.issubset(contract_cols)
        )
        self.assertTrue(
            {
                "bid_size",
                "ask_size",
                "intrinsic_value",
                "extrinsic_value",
                "days_to_expiration",
                "risk_free_rate",
                "greeks_source",
                "iv_source",
                "calc_error",
            }.issubset(snapshot_cols)
        )
        self.assertTrue(
            {"success", "error_message", "duration_ms"}.issubset(fetch_meta_cols)
        )

    def test_build_symbol_queue_preserves_priority_and_deduplicates(self) -> None:
        queue = options_collector.build_symbol_queue(
            ["spy", "aapl", "msft"],
            ["msft", "tsla", "spy"],
            ["qqq", "aapl", "nvda"],
        )
        self.assertEqual(queue, ["SPY", "AAPL", "MSFT", "TSLA", "QQQ", "NVDA"])

    def test_options_data_present_detects_existing_snapshots(self) -> None:
        self.assertFalse(options_collector.options_data_present(self.db_path))
        with db_utils.sync_db_session(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO option_contracts (
                    contract_id, underlying, expiration, strike, option_type,
                    contract_size, currency, exchange, exercise_style, created_at, last_seen_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "AAPL260417C00100000",
                    "AAPL",
                    1_776_384_000_000,
                    100.0,
                    "call",
                    "REGULAR",
                    "USD",
                    None,
                    None,
                    1_710_000_000_000,
                    1_710_000_000_000,
                ),
            )
            conn.execute(
                """
                INSERT INTO option_snapshots (
                    contract_id, captured_at, underlying_price, bid, ask, bid_size, ask_size, mid,
                    last_price, change, change_pct, volume, open_interest, implied_volatility,
                    in_the_money, last_trade_date, delta, gamma, theta, vega, rho,
                    intrinsic_value, extrinsic_value, days_to_expiration, risk_free_rate,
                    greeks_source, iv_source, calc_error, source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "AAPL260417C00100000",
                    1_710_000_000_000,
                    102.0,
                    4.9,
                    5.1,
                    None,
                    None,
                    5.0,
                    5.0,
                    0.5,
                    11.1,
                    123,
                    456,
                    0.24,
                    1,
                    1_710_000_000_000,
                    0.55,
                    0.03,
                    -0.04,
                    0.11,
                    0.02,
                    2.0,
                    3.0,
                    24.0,
                    0.05,
                    "provider",
                    "provider",
                    None,
                    "yahoo",
                ),
            )
        self.assertTrue(options_collector.options_data_present(self.db_path))

    def test_calculate_option_metrics_falls_back_to_computed_greeks(self) -> None:
        metrics = options_collector.calculate_option_metrics(
            option_type="call",
            underlying_price=100.0,
            strike=100.0,
            expiration_ms=options_collector._now_ms() + (30 * 24 * 60 * 60 * 1000),
            captured_at_ms=options_collector._now_ms(),
            bid=4.8,
            ask=5.2,
            mid=5.0,
            last_price=5.05,
            provider_iv=None,
            provider_delta=None,
            provider_gamma=None,
            provider_theta=None,
            provider_vega=None,
            provider_rho=None,
            risk_free_rate=0.05,
        )
        self.assertEqual(metrics.greeks_source, "calculated")
        self.assertEqual(metrics.iv_source, "calculated")
        self.assertIsNone(metrics.calc_error)
        self.assertIsNotNone(metrics.implied_volatility)
        self.assertIsNotNone(metrics.delta)
        self.assertIsNotNone(metrics.gamma)
        self.assertIsNotNone(metrics.theta)
        self.assertIsNotNone(metrics.vega)
        self.assertIsNotNone(metrics.rho)

    def test_normalize_option_chain_df_maps_contracts_and_snapshots(self) -> None:
        expiration = pd.Timestamp("2026-04-17")
        last_trade = pd.Timestamp("2026-03-24 14:30:00")
        chain_df = pd.DataFrame(
            [
                {
                    "contractSymbol": "AAPL260417C00100000",
                    "strike": 100.0,
                    "currency": "USD",
                    "contractSize": "REGULAR",
                    "lastPrice": 5.0,
                    "change": 0.5,
                    "percentChange": 11.1,
                    "volume": 123,
                    "openInterest": 456,
                    "bid": 4.9,
                    "ask": 5.1,
                    "impliedVolatility": 0.24,
                    "inTheMoney": True,
                    "lastTradeDate": last_trade,
                    "delta": None,
                    "gamma": None,
                    "theta": None,
                    "vega": None,
                    "rho": None,
                    "exchange": "OPR",
                    "exerciseStyle": "american",
                }
            ],
            index=pd.MultiIndex.from_tuples(
                [("AAPL", expiration, "calls")],
                names=["symbol", "expiration", "optionType"],
            ),
        )

        contracts, snapshots, expiration_count = options_collector.normalize_option_chain_df(
            "AAPL",
            chain_df,
            underlying_price=102.0,
            captured_at_ms=1_710_000_000_000,
            source="yahoo",
            risk_free_rate=0.05,
        )

        self.assertEqual(expiration_count, 1)
        self.assertEqual(len(contracts), 1)
        self.assertEqual(len(snapshots), 1)
        self.assertEqual(contracts[0][0], "AAPL260417C00100000")
        self.assertEqual(contracts[0][1], "AAPL")
        self.assertEqual(contracts[0][4], "call")
        self.assertEqual(contracts[0][7], "OPR")
        self.assertEqual(contracts[0][8], "american")
        self.assertEqual(snapshots[0][0], "AAPL260417C00100000")
        self.assertEqual(snapshots[0][3], 4.9)
        self.assertEqual(snapshots[0][4], 5.1)
        self.assertEqual(snapshots[0][7], 5.0)
        self.assertEqual(snapshots[0][14], 1)
        self.assertEqual(snapshots[0][25], "calculated")
        self.assertEqual(snapshots[0][26], "provider")


if __name__ == "__main__":
    unittest.main()
