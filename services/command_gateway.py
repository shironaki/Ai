"""Founder natural-language gateway.

The gateway interprets requests, but policy and execution remain separate.
AI never receives an executable Python/SQL capability.
"""

from base import config
from core.command_models import CommandContext, CommandIntent
from core.command_policy import evaluate
from core.runtime_state import set_paused
from services.ai_service import classify_command
from services.audit_service import record

_PENDING = {}


def has_pending(user_id: int) -> bool:
    return user_id in _PENDING


def _extract_fallback(prompt: str):
    text = prompt.lower().replace("ё", "е")
    stasis_words = ("стазис", "стазиз", "режим тишины", "тишину")
    awakening_words = (
        "пробуждение", "пробуди", "разбуди", "выключи стазис", "отмени стазис"
    )
    if any(word in text for word in stasis_words) and any(
        word in text for word in ("включ", "актив", "установ", "введ")
    ):
        command = "stasis"
    elif any(word in text for word in awakening_words):
        command = "awakening"
    else:
        return None

    scope = "global" if any(
        word in text for word in (
            "везде", "глобально", "всех чат", "весь бот", "повсеместно"
        )
    ) else "unknown"
    if any(word in text for word in (
        "этот чат", "здесь", "в этом чате", "только здесь", "этом мире"
    )):
        scope = "chat"

    return {
        "command": command,
        "action": "enable" if command == "stasis" else "disable",
        "scope": scope,
    }


async def interpret(prompt: str):
    return await classify_command(prompt, role="Основатель") or _extract_fallback(prompt)


def _intent_from_dict(data: dict) -> CommandIntent:
    return CommandIntent(
        command=data.get("command", ""),
        action=data.get("action", ""),
        scope=data.get("scope", "chat"),
        source="ai",
    )


async def execute(
    user_id: int,
    chat_id: int,
    intent: dict,
    *,
    confirmed: bool = False,
):
    if user_id != config.owner:
        return "⛔ Командный контур Основателя недоступен для этой роли."

    command = intent.get("command")
    scope = intent.get("scope")
    if scope not in {"chat", "global"}:
        return None

    context = CommandContext(
        user_id=user_id,
        chat_id=chat_id,
        role="Создатель бота",
        source=intent.get("source", "ai"),
    )
    decision = evaluate(_intent_from_dict(intent), context.role, confirmed=confirmed)
    if not decision.allowed:
        record(
            user_id=user_id,
            chat_id=chat_id,
            command=command or "unknown",
            scope=scope,
            result="denied",
        )
        return f"⛔ {decision.reason}"

    if decision.requires_confirmation:
        return "⚠️ Для этого действия требуется явное подтверждение."

    if command not in {"stasis", "awakening"}:
        return None

    set_paused(command == "stasis", scope=scope, chat_id=chat_id)
    result = (
        "🛰 <b>СТАЗИС АКТИВИРОВАН.</b>\n"
        + (
            "Режим тишины установлен <b>для всего бота</b>."
            if scope == "global"
            else "Режим тишины установлен <b>только в этом чате</b>."
        )
        + "\nКонтур Основателя остаётся активен."
        if command == "stasis"
        else (
            "⚡ <b>ПРОБУЖДЕНИЕ ЗАВЕРШЕНО.</b>\n"
            + (
                "Глобальный режим тишины снят."
                if scope == "global"
                else "Режим тишины снят <b>только в этом чате</b>."
            )
        )
    )
    record(
        user_id=user_id,
        chat_id=chat_id,
        command=command,
        scope=scope,
        result="executed",
    )
    return result


def remember(user_id: int, intent: dict) -> None:
    _PENDING[user_id] = intent


def pop_pending(user_id: int):
    return _PENDING.pop(user_id, None)


def pending_prompt() -> str:
    return (
        "🧭 <b>Уточните область выполнения.</b>\n\n"
        "🌐 <b>Везде</b> — применить к боту целиком\n"
        "💬 <b>В этом чате</b> — применить только к текущему миру\n\n"
        "Ответьте: <code>везде</code> или <code>в этом чате</code>."
    )
