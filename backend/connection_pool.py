"""ConnectionPool — manages IB connections via logical roles and client IDs."""

import asyncio
import logging
from enum import Enum
from typing import Callable

from ib_insync import IB

from ibkr_utils import (
    IbkrClientIdManager,
    connect_with_client_id_fallback,
    is_client_id_in_use_error,
)

logger = logging.getLogger(__name__)

CLIENT_ID_START = 1000
CLIENT_ID_SCAN_LIMIT = 10000


class ClientState(str, Enum):
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    ERROR = "error"


class ConnectionPool:
    def __init__(
        self,
        on_status_change: Callable[[int, str], None] | None = None,
        *,
        loop: asyncio.AbstractEventLoop | None = None,
    ):
        self._clients: dict[int, IB] = {}
        self._states: dict[int, ClientState] = {}
        self._reconnect_tasks: dict[str, asyncio.Task] = {}
        self._role_to_client_id: dict[str, int] = {}
        self._client_id_to_role: dict[int, str] = {}
        self._connect_lock = asyncio.Lock()
        self._host: str | None = None
        self._port: int | None = None
        self._on_status_change = on_status_change
        self._loop = loop
        self._client_id_manager = IbkrClientIdManager(CLIENT_ID_START, CLIENT_ID_SCAN_LIMIT)

    def set_tws_address(self, host: str, port: int):
        self._host = host
        self._port = port

    def get_state(self, client_id: int) -> ClientState:
        return self._states.get(client_id, ClientState.DISCONNECTED)

    def get_client(self, key: int | str) -> IB | None:
        if isinstance(key, str):
            client_id = self._role_to_client_id.get(key)
            if client_id is None:
                return None
            return self._clients.get(client_id)
        return self._clients.get(key)

    def get_client_id(self, role: str) -> int | None:
        return self._role_to_client_id.get(role)

    def _unbind_role(self, role: str):
        client_id = self._role_to_client_id.pop(role, None)
        if client_id is not None:
            self._client_id_to_role.pop(client_id, None)

    def _cleanup_client(self, client_id: int):
        ib = self._clients.pop(client_id, None)
        if ib:
            try:
                ib.disconnectedEvent.clear()
            except Exception:
                pass
            if ib.isConnected():
                try:
                    ib.disconnect()
                except Exception:
                    pass

    async def get_or_create(self, role: str) -> IB:
        if self._host is None or self._port is None:
            raise RuntimeError(
                "TWS address not configured — call set_tws_address() before connecting"
            )
        async with self._connect_lock:
            existing_id = self._role_to_client_id.get(role)
            if existing_id is not None:
                existing = self._clients.get(existing_id)
                if existing and existing.isConnected():
                    return existing
                self._cleanup_client(existing_id)

            last_exc: Exception = RuntimeError("no attempts made")
            attempts = 0

            while attempts < CLIENT_ID_SCAN_LIMIT:
                attempts += 1
                preferred_id = self._role_to_client_id.get(role)
                try_id = self._client_id_manager.acquire(role, preferred_id=preferred_id)
                self._role_to_client_id[role] = try_id
                self._client_id_to_role[try_id] = role

                ib = IB()
                self._clients[try_id] = ib
                self._states[try_id] = ClientState.CONNECTING
                self._notify(try_id)
                ib.disconnectedEvent += lambda cid=try_id: self._on_disconnect(cid)

                try:
                    await connect_with_client_id_fallback(
                        ib,
                        self._host,
                        self._port,
                        try_id,
                        readonly=True,
                    )
                    self._states[try_id] = ClientState.CONNECTED
                    self._notify(try_id)
                    logger.info(
                        f"Client {try_id} connected to {self._host}:{self._port} for role {role}"
                    )
                    return ib
                except Exception as e:
                    last_exc = e
                    self._states[try_id] = ClientState.ERROR
                    self._notify(try_id)
                    self._cleanup_client(try_id)

                    if is_client_id_in_use_error(e):
                        logger.warning(
                            f"Client {try_id} rejected for role {role} (clientId in use), allocating a new ID"
                        )
                        self._client_id_manager.mark_rejected(try_id)
                        self._client_id_to_role.pop(try_id, None)
                        if self._role_to_client_id.get(role) == try_id:
                            self._role_to_client_id.pop(role, None)
                        continue

                    logger.error(f"Client {try_id} connection failed for role {role}: {e}")
                    raise

            logger.error(f"Unable to allocate a TWS client ID for role {role}")
            raise last_exc

    def _on_disconnect(self, client_id: int):
        role = self._client_id_to_role.get(client_id)
        self._states[client_id] = ClientState.DISCONNECTED
        self._notify(client_id)
        if not role:
            return
        logger.warning(f"Client {client_id} for role {role} disconnected, scheduling reconnect")
        task = self._reconnect_tasks.pop(role, None)
        if task:
            task.cancel()
        loop = self._loop or asyncio.get_event_loop()
        self._reconnect_tasks[role] = loop.create_task(self._reconnect_loop(role))

    async def _reconnect_loop(self, role: str):
        delay = 1.0
        max_delay = 30.0
        while role in self._role_to_client_id:
            await asyncio.sleep(delay)
            try:
                logger.info(f"Reconnecting role {role} (delay={delay}s)")
                await self.get_or_create(role)
                return
            except Exception:
                delay = min(delay * 2, max_delay)

    async def disconnect(self, key: int | str):
        if isinstance(key, str):
            role = key
            client_id = self._role_to_client_id.get(role)
        else:
            client_id = key
            role = self._client_id_to_role.get(client_id)

        if role:
            task = self._reconnect_tasks.pop(role, None)
            if task:
                task.cancel()

        if client_id is None:
            return

        self._cleanup_client(client_id)
        self._states[client_id] = ClientState.DISCONNECTED
        self._notify(client_id)

        if role:
            self._unbind_role(role)
            self._client_id_manager.release(client_id)
            logger.info(f"Role {role} disconnected from client {client_id}")
        else:
            self._client_id_manager.release(client_id)
            logger.info(f"Client {client_id} disconnected")

    async def disconnect_all(self):
        roles = list(self._role_to_client_id.keys())
        for role in roles:
            await self.disconnect(role)

    def _notify(self, client_id: int):
        if self._on_status_change:
            self._on_status_change(client_id, self._states[client_id].value)
