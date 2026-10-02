"""Telegram adapter for the authoritative command help."""

from aiogram import types

from base import config
from core.command_help import render_help
from core.permissions import get_user_status
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
    await message.answer(render_help(_role_for_message(message)))
