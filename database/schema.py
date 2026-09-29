from pathlib import Path
import sqlite3


DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)


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


def ensure_schema():
    with sqlite3.connect(DATA_DIR / "users.db") as connection:
        connection.execute(USERS_SCHEMA)
        connection.commit()
