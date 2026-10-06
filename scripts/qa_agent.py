#!/usr/bin/env python3
"""Autonomous Telethon QA agent controlled through GitHub Issue #27.

The agent is intentionally isolated from the bot process and only uses the
pre-provisioned QA session on the second Android device. It executes named
scenarios, captures every bot reply after each send, and includes a bounded
tail of bot/runtime logs in the report.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path

REPO = os.getenv("QA_GITHUB_REPO", "shironaki/Ai")
ISSUE = int(os.getenv("QA_ISSUE", "27"))
MARKER = "<!-- QA-AGENT-CONTROL -->"
RESULT = "<!-- QA-AGENT-RESULT -->"
USER = os.getenv("QA_CONTROL_USER", "shironaki")
ROOT = Path(os.getenv("BOT_REPO_DIR", Path(__file__).resolve().parents[1]))
TOKEN_FILE = Path(os.getenv("TERMUX_TOKEN_FILE", "~/.config/ai/termux.env")).expanduser()
STATE = ROOT / "data/test/runtime/qa-agent-state.json"
SCENARIOS = ROOT / "qa/scenarios.json"
QA_PYTHON = Path(os.getenv("QA_PYTHON", str(Path.home() / "Ai/qa_client/.venv/bin/python")))
SESSION = Path(
    os.getenv(
        "QA_SESSION",
        str(Path.home() / ".config/ai/qa_client/founder_qa.session"),
    )
).expanduser()
API_ID = os.getenv("QA_API_ID", "36412572")
DEFAULT_TARGET = os.getenv("QA_TARGET", "AiAether1_Bot")
QA_BRANCH = os.getenv("QA_GITHUB_BRANCH", "test-global-assistant-upgrade")
DATA_DIR = Path(os.getenv("BOT_DATA_DIR", str(ROOT / "data" / "test")))
BOT_LOG = DATA_DIR / "bot.log"
RUNTIME_LOG = DATA_DIR / "termux-autoupdate.log"
SCRIPT_MTIME = Path(__file__).stat().st_mtime


def api_hash() -> str:
    value = os.getenv("QA_API_HASH", "").strip()
    if value:
        return value
    config_dir = SESSION.parent
    try:
        for path in config_dir.rglob("*"):
            if not path.is_file() or path.stat().st_size >= 10000:
                continue
            for line in path.read_text(errors="ignore").splitlines():
                if line.strip().lower().startswith(("api_hash=", "api_hash =")):
                    return line.split("=", 1)[1].strip().strip("'").strip('"')
    except OSError:
        pass
    return ""


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
            ["gh", "auth", "token"],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=5,
        ).strip()
    except Exception:
        return ""


def gh(method: str, path: str, value=None):
    tok = token()
    if not tok:
        raise RuntimeError("GitHub token unavailable")
    req = urllib.request.Request(
        "https://api.github.com/repos/" + REPO + path,
        data=None if value is None else json.dumps(value, ensure_ascii=False).encode(),
        method=method,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + tok,
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def comments() -> list[dict]:
    out: list[dict] = []
    for page in range(1, 11):
        items = gh("GET", f"/issues/{ISSUE}/comments?per_page=100&page={page}")
        if not items:
            break
        out.extend(items)
        if len(items) < 100:
            break
    return out


def state() -> int:
    try:
        return int(json.loads(STATE.read_text(encoding="utf-8"))["last_comment_id"])
    except Exception:
        return 0


def save(comment_id: int) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps({"last_comment_id": comment_id}), encoding="utf-8")
    tmp.replace(STATE)


def publish(message: str) -> None:
    body = RESULT + "\n" + message
    limit = 60000
    if len(body) > limit:
        body = body[:45000] + "\n\n...[QA REPORT TRUNCATED]...\n\n" + body[-14000:]
    gh("POST", f"/issues/{ISSUE}/comments", {"body": body})


def tail(path: Path, lines: int = 80) -> str:
    try:
        data = path.read_text(encoding="utf-8", errors="replace").splitlines()
        return "\n".join(data[-lines:])
    except OSError:
        return f"[missing: {path}]"


def refresh_scenarios_from_github() -> bool:
    """Refresh the scenario catalog when a runtime checkout is stale.

    Prefer the local git remote so runtime updates do not depend on a second
    GitHub API request. Fall back to the API when the checkout cannot fetch.
    """
    errors: list[str] = []

    try:
        subprocess.run(
            ["git", "fetch", "--quiet", "origin", QA_BRANCH],
            cwd=ROOT,
            check=True,
            timeout=30,
            capture_output=True,
            text=True,
        )
        content = subprocess.check_output(
            ["git", "show", f"origin/{QA_BRANCH}:qa/scenarios.json"],
            cwd=ROOT,
            text=True,
            timeout=10,
        )
        parsed = json.loads(content)
        if not isinstance(parsed, dict):
            raise ValueError("scenario catalog root must be an object")
        SCENARIOS.parent.mkdir(parents=True, exist_ok=True)
        tmp = SCENARIOS.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(parsed, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        tmp.replace(SCENARIOS)
        return True
    except Exception as exc:
        errors.append(f"git: {type(exc).__name__}: {exc}")

    try:
        from urllib.parse import quote

        item = gh(
            "GET",
            f"/contents/qa/scenarios.json?ref={quote(QA_BRANCH, safe='')}",
        )
        encoded = item.get("content", "")
        if not encoded:
            raise ValueError("GitHub API returned no file content")
        import base64

        content = base64.b64decode(encoded).decode("utf-8")
        parsed = json.loads(content)
        if not isinstance(parsed, dict):
            raise ValueError("scenario catalog root must be an object")
        SCENARIOS.parent.mkdir(parents=True, exist_ok=True)
        tmp = SCENARIOS.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(parsed, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        tmp.replace(SCENARIOS)
        return True
    except Exception as exc:
        errors.append(f"github: {type(exc).__name__}: {exc}")

    raise RuntimeError("scenario refresh failed: " + " | ".join(errors))


def load_scenarios() -> dict:
    return json.loads(SCENARIOS.read_text(encoding="utf-8"))


def _expand_scenario(name: str, raw) -> tuple[list[dict], list[dict]]:
    """Normalize legacy flat scenarios and structured role matrices.

    The live agent is a QA identity, so non-QA actors are never impersonated.
    Their coverage is reported explicitly instead of being silently skipped.
    """
    if isinstance(raw, list) and all(isinstance(item, dict) and "text" in item for item in raw):
        return list(raw), []

    if not isinstance(raw, list):
        raise ValueError(f"scenario {name!r} must be a list")

    steps: list[dict] = []
    skipped: list[dict] = []
    for group in raw:
        if not isinstance(group, dict):
            raise ValueError(f"scenario {name!r} contains a non-object group")
        actor = group.get("actor", "QA")
        if actor != "QA":
            # Founder commands are useful as negative checks from QA, while
            # ordinary-user coverage requires a separate actor/session.
            if actor == "Founder":
                for target in group.get("targets", []):
                    for command in group.get("commands", []):
                        step = dict(command)
                        step["target"] = target
                        step["absent"] = list(group.get("absent_for_qa", []))
                        step["expect"] = list(step.get("expect", []))
                        # QA must never receive the Founder-only payload.
                        step["qa_negative_actor"] = "Founder"
                        steps.append(step)
                continue
            skipped.append({
                "group": group.get("name", actor),
                "reason": f"actor {actor!r} is not available to the isolated QA session",
            })
            continue

        target = group.get("target")
        commands = group.get("commands")
        if commands is not None:
            for command in commands:
                step = dict(command)
                if target is not None:
                    step.setdefault("target", target)
                steps.append(step)
            continue

        nested = group.get("steps")
        if nested is not None:
            for nested_step in nested:
                step = dict(nested_step)
                if target is not None:
                    step.setdefault("target", target)
                steps.append(step)
            continue

        raise ValueError(f"scenario group {group.get('name', '<unnamed>')!r} has no commands/steps")

    return steps, skipped


def run_scenario(name: str) -> dict:
    all_scenarios = load_scenarios()
    if name not in all_scenarios and refresh_scenarios_from_github():
        all_scenarios = load_scenarios()
    if name not in all_scenarios:
        raise ValueError(f"unknown scenario: {name}")

    steps, skipped = _expand_scenario(name, all_scenarios[name])
    code = r'''
import asyncio, json, os
from telethon import TelegramClient

async def main():
    client = TelegramClient(
        os.path.expanduser(os.environ["QA_SESSION"]),
        int(os.environ["QA_API_ID"]),
        os.environ["QA_API_HASH"],
    )
    await client.start()
    out = []
    last_replies = {}
    me = await client.get_me()
        target_entity = await client.get_entity(os.environ["QA_TARGET"])
        target_bot_id = getattr(target_entity, "id", None)
        if not target_bot_id or not getattr(target_entity, "bot", False):
            raise RuntimeError("QA_TARGET must resolve to the target Telegram bot")
    try:
        for step in json.loads(os.environ["QA_STEPS"]):
            if step.get("action") == "replay_same_callback_after_state_change":
                previous = last_replies.get(str(step.get("target") or os.environ["QA_TARGET"]))
                if not previous:
                    out.append({
                        "action": step["action"],
                        "ok": False,
                        "error": "no previous confirmation message available",
                    })
                    continue
                buttons = previous.buttons or []
                flat = [button for row in buttons for button in row]
                if not flat:
                    out.append({
                        "action": step["action"],
                        "ok": False,
                        "error": "previous confirmation message has no inline callback buttons",
                    })
                    continue
                button = flat[0]
                try:
                    await previous.click(button)
                    await asyncio.sleep(1)
                    await previous.click(button)
                except Exception as exc:
                    text = str(exc).casefold()
                    stale_markers = [str(x).casefold() for x in step.get("expect", [])]
                    matched = any(marker in text for marker in stale_markers)
                    out.append({
                        "action": step["action"],
                        "ok": matched,
                        "error": f"{type(exc).__name__}: {exc}",
                        "expected": step.get("expect", []),
                    })
                    continue
                out.append({
                    "action": step["action"],
                    "ok": False,
                    "error": "callback replay did not raise an observable stale-confirmation error",
                    "expected": step.get("expect", []),
                })
                continue

            entity = await client.get_entity(step.get("target") or os.environ["QA_TARGET"])
            reply_to = None
            if step.get("reply_target") == "ordinary_user":
                async for candidate in client.iter_messages(entity, limit=50):
                    if (
                        candidate.message
                        and candidate.sender_id
                        and candidate.sender_id != me.id
                        and not candidate.out
                    ):
                        reply_to = candidate.id
                        break
                if reply_to is None:
                    out.append({
                        "sent": step["text"],
                        "ok": False,
                        "error": "reply_target=ordinary_user but no recent ordinary-user message was found",
                    })
                    continue

            sent = await client.send_message(entity, step["text"], reply_to=reply_to)
            deadline = asyncio.get_running_loop().time() + int(step.get("wait", 10))
            replies = []
            seen = set()
            while asyncio.get_running_loop().time() < deadline:
                async for message in client.iter_messages(
                    entity,
                    min_id=sent.id,
                    limit=30,
                    reverse=True,
                ):
                    if message.id in seen or message.out or not message.message:
                        continue
                    # Only the target bot's response can satisfy a command step.
                    # Other bots in the same chat must never become false positives.
                    try:
                        sender = await message.get_sender()
                    except Exception:
                        sender = None
                    if not getattr(sender, "bot", False) or sender.id != target_bot_id:
                        continue
                    seen.add(message.id)
                    replies.append({
                        "id": message.id,
                        "date": message.date.isoformat(),
                        "text": message.message,
                    })
                if replies:
                    break
                await asyncio.sleep(1)
            expected = step.get("expect", [])
            absent = step.get("absent", [])
            allow_no_reply = bool(step.get("allow_no_reply", False))
            haystack = "\n".join(x["text"] for x in replies).casefold()
            missing = [x for x in expected if str(x).casefold() not in haystack]
            unexpected = [x for x in absent if str(x).casefold() in haystack]
            error_markers = (
                "ошибка обработчика",
                "ошибка обработчика кнопки",
                "диагностика записана",
                "ai-модуль сейчас недоступен",
                "ai-модуль недоступен",
            )
            detected_errors = [
                marker for marker in error_markers if marker in haystack
            ]
            out.append({
                "sent": step["text"],
                "sent_id": sent.id,
                "target": str(entity),
                "replies": replies[:12],
                "expected": expected,
                "missing_expected": missing,
                "unexpected_present": unexpected,
                "detected_errors": detected_errors,
                "ok": (bool(replies) or allow_no_reply) and not missing and not unexpected and not detected_errors,
            })
            if replies:
                last_replies[str(step.get("target") or os.environ["QA_TARGET"])] = await client.get_messages(
                    entity, ids=replies[-1]["id"]
                )
    finally:
        await client.disconnect()
    return out

asyncio.run(main())
'''
    env = os.environ.copy()
    env.update(
        QA_API_ID=API_ID,
        QA_API_HASH=api_hash(),
        QA_SESSION=str(SESSION),
        QA_TARGET=DEFAULT_TARGET,
        QA_STEPS=json.dumps(steps, ensure_ascii=False),
    )
    if not env["QA_API_HASH"]:
        raise RuntimeError("QA API hash unavailable")
    process = subprocess.run(
        [str(QA_PYTHON), "-c", code],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        timeout=300,
    )
    if process.returncode:
        raise RuntimeError((process.stderr or process.stdout)[-3000:])
    results = json.loads(process.stdout)
    scenario_ok = all(item.get("ok", False) for item in results)
    report = {
        "scenario": name,
        "ok": scenario_ok,
        "coverage_complete": not skipped,
        "skipped": skipped,
        "steps": results,
    }
    if not scenario_ok or skipped:
        report["bot_log_tail"] = tail(BOT_LOG, 40)
        report["runtime_log_tail"] = tail(RUNTIME_LOG, 20)
    return report


def command(raw: str) -> str:
    parts = raw.split(maxsplit=1)
    op = parts[0].upper() if parts else ""
    if op == "STATUS":
        return (
            "QA_AGENT ONLINE; "
            f"python={QA_PYTHON}; "
            f"session={'present' if SESSION.exists() else 'missing'}; "
            f"api_hash={'present' if api_hash() else 'missing'}; "
            f"target={DEFAULT_TARGET}; root={ROOT}; scenarios={len(load_scenarios())}"
        )
    if op == "RUN":
        name = parts[1].strip().lower() if len(parts) > 1 else "smoke"
        if name == "all":
            refresh_scenarios_from_github()
        names = list(load_scenarios()) if name == "all" else [name]
        reports = []
        for scenario in names:
            try:
                reports.append(run_scenario(scenario))
            except Exception as exc:
                reports.append({
                    "scenario": scenario,
                    "ok": False,
                    "error": f"{type(exc).__name__}: {exc}",
                })
        return "QA REPORT\n" + json.dumps(reports, ensure_ascii=False, indent=2)
    if op == "DIALOGS":
        code = r'''
import asyncio, json, os
from telethon import TelegramClient
from telethon.tl.types import Channel, Chat
async def main():
    client = TelegramClient(os.path.expanduser(os.environ["QA_SESSION"]), int(os.environ["QA_API_ID"]), os.environ["QA_API_HASH"])
    await client.start()
    try:
        rows = []
        async for dialog in client.iter_dialogs(limit=100):
            entity = dialog.entity
            if isinstance(entity, (Channel, Chat)) and not getattr(entity, "broadcast", False):
                rows.append({"id": entity.id, "title": getattr(entity, "title", None), "username": getattr(entity, "username", None), "megagroup": getattr(entity, "megagroup", False)})
        print(json.dumps(rows, ensure_ascii=False))
    finally:
        await client.disconnect()
asyncio.run(main())
'''
        env = os.environ.copy()
        env.update(QA_API_ID=API_ID, QA_API_HASH=api_hash(), QA_SESSION=str(SESSION))
        process = subprocess.run([str(QA_PYTHON), "-c", code], cwd=ROOT, env=env, text=True, capture_output=True, timeout=120)
        if process.returncode:
            raise RuntimeError((process.stderr or process.stdout)[-3000:])
        return "QA DIALOGS\n" + process.stdout.strip()
    if op == "LOGS":
        return (
            "QA LOG SNAPSHOT\n"
            "=== bot.log ===\n" + tail(BOT_LOG) +
            "\n=== termux-autoupdate.log ===\n" + tail(RUNTIME_LOG, 60)
        )
    return "ignored command: " + raw


last = state()
while True:
    try:
        if Path(__file__).stat().st_mtime != SCRIPT_MTIME:
            os.execv(str(QA_PYTHON), [str(QA_PYTHON), str(Path(__file__))])
        for comment in comments():
            comment_id = int(comment["id"])
            body = comment.get("body", "")
            if (
                comment_id <= last
                or comment.get("user", {}).get("login") != USER
                or MARKER not in body
            ):
                continue
            last = comment_id
            save(last)
            try:
                publish(command(body.replace(MARKER, "").strip()))
            except Exception as exc:
                publish(f"QA ERROR: {type(exc).__name__}: {exc}")
    except Exception:
        pass
    time.sleep(8)
