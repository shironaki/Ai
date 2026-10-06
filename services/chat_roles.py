"""Per-chat human role assignments.

The global users.status field remains for legacy compatibility, while active
administrative authority in a chat is resolved from this table. The bot founder
is always globally privileged and is never downgraded by this layer.
"""
from database.connection import connect_db
from config.role_config import ROLE_ORDER


def _ensure():
    with connect_db("users.db") as db:
        db.execute(
            "CREATE TABLE IF NOT EXISTS chat_roles("
            "chat_id INTEGER NOT NULL,user_id INTEGER NOT NULL,role TEXT NOT NULL,"
            "granted_by INTEGER,updated_at TEXT NOT NULL,"
            "PRIMARY KEY(chat_id,user_id))"
        )
        db.commit()


def set_role(chat_id: int, user_id: int, role: str, granted_by: int):
    """Assign a chat-local human role after re-checking the actor boundary."""
    if role not in ROLE_ORDER or role in {"Создатель бота", "Система", "Основатель"}:
        return False
    if user_id == granted_by:
        return False
    from core.identity import is_owner
    from core.permissions import get_display_role
    from core.role_transitions import can_assign
    if user_id == __import__("base").config.owner:
        return False
    if __import__("core.identity", fromlist=["resolve_role"]).resolve_role(user_id) == "Хелпер":
        return False
    actor_role = get_display_role(granted_by, chat_id)
    if not can_assign(actor_role, role, actor_is_owner=is_owner(granted_by)):
        return False
    from datetime import datetime, timezone
    _ensure()
    with connect_db("users.db") as db:
        db.execute(
            "INSERT INTO chat_roles(chat_id,user_id,role,granted_by,updated_at) VALUES(?,?,?,?,?) "
            "ON CONFLICT(chat_id,user_id) DO UPDATE SET role=excluded.role,granted_by=excluded.granted_by,updated_at=excluded.updated_at",
            (chat_id, user_id, role, granted_by, datetime.now(timezone.utc).isoformat()),
        )
        db.commit()
    return True


def get_role(chat_id: int, user_id: int):
    _ensure()
    with connect_db("users.db") as db:
        row=db.execute("SELECT role FROM chat_roles WHERE chat_id=? AND user_id=?", (chat_id,user_id)).fetchone()
        return row[0] if row else None


def list_roles(chat_id: int):
    """Return all bot-assigned human roles for one chat."""
    _ensure()
    with connect_db("users.db") as db:
        return db.execute(
            "SELECT chat_id,user_id,role,granted_by,updated_at "
            "FROM chat_roles WHERE chat_id=? ORDER BY role DESC,user_id",
            (chat_id,),
        ).fetchall()
