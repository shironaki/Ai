from database.connection import DB_DIR, connect_db


USERS_SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
    id INTEGER,
    name STRING,
    username STRING,
    status TEXT,
    balance INTEGER,
    stavka INTEGER,
    games INTEGER,
    casino INTEGER,
    kosti INTEGER,
    darts INTEGER,
    bouling INTEGER,
    footbal INTEGER,
    basket INTEGER,
    ohota INTEGER,
    slots INTEGER,
    regdata STRING,
    dick_time INTEGER,
    dick INTEGER,
    bio TEXT,
    bank INTEGER,
    ls INTEGER,
    work_time INTEGER,
    invited_users INTEGER
)
"""

CHATS_SCHEMA = """
CREATE TABLE IF NOT EXISTS chats(
    chat_id INTEGER,
    chat_name STRING,
    chat_username STRING,
    game_rule STRING,
    chat_games INTEGER,
    reg_data STRING,
    chat_status STRING,
    chat_rules TEXT,
    mod_cmd STRING,
    rules STRING,
    welcome STRING
)
"""


def ensure_schema():
    with connect_db("users.db") as connection:
        connection.execute(USERS_SCHEMA)
    with connect_db("chats.db") as connection:
        connection.execute(CHATS_SCHEMA)
