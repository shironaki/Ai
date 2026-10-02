"""Audit trail for human role assignments."""
from datetime import datetime, timezone
from database.connection import connect_db


def record_role_grant(*, chat_id: int, actor_id: int, target_id: int, role: str) -> None:
    with connect_db("users.db") as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS role_grants(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                actor_id INTEGER NOT NULL,
                target_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        db.execute(
            "INSERT INTO role_grants(chat_id,actor_id,target_id,role,created_at) VALUES(?,?,?,?,?)",
            (chat_id, actor_id, target_id, role, datetime.now(timezone.utc).isoformat()),
        )
        db.commit()


def latest_grant(chat_id: int, target_id: int):
    with connect_db("users.db") as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS role_grants(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                actor_id INTEGER NOT NULL,
                target_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        return db.execute(
            "SELECT actor_id,role,created_at FROM role_grants "
            "WHERE chat_id=? AND target_id=? ORDER BY id DESC LIMIT 1",
            (chat_id, target_id),
        ).fetchone()
