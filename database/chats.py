from database.connection import connect_db


DB_NAME = "chats.db"


def get_connection():
    return connect_db(DB_NAME)


def get_chat(chat_id):
    with get_connection() as connection:
        return connection.execute(
            "SELECT * FROM chats WHERE chat_id = ?",
            (chat_id,),
        ).fetchone()


def chat_exists(chat_id):
    return get_chat(chat_id) is not None
