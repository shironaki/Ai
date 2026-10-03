"""Unified founder broadcast service.

One semantic broadcast operation is used for both user and chat audiences.
The caller supplies the already-resolved Telegram recipient IDs.
"""

import asyncio
from typing import Iterable

from base import config


async def broadcast_message(
    message,
    recipient_ids: Iterable[int],
    *,
    actor_id: int,
    delay: float = 0.15,
):
    """Copy one Telegram message to every recipient after founder authorization."""
    if actor_id != config.owner:
        raise PermissionError("Broadcast execution requires founder actor context")
    sent = 0
    failed = 0
    for recipient_id in dict.fromkeys(int(x) for x in recipient_ids):
        try:
            await message.copy_to(recipient_id)
            sent += 1
        except Exception:
            failed += 1
        if delay:
            await asyncio.sleep(delay)
    return sent, failed
