"""ConnectionPool — manages IB connections via logical roles and client IDs."""

import asyncio
import logging
import time
from enum import Enum
from typing import Awaitable, Callable

from ib_insync import IB

from ibkr_utils import (
    IbkrClientIdManager,
    connect_with_client_id_fallback,
    is_client_id_in_use_error,
)

logger = logging.getLogger(__name__)

CLIENT_ID_START = 1000


async def probe_tws_port(host: str, ports: tuple[int, ...], timeout: float = 2.0) -> int | None:
    """Return the first port in *ports* that accepts a TCP connection, or None."""
    for port in ports:
        try:
            _r, w = await asyncio.wait_for(asyncio.open_connection(host, port), timeout)
            w.close()
            await w.wait_closed()
            return port
        except Exception:
            continue
    return None
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
        probe_fn: Callable[[], Awaitable[tuple[str, int] | None]] | None = None,
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
        self._probe_fn = probe_fn
        self._client_id_manager = IbkrClientIdManager(CLIENT_ID_START, CLIENT_ID_SCAN_LIMIT)
        self._role_reconnect_meta: dict[str, dict] = {}

    def set_tws_address(self, host: str, port: int):
        self._host = host
        self._port = port

    @staticmethod
    def _now_ms() -> int:
        return int(time.time() * 1000)

    def _meta_for_role(self, role: str) -> dict:
        meta = self._role_reconnect_meta.get(role)
        if meta is None:
            meta = {
                "last_disconnect_at": None,
                "last_reconnect_at": None,
                "reconnect_attempts": 0,
                "last_error": None,
            }
            self._role_reconnect_meta[role] = meta
        return meta

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
                    meta = self._meta_for_role(role)
                    if meta["last_disconnect_at"] is not None:
                        meta["last_reconnect_at"] = self._now_ms()
                    meta["last_error"] = None
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

                    meta = self._meta_for_role(role)
                    meta["last_error"] = str(e)
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
        meta = self._meta_for_role(role)
        meta["last_disconnect_at"] = self._now_ms()
        meta["reconnect_attempts"] = 0
        meta["last_error"] = None
        logger.warning(f"Client {client_id} for role {role} disconnected, scheduling reconnect")
        # Clear the cached TWS address so the reconnect loop re-probes the port.
        # This handles TWS restarting on a different port after a daily reset.
        self._host = None
        self._port = None
        task = self._reconnect_tasks.pop(role, None)
        if task:
            task.cancel()
        loop = asyncio.get_running_loop()
        self._reconnect_tasks[role] = loop.create_task(self._reconnect_loop(role))

    async def _reconnect_loop(self, role: str):
        delay = 1.0
        max_delay = 30.0
        try:
            while role in self._role_to_client_id:
                meta = self._meta_for_role(role)
                meta["reconnect_attempts"] += 1
                await asyncio.sleep(delay)
                # Re-probe TWS address if it was cleared on disconnect.
                if self._host is None and self._probe_fn is not None:
                    try:
                        result = await self._probe_fn()
                        if result:
                            self._host, self._port = result
                            logger.info(f"Re-probed TWS address: {self._host}:{self._port}")
                        else:
                            meta["last_error"] = "TWS probe returned no address"
                            logger.warning("TWS probe returned no address, will retry")
                            delay = min(delay * 2, max_delay)
                            continue
                    except Exception as exc:
                        meta["last_error"] = str(exc)
                        logger.warning(f"TWS probe failed during reconnect: {exc}")
                        delay = min(delay * 2, max_delay)
                        continue
                try:
                    logger.info(f"Reconnecting role {role} (delay={delay}s)")
                    await self.get_or_create(role)
                    return
                except Exception as exc:
                    meta["last_error"] = str(exc)
                    delay = min(delay * 2, max_delay)
        finally:
            task = self._reconnect_tasks.get(role)
            current = asyncio.current_task()
            if task is current:
                self._reconnect_tasks.pop(role, None)

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

    def get_role_status(self, role: str) -> dict:
        client_id = self._role_to_client_id.get(role)
        state = self._states.get(client_id, ClientState.DISCONNECTED) if client_id is not None else ClientState.DISCONNECTED
        meta = self._meta_for_role(role)
        return {
            "connected": state == ClientState.CONNECTED,
            "reconnecting": role in self._reconnect_tasks,
            "state": state.value,
            "host": self._host,
            "port": self._port,
            "lastDisconnectAt": meta["last_disconnect_at"],
            "lastReconnectAt": meta["last_reconnect_at"],
            "reconnectAttempts": meta["reconnect_attempts"],
            "lastError": meta["last_error"],
        }

    def _notify(self, client_id: int):
        if self._on_status_change:
            self._on_status_change(client_id, self._states[client_id].value)
