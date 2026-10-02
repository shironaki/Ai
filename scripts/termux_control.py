#!/usr/bin/env python3
"""Fixed-command emergency control plane for the Termux supervisor."""
from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path

REPO = os.getenv("TERMUX_GITHUB_REPO", "shironaki/Ai")
ISSUE = int(os.getenv("TERMUX_RUNTIME_ISSUE", "23"))
API = f"https://api.github.com/repos/{REPO}"
MARKER = "<!-- TERMUX-CONTROL -->"
RESULT_MARKER = "<!-- TERMUX-CONTROL-RESULT -->"
ALLOWED_AUTHOR = os.getenv("TERMUX_CONTROL_USER", "shironaki")
ROOT = Path(os.getenv("BOT_REPO_DIR", Path(__file__).resolve().parents[1]))
PYTHON = Path(os.getenv("TERMUX_PYTHON", str(ROOT / ".venv/bin/python")))
BOT = ROOT / "run.py"
PIDFILE = ROOT / "termux-bot.pid"
STATEFILE = ROOT / "data" / "test" / "runtime" / "termux-control-state.json"
ROLEFILE = ROOT / "data" / "test" / "runtime" / "termux-role"
DEVICE_ID = os.getenv("TERMUX_DEVICE_ID", "").strip().casefold()
LOG = ROOT / "termux-autoupdate.log"
TOKEN_FILE = Path(os.getenv("TERMUX_TOKEN_FILE", "~/.config/ai/termux.env")).expanduser()


def token() -> str:
    for name in ("TERMUX_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"):
        value = os.getenv(name, "").strip()
        if value:
            return value
    try:
        for line in TOKEN_FILE.read_text(encoding="utf-8").splitlines():
            if line.startswith("TERMUX_GITHUB_TOKEN="):
                return line.split("=", 1)[1].strip().strip("'").strip('"')
    except OSError:
        pass
    try:
        return subprocess.check_output(
            ["gh", "auth", "token"], text=True, stderr=subprocess.DEVNULL, timeout=5
        ).strip()
    except Exception:
        return ""


