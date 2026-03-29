"""Shared SQLite schema initialization helpers."""

from __future__ import annotations

import sqlite3


def ensure_base_schema(conn: sqlite3.Connection) -> None:
    """Create tables that must exist before the app starts serving requests."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS technical_scores (
            symbol           TEXT PRIMARY KEY,
            score_1m         INTEGER,
            score_5m         INTEGER,
            score_15m        INTEGER,
            score_1h         INTEGER,
            score_1d         INTEGER,
            score_1w         INTEGER,
            last_updated_utc TEXT
        )
    """)
    for col in ("score_15m", "score_1d", "score_1w"):
        try:
            conn.execute(f"ALTER TABLE technical_scores ADD COLUMN {col} INTEGER")
        except Exception:
            pass
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
            pass
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
            last_requested INTEGER
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS dailyiq_cache (
            cache_key   TEXT PRIMARY KEY,
            response    TEXT NOT NULL,
            fetched_at  INTEGER NOT NULL
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
    conn.execute("""
        CREATE TABLE IF NOT EXISTS portfolio_manual_accounts (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS portfolio_manual_positions (
            id               TEXT PRIMARY KEY,
            account_id       TEXT NOT NULL,
            symbol           TEXT NOT NULL,
            name             TEXT,
            currency         TEXT NOT NULL DEFAULT 'USD',
            exchange         TEXT NOT NULL DEFAULT '',
            primary_exchange TEXT,
            sec_type         TEXT NOT NULL DEFAULT 'STK',
            quantity         REAL NOT NULL,
            avg_cost         REAL NOT NULL,
            created_at       INTEGER NOT NULL,
            updated_at       INTEGER NOT NULL,
            FOREIGN KEY (account_id) REFERENCES portfolio_manual_accounts(id) ON DELETE CASCADE
        )
    """)
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_manual_positions_account_symbol
        ON portfolio_manual_positions (account_id, symbol)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS portfolio_manual_cash_balances (
            id         TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            currency   TEXT NOT NULL,
            balance    REAL NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (account_id) REFERENCES portfolio_manual_accounts(id) ON DELETE CASCADE
        )
    """)
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_manual_cash_account_currency
        ON portfolio_manual_cash_balances (account_id, currency)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS portfolio_groups (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    """)
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_groups_name
        ON portfolio_groups (name)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS portfolio_group_memberships (
            group_id    TEXT NOT NULL,
            account_ref TEXT NOT NULL,
            created_at  INTEGER NOT NULL,
            PRIMARY KEY (group_id, account_ref),
            FOREIGN KEY (group_id) REFERENCES portfolio_groups(id) ON DELETE CASCADE
        )
    """)


def ensure_historical_schema(conn: sqlite3.Connection) -> None:
    """Create SQLite tables used for historical price caching."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_1m (
            symbol   TEXT    NOT NULL,
            ts       INTEGER NOT NULL,
            open     REAL    NOT NULL,
            high     REAL    NOT NULL,
            low      REAL    NOT NULL,
            close    REAL    NOT NULL,
            volume   REAL    NOT NULL,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_1m_sym_ts
        ON ohlcv_1m (symbol, ts)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_1m_bid (
            symbol   TEXT    NOT NULL,
            ts       INTEGER NOT NULL,
            open     REAL    NOT NULL,
            high     REAL    NOT NULL,
            low      REAL    NOT NULL,
            close    REAL    NOT NULL,
            volume   REAL    NOT NULL,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_1m_bid_sym_ts
        ON ohlcv_1m_bid (symbol, ts)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_1m_ask (
            symbol   TEXT    NOT NULL,
            ts       INTEGER NOT NULL,
            open     REAL    NOT NULL,
            high     REAL    NOT NULL,
            low      REAL    NOT NULL,
            close    REAL    NOT NULL,
            volume   REAL    NOT NULL,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_1m_ask_sym_ts
        ON ohlcv_1m_ask (symbol, ts)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_5m (
            symbol   TEXT    NOT NULL,
            ts       INTEGER NOT NULL,
            open     REAL    NOT NULL,
            high     REAL    NOT NULL,
            low      REAL    NOT NULL,
            close    REAL    NOT NULL,
            volume   REAL    NOT NULL,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_5m_sym_ts
        ON ohlcv_5m (symbol, ts)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_15m (
            symbol   TEXT    NOT NULL,
            ts       INTEGER NOT NULL,
            open     REAL    NOT NULL,
            high     REAL    NOT NULL,
            low      REAL    NOT NULL,
            close    REAL    NOT NULL,
            volume   REAL    NOT NULL,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_15m_sym_ts
        ON ohlcv_15m (symbol, ts)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_1d (
            symbol   TEXT    NOT NULL,
            ts       INTEGER NOT NULL,
            open     REAL    NOT NULL,
            high     REAL    NOT NULL,
            low      REAL    NOT NULL,
            close    REAL    NOT NULL,
            volume   REAL    NOT NULL,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_1d_sym_ts
        ON ohlcv_1d (symbol, ts)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_1d_bid (
            symbol   TEXT    NOT NULL,
            ts       INTEGER NOT NULL,
            open     REAL    NOT NULL,
            high     REAL    NOT NULL,
            low      REAL    NOT NULL,
            close    REAL    NOT NULL,
            volume   REAL    NOT NULL,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_1d_bid_sym_ts
        ON ohlcv_1d_bid (symbol, ts)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_1d_ask (
            symbol   TEXT    NOT NULL,
            ts       INTEGER NOT NULL,
            open     REAL    NOT NULL,
            high     REAL    NOT NULL,
            low      REAL    NOT NULL,
            close    REAL    NOT NULL,
            volume   REAL    NOT NULL,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_1d_ask_sym_ts
        ON ohlcv_1d_ask (symbol, ts)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_5s (
            symbol   TEXT    NOT NULL,
            ts       INTEGER NOT NULL,
            open     REAL    NOT NULL,
            high     REAL    NOT NULL,
            low      REAL    NOT NULL,
            close    REAL    NOT NULL,
            volume   REAL    NOT NULL,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_5s_sym_ts
        ON ohlcv_5s (symbol, ts)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS historical_priority_queue (
            symbol        TEXT    NOT NULL,
            bar_size      TEXT    NOT NULL,
            what_to_show  TEXT    NOT NULL DEFAULT 'TRADES',
            duration      TEXT    NOT NULL,
            requested_at  INTEGER NOT NULL,
            PRIMARY KEY (symbol, bar_size, what_to_show)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_historical_priority_requested
        ON historical_priority_queue (requested_at DESC)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS fetch_meta (
            symbol         TEXT    NOT NULL,
            bar_size       TEXT    NOT NULL,
            fetched_at     INTEGER NOT NULL,
            source         TEXT    NOT NULL DEFAULT 'yahoo',
            depth_complete INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (symbol, bar_size)
        )
    """)
    # Migration: add 'synthetic' flag to intraday bar tables (no-op if already present).
    # synthetic=1 means the bar was built from quote ticks (off-hours), not from TWS realtime bars.
    for _tbl in ("ohlcv_1m", "ohlcv_5m", "ohlcv_15m"):
        try:
            conn.execute(f"ALTER TABLE {_tbl} ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0")
        except Exception:
            pass  # column already exists
    # Migration: add depth_complete flag to fetch_meta (no-op if already present).
    # depth_complete=1 means we fetched as far back as the source allows for this series.
    try:
        conn.execute("ALTER TABLE fetch_meta ADD COLUMN depth_complete INTEGER NOT NULL DEFAULT 0")
    except Exception:
        pass  # column already exists


def ensure_options_schema(conn: sqlite3.Connection) -> None:
    """Create SQLite tables for options chain data."""

    # --- Contract master ---
    # One row per unique option contract. Static/slow-changing metadata.
    # contract_id is the OCC symbol (e.g. AAPL260325C00250000).
    conn.execute("""
        CREATE TABLE IF NOT EXISTS option_contracts (
            contract_id    TEXT    PRIMARY KEY,
            underlying     TEXT    NOT NULL,
            expiration     INTEGER NOT NULL,  -- unix epoch, midnight UTC of expiration date
            strike         REAL    NOT NULL,
            option_type    TEXT    NOT NULL CHECK(option_type IN ('call', 'put')),
            contract_size  TEXT    NOT NULL DEFAULT 'REGULAR',
            currency       TEXT    NOT NULL DEFAULT 'USD',
            exchange       TEXT,
            exercise_style TEXT,
            created_at     INTEGER NOT NULL,
            last_seen_at   INTEGER NOT NULL
        )
    """)
    for col_def in (
        "exchange TEXT",
        "exercise_style TEXT",
        "last_seen_at INTEGER NOT NULL DEFAULT 0",
    ):
        try:
            conn.execute(f"ALTER TABLE option_contracts ADD COLUMN {col_def}")
        except Exception:
            pass
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_option_contracts_underlying
        ON option_contracts (underlying)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_option_contracts_underlying_exp
        ON option_contracts (underlying, expiration)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_option_contracts_underlying_exp_type
        ON option_contracts (underlying, expiration, option_type)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_option_contracts_underlying_exp_type_strike
        ON option_contracts (underlying, expiration, option_type, strike)
    """)

    # --- Point-in-time snapshots ---
    # One row per contract per capture. Accumulates over time for history.
    # Greeks (delta/gamma/theta/vega/rho) are NULL when not available from source.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS option_snapshots (
            contract_id        TEXT    NOT NULL,
            captured_at        INTEGER NOT NULL,  -- unix epoch of this snapshot
            underlying_price   REAL,              -- spot price of underlying at capture time
            bid                REAL,
            ask                REAL,
            bid_size           INTEGER,
            ask_size           INTEGER,
            mid                REAL,              -- (bid+ask)/2, stored for query convenience
            last_price         REAL,
            change             REAL,
            change_pct         REAL,
            volume             INTEGER,
            open_interest      INTEGER,
            implied_volatility REAL,
            in_the_money       INTEGER,           -- 1/0 boolean
            last_trade_date    INTEGER,           -- unix epoch of last trade
            delta              REAL,
            gamma              REAL,
            theta              REAL,
            vega               REAL,
            rho                REAL,
            intrinsic_value    REAL,
            extrinsic_value    REAL,
            days_to_expiration REAL,
            risk_free_rate     REAL,
            greeks_source      TEXT,
            iv_source          TEXT,
            calc_error         TEXT,
            source             TEXT    NOT NULL DEFAULT 'yahoo',
            PRIMARY KEY (contract_id, captured_at),
            FOREIGN KEY (contract_id) REFERENCES option_contracts(contract_id)
        )
    """)
    for col_def in (
        "bid_size INTEGER",
        "ask_size INTEGER",
        "intrinsic_value REAL",
        "extrinsic_value REAL",
        "days_to_expiration REAL",
        "risk_free_rate REAL",
        "greeks_source TEXT",
        "iv_source TEXT",
        "calc_error TEXT",
    ):
        try:
            conn.execute(f"ALTER TABLE option_snapshots ADD COLUMN {col_def}")
        except Exception:
            pass
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_option_snapshots_contract_time
        ON option_snapshots (contract_id, captured_at DESC)
    """)
    # Fast lookup: latest snapshot across all contracts for a given underlying
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_option_snapshots_captured
        ON option_snapshots (captured_at DESC)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_option_snapshots_greeks_source
        ON option_snapshots (greeks_source, captured_at DESC)
    """)

    # --- Fetch metadata ---
    # Tracks the last time we successfully fetched the full chain for an underlying.
    # Use this to decide when a refresh is needed.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS option_chain_fetch_meta (
            underlying        TEXT    NOT NULL,
            source            TEXT    NOT NULL DEFAULT 'yahoo',
            fetched_at        INTEGER NOT NULL,
            expiration_count  INTEGER,  -- how many expiration dates were in the chain
            contract_count    INTEGER,  -- total contracts (calls + puts) fetched
            success           INTEGER NOT NULL DEFAULT 1,
            error_message     TEXT,
            duration_ms       INTEGER,
            PRIMARY KEY (underlying, source)
        )
    """)
    for col_def in (
        "success INTEGER NOT NULL DEFAULT 1",
        "error_message TEXT",
        "duration_ms INTEGER",
    ):
        try:
            conn.execute(f"ALTER TABLE option_chain_fetch_meta ADD COLUMN {col_def}")
        except Exception:
            pass


def ensure_all_schema(conn: sqlite3.Connection) -> None:
    """Create all SQLite tables used by the backend."""
    ensure_base_schema(conn)
    ensure_historical_schema(conn)
    ensure_options_schema(conn)
    conn.commit()
