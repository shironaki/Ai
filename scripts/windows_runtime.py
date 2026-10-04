#!/usr/bin/env python3
"""Native Windows runtime for the TEST bot.

Uses the same GitHub lease branch as the Termux runtime, but does not depend
on bash, /proc, ps, or Termux APIs. Default role is standby; set
WINDOWS_RUNTIME_ROLE=active to make this machine eligible to host the bot.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(os.getenv("BOT_REPO_DIR", Path(__file__).resolve().parents[1])).resolve()
PYTHON = Path(os.getenv("WINDOWS_PYTHON", str(ROOT / ".venv" / "Scripts" / "python.exe")))
BOT = ROOT / "run.py"
DATA = ROOT / "data" / "test" / "runtime"
ROLE_FILE = DATA / "windows-role"
PID_FILE = DATA / "windows-bot.pid"
LOG_FILE = ROOT / "windows-runtime.log"
LEASE_BRANCH = os.getenv("TERMUX_LEASE_BRANCH", "termux-lease").strip()
LEASE_PATH = os.getenv("TERMUX_LEASE_PATH", "lease.json").strip()
DEVICE_ID = os.getenv("WINDOWS_DEVICE_ID", "pc1").strip().casefold()
ROLE = os.getenv("WINDOWS_RUNTIME_ROLE", "standby").strip().casefold()
TTL = max(90, int(os.getenv("TERMUX_LEASE_TTL", "120")))
RENEW_BEFORE = max(30, int(os.getenv("TERMUX_LEASE_RENEW_BEFORE", "60")))
INTERVAL = max(5, int(os.getenv("WINDOWS_RUNTIME_INTERVAL", "10")))


def log(message: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}"
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    print(line, flush=True)


def git(*args: str, input_text: str | None = None, check: bool = True) -> str:
    env = os.environ.copy()
    # Runtime must never open an interactive credential/browser prompt.
    env.update({"GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "Never"})
    log(f"GIT: {' '.join(args)}")
    p = subprocess.run(["git", *args], cwd=ROOT, input=input_text, text=True,
                       capture_output=True, timeout=30, check=False, env=env)
    if check and p.returncode:
        raise RuntimeError((p.stderr or p.stdout or "git failed").strip()[-500:])
    return (p.stdout or "").strip()


def read_lease() -> tuple[dict, str]:
    git("fetch", "origin", LEASE_BRANCH)
    parent = git("rev-parse", f"origin/{LEASE_BRANCH}")
    raw = git("show", f"origin/{LEASE_BRANCH}:{LEASE_PATH}")
    return json.loads(raw or "{}"), parent


def write_lease(lease: dict, parent: str) -> bool:
    content = json.dumps(lease, separators=(",", ":")) + "\n"
    blob = git("hash-object", "-w", "--stdin", input_text=content)
    tree = git("mktree", input_text=f"100644 blob {blob}\t{LEASE_PATH}\n")
    env = os.environ.copy()
    env.update({"GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "Never",
                "GIT_AUTHOR_NAME": "Windows Runtime",
                "GIT_AUTHOR_EMAIL": "windows-runtime@localhost",
                "GIT_COMMITTER_NAME": "Windows Runtime",
                "GIT_COMMITTER_EMAIL": "windows-runtime@localhost"})
    p = subprocess.run(["git", "commit-tree", tree, "-p", parent, "-m",
                        f"chore: update Windows lease for {DEVICE_ID}"],
                       cwd=ROOT, text=True, capture_output=True, timeout=30,
                       env=env, check=False)
    if p.returncode:
        raise RuntimeError((p.stderr or p.stdout or "commit-tree failed").strip()[-500:])
    commit = p.stdout.strip()
    p = subprocess.run(["git", "push", "--porcelain", "origin",
                        f"{commit}:refs/heads/{LEASE_BRANCH}"],
                       cwd=ROOT, text=True, capture_output=True, timeout=30, check=False, env=env)
    if p.returncode == 0:
        return True
    detail = (p.stderr or p.stdout or "").lower()
    if "non-fast-forward" in detail or "[rejected]" in detail or "fetch first" in detail:
        return False
    raise RuntimeError(detail[-500:])


def acquire_or_renew() -> tuple[bool, str, int]:
    lease, parent = read_lease()
    now = int(time.time())
    owner = str(lease.get("owner", "")).strip().casefold()
    expires = int(lease.get("expires_at", 0) or 0)
    if owner == DEVICE_ID and expires > now and expires - now > RENEW_BEFORE:
        return True, f"lease owner={DEVICE_ID} ttl={expires-now}s", expires
    if owner and expires > now and owner != DEVICE_ID:
        return False, f"lease held by {owner} for {expires-now}s", expires
    new = {"owner": DEVICE_ID, "expires_at": now + TTL, "updated_at": now}
    if write_lease(new, parent):
        return True, f"lease acquired owner={DEVICE_ID} ttl={TTL}s", new["expires_at"]
    return False, "lease update conflict", now


def release() -> None:
    try:
        lease, parent = read_lease()
        if str(lease.get("owner", "")).strip().casefold() != DEVICE_ID:
            return
        write_lease({"owner": "", "expires_at": 0, "updated_at": int(time.time())}, parent)
    except Exception as exc:
        log(f"LEASE release failed: {type(exc).__name__}: {exc}")


def pid() -> int | None:
    try:
        value = int(PID_FILE.read_text(encoding="utf-8").strip())
        return value if value > 0 else None
    except Exception:
        return None


def running() -> bool:
    p = pid()
    if not p:
        return False
    try:
        result = subprocess.run(["tasklist", "/FI", f"PID eq {p}", "/FO", "CSV", "/NH"],
                                capture_output=True, text=True, timeout=5, check=False)
        return str(p) in result.stdout
    except Exception:
        return False


def stop_bot() -> None:
    p = pid()
    if p:
        subprocess.run(["taskkill", "/PID", str(p), "/T", "/F"],
                       capture_output=True, timeout=10, check=False)
    PID_FILE.unlink(missing_ok=True)


def health() -> bool:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(ROOT) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    p = subprocess.run([str(PYTHON), str(ROOT / "scripts" / "healthcheck.py")],
                       cwd=ROOT, env=env, text=True, capture_output=True,
                       timeout=20, check=False)
    if p.returncode == 0:
        log((p.stdout or "HEALTH OK").strip()[-500:])
        return True
    log(f"HEALTH FAIL: {(p.stdout or p.stderr).strip()[-500:]}")
    return False


def start_bot() -> bool:
    if running():
        return True
    log_handle = LOG_FILE.open("a", encoding="utf-8")
    p = subprocess.Popen([str(PYTHON), str(BOT)], cwd=ROOT, env=os.environ.copy(),
                         stdin=subprocess.DEVNULL, stdout=log_handle,
                         stderr=subprocess.STDOUT,
                         creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
    PID_FILE.write_text(str(p.pid), encoding="utf-8")
    time.sleep(8)
    return health()


def main() -> int:
    if os.name != "nt":
        print("Windows runtime requires Windows", file=sys.stderr)
        return 2
    if not PYTHON.exists():
        print(f"Missing Python runtime: {PYTHON}", file=sys.stderr)
        return 2
    DATA.mkdir(parents=True, exist_ok=True)
    ROLE_FILE.write_text(ROLE + "\n", encoding="utf-8")
    log(f"START device={DEVICE_ID} role={ROLE}")
    if ROLE not in {"active", "standby"}:
        log("Invalid role; refusing to run")
        return 2
    last_confirmed_expiry = 0
    try:
        while True:
            if ROLE == "standby":
                if running():
                    log("STANDBY: unexpected bot detected; stopping it")
                    stop_bot()
                else:
                    log(f"STANDBY: healthy; lease untouched; next check in {INTERVAL}s")
                time.sleep(INTERVAL)
                continue
            try:
                ok, msg, expires_at = acquire_or_renew()
            except Exception as exc:
                now = int(time.time())
                if running() and last_confirmed_expiry > now:
                    log(f"LEASE CHECK ERROR: preserving active bot until confirmed expiry ({type(exc).__name__}: {exc})")
                    time.sleep(INTERVAL)
                    continue
                log(f"LEASE CHECK FAILED: fencing bot ({type(exc).__name__}: {exc})")
                stop_bot()
                time.sleep(INTERVAL)
                continue
            last_confirmed_expiry = expires_at
            if not ok:
                log(f"FENCE: {msg}")
                stop_bot()
                time.sleep(INTERVAL)
                continue
            if not running() and not start_bot():
                release()
                stop_bot()
                time.sleep(INTERVAL)
                continue
            time.sleep(INTERVAL)
    except KeyboardInterrupt:
        log("STOP: keyboard interrupt")
    finally:
        if ROLE == "active":
            stop_bot()
            release()
        log("STOP: Windows runtime exited")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
