"""Single cancellation path for pending assistant and moderation actions."""

from services.command_gateway import cancel_pending
from services.moderation_gateway import has_pending as has_pending_moderation
from services.moderation_gateway import pop as pop_moderation


def cancel_current_action(user_id: int, chat_id: int) -> bool:
    cancelled = cancel_pending(user_id, chat_id)
    moderation_cancelled = False
    if has_pending_moderation(user_id, chat_id):
        pop_moderation(user_id, chat_id)
        moderation_cancelled = True
    return bool(cancelled or moderation_cancelled)
