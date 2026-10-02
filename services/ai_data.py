"""Safe, read-only data access for AI answers.

This module exposes a deliberately small set of parameterized SQLite reads.
It never accepts SQL from users or the AI model.
"""

from base import config
from database.chats import get_chat
from database.connection import connect_db
from database.users import get_user
from core.runtime_state import is_paused


def _count(connection, table: str) -> int:
    # Table names are hard-coded by this module; callers cannot supply SQL.
    return int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])


def user_summary(user_id: int) -> dict | None:
    row = get_user(user_id)
    if row is None:
        return None
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "username": row["username"],
        "status": "Создатель бота" if user_id == config.owner else row["status"],
        "balance": row["balance"],
        "games": row["games"],
        "regdata": row["regdata"],
        "invited_users": row["invited_users"],
    }


def chat_summary(chat_id: int) -> dict | None:
    row = get_chat(chat_id)
    if row is None:
        return None
    return {
        "chat_id": int(row["chat_id"]),
        "name": row["chat_name"],
        "username": row["chat_username"],
        "status": row["chat_status"],
        "games": row["chat_games"],
        "registered_at": row["reg_data"],
        "game_rule": row["game_rule"],
    }


def system_summary() -> dict:
    with connect_db("users.db") as users:
        users_count = _count(users, "users")
        active_private = int(
            users.execute("SELECT COUNT(*) FROM users WHERE ls = 1").fetchone()[0]
        )
    with connect_db("chats.db") as chats:
        chats_count = _count(chats, "chats")

    return {
        "registered_users": users_count,
        "private_users": active_private,
        "registered_chats": chats_count,
    }


def runtime_summary(chat_id: int | None = None) -> dict:
    return {
        "global_paused": is_paused(),
        "current_chat_paused": is_paused(chat_id) if chat_id is not None else False,
    }


def build_verified_context(
    user_id: int,
    chat_id: int,
    prompt: str,
    role: str = "Пользователь",
) -> str | None:
    """Return verified context only for recognized read-only data requests."""
    text = prompt.casefold().replace("ё", "е")

    wants_profile = any(
        phrase in text
        for phrase in ("мой профиль", "моя статистика", "мои данные", "кто я")
    )
    wants_chat = any(
        phrase in text
        for phrase in (
            "статистика чата",
            "статистика этого чата",
            "информация о чате",
            "инфо чата",
            "данные чата",
        )
    )
    wants_system = (
        ("статист" in text and ("систем" in text or "бот" in text))
        or any(
            phrase in text
            for phrase in (
                "сколько пользователей",
                "сколько чатов",
                "сколько юзеров",
            )
        )
    )
    wants_runtime = any(
        phrase in text
        for phrase in ("стазис", "режим тишины", "бот сейчас активен", "бот сейчас молчит")
    )

    sections = []

    if wants_profile:
        profile = user_summary(user_id)
        sections.append(f"ПРОВЕРЕННЫЕ ДАННЫЕ ПРОФИЛЯ: {profile!r}")

    if wants_chat:
        chat = chat_summary(chat_id)
        sections.append(f"ПРОВЕРЕННЫЕ ДАННЫЕ ТЕКУЩЕГО ЧАТА: {chat!r}")

    if wants_system:
        if role in {"Основатель", "Создатель бота", "Администратор", "Система"}:
            sections.append(f"ПРОВЕРЕННАЯ СТАТИСТИКА БД: {system_summary()!r}")
        else:
            sections.append(
                "ПРОВЕРЕННАЯ СТАТИСТИКА БД: доступ к системным счётчикам "
                "для этой роли не предоставлен."
            )

    if wants_runtime:
        sections.append(f"ПРОВЕРЕННОЕ СОСТОЯНИЕ RUNTIME: {runtime_summary(chat_id)!r}")

    if not sections:
        return None

    return (
        "Это доверенный контекст Системы, полученный из read-only слоя данных. "
        "Используй только эти значения для соответствующих фактов. "
        "Если значение равно None, данных нет. Не добавляй придуманные показатели.\n"
        + "\n".join(sections)
    )
