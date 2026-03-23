"""Shared IBKR client-ID leasing and collision handling utilities."""

from __future__ import annotations

import asyncio
import os
import socket
import time
import uuid

from db_utils import sync_db_session

DEFAULT_CLIENT_ID_START = 1000
DEFAULT_CLIENT_ID_MAX = 10000
LEASE_TTL_MS = 60_000


def is_client_id_in_use_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return "already in use" in err or ("clientid" in err and "in use" in err) or "326" in err


async def connect_with_client_id_fallback(
    ib,
    host: str,
    port: int,
    client_id: int,
    *,
    readonly: bool = True,
    settle_delay_s: float = 0.35,
):
    rejected = False

    def on_error(req_id, error_code, error_string, contract=None):
        nonlocal rejected
        if int(error_code) == 326 or "already in use" in str(error_string).lower():
            rejected = True

    ib.errorEvent += on_error
    try:
        await ib.connectAsync(host, port, clientId=client_id, readonly=readonly)
        if settle_delay_s > 0:
            await asyncio.sleep(settle_delay_s)
        client = getattr(ib, "client", None)
        client_ready = True if client is None else client.isReady()
        if rejected or not ib.isConnected() or not client_ready:
            raise RuntimeError(f"Error 326: clientId {client_id} already in use")
        return ib
    finally:
        ib.errorEvent -= on_error


class IbkrClientIdManager:
    def __init__(
        self,
        start: int = DEFAULT_CLIENT_ID_START,
        max_id: int = DEFAULT_CLIENT_ID_MAX,
        *,
        lease_ttl_ms: int = LEASE_TTL_MS,
        owner: str | None = None,
    ):
        self._start = start
        self._max = max_id
        self._lease_ttl_ms = lease_ttl_ms
        self._owner = owner or f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"
        self._retired: set[int] = set()
        self._role_to_client_id: dict[str, int] = {}

    def acquire(self, role: str, preferred_id: int | None = None) -> int:
        if preferred_id is not None:
            candidate = max(preferred_id, self._start)
        else:
            candidate = max(self._role_to_client_id.get(role, self._start), self._start)

        while candidate <= self._max:
            if candidate in self._retired:
                candidate += 1
                continue
            if self._try_claim(role, candidate):
                self._role_to_client_id[role] = candidate
                return candidate
            candidate += 1
        raise RuntimeError("Exhausted managed TWS client IDs")

    def release(self, client_id: int) -> None:
        with sync_db_session() as conn:
            conn.execute(
                "DELETE FROM ibkr_client_leases WHERE client_id = ? AND owner = ?",
                (client_id, self._owner),
            )
        for role, leased_id in list(self._role_to_client_id.items()):
            if leased_id == client_id:
                self._role_to_client_id.pop(role, None)

    def mark_rejected(self, client_id: int) -> None:
        self._retired.add(client_id)
        self.release(client_id)

    def _try_claim(self, role: str, client_id: int) -> bool:
        now_ms = int(time.time() * 1000)
        expires_at = now_ms + self._lease_ttl_ms
        with sync_db_session() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE;")
            cur.execute("DELETE FROM ibkr_client_leases WHERE expires_at <= ?", (now_ms,))
            row = cur.execute(
                "SELECT owner FROM ibkr_client_leases WHERE client_id = ?",
                (client_id,),
            ).fetchone()
            if row is None:
                cur.execute(
                    """
                    INSERT INTO ibkr_client_leases (
                        client_id, owner, role, leased_at, expires_at
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (client_id, self._owner, role, now_ms, expires_at),
                )
                return True
            if row[0] != self._owner:
                return False
            cur.execute(
                """
                UPDATE ibkr_client_leases
                SET role = ?, leased_at = ?, expires_at = ?
                WHERE client_id = ? AND owner = ?
                """,
                (role, now_ms, expires_at, client_id, self._owner),
            )
            return True
