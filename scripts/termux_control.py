#!/usr/bin/env python3
"""Fixed-command emergency control plane for the Termux supervisor."""
from __future__ import annotations

import base64
import json
import os
import subprocess
import threading
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
WATCHDOG_PIDFILE = ROOT / "termux-lease-watchdog.pid"
WATCHDOG = ROOT / "scripts/termux_lease_watchdog.py"
STATEFILE = ROOT / "data" / "test" / "runtime" / "termux-control-state.json"
ROLEFILE = ROOT / "data" / "test" / "runtime" / "termux-role"
DEVICE_ID = os.getenv("TERMUX_DEVICE_ID", "").strip().casefold()
LEASE_BRANCH = os.getenv("TERMUX_LEASE_BRANCH", "termux-lease").strip()
LEASE_PATH = os.getenv("TERMUX_LEASE_PATH", "lease.json").strip()
LEASE_TTL = max(90, int(os.getenv("TERMUX_LEASE_TTL", "120")))
LEASE_RENEW_BEFORE = max(30, int(os.getenv("TERMUX_LEASE_RENEW_BEFORE", "60")))
FORCE_FENCE_WAIT = max(15, int(os.getenv("TERMUX_FORCE_FENCE_WAIT", "20")))
AUTO_FAILOVER = os.getenv("TERMUX_AUTO_FAILOVER", "1").strip().casefold() in {"1", "true", "yes", "on"}
LOG = ROOT / "termux-autoupdate.log"
CONTROL_HEARTBEAT = ROOT / "data" / "test" / "runtime" / "control-heartbeat"
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
    last_error = None
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=8) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            last_error = exc
            if attempt == 0:
                time.sleep(1)
    raise last_error


def fetch_issue_comments(after_id: int | None = None) -> list[dict]:
    """Fetch newest comments first and page backwards until the saved cursor."""
    comments: list[dict] = []
    for page in range(1, 4):
        page_items = request(
            "GET",
            f"/issues/{ISSUE}/comments?per_page=100&page={page}&sort=created&direction=desc",
        )
        if not page_items:
            break
        comments.extend(page_items)
        if after_id is not None and any(int(item.get("id", 0)) <= after_id for item in page_items):
            break
        if len(page_items) < 100:
            break
    return comments


def lease_git(*args: str, input_text: str | None = None, check: bool = True) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        input=input_text,
        text=True,
        capture_output=True,
        timeout=20,
        check=False,
    )
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()[-500:]
        raise RuntimeError(f"git {' '.join(args)} failed: {detail}")
    return (result.stdout or "").strip()


def read_lease() -> tuple[dict, str]:
    """Read the central lease through GitHub API, not a blocking git fetch."""
    branch_ref = request("GET", f"/git/ref/heads/{LEASE_BRANCH}")
    parent = str(branch_ref.get("object", {}).get("sha", "")).strip()
    if not parent:
        raise RuntimeError(f"lease branch {LEASE_BRANCH!r} has no commit sha")

    try:
        item = request("GET", f"/contents/{LEASE_PATH}?ref={LEASE_BRANCH}")
    except Exception:
        # Recover from the historical CRLF-created lease.json carriage-return path.
        legacy_path = LEASE_PATH + "%0D"
        item = request("GET", f"/contents/{legacy_path}?ref={LEASE_BRANCH}")

    encoded = item.get("content", "")
    if not encoded:
        raise RuntimeError("lease file content is empty")
    raw = base64.b64decode(encoded).decode("utf-8")
    return json.loads(raw or "{}"), parent

