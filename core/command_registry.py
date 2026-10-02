"""Authoritative non-game command surface.

Human-facing aliases are intentionally compact. The admin panel is the primary
UI; direct aliases remain compatibility entry points and are not advertised
as the main interface. Game commands are excluded until the game subsystem is
re-enabled.
"""

from dataclasses import dataclass
from typing import FrozenSet

from config.role_config import ROLE_ORDER


@dataclass(frozen=True)
class CommandSpec:
    key: str
    aliases: FrozenSet[str]
    category: str
    min_role: str
    scope: str = "chat"
    destructive: bool = False
    confirmation: bool = False
    enabled: bool = True
    description: str = ""


COMMAND_REGISTRY = (
    CommandSpec("help", frozenset({"help"}), "system", "Пользователь", description="панель и справка"),
    CommandSpec("ai", frozenset({"ai", "аи"}), "system", "Пользователь", description="обращение к Аи"),
    CommandSpec("start", frozenset({"start"}), "system", "Пользователь", "private", description="первичный запуск в личном чате"),
    CommandSpec("ai_diagnostic", frozenset({"aidiag"}), "system", "Создатель бота"),
    CommandSpec("logs", frozenset({"logs"}), "system", "Создатель бота", "global"),
    CommandSpec("debug", frozenset({"debug"}), "system", "Создатель бота", "global"),
    CommandSpec("stasis", frozenset({"stasis", "стазис"}), "runtime", "Создатель бота", "both"),
    CommandSpec("awakening", frozenset({"awakening", "пробуждение"}), "runtime", "Создатель бота", "both"),
    CommandSpec("moderation", frozenset({"модерация"}), "administration", "Модератор"),
    CommandSpec("silence", frozenset({"тишина"}), "moderation", "Модератор", "chat", True, True),
    CommandSpec("welcome", frozenset({"приветствие"}), "administration", "Модератор", "chat", True, True),
    CommandSpec("mute", frozenset({"мут", "mute", "дебафф"}), "moderation", "Модератор", "chat", True, True),
    CommandSpec("unmute", frozenset({"размут", "unmute", "андебафф"}), "moderation", "Модератор", "chat", True, True),
    CommandSpec("ban", frozenset({"ban", "аннигилировать"}), "moderation", "Модератор", "chat", True, True),
    CommandSpec("unban", frozenset({"unban", "воскресить"}), "moderation", "Модератор", "chat", True, True),
    CommandSpec("setstatus", frozenset({"setstatus", "выдай статус"}), "administration", "Администратор", "chat", True, True),
    CommandSpec("info", frozenset({"инфо", "инфа"}), "information", "Пользователь"),
    CommandSpec("chatinfo", frozenset({"chatinfo", "чатинфо"}), "information", "Пользователь"),
    CommandSpec("report", frozenset({"report", "репорт"}), "communication", "Пользователь"),
    CommandSpec("cancel", frozenset({"cancel", "отмена"}), "control", "Пользователь", description="отменить текущее действие"),
    CommandSpec("issue_list", frozenset({"список меток"}), "qa", "Создатель бота", "global", description="показать состояние QA-меток"),
)


def is_legacy_game_alias(value: str) -> bool:
    return normalize_alias(value) in {
        "выбери", "слоты", "казино", "куб", "дартс", "боул", "фут",
        "бас", "баскет", "охота", "пополнить счёт", "пополнить счет",
        "снять со счёта", "снять со счета", "setstavka", "setdick",
    }


def _build_alias_index():
    index = {}
    for spec in COMMAND_REGISTRY:
        for alias in spec.aliases:
            normalized = alias.casefold().strip()
            if normalized in index:
                raise ValueError(f"Duplicate command alias: {alias}")
            index[normalized] = spec
    return index


ALIAS_INDEX = _build_alias_index()


def normalize_alias(value: str) -> str:
    value = value.strip()
    if value.startswith("/"):
        value = value[1:]
    return value.casefold()


def resolve_command(value: str):
    return ALIAS_INDEX.get(normalize_alias(value))


def commands_for_category(category: str):
    return tuple(spec for spec in COMMAND_REGISTRY if spec.category == category)


def commands_for_role(role: str):
    actual_level = ROLE_ORDER.get(role, ROLE_ORDER["Пользователь"])
    return tuple(
        spec
        for spec in COMMAND_REGISTRY
        if spec.enabled and ROLE_ORDER.get(spec.min_role, 999) <= actual_level
    )


def command_catalog(role: str) -> str:
    lines = []
    for spec in commands_for_role(role):
        aliases = ", ".join(
            f"/{alias}" if " " not in alias else alias
            for alias in sorted(spec.aliases)
        )
        description = f" — {spec.description}" if spec.description else ""
        lines.append(f"- {aliases}{description}")
    return "\n".join(lines) or "- Нет доступных функций."
