"""Deterministic, safe direct actions for natural-language assistant requests.

This module only routes a small set of read-only/informational requests.
It never executes arbitrary commands, SQL, Python, or Telegram methods.
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
    text = re.sub(r"[^\w\s/.-]+", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def detect_direct_action(prompt: str) -> str | None:
    """Return a safe direct action for a known informational request."""
    text = _normalize(prompt)
    if not text:
        return None

    if any(
        phrase in text
        for phrase in (
            "доступные мне команды",
            "покажи доступные команды",
            "покажи мои команды",
            "список моих команд",
            "какие у меня команды",
            "какие команды мне доступны",
        )
    ):
        return "help"

    if "settings" in text or "настройки" in text:
        return "unsupported_settings"

    if any(
        phrase in text
        for phrase in (
            "выведи логи",
            "покажи логи",
            "покажи журнал",
            "выведи журнал",
            "журнал событий",
            "логи бота",
            "лог бота",
        )
    ) or re.search(r"/logs(?:\\s|$)", text):
        return "logs"

    if any(
        phrase in text
        for phrase in (
            "о системе расскажи",
            "расскажи о системе",
            "расскажи про систему",
            "что за система",
            "информация о системе",
            "информацию о системе",
            "расскажи о боте",
            "что ты умеешь",
            "возможности системы",
        )
    ):
        return "system_info"

    if any(
        phrase in text
        for phrase in (
            "аи диагностику",
            "ai диагностику",
            "диагностику аи",
            "диагностику ai",
            "диагностику искусственного интеллекта",
        )
    ) or "/aidiag" in text:
        return "ai_diagnostic"

    if "дебаг" in text or "debug" in text or "/debug" in text:
        return "debug"

    if any(
        phrase in text
        for phrase in (
            "стазис",
            "режим тишины",
            "состояние бота",
            "бот сейчас активен",
            "бот сейчас молчит",
        )
    ):
        return "runtime"

    if (
        "статистик" in text
        and ("систем" in text or "бот" in text)
    ) or any(
        phrase in text
        for phrase in (
            "информация о системе",
            "информацию о системе",
            "данные системы",
            "сколько пользователей",
            "сколько чатов",
            "сколько юзеров",
        )
    ):
        return "system_stats"

    if any(
        phrase in text
        for phrase in (
            "статистика этого чата",
            "статистику этого чата",
            "статистика чата",
            "статистику чата",
            "информация о чате",
            "информацию о чате",
            "инфо чата",
            "данные чата",
            "чатинфо",
            "/chatinfo",
        )
    ):
        return "chatinfo"

    # Handle natural Russian word order: "профиль мой", "покажи мой профиль",
    # "покажи мою статистику", "мои данные", etc.
    if any(
        phrase in text
        for phrase in (
            "мой профиль",
            "профиль мой",
            "мою статистику",
            "моя статистика",
            "мои данные",
            "покажи профиль",
            "профиль покажи",
            "покажи мои данные",
            "данные обо мне",
            "кто я",
            "профиль пользователя",
        )
    ):
        return "profile"

    return None


def direct_actions() -> tuple[str, ...]:
    return _DIRECT_ACTIONS
