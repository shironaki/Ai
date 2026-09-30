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


def _lock_down_path(path: Path) -> None:
    """Best-effort POSIX permissions for local bot data."""
    if os.name != "nt":
        try:
            path.chmod(0o700 if path.is_dir() else 0o600)
        except OSError:
            pass


_lock_down_path(DB_DIR)


def connect_db(filename: str) -> sqlite3.Connection:
    path = DB_DIR / filename
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    _lock_down_path(path)
    return connection
