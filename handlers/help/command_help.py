"""Authoritative /help surface built from the command registry."""

from aiogram import types

from core.command_registry import commands_for_role
from core.permissions import get_user_status
from main import config, dp


_CATEGORY_LABELS = {
    "system": "⚙️ Система",
    "runtime": "🛰 Runtime",
    "information": "📖 Информация",
    "administration": "🛡️ Администрирование",
    "moderation": "🔨 Модерация",
    "chat": "💬 Чат",
    "profile": "👤 Профиль",
    "communication": "✉️ Связь",
}


def _role_for_message(message: types.Message) -> str:
    if message.from_user.id == config.owner:
        return "Основатель"
    status = get_user_status(message.from_user.id)
    return status if status in {
        "Система",
        "Создатель бота",
        "Администратор",
        "Хелпер",
        "Модератор",
    } else "Игрок"


def _format_alias(alias: str) -> str:
    return alias if " " in alias else f"/{alias}"


def render_help(role: str) -> str:
    groups = {}
    for spec in commands_for_role(role):
        groups.setdefault(spec.category, []).append(spec)

    lines = [
        "<b>📚 Актуальные команды Системы</b>",
        f"Роль: <b>{role}</b>",
        "",
        "Ниже только команды, зарегистрированные в текущем коде.",
        "Функции, которых здесь нет, не считаются доступными.",
    ]

    for category, specs in groups.items():
        lines.extend(["", f"<b>{_CATEGORY_LABELS.get(category, category.title())}</b>"])
        for spec in specs:
            aliases = ", ".join(_format_alias(alias) for alias in sorted(spec.aliases))
            description = f" — {spec.description}" if spec.description else ""
            lines.append(f"• <code>{aliases}</code>{description}")

    return "\n".join(lines)


@dp.message_handler(commands=["help", "хелп", "команды"], commands_prefix="/!.")
async def authoritative_help(message: types.Message):
    await message.answer(render_help(_role_for_message(message)))
