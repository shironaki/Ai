"""Canonical human roles and authority sources.

Founder is hidden and immutable. Telegram chat ownership supplies the local
Administrator authority. Administrators may appoint local Moderators.
Founder-appointed Helpers are global technical staff.
"""

ROLE_TAGS = {
    "Пользователь": "👤 ПОЛЬЗОВАТЕЛЬ",
    "Администратор": "🛡️ АДМИНИСТРАТОР",
    "Хелпер": "👮 ХЕЛПЕР",
    "Модератор": "🔨 МОДЕРАТОР",
}

SYSTEM_ROLE = "Система"
GAME_ROLE = "Игрок"
OWNER_ROLE = "Создатель бота"  # hidden immutable founder identity
CHAT_OWNER_ROLE = "Администратор"  # Telegram-derived local authority

ASSIGNABLE_ROLES = ("Модератор",)
GLOBAL_ASSIGNABLE_ROLES = ("Хелпер",)

ROLE_ORDER = {
    "Пользователь": 10,
    "Модератор": 20,
    "Администратор": 30,
    "Хелпер": 15,
    OWNER_ROLE: 50,
    "Основатель": 50,  # hidden compatibility alias for command catalog/policy
    SYSTEM_ROLE: 60,
    GAME_ROLE: 10,
}


def is_assignable_role(role: str) -> bool:
    return role in ASSIGNABLE_ROLES


def is_global_assignable_role(role: str) -> bool:
    return role in GLOBAL_ASSIGNABLE_ROLES


def can_grant_role(actor_role: str, target_role: str, *, actor_is_owner: bool = False) -> bool:
    if actor_is_owner:
        return target_role in GLOBAL_ASSIGNABLE_ROLES
    return actor_role == CHAT_OWNER_ROLE and target_role in ASSIGNABLE_ROLES
