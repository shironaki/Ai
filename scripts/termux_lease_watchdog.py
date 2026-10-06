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
SUPERVISOR_PIDFILE = ROOT / "termux-supervisor.pid"
SUPERVISOR = ROOT / "scripts" / "termux_supervisor.sh"
SUPERVISOR_LOG = ROOT / "termux-supervisor.log"
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


def supervisor_running() -> bool:
    if not SUPERVISOR_PIDFILE.exists():
        return False
    try:
        pid = int(SUPERVISOR_PIDFILE.read_text(encoding="utf-8").strip())
        if pid <= 1:
            return False
        os.kill(pid, 0)
        cmdline = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\\x00", b" ").decode(errors="replace")
        return "termux_supervisor.sh" in cmdline
    except Exception:
        return False


def ensure_supervisor() -> None:
    if supervisor_running() or not SUPERVISOR.exists():
        return
    try:
        with SUPERVISOR_LOG.open("a", encoding="utf-8") as log:
            process = subprocess.Popen(
                ["bash", str(SUPERVISOR)],
                cwd=ROOT,
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        SUPERVISOR_PIDFILE.write_text(str(process.pid), encoding="utf-8")
    except Exception:
        # The lease watchdog must never die because supervisor recovery failed.
        pass


def read_lease() -> tuple[str, int]:
    git("fetch", "origin", LEASE_BRANCH)
    raw = git("show", f"origin/{LEASE_BRANCH}:{LEASE_PATH}")
    lease = json.loads(raw or "{}")
    return (
        str(lease.get("owner", "")).strip().casefold(),
        int(lease.get("expires_at", 0) or 0),
    )


def stop_bot() -> bool:
    """Fence the bot without clearing PID state while the process is alive."""
    if not bot_running():
        BOT_PIDFILE.unlink(missing_ok=True)
        return True
    try:
        pid = int(BOT_PIDFILE.read_text(encoding="utf-8").strip())
    except Exception:
        return False

    try:
        os.kill(pid, signal.SIGTERM)
    except Exception:
        pass

    for _ in range(5):
        if not bot_running():
            BOT_PIDFILE.unlink(missing_ok=True)
            return True
        time.sleep(1)

    # Do not leave a known stale bot alive after lease loss. If SIGTERM was
    # ignored, force the same process down before allowing another start.
    try:
        os.kill(pid, signal.SIGKILL)
    except Exception:
        pass
    for _ in range(5):
        if not bot_running():
            BOT_PIDFILE.unlink(missing_ok=True)
            return True
        time.sleep(1)

    # Preserve PID state when the process cannot be fenced; deleting it here
    # would allow a later supervisor/update pass to create a duplicate bot.
    return False


def main() -> int:
    WATCHDOG_PIDFILE.write_text(str(os.getpid()), encoding="utf-8")
    last_expiry = 0
    try:
        # The watchdog is also the last-resort supervisor guardian while a
        # detached bot is alive. This repairs the exact failure mode where the
        # supervisor dies but the bot process survives detached from it.
        ensure_supervisor()

        # Fail closed if the watchdog cannot establish a valid lease before watching.
        try:
            owner, last_expiry = read_lease()
            now = int(time.time())
            if owner != DEVICE_ID or last_expiry <= now:
                stop_bot()
                ensure_supervisor()
                return 0
        except Exception:
            stop_bot()
            ensure_supervisor()
            return 1
        while bot_running():
            now = int(time.time())
            ensure_supervisor()
            try:
                owner, expires_at = read_lease()
                last_expiry = expires_at
                if owner != DEVICE_ID or expires_at <= now:
                    stop_bot()
                    ensure_supervisor()
                    return 0
            except Exception:
                # If GitHub is unreachable, trust only the last successfully
                # observed expiry. Once it passes, fence the stale bot locally.
                if last_expiry and now >= last_expiry:
                    stop_bot()
                    ensure_supervisor()
                    return 0
            time.sleep(INTERVAL)
    finally:
        WATCHDOG_PIDFILE.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
