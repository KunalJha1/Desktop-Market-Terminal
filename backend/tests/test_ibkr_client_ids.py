from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import db_utils
from connection_pool import ConnectionPool
from ibkr_utils import (
    IbkrClientIdManager,
    connect_with_client_id_fallback,
    is_client_id_in_use_error,
)


class FakeEvent:
    def __init__(self):
        self.handlers = []

    def __iadd__(self, handler):
        self.handlers.append(handler)
        return self

    def __isub__(self, handler):
        self.handlers = [h for h in self.handlers if h != handler]
        return self

    def clear(self):
        self.handlers.clear()

    def emit(self, *args):
        for handler in list(self.handlers):
            handler(*args)


class FakeIB:
    taken_ids: set[int] = set()

    def __init__(self):
        self.client_id = None
        self.connected = False
        self.disconnectedEvent = FakeEvent()
        self.errorEvent = FakeEvent()
        self.client = self

    async def connectAsync(self, host, port, clientId, readonly=True):
        self.client_id = clientId
        if clientId in self.taken_ids:
            self.connected = True
            self.errorEvent.emit(-1, 326, f"clientId {clientId} already in use", None)
            self.connected = False
            return
        self.connected = True

    def isConnected(self):
        return self.connected

    def isReady(self):
        return self.connected

    def disconnect(self):
        self.connected = False


class IbkrClientIdManagerTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "market.db"
        db_utils._schema_ready = False
        self.db_patch = patch.object(db_utils, "DB_PATH", self.db_path)
        self.db_patch.start()

    def tearDown(self):
        self.db_patch.stop()
        self.tmpdir.cleanup()

    def test_acquire_skips_existing_lease_and_reuses_released_id(self):
        mgr1 = IbkrClientIdManager(3, 10, owner="owner-1")
        mgr2 = IbkrClientIdManager(3, 10, owner="owner-2")

        self.assertEqual(mgr1.acquire("watchlist"), 3)
        self.assertEqual(mgr2.acquire("quote"), 4)

        mgr1.release(3)
        self.assertEqual(mgr2.acquire("watchlist-2", preferred_id=3), 3)

    def test_expired_lease_becomes_available(self):
        mgr1 = IbkrClientIdManager(3, 10, owner="owner-1", lease_ttl_ms=1)
        mgr2 = IbkrClientIdManager(3, 10, owner="owner-2")

        self.assertEqual(mgr1.acquire("watchlist"), 3)
        with db_utils.sync_db_session() as conn:
            conn.execute("UPDATE ibkr_client_leases SET expires_at = 0 WHERE client_id = 3")

        self.assertEqual(mgr2.acquire("quote", preferred_id=3), 3)

    def test_rejected_client_id_is_retired_locally(self):
        mgr = IbkrClientIdManager(3, 10, owner="owner-1")
        self.assertEqual(mgr.acquire("watchlist"), 3)
        mgr.mark_rejected(3)
        self.assertEqual(mgr.acquire("watchlist", preferred_id=3), 4)

    def test_client_id_error_detection(self):
        self.assertTrue(is_client_id_in_use_error(RuntimeError("Error 326: already in use")))
        self.assertFalse(is_client_id_in_use_error(RuntimeError("socket closed")))

    def test_delayed_326_after_connect_is_treated_as_collision(self):
        async def run():
            ib = FakeIB()
            FakeIB.taken_ids = {3}
            with self.assertRaises(RuntimeError):
                await connect_with_client_id_fallback(
                    ib, "127.0.0.1", 7497, 3, readonly=True, settle_delay_s=0
                )

        asyncio.run(run())


class ConnectionPoolTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "market.db"
        db_utils._schema_ready = False
        self.db_patch = patch.object(db_utils, "DB_PATH", self.db_path)
        self.db_patch.start()

    def tearDown(self):
        self.db_patch.stop()
        self.tmpdir.cleanup()

    async def test_pool_advances_after_client_id_collision(self):
        FakeIB.taken_ids = {1000}
        pool = ConnectionPool()
        pool.set_tws_address("127.0.0.1", 7497)

        with patch("connection_pool.IB", FakeIB):
            ib = await pool.get_or_create("watchlist:0")

        self.assertTrue(ib.isConnected())
        self.assertEqual(pool.get_client_id("watchlist:0"), 1001)

    async def test_disconnect_releases_lease(self):
        FakeIB.taken_ids = set()
        pool = ConnectionPool()
        pool.set_tws_address("127.0.0.1", 7497)

        with patch("connection_pool.IB", FakeIB):
            await pool.get_or_create("quote:test")
            client_id = pool.get_client_id("quote:test")
            await pool.disconnect("quote:test")

        mgr = IbkrClientIdManager(1000, 1005, owner="owner-2")
        self.assertEqual(mgr.acquire("other", preferred_id=client_id), client_id)

    async def test_role_status_tracks_reconnect_metadata(self):
        FakeIB.taken_ids = set()
        pool = ConnectionPool()
        pool.set_tws_address("127.0.0.1", 7497)

        async def fake_probe():
            return ("127.0.0.1", 7497)

        pool._probe_fn = fake_probe

        with patch("connection_pool.IB", FakeIB):
            ib = await pool.get_or_create("quote:test")
            client_id = pool.get_client_id("quote:test")
            self.assertIsNotNone(client_id)

            before_disconnect = pool.get_role_status("quote:test")
            self.assertTrue(before_disconnect["connected"])
            self.assertEqual(before_disconnect["reconnectAttempts"], 0)
            self.assertIsNone(before_disconnect["lastDisconnectAt"])
            self.assertIsNone(before_disconnect["lastReconnectAt"])

            ib.disconnectedEvent.emit()
            await asyncio.sleep(1.2)

            after_reconnect = pool.get_role_status("quote:test")
            self.assertTrue(after_reconnect["connected"])
            self.assertGreaterEqual(after_reconnect["reconnectAttempts"], 1)
            self.assertIsNotNone(after_reconnect["lastDisconnectAt"])
            self.assertIsNotNone(after_reconnect["lastReconnectAt"])
            self.assertIsNone(after_reconnect["lastError"])


if __name__ == "__main__":
    unittest.main()
