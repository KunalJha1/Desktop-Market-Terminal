from __future__ import annotations

import tempfile
import unittest
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import db_utils
import main


class OptionsApiReadTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "market.db"
        db_utils._schema_ready = False

    def tearDown(self) -> None:
        db_utils._schema_ready = False
        self.tmpdir.cleanup()

    def _seed_option(self, contract_id: str, expiration: int, option_type: str, strike: float, captured_at: int, bid: float) -> None:
        with db_utils.sync_db_session(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO option_contracts (
                    contract_id, underlying, expiration, strike, option_type,
                    contract_size, currency, exchange, exercise_style, created_at, last_seen_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    contract_id,
                    "AAPL",
                    expiration,
                    strike,
                    option_type,
                    "REGULAR",
                    "USD",
                    "OPR",
                    "american",
                    captured_at,
                    captured_at,
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
                    contract_id,
                    captured_at,
                    201.0,
                    bid,
                    bid + 0.2,
                    None,
                    None,
                    bid + 0.1,
                    bid + 0.15,
                    0.3,
                    1.2,
                    10,
                    100,
                    0.25,
                    1 if option_type == "call" else 0,
                    captured_at,
                    0.5,
                    0.03,
                    -0.02,
                    0.08,
                    0.01,
                    2.0,
                    3.0,
                    25.0,
                    0.05,
                    "provider",
                    "provider",
                    None,
                    "yahoo",
                ),
            )

    def test_read_options_summary_groups_expirations_by_month(self) -> None:
        captured_at = 1_710_000_000_000
        self._seed_option("AAPL260419C00190000", 1_713_484_800_000, "call", 190.0, captured_at, 12.0)
        self._seed_option("AAPL260426P00190000", 1_714_089_600_000, "put", 190.0, captured_at, 11.0)
        self._seed_option("AAPL260517C00195000", 1_715_904_000_000, "call", 195.0, captured_at, 10.0)

        with patch.object(main, "sync_db_session", lambda: db_utils.sync_db_session(self.db_path)):
            summary = main.read_options_summary("AAPL")

        self.assertTrue(summary["hasData"])
        self.assertEqual(summary["symbol"], "AAPL")
        self.assertEqual(summary["capturedAt"], captured_at)
        self.assertEqual(len(summary["months"]), 2)
        self.assertEqual(summary["months"][0]["monthKey"], "2024-04")
        self.assertEqual(len(summary["months"][0]["expirations"]), 2)
        self.assertEqual(summary["months"][1]["monthKey"], "2024-05")

    def test_read_options_chain_joins_calls_and_puts_by_strike(self) -> None:
        captured_at = 1_710_000_000_000
        expiration = 1_713_484_800_000
        self._seed_option("AAPL260419C00190000", expiration, "call", 190.0, captured_at, 12.0)
        self._seed_option("AAPL260419P00190000", expiration, "put", 190.0, captured_at, 8.0)
        self._seed_option("AAPL260419C00200000", expiration, "call", 200.0, captured_at, 7.0)

        with patch.object(main, "sync_db_session", lambda: db_utils.sync_db_session(self.db_path)):
            chain = main.read_options_chain("AAPL", expiration)

        self.assertTrue(chain["hasData"])
        self.assertEqual(chain["expiration"], expiration)
        self.assertEqual(len(chain["rows"]), 2)
        self.assertEqual(chain["rows"][0]["strike"], 190.0)
        self.assertIsNotNone(chain["rows"][0]["call"])
        self.assertIsNotNone(chain["rows"][0]["put"])
        self.assertEqual(chain["rows"][1]["strike"], 200.0)
        self.assertIsNotNone(chain["rows"][1]["call"])
        self.assertIsNone(chain["rows"][1]["put"])


if __name__ == "__main__":
    unittest.main()
