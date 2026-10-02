#!/usr/bin/env python3
"""Fences a detached Termux bot when its central lease is lost."""
from __future__ import annotations

import json
import os
import signal
import subprocess
import time
from pathlib import Path

ROOT = Path(os.getenv("BOT_REPO_DIR", Path(__file__).resolve().parents[1]))
LEASE_BRANCH = os.getenv("TERMUX_LEASE_BRANCH", "termux-lease").strip()
LEASE_PATH = os.getenv("TERMUX_LEASE_PATH", "lease.json").strip()
DEVICE_ID = os.getenv("TERMUX_DEVICE_ID", "").strip().casefold()
BOT_PIDFILE = ROOT / "termux-bot.pid"
WATCHDOG_PIDFILE = ROOT / "termux-lease-watchdog.pid"
INTERVAL = max(5, int(os.getenv("TERMUX_LEASE_WATCHDOG_INTERVAL", "15")))


def git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=15,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "git failed").strip()[-500:])
    return (result.stdout or "").strip()


def bot_running() -> bool:
    if not BOT_PIDFILE.exists():
        return False
    try:
        pid = int(BOT_PIDFILE.read_text(encoding="utf-8").strip())
        os.kill(pid, 0)
        return True
    except Exception:
        return False


def lease_is_owned() -> bool:
    git("fetch", "origin", LEASE_BRANCH)
    raw = git("show", f"origin/{LEASE_BRANCH}:{LEASE_PATH}")
    lease = json.loads(raw or "{}")
    owner = str(lease.get("owner", "")).strip().casefold()
    expires_at = int(lease.get("expires_at", 0) or 0)
    return owner == DEVICE_ID and expires_at > int(time.time())


def stop_bot() -> None:
    if BOT_PIDFILE.exists():
        try:
            os.kill(int(BOT_PIDFILE.read_text(encoding="utf-8").strip()), signal.SIGTERM)
        except Exception:
            pass
        BOT_PIDFILE.unlink(missing_ok=True)


def main() -> int:
    WATCHDOG_PIDFILE.write_text(str(os.getpid()), encoding="utf-8")
    try:
        while bot_running():
            try:
                if not lease_is_owned():
                    stop_bot()
                    return 0
            except Exception:
                # Network/GitHub outage is fail-closed: never kill the current bot
                # merely because the lease cannot be checked.
                pass
            time.sleep(INTERVAL)
    finally:
        WATCHDOG_PIDFILE.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
