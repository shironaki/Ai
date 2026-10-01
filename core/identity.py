"""Centralized identity resolution for the Telegram command pipeline.

The owner is resolved from base.config only. No command handler should infer
founder status from the users table.
"""

from dataclasses import dataclass

from base import config, users


ROLE_ORDER = {
    "Игрок": 10,
    "Модератор": 20,
    "Хелпер": 30,
    "Администратор": 40,
    "Создатель бота": 50,
    "Система": 60,
}


@dataclass(frozen=True)
class Identity:
    user_id: int
    role: str
    is_owner: bool


def resolve_role(user_id: int) -> str:
    if user_id == config.owner:
        return "Создатель бота"
    row = users.cursor.execute(
        "SELECT status FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    status = row[0] if row else None
    return status if status in ROLE_ORDER else "Игрок"


def resolve_identity(user_id: int) -> Identity:
    owner = user_id == config.owner
    return Identity(user_id=user_id, role="Создатель бота" if owner else resolve_role(user_id), is_owner=owner)


def is_owner(user_id: int) -> bool:
    return user_id == config.owner


def role_level(role: str) -> int:
    return ROLE_ORDER.get(role, 0)


def role_allows(actual: str, required: str) -> bool:
    return role_level(actual) >= role_level(required)
