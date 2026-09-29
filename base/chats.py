import os
import sqlite3
from pathlib import Path

DB_DIR = Path(os.getenv("BOT_DATA_DIR", "."))
DB_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DB_DIR / "chats.db"

connect = sqlite3.connect(DB_PATH)
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
