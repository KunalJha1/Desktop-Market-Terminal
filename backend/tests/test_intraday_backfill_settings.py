from __future__ import annotations

import json
import shutil
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from historical import get_background_intraday_duration, get_background_intraday_years


class IntradayBackfillSettingsTests(unittest.TestCase):
    def _make_temp_dir(self, name: str) -> Path:
        root = Path(__file__).resolve().parents[2] / ".tmp-tests"
        path = root / name
        if path.exists():
            shutil.rmtree(path)
        path.mkdir(parents=True, exist_ok=True)
        self.addCleanup(lambda: shutil.rmtree(path, ignore_errors=True))
        return path

    def test_missing_settings_uses_default(self) -> None:
        missing = self._make_temp_dir("intraday-backfill-missing") / "missing.json"
        self.assertEqual(get_background_intraday_years(missing), 2)
        self.assertEqual(get_background_intraday_duration(missing), "2 Y")

    def test_saved_years_value_is_used(self) -> None:
        settings = self._make_temp_dir("intraday-backfill-used") / "tws-settings.json"
        settings.write_text(json.dumps({"intradayBackfillYears": 7}), encoding="utf-8")
        self.assertEqual(get_background_intraday_years(settings), 7)
        self.assertEqual(get_background_intraday_duration(settings), "7 Y")

    def test_saved_years_value_is_clamped(self) -> None:
        settings = self._make_temp_dir("intraday-backfill-clamped") / "tws-settings.json"
        settings.write_text(json.dumps({"intradayBackfillYears": 99}), encoding="utf-8")
        self.assertEqual(get_background_intraday_years(settings), 30)
        self.assertEqual(get_background_intraday_duration(settings), "30 Y")


if __name__ == "__main__":
    unittest.main()
