#!/usr/bin/env python3
"""Publish sanitized live Termux diagnostics to GitHub Issue #23."""
from __future__ import annotations
import json, os, re, subprocess, time, urllib.request
from pathlib import Path

REPO = os.getenv("TERMUX_GITHUB_REPO", "shironaki/Ai")
ISSUE = int(os.getenv("TERMUX_RUNTIME_ISSUE", "23"))
API = f"https://api.github.com/repos/{REPO}"
MARKER = "<!-- TERMUX-RUNTIME -->"
ROOT = Path(os.getenv("BOT_REPO_DIR", Path(__file__).resolve().parents[1]))
BOT_LOG = ROOT / os.getenv("BOT_LOG_FILE", "bot.log")
UPDATE_LOG = ROOT / os.getenv("TERMUX_UPDATE_LOG", "termux-autoupdate.log")
SUPERVISOR_PID = ROOT / "termux-supervisor.pid"
CONTROL_HEARTBEAT = ROOT / "data" / "test" / "runtime" / "control-heartbeat"
BOT_PID = ROOT / "termux-bot.pid"
TOKEN_FILE = Path(os.getenv("TERMUX_TOKEN_FILE", "~/.config/ai/termux.env")).expanduser()

def run(*args: str) -> str:
    try:
        return subprocess.check_output(args, cwd=ROOT, text=True, stderr=subprocess.STDOUT, timeout=8).strip()
    except Exception as exc:
        return f"<error: {type(exc).__name__}>"

def tail(path: Path, lines: int = 80) -> str:
    try:
        data = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return "<missing>"
    return "\n".join(data[-lines:]) if data else "<empty>"

def redact(text: str) -> str:
    for secret in (os.getenv("BOT_TOKEN", ""), os.getenv("GITHUB_TOKEN", ""),
                   os.getenv("GH_TOKEN", ""), os.getenv("TERMUX_GITHUB_TOKEN", "")):
        if secret:
            text = text.replace(secret, "[REDACTED]")
    return re.sub(r"(bot\d{6,}:[A-Za-z0-9_-]{20,})", "[REDACTED]", text)

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
        return subprocess.check_output(["gh", "auth", "token"], text=True, stderr=subprocess.DEVNULL, timeout=5).strip()
    except Exception:
        return ""

def request(method: str, path: str, value=None):
    tok = token()
    if not tok:
        raise RuntimeError("GitHub token unavailable; configure ~/.config/ai/termux.env or gh auth")
    payload = None if value is None else json.dumps(value, ensure_ascii=False).encode()
    req = urllib.request.Request(
        API + path, data=payload, method=method,
        headers={"Accept": "application/vnd.github+json", "Authorization": f"Bearer {tok}",
                 "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=12) as response:
        return json.loads(response.read().decode("utf-8"))

def snapshot() -> str:
    commit = run("git", "rev-parse", "HEAD")
    branch = run("git", "branch", "--show-current")
    git_status = run("git", "status", "--porcelain")
    health_python = os.getenv("TERMUX_PYTHON", str(ROOT / ".venv/bin/python"))
    health_env = os.environ.copy()
    health_env["PYTHONPATH"] = str(ROOT) + (
        os.pathsep + health_env["PYTHONPATH"]
        if health_env.get("PYTHONPATH")
        else ""
    )
    try:
        health = subprocess.check_output(
            [health_python, str(ROOT / "scripts/healthcheck.py")],
            cwd=ROOT,
            env=health_env,
            text=True,
            stderr=subprocess.STDOUT,
            timeout=8,
        ).strip()
    except subprocess.TimeoutExpired:
        health = "<healthcheck timeout after 8s>"
    except subprocess.CalledProcessError as exc:
        detail = (exc.output or "").strip().replace("\\n", " ")
        health = f"<healthcheck failed: {detail[-500:]}>"
    except Exception as exc:
        health = f"<healthcheck error: {type(exc).__name__}>"
    ai_configured = bool(os.getenv("GROQ_API_KEY", "").strip())
    ai_model = os.getenv("AI_MODEL", "openai/gpt-oss-20b")
    bot_pid = BOT_PID.read_text(encoding="utf-8").strip() if BOT_PID.exists() else "<missing>"
    supervisor_pid = SUPERVISOR_PID.read_text(encoding="utf-8").strip() if SUPERVISOR_PID.exists() else "<missing>"
    control_heartbeat = run("stat", "-c", "%Y", str(CONTROL_HEARTBEAT)) if CONTROL_HEARTBEAT.exists() else "<missing>"
    device_id = os.getenv("TERMUX_DEVICE_ID", "") or "<unset>"
    bot_ps = run("ps", "-p", bot_pid, "-o", "pid=,etime=,command=") if bot_pid.isdigit() else "<not running>"
    sup_ps = run("ps", "-p", supervisor_pid, "-o", "pid=,etime=,command=") if supervisor_pid.isdigit() else "<not running>"
    return redact(
        f"""{MARKER}
## Termux runtime
timestamp: {time.strftime("%Y-%m-%d %H:%M:%S %z")}
branch: {branch}
git status: {git_status or "<clean>"}
commit: {commit}
health: {health or "<empty>"}
ai: {"configured" if ai_configured else "UNCONFIGURED"} model={ai_model}
bot process: {bot_ps}
supervisor process: {sup_ps}
device id: {device_id}
control heartbeat mtime: {control_heartbeat}

### bot.log (tail)
{tail(BOT_LOG)}

### termux-autoupdate.log (tail)
{tail(UPDATE_LOG)}
"""
    )

def main() -> int:
    body = snapshot()
    try:
        comments = request("GET", f"/issues/{ISSUE}/comments?per_page=100")
        existing = next((item for item in comments if MARKER in item.get("body", "")), None)
        if existing:
            request("PATCH", f"/issues/comments/{existing['id']}", {"body": body})
        else:
            request("POST", f"/issues/{ISSUE}/comments", {"body": body})
        print("TERMUX TELEMETRY: published")
        return 0
    except Exception as exc:
        print(f"TERMUX TELEMETRY: failed ({type(exc).__name__}: {exc})")
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
