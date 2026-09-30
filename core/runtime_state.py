"""Runtime state for bot-wide and chat-scoped operational modes."""

_GLOBAL_PAUSED = False
_PAUSED_CHATS = set()


def is_paused(chat_id=None) -> bool:
    """Return whether the bot is paused globally or for the supplied chat."""
    if _GLOBAL_PAUSED:
        return True
    return chat_id is not None and chat_id in _PAUSED_CHATS


def set_paused(value: bool, scope: str = "global", chat_id=None) -> None:
    """Enable/disable stasis globally or for one chat."""
    global _GLOBAL_PAUSED

    if scope == "global":
        _GLOBAL_PAUSED = bool(value)
        if value:
            _PAUSED_CHATS.clear()
        return

    if scope != "chat":
        raise ValueError(f"Unknown runtime scope: {scope}")

    if chat_id is None:
        raise ValueError("chat_id is required for chat-scoped runtime state")

    if value:
        _PAUSED_CHATS.add(chat_id)
    else:
        _PAUSED_CHATS.discard(chat_id)


def scope_is_paused(scope: str, chat_id=None) -> bool:
    if scope == "global":
        return _GLOBAL_PAUSED
    if scope == "chat":
        return is_paused(chat_id)
    return False
