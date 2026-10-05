"""Persistent QA issue markers for the bot's TEST workflow."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

ISSUE_RETENTION_DAYS = 30
ISSUE_MAX_ROWS = 3000

from database.connection import connect_db
from services.security import redact

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
                reporter_name TEXT,
                message_text TEXT,
                message_sender_name TEXT,
                reason TEXT NOT NULL,
                code INTEGER,
                status TEXT NOT NULL DEFAULT 'open',
                fixed_by INTEGER,
                created_at TEXT NOT NULL,
                fixed_at TEXT,
                diagnostic_id INTEGER,
                resolution TEXT
            )
            """
        )
        columns = {row[1] for row in db.execute("PRAGMA table_info(issue_markers)").fetchall()}
        for name, ddl in (
            ("reporter_name", "TEXT"),
            ("message_text", "TEXT"),
            ("message_sender_name", "TEXT"),
            ("diagnostic_id", "INTEGER"),
            ("resolution", "TEXT"),
        ):
            if name not in columns:
                db.execute(f"ALTER TABLE issue_markers ADD COLUMN {name} {ddl}")
        db.execute("CREATE INDEX IF NOT EXISTS idx_issue_markers_created_at ON issue_markers(created_at)")
        db.commit()


def _purge_old() -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=ISSUE_RETENTION_DAYS)).isoformat()
    with connect_db("users.db") as db:
        db.execute("DELETE FROM issue_markers WHERE status IN ('fixed', 'broken') AND created_at < ?", (cutoff,))
        db.execute("DELETE FROM issue_markers WHERE id NOT IN (SELECT id FROM issue_markers ORDER BY id DESC LIMIT ?)", (ISSUE_MAX_ROWS,))
        db.commit()


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


def create_marker(
    *,
    chat_id: int,
    message_id: int,
    reporter_id: int,
    reason: str,
    code: int | None = None,
    message_text: str | None = None,
    message_sender_name: str | None = None,
    reporter_name: str | None = None,
    diagnostic_id: int | None = None,
) -> int:
    _ensure_table()
    _purge_old()
    now = datetime.now(timezone.utc).isoformat()
    with connect_db("users.db") as db:
        cur = db.execute(
            """
            INSERT INTO issue_markers(
                chat_id,message_id,reporter_id,reporter_name,message_text,
                message_sender_name,reason,code,status,created_at,diagnostic_id
            ) VALUES(?,?,?,?,?,?,?,?, 'open',?,?)
            """,
            (
                chat_id,
                message_id,
                reporter_id,
                reporter_name,
                redact(message_text, 4000) if message_text else None,
                message_sender_name,
                redact(reason, 1000),
                code,
                now,
                diagnostic_id,
            ),
        )
        return int(cur.lastrowid)


def create_runtime_error_marker(
    *,
    chat_id: int,
    message_id: int,
    reporter_id: int,
    message_text: str,
    diagnostic_id: int,
    exception_type: str,
    exception_text: str,
) -> int:
    return create_marker(
        chat_id=chat_id,
        message_id=message_id,
        reporter_id=reporter_id,
        reason=redact(f"Автоматическая диагностика: {exception_type}: {exception_text}", 1000),
        message_text=message_text,
        message_sender_name="runtime",
        reporter_name="SYSTEM QA",
        diagnostic_id=diagnostic_id,
    )


def list_markers(limit: int = 30):
    _ensure_table()
    with connect_db("users.db") as db:
        return db.execute(
            """
            SELECT id,chat_id,message_id,reporter_id,reporter_name,message_text,
                   message_sender_name,reason,code,status,created_at,fixed_by,
                   fixed_at,diagnostic_id
            FROM issue_markers ORDER BY id DESC LIMIT ?
            """,
            (max(1, min(limit, 100)),),
        ).fetchall()


def update_marker(marker_id: int, *, status: str, updated_by: int, resolution: str | None = None) -> bool:
    if status not in {"open", "in_progress", "fixed", "broken"}:
        return False
    _ensure_table()
    now = datetime.now(timezone.utc).isoformat()
    with connect_db("users.db") as db:
        cur = db.execute(
            "UPDATE issue_markers SET status=?, fixed_by=?, fixed_at=?, resolution=? WHERE id=?",
            (status, updated_by, now if status == "fixed" else None, (resolution or "")[:2000], marker_id),
        )
        db.commit()
        return cur.rowcount > 0


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
    values = list(marker)
    while len(values) < 15:
        values.append(None)
    (
        marker_id, chat_id, message_id, reporter_id, reporter_name,
        message_text, message_sender_name, reason, code, status,
        created_at, fixed_by, fixed_at, diagnostic_id, resolution
    ) = values[:15]
    state = {
        "open": "открыто",
        "in_progress": "в работе",
        "fixed": "исправлено",
        "broken": "сломано",
    }.get(status, status or "неизвестно")
    code_text = f" · код {code}" if code is not None else ""
    diagnostic_text = f" · диагностика #{diagnostic_id}" if diagnostic_id else ""
    diagnostic_details = ""
    if diagnostic_id:
        row = connect_db("users.db")
        try:
            event = row.execute(
                "SELECT stage,handler,exception_type,exception_text FROM diagnostic_events WHERE id=?",
                (diagnostic_id,),
            ).fetchone()
            if event:
                diagnostic_details = (
                    f"\nэтап: {event['stage']}"
                    f"\nобработчик: {event['handler'] or '-'}"
                    f"\nисключение: {event['exception_type'] or '-'}"
                    f"{': ' + event['exception_text'] if event['exception_text'] else ''}"
                )
        finally:
            row.close()
    original = (message_text or "[текст сообщения не сохранён]").strip()
    sender = message_sender_name or "неизвестен"
    reporter = reporter_name or str(reporter_id)
    resolution_text = resolution or "—"
    return (
        f"#{marker_id} · {state}{code_text}{diagnostic_text}\n"
        f"чат {chat_id} · сообщение {message_id}\n"
        f"автор сообщения: {sender}\n"
        f"отметил: {reporter}\n"
        f"сообщение:\n«{original}»\n"
        f"причина: {reason}"
        f"\nрешение: {resolution_text}"
        f"{diagnostic_details}"
    )
