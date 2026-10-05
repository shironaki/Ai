"""Canonical human roles for the non-game administration layer.

The AI/SYSTEM is not a human role and must never be assigned to a user.
Telegram chat-owner/admin status is an authority source, not a persistent bot role.
"""

ROLE_TAGS = {
    "Пользователь": "👤 ПОЛЬЗОВАТЕЛЬ",
    "Модератор": "🔨 МОДЕРАТОР",
    "Хелпер": "👮 ХЕЛПЕР",
    "Администратор": "🛡️ АДМИНИСТРАТОР",
    "Владелец чата": "🔑 ВЛАДЕЛЕЦ ЧАТА",
    "Создатель бота": "👑 ОСНОВАТЕЛЬ",
}

SYSTEM_ROLE = "Система"
GAME_ROLE = "Игрок"
OWNER_ROLE = "Создатель бота"
CHAT_OWNER_ROLE = "Владелец чата"

ASSIGNABLE_ROLES = ("Модератор", "Хелпер", "Администратор")
ROLE_ORDER = {
    "Пользователь": 10,
    "Модератор": 20,
    "Хелпер": 30,
    "Администратор": 40,
    CHAT_OWNER_ROLE: 45,
    OWNER_ROLE: 50,
}
MODERATOR_ROLES = {"Модератор", "Хелпер", "Администратор", CHAT_OWNER_ROLE, OWNER_ROLE}
ADMIN_ROLES = {"Администратор", CHAT_OWNER_ROLE, OWNER_ROLE}


def is_assignable_role(role: str) -> bool:
    return role in ASSIGNABLE_ROLES


def can_grant_role(actor_role: str, target_role: str, *, actor_is_owner: bool = False) -> bool:
    if actor_is_owner:
        return target_role in ASSIGNABLE_ROLES
    if not is_assignable_role(target_role):
        return False
    return ROLE_ORDER.get(target_role, 0) < ROLE_ORDER.get(actor_role, 0)
