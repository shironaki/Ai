import os
import sqlite3
from pathlib import Path

DB_DIR = Path(os.getenv("BOT_DATA_DIR", Path("data") / os.getenv("BOT_ENV", "local")))
DB_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DB_DIR / "users.db"
if os.name != "nt":
    try:
        DB_DIR.chmod(0o700)
        DB_PATH.touch(exist_ok=True)
        DB_PATH.chmod(0o600)
    except OSError:
        pass

connect = sqlite3.connect(DB_PATH)
cursor = connect.cursor()
cursor.execute("""CREATE TABLE IF NOT EXISTS users(
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
""")
connect.commit()
