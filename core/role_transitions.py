"""Role assignment rules for the non-game administration layer.

Only human administrative roles are assignable. AI/SYSTEM is a service identity,
and the game-only role «Игрок» is intentionally outside this policy.
"""

from config.role_config import ASSIGNABLE_ROLES, ROLE_ORDER, can_grant_role


def available_role_targets(actor_role: str, *, actor_is_owner: bool = False) -> tuple[str, ...]:
    return tuple(
        role
        for role in ASSIGNABLE_ROLES
        if can_grant_role(actor_role, role, actor_is_owner=actor_is_owner)
    )


def can_assign(actor_role: str, target_role: str, *, actor_is_owner: bool = False) -> bool:
    return can_grant_role(actor_role, target_role, actor_is_owner=actor_is_owner)


def assignment_error(actor_role: str, target_role: str, *, actor_is_owner: bool = False) -> str | None:
    if target_role not in ASSIGNABLE_ROLES:
        return "Эта роль не назначается через административный контур."
    if actor_is_owner:
        return None
    if target_role not in ROLE_ORDER:
        return "Неизвестная роль."
    if ROLE_ORDER.get(target_role, 0) >= ROLE_ORDER.get(actor_role, 0):
        return "Нельзя назначить роль своего уровня или выше."
    return None
