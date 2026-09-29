from base import config, users
from config.role_config import ADMIN_ROLES, MODERATOR_ROLES, ROLE_TAGS


def get_user_status(user_id):
    row = users.cursor.execute(
        "SELECT status FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    return row[0] if row else None


def get_display_role(user_id):
    if user_id == config.owner:
        return "Создатель бота"
    status = get_user_status(user_id)
    return status if status in ROLE_TAGS else "Игрок"


def get_role_tag(user_id):
    return ROLE_TAGS[get_display_role(user_id)]


def format_user_tag(user_id, name=None):
    display_name = name or f"id{user_id}"
    return f"{get_role_tag(user_id)} · {display_name}"


def has_moderator_role(user_id):
    return user_id == config.owner or get_user_status(user_id) in MODERATOR_ROLES


def has_admin_role(user_id):
    return user_id == config.owner or get_user_status(user_id) in ADMIN_ROLES
