"""Unified user report service.

Reports are for complaints, requests and appeals to administration.
They are not QA markers: technical defects belong to the separate issue tracker.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from database.connection import connect_db
from base import config
from services.security import redact


REMINDER_HOURS = 2
REPORT_RETENTION_DAYS = 90
REPORT_MAX_ROWS = 5000


def _ensure_table() -> None:
    with connect_db("users.db") as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS user_reports(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reporter_id INTEGER NOT NULL,
                reporter_name TEXT,
                source_chat_id INTEGER NOT NULL,
                source_message_id INTEGER,
                target_user_id INTEGER,
                reason TEXT NOT NULL,
                payload TEXT,
                status TEXT NOT NULL DEFAULT 'open',
                created_at TEXT NOT NULL,
                answered_at TEXT,
                answered_by INTEGER,
                answer_text TEXT,
                last_reminded_at TEXT
            )
            """
        )
        columns = {row[1] for row in db.execute("PRAGMA table_info(user_reports)").fetchall()}
        if "answer_text" not in columns:
            db.execute("ALTER TABLE user_reports ADD COLUMN answer_text TEXT")
        db.execute("CREATE INDEX IF NOT EXISTS idx_user_reports_created_at ON user_reports(created_at)")
        db.commit()


def _purge_old() -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=REPORT_RETENTION_DAYS)).isoformat()
    with connect_db("users.db") as db:
        db.execute("DELETE FROM user_reports WHERE status='answered' AND created_at < ?", (cutoff,))
        # Never evict open/pending reports merely because the table is large.
        # The cap applies to answered rows only.
        excess = db.execute(
            "SELECT id FROM user_reports WHERE status='answered' ORDER BY id DESC LIMIT -1 OFFSET ?",
            (REPORT_MAX_ROWS,),
        ).fetchall()
        if excess:
            db.executemany("DELETE FROM user_reports WHERE id=? AND status='answered'", [(row['id'],) for row in excess])
        db.commit()


def create_report(
    *,
    reporter_id: int,
    reporter_name: str,
    source_chat_id: int,
    source_message_id: int | None,
    reason: str,
    payload: str | None = None,
    target_user_id: int | None = None,
) -> int:
    _ensure_table()
    _purge_old()
    now = datetime.now(timezone.utc).isoformat()
    with connect_db("users.db") as db:
        cur = db.execute(
            """
            INSERT INTO user_reports(
                reporter_id,reporter_name,source_chat_id,source_message_id,
                target_user_id,reason,payload,status,created_at
            ) VALUES(?,?,?,?,?,?,?,'open',?)
            """,
            (
                reporter_id,
                reporter_name[:255],
                source_chat_id,
                source_message_id,
                target_user_id,
                redact(reason, 2000),
                redact(payload, 6000) if payload else None,
                now,
            ),
        )
        return int(cur.lastrowid)


def get_report(report_id: int, source_chat_id: int | None = None):
    _ensure_table()
    with connect_db("users.db") as db:
        if source_chat_id is None:
            return db.execute(
                "SELECT * FROM user_reports WHERE id = ?", (report_id,)
            ).fetchone()
        return db.execute(
            "SELECT * FROM user_reports WHERE id = ? AND source_chat_id = ?",
            (report_id, source_chat_id),
        ).fetchone()


def list_open(limit: int = 30, source_chat_id: int | None = None):
    _ensure_table()
    with connect_db("users.db") as db:
        if source_chat_id is None:
            return db.execute(
                """
                SELECT id,reporter_id,reporter_name,source_chat_id,source_message_id,
                       reason,status,created_at,answered_at
                FROM user_reports
                WHERE status = 'open'
                ORDER BY id ASC LIMIT ?
                """,
                (max(1, min(limit, 100)),),
            ).fetchall()
        return db.execute(
            """
            SELECT id,reporter_id,reporter_name,source_chat_id,source_message_id,
                   reason,status,created_at,answered_at
            FROM user_reports
            WHERE status = 'open' AND source_chat_id = ?
            ORDER BY id ASC LIMIT ?
            """,
            (source_chat_id, max(1, min(limit, 100))),
        ).fetchall()


def answer_report(
    report_id: int,
    answered_by: int,
    answer_text: str,
    source_chat_id: int | None = None,
) -> bool:
    if answered_by != config.owner:
        from services.global_roles import get_global_role
        if get_global_role(answered_by) != "Хелпер":
            if source_chat_id is None:
                raise PermissionError("Report replies require operator actor context")
            from core.permissions import has_moderator_role
            if not has_moderator_role(answered_by, source_chat_id):
                raise PermissionError("Report replies require moderator authority in the report chat")
    _ensure_table()
    now = datetime.now(timezone.utc).isoformat()
    with connect_db("users.db") as db:
        if source_chat_id is None:
            row = db.execute(
                "SELECT reporter_id,status FROM user_reports WHERE id = ?",
                (report_id,),
            ).fetchone()
        else:
            row = db.execute(
                "SELECT reporter_id,status FROM user_reports WHERE id = ? AND source_chat_id = ?",
                (report_id, source_chat_id),
            ).fetchone()
        if row is None or row["status"] != "open":
            return False
        db.execute(
            """
            UPDATE user_reports
            SET status='answered', answered_at=?, answered_by=?, answer_text=?
            WHERE id=? AND status='open' AND (? IS NULL OR source_chat_id=?)
            """,
            (now, answered_by, answer_text[:6000], report_id, source_chat_id, source_chat_id),
        )
        db.commit()
        return True


def due_reminders(limit: int = 50):
    _ensure_table()
    threshold = datetime.now(timezone.utc) - timedelta(hours=REMINDER_HOURS)
    threshold_iso = threshold.isoformat()
    with connect_db("users.db") as db:
        return db.execute(
            """
            SELECT id,reporter_name,reason,created_at
            FROM user_reports
            WHERE status='open'
              AND created_at <= ?
              AND (last_reminded_at IS NULL OR last_reminded_at <= ?)
            ORDER BY created_at ASC LIMIT ?
            """,
            (threshold_iso, threshold_iso, max(1, min(limit, 100))),
        ).fetchall()


def mark_reminded(report_ids: list[int]) -> None:
    if not report_ids:
        return
    _ensure_table()
    now = datetime.now(timezone.utc).isoformat()
    with connect_db("users.db") as db:
        db.executemany(
            "UPDATE user_reports SET last_reminded_at=? WHERE id=? AND status='open'",
            [(now, report_id) for report_id in report_ids],
        )
        db.commit()


async def reminder_loop(bot, owner_id: int, recipient_ids: tuple[int, ...] = ()) -> None:
    """Remind founder and configured technical recipients every two hours."""
    while True:
        try:
            rows = due_reminders()
            if rows:
                ids = [int(row["id"]) for row in rows]
                lines = [
                    "⏰ <b>Незакрытые обращения</b>",
                    f"Есть {len(ids)} репорт(ов), ожидающих ответа более {REMINDER_HOURS} ч.",
                    "",
                ]
                for row in rows[:10]:
                    lines.append(
                        f"#{row['id']} · {row['reporter_name'] or row['reporter_id']} · "
                        f"{str(row['reason'])[:180]}"
                    )
                recipients = tuple(dict.fromkeys((owner_id, *recipient_ids)))
                for recipient_id in recipients:
                    try:
                        await bot.send_message(recipient_id, "\n".join(lines))
                    except Exception:
                        continue
                mark_reminded(ids)
        except Exception:
            # Reminder failure must never stop the bot's main loop.
            pass
        await asyncio.sleep(300)
