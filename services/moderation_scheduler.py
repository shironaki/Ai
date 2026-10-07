"""Persistent moderation timers and user-facing expiry notifications."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from database.connection import connect_db


def ensure_table() -> None:
    with connect_db("users.db") as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS moderation_timers(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                target_user_id INTEGER NOT NULL,
                target_name TEXT,
                actor_user_id INTEGER,
                action TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                notified INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )
            """
        )


def schedule(*, chat_id: int, target_user_id: int, target_name: str, actor_user_id: int, action: str, expires_at: datetime) -> int:
    ensure_table()
    now = datetime.now(timezone.utc).isoformat()
    with connect_db("users.db") as db:
        cur = db.execute(
            """
            INSERT INTO moderation_timers(
                chat_id,target_user_id,target_name,actor_user_id,action,expires_at,notified,created_at
            ) VALUES(?,?,?,?,?,?,0,?)
            """,
            (
                chat_id,
                target_user_id,
                target_name,
                actor_user_id,
                action,
                expires_at.astimezone(timezone.utc).isoformat(),
                now,
            ),
        )
        return int(cur.lastrowid)


def supersede_timers(*, chat_id: int, target_user_id: int) -> None:
    """Invalidate older pending moderation timers for the same target/chat."""
    ensure_table()
    with connect_db("users.db") as db:
        db.execute(
            "UPDATE moderation_timers SET notified=1 "
            "WHERE chat_id=? AND target_user_id=? AND notified=0",
            (chat_id, target_user_id),
        )
        db.commit()


def format_remaining(expires_at: datetime) -> str:
    seconds = max(0, int((expires_at - datetime.now(timezone.utc)).total_seconds()))
    minutes, sec = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    days, hours = divmod(hours, 24)
    parts = []
    if days:
        parts.append(f"{days} д.")
    if hours:
        parts.append(f"{hours} ч.")
    if minutes:
        parts.append(f"{minutes} мин.")
    if not parts:
        parts.append(f"{sec} сек.")
    return " ".join(parts)


def format_duration(seconds: int) -> str:
    seconds = max(0, int(seconds))
    minutes, sec = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    days, hours = divmod(hours, 24)
    parts = []
    if days:
        parts.append(f"{days} д.")
    if hours:
        parts.append(f"{hours} ч.")
    if minutes:
        parts.append(f"{minutes} мин.")
    if sec and not parts:
        parts.append(f"{sec} сек.")
    return " ".join(parts) or "0 сек."


async def notify_issued(bot, *, chat_id: int, target_user_id: int, target_name: str, action: str, duration_seconds: int, expires_at: datetime) -> None:
    action_name = "мут" if action == "mute" else "бан"
    until = expires_at.astimezone().strftime("%d.%m.%Y %H:%M:%S")
    remaining = format_duration(duration_seconds)
    group_text = (
        f"🔇 <b>{action_name.upper()} выдан.</b>\n"
        f"👤 Пользователь: <b>{target_name}</b>\n"
        f"⏳ Срок: <b>{remaining}</b>\n"
        f"🕒 До: <b>{until}</b>\n"
        f"⌛ Осталось: <b>{format_remaining(expires_at)}</b>"
    )
    try:
        await bot.send_message(chat_id, group_text)
    except Exception:
        pass

    private_text = (
        f"🔇 У вас <b>{action_name}</b>.\n"
        f"⏳ Срок: <b>{remaining}</b>\n"
        f"🕒 До: <b>{until}</b>\n"
        f"⌛ Осталось: <b>{format_remaining(expires_at)}</b>"
    )
    try:
        await bot.send_message(target_user_id, private_text)
    except Exception:
        # Telegram may forbid a bot from starting a private conversation.
        # The group notice remains the authoritative notification.
        pass


async def _notify_expired(bot, row) -> None:
    timer_id, chat_id, target_user_id, target_name, actor_user_id, action, expires_at, _ = row
    action_name = "мут" if action == "mute" else "бан"
    group_text = f"🔔 <b>{action_name.upper()} снят автоматически.</b>\n👤 Пользователь: <b>{target_name or target_user_id}</b>"
    private_text = f"🔔 Ваш <b>{action_name}</b> истёк. Ограничение больше не действует."

    try:
        await bot.send_message(chat_id, group_text)
    except Exception:
        pass
    try:
        await bot.send_message(target_user_id, private_text)
    except Exception:
        pass

    with connect_db("users.db") as db:
        db.execute("UPDATE moderation_timers SET notified=1 WHERE id=?", (timer_id,))


async def process_expired(bot) -> None:
    ensure_table()
    now = datetime.now(timezone.utc)
    with connect_db("users.db") as db:
        rows = db.execute(
            """
            SELECT id,chat_id,target_user_id,target_name,actor_user_id,action,expires_at,notified
            FROM moderation_timers
            WHERE notified=0 AND expires_at <= ?
            ORDER BY id
            LIMIT 50
            """,
            (now.isoformat(),),
        ).fetchall()

    for row in rows:
        await _notify_expired(bot, row)


async def expiry_loop(bot) -> None:
    ensure_table()
    while True:
        try:
            await process_expired(bot)
        except asyncio.CancelledError:
            raise
        except Exception:
            # The main runtime logger captures the surrounding task failure.
            pass
        await asyncio.sleep(5)


async def notify_action(bot, *, chat_id: int, target_user_id: int, target_name: str, action: str, text: str) -> None:
    """Notify both the moderation chat and the affected user when possible."""
    try:
        await bot.send_message(chat_id, text)
    except Exception:
        pass
    try:
        await bot.send_message(
            target_user_id,
            f"🔔 <b>Действие модерации:</b> {text}",
        )
    except Exception:
        pass
