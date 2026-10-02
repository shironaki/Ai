"""Telegram adapter for the authoritative command help."""

from aiogram import types
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from base import config
from core.command_help import render_help
from core.permissions import get_user_status, has_moderator_role
from core.identity import is_owner
from main import dp


def _role_for_message(message: types.Message) -> str:
    if message.from_user.id == config.owner:
        return "Основатель"
    status = get_user_status(message.from_user.id)
    if status in {
        "Система",
        "Создатель бота",
        "Администратор",
        "Хелпер",
        "Модератор",
    }:
        return status
    return "Пользователь"


@dp.message_handler(commands=["help", "хелп", "команды"], commands_prefix="/!.")
async def authoritative_help(message: types.Message):
    role = _role_for_message(message)
    menu = InlineKeyboardMarkup(row_width=2)
    menu.add(
        InlineKeyboardButton("🧠 Аи", callback_data="help:ai"),
        InlineKeyboardButton("ℹ️ Информация", callback_data="panel:info"),
    )
    menu.add(InlineKeyboardButton("📬 Репорт", callback_data="help:report"))
    if is_owner(message.from_user.id) or has_moderator_role(message.from_user.id):
        menu.add(InlineKeyboardButton("🛠 Панель", callback_data="panel:root"))
    await message.answer(
        "<b>📖 СИСТЕМА «АИ»</b>\n\n"
        f"Ваш уровень: <b>{role}</b>\n"
        "Основной интерфейс — кнопки и прямое обращение к «Аи» или «Система».\n"
        "Служебные slash-команды не являются основным пользовательским интерфейсом.",
        reply_markup=menu,
    )


@dp.callback_query_handler(lambda c: c.data == "help:ai")
async def help_ai(call: types.CallbackQuery):
    await call.message.answer("🧠 Обратитесь ко мне: «Аи, ...» или «Система, ...».")
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "help:report")
async def help_report(call: types.CallbackQuery):
    await call.message.answer(
        "📬 Репорт — для жалоб, обращений и вопросов к администрации. "
        "Технические поломки отмечаются отдельно как QA-метки."
    )
    await call.answer()
