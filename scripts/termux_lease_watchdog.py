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
INTERVAL = max(3, int(os.getenv("TERMUX_LEASE_WATCHDOG_INTERVAL", "5")))


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
        if pid <= 1:
            return False
        os.kill(pid, 0)
        cmdline_path = Path(f"/proc/{pid}/cmdline")
        if cmdline_path.exists():
            cmdline = cmdline_path.read_bytes().replace(b"\\x00", b" ").decode(errors="replace")
            return str(ROOT / "run.py") in cmdline
        command = subprocess.check_output(
            ["ps", "-p", str(pid), "-o", "command="],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=3,
        )
        return str(ROOT / "run.py") in command
    except Exception:
        return False


def read_lease() -> tuple[str, int]:
    git("fetch", "origin", LEASE_BRANCH)
    raw = git("show", f"origin/{LEASE_BRANCH}:{LEASE_PATH}")
    lease = json.loads(raw or "{}")
    return (
        str(lease.get("owner", "")).strip().casefold(),
        int(lease.get("expires_at", 0) or 0),
    )


def stop_bot() -> None:
    if not bot_running():
        BOT_PIDFILE.unlink(missing_ok=True)
        return
    try:
        os.kill(int(BOT_PIDFILE.read_text(encoding="utf-8").strip()), signal.SIGTERM)
    except Exception:
        pass
    BOT_PIDFILE.unlink(missing_ok=True)


def main() -> int:
    WATCHDOG_PIDFILE.write_text(str(os.getpid()), encoding="utf-8")
    last_expiry = 0
    try:
        # Fail closed if the watchdog cannot establish a valid lease before watching.
        try:
            _, last_expiry = read_lease()
        except Exception:
            stop_bot()
            return 1
        while bot_running():
            now = int(time.time())
            try:
                owner, expires_at = read_lease()
                last_expiry = expires_at
                if owner != DEVICE_ID or expires_at <= now:
                    stop_bot()
                    return 0
            except Exception:
                # If GitHub is unreachable, trust only the last successfully
                # observed expiry. Once it passes, fence the stale bot locally.
                if last_expiry and now >= last_expiry:
                    stop_bot()
                    return 0
            time.sleep(INTERVAL)
    finally:
        WATCHDOG_PIDFILE.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
