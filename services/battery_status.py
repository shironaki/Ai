"""Read cached Android battery status from the Termux watchdog."""

import json
import os
import time
from pathlib import Path


REPO = Path(os.getenv("BOT_REPO_DIR", Path.home() / "Ai"))
DATA_DIR = Path(os.getenv("BOT_DATA_DIR", REPO / "data" / "test"))
STATE_FILE = DATA_DIR / "runtime" / "battery_watchdog.json"
MAX_CACHE_AGE = int(os.getenv("TERMUX_BATTERY_CACHE_MAX_AGE", "120"))


def get_battery_status() -> dict:
    """Return the latest battery sample collected by the watchdog.

    The watchdog already polls Termux:API every minute. Reading its cache keeps
    the Telegram handler instantaneous and prevents a stuck Termux:API call
    from blocking the bot.
    """
    try:
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as exc:
        raise RuntimeError("battery watchdog cache is unavailable") from exc

    battery = state.get("last_battery")
    if not isinstance(battery, dict):
        raise RuntimeError("battery watchdog has not collected a sample yet")

    checked_at = int(battery.get("checked_at", 0))
    if checked_at <= 0:
        raise RuntimeError("battery watchdog sample has no timestamp")

    age = max(0, int(time.time()) - checked_at)
    if age > MAX_CACHE_AGE:
        raise RuntimeError(f"battery watchdog cache is stale ({age}s)")

    return {
        "percentage": int(battery.get("percentage", -1)),
        "plugged": str(battery.get("plugged", "UNKNOWN")).upper(),
        "status": str(battery.get("status", "UNKNOWN")).upper(),
        "charging": bool(battery.get("charging", False)),
        "temperature": battery.get("temperature"),
        "age_seconds": age,
    }
