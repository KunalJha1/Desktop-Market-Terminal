"""ConnectionPool — manages multiple IB client connections by client_id."""

import asyncio
import logging
from enum import Enum
from typing import Callable

from ib_insync import IB

logger = logging.getLogger(__name__)


class ClientState(str, Enum):
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    ERROR = "error"


class ConnectionPool:
    def __init__(self, on_status_change: Callable[[int, str], None] | None = None):
        self._clients: dict[int, IB] = {}
        self._states: dict[int, ClientState] = {}
        self._reconnect_tasks: dict[int, asyncio.Task] = {}
        self._host: str = "127.0.0.1"
        self._port: int = 7497
        self._on_status_change = on_status_change

    def set_tws_address(self, host: str, port: int):
        self._host = host
        self._port = port

    def get_state(self, client_id: int) -> ClientState:
        return self._states.get(client_id, ClientState.DISCONNECTED)

    def get_client(self, client_id: int) -> IB | None:
        return self._clients.get(client_id)

    async def get_or_create(self, client_id: int) -> IB:
        if client_id in self._clients and self._clients[client_id].isConnected():
            return self._clients[client_id]

        ib = IB()
        self._clients[client_id] = ib
        self._states[client_id] = ClientState.CONNECTING
        self._notify(client_id)

        ib.disconnectedEvent += lambda: self._on_disconnect(client_id)

        try:
            await ib.connectAsync(
                self._host, self._port, clientId=client_id, readonly=True
            )
            self._states[client_id] = ClientState.CONNECTED
            self._notify(client_id)
            logger.info(f"Client {client_id} connected to {self._host}:{self._port}")
            return ib
        except Exception as e:
            self._states[client_id] = ClientState.ERROR
            self._notify(client_id)
            logger.error(f"Client {client_id} connection failed: {e}")
            raise

    def _on_disconnect(self, client_id: int):
        self._states[client_id] = ClientState.DISCONNECTED
        self._notify(client_id)
        logger.warning(f"Client {client_id} disconnected, scheduling reconnect")
        # Cancel any existing reconnect task
        if client_id in self._reconnect_tasks:
            self._reconnect_tasks[client_id].cancel()
        self._reconnect_tasks[client_id] = asyncio.ensure_future(
            self._reconnect_loop(client_id)
        )

    async def _reconnect_loop(self, client_id: int):
        delay = 1.0
        max_delay = 30.0
        while True:
            await asyncio.sleep(delay)
            if client_id not in self._clients:
                return  # Client was removed
            try:
                logger.info(f"Reconnecting client {client_id} (delay={delay}s)")
                await self.get_or_create(client_id)
                return  # Success
            except Exception:
                delay = min(delay * 2, max_delay)

    async def disconnect(self, client_id: int):
        # Cancel reconnect task
        task = self._reconnect_tasks.pop(client_id, None)
        if task:
            task.cancel()

        ib = self._clients.pop(client_id, None)
        if ib:
            ib.disconnectedEvent.clear()
            if ib.isConnected():
                ib.disconnect()
            self._states[client_id] = ClientState.DISCONNECTED
            self._notify(client_id)
            logger.info(f"Client {client_id} disconnected")

    async def disconnect_all(self):
        client_ids = list(self._clients.keys())
        for cid in client_ids:
            await self.disconnect(cid)

    def _notify(self, client_id: int):
        if self._on_status_change:
            self._on_status_change(client_id, self._states[client_id].value)
