"""Minimal audit trail for sensitive command actions.

Only metadata required to reconstruct an administrative action is recorded.
Message text, tokens, AI prompts and provider responses are intentionally excluded.
"""

import json
import logging
import time

log = logging.getLogger(__name__)


def record(*, user_id: int, chat_id: int, command: str, scope: str, result: str) -> None:
    event = {
        "ts": int(time.time()),
        "user_id": user_id,
        "chat_id": chat_id,
        "command": command,
        "scope": scope,
        "result": result,
    }
    log.info("AUDIT %s", json.dumps(event, ensure_ascii=False, separators=(",", ":")))
