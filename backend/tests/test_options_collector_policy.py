from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from options_collector import (  # noqa: E402
    DEFAULT_SOURCE,
    YahooOptionsProvider,
    collect_symbol,
    run_collection_cycle,
)
from options_ib import (  # noqa: E402
    filter_upcoming_expiries,
    probe_tws_tcp,
    yyyymmdd_to_expiration_ms,
)


class OptionsIbHelpersTests(unittest.TestCase):
    def test_yyyymmdd_to_expiration_ms(self) -> None:
        ms = yyyymmdd_to_expiration_ms("20250418")
        self.assertIsNotNone(ms)
        self.assertGreater(ms, 0)

    def test_filter_upcoming_expiries_sorts_and_caps(self) -> None:
        out = filter_upcoming_expiries(["20261219", "20260116", "20250301"], count=2)
        self.assertLessEqual(len(out), 2)


class OptionsCollectorPolicyTests(unittest.TestCase):
    def test_default_source_is_auto(self) -> None:
        self.assertEqual(DEFAULT_SOURCE, "auto")

    def test_collect_symbol_tws_mode_unreachable_records_failure_meta(self) -> None:
        cap = 1_800_000_000_000
        with patch("options_collector._write_fetch_meta") as meta:
            exp, cnt = collect_symbol(
                None,
                "ZZZ",
                captured_at_ms=cap,
                risk_free_rate=0.045,
                source_mode="tws",
                tws_reachable=False,
                tws_host=None,
                tws_port=None,
            )
        self.assertEqual((exp, cnt), (0, 0))
        meta.assert_called_once()
        args = meta.call_args[0]
        self.assertEqual(args[0], "ZZZ")
        self.assertEqual(args[1], "tws")
        self.assertEqual(args[3], 0)
        self.assertEqual(args[4], 0)
        self.assertFalse(args[5])
        self.assertIn("reachable", (args[6] or "").lower())

    def test_auto_tws_success_skips_yahoo(self) -> None:
        cap = 1_800_000_000_000
        c_row = (
            "IB:999",
            "AAPL",
            yyyymmdd_to_expiration_ms("20261219") or cap,
            100.0,
            "call",
            "REGULAR",
            "USD",
            "SMART",
            None,
            cap,
            cap,
        )
        s_row = (
            "IB:999",
            cap,
            100.0,
            1.0,
            1.1,
            1,
            1,
            1.05,
            1.08,
            None,
            None,
            10,
            100,
            0.2,
            1,
            None,
            0.5,
            0.01,
            -0.02,
            0.03,
            None,
            1.0,
            2.0,
            30.0,
            0.045,
            "provider",
            "provider",
            None,
            "tws",
        )
        with patch("options_ib.collect_tws_option_chain_sync", return_value=([c_row], [s_row], 1)):
            with patch("options_collector._write_option_rows") as write_rows:
                with patch("options_collector._write_fetch_meta") as meta:
                    with patch("options_collector._collect_yahoo_symbol") as yahoo:
                        collect_symbol(
                            YahooOptionsProvider(),
                            "AAPL",
                            captured_at_ms=cap,
                            risk_free_rate=0.045,
                            source_mode="auto",
                            tws_reachable=True,
                            tws_host="127.0.0.1",
                            tws_port=7497,
                        )
        yahoo.assert_not_called()
        write_rows.assert_called_once_with([c_row], [s_row])
        meta.assert_called_once()
        self.assertEqual(meta.call_args[0][1], "tws")

    def test_auto_empty_tws_falls_back_to_yahoo(self) -> None:
        cap = 1_800_000_000_000
        with patch("options_ib.collect_tws_option_chain_sync", return_value=([], [], 0)):
            with patch(
                "options_collector._collect_yahoo_symbol",
                return_value=(2, 40),
            ) as yahoo:
                collect_symbol(
                    YahooOptionsProvider(),
                    "AAPL",
                    captured_at_ms=cap,
                    risk_free_rate=0.045,
                    source_mode="auto",
                    tws_reachable=True,
                    tws_host="127.0.0.1",
                    tws_port=7497,
                )
        yahoo.assert_called_once()

    def test_run_collection_cycle_yahoo_rejects_invalid_source(self) -> None:
        with self.assertRaises(ValueError):
            run_collection_cycle(source="finnhub")

    @patch("options_collector._probe_tws_for_options_cycle", return_value=(False, None, None))
    @patch("options_collector.load_symbol_queue", return_value=["AAPL"])
    @patch("options_collector._collect_yahoo_symbol", return_value=(1, 10))
    def test_run_collection_cycle_auto_probes_tws(
        self,
        mock_yahoo: MagicMock,
        mock_queue: MagicMock,
        mock_probe: MagicMock,
    ) -> None:
        run_collection_cycle(source="auto", max_symbols=1)
        mock_probe.assert_called_once()


class ProbeTwsTcpTests(unittest.TestCase):
    @patch("options_ib.socket.create_connection")
    def test_probe_returns_first_open_port(self, mock_conn: MagicMock) -> None:
        mock_conn.return_value = MagicMock()
        port = probe_tws_tcp("127.0.0.1", (7497, 7496), timeout=1.0)
        self.assertEqual(port, 7497)

    @patch("options_ib.socket.create_connection", side_effect=OSError("refused"))
    def test_probe_returns_none_when_all_fail(self, _mock: MagicMock) -> None:
        port = probe_tws_tcp("127.0.0.1", (7497,), timeout=0.1)
        self.assertIsNone(port)


if __name__ == "__main__":
    unittest.main()
