from database import users


def get_user(user_id):
    return users.get_user(user_id)


def get_status(user_id, chat_id=None):
    from core.permissions import get_display_role
    return get_display_role(user_id, chat_id)


def exists(user_id):
    return users.user_exists(user_id)
