"""Centralized identity and role resolution for the Telegram command pipeline.

«Система» is the AI/service identity and is never a human role.
The game-only «Игрок» role is not assigned by the administration layer.
"""

from dataclasses import dataclass

from base import config, users
from config.role_config import OWNER_ROLE, ROLE_ORDER

ROLE_ORDER = dict(ROLE_ORDER)


@dataclass(frozen=True)
class Identity:
    user_id: int
    role: str
    is_owner: bool


def resolve_role(user_id: int) -> str:
    if user_id == config.owner:
        return OWNER_ROLE
    from services.global_roles import get_global_role
    global_role = get_global_role(user_id)
    if global_role:
        return global_role
    return "Пользователь"


def resolve_identity(user_id: int) -> Identity:
    owner = user_id == config.owner
    return Identity(
        user_id=user_id,
        role=OWNER_ROLE if owner else resolve_role(user_id),
        is_owner=owner,
    )


def is_owner(user_id: int) -> bool:
    return user_id == config.owner


def role_level(role: str) -> int:
    return ROLE_ORDER.get(role, 0)


def role_allows(actual: str, required: str) -> bool:
    return role_level(actual) >= role_level(required)
