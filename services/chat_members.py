"""Local chat membership directory.

This is an event-fed cache of Telegram membership information, separate from
the global users table. It records joins/leaves/admin observations and is used
only by the administration layer.
"""

from __future__ import annotations

from datetime import datetime, timezone

from database.connection import connect_db


def _ensure_table() -> None:
    with connect_db("users.db") as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_members(
                chat_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                name TEXT,
                username TEXT,
                telegram_status TEXT,
                bot_role TEXT,
                is_chat_owner INTEGER NOT NULL DEFAULT 0,
                is_chat_admin INTEGER NOT NULL DEFAULT 0,
                joined_at TEXT,
                left_at TEXT,
                last_seen_at TEXT NOT NULL,
                PRIMARY KEY(chat_id,user_id)
            )
            """
        )
        db.commit()


def observe(
    *,
    chat_id: int,
    user_id: int,
    name: str,
    username: str | None = None,
    telegram_status: str | None = None,
    bot_role: str | None = None,
    is_chat_owner: bool = False,
    is_chat_admin: bool = False,
    joined: bool = False,
    left: bool = False,
) -> None:
    _ensure_table()
    now = datetime.now(timezone.utc).isoformat()
    with connect_db("users.db") as db:
        row = db.execute(
            "SELECT joined_at FROM chat_members WHERE chat_id=? AND user_id=?",
            (chat_id, user_id),
        ).fetchone()
        joined_at = now if joined and row is None else (row["joined_at"] if row else None)
        left_at = now if left else None
        db.execute(
            """
            INSERT INTO chat_members(
                chat_id,user_id,name,username,telegram_status,bot_role,
                is_chat_owner,is_chat_admin,joined_at,left_at,last_seen_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(chat_id,user_id) DO UPDATE SET
                name=excluded.name,
                username=excluded.username,
                telegram_status=excluded.telegram_status,
                bot_role=excluded.bot_role,
                is_chat_owner=excluded.is_chat_owner,
                is_chat_admin=excluded.is_chat_admin,
                joined_at=COALESCE(chat_members.joined_at, excluded.joined_at),
                left_at=excluded.left_at,
                last_seen_at=excluded.last_seen_at
            """,
            (
                chat_id,
                user_id,
                name[:255],
                username[:255] if username else None,
                telegram_status,
                bot_role,
                int(is_chat_owner),
                int(is_chat_admin),
                joined_at,
                left_at,
                now,
            ),
        )
        db.commit()


def list_chat_members(chat_id: int, limit: int = 100):
    _ensure_table()
    with connect_db("users.db") as db:
        return db.execute(
            """
            SELECT chat_id,user_id,name,username,telegram_status,bot_role,
                   is_chat_owner,is_chat_admin,joined_at,left_at,last_seen_at
            FROM chat_members WHERE chat_id=?
            ORDER BY is_chat_owner DESC,is_chat_admin DESC,name COLLATE NOCASE
            LIMIT ?
            """,
            (chat_id, max(1, min(limit, 500))),
        ).fetchall()


def list_chat_admins(chat_id: int):
    _ensure_table()
    with connect_db("users.db") as db:
        return db.execute(
            """
            SELECT user_id,name,username,telegram_status,is_chat_owner,is_chat_admin
            FROM chat_members
            WHERE chat_id=? AND is_chat_admin=1
            ORDER BY is_chat_owner DESC,name COLLATE NOCASE
            """,
            (chat_id,),
        ).fetchall()
