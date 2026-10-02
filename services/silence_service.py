"""Chat-wide silence gateway.

Telegram default permissions are used so administrators remain able to operate
the chat while ordinary members cannot send messages during silence.
"""
from database.connection import connect_db


def _ensure_table() -> None:
    with connect_db("users.db") as db:
        db.execute(
            "CREATE TABLE IF NOT EXISTS chat_silence(chat_id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0)"
        )
        db.commit()


def is_silent(chat_id: int) -> bool:
    _ensure_table()
    with connect_db("users.db") as db:
        row = db.execute("SELECT enabled FROM chat_silence WHERE chat_id=?", (chat_id,)).fetchone()
        return bool(row and row[0])


def set_silent(chat_id: int, enabled: bool) -> None:
    _ensure_table()
    with connect_db("users.db") as db:
        db.execute(
            "INSERT INTO chat_silence(chat_id,enabled) VALUES(?,?) "
            "ON CONFLICT(chat_id) DO UPDATE SET enabled=excluded.enabled",
            (chat_id, int(enabled)),
        )
        db.commit()
