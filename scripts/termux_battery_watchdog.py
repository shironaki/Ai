#!/usr/bin/env python3
"""Notify the founder when the permanent Termux phone is running low on battery."""

import json
import os
import subprocess
import time
from pathlib import Path

import requests

REPO = Path(os.getenv("BOT_REPO_DIR", Path.home() / "Ai"))
DATA_DIR = Path(os.getenv("BOT_DATA_DIR", REPO / "data" / "test"))
STATE_FILE = DATA_DIR / "runtime" / "battery_watchdog.json"
CHECK_INTERVAL = int(os.getenv("TERMUX_BATTERY_INTERVAL", "60"))
WARNING_LEVEL = int(os.getenv("TERMUX_BATTERY_WARNING", "20"))
CRITICAL_LEVEL = int(os.getenv("TERMUX_BATTERY_CRITICAL", "10"))
OWNER_ID = int(os.getenv("OWNER_ID", "1057867710"))
BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()


def read_battery() -> dict:
    result = subprocess.run(
        ["termux-battery-status"],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    return json.loads(result.stdout)


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {"warning_sent": False, "critical_sent": False}


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state), encoding="utf-8")
    tmp.replace(STATE_FILE)


def send_message(text: str) -> bool:
    if not BOT_TOKEN:
        return False
    response = requests.post(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
        json={"chat_id": OWNER_ID, "text": text, "parse_mode": "HTML"},
        timeout=15,
    )
    response.raise_for_status()
    payload = response.json()
    return bool(payload.get("ok"))


def main() -> int:
    if not BOT_TOKEN:
        print("BATTERY WATCHDOG: BOT_TOKEN missing")
        return 2

    while True:
        try:
            battery = read_battery()
            level = int(battery.get("percentage", -1))
            plugged = str(battery.get("plugged", "UNPLUGGED")).upper()
            charging = plugged not in {"UNPLUGGED", "NONE", "UNKNOWN"} and battery.get("status") != "DISCHARGING"

            state = load_state()

            if charging or level < 0:
                if charging:
                    state = {"warning_sent": False, "critical_sent": False}
                    save_state(state)
            else:
                if level <= CRITICAL_LEVEL and not state.get("critical_sent"):
                    if send_message(
                        f"🚨 <b>КРИТИЧЕСКИЙ ЗАРЯД</b>\n"
                        f"Второй телефон: <b>{level}%</b>.\n"
                        "Подключи его к зарядке, иначе бот может потерять связь."
                    ):
                        state["critical_sent"] = True
                        state["warning_sent"] = True
                        save_state(state)
                elif level <= WARNING_LEVEL and not state.get("warning_sent"):
                    if send_message(
                        f"🔋 <b>Низкий заряд</b>\n"
                        f"Второй телефон: <b>{level}%</b>.\n"
                        "Желательно подключить его к зарядке, чтобы бот не потерял связь."
                    ):
                        state["warning_sent"] = True
                        save_state(state)

            print(f"BATTERY WATCHDOG: {level}% status={battery.get('status')} plugged={plugged}", flush=True)
        except Exception as exc:
            print(f"BATTERY WATCHDOG: {type(exc).__name__}: {exc}", flush=True)

        time.sleep(CHECK_INTERVAL)


if __name__ == "__main__":
    raise SystemExit(main())
