"""SQLite connection manager with WAL mode and retry-safe write utilities.

SQLite in WAL mode supports concurrent readers alongside a single writer.
Instead of serialising all access behind a singleton + lock (the old DuckDB
approach), each caller opens its own short-lived connection via ``db_session()``
or ``sync_db_session()``.  Write contention is handled by the built-in busy
timeout plus exponential-backoff retry helpers.
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
import time
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Iterator, List, Union

from runtime_paths import data_dir
from schema import ensure_all_schema

logger = logging.getLogger(__name__)

# ── Paths ────────────────────────────────────────────────────────────

DB_DIR = data_dir()
DB_PATH = DB_DIR / "market.db"

# ── Tuning knobs ─────────────────────────────────────────────────────

API_CONNECT_TIMEOUT_S = 10
API_BUSY_TIMEOUT_MS = 6000
TX_MAX_TRIES = 50
RETRY_DELAY_MIN = 0.05
RETRY_DELAY_MAX = 1.5

# ── Low-level helpers ────────────────────────────────────────────────


def is_locked_err(e: Exception) -> bool:
    s = str(e).lower()
    return "database is locked" in s or "database is busy" in s or "locked" in s


def get_db_connection(
    db_path: Union[str, Path] | None = None,
    *,
    timeout_s: int = API_CONNECT_TIMEOUT_S,
    busy_timeout_ms: int = API_BUSY_TIMEOUT_MS,
) -> sqlite3.Connection:
    """Create a SQLite connection configured for WAL + FastAPI usage."""
    if db_path is None:
        db_path = DB_PATH
    DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(
        str(db_path),
        timeout=timeout_s,
        check_same_thread=False,
        isolation_level=None,  # disable implicit tx — we manage transactions explicitly
    )
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute(f"PRAGMA busy_timeout={busy_timeout_ms};")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    return conn


# ── Retry utilities ──────────────────────────────────────────────────


def execute_with_retry(
    conn: sqlite3.Connection,
    query: str,
    params: Any = None,
    max_tries: int = TX_MAX_TRIES,
) -> None:
    """Robust single-statement writer with retry on lock contention."""
    cur = conn.cursor()
    delay = RETRY_DELAY_MIN
    params = () if params is None else params
    for i in range(max_tries):
        try:
            cur.execute(query, params)
            return
        except sqlite3.OperationalError as e:
            if not is_locked_err(e) or i == max_tries - 1:
                raise
            time.sleep(delay)
            delay = min(delay * 1.5, RETRY_DELAY_MAX)


def execute_one_tx_with_retry(
    conn: sqlite3.Connection,
    query: str,
    params: Any = None,
    max_tries: int = TX_MAX_TRIES,
) -> None:
    """Single-statement write in BEGIN IMMEDIATE + commit, with rollback+retry."""
    cur = conn.cursor()
    delay = RETRY_DELAY_MIN
    params = () if params is None else params
    for i in range(max_tries):
        try:
            cur.execute("BEGIN IMMEDIATE;")
            cur.execute(query, params)
            conn.commit()
            return
        except sqlite3.OperationalError as e:
            conn.rollback()
            if not is_locked_err(e) or i == max_tries - 1:
                raise
            time.sleep(delay)
            delay = min(delay * 1.5, RETRY_DELAY_MAX)
        except Exception:
            conn.rollback()
            raise


def execute_many_with_retry(
    conn: sqlite3.Connection,
    query: str,
    params_list: List[Any],
    max_tries: int = TX_MAX_TRIES,
) -> None:
    """Robust batch writer: BEGIN IMMEDIATE + executemany + commit with retry."""
    if not params_list:
        return
    cur = conn.cursor()
    delay = RETRY_DELAY_MIN
    for i in range(max_tries):
        try:
            cur.execute("BEGIN IMMEDIATE;")
            cur.executemany(query, params_list)
            conn.commit()
            return
        except sqlite3.OperationalError as e:
            conn.rollback()
            if not is_locked_err(e) or i == max_tries - 1:
                raise
            time.sleep(delay)
            delay = min(delay * 1.5, RETRY_DELAY_MAX)
        except Exception:
            conn.rollback()
            raise


def begin_immediate(cur: sqlite3.Cursor, max_tries: int = TX_MAX_TRIES) -> None:
    """BEGIN IMMEDIATE with retry. Use in ingestion scripts."""
    delay = RETRY_DELAY_MIN
    for i in range(max_tries):
        try:
            cur.execute("BEGIN IMMEDIATE;")
            return
        except sqlite3.OperationalError as e:
            if not is_locked_err(e) or i == max_tries - 1:
                raise
            time.sleep(delay)
            delay = min(delay * 1.5, RETRY_DELAY_MAX)


def commit_with_retry(conn: sqlite3.Connection, max_tries: int = TX_MAX_TRIES) -> None:
    """Commit with retry (writer scripts only)."""
    delay = RETRY_DELAY_MIN
    for i in range(max_tries):
        try:
            conn.commit()
            return
        except sqlite3.OperationalError as e:
            if not is_locked_err(e) or i == max_tries - 1:
                raise
            time.sleep(delay)
            delay = min(delay * 1.5, RETRY_DELAY_MAX)


# ── Session context managers ─────────────────────────────────────────

_schema_ready = False


def _ensure_tables(conn: sqlite3.Connection) -> None:
    """Create tables that must exist before the app starts serving requests."""
    ensure_all_schema(conn)
    return
    conn.execute("""
        CREATE TABLE IF NOT EXISTS technical_scores (
            symbol           TEXT PRIMARY KEY,
            score_1m         INTEGER,
            score_5m         INTEGER,
            score_15m        INTEGER,
            score_1h         INTEGER,
            score_4h         INTEGER,
            score_1d         INTEGER,
            score_1w         INTEGER,
            last_updated_utc TEXT
        )
    """)
    # Migrate existing tables — add new columns if missing
    for col in ("score_15m", "score_4h", "score_1d", "score_1w"):
        try:
            conn.execute(f"ALTER TABLE technical_scores ADD COLUMN {col} INTEGER")
        except Exception:
            pass  # column already exists
    conn.execute("""
        CREATE TABLE IF NOT EXISTS watchlist_symbols (
            position INTEGER PRIMARY KEY,
            symbol   TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS watchlist_quotes (
            symbol      TEXT PRIMARY KEY,
            last        REAL,
            bid         REAL,
            ask         REAL,
            mid         REAL,
            open        REAL,
            high        REAL,
            low         REAL,
            prev_close  REAL,
            change      REAL,
            change_pct  REAL,
            volume      REAL,
            spread      REAL,
            trailing_pe REAL,
            forward_pe  REAL,
            market_cap  REAL,
            valuation_updated_at INTEGER,
            source      TEXT,
            updated_at  INTEGER
        )
    """)
    for col_def in (
        "trailing_pe REAL",
        "forward_pe REAL",
        "market_cap REAL",
        "valuation_updated_at INTEGER",
    ):
        try:
            conn.execute(f"ALTER TABLE watchlist_quotes ADD COLUMN {col_def}")
        except Exception:
            pass  # column already exists
    conn.execute("""
        CREATE TABLE IF NOT EXISTS watchlist_status (
            symbol      TEXT PRIMARY KEY,
            state       TEXT NOT NULL,
            detail      TEXT,
            updated_at  INTEGER NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS market_snapshots (
            symbol              TEXT PRIMARY KEY,
            last                REAL,
            open                REAL,
            high                REAL,
            low                 REAL,
            prev_close          REAL,
            change              REAL,
            change_pct          REAL,
            volume              REAL,
            bid                 REAL,
            ask                 REAL,
            mid                 REAL,
            spread              REAL,
            source              TEXT,
            status              TEXT,
            quote_updated_at    INTEGER,
            intraday_updated_at INTEGER,
            daily_updated_at    INTEGER,
            updated_at          INTEGER
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS active_symbols (
            symbol        TEXT PRIMARY KEY,
            last_requested INTEGER,
            bar_size      TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ibkr_client_leases (
            client_id  INTEGER PRIMARY KEY,
            owner      TEXT NOT NULL,
            role       TEXT NOT NULL,
            leased_at  INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        )
    """)
    conn.commit()


@contextmanager
def sync_db_session(db_path: Union[str, Path] | None = None) -> Iterator[sqlite3.Connection]:
    """Synchronous DB session. Opens, yields, commits/rollbacks, closes."""
    global _schema_ready
    if db_path is None:
        db_path = DB_PATH
    conn = get_db_connection(db_path)
    if not _schema_ready:
        _ensure_tables(conn)
        _schema_ready = True
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


async def run_db(fn, *args, **kwargs):
    """Run blocking DB work in a background thread."""
    return await asyncio.to_thread(fn, *args, **kwargs)


@asynccontextmanager
async def db_session(db_path: Union[str, Path] | None = None) -> AsyncIterator[sqlite3.Connection]:
    """Async DB session — opens a connection in the current thread."""
    global _schema_ready
    if db_path is None:
        db_path = DB_PATH
    conn = get_db_connection(db_path)
    if not _schema_ready:
        _ensure_tables(conn)
        _schema_ready = True
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
