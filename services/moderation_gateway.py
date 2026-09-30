"""Safe natural-language moderation executor.

Natural language may request moderation, but execution is never implicit.
A valid target is required (reply target), permissions are checked, and
destructive actions require an explicit confirmation in the same chat.
"""

from __future__ import annotations

import re
from datetime import timedelta

from aiogram import types
from aiogram.utils.exceptions import BadRequest, TelegramAPIError

from core.command_models import CommandContext, CommandIntent
from core.command_policy import evaluate
from core.permissions import get_display_role
from base import config
from services.audit_service import record
from services.moderation_scheduler import schedule, notify_issued, notify_action, format_duration

_PENDING = {}

_ACTIONS = {
    "ban": "заблокировать",
    "unban": "разблокировать",
    "mute": "замутить",
    "unmute": "снять мут",
}

_DURATION_RE = re.compile(
    r"(?P<value>\d+)\s*(?P<unit>м|мин|минут(?:а|ы)?|ч|час(?:а|ов)?|д|день|дня|дней)",
    re.IGNORECASE,
)


def _key(user_id: int, chat_id: int) -> tuple[int, int]:
    return user_id, chat_id


def has_pending(user_id: int, chat_id: int) -> bool:
    return _key(user_id, chat_id) in _PENDING


def _parse_duration(text: str):
    match = _DURATION_RE.search(text or "")
    if not match:
        return None
    value = int(match.group("value"))
    unit = match.group("unit").casefold()
    if value <= 0 or value > 3650:
        return None
    if unit.startswith(("м", "мин")):
        return value, "минут"
    if unit.startswith("ч"):
        return value, "часов"
    return value, "дней"


def detect_action(text: str) -> str | None:
    normalized = (text or "").casefold().replace("ё", "е")
    if any(x in normalized for x in ("разбань", "разблокируй", "сними бан", "снять бан")):
        return "unban"
    if any(x in normalized for x in ("размуть", "сними мут", "снять мут", "андебафф")):
        return "unmute"
    if any(x in normalized for x in ("заблокируй", "забан", "запрети писать", "бан")):
        return "ban"
    if any(x in normalized for x in ("замуть", "замьючь", "мут", "запрети сообщения")):
        return "mute"
    return None


