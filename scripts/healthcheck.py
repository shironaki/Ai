#!/usr/bin/env python3
"""External runtime health check for the TEST bot.

Health is considered good only when:
- the asyncio heartbeat file is fresh;
- Telegram getMe succeeds with the configured BOT_TOKEN.
"""

import os
import sys
import time
from pathlib import Path

import requests


def main() -> int:
    token = os.getenv("BOT_TOKEN", "").strip()
    if not token:
        print("HEALTH FAIL: BOT_TOKEN missing", file=sys.stderr)
        return 2

    data_dir = os.getenv("BOT_DATA_DIR", "data/test")
    heartbeat = Path(data_dir) / "runtime" / "heartbeat"
    try:
        timestamp = float(heartbeat.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        print("HEALTH FAIL: heartbeat missing or invalid", file=sys.stderr)
        return 1

    age = time.time() - timestamp
    if age < 0 or age > 30:
        print(f"HEALTH FAIL: heartbeat age={age:.1f}s", file=sys.stderr)
        return 1

    try:
        response = requests.get(
            f"https://api.telegram.org/bot{token}/getMe",
            timeout=8,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        print(f"HEALTH FAIL: Telegram API unavailable ({type(exc).__name__})", file=sys.stderr)
        return 1

    if not payload.get("ok"):
        print("HEALTH FAIL: Telegram API rejected getMe", file=sys.stderr)
        return 1

    username = payload.get("result", {}).get("username", "unknown")
    print(f"HEALTH OK: heartbeat={age:.1f}s telegram=@{username}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
