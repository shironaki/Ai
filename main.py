import asyncio
import html
import logging
from logging.handlers import RotatingFileHandler
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

LOG_FILE = "bot.log"

# Persistent diagnostic log: it survives terminal scrolling and keeps the
# latest runtime history in a small rotating file.  The file is ignored by git.
_file_handler = RotatingFileHandler(
    LOG_FILE,
    maxBytes=2 * 1024 * 1024,
    backupCount=3,
    encoding="utf-8",
)
_file_handler.setLevel(logging.INFO)
_file_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))

_console_handler = logging.StreamHandler()
_console_handler.setLevel(logging.INFO)
_console_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))

logging.basicConfig(level=logging.INFO, handlers=[_console_handler, _file_handler], force=True)
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
            message = update.message
            text = (message.text or message.caption or "").replace("\n", " ")[:300]
            log.info(
                "UPDATE message | update_id=%s chat=%s type=%s user=%s text=%r",
                getattr(update, "update_id", "?"),
                message.chat.id,
                message.chat.type,
                getattr(message.from_user, "id", "?"),
                text,
            )
        elif update.callback_query:
            log.info(
                "UPDATE callback | update_id=%s user=%s data=%r",
                getattr(update, "update_id", "?"),
                getattr(update.callback_query.from_user, "id", "?"),
                update.callback_query.data,
            )
        else:
            log.info("UPDATE other | update_id=%s", getattr(update, "update_id", "?"))

    async def on_process_message(self, message, data):
        handler = current_handler.get()
        if handler:
            log.info("DISPATCH | handler=%s", getattr(handler, "__name__", repr(handler)))
        else:
            log.info("DISPATCH | handler not selected yet")

    async def on_post_process_message(self, message, results, data):
        handler = current_handler.get()
        if handler:
            log.info("HANDLER DONE | handler=%s", getattr(handler, "__name__", repr(handler)))
        else:
            log.warning("HANDLER DONE | no handler reported")


dp.middleware.setup(ActivityLoggingMiddleware())


class ChatRegistrationMiddleware(BaseMiddleware):
    """Ensure group chats exist in chats.db before command handlers run."""

    async def on_pre_process_message(self, message, data):
        if message.chat.type not in ("group", "supergroup"):
            return
        if getattr(message, "new_chat_members", None):
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
    log.info("REGISTERED HANDLERS | total=%d", len(handlers))
    for index, handler in enumerate(handlers):
        callback = getattr(handler, "handler", None) or getattr(handler, "callback", None)
        name = getattr(callback, "__name__", repr(callback))
        log.info("HANDLER[%d] | %s", index, name)


@dp.errors_handler()
async def log_update_error(update, exception):
    update_id = getattr(update, "update_id", "unknown")
    log.error(
        "EXCEPTION | update_id=%s | %s: %s",
        update_id,
        type(exception).__name__,
        exception,
        exc_info=(type(exception), exception, exception.__traceback__),
    )

    message = getattr(update, "message", None)
    if message:
        try:
            await message.answer(
                "⚠️ Ошибка обработчика. Диагностика записана в bot.log. "
                "Владелец бота получит технический отчёт."
            )
        except Exception:
            log.exception("Could not send error notice to the user")

    # Send the technical error directly to the owner so debugging no longer
    # depends on screenshots from the Codespaces terminal.
    if config.owner:
        try:
            details = (
                "🚨 <b>BOT ERROR</b>\n"
                f"update_id: <code>{update_id}</code>\n"
                f"type: <code>{type(exception).__name__}</code>\n"
                f"error: <code>{str(exception)[:1200]}</code>\n"
            )
            if message:
                details += (
                    f"chat: <code>{message.chat.id}</code>\n"
                    f"user: <code>{getattr(message.from_user, 'id', '?')}</code>\n"
                    f"text: <code>{(message.text or message.caption or '')[:500]}</code>"
                )
            await bot.send_message(config.owner, details)
        except Exception:
            log.exception("Could not notify owner about runtime error")
    return True


@dp.message_handler(commands=['logs'])
async def send_logs(message: types.Message):
    """Owner-only command: send the latest runtime log as Telegram text."""
    if message.from_user.id != config.owner:
        return

    try:
        with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as log_file:
            content = log_file.read()

        if not content:
            await message.answer("bot.log пока пуст.")
            return

        # Telegram messages are limited to 4096 characters. Send the newest
        # part first, in safe-sized chunks, so no file download is required.
        chunks = []
        while content:
            chunks.insert(0, content[-3500:])
            content = content[:-3500]
            if len(chunks) >= 5:
                break

        for chunk in reversed(chunks):
            await message.answer(f"<pre>{html.escape(chunk)}</pre>")

        log.info("LOGS | sent latest bot.log as text to owner")
    except Exception:
        log.exception("Could not send bot.log as text")


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
    types.BotCommand("chatinfo", "информация о чате"),
    types.BotCommand("report", "пожаловаться"),
    types.BotCommand("ai", "обратиться к Аи"),
    # Privileged/admin/moderation commands are deliberately hidden from the
    # public Telegram command menu. Handlers enforce permissions themselves.

]


async def on_startup(dispatcher):
    # Handler modules are imported before polling starts (see below).
    from handlers.help.help import ThrottlingMiddleware
    dp.middleware.setup(ThrottlingMiddleware())
    log_registered_handlers()

    # A healthy bot must have the handlers from all modules on THIS dispatcher.
    # If this number ever unexpectedly drops, it is immediately visible in the
    # persistent log and in the owner's Telegram diagnostics.
    handler_count = len(getattr(dp.message_handlers, "handlers", []))
    if handler_count <= 3:
        log.error("HANDLER REGISTRATION FAILURE | only %d message handlers loaded", handler_count)
        if config.owner:
            try:
                await bot.send_message(
                    config.owner,
                    f"🚨 <b>HANDLER REGISTRATION FAILURE</b>\n"
                    f"Загружено обработчиков: <code>{handler_count}</code>\n"
                    "Проверьте bot.log.",
                )
            except Exception:
                log.exception("Could not notify owner about handler registration failure")

    bot_info = await bot.get_me()
    try:
        await bot.set_my_commands(BOT_COMMANDS)
        log.info("Telegram command menu updated: %d commands", len(BOT_COMMANDS))
    except Exception:
        log.exception("Could not update Telegram command menu")
    log.info("Бот @%s подключён и ожидает сообщения", bot_info.username)


# Register all handler modules after main.py has finished defining bot/dp.
# chat_groups contains the final catch-all echo handler, so it must be imported last.
import handlers.admin  # noqa: E402,F401
import handlers.help  # noqa: E402,F401
import aboute  # noqa: E402,F401
import handlers.chat_groups  # noqa: E402,F401


def start_bot():
    """Start polling after main.py has been imported as the real 'main' module."""
    log.info("Starting the bot...")
    executor.start_polling(dp, skip_updates=True, on_startup=on_startup)


if __name__ == "__main__":
    start_bot()
