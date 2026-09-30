"""Deterministic, safe routing for natural-language assistant requests.

This module deliberately handles only informational/read-only requests.
It never executes arbitrary SQL, Python, shell commands, or Telegram API calls.
"""

from __future__ import annotations

import re


_DIRECT_ACTIONS = (
    "help",
    "profile",
    "chatinfo",
    "system_stats",
    "runtime",
    "debug",
    "ai_diagnostic",
    "logs",
    "system_info",
    "unsupported_settings",
)


def _normalize(prompt: str) -> str:
    text = (prompt or "").casefold().replace("ё", "е")
    text = re.sub(r"[^ws/.-]+", " ", text, flags=re.UNICODE)
    return re.sub(r"s+", " ", text).strip()


def _has_any(text: str, phrases: tuple[str, ...]) -> bool:
    return any(phrase in text for phrase in phrases)


def detect_direct_action(prompt: str) -> str | None:
    """Return a safe direct action for a known informational request."""
    text = _normalize(prompt)
    if not text:
        return None

    if _has_any(text, (
        "доступные мне команды", "покажи доступные команды",
        "покажи мои команды", "список моих команд",
        "какие у меня команды", "какие команды мне доступны",
        "какие команды доступны", "что я могу использовать",
        "что мне доступно", "список команд",
    )):
        return "help"

    if "settings" in text or "настройки" in text:
        return "unsupported_settings"

    if _has_any(text, (
        "выведи логи", "покажи логи", "покажи журнал",
        "выведи журнал", "покажи лог", "выведи лог",
        "журнал событий", "журнал бота", "логи бота",
        "лог бота", "последние логи",
    )) or re.search(r"/logs(?:s|$)", text):
        return "logs"

    if (
        "статистик" in text and _has_any(text, ("систем", "бота", "бот "))
    ) or _has_any(text, (
        "информация о системе", "информацию о системе",
        "данные системы", "данные о системе",
        "сколько пользователей", "сколько зарегистрированных пользователей",
        "сколько чатов", "сколько зарегистрированных чатов",
        "сколько юзеров",
    )):
        return "system_stats"

    if _has_any(text, (
        "о системе расскажи", "расскажи о системе",
        "расскажи про систему", "расскажи о боте",
        "расскажи про бота", "что за система",
        "что это за система", "что ты умеешь",
        "что умеет бот", "возможности системы",
        "возможности бота", "информация о боте",
        "информацию о боте", "информация о системе",
        "информацию о системе",
    )):
        return "system_info"

    if _has_any(text, (
        "статистика этого чата", "статистику этого чата",
        "статистика текущего чата", "статистику текущего чата",
        "статистика чата", "статистику чата",
        "статистика этого мира", "статистику этого мира",
        "информация о чате", "информацию о чате",
        "информация об этом чате", "информацию об этом чате",
        "инфо чата", "данные чата", "чатинфо",
    )) or re.search(r"/chatinfo(?:s|$)", text):
        return "chatinfo"

    if _has_any(text, (
        "мой профиль", "профиль мой", "мою статистику",
        "моя статистика", "мои показатели", "мои данные",
        "покажи профиль", "профиль покажи", "покажи мои данные",
        "покажи мои показатели", "данные обо мне",
        "информация обо мне", "информацию обо мне",
        "кто я", "профиль пользователя",
    )):
        return "profile"

    return None


def direct_actions() -> tuple[str, ...]:
    return _DIRECT_ACTIONS
