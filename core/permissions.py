from config.role_config import OWNER_ROLE
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
    """Return the effective human role for the current surface."""
    if is_owner(user_id):
        return OWNER_ROLE
    global_role = resolve_role(user_id)
    # Local Telegram ownership is a scoped authority and must win over a
    # global technical Helper role for this chat. The Helper identity remains
    # globally available through resolve_role()/has_report_access().
    authority = _telegram_authority(user_id, chat_id)
    if authority:
        return authority
    local_role = _local_bot_role(user_id, chat_id)
    if local_role:
        return local_role
    if global_role == "Хелпер":
        return global_role
    return "Пользователь"


def get_display_role(user_id, chat_id=None):
    return get_user_status(user_id, chat_id)


def get_role_tag(user_id, chat_id=None):
    from config.role_config import ROLE_TAGS
    return ROLE_TAGS.get(get_display_role(user_id, chat_id), ROLE_TAGS["Пользователь"])


def format_user_tag(user_id, name=None, chat_id=None):
    display_name = name or f"id{user_id}"
    return f"{get_role_tag(user_id, chat_id)} · {display_name}"


def has_admin_role(user_id, chat_id=None):
    """True only for the Telegram owner of the current chat or Founder."""
    if is_owner(user_id):
        return True
    return _telegram_authority(user_id, chat_id) == "Администратор"


def has_moderator_role(user_id, chat_id=None):
    """Moderation authority: local Moderator or local Administrator."""
    if is_owner(user_id):
        return True
    # A global Helper is technical staff, not a local moderator. However,
    # being the actual Telegram creator of this chat is an independent local
    # authority and must remain effective even when the same person is a Helper.
    if _telegram_authority(user_id, chat_id) == "Администратор":
        return True
    local_role = _local_bot_role(user_id, chat_id)
    if local_role == "Модератор":
        return True
    if resolve_role(user_id) == "Хелпер":
        return False
    return False


def has_report_access(user_id, chat_id=None):
    """Report authority: Founder, global Helper, or local admin/moderator."""
    if is_owner(user_id):
        return True
    if resolve_role(user_id) == "Хелпер":
        return True
    return has_moderator_role(user_id, chat_id)
