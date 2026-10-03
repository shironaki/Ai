"""Persistent runtime diagnostic journal for TEST QA."""

from __future__ import annotations

import json
import traceback
from datetime import datetime, timezone

from database.connection import connect_db
from services.security import redact


def _ensure_table() -> None:
    with connect_db("users.db") as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS diagnostic_events(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                update_id INTEGER,
                chat_id INTEGER,
                user_id INTEGER,
                handler TEXT,
                stage TEXT NOT NULL,
                result TEXT,
                exception_type TEXT,
                exception_text TEXT,
                traceback TEXT,
                context_json TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        db.commit()


def record(
    *,
    update_id: int | None = None,
    chat_id: int | None = None,
    user_id: int | None = None,
    handler: str | None = None,
    stage: str,
    result: str | None = None,
    exception: BaseException | None = None,
    context: dict | None = None,
) -> int:
    _ensure_table()
    now = datetime.now(timezone.utc).isoformat()
    exception_type = type(exception).__name__ if exception else None
    exception_text = redact(exception, 4000) if exception else None
    tb = redact("".join(traceback.format_exception(type(exception), exception, exception.__traceback__)), 12000) if exception else None
    context_json = redact(json.dumps(context or {}, ensure_ascii=False, default=str), 4000)
    with connect_db("users.db") as db:
        cur = db.execute(
            """
            INSERT INTO diagnostic_events(
                update_id,chat_id,user_id,handler,stage,result,
                exception_type,exception_text,traceback,context_json,created_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                update_id, chat_id, user_id, handler, stage, result,
                exception_type, exception_text, tb, context_json, now,
            ),
        )
        return int(cur.lastrowid)


def latest(update_id: int | None = None):
    _ensure_table()
    with connect_db("users.db") as db:
        if update_id is None:
            return db.execute(
                "SELECT * FROM diagnostic_events ORDER BY id DESC LIMIT 1"
            ).fetchone()
        return db.execute(
            "SELECT * FROM diagnostic_events WHERE update_id=? ORDER BY id DESC LIMIT 1",
            (update_id,),
        ).fetchone()


def render(event) -> str:
    if not event:
        return "диагностика не найдена"
    keys = [
        "id", "update_id", "chat_id", "user_id", "handler", "stage",
        "result", "exception_type", "exception_text", "traceback",
        "context_json", "created_at",
    ]
    data = dict(zip(keys, event))
    lines = [
        f"diagnostic #{data['id']}",
        f"update_id: {data['update_id']}",
        f"chat_id: {data['chat_id']}",
        f"user_id: {data['user_id']}",
        f"handler: {data['handler'] or '-'}",
        f"stage: {data['stage']}",
        f"result: {data['result'] or '-'}",
    ]
    if data["exception_type"]:
        lines.append(f"exception: {data['exception_type']}: {data['exception_text']}")
    if data["traceback"]:
        lines.append(f"traceback:\n{data['traceback']}")
    return "\n".join(lines)
