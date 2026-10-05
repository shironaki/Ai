"""Local chat membership directory.

This is an event-fed cache of Telegram membership information, separate from
the global users table. It records joins/leaves/admin observations and is used
only by the administration layer.
"""

from __future__ import annotations

from datetime import datetime, timezone

from database.connection import connect_db


ADMIN_STATUSES = {"administrator", "creator"}


def admin_status_changed(old_status: str | None, new_status: str | None) -> bool:
    """Return whether a membership event changed chat-admin authority."""
    return old_status != new_status and (
        old_status in ADMIN_STATUSES or new_status in ADMIN_STATUSES
    )


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


async def sync_chat_admins(bot, chat_id: int) -> list:
    """Refresh the local admin composition from Telegram for one chat."""
    _ensure_table()
    admins = await bot.get_chat_administrators(chat_id=chat_id)
    current_ids = {admin.user.id for admin in admins}
    with connect_db("users.db") as db:
        db.execute("UPDATE chat_members SET is_chat_admin=0,is_chat_owner=0 WHERE chat_id=?", (chat_id,))
        db.commit()
    for admin in admins:
        status = getattr(admin, "status", None)
        user = admin.user
        observe(
            chat_id=chat_id,
            user_id=user.id,
            name=user.full_name,
            username=user.username,
            telegram_status=status or "administrator",
            is_chat_owner=status == "creator",
            is_chat_admin=True,
        )
    return admins


def _existing_bot_role(chat_id: int, user_id: int) -> str | None:
    _ensure_table()
    with connect_db("users.db") as db:
        row = db.execute(
            "SELECT bot_role FROM chat_members WHERE chat_id=? AND user_id=?",
            (chat_id, user_id),
        ).fetchone()
    return row["bot_role"] if row else None


async def refresh_chat_member(bot, chat_id: int, user_id: int):
    """Refresh one user's Telegram membership without touching local role assignments."""
    _ensure_table()
    member = await bot.get_chat_member(chat_id=chat_id, user_id=user_id)
    status = getattr(member, "status", None)
    user = getattr(member, "user", None)
    if user is None:
        return member
    observe(
        chat_id=chat_id,
        user_id=user.id,
        name=user.full_name,
        username=user.username,
        telegram_status=status,
        bot_role=_existing_bot_role(chat_id, user.id),
        is_chat_owner=status == "creator",
        is_chat_admin=status in ADMIN_STATUSES,
    )
    return member


def observe_chat_member_update(chat_member) -> None:
    """Persist a Telegram chat_member update while preserving bot-local role data."""
    chat = getattr(chat_member, "chat", None)
    member = getattr(chat_member, "new_chat_member", None)
    user = getattr(member, "user", None)
    if not chat or not member or not user:
        return
    status = getattr(member, "status", None)
    observe(
        chat_id=chat.id,
        user_id=user.id,
        name=user.full_name,
        username=user.username,
        telegram_status=status,
        bot_role=_existing_bot_role(chat.id, user.id),
        is_chat_owner=status == "creator",
        is_chat_admin=status in ADMIN_STATUSES,
    )


def get_chat_authority(chat_id: int, user_id: int) -> str | None:
    """Return Telegram-derived local authority without affecting founder identity."""
    from config.role_config import CHAT_OWNER_ROLE
    _ensure_table()
    with connect_db("users.db") as db:
        row = db.execute(
            "SELECT telegram_status,is_chat_owner,is_chat_admin FROM chat_members WHERE chat_id=? AND user_id=?",
            (chat_id, user_id),
        ).fetchone()
    if not row:
        return None
    if row["is_chat_owner"] or row["telegram_status"] == "creator":
        return CHAT_OWNER_ROLE
    if row["is_chat_admin"] or row["telegram_status"] == "administrator":
        return "Администратор"
    return None
