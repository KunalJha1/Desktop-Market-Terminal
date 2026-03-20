"""DuckDB singleton connection manager.

DuckDB holds a write lock on the file for the lifetime of any open connection.
On Windows, opening a second connection to the same file (even within the same
process) fails with "file is being used by another process".

This module solves that by:
  1. Keeping exactly ONE DuckDB connection alive for the process lifetime.
  2. Serialising all async access behind an asyncio.Lock so concurrent coroutines
     queue up instead of racing for the file handle.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from contextlib import asynccontextmanager
from contextlib import contextmanager
from pathlib import Path
from typing import AsyncIterator

import duckdb

logger = logging.getLogger(__name__)

DB_DIR = Path(__file__).parent.parent / "data"
DB_PATH = DB_DIR / "market.duckdb"

_conn: duckdb.DuckDBPyConnection | None = None
_db_lock: asyncio.Lock | None = None   # created lazily (needs a running event loop)
_thread_lock = threading.RLock()


def _get_db_lock() -> asyncio.Lock:
    global _db_lock
    if _db_lock is None:
        _db_lock = asyncio.Lock()
    return _db_lock


def get_conn() -> duckdb.DuckDBPyConnection:
    """Return (creating if needed) the singleton DuckDB read-write connection.

    Safe to call from synchronous code running on the asyncio event-loop thread.
    For coroutines that need serialised access use ``db_session()`` instead.
    """
    global _conn
    if _conn is None:
        DB_DIR.mkdir(parents=True, exist_ok=True)
        _conn = duckdb.connect(str(DB_PATH))
        logger.info(f"DuckDB connection opened: {DB_PATH}")
        _ensure_tables(_conn)
    return _conn


def _ensure_tables(conn: duckdb.DuckDBPyConnection) -> None:
    """Create any tables that must exist before the app starts serving requests."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS technical_scores (
            symbol           VARCHAR PRIMARY KEY,
            score_1m         INTEGER,
            score_5m         INTEGER,
            score_1h         INTEGER,
            score_4h         INTEGER,
            last_updated_utc TIMESTAMP
        )
    """)


@asynccontextmanager
async def db_session() -> AsyncIterator[duckdb.DuckDBPyConnection]:
    """Async context manager: acquires the global DB lock then yields the connection.

    Guarantees only one coroutine touches DuckDB at a time, eliminating the
    Windows file-lock race that causes "file is being used by another process".

    Usage::

        async with db_session() as conn:
            rows = conn.execute("SELECT ...").fetchall()
    """
    async with _get_db_lock():
        with _thread_lock:
            yield get_conn()


@contextmanager
def sync_db_session():
    """Synchronous DB session guarded by the same process-wide lock.

    Use this from executor threads or sync callbacks that need to touch DuckDB
    without racing the async sidecar coroutines.
    """
    with _thread_lock:
        yield get_conn()


def checkpoint_and_close() -> None:
    """Flush WAL to main DB file and close the singleton. Call once on shutdown."""
    global _conn
    with _thread_lock:
        if _conn is not None:
            try:
                _conn.execute("CHECKPOINT")
                _conn.close()
                logger.info("DuckDB checkpointed and closed")
            except Exception as e:
                logger.warning(f"DuckDB shutdown error: {e}")
            finally:
                _conn = None
