import os
import sqlite3
from pathlib import Path

DB_DIR = Path(
    os.getenv(
        "BOT_DATA_DIR",
        Path("data") / os.getenv("BOT_ENV", "local"),
    )
)
DB_DIR.mkdir(parents=True, exist_ok=True)


def connect_db(filename: str) -> sqlite3.Connection:
    connection = sqlite3.connect(DB_DIR / filename)
    connection.row_factory = sqlite3.Row
    return connection
