"""
ibkr_watchdog — polls IBKR Gateway every 5 minutes.
Restarts ibgw-vnc.service then ibgateway.service after 2 consecutive missed polls.
Run as its own systemd service.
"""

from __future__ import annotations

import asyncio
import logging
import subprocess
import sys

POLL_INTERVAL_SECONDS = 5 * 60
IBKR_HOST = "127.0.0.1"
IBKR_PORTS = (7497, 7496)
PROBE_TIMEOUT = 5.0
MAX_CONSECUTIVE_FAILURES = 2

logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format="%(asctime)s [ibkr-watchdog] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)


async def probe() -> bool:
    """Return True if any IBKR port accepts a TCP connection."""
    for port in IBKR_PORTS:
        try:
            _r, w = await asyncio.wait_for(
                asyncio.open_connection(IBKR_HOST, port), PROBE_TIMEOUT
            )
            w.close()
            await w.wait_closed()
            return True
        except Exception:
            pass
    return False


def restart_services() -> None:
    for svc in ("ibgw-vnc.service", "ibgateway.service"):
        log.warning("restarting %s", svc)
        result = subprocess.run(
            ["sudo", "systemctl", "restart", svc],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            log.error("failed to restart %s: %s", svc, result.stderr.strip())
        else:
            log.info("restarted %s", svc)


async def main() -> None:
    consecutive_failures = 0
    log.info("starting — polling %s:%s every %ds", IBKR_HOST, IBKR_PORTS, POLL_INTERVAL_SECONDS)

    while True:
        alive = await probe()

        if alive:
            if consecutive_failures:
                log.info("gateway recovered after %d failure(s)", consecutive_failures)
            consecutive_failures = 0
            log.info("gateway up")
        else:
            consecutive_failures += 1
            log.warning("gateway unreachable (consecutive failures: %d/%d)", consecutive_failures, MAX_CONSECUTIVE_FAILURES)

            if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                log.warning("threshold reached — restarting services")
                restart_services()
                consecutive_failures = 0

        await asyncio.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    asyncio.run(main())
