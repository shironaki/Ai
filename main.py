import asyncio
import logging
import random
import re
import sqlite3
import time
from random import randint
from asyncio import sleep
from datetime import datetime, timedelta
from time import gmtime, localtime, strftime

import aiogram
import psutil
import requests
from aiogram import Bot, Dispatcher, executor, types
from aiogram.contrib.fsm_storage.memory import MemoryStorage
from aiogram.dispatcher import FSMContext
from aiogram.dispatcher.handler import current_handler
from aiogram.dispatcher.filters.state import State, StatesGroup
from aiogram.dispatcher.middlewares import BaseMiddleware
from aiogram.types import (
    ContentType,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    Message,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
)
from aiogram.utils.markdown import hbold, hcode

from base import config, chats, users

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    force=True,
)
log = logging.getLogger(__name__)

if not config.bot_heart:
    raise RuntimeError("Укажите токен бота в переменной окружения BOT_TOKEN.")

bot = Bot(token=config.bot_heart, parse_mode=types.ParseMode.HTML)
dp = Dispatcher(bot, storage=MemoryStorage())


class MyStatesGroup(StatesGroup):
    START_STATE = State()
    SECOND_STATE = State()


# Register the core start/registration handlers first.
# handlers.chat_groups contains /start and the final catch-all echo handler.
# It must be imported before other handler modules so /start is never shadowed.
import handlers.chat_groups  # noqa: E402,F401

# Register the remaining handlers after the core registration handler.
import handlers.admin  # noqa: E402,F401
import handlers.help  # noqa: E402,F401
from handlers.help.help import ThrottlingMiddleware  # noqa: E402
import aboute  # noqa: E402,F401

dp.middleware.setup(ThrottlingMiddleware())


class ActivityLoggingMiddleware(BaseMiddleware):
    async def on_pre_process_update(self, update, data):
        if update.message:
            log.info("Telegram update received: message, chat_type=%s", update.message.chat.type)
        elif update.callback_query:
            log.info("Telegram update received: callback_query")
        else:
            log.info("Telegram update received")

    async def on_process_message(self, message, data):
        handler = current_handler.get()
        if handler:
            log.info("Dispatching message to handler=%s", handler.__name__)
        else:
            log.warning("No message handler selected")


dp.middleware.setup(ActivityLoggingMiddleware())


@dp.errors_handler()
async def log_update_error(update, exception):
    log.error(
        "Unhandled error while processing update_id=%s",
        getattr(update, "update_id", "unknown"),
        exc_info=(type(exception), exception, exception.__traceback__),
    )
    message = getattr(update, "message", None)
    if message:
        try:
            await message.answer("Произошла ошибка при обработке сообщения. Ошибка записана в консоль.")
        except Exception:
            log.exception("Could not send error notice to the user")
    return True


async def on_startup(dispatcher):
    bot_info = await bot.get_me()
    log.info("Бот @%s подключён и ожидает сообщения", bot_info.username)


if __name__ == "__main__":
    log.info("Starting the bot...")
    executor.start_polling(dp, skip_updates=True, on_startup=on_startup)