def request(method: str, path: str, value=None):
    tok = token()
    if not tok:
        raise RuntimeError("GitHub token unavailable")
    payload = None if value is None else json.dumps(value, ensure_ascii=False).encode()
    req = urllib.request.Request(
        API + path,
        data=payload,
        method=method,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {tok}",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=12) as response:
        return json.loads(response.read().decode("utf-8"))


def load_state() -> int | None:
    try:
        return int(json.loads(STATEFILE.read_text(encoding="utf-8"))["last_comment_id"])
    except Exception:
        return None


def save_state(comment_id: int) -> None:
    STATEFILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATEFILE.with_suffix(".tmp")
    tmp.write_text(json.dumps({"last_comment_id": comment_id}), encoding="utf-8")
    tmp.replace(STATEFILE)


def result(command: str, message: str) -> None:
    body = f"{RESULT_MARKER}\n## Termux control\ncommand: {command}\ntimestamp: {time.strftime('%Y-%m-%d %H:%M:%S %z')}\nresult: {message}"
    try:
        request("POST", f"/issues/{ISSUE}/comments", {"body": body})
    except Exception as exc:
        with LOG.open("a", encoding="utf-8") as fh:
            fh.write(f"CONTROL: result publish failed ({type(exc).__name__})\\n")


def bot_running() -> bool:
    if not PIDFILE.exists():
        return False
    try:
        pid = int(PIDFILE.read_text(encoding="utf-8").strip())
        os.kill(pid, 0)
        command = subprocess.check_output(
            ["ps", "-p", str(pid), "-o", "command="],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=3,
        )
        return str(BOT) in command
    except Exception:
        return False


def restart_bot() -> str:
    if bot_running():
        pid = PIDFILE.read_text(encoding="utf-8").strip()
        try:
            os.kill(int(pid), 15)
        except OSError:
            pass
        for _ in range(15):
            if not bot_running():
                break
            time.sleep(1)
    PIDFILE.unlink(missing_ok=True)

    LOG.parent.mkdir(parents=True, exist_ok=True)
    with (ROOT / "bot.log").open("a", encoding="utf-8") as log:
        process = subprocess.Popen(
            [str(PYTHON), str(BOT)],
            cwd=ROOT,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    PIDFILE.write_text(str(process.pid), encoding="utf-8")
    time.sleep(8)
    try:
        health = subprocess.check_output(
            [str(PYTHON), str(ROOT / "scripts/healthcheck.py")],
            cwd=ROOT,
            text=True,
            stderr=subprocess.STDOUT,
            timeout=15,
        ).strip()
        return health or "HEALTH OK"
    except subprocess.CalledProcessError as exc:
        return f"restart started pid={process.pid}; health failed: {exc.output.strip()[-500:]}"
    except Exception as exc:
        return f"restart started pid={process.pid}; health check error: {type(exc).__name__}"


def set_role(role: str) -> str:
    role = role.casefold()
    if role not in {"active", "standby"}:
        return "ignored: invalid role"
    ROLEFILE.parent.mkdir(parents=True, exist_ok=True)
    ROLEFILE.write_text(role + "\n", encoding="utf-8")
    if role == "standby":
        if bot_running():
            return "role=standby; stopping bot: " + restart_bot() if False else stop_bot_for_role()
        return "role=standby; bot already stopped"
    return "role=active; " + restart_bot()


def stop_bot_for_role() -> str:
    if not bot_running():
        PIDFILE.unlink(missing_ok=True)
        return "bot already stopped"
    pid = PIDFILE.read_text(encoding="utf-8").strip()
    try:
        os.kill(int(pid), 15)
    except OSError:
        pass
    for _ in range(15):
        if not bot_running():
            break
        time.sleep(1)
    PIDFILE.unlink(missing_ok=True)
    return "bot stopped"


def execute(command: str) -> str:
    if command.startswith("ROLE "):
        parts = command.split()
        if len(parts) != 3:
            return "ignored: ROLE syntax is ROLE <device_id> <active|standby>"
        target, role = parts[1].casefold(), parts[2].casefold()
        if not DEVICE_ID or target != DEVICE_ID:
            return "ignored: command targets another device"
        return set_role(role)
    if command == "STATUS":
        report = subprocess.run(
            [str(PYTHON), str(ROOT / "scripts/termux_report.py")],
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=30,
        )
        return (report.stdout or report.stderr or "status requested").strip()[-1000:]
    if command == "RESTART":
        return restart_bot()
    if command == "UPDATE":
        proc = subprocess.run(
            ["bash", str(ROOT / "scripts/termux_update.sh")],
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=180,
        )
        output = (proc.stdout or "") + (proc.stderr or "")
        return output.strip()[-1000:] or f"exit={proc.returncode}"
    return "ignored: unsupported command"


def main() -> int:
    comments = request("GET", f"/issues/{ISSUE}/comments?per_page=100")
    commands = [
        item for item in comments
        if MARKER in item.get("body", "")
        and item.get("user", {}).get("login") == ALLOWED_AUTHOR
    ]
    commands.sort(key=lambda item: item.get("id", 0))

    if not commands:
        return 0

    last = load_state()
    if last is None:
        save_state(int(commands[-1]["id"]))
        return 0

    for item in commands:
        comment_id = int(item["id"])
        if comment_id <= last:
            continue
        raw = item.get("body", "").split(MARKER, 1)[1]
        command = next(
            (line.strip().upper() for line in raw.splitlines() if line.strip()),
            "",
        )
        if command in {"STATUS", "RESTART", "UPDATE"} or command.startswith("ROLE "):
            message = execute(command)
            result(command, message.replace("\n", " "))
        save_state(comment_id)
        last = comment_id

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        with LOG.open("a", encoding="utf-8") as fh:
            fh.write(f"CONTROL: failed ({type(exc).__name__}: {exc})\\n")
        raise SystemExit(1)
