"""Canonical human roles and role hierarchy.

Bot roles are deliberately small:
* Основатель — global, immutable and derived from config.owner.
* Модератор — assignable either globally by the founder or locally by the
  Telegram chat owner.
* Пользователь — default.

Telegram creator/admin status is an authority source for the current chat, not
a persistent bot role.
"""

ROLE_TAGS = {
    "Пользователь": "👤 ПОЛЬЗОВАТЕЛЬ",
    "Модератор": "🔨 МОДЕРАТОР",
    "Создатель бота": "👑 ОСНОВАТЕЛЬ",
}

SYSTEM_ROLE = "Система"
GAME_ROLE = "Игрок"
OWNER_ROLE = "Создатель бота"
CHAT_OWNER_ROLE = "Владелец чата"  # transient authority, never stored as a bot role

ASSIGNABLE_ROLES = ("Модератор",)
ROLE_ORDER = {
    "Пользователь": 10,
    "Модератор": 20,
    OWNER_ROLE: 50,
}
MODERATOR_ROLES = {"Модератор", OWNER_ROLE}
ADMIN_ROLES = MODERATOR_ROLES


def is_assignable_role(role: str) -> bool:
    return role in ASSIGNABLE_ROLES


def can_grant_role(actor_role: str, target_role: str, *, actor_is_owner: bool = False) -> bool:
    if target_role not in ASSIGNABLE_ROLES:
        return False
    if actor_is_owner:
        return True
    return actor_role == CHAT_OWNER_ROLE and target_role == "Модератор"
