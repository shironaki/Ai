"""Persistent global bot-role assignments.

Only the founder can mutate this table. Chat-local roles live in
services.chat_roles and never leak into another chat.
"""
from datetime import datetime, timezone

from base import config
from database.connection import connect_db
from config.role_config import OWNER_ROLE, is_global_assignable_role


def _ensure() -> None:
    with connect_db("users.db") as db:
        db.execute(
            """CREATE TABLE IF NOT EXISTS global_roles(
                user_id INTEGER PRIMARY KEY,
                role TEXT NOT NULL,
                granted_by INTEGER NOT NULL,
                updated_at TEXT NOT NULL
            )"""
        )
        db.commit()


def set_global_role(target_user_id: int, role: str, actor_id: int) -> bool:
    if actor_id != config.owner or not is_global_assignable_role(role):
        return False
    if target_user_id == config.owner:
        return False
    _ensure()
    with connect_db("users.db") as db:
        db.execute(
            """INSERT INTO global_roles(user_id,role,granted_by,updated_at)
               VALUES(?,?,?,?)
               ON CONFLICT(user_id) DO UPDATE SET
                 role=excluded.role,granted_by=excluded.granted_by,
                 updated_at=excluded.updated_at""",
            (target_user_id, role, actor_id, datetime.now(timezone.utc).isoformat()),
        )
        db.commit()
    return True


def get_global_role(user_id: int) -> str | None:
    if user_id == config.owner:
        return OWNER_ROLE
    _ensure()
    with connect_db("users.db") as db:
        row = db.execute("SELECT role FROM global_roles WHERE user_id=?", (user_id,)).fetchone()
    return row["role"] if row else None


def list_global_users_by_role(role: str):
    _ensure()
    with connect_db("users.db") as db:
        return [row[0] for row in db.execute("SELECT user_id FROM global_roles WHERE role=?", (role,)).fetchall()]


def revoke_global_role(target_user_id: int, actor_id: int) -> bool:
    if actor_id != config.owner:
        return False
    _ensure()
    with connect_db("users.db") as db:
        cur = db.execute("DELETE FROM global_roles WHERE user_id=?", (target_user_id,))
        db.commit()
        return cur.rowcount > 0
