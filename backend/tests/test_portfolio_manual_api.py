from __future__ import annotations

import tempfile
import unittest
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

import db_utils
import main


class ManualPortfolioApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "market.db"
        db_utils._schema_ready = False
        self.db_patch = patch.object(db_utils, "DB_PATH", self.db_path)
        self.main_db_patch = patch.object(main, "sync_db_session", db_utils.sync_db_session)
        self.run_db_patch = patch.object(main, "run_db", db_utils.run_db)
        self.live_patch = patch.object(
            main,
            "read_live_portfolio_snapshot_cached_async",
            AsyncMock(return_value={
                "connected": False,
                "host": "127.0.0.1",
                "port": None,
                "accounts": [
                    {
                        "id": "ibkr:DU123",
                        "name": "DU123",
                        "source": "ibkr",
                        "editable": False,
                        "accountCode": "DU123",
                    }
                ],
                "positions": [],
                "cashBalances": [],
                "updatedAt": 100,
            }),
        )
        self.db_patch.start()
        self.main_db_patch.start()
        self.run_db_patch.start()
        self.live_patch.start()
        self._test_client_cm = TestClient(main.create_app())
        self.client = self._test_client_cm.__enter__()

    def tearDown(self) -> None:
        self._test_client_cm.__exit__(None, None, None)
        self.live_patch.stop()
        self.run_db_patch.stop()
        self.main_db_patch.stop()
        self.db_patch.stop()
        db_utils._schema_ready = False
        self.tmpdir.cleanup()

    def test_manual_accounts_groups_and_positions_are_returned_in_unified_portfolio(self) -> None:
        create_account = self.client.post("/portfolio/manual/accounts", json={"name": "Paper Alpha"})
        self.assertEqual(create_account.status_code, 200)
        account_id = create_account.json()["id"]

        create_group = self.client.post("/portfolio/manual/groups", json={
            "name": "Core",
            "accountIds": [f"manual:{account_id}", "ibkr:DU123"],
        })
        self.assertEqual(create_group.status_code, 200)
        group_id = create_group.json()["id"]

        create_position = self.client.post(f"/portfolio/manual/accounts/{account_id}/positions", json={
            "symbol": "AAPL",
            "quantity": 10,
            "avgCost": 150,
            "currency": "USD",
        })
        self.assertEqual(create_position.status_code, 200)

        create_cash = self.client.post(f"/portfolio/manual/accounts/{account_id}/cash-balances", json={
            "currency": "USD",
            "balance": 2500,
        })
        self.assertEqual(create_cash.status_code, 200)

        snapshot = self.client.get("/portfolio")
        self.assertEqual(snapshot.status_code, 200)
        payload = snapshot.json()

        manual_account = next(account for account in payload["accounts"] if account["id"] == f"manual:{account_id}")
        self.assertTrue(manual_account["editable"])
        self.assertEqual(manual_account["groupIds"], [group_id])

        group = next(item for item in payload["groups"] if item["id"] == group_id)
        self.assertCountEqual(group["accountIds"], [f"manual:{account_id}", "ibkr:DU123"])

        position = next(item for item in payload["positions"] if item["source"] == "manual")
        self.assertEqual(position["symbol"], "AAPL")
        self.assertEqual(position["accountId"], f"manual:{account_id}")
        self.assertEqual(position["costBasis"], 1500)

        cash = next(item for item in payload["cashBalances"] if item["source"] == "manual")
        self.assertEqual(cash["balance"], 2500)

    def test_updating_manual_account_replaces_group_memberships(self) -> None:
        account_response = self.client.post("/portfolio/manual/accounts", json={"name": "Paper Beta"})
        account_id = account_response.json()["id"]
        group_one = self.client.post("/portfolio/manual/groups", json={"name": "One", "accountIds": []}).json()["id"]
        group_two = self.client.post("/portfolio/manual/groups", json={"name": "Two", "accountIds": []}).json()["id"]

        update = self.client.put(f"/portfolio/manual/accounts/{account_id}", json={
            "name": "Paper Beta Updated",
            "groupIds": [group_two],
        })
        self.assertEqual(update.status_code, 200)

        snapshot = self.client.get("/portfolio").json()
        manual_account = next(account for account in snapshot["accounts"] if account["id"] == f"manual:{account_id}")
        self.assertEqual(manual_account["name"], "Paper Beta Updated")
        self.assertEqual(manual_account["groupIds"], [group_two])

        groups = {group["id"]: group for group in snapshot["groups"]}
        self.assertEqual(groups[group_one]["accountIds"], [])
        self.assertEqual(groups[group_two]["accountIds"], [f"manual:{account_id}"])


if __name__ == "__main__":
    unittest.main()
