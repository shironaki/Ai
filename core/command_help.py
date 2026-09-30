"""Pure command-help rendering.

No Telegram runtime or bot token is required here.
"""

from core.command_registry import commands_for_role


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
