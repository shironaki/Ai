"""Role assignment rules for global and chat-local human roles."""
from config.role_config import (
    ASSIGNABLE_ROLES,
    GLOBAL_ASSIGNABLE_ROLES,
    ROLE_ORDER,
    can_grant_role,
)


def available_role_targets(actor_role: str, *, actor_is_owner: bool = False) -> tuple[str, ...]:
    if actor_is_owner:
        return tuple(GLOBAL_ASSIGNABLE_ROLES)
    return tuple(
        role for role in ASSIGNABLE_ROLES
        if can_grant_role(actor_role, role, actor_is_owner=False)
    )


def can_assign(actor_role: str, target_role: str, *, actor_is_owner: bool = False) -> bool:
    return can_grant_role(actor_role, target_role, actor_is_owner=actor_is_owner)


def assignment_error(actor_role: str, target_role: str, *, actor_is_owner: bool = False) -> str | None:
    allowed = GLOBAL_ASSIGNABLE_ROLES if actor_is_owner else ASSIGNABLE_ROLES
    if target_role not in allowed:
        return "Эта роль не назначается через данный административный контур."
    if actor_is_owner:
        return None
    if ROLE_ORDER.get(target_role, 0) >= ROLE_ORDER.get(actor_role, 0):
        return "Нельзя назначить роль своего уровня или выше."
    return None