def write_lease(lease: dict, parent: str) -> bool:
    content = json.dumps(lease, separators=(",", ":")) + "\n"
    blob = lease_git("hash-object", "-w", "--stdin", input_text=content)
    tree = lease_git(
        "mktree",
        input_text=f"100644 blob {blob}\t{LEASE_PATH}\n",
    )
    env = os.environ.copy()
    env.update({
        "GIT_AUTHOR_NAME": "Termux Lease",
        "GIT_AUTHOR_EMAIL": "termux-lease@localhost",
        "GIT_COMMITTER_NAME": "Termux Lease",
        "GIT_COMMITTER_EMAIL": "termux-lease@localhost",
    })
    result = subprocess.run(
        ["git", "commit-tree", tree, "-p", parent, "-m",
         f"chore: update Termux lease for {DEVICE_ID}"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=20,
        env=env,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()[-500:]
        raise RuntimeError(f"git commit-tree failed: {detail}")
    commit = result.stdout.strip()
    push = subprocess.run(
        ["git", "push", "--porcelain", "origin", f"{commit}:refs/heads/{LEASE_BRANCH}"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )
    if push.returncode == 0:
        return True
    detail = (push.stderr or push.stdout or "").strip().lower()
    if "non-fast-forward" in detail or "[rejected]" in detail or "fetch first" in detail:
        return False
    raise RuntimeError(f"git push lease failed: {detail[-500:]}")


def acquire_or_renew_lease() -> tuple[bool, str]:
    if not DEVICE_ID:
        return False, "TERMUX_DEVICE_ID is not configured"
    lease, parent = read_lease()
    now = int(time.time())
    owner = str(lease.get("owner", "")).strip().casefold()
    expires_at = int(lease.get("expires_at", 0) or 0)

    if owner == DEVICE_ID and expires_at > now:
        if expires_at - now > LEASE_RENEW_BEFORE:
            return True, f"lease owner={DEVICE_ID} ttl={expires_at - now}s"
        new_lease = {
            "owner": DEVICE_ID,
            "expires_at": now + LEASE_TTL,
            "updated_at": now,
        }
        if write_lease(new_lease, parent):
            return True, f"lease renewed owner={DEVICE_ID} ttl={LEASE_TTL}s"
        return False, "lease renewal conflict; another device won the lease"

    if owner and expires_at > now:
        return False, f"lease held by {owner} for {expires_at - now}s"

    new_lease = {
        "owner": DEVICE_ID,
        "expires_at": now + LEASE_TTL,
        "updated_at": now,
    }
    if write_lease(new_lease, parent):
        return True, f"lease acquired owner={DEVICE_ID} ttl={LEASE_TTL}s"
    return False, "lease update conflict; another device won the lease"


def release_lease() -> tuple[bool, str]:
    if not DEVICE_ID:
        return False, "TERMUX_DEVICE_ID is not configured"
    lease, parent = read_lease()
    owner = str(lease.get("owner", "")).strip().casefold()
    if owner != DEVICE_ID:
        return True, f"lease owner={owner or 'none'}"
    if write_lease({"owner": "", "expires_at": 0, "updated_at": int(time.time())}, parent):
        return True, "lease released"
    return False, "lease release conflict; refusing to overwrite another owner"


def force_takeover() -> str:
    if not DEVICE_ID:
        return "force denied: TERMUX_DEVICE_ID is not configured"
    try:
        lease, parent = read_lease()
        current_owner = str(lease.get("owner", "")).strip().casefold()
        now = int(time.time())
        new_lease = {
            "owner": DEVICE_ID,
            "expires_at": now + LEASE_TTL,
            "updated_at": now,
        }
        if current_owner == DEVICE_ID and int(lease.get("expires_at", 0) or 0) > now:
            lease_message = f"force takeover already owned by {DEVICE_ID}"
        elif not write_lease(new_lease, parent):
            return "force denied: lease changed concurrently; retry"
        else:
            lease_message = f"force takeover owner={DEVICE_ID}; previous_owner={current_owner or 'none'}"
            if current_owner and current_owner != DEVICE_ID:
                time.sleep(FORCE_FENCE_WAIT)
        ROLEFILE.parent.mkdir(parents=True, exist_ok=True)
        ROLEFILE.write_text("active\n", encoding="utf-8")
        health = restart_bot()
        if health.startswith("HEALTH OK:"):
            return f"{lease_message}; {health}"
        release_lease()
        ROLEFILE.write_text("standby\n", encoding="utf-8")
        return f"force takeover failed; lease released; {health}"
    except Exception as exc:
        return f"force denied: {type(exc).__name__}: {exc}"


def touch_control_heartbeat() -> None:
    CONTROL_HEARTBEAT.parent.mkdir(parents=True, exist_ok=True)
    CONTROL_HEARTBEAT.write_text(f"{time.time():.3f}\n", encoding="utf-8")


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


def result(command: str, message: str, source_comment_id: int | None = None) -> bool:
    """Publish a command result and report whether GitHub accepted it."""
    source = f"\nsource_comment_id: {source_comment_id}" if source_comment_id is not None else ""
    body = f"{RESULT_MARKER}\n## Termux control\ncommand: {command}\ntimestamp: {time.strftime('%Y-%m-%d %H:%M:%S %z')}{source}\nresult: {message}"
    try:
        request("POST", f"/issues/{ISSUE}/comments", {"body": body})
        return True
    except Exception as exc:
        with LOG.open("a", encoding="utf-8") as fh:
            fh.write(f"CONTROL: result publish failed ({type(exc).__name__})\\n")
        return False


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


def stop_watchdog() -> None:
    if not WATCHDOG_PIDFILE.exists():
        return
    try:
        os.kill(int(WATCHDOG_PIDFILE.read_text(encoding="utf-8").strip()), 15)
    except OSError:
        pass
    WATCHDOG_PIDFILE.unlink(missing_ok=True)


def start_watchdog() -> None:
    stop_watchdog()
    subprocess.Popen(
        [str(PYTHON), str(WATCHDOG)],
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def restart_bot() -> str:
    # Re-check the central lease at the exact process-start boundary.
    # The caller's earlier check is intentionally not sufficient: another
    # device may have won the lease while we were stopping the old process.
    if not has_active_lease():
        return "restart denied: active lease is no longer owned"
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
        if bot_running():
            try:
                os.kill(int(pid), 9)
            except OSError:
                pass
            for _ in range(5):
                if not bot_running():
                    break
                time.sleep(1)
        if bot_running():
            return "restart failed: old bot process still alive; PID state preserved"
    # The lease can change while the old process is stopping. Re-check again
    # immediately before spawning the replacement; the first check only fences
    # the beginning of the restart operation.
    if not has_active_lease():
        return "restart denied: active lease was lost during shutdown"
    stop_watchdog()
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
    start_watchdog()
    time.sleep(8)
    health_env = os.environ.copy()
    health_env["PYTHONPATH"] = str(ROOT) + (
        os.pathsep + health_env["PYTHONPATH"]
        if health_env.get("PYTHONPATH")
        else ""
    )
    try:
        health = subprocess.check_output(
            [str(PYTHON), str(ROOT / "scripts/healthcheck.py")],
            cwd=ROOT,
            env=health_env,
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
    if role == "active":
        try:
            acquired, lease_message = acquire_or_renew_lease()
        except Exception as exc:
            return f"role=active denied: lease unavailable ({type(exc).__name__})"
        if not acquired:
            return f"role=active denied: {lease_message}"
        ROLEFILE.parent.mkdir(parents=True, exist_ok=True)
        ROLEFILE.write_text("active\n", encoding="utf-8")
        health = restart_bot()
        if health.startswith("HEALTH OK:"):
            return f"role=active; {lease_message}; {health}"
        release_lease()
        ROLEFILE.write_text("standby\n", encoding="utf-8")
        return f"role=active failed; lease released; {health}"

    ROLEFILE.parent.mkdir(parents=True, exist_ok=True)
    ROLEFILE.write_text("standby\n", encoding="utf-8")
    stopped = stop_bot_for_role()
    try:
        released, lease_message = release_lease()
    except Exception as exc:
        released, lease_message = False, f"lease release failed ({type(exc).__name__})"
    return f"role=standby; {stopped}; {lease_message}"


def stop_bot_for_role() -> str:
    if not bot_running():
        stop_watchdog()
        PIDFILE.unlink(missing_ok=True)
        return "bot already stopped"
    pid = PIDFILE.read_text(encoding="utf-8").strip()
    try:
        os.kill(int(pid), 15)
    except OSError:
        pass
    for _ in range(15):
        if not bot_running():
            stop_watchdog()
            PIDFILE.unlink(missing_ok=True)
            return "bot stopped"
        time.sleep(1)

    # Never clear PID state while the verified bot is still alive: a later
    # control/supervisor pass could otherwise start a duplicate process.
    if bot_running():
        try:
            os.kill(int(pid), 9)
        except OSError:
            pass
        for _ in range(5):
            if not bot_running():
                stop_watchdog()
                PIDFILE.unlink(missing_ok=True)
                return "bot stopped"
            time.sleep(1)

    if bot_running():
        return "bot stop failed: process still alive; PID state preserved"

    stop_watchdog()
    PIDFILE.unlink(missing_ok=True)
    return "bot stopped"


def has_active_lease() -> bool:
    if not DEVICE_ID:
        return False
    try:
        lease, _ = read_lease()
    except Exception:
        return False
    owner = str(lease.get("owner", "")).strip().casefold()
    expires_at = int(lease.get("expires_at", 0) or 0)
    return owner == DEVICE_ID and expires_at > int(time.time())


def execute(command: str) -> str:
    if command.startswith("FORCE "):
        parts = command.split()
        if len(parts) != 3 or parts[2] != "ACTIVE":
            return "ignored: FORCE syntax is FORCE <device_id> ACTIVE"
        target = parts[1].casefold()
        if not DEVICE_ID or target != DEVICE_ID:
            return "ignored: command targets another device"
        return force_takeover()
    if command.startswith("ROLE "):
        parts = command.split()
        if len(parts) != 3:
            return "ignored: ROLE syntax is ROLE <device_id> <active|standby>"
        target, role = parts[1].casefold(), parts[2].casefold()
        if not DEVICE_ID or target != DEVICE_ID:
            return "ignored: command targets another device"
        return set_role(role)
    if command in {"STATUS", "RESTART", "UPDATE"} and not has_active_lease():
        return "ignored: command requires active device lease"
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


def heartbeat_loop() -> None:
    while True:
        time.sleep(10)
        try:
            touch_control_heartbeat()
        except Exception:
            pass


def main() -> int:
    touch_control_heartbeat()
    threading.Thread(target=heartbeat_loop, daemon=True).start()
    role = ROLEFILE.read_text(encoding="utf-8").strip().casefold() if ROLEFILE.exists() else "active"

    if role == "active":
        try:
            acquired, lease_message = acquire_or_renew_lease()
        except Exception as exc:
            acquired, lease_message = False, f"lease unavailable ({type(exc).__name__})"
        if not acquired:
            # A transient GitHub/HTTPS failure is not proof that the lease was
            # lost. Keep the active bot alive and let the independent lease
            # watchdog fence it if the last confirmed lease expiry is reached.
            transient = lease_message.startswith("lease unavailable (")
            if transient:
                with LOG.open("a", encoding="utf-8") as fh:
                    fh.write(f"CONTROL: lease check unavailable; preserving active role ({lease_message})\\n")
            else:
                stop_bot_for_role()
                ROLEFILE.parent.mkdir(parents=True, exist_ok=True)
                ROLEFILE.write_text("standby\\n", encoding="utf-8")
                with LOG.open("a", encoding="utf-8") as fh:
                    fh.write(f"CONTROL: active lease lost; bot stopped ({lease_message})\\n")
        if acquired:
            if bot_running():
                if not WATCHDOG_PIDFILE.exists():
                    start_watchdog()
            else:
                health = restart_bot()
                if health.startswith("HEALTH OK:"):
                    with LOG.open("a", encoding="utf-8") as fh:
                        fh.write(f"CONTROL: active role repaired missing bot ({health})\\n")
                else:
                    with LOG.open("a", encoding="utf-8") as fh:
                        fh.write(f"CONTROL: active role repair failed ({health})\\n")
        elif bot_running() and not WATCHDOG_PIDFILE.exists():
            start_watchdog()

    elif AUTO_FAILOVER:
        try:
            acquired, lease_message = acquire_or_renew_lease()
        except Exception as exc:
            acquired, lease_message = False, f"lease unavailable ({type(exc).__name__})"
        if acquired:
            ROLEFILE.parent.mkdir(parents=True, exist_ok=True)
            ROLEFILE.write_text("active\n", encoding="utf-8")
            health = restart_bot()
            if health.startswith("HEALTH OK:"):
                result("AUTO_FAILOVER", f"role=active; {lease_message}; {health}")
                return 0
            release_lease()
            ROLEFILE.write_text("standby\n", encoding="utf-8")
            with LOG.open("a", encoding="utf-8") as fh:
                fh.write(f"CONTROL: auto-failover start failed; lease released ({health})\\n")

    last = load_state()
    comments = fetch_issue_comments(last)
    touch_control_heartbeat()
    commands = [
        item for item in comments
        if MARKER in item.get("body", "")
        and item.get("user", {}).get("login") == ALLOWED_AUTHOR
    ]
    commands.sort(key=lambda item: item.get("id", 0))

    if not commands:
        return 0

    result_ids = set()
    for item in comments:
        body = item.get("body", "")
        if RESULT_MARKER not in body:
            continue
        for line in body.splitlines():
            if line.strip().startswith("source_comment_id:"):
                try:
                    result_ids.add(int(line.split(":", 1)[1].strip()))
                except ValueError:
                    pass

    # Migrate old state written by the pre-publication-ack implementation.
    # That version could advance last_comment_id even when publishing a result
    # failed, which permanently hid the command on every subsequent restart.
    if last is not None:
        for item in commands:
            comment_id = int(item["id"])
            if comment_id == last and comment_id not in result_ids:
                raw = item.get("body", "").split(MARKER, 1)[1]
                command = next((line.strip().upper() for line in raw.splitlines() if line.strip()), "")
                if command in {"STATUS", "RESTART", "UPDATE"} or command.startswith("ROLE ") or command.startswith("FORCE "):
                    message = execute(command)
                    published = result(command, message.replace("\n", " "), comment_id)
                    if not published:
                        with LOG.open("a", encoding="utf-8") as fh:
                            fh.write(f"CONTROL: migrated command {comment_id} retained for retry after result publish failure\\n")
                        return 1
                break

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
        if command in {"STATUS", "RESTART", "UPDATE"} or command.startswith("ROLE ") or command.startswith("FORCE "):
            message = execute(command)
            published = result(command, message.replace("\n", " "), comment_id)
            if not published:
                with LOG.open("a", encoding="utf-8") as fh:
                    fh.write(f"CONTROL: command {comment_id} retained for retry after result publish failure\\n")
                return 1
        save_state(comment_id)
        touch_control_heartbeat()
        last = comment_id

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        with LOG.open("a", encoding="utf-8") as fh:
            fh.write(f"CONTROL: failed ({type(exc).__name__}: {exc})\\n")
        raise SystemExit(1)
