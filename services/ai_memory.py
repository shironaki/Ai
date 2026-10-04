"""Persistent, privacy-bounded conversation memory for the AI assistant.

Only messages from an explicit AI conversation are stored. Memory is keyed by
(user_id, chat_id), so one user's context can never become another user's
context. This is not a chat-wide message archive.
"""

from datetime import datetime, timedelta, timezone

from services.security import redact
from database.connection import connect_db

MEMORY_RETENTION_DAYS = 30
MEMORY_MAX_MESSAGES = 40
MEMORY_MAX_CONTENT = 4000


def _ensure_table(connection):
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            chat_id INTEGER NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
            content TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_ai_memory_scope_created
        ON ai_memory(user_id, chat_id, created_at, id)
        """
    )


def _purge(connection, user_id=None, chat_id=None):
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=MEMORY_RETENTION_DAYS)
    ).isoformat()
    if user_id is None or chat_id is None:
        connection.execute(
            "DELETE FROM ai_memory WHERE created_at < ?",
            (cutoff,),
        )
        return
    connection.execute(
        """
        DELETE FROM ai_memory
        WHERE user_id = ? AND chat_id = ? AND created_at < ?
        """,
        (int(user_id), int(chat_id), cutoff),
    )
    connection.execute(
        """
        DELETE FROM ai_memory
        WHERE user_id = ? AND chat_id = ? AND id NOT IN (
            SELECT id FROM ai_memory
            WHERE user_id = ? AND chat_id = ?
            ORDER BY id DESC LIMIT ?
        )
        """,
        (
            int(user_id),
            int(chat_id),
            int(user_id),
            int(chat_id),
            MEMORY_MAX_MESSAGES,
        ),
    )


def load_history(user_id: int, chat_id: int) -> list[dict]:
    """Load only the caller's own AI conversation for this exact chat."""
    with connect_db("ai_memory.db") as connection:
        _ensure_table(connection)
        _purge(connection, user_id, chat_id)
        rows = connection.execute(
            """
            SELECT role, content FROM ai_memory
            WHERE user_id = ? AND chat_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (int(user_id), int(chat_id), MEMORY_MAX_MESSAGES),
        ).fetchall()
        return [
            {"role": row["role"], "content": redact(row["content"], MEMORY_MAX_CONTENT)}
            for row in reversed(rows)
        ]


def append_history(user_id: int, chat_id: int, messages: list[dict]) -> None:
    """Persist a bounded, credential-redacted AI conversation."""
    now = datetime.now(timezone.utc).isoformat()
    with connect_db("ai_memory.db") as connection:
        _ensure_table(connection)
        for item in messages:
            role = item.get("role")
            if role not in {"user", "assistant"}:
                continue
            content = redact(str(item.get("content", "")), MEMORY_MAX_CONTENT).strip()
            if not content:
                continue
            connection.execute(
                """
                INSERT INTO ai_memory(user_id, chat_id, role, content, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (int(user_id), int(chat_id), role, content, now),
            )
        _purge(connection, user_id, chat_id)


def clear_history(user_id: int, chat_id: int) -> int:
    """Erase only the caller's AI memory in the exact current chat."""
    with connect_db("ai_memory.db") as connection:
        _ensure_table(connection)
        cursor = connection.execute(
            "DELETE FROM ai_memory WHERE user_id = ? AND chat_id = ?",
            (int(user_id), int(chat_id)),
        )
        return int(cursor.rowcount)


def clear_all_user_history(user_id: int) -> int:
    """Erase all AI memory belonging to one user across chats."""
    with connect_db("ai_memory.db") as connection:
        _ensure_table(connection)
        cursor = connection.execute(
            "DELETE FROM ai_memory WHERE user_id = ?",
            (int(user_id),),
        )
        return int(cursor.rowcount)
