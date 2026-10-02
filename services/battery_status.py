"""Read the Android battery status through Termux:API."""

import json
import os
import subprocess


def get_battery_status() -> dict:
    """Return normalized battery information from termux-battery-status."""
    env = os.environ.copy()
    result = subprocess.run(
        ["termux-battery-status"],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
        env=env,
    )
    payload = json.loads(result.stdout)

    percentage = int(payload.get("percentage", payload.get("level", -1)))
    plugged = str(payload.get("plugged", "UNKNOWN")).upper()
    android_status = str(payload.get("status", "UNKNOWN")).upper()

    charging = (
        android_status in {"CHARGING", "FULL"}
        or (
            plugged not in {"UNPLUGGED", "NONE", "UNKNOWN"}
            and android_status != "DISCHARGING"
        )
    )

    return {
        "percentage": percentage,
        "plugged": plugged,
        "status": android_status,
        "charging": charging,
        "temperature": payload.get("temperature"),
    }
