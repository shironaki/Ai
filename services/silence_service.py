"""Chat-wide silence state and preservation of Telegram default permissions."""
import json

from database.connection import connect_db
from core.permissions import has_moderator_role


_FIELDS = (
    "can_send_messages",
    "can_send_media_messages",
    "can_send_polls",
    "can_send_other_messages",
    "can_add_web_page_previews",
    "can_change_info",
    "can_invite_users",
    "can_pin_messages",
)


def _ensure_table() -> None:
    with connect_db("users.db") as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_silence(
                chat_id INTEGER PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 0,
                previous_permissions TEXT
            )
            """
        )
        # Safe migration for databases created by the earlier two-column version.
        columns = {row[1] for row in db.execute("PRAGMA table_info(chat_silence)").fetchall()}
        if "previous_permissions" not in columns:
            db.execute("ALTER TABLE chat_silence ADD COLUMN previous_permissions TEXT")
        db.commit()


def is_silent(chat_id: int) -> bool:
    _ensure_table()
    with connect_db("users.db") as db:
        row = db.execute("SELECT enabled FROM chat_silence WHERE chat_id=?", (chat_id,)).fetchone()
        return bool(row and row[0])


def get_previous_permissions(chat_id: int) -> dict | None:
    _ensure_table()
    with connect_db("users.db") as db:
        row = db.execute(
            "SELECT previous_permissions FROM chat_silence WHERE chat_id=?", (chat_id,)
        ).fetchone()
    if not row or not row[0]:
        return None
    try:
        value = json.loads(row[0])
    except (TypeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def set_silent(
    chat_id: int,
    enabled: bool,
    previous_permissions: dict | None = None,
    *,
    actor_id: int,
) -> None:
    if not has_moderator_role(actor_id, chat_id):
        raise PermissionError("Chat silence changes require moderator actor context")
    _ensure_table()
    payload = json.dumps(previous_permissions, ensure_ascii=False, sort_keys=True) if previous_permissions else None
    with connect_db("users.db") as db:
        db.execute(
            "INSERT INTO chat_silence(chat_id,enabled,previous_permissions) VALUES(?,?,?) "
            "ON CONFLICT(chat_id) DO UPDATE SET enabled=excluded.enabled, "
            "previous_permissions=excluded.previous_permissions",
            (chat_id, int(enabled), payload if enabled else None),
        )
        db.commit()


def permissions_dict(permissions) -> dict:
    """Serialize Telegram ChatPermissions without exposing unrelated fields."""
    return {name: bool(getattr(permissions, name, False)) for name in _FIELDS}
