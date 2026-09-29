import os
import sqlite3
from pathlib import Path

# Keep the database location compatible with the live bot by default.
# BOT_DATA_DIR can override it for tests or a future managed deployment.
DB_DIR = Path(os.getenv("BOT_DATA_DIR", Path(__file__).resolve().parents[1]))
DB_DIR.mkdir(parents=True, exist_ok=True)


def connect_db(filename: str) -> sqlite3.Connection:
    connection = sqlite3.connect(DB_DIR / filename)
    connection.row_factory = sqlite3.Row
    return connection
