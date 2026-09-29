import sqlite3

connect = sqlite3.connect("chats.db")
cursor = connect.cursor()
cursor.execute("""CREATE TABLE IF NOT EXISTS chats(
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
""")
connect.commit()