def _reason(text: str, action: str) -> str:
    cleaned = (text or "").strip()
    cleaned = re.sub(r"\b(?:на\s+)?\d+\s*(?:м|мин|минут(?:а|ы)?|ч|час(?:а|ов)?|д|день|дня|дней)\b", "", cleaned, flags=re.I)
    for marker in (
        "заблокируй", "забан", "замуть", "замьючь", "разбань",
        "разблокируй", "размуть", "сними бан", "сними мут",
        "снять бан", "снять мут", "запрети писать", "запрети сообщения",
    ):
        cleaned = re.sub(re.escape(marker), "", cleaned, flags=re.I)
    cleaned = re.sub(r"\b(?:его|ее|её|их|ему|ей|этого|этот|пользователя|человека|юзера|юзеру)\b", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ,.-")
    return cleaned or "не указана"


def build_intent(message: types.Message, text: str):
    action = detect_action(text)
    if action is None:
        return None

    target = message.reply_to_message.from_user if message.reply_to_message else None
    if target is None:
        return {"error": "target"}

    duration = _parse_duration(text)
    if action in {"ban", "mute"} and duration is None:
        return {"error": "duration", "action": action, "target": target}

    return {
        "intent": CommandIntent(
            command=action,
            action="enable" if action in {"ban", "mute"} else "disable",
            scope="chat",
            target_user_id=target.id,
            parameters={
                "duration": duration,
                "reason": _reason(text, action),
                "target_name": target.full_name,
            },
            source="natural_language",
        ),
        "target": target,
    }


def confirmation_text(intent: CommandIntent) -> str:
    p = dict(intent.parameters)
    action = _ACTIONS.get(intent.command, intent.command)
    duration = p.get("duration")
    duration_text = (
        f" на {duration[0]} {duration[1]}" if duration else " без срока"
    )
    return (
        "⚠️ <b>Требуется подтверждение</b>\n\n"
        f"Действие: <b>{action}</b>{duration_text}\n"
        f"Пользователь: <b>{p.get('target_name', intent.target_user_id)}</b>\n"
        f"Причина: <b>{p.get('reason', 'не указана')}</b>\n\n"
        "Ответьте <code>подтверждаю</code> для выполнения "
        "или <code>отмена</code> для отмены."
    )


def remember(user_id: int, chat_id: int, intent: CommandIntent) -> None:
    _PENDING[_key(user_id, chat_id)] = intent


def pop(user_id: int, chat_id: int):
    return _PENDING.pop(_key(user_id, chat_id), None)


async def request(message: types.Message, text: str):
    if message.chat.type not in {"group", "supergroup"}:
        return False

    role = get_display_role(message.from_user.id)
    parsed = build_intent(message, text)
    if parsed is None:
        return False

    if "error" in parsed:
        if parsed["error"] == "target":
            await message.reply(
                "🎯 Для модерационного действия ответьте на сообщение нужного пользователя. "
                "Я не буду угадывать цель."
            )
        elif parsed["error"] == "duration":
            await message.reply(
                "🕰 Укажите срок явно, например: "
                "<code>замуть его на 30 минут</code>."
            )
        return True

    intent = parsed["intent"]
    if intent.target_user_id == config.owner:
        await message.reply("⛔ Команды администрации не действуют на Основателя без его отдельного разрешения.")
        return True

    decision = evaluate(intent, role, confirmed=False)
    if not decision.allowed:
        await message.reply(f"⛔ {decision.reason}")
        return True

    if message.from_user.id == config.owner or role == "Создатель бота":
        # Founder has already issued the instruction: execute directly.
        return await confirm(message, confirmed=True)

    remember(message.from_user.id, message.chat.id, intent)
    await message.reply(confirmation_text(intent))
    return True


async def confirm(message: types.Message, *, confirmed: bool = False):
    intent = pop(message.from_user.id, message.chat.id)
    if intent is None:
        return False

    role = get_display_role(message.from_user.id)
    decision = evaluate(intent, role, confirmed=confirmed)
    if not decision.allowed:
        await message.reply(f"⛔ {decision.reason}")
        return True

    if message.chat.type not in {"group", "supergroup"}:
        await message.reply("⛔ Модерация доступна только в групповых чатах.")
        return True

    target_id = intent.target_user_id
    if target_id == message.from_user.id:
        await message.reply("⛔ Нельзя применить это действие к самому себе.")
        return True

    try:
        target_member = await message.chat.get_member(target_id)
        if target_member.status in {"creator", "administrator"}:
            await message.reply("⛔ Нельзя применять это действие к администратору чата.")
            return True

        p = dict(intent.parameters)
        duration = p.get("duration")
        until_date = None
        duration_seconds = None
        expires_at = None
        if duration:
            value, unit = duration
            kwargs = {"minutes": value} if unit == "минут" else (
                {"hours": value} if unit == "часов" else {"days": value}
            )
            until_date = timedelta(**kwargs)
            duration_seconds = int(until_date.total_seconds())
            from datetime import datetime, timezone
            expires_at = datetime.now(timezone.utc) + until_date

        if intent.command == "mute":
            await message.bot.restrict_chat_member(
                message.chat.id,
                target_id,
                types.ChatPermissions(can_send_messages=False),
                until_date=until_date,
            )
        elif intent.command == "unmute":
            await message.bot.restrict_chat_member(
                message.chat.id,
                target_id,
                types.ChatPermissions(
                    can_send_messages=True,
                    can_send_other_messages=True,
                    can_add_web_page_previews=True,
                ),
            )
        elif intent.command == "ban":
            await message.bot.ban_chat_member(
                message.chat.id,
                target_id,
                until_date=until_date,
            )
        elif intent.command == "unban":
            await message.bot.unban_chat_member(
                message.chat.id,
                target_id,
                only_if_banned=True,
            )
        else:
            await message.reply("⛔ Неизвестное модерационное действие.")
            return True
    except BadRequest as exc:
        record(
            user_id=message.from_user.id,
            chat_id=message.chat.id,
            command=intent.command,
            scope="chat",
            result="telegram_rejected",
        )
        await message.reply(
            "⚠️ Telegram отклонил действие. "
            f"<code>{type(exc).__name__}</code>"
        )
        return True
    except TelegramAPIError as exc:
        record(
            user_id=message.from_user.id,
            chat_id=message.chat.id,
            command=intent.command,
            scope="chat",
            result="telegram_error",
        )
        await message.reply(
            "⚠️ Не удалось выполнить действие через Telegram. "
            f"<code>{type(exc).__name__}</code>"
        )
        return True

    record(
        user_id=message.from_user.id,
        chat_id=message.chat.id,
        command=intent.command,
        scope="chat",
        result="executed",
    )
    action = _ACTIONS[intent.command]
    target_name = intent.parameters.get("target_name", target_id)

    if duration_seconds and expires_at and intent.command in {"mute", "ban"}:
        schedule(
            chat_id=message.chat.id,
            target_user_id=target_id,
            target_name=target_name,
            actor_user_id=message.from_user.id,
            action=intent.command,
            expires_at=expires_at,
        )
        await notify_issued(
            message.bot,
            chat_id=message.chat.id,
            target_user_id=target_id,
            target_name=target_name,
            action=intent.command,
            duration_seconds=duration_seconds,
            expires_at=expires_at,
        )
    else:
        result_text = f"🔔 <b>Выполнено:</b> {action} <b>{target_name}</b>."
        await notify_action(
            message.bot,
            chat_id=message.chat.id,
            target_user_id=target_id,
            target_name=target_name,
            action=intent.command,
            text=result_text,
        )
    return True
