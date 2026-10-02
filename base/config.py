import os

bot_heart = os.getenv("BOT_TOKEN")


def _owner_id() -> int:
    raw = os.getenv("OWNER_ID", "1057867710").strip()
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError("OWNER_ID must be a numeric Telegram user id") from exc


owner = _owner_id()


# Optional technical-team recipients for user reports. Founder is always included by the report layer.
def _tech_team_ids() -> tuple[int, ...]:
    raw = os.getenv("TECH_TEAM_IDS", "").strip()
    if not raw:
        return ()
    result = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        try:
            result.append(int(item))
        except ValueError:
            continue
    return tuple(dict.fromkeys(result))

tech_team_ids = _tech_team_ids()
