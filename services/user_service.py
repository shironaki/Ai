from database import users


def get_user(user_id):
    return users.get_user(user_id)


def get_status(user_id):
    return users.get_status(user_id)


def exists(user_id):
    return users.user_exists(user_id)
