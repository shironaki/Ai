from core.permissions import has_admin_role, has_moderator_role


def can_moderate(user_id):
    return has_moderator_role(user_id)


def can_administer(user_id):
    return has_admin_role(user_id)
