from database.connection import connect_db


DB_NAME = "users.db"
USERS_COLUMNS = (
    "id", "name", "username", "status", "balance", "stavka", "games",
    "casino", "kosti", "darts", "bouling", "footbal", "basket", "ohota",
    "slots", "regdata", "dick_time", "dick", "bio", "bank", "ls",
    "work_time", "invited_users",
)


def get_connection():
    return connect_db(DB_NAME)


def get_user(user_id):
    with get_connection() as connection:
        return connection.execute(
            "SELECT * FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()


def get_status(user_id):
    row = get_user(user_id)
    return row["status"] if row else None


def user_exists(user_id):
    return get_user(user_id) is not None
