#!/usr/bin/env python3
"""External runtime health check for the TEST bot.

Health is considered good only when:
- the asyncio heartbeat file is fresh;
- Telegram getMe succeeds with the configured BOT_TOKEN.
"""

import os
import socket
import sys
import time
from pathlib import Path

# The healthcheck is invoked as a script from several working directories.
# Bootstrap the repository root explicitly so project packages such as
# ``services`` are always importable.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import requests


def _safe_error(value, limit: int = 180) -> str:
    """Keep healthcheck self-contained so bootstrap never depends on project imports."""
    text = str(value)[:limit]
    token = os.getenv("BOT_TOKEN", "").strip()
    return text.replace(token, "[REDACTED]") if token else text



def _network_diagnostics() -> list[str]:
    """Measure the network path to Telegram without exposing the bot token."""
    lines = []
    host = "api.telegram.org"
    try:
        started = time.perf_counter()
        addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        dns_ms = (time.perf_counter() - started) * 1000
        ips = sorted({item[4][0] for item in addresses})
        lines.append(f"NETWORK DNS: OK {dns_ms:.0f}ms ips={','.join(ips[:4])}")
    except Exception as exc:
        lines.append(f"NETWORK DNS: FAIL {type(exc).__name__}: {_safe_error(exc, 180)}")
    try:
        started = time.perf_counter()
        with socket.create_connection((host, 443), timeout=5):
            tcp_ms = (time.perf_counter() - started) * 1000
        lines.append(f"NETWORK TCP443: OK {tcp_ms:.0f}ms")
    except Exception as exc:
        lines.append(f"NETWORK TCP443: FAIL {type(exc).__name__}: {str(exc)[:180]}")
    try:
        started = time.perf_counter()
        response = requests.get("https://api.telegram.org/", timeout=(5, 8))
        https_ms = (time.perf_counter() - started) * 1000
        lines.append(f"NETWORK HTTPS: OK {https_ms:.0f}ms status={response.status_code}")
    except Exception as exc:
        https_ms = (time.perf_counter() - started) * 1000
        lines.append(f"NETWORK HTTPS: FAIL {https_ms:.0f}ms {type(exc).__name__}: {str(exc)[:180]}")
    return lines


def _telegram_get(url: str, attempts: int = 3):
    """Retry short-lived Telegram transport failures before declaring health bad."""
    last_error = None
    for attempt in range(attempts):
        try:
            return requests.get(url, timeout=(5, 8))
        except requests.RequestException as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(attempt + 1)
    raise last_error or RuntimeError("Telegram request failed")


def main() -> int:
    diagnostics = "--diagnostics" in sys.argv
    token = os.getenv("BOT_TOKEN", "").strip()
    if diagnostics:
        for line in _network_diagnostics():
            print(line)
    if not token:
        print("HEALTH FAIL: BOT_TOKEN missing", file=sys.stderr)
        return 2

    data_dir = os.getenv("BOT_DATA_DIR", "data/test")
    runtime_dir = Path(data_dir) / "runtime"
    role_file = runtime_dir / "termux-role"
    role = role_file.read_text(encoding="utf-8").strip().casefold() if role_file.exists() else "active"
    heartbeat_name = "supervisor-heartbeat" if role == "standby" else "heartbeat"
    heartbeat = runtime_dir / heartbeat_name
    try:
        timestamp = float(heartbeat.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        print(f"HEALTH FAIL: {heartbeat_name} missing or invalid", file=sys.stderr)
        return 1

    age = time.time() - timestamp
    max_age = 90 if role == "standby" else 30
    if age < 0 or age > max_age:
        print(f"HEALTH FAIL: {heartbeat_name} age={age:.1f}s", file=sys.stderr)
        return 1

    try:
        response = _telegram_get(f"https://api.telegram.org/bot{token}/getMe")
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        print(f"HEALTH FAIL: Telegram API unavailable ({type(exc).__name__}: {str(exc)[:180]})", file=sys.stderr)
        return 1

    if not payload.get("ok"):
        print("HEALTH FAIL: Telegram API rejected getMe", file=sys.stderr)
        return 1

    try:
        webhook = _telegram_get(f"https://api.telegram.org/bot{token}/getWebhookInfo")
        webhook.raise_for_status()
        webhook_payload = webhook.json()
    except Exception as exc:
        print(f"HEALTH FAIL: Telegram webhook status unavailable ({type(exc).__name__})", file=sys.stderr)
        return 1

    if not webhook_payload.get("ok"):
        print("HEALTH FAIL: Telegram API rejected getWebhookInfo", file=sys.stderr)
        return 1

    webhook_url = webhook_payload.get("result", {}).get("url", "")
    if webhook_url:
        print("HEALTH FAIL: webhook is configured; polling cannot receive updates", file=sys.stderr)
        return 1

    log_path = Path(os.getenv("BOT_LOG_FILE", "bot.log"))
    try:
        recent = log_path.read_text(encoding="utf-8", errors="replace")[-200_000:]
    except OSError:
        recent = ""
    recent_lines = recent.splitlines()
    now = time.time()
    for line in reversed(recent_lines):
        if "Conflict: terminated by other getUpdates request" not in line:
            continue
        try:
            timestamp = time.mktime(time.strptime(line[:19], "%Y-%m-%d %H:%M:%S"))
        except (ValueError, OverflowError):
            timestamp = now
        if now - timestamp <= 120:
            print("HEALTH FAIL: recent Telegram polling conflict detected", file=sys.stderr)
            return 1

    username = payload.get("result", {}).get("username", "unknown")
    ai_ready = bool(os.getenv("GROQ_API_KEY", "").strip())
    ai_state = "ready" if ai_ready else "unconfigured"
    if diagnostics:
        print(f"NETWORK TELEGRAM getMe: OK username=@{username}")
    state = "supervisor" if role == "standby" else "bot"
    polling = "standby" if role == "standby" else "ready"
    print(f"HEALTH OK: {state}_heartbeat={age:.1f}s role={role} telegram=@{username} polling={polling} ai={ai_state}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
