import sqlite3
from pathlib import Path


DB_DIR = Path("data")
DB_DIR.mkdir(exist_ok=True)


def connect_db(filename: str) -> sqlite3.Connection:
    connection = sqlite3.connect(DB_DIR / filename)
    connection.row_factory = sqlite3.Row
    return connection
