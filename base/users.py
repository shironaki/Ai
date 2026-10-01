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


def ensure_owner_registered(user_id: int, name: str | None = None, username: str | None = None) -> None:
    """Keep the configured founder present in the legacy users registry.

    Founder authorization is still determined by config.owner; this row only
    keeps legacy handlers that require a users.db record from asking the founder
    to run /start after a fresh database/bootstrap.
    """
    if not user_id:
        return

    row = cursor.execute("SELECT id FROM users WHERE id = ? LIMIT 1", (user_id,)).fetchone()
    if row:
        if name is not None or username is not None:
            cursor.execute(
                "UPDATE users SET name = COALESCE(?, name), username = ? WHERE id = ?",
                (name, username, user_id),
            )
            connect.commit()
        return

    cursor.execute(
        "INSERT INTO users VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            user_id,
            name or "Основатель",
            username,
            "Создатель бота",
            0,
            10,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            "системная учётная запись",
            "00:00:00",
            0,
            "Системная учётная запись Основателя",
            0,
            1,
            "00:000:00",
            0,
        ),
    )
    connect.commit()
