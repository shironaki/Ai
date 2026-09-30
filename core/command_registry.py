"""Single source of truth for user-facing bot commands.

This registry intentionally excludes the legacy game commands. The game system
will be rebuilt as a separate module later and must not leak into the core
administration/AI command surface.
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


COMMAND_REGISTRY = (
    # Core / system
    CommandSpec("start", frozenset({"start"}), "system", "Игрок", "chat"),
    CommandSpec("help", frozenset({"help", "хелп", "команды"}), "information", "Игрок"),
    CommandSpec("ai", frozenset({"ai", "аи"}), "information", "Игрок"),
    CommandSpec("ai_diagnostic", frozenset({"aidiag"}), "system", "Создатель бота"),
    CommandSpec("logs", frozenset({"logs"}), "system", "Создатель бота", "global"),
    CommandSpec("debug", frozenset({"debug"}), "system", "Создатель бота", "global"),

    # Founder / runtime
    CommandSpec("stasis", frozenset({"stasis", "стазис"}), "runtime", "Создатель бота", "chat"),
    CommandSpec("awakening", frozenset({"awakening", "пробуждение"}), "runtime", "Создатель бота", "chat"),

    # Administration
    CommandSpec("setstatus", frozenset({"setstatus"}), "administration", "Администратор", "chat"),
    CommandSpec("deluser", frozenset({"deluser"}), "administration", "Администратор", "chat", True, True),
    CommandSpec("setbal", frozenset({"setbal"}), "administration", "Администратор", "chat", True, True),

    # Moderation
    CommandSpec("mute", frozenset({"мут", "mute", "дебафф"}), "moderation", "Модератор", "chat", True, True),
    CommandSpec("unmute", frozenset({"андебафф", "размут", "unmute"}), "moderation", "Модератор"),
    CommandSpec("ban", frozenset({"аннигилировать", "ban"}), "moderation", "Модератор", "chat", True, True),
    CommandSpec("unban", frozenset({"воскресить", "unban"}), "moderation", "Модератор"),
    CommandSpec("set_barrier", frozenset({"установить барьер"}), "moderation", "Модератор"),
    CommandSpec("remove_barrier", frozenset({"снять барьер"}), "moderation", "Модератор"),

    # Chat administration
    CommandSpec("welcome", frozenset({"welcome", "приветствие"}), "chat", "Модератор"),
    CommandSpec("games_enable", frozenset({"разрешить игры"}), "chat", "Модератор"),
    CommandSpec("games_disable", frozenset({"запретить игры"}), "chat", "Модератор"),

    # Information / profile
    CommandSpec("profile", frozenset({"инфа", "профиль"}), "information", "Игрок"),
    CommandSpec("chatinfo", frozenset({"chatinfo", "чатинфо"}), "information", "Игрок"),
    CommandSpec("stats", frozenset({"стата"}), "information", "Игрок"),
    CommandSpec("info", frozenset({"инфо"}), "information", "Игрок"),
    CommandSpec("rules", frozenset({"правила", "rules"}), "information", "Игрок"),
    CommandSpec("statuses", frozenset({"статусы"}), "information", "Игрок"),
    CommandSpec("my_games", frozenset({"мои игры"}), "information", "Игрок"),
    CommandSpec("name", frozenset({"name"}), "profile", "Игрок"),
    CommandSpec("bio", frozenset({"bio", "био"}), "profile", "Игрок"),
    CommandSpec("rp", frozenset({"rp"}), "profile", "Игрок"),
    CommandSpec("dev", frozenset({"dev", "дев"}), "system", "Система", "chat"),

    # User communication
    CommandSpec("report", frozenset({"r", "report"}), "communication", "Игрок"),
    CommandSpec("question", frozenset({"обращение", "q", "вопрос"}), "communication", "Игрок"),

    # Economy / legacy non-game commands
    CommandSpec("balance", frozenset({"б", "баланс", "мои 💰", "мой 💰", "💰"}), "economy", "Игрок"),
    CommandSpec("top_balance", frozenset({"топ б", "богачи", "топ 💰"}), "economy", "Игрок"),
    CommandSpec("top_players", frozenset({"топ и", "топ игроков"}), "economy", "Игрок"),
    CommandSpec("set_bet", frozenset({"setstavka"}), "economy", "Игрок"),
    CommandSpec("set_dick", frozenset({"setdick"}), "economy", "Игрок"),

    # Broadcast / developer UI
    CommandSpec("broadcast_users", frozenset({"rassilka"}), "system", "Система", "global", True, True),
    CommandSpec("broadcast_chats", frozenset({"chat_rassilka"}), "system", "Система", "global", True, True),
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
