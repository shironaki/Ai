#!/usr/bin/env python3
"""Notify the founder when the permanent Termux phone is running low on battery."""

import json
import os
import shutil
import signal
import subprocess
import time
from pathlib import Path

import requests

REPO = Path(os.getenv("BOT_REPO_DIR", Path.home() / "Ai"))
DATA_DIR = Path(os.getenv("BOT_DATA_DIR", REPO / "data" / "test"))
STATE_FILE = DATA_DIR / "runtime" / "battery_watchdog.json"
CHECK_INTERVAL = int(os.getenv("TERMUX_BATTERY_INTERVAL", "15"))
BATTERY_TIMEOUT = int(os.getenv("TERMUX_BATTERY_TIMEOUT", "10"))
WARNING_LEVEL = int(os.getenv("TERMUX_BATTERY_WARNING", "20"))
CRITICAL_LEVEL = int(os.getenv("TERMUX_BATTERY_CRITICAL", "10"))
OWNER_ID = int(os.getenv("OWNER_ID", "1057867710"))
BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
BATTERY_COMMAND = os.getenv(
    "TERMUX_BATTERY_COMMAND",
    "/data/data/com.termux/files/usr/bin/termux-battery-status",
)


def resolve_battery_command() -> str:
    if os.path.isabs(BATTERY_COMMAND) and os.access(BATTERY_COMMAND, os.X_OK):
        return BATTERY_COMMAND

    resolved = shutil.which(BATTERY_COMMAND)
    if resolved:
        return resolved

    fallback = "/data/data/com.termux/files/usr/bin/termux-battery-status"
    if os.access(fallback, os.X_OK):
        return fallback

    raise FileNotFoundError(f"termux-battery-status executable not found: {BATTERY_COMMAND}")


def read_battery() -> dict:
    command = resolve_battery_command()
    process = subprocess.Popen(
        [command],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    try:
        stdout, stderr = process.communicate(timeout=BATTERY_TIMEOUT)
    except subprocess.TimeoutExpired as exc:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=2)
        raise TimeoutError(
            f"{command} timed out after {BATTERY_TIMEOUT}s"
        ) from exc

    if process.returncode != 0:
        detail = stderr.strip()
        raise RuntimeError(
            f"{command} exited with code {process.returncode}"
            + (f": {detail[:500]}" if detail else "")
        )

    battery = json.loads(stdout)
    if not isinstance(battery, dict):
        raise ValueError("termux-battery-status returned non-object JSON")
    return battery


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
        print("BATTERY WATCHDOG: BOT_TOKEN missing", flush=True)
        return 2

    while True:
        try:
            battery = read_battery()
            level = int(battery.get("percentage", -1))
            plugged = str(battery.get("plugged", "UNPLUGGED")).upper()
            charging = plugged not in {"UNPLUGGED", "NONE", "UNKNOWN"} and battery.get("status") != "DISCHARGING"

            state = load_state()
            state["last_battery"] = {
                "percentage": level,
                "plugged": plugged,
                "status": str(battery.get("status", "UNKNOWN")).upper(),
                "charging": charging,
                "temperature": battery.get("temperature"),
                "checked_at": int(time.time()),
            }
            state["last_error"] = None
            save_state(state)

            if charging or level < 0:
                if charging:
                    state["warning_sent"] = False
                    state["critical_sent"] = False
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

            print(
                f"BATTERY WATCHDOG: {level}% status={battery.get('status')} "
                f"plugged={plugged}",
                flush=True,
            )
        except Exception as exc:
            state = load_state()
            state["last_error"] = {
                "type": type(exc).__name__,
                "message": str(exc)[:500],
                "checked_at": int(time.time()),
            }
            save_state(state)
            print(f"BATTERY WATCHDOG: {type(exc).__name__}: {exc}", flush=True)

        time.sleep(CHECK_INTERVAL)


if __name__ == "__main__":
    raise SystemExit(main())
