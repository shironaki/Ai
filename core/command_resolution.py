"""Shared, conservative resolution helpers for command execution.

These helpers only resolve context already present in the incoming message/intent.
They do not discover arbitrary users or broaden command authority.
"""

from __future__ import annotations


VALID_SCOPES = {"chat", "global"}


def resolve_scope(scope: str | None, *, default: str = "chat") -> str | None:
    value = (scope or default).casefold().strip()
    return value if value in VALID_SCOPES else None


def resolve_reply_target(message):
    """Return the replied-to Telegram user, or None.

    Target resolution is deliberately limited to an explicit reply target.
    """
    reply = getattr(message, "reply_to_message", None)
    return getattr(reply, "from_user", None) if reply is not None else None
