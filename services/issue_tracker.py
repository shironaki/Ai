"""Persistent QA issue markers for the bot's TEST workflow."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from database.connection import connect_db

_MARK_RE = re.compile(r"^(?:отметь|исправить)\b\s*(?:код\s*(\d+)\b)?\s*(.*)$", re.I)
_FIXED_RE = re.compile(r"^(?:исправлено|исправить)\s+#?(\d+)\s*$", re.I)


def _ensure_table() -> None:
    with connect_db("users.db") as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS issue_markers(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                message_id INTEGER NOT NULL,
                reporter_id INTEGER NOT NULL,
                reason TEXT NOT NULL,
                code INTEGER,
                status TEXT NOT NULL DEFAULT 'open',
                fixed_by INTEGER,
                created_at TEXT NOT NULL,
                fixed_at TEXT
            )
            """
        )


def parse_marker(text: str):
    match = _MARK_RE.match((text or "").strip())
    if not match:
        return None
    code = int(match.group(1)) if match.group(1) else None
    reason = (match.group(2) or "").strip(" :-")
    return {"code": code, "reason": reason or "Причина не указана"}


def parse_fixed(text: str):
    match = _FIXED_RE.match((text or "").strip())
    return int(match.group(1)) if match else None


def create_marker(*, chat_id: int, message_id: int, reporter_id: int, reason: str, code: int | None = None) -> int:
    _ensure_table()
    now = datetime.now(timezone.utc).isoformat()
    with connect_db("users.db") as db:
        cur = db.execute(
            """
            INSERT INTO issue_markers(chat_id,message_id,reporter_id,reason,code,status,created_at)
            VALUES(?,?,?,?,?,'open',?)
            """,
            (chat_id, message_id, reporter_id, reason[:1000], code, now),
        )
        return int(cur.lastrowid)


def list_markers(limit: int = 30):
    _ensure_table()
    with connect_db("users.db") as db:
        return db.execute(
            """
            SELECT id,chat_id,message_id,reporter_id,reason,code,status,created_at,fixed_by,fixed_at
            FROM issue_markers ORDER BY id DESC LIMIT ?
            """,
            (max(1, min(limit, 100)),),
        ).fetchall()


def mark_fixed(marker_id: int, fixed_by: int) -> bool:
    _ensure_table()
    now = datetime.now(timezone.utc).isoformat()
    with connect_db("users.db") as db:
        cur = db.execute(
            "UPDATE issue_markers SET status='fixed', fixed_by=?, fixed_at=? WHERE id=? AND status='open'",
            (fixed_by, now, marker_id),
        )
        return cur.rowcount > 0


def render_marker(marker) -> str:
    marker_id, chat_id, message_id, reporter_id, reason, code, status, created_at, fixed_by, fixed_at = marker
    state = "исправлено" if status == "fixed" else "открыто"
    code_text = f" · код {code}" if code is not None else ""
    return f"#{marker_id} · {state}{code_text}\\nчат {chat_id} · сообщение {message_id}\\nпричина: {reason}"
