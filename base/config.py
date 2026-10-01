import os

bot_heart = os.getenv("BOT_TOKEN")


def _owner_id() -> int:
    raw = os.getenv("OWNER_ID", "1057867710").strip()
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError("OWNER_ID must be a numeric Telegram user id") from exc


owner = _owner_id()
