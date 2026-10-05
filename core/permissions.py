from config.role_config import ADMIN_ROLES, MODERATOR_ROLES, OWNER_ROLE, CHAT_OWNER_ROLE
from core.identity import is_owner, resolve_role


def _local_bot_role(user_id, chat_id):
    if chat_id is None:
        return None
    from services.chat_roles import get_role
    return get_role(chat_id, user_id)


def _telegram_authority(user_id, chat_id):
    if chat_id is None:
        return None
    from services.chat_members import get_chat_authority
    return get_chat_authority(chat_id, user_id)


def get_user_status(user_id, chat_id=None):
    """Return the effective bot role for this surface.

    Founder/global role wins first; then a chat-local bot role. Telegram
    creator/admin status is an authority source and is intentionally not
    persisted as a bot role.
    """
    if is_owner(user_id):
        return OWNER_ROLE
    local_role = _local_bot_role(user_id, chat_id)
    if local_role:
        return local_role
    if chat_id is not None:
        authority = _telegram_authority(user_id, chat_id)
        if authority:
            return authority
    return resolve_role(user_id) if chat_id is None else "Пользователь"


def get_display_role(user_id, chat_id=None):
    return get_user_status(user_id, chat_id)


def get_role_tag(user_id, chat_id=None):
    from config.role_config import ROLE_TAGS
    return ROLE_TAGS.get(
        get_display_role(user_id, chat_id),
        ROLE_TAGS["Пользователь"],
    )


def format_user_tag(user_id, name=None, chat_id=None):
    display_name = name or f"id{user_id}"
    return f"{get_role_tag(user_id, chat_id)} · {display_name}"


def has_moderator_role(user_id, chat_id=None):
    if is_owner(user_id):
        return True
    role = _local_bot_role(user_id, chat_id)
    if role == "Модератор":
        return True
    authority = _telegram_authority(user_id, chat_id)
    return authority in {"Владелец чата", "Администратор"}


def has_admin_role(user_id, chat_id=None):
    if is_owner(user_id):
        return True
    authority = _telegram_authority(user_id, chat_id)
    return authority == CHAT_OWNER_ROLE
