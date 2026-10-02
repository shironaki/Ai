"""Single cancellation path for pending assistant, moderation and runtime actions."""

from services.command_gateway import cancel_pending
from services.moderation_gateway import has_pending as has_pending_moderation
from services.moderation_gateway import pop as pop_moderation
from core.runtime_state import set_paused

# Last reversible runtime action per user/chat.
_RUNTIME_ACTIONS: dict[tuple[int, int], dict] = {}


def register_runtime_action(
    user_id: int,
    chat_id: int,
    *,
    previous_enabled: bool,
    scope: str = "global",
) -> None:
    """Remember a runtime transition so the universal Cancel button can undo it."""
    key_chat_id = 0 if scope == "global" else chat_id
    _RUNTIME_ACTIONS[(user_id, key_chat_id)] = {
        "previous_enabled": bool(previous_enabled),
        "scope": scope,
        "chat_id": chat_id,
    }


def _cancel_runtime_action(user_id: int, chat_id: int) -> bool:
    action = _RUNTIME_ACTIONS.pop((user_id, chat_id), None)
    if not action:
        action = _RUNTIME_ACTIONS.pop((user_id, 0), None)
    if not action:
        return False
    set_paused(
        action["previous_enabled"],
        scope=action["scope"],
        chat_id=chat_id,
    )
    return True


def cancel_current_action(user_id: int, chat_id: int) -> bool:
    """Cancel the most recent reversible action in this chat."""
    cancelled = cancel_pending(user_id, chat_id)
    moderation_cancelled = False
    if has_pending_moderation(user_id, chat_id):
        pop_moderation(user_id, chat_id)
        moderation_cancelled = True
    runtime_cancelled = _cancel_runtime_action(user_id, chat_id)
    return bool(cancelled or moderation_cancelled or runtime_cancelled)
