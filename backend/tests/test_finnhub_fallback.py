from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import worker_watchlist


class FinnhubFallbackTests(unittest.TestCase):
    def test_load_finnhub_api_key_defaults_missing_or_old_settings(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            settings_path = Path(tmp) / "tws-settings.json"

            self.assertEqual(worker_watchlist._load_finnhub_api_key(settings_path), "")

            settings_path.write_text(json.dumps({"clientId": 1234}), encoding="utf-8")
            self.assertEqual(worker_watchlist._load_finnhub_api_key(settings_path), "")

            settings_path.write_text(
                json.dumps({"clientId": 1234, "finnhubApiKey": "  abc123  "}),
                encoding="utf-8",
            )
            self.assertEqual(worker_watchlist._load_finnhub_api_key(settings_path), "abc123")

    def test_finnhub_quote_normalization(self) -> None:
        quote = worker_watchlist._finnhub_quote_to_quote(
            "AAPL",
            {"c": 201.5, "o": 200.0, "h": 202.0, "l": 199.5, "pc": 198.0},
        )

        self.assertIsNotNone(quote)
        assert quote is not None
        self.assertEqual(quote["symbol"], "AAPL")
        self.assertEqual(quote["source"], "finnhub")
        self.assertEqual(quote["last"], 201.5)
        self.assertEqual(quote["prev_close"], 198.0)
        self.assertEqual(quote["change"], 3.5)
        self.assertAlmostEqual(quote["change_pct"], round((3.5 / 198.0) * 100, 4))

    def test_watchlist_fallback_uses_yahoo_when_finnhub_fails(self) -> None:
        yahoo_quotes = [{"symbol": "AAPL", "last": 100.0, "source": "yahoo"}]
        with patch.object(worker_watchlist, "_load_finnhub_api_key", return_value="bad-key"):
            with patch(
                "dailyiq_provider.fetch_watchlist_quotes_from_dailyiq",
                return_value=[],
            ):
                with patch.object(
                    worker_watchlist,
                    "fetch_quotes_from_finnhub",
                    side_effect=RuntimeError("HTTP 401"),
                ):
                    with patch.object(
                        worker_watchlist,
                        "fetch_watchlist_quotes_from_yahoo",
                        return_value=yahoo_quotes,
                    ) as yahoo_mock:
                        source, quotes = worker_watchlist.fetch_watchlist_quotes_with_fallback(["AAPL"])

        self.assertEqual(source, "yahoo")
        self.assertEqual(quotes, yahoo_quotes)
        yahoo_mock.assert_called_once_with(["AAPL"])

    def test_watchlist_prefers_dailyiq_when_available(self) -> None:
        diq_quotes = [{"symbol": "AAPL", "last": 101.0, "source": "dailyiq"}]
        with patch.dict(os.environ, {"DAILYIQ_API_KEY": "test-key"}, clear=False):
            with patch.object(worker_watchlist, "_load_finnhub_api_key", return_value="bad-key"):
                with patch(
                    "dailyiq_provider.fetch_watchlist_quotes_from_dailyiq",
                    return_value=diq_quotes,
                ):
                    with patch.object(worker_watchlist, "fetch_watchlist_quotes_from_yahoo") as yahoo_mock:
                        source, quotes = worker_watchlist.fetch_watchlist_quotes_with_fallback(["AAPL"])

        self.assertEqual(source, "dailyiq")
        self.assertEqual(quotes, diq_quotes)
        yahoo_mock.assert_not_called()

    def test_watchlist_logs_when_dailyiq_key_missing(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with patch.object(worker_watchlist, "_load_finnhub_api_key", return_value=""):
                with patch(
                    "dailyiq_provider.fetch_watchlist_quotes_from_dailyiq",
                    return_value=[],
                ):
                    with patch.object(worker_watchlist, "fetch_watchlist_quotes_from_yahoo", return_value=[]):
                        with self.assertLogs("watchlist-worker", level="INFO") as logs:
                            source, quotes = worker_watchlist.fetch_watchlist_quotes_with_fallback(["AAPL"])

        self.assertEqual(source, "yahoo")
        self.assertEqual(quotes, [])
        self.assertTrue(
            any("DAILYIQ_API_KEY is not set" in message for message in logs.output),
            logs.output,
        )


if __name__ == "__main__":
    unittest.main()
