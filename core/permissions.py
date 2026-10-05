from base import users
from config.role_config import ADMIN_ROLES, MODERATOR_ROLES, OWNER_ROLE
from core.identity import is_owner, resolve_role


def get_user_status(user_id, chat_id=None):
    """Return the effective human role for this surface.

    Administrative roles are chat-local. When a chat context is supplied, a
    missing assignment therefore means ordinary user, not the user's legacy
    global status. The founder remains globally privileged.
    """
    if is_owner(user_id):
        return OWNER_ROLE
    if chat_id is not None:
        from services.chat_members import get_chat_authority
        authority = get_chat_authority(chat_id, user_id)
        if authority:
            return authority
        from services.chat_roles import get_role
        return get_role(chat_id, user_id) or "Пользователь"
    row = users.cursor.execute(
        "SELECT status FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    return row[0] if row else None


def get_display_role(user_id, chat_id=None):
    if is_owner(user_id):
        return OWNER_ROLE
    if chat_id is not None:
        from services.chat_members import get_chat_authority
        authority = get_chat_authority(chat_id, user_id)
        if authority:
            return authority
        from services.chat_roles import get_role
        return get_role(chat_id, user_id) or "Пользователь"
    return resolve_role(user_id)


def get_role_tag(user_id):
    from config.role_config import ROLE_TAGS
    return ROLE_TAGS.get(get_display_role(user_id), ROLE_TAGS["Пользователь"])


def format_user_tag(user_id, name=None):
    display_name = name or f"id{user_id}"
    return f"{get_role_tag(user_id)} · {display_name}"


def has_moderator_role(user_id, chat_id=None):
    return is_owner(user_id) or get_user_status(user_id, chat_id) in MODERATOR_ROLES


def has_admin_role(user_id, chat_id=None):
    return is_owner(user_id) or get_user_status(user_id, chat_id) in ADMIN_ROLES
