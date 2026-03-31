from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import db_utils
import main


LIVE_SNAPSHOT = {
    "connected": True,
    "host": "127.0.0.1",
    "port": 7497,
    "accounts": [
        {
            "id": "ibkr:DU111111",
            "name": "DU111111",
            "source": "ibkr",
            "editable": False,
            "accountCode": "DU111111",
        }
    ],
    "positions": [
        {
            "accountId": "ibkr:DU111111",
            "account": "DU111111",
            "accountCode": "DU111111",
            "source": "ibkr",
            "editable": False,
            "symbol": "SPY",
            "name": "SPY",
            "currency": "USD",
            "exchange": "SMART",
            "primaryExchange": "ARCA",
            "secType": "STK",
            "quantity": 10.0,
            "avgCost": 500.0,
            "costBasis": 5000.0,
            "currentPrice": None,
            "marketValue": None,
            "unrealizedPnl": None,
            "realizedPnl": None,
        }
    ],
    "cashBalances": [],
    "updatedAt": 1234,
}


class ManualPortfolioApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "market.db"
        db_utils._schema_ready = False
        self.db_patch = patch.object(db_utils, "DB_PATH", self.db_path)
        self.live_patch = patch.object(
            main,
            "read_live_portfolio_snapshot_cached_async",
            AsyncMock(return_value=LIVE_SNAPSHOT),
        )
        self.db_patch.start()
        self.live_patch.start()
        self._test_client_cm = TestClient(main.create_app())
        self.client = self._test_client_cm.__enter__()

    def tearDown(self) -> None:
        self._test_client_cm.__exit__(None, None, None)
        self.live_patch.stop()
        self.db_patch.stop()
        db_utils._schema_ready = False
        self.tmpdir.cleanup()

    def test_schema_includes_manual_portfolio_tables(self) -> None:
        with db_utils.sync_db_session(self.db_path) as conn:
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }

        self.assertTrue(
            {
                "portfolio_manual_accounts",
                "portfolio_manual_positions",
                "portfolio_manual_cash_balances",
                "portfolio_groups",
                "portfolio_group_memberships",
                "portfolio_ibkr_snapshot",
            }.issubset(tables)
        )

    def test_unified_portfolio_includes_manual_accounts_groups_positions_and_cash(self) -> None:
        create_account = self.client.post("/portfolio/manual/accounts", json={"name": "Paper Account", "groupIds": []})
        self.assertEqual(create_account.status_code, 200)
        account_id = create_account.json()["id"]

        create_position = self.client.post(
            f"/portfolio/manual/accounts/{account_id}/positions",
            json={"symbol": "AAPL", "quantity": 5, "avgCost": 180, "currency": "usd"},
        )
        self.assertEqual(create_position.status_code, 200)

        create_cash = self.client.post(
            f"/portfolio/manual/accounts/{account_id}/cash-balances",
            json={"currency": "usd", "balance": 2500},
        )
        self.assertEqual(create_cash.status_code, 200)

        create_group = self.client.post(
            "/portfolio/manual/groups",
            json={
                "name": "Blended",
                "accountIds": ["ibkr:DU111111", f"manual:{account_id}"],
            },
        )
        self.assertEqual(create_group.status_code, 200)

        portfolio = self.client.get("/portfolio")
        self.assertEqual(portfolio.status_code, 200)
        body = portfolio.json()

        manual_account = next(account for account in body["accounts"] if account["id"] == f"manual:{account_id}")
        self.assertEqual(manual_account["name"], "Paper Account")
        self.assertEqual(manual_account["source"], "manual")
        self.assertTrue(manual_account["editable"])
        self.assertEqual(manual_account["groupNames"], ["Blended"])

        ibkr_account = next(account for account in body["accounts"] if account["id"] == "ibkr:DU111111")
        self.assertEqual(ibkr_account["groupNames"], ["Blended"])

        manual_position = next(position for position in body["positions"] if position["accountId"] == f"manual:{account_id}")
        self.assertEqual(manual_position["symbol"], "AAPL")
        self.assertEqual(manual_position["costBasis"], 900)
        self.assertTrue(manual_position["editable"])

        manual_cash = next(cash for cash in body["cashBalances"] if cash["accountId"] == f"manual:{account_id}")
        self.assertEqual(manual_cash["currency"], "USD")
        self.assertEqual(manual_cash["balance"], 2500)

        group = next(group for group in body["groups"] if group["name"] == "Blended")
        self.assertEqual(set(group["accountIds"]), {"ibkr:DU111111", f"manual:{account_id}"})

    def test_ibkr_accounts_are_not_mutable_through_manual_endpoints(self) -> None:
        response = self.client.post(
            "/portfolio/manual/groups",
            json={"name": "Read Only", "accountIds": ["ibkr:DU111111"]},
        )
        self.assertEqual(response.status_code, 200)

        delete_account = self.client.delete("/portfolio/manual/accounts/DU111111")
        self.assertEqual(delete_account.status_code, 404)


if __name__ == "__main__":
    unittest.main()
