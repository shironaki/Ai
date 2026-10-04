"""Persistent AI relationship and invocation policy.

The relationship is deterministic state, not an LLM sentiment guess. Founder is
always at maximum positive relationship and cannot be blocked from calling AI.
Invocation names are configurable through environment variables.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone

from database.connection import connect_db


DEFAULT_INVOCATION_NAMES = ("аи", "система")
DEFAULT_ALTERNATE_NAMES = ("ассистент", "помощник")
MAX_SCORE = 100
MIN_SCORE = -100
NEGATIVE_THRESHOLD = -50
BLOCK_THRESHOLD = -75
# Relationship level that unlocks invocation-free AI as a deliberate bonus.
FREE_INVOCATION_THRESHOLD = 75


def _split_names(raw: str | None, defaults: tuple[str, ...]) -> tuple[str, ...]:
    if not raw:
        return defaults
    values = []
    for item in raw.split(","):
        name = " ".join(item.casefold().strip().split())
        if name and name not in values:
            values.append(name[:40])
    return tuple(values[:8]) or defaults


def _ensure_settings() -> None:
    with connect_db("users.db") as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS ai_settings(
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        db.commit()


def _get_setting(key: str) -> str | None:
    _ensure_settings()
    with connect_db("users.db") as db:
        row = db.execute("SELECT value FROM ai_settings WHERE key=?", (key,)).fetchone()
    return str(row["value"]) if row else None


def _set_setting(key: str, value: str) -> None:
    _ensure_settings()
    with connect_db("users.db") as db:
        db.execute(
            """
            INSERT INTO ai_settings(key,value,updated_at) VALUES(?,?,?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at
            """,
            (key, value, datetime.now(timezone.utc).isoformat()),
        )
        db.commit()


def invocation_names() -> tuple[str, ...]:
    return _split_names(
        _get_setting("invocation_names") or os.getenv("AI_INVOCATION_NAMES"),
        DEFAULT_INVOCATION_NAMES,
    )


def alternate_names() -> tuple[str, ...]:
    return _split_names(
        _get_setting("alternate_names") or os.getenv("AI_ALTERNATE_NAMES"),
        DEFAULT_ALTERNATE_NAMES,
    )


def set_invocation_names(value: str, *, actor_id: int | None = None) -> tuple[str, ...]:
    from base import config
    if actor_id != config.owner:
        raise PermissionError("Invocation names require founder actor context")
    names = _split_names(value, DEFAULT_INVOCATION_NAMES)
    _set_setting("invocation_names", ",".join(names))
    return names


def set_alternate_names(value: str, *, actor_id: int | None = None) -> tuple[str, ...]:
    from base import config
    if actor_id != config.owner:
        raise PermissionError("Alternate invocation names require founder actor context")
    names = _split_names(value, DEFAULT_ALTERNATE_NAMES)
    _set_setting("alternate_names", ",".join(names))
    return names


def _ensure_table() -> None:
    with connect_db("users.db") as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS ai_relationship(
                user_id INTEGER PRIMARY KEY,
                score INTEGER NOT NULL DEFAULT 0,
                calls_blocked INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            )
            """
        )
        db.commit()


def get_score(user_id: int, owner_id: int | None = None) -> int:
    if owner_id is not None and user_id == owner_id:
        return MAX_SCORE
    _ensure_table()
    with connect_db("users.db") as db:
        row = db.execute(
            "SELECT score FROM ai_relationship WHERE user_id=?",
            (user_id,),
        ).fetchone()
    return int(row["score"]) if row else 0


def set_score(
    user_id: int,
    score: int,
    owner_id: int | None = None,
    *,
    actor_id: int | None = None,
) -> int:
    if owner_id is None or actor_id != owner_id:
        raise PermissionError("AI relationship changes require founder actor context")
    value = MAX_SCORE if user_id == owner_id else max(MIN_SCORE, min(MAX_SCORE, int(score)))
    _ensure_table()
    with connect_db("users.db") as db:
        db.execute(
            """
            INSERT INTO ai_relationship(user_id,score,calls_blocked,updated_at)
            VALUES(?,?,0,?)
            ON CONFLICT(user_id) DO UPDATE SET score=excluded.score,updated_at=excluded.updated_at
            """,
            (user_id, value, datetime.now(timezone.utc).isoformat()),
        )
        db.commit()
    return value


def set_calls_blocked(
    user_id: int,
    blocked: bool,
    owner_id: int | None = None,
    *,
    actor_id: int | None = None,
) -> bool:
    if owner_id is None or actor_id != owner_id:
        raise PermissionError("AI call blocking changes require founder actor context")
    value = False if user_id == owner_id else bool(blocked)
    _ensure_table()
    with connect_db("users.db") as db:
        db.execute(
            """
            INSERT INTO ai_relationship(user_id,score,calls_blocked,updated_at)
            VALUES(?,0,?,?)
            ON CONFLICT(user_id) DO UPDATE SET calls_blocked=excluded.calls_blocked,updated_at=excluded.updated_at
            """,
            (user_id, int(value), datetime.now(timezone.utc).isoformat()),
        )
        db.commit()
    return value


def relationship_state(user_id: int, owner_id: int | None = None) -> str:
    score = get_score(user_id, owner_id)
    if score >= 50:
        return "positive"
    if score <= NEGATIVE_THRESHOLD:
        return "negative"
    return "neutral"


def is_max_positive(user_id: int, owner_id: int | None = None) -> bool:
    """Compatibility name: unlock the invocation-free bonus at 75/100."""
    return get_score(user_id, owner_id) >= FREE_INVOCATION_THRESHOLD


def calls_blocked(user_id: int, owner_id: int | None = None) -> bool:
    if owner_id is not None and user_id == owner_id:
        return False
    score = get_score(user_id, owner_id)
    _ensure_table()
    with connect_db("users.db") as db:
        row = db.execute(
            "SELECT calls_blocked FROM ai_relationship WHERE user_id=?",
            (user_id,),
        ).fetchone()
    explicit = bool(row["calls_blocked"]) if row else False
    return explicit or score <= BLOCK_THRESHOLD


def can_call(user_id: int, owner_id: int | None = None) -> bool:
    return not calls_blocked(user_id, owner_id)
