from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import db_utils
import worker_valuations


class ValuationSchedulerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "market.db"
        self.state_path = Path(self.tmpdir.name) / "updated_ytc.json"

    def tearDown(self) -> None:
        self.tmpdir.cleanup()

    def test_reads_missing_state_as_none(self) -> None:
        self.assertIsNone(worker_valuations.read_last_success_ms(self.state_path))

    def test_writes_and_reads_last_success_marker(self) -> None:
        worker_valuations.write_last_success_ms(1234567890, self.state_path)
        self.assertEqual(worker_valuations.read_last_success_ms(self.state_path), 1234567890)

    def test_first_bootstrap_runs_immediately(self) -> None:
        self.assertTrue(worker_valuations.should_run_cycle(1_700_000_000_000, None))

    def test_interval_gate_skips_early_runs(self) -> None:
        now_ms = 1_700_000_000_000
        last_success_ms = now_ms - int((worker_valuations.INTERVAL_S - 10) * 1000)
        self.assertFalse(worker_valuations.should_run_cycle(now_ms, last_success_ms))

    def test_interval_gate_allows_daily_runs(self) -> None:
        now_ms = 1_700_000_000_000
        last_success_ms = now_ms - int((worker_valuations.INTERVAL_S + 10) * 1000)
        self.assertTrue(worker_valuations.should_run_cycle(now_ms, last_success_ms))

    def test_seconds_until_next_run_is_zero_for_bootstrap(self) -> None:
        self.assertEqual(worker_valuations.seconds_until_next_run(1_700_000_000_000, None), 0.0)


if __name__ == "__main__":
    unittest.main()
