from core.permissions import has_admin_role, has_moderator_role


def can_moderate(user_id, chat_id=None):
    return has_moderator_role(user_id, chat_id)


def can_administer(user_id, chat_id=None):
    return has_admin_role(user_id, chat_id)
