"""Typed natural-language command gateway.

The gateway interprets requests, resolves scope, applies policy, and delegates
execution to a registry-backed typed executor. AI never receives executable
Python/SQL/Telegram capabilities.
"""

from base import config
from core.command_models import CommandContext, CommandIntent
from core.command_policy import evaluate
from core.command_registry import resolve_command
from core.runtime_state import set_paused
from services.ai_service import classify_command
from services.audit_service import record

_PENDING = {}


def _pending_key(user_id: int, chat_id: int):
    return user_id, chat_id


def has_pending(user_id: int, chat_id: int) -> bool:
    return _pending_key(user_id, chat_id) in _PENDING


def resolve_scope(prompt: str, default: str = "unknown") -> str:
    """Resolve only explicit chat/global scope markers from natural language."""
    text = " ".join((prompt or "").casefold().replace("ё", "е").split())
    if any(
        marker in text
        for marker in ("везде", "глобально", "во всех чатах", "весь бот", "повсеместно")
    ):
        return "global"
    if any(
        marker in text
        for marker in ("этот чат", "в этом чате", "здесь", "только здесь", "в этом мире")
    ):
        return "chat"
    return default


def _extract_fallback(prompt: str):
    text = " ".join((prompt or "").casefold().replace("ё", "е").split())
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

    return {
        "command": command,
        "action": "enable" if command == "stasis" else "disable",
        "scope": resolve_scope(text),
    }


async def interpret(prompt: str):
    raw = await classify_command(prompt, role="Основатель") or _extract_fallback(prompt)
    if not raw:
        return None

    spec = resolve_command(raw.get("command", ""))
    if spec is None:
        return None

    return {
        "command": spec.key,
        "action": raw.get("action", ""),
        "scope": resolve_scope(prompt, raw.get("scope", "unknown")),
        "source": raw.get("source", "ai"),
    }


def _intent_from_dict(data: dict) -> CommandIntent:
    return CommandIntent(
        command=data.get("command", ""),
        action=data.get("action", ""),
        scope=data.get("scope", "unknown"),
        source=data.get("source", "ai"),
    )


def _execute_runtime(intent: CommandIntent, *, chat_id: int) -> str | None:
    if intent.command not in {"stasis", "awakening"}:
        return None

    set_paused(
        intent.command == "stasis",
        scope=intent.scope,
        chat_id=chat_id,
    )

    if intent.command == "stasis":
        scope_text = (
            "Режим тишины установлен <b>для всего бота</b>."
            if intent.scope == "global"
            else "Режим тишины установлен <b>только в этом чате</b>."
        )
        return (
            "🛰 <b>СТАЗИС АКТИВИРОВАН.</b>\n"
            f"{scope_text}\n"
            "Контур Основателя остаётся активен."
        )

    scope_text = (
        "Глобальный режим тишины снят."
        if intent.scope == "global"
        else "Режим тишины снят <b>только в этом чате</b>."
    )
    return f"⚡ <b>ПРОБУЖДЕНИЕ ЗАВЕРШЕНО.</b>\n{scope_text}"


_TYPED_EXECUTORS = {
    "stasis": _execute_runtime,
    "awakening": _execute_runtime,
}


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
    scope = intent.get("scope", "unknown")
    if scope not in {"chat", "global"}:
        return "🧭 Не удалось определить область выполнения. Уточните: «везде» или «в этом чате»."

    typed_intent = _intent_from_dict(intent)
    decision = evaluate(typed_intent, "Создатель бота", confirmed=confirmed)
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

    executor = _TYPED_EXECUTORS.get(typed_intent.command)
    if executor is None:
        record(
            user_id=user_id,
            chat_id=chat_id,
            command=typed_intent.command or "unknown",
            scope=scope,
            result="unsupported",
        )
        return "⛔ Для этой зарегистрированной команды ещё нет typed executor."

    result = executor(typed_intent, chat_id=chat_id)
    if result is None:
        return None

    record(
        user_id=user_id,
        chat_id=chat_id,
        command=typed_intent.command,
        scope=scope,
        result="executed",
    )
    return result


def remember(user_id: int, chat_id: int, intent: dict) -> None:
    _PENDING[_pending_key(user_id, chat_id)] = dict(intent)


def pop_pending(user_id: int, chat_id: int):
    return _PENDING.pop(_pending_key(user_id, chat_id), None)


def pending_prompt() -> str:
    return (
        "🧭 <b>Уточните область выполнения.</b>\n\n"
        "🌐 <b>Везде</b> — применить к боту целиком\n"
        "💬 <b>В этом чате</b> — применить только к текущему миру\n\n"
        "Ответьте: <code>везде</code> или <code>в этом чате</code>."
    )


_CANCEL_PHRASES = {
    "отмени последний запрос", "отменить последний запрос", "отмени", "отмена", "отменить",
    "отставить", "не трожь", "забудь", "забудь последний запрос", "не надо", "стоп",
}


def is_cancel_request(prompt: str) -> bool:
    text = " ".join((prompt or "").casefold().replace("ё", "е").split())
    return text in _CANCEL_PHRASES


def cancel_pending(user_id: int, chat_id: int) -> bool:
    removed = _PENDING.pop(_pending_key(user_id, chat_id), None)
    return removed is not None
