"""Founder-only natural-language command gateway."""

from base import config
from core.runtime_state import is_paused, set_paused
from services.ai_service import classify_command

_PENDING = {}


def has_pending(user_id: int) -> bool:
    return user_id in _PENDING


def _scope_label(scope: str) -> str:
    return "этот чат" if scope == "chat" else "весь бот"


def _extract_fallback(prompt: str):
    text = prompt.lower().replace("ё", "е")
    stasis_words = ("стазис", "стазиз", "режим тишины", "тишину")
    awakening_words = ("пробуждение", "пробуди", "разбуди", "выключи стазис", "отмени стазис")
    if any(word in text for word in stasis_words) and any(word in text for word in ("включ", "актив", "установ", "введ", "стазис")):
        command = "stasis"
    elif any(word in text for word in awakening_words):
        command = "awakening"
    else:
        return None
    scope = "global" if any(word in text for word in ("везде", "глобально", "всех чат", "весь бот", "повсеместно")) else "unknown"
    if any(word in text for word in ("этот чат", "здесь", "в этом чате", "только здесь", "этом мире")):
        scope = "chat"
    return {"command": command, "action": "enable" if command == "stasis" else "disable", "scope": scope}


async def interpret(prompt: str):
    intent = await classify_command(prompt, role="Основатель")
    return intent or _extract_fallback(prompt)


async def execute(user_id: int, chat_id: int, intent: dict):
    if user_id != config.owner:
        return "⛔ Командный контур Основателя недоступен для этой роли."

    command = intent.get("command")
    scope = intent.get("scope")
    if command not in {"stasis", "awakening"} or scope not in {"chat", "global"}:
        return None

    enabled = command == "stasis"
    set_paused(enabled, scope=scope, chat_id=chat_id)
    if command == "stasis":
        if scope == "global":
            return "🛰 <b>СТАЗИС АКТИВИРОВАН.</b>\nРежим тишины установлен <b>для всего бота</b>. Контур Основателя остаётся активен."
        return "🛰 <b>СТАЗИС АКТИВИРОВАН.</b>\nРежим тишины установлен <b>только в этом чате</b>. Контур Основателя остаётся активен."
    if scope == "global":
        return "⚡ <b>ПРОБУЖДЕНИЕ ЗАВЕРШЕНО.</b>\nГлобальный режим тишины снят. Бот снова принимает сигналы."
    return "⚡ <b>ПРОБУЖДЕНИЕ ЗАВЕРШЕНО.</b>\nРежим тишины снят <b>только в этом чате</b>."


def remember(user_id: int, intent: dict) -> None:
    _PENDING[user_id] = intent


def pop_pending(user_id: int):
    return _PENDING.pop(user_id, None)


def pending_prompt() -> str:
    return ("🧭 <b>Уточните область выполнения.</b>\n\n"
            "🌐 <b>Везде</b> — применить к боту целиком\n"
            "💬 <b>В этом чате</b> — применить только к текущему миру\n\n"
            "Ответьте: <code>везде</code> или <code>в этом чате</code>.")