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


class ChatRegistrationMiddleware(BaseMiddleware):
    """Ensure group chats exist in chats.db before command handlers run."""

    async def on_pre_process_message(self, message, data):
        if message.chat.type not in ("group", "supergroup"):
            return

        chat_id = message.chat.id
        exists = chats.cursor.execute(
            "SELECT chat_id FROM chats WHERE chat_id = ?",
            (chat_id,),
        ).fetchone()
        if exists:
            return

        chats.cursor.execute(
            "INSERT INTO chats VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                chat_id,
                message.chat.title or "Без названия",
                message.chat.username,
                "разрешено",
                0,
                datetime.now().strftime("%d.%m.%Y"),
                "Обычный",
                "Отсутствуют",
                "да",
                "Не указаны!",
                "Добро пожаловать в новый мир!",
            ),
        )
        chats.connect.commit()
        log.info("Registered new chat id=%s title=%s", chat_id, message.chat.title)


dp.middleware.setup(ChatRegistrationMiddleware())


# Diagnostic handler: proves that aiogram is dispatching /debug and /start.
# It is intentionally registered before the imported catch-all handlers.
@dp.message_handler(commands=['debug'])
async def debug_dispatch(message: types.Message):
    await message.answer("DEBUG: обработчик сообщений работает.")


# Independent /start handler.
# We intentionally match the raw Telegram command here instead of relying on
# aiogram's command filter or handlers/chat_groups.py. This gives /start a
# guaranteed entry point while keeping the legacy handler available.
@dp.message_handler(
    lambda message: bool(
        message.text
        and re.match(r"^/start(?:@[A-Za-z0-9_]+)?(?:\s|$)", message.text, re.IGNORECASE)
    )
)
async def start_dispatch(message: types.Message):
    start_text = "<b>Система 'Аи' приветствует Вас!</b>"
    await message.answer(start_text)

    try:
        user_id = message.from_user.id
        row = users.cursor.execute(
            "SELECT id FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

        if row:
            log.info("/start: existing user id=%s", user_id)
            return

        now = datetime.now()
        regdata = now.strftime("%d.%m.%Y")
        ttime = (now - timedelta(seconds=18000)).strftime("%H:%M:%S")
        first_name = message.from_user.first_name or "Игрок"
        username = message.from_user.username

        users.cursor.execute(
            "INSERT INTO users VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                user_id,
                first_name,
                username,
                "Игрок",
                0,
                10,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                regdata,
                ttime,
                0,
                "Не установлено...",
                0,
                1,
                "00:000:00",
                0,
            ),
        )
        users.connect.commit()
        log.info("/start: registered new user id=%s username=%s", user_id, username)

        if config.owner:
            try:
                await bot.send_message(
                    config.owner,
                    "Новый игрок!\n"
                    f"Ник: {first_name}\n"
                    f"ID: {user_id}\n"
                    f"Юзернейм: @{username or 'нет'}\n"
                    "Зарегистрировался(ась) в л/с.",
                )
            except Exception:
                log.exception("Could not notify owner about new /start registration")

    except Exception:
        log.exception("Error during /start registration for user_id=%s", message.from_user.id)

    # Preserve the original referral/deep-link behavior: /start <user_id>.
    args = (message.get_args() or "").strip()
    if args.isdigit():
        try:
            inviter_id = int(args)
            if inviter_id != message.from_user.id:
                users.cursor.execute(
                    "UPDATE users SET invited_users = invited_users + 1 WHERE id = ?",
                    (inviter_id,),
                )
                users.connect.commit()
                await bot.send_message(
                    inviter_id,
                    "❤️ Кто-то только что зарегистрировался по твоей реферальной ссылке!",
                )
        except Exception:
            log.exception("Could not process /start referral payload=%s", args)


def log_registered_handlers():
    handlers = getattr(dp.message_handlers, "handlers", [])
    log.info("Registered message handlers: %d", len(handlers))
    for index, handler in enumerate(handlers):
        callback = getattr(handler, "callback", None)
        log.info("Handler[%d]: %s", index, getattr(callback, "__name__", repr(callback)))


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


BOT_COMMANDS = [
    types.BotCommand("start", "начать работу"),
    types.BotCommand("help", "список команд"),
    types.BotCommand("work", "пойти на работу"),
    types.BotCommand("bio", "установить био"),
    types.BotCommand("name", "сменить ник"),
    types.BotCommand("rp", "ролевое действие"),
    types.BotCommand("dick", "увеличить параметр"),
    types.BotCommand("setstavka", "изменить ставку"),
    types.BotCommand("setdick", "изменить параметр"),
    types.BotCommand("dev", "панель разработчика"),
    types.BotCommand("chatinfo", "информация о чате"),
    types.BotCommand("report", "пожаловаться"),
    types.BotCommand("setbal", "установить баланс"),
    types.BotCommand("setstatus", "изменить статус"),
    types.BotCommand("deluser", "удалить пользователя"),
    types.BotCommand("mute", "замутить пользователя"),
    types.BotCommand("unmute", "снять мут"),
    types.BotCommand("ban", "заблокировать пользователя"),
    types.BotCommand("unban", "разблокировать пользователя"),
    types.BotCommand("system", "режим системы"),
]


async def on_startup(dispatcher):
    # Import handlers only after main.py has finished initializing.
    # Handler modules import objects from main.py, so importing them earlier
    # creates a circular-import timing problem and leaves Dispatcher empty.
    # Register specific handlers first.
    # chat_groups is deliberately imported last because it contains the
    # catch-all echo handler; otherwise it would intercept most commands.
    import handlers.admin  # noqa: F401
    import handlers.help  # noqa: F401
    import aboute  # noqa: F401
    import handlers.chat_groups  # noqa: F401

    from handlers.help.help import ThrottlingMiddleware
    dp.middleware.setup(ThrottlingMiddleware())
    log_registered_handlers()

    bot_info = await bot.get_me()
    try:
        await bot.set_my_commands(BOT_COMMANDS)
        log.info("Telegram command menu updated: %d commands", len(BOT_COMMANDS))
    except Exception:
        log.exception("Could not update Telegram command menu")
    log.info("Бот @%s подключён и ожидает сообщения", bot_info.username)


if __name__ == "__main__":
    log.info("Starting the bot...")
    executor.start_polling(dp, skip_updates=True, on_startup=on_startup)
