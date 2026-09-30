"""Single source of truth for the non-game user command surface.

Legacy game commands are deliberately excluded. The game system will be rebuilt
later as an isolated module with its own registry and economy model.
"""

from dataclasses import dataclass
from typing import FrozenSet


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
    CommandSpec("start", frozenset({"start"}), "system", "Игрок", description="регистрация и запуск"),
    CommandSpec("help", frozenset({"help", "хелп", "команды"}), "information", "Игрок", description="список зарегистрированных команд"),
    CommandSpec("ai", frozenset({"ai", "аи"}), "information", "Игрок", description="обращение к Аи"),
    CommandSpec("ai_diagnostic", frozenset({"aidiag"}), "system", "Создатель бота"),
    CommandSpec("logs", frozenset({"logs"}), "system", "Создатель бота", "global"),
    CommandSpec("debug", frozenset({"debug"}), "system", "Создатель бота", "global"),
    CommandSpec("stasis", frozenset({"stasis", "стазис"}), "runtime", "Создатель бота", "both"),
    CommandSpec("awakening", frozenset({"awakening", "пробуждение"}), "runtime", "Создатель бота", "both"),
    CommandSpec("setstatus", frozenset({"setstatus"}), "administration", "Администратор"),
    CommandSpec("deluser", frozenset({"deluser"}), "administration", "Администратор", "chat", True, True),
    CommandSpec("mute", frozenset({"мут", "mute", "дебафф"}), "moderation", "Модератор", "chat", True, True),
    CommandSpec("unmute", frozenset({"андебафф", "размут", "unmute"}), "moderation", "Модератор"),
    CommandSpec("ban", frozenset({"аннигилировать", "ban"}), "moderation", "Модератор", "chat", True, True),
    CommandSpec("unban", frozenset({"воскресить", "unban"}), "moderation", "Модератор"),
    CommandSpec("set_barrier", frozenset({"установить барьер"}), "moderation", "Модератор"),
    CommandSpec("remove_barrier", frozenset({"снять барьер"}), "moderation", "Модератор"),
    CommandSpec("welcome", frozenset({"welcome", "приветствие"}), "chat", "Модератор"),
    CommandSpec("profile", frozenset({"инфа", "профиль"}), "information", "Игрок", description="показать профиль"),
    CommandSpec("chatinfo", frozenset({"chatinfo", "чатинфо"}), "information", "Игрок", description="информация о текущем чате"),
    CommandSpec("dev", frozenset({"dev", "дев"}), "system", "Система"),
    CommandSpec("report", frozenset({"r", "report"}), "communication", "Игрок"),
    CommandSpec("question", frozenset({"обращение", "q", "вопрос"}), "communication", "Игрок"),
)


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


def is_legacy_game_alias(value: str) -> bool:
    text = normalize_alias(value)
    return text in {
        "выбери", "слоты", "казино", "куб", "дартс", "боул", "фут",
        "бас", "баскет", "охота", "пополнить счёт", "пополнить счет",
        "снять со счёта", "снять со счета",
    }


ROLE_ORDER = {
    "Игрок": 10,
    "Модератор": 20,
    "Хелпер": 30,
    "Администратор": 40,
    "Создатель бота": 50,
    "Основатель": 50,
    "Система": 60,
}


def commands_for_role(role: str):
    """Return enabled commands the role is allowed to use."""
    actual_level = ROLE_ORDER.get(role, ROLE_ORDER["Игрок"])
    return tuple(
        spec
        for spec in COMMAND_REGISTRY
        if spec.enabled and ROLE_ORDER.get(spec.min_role, 999) <= actual_level
    )


def command_catalog(role: str) -> str:
    """Build a compact, model-facing catalog from the authoritative registry."""
    lines = []
    for spec in commands_for_role(role):
        aliases = ", ".join(
            f"/{alias}" if " " not in alias else alias
            for alias in sorted(spec.aliases)
        )
        description = f" — {spec.description}" if spec.description else ""
        lines.append(f"- {aliases}{description}")
    return "\n".join(lines) or "- Нет зарегистрированных команд."
