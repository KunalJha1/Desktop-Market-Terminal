"""Diagnostic script: verify MU fundamentals through the existing DailyIQ path.

Run standalone:
    cd backend && python tests/test_mu_dailyiq_fundamentals.py
"""

from __future__ import annotations

import json
import os
import sys

import requests
from env_loader import env_candidates, load_local_backend_env

from dailyiq_provider import fetch_fundamentals_from_dailyiq

ENV_CANDIDATES = env_candidates()
LOADED_ENV_PATHS = load_local_backend_env()

API_KEY = os.getenv("DAILYIQ_API_KEY")
SYMBOL = "MU"
TIMEOUT_S = 15


def format_market_cap(value: float | None) -> str:
    if value is None:
        return "N/A"
    if value >= 1e12:
        return f"${value / 1e12:.2f}T"
    if value >= 1e9:
        return f"${value / 1e9:.2f}B"
    if value >= 1e6:
        return f"${value / 1e6:.2f}M"
    return f"${value:.2f}"


def preview_payload(data: object, limit: int = 400) -> str:
    text = json.dumps(data, default=str)
    return text[:limit] + ("..." if len(text) > limit else "")


def main() -> int:
    print(f"DailyIQ MU fundamentals diagnostic\n{'=' * 40}")
    print(f"Symbol: {SYMBOL}")
    print(f"DAILYIQ_API_KEY present: {'yes' if API_KEY else 'no'}")
    if LOADED_ENV_PATHS:
        print("Loaded .env paths:")
        for env_path in LOADED_ENV_PATHS:
            print(f"  - {env_path}")
    else:
        print("No .env file found in:")
        for env_path in ENV_CANDIDATES:
            print(f"  - {env_path}")

    if not API_KEY:
        print("FAIL: DAILYIQ_API_KEY not found in environment or searched .env paths")
        return 1

    base = f"https://dailyiq.me/v1/{API_KEY}"
    url = f"{base}/fundamentals/{SYMBOL}"

    raw_payload: dict | None = None
    status_code: int | None = None
    raw_error: str | None = None

    try:
        response = requests.get(url, params={"units": "B"}, timeout=TIMEOUT_S)
        status_code = response.status_code
        response.raise_for_status()
        raw_payload = response.json()
    except Exception as exc:
        raw_error = str(exc)

    print("\nRaw DailyIQ response")
    print("-" * 40)
    if raw_payload is not None:
        print(f"HTTP status: {status_code}")
        print(f"Payload: {preview_payload(raw_payload)}")
    else:
        print(f"FAIL: request failed ({status_code if status_code is not None else 'no status'})")
        print(raw_error or "Unknown error")

    trailing_pe, forward_pe, market_cap = fetch_fundamentals_from_dailyiq(SYMBOL)

    print("\nParsed via dailyiq_provider.fetch_fundamentals_from_dailyiq")
    print("-" * 40)
    print(f"trailing_pe: {trailing_pe}")
    print(f"forward_pe: {forward_pe}")
    print(f"market_cap: {market_cap}")
    print(f"market_cap_formatted: {format_market_cap(market_cap)}")

    payload_has_market_cap = False
    if isinstance(raw_payload, dict):
        payload_has_market_cap = (
            raw_payload.get("marketCap") is not None
            or bool(raw_payload.get("marketCapDisplay"))
        )

    checks = [
        ("raw payload returned", raw_payload is not None),
        ("payload includes market cap field", payload_has_market_cap),
        ("provider parsed market cap", market_cap is not None),
    ]

    print("\nChecks")
    print("-" * 40)
    failed = False
    for label, ok in checks:
        print(f"[{'PASS' if ok else 'FAIL'}] {label}")
        failed = failed or not ok

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
