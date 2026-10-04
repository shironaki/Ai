import asyncio
import html
import json
import logging
import os
from logging.handlers import RotatingFileHandler
import random
import re
import sqlite3
import subprocess
import time
from random import randint
from asyncio import sleep
from datetime import datetime, timedelta
from time import gmtime, localtime, strftime

import aiogram
try:
    import psutil
except ImportError:
    psutil = None
import requests
from aiogram import Bot, Dispatcher, executor, types
from aiogram.contrib.fsm_storage.memory import MemoryStorage
from aiogram.dispatcher import FSMContext
from aiogram.dispatcher.handler import CancelHandler, current_handler
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
from core.runtime_state import is_paused, set_paused
from services.security import RedactingFormatter, redact
from services.moderation_scheduler import expiry_loop
from services.diagnostic_journal import record as record_diagnostic
from services.issue_tracker import create_runtime_error_marker
from services.report_service import reminder_loop
from services.battery_status import get_battery_status

DATA_DIR = os.path.abspath(os.getenv("BOT_DATA_DIR", os.path.join("data", "test")))
os.makedirs(DATA_DIR, exist_ok=True)
if os.name != "nt":
    try:
        os.chmod(DATA_DIR, 0o700)
    except OSError:
        pass
LOG_FILE = os.path.join(DATA_DIR, "bot.log")
BOT_PAUSED = False
HEALTH_DIR = os.path.join(os.getenv("BOT_DATA_DIR", "data/test"), "runtime")
HEARTBEAT_FILE = os.path.join(HEALTH_DIR, "heartbeat")
PROCESS_STARTED_AT = time.monotonic()


def write_health_heartbeat() -> None:
    """Persist a small local heartbeat proving the bot event loop is alive."""
    try:
        os.makedirs(HEALTH_DIR, exist_ok=True)
        tmp_path = HEARTBEAT_FILE + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as handle:
            handle.write(str(time.time()))
        os.replace(tmp_path, HEARTBEAT_FILE)
    except Exception:
        log.exception("HEALTH | failed to write heartbeat")


async def runtime_heartbeat() -> None:
    """Keep an external watchdog informed that the asyncio runtime is alive."""
    while True:
        write_health_heartbeat()
        await asyncio.sleep(10)


def bot_is_paused(chat_id=None) -> bool:
    """Return whether global or chat-scoped stasis blocks this chat."""
    return is_paused(chat_id)


def set_bot_paused(
    value: bool,
    scope: str = "global",
    chat_id=None,
    *,
    actor_id: int,
) -> None:
    """Set global or chat-scoped stasis state after founder authorization."""
    if actor_id != config.owner:
        raise PermissionError("Runtime state changes require founder actor context")
    global BOT_PAUSED
    set_paused(value, scope=scope, chat_id=chat_id)
    BOT_PAUSED = is_paused(None)


# Persistent diagnostic log: it survives terminal scrolling and keeps the
# latest runtime history in a small rotating file.  The file is ignored by git.
_file_handler = RotatingFileHandler(
    LOG_FILE,
    maxBytes=2 * 1024 * 1024,
    backupCount=3,
    encoding="utf-8",
)
_file_handler.setLevel(logging.INFO)
_file_handler.setFormatter(RedactingFormatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
if os.name != "nt":
    try:
        os.chmod(LOG_FILE, 0o600)
    except OSError:
        pass

_console_handler = logging.StreamHandler()
_console_handler.setLevel(logging.INFO)
_console_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))

logging.basicConfig(level=logging.INFO, handlers=[_console_handler, _file_handler], force=True)
log = logging.getLogger(__name__)

if not config.bot_heart:
    raise RuntimeError("Укажите токен бота в переменной окружения BOT_TOKEN.")

bot = Bot(token=config.bot_heart, parse_mode=types.ParseMode.HTML)
dp = Dispatcher(bot, storage=MemoryStorage())

# Bootstrap the founder into the legacy users registry as well as the
# authoritative config.owner identity. This prevents old profile/start
# handlers from treating the founder as an unregistered ordinary user.
users.ensure_owner_registered(config.owner)


class MyStatesGroup(StatesGroup):
    START_STATE = State()
    SECOND_STATE = State()


class ActivityLoggingMiddleware(BaseMiddleware):
    async def on_pre_process_update(self, update, data):
        data["diagnostic_update_id"] = getattr(update, "update_id", None)
        data["diagnostic_started_at"] = time.perf_counter()
        if update.message:
            message = update.message
            raw_text = message.text or message.caption or ""
            data["diagnostic_chat_id"] = message.chat.id
            data["diagnostic_user_id"] = getattr(message.from_user, "id", None)
            data["diagnostic_text"] = raw_text
            if getattr(message.from_user, "id", None) == config.owner:
                try:
                    users.ensure_owner_registered(
                        message.from_user.id,
                        message.from_user.full_name,
                        message.from_user.username,
                    )
                except Exception:
                    log.exception("FOUNDER IDENTITY | failed to persist owner profile")
            try:
                data["diagnostic_event_id"] = record_diagnostic(
                    update_id=data["diagnostic_update_id"],
                    chat_id=message.chat.id,
                    user_id=getattr(message.from_user, "id", None),
                    stage="update_received",
                    result="received",
                    context={"content_type": getattr(message, "content_type", "unknown")},
                )
            except Exception:
                log.exception("DIAGNOSTIC JOURNAL | failed to record update")
            write_health_heartbeat()
            log.info(
                "UPDATE message | update_id=%s chat=%s type=%s user=%s text_len=%s content_type=%s",
                getattr(update, "update_id", "?"),
                message.chat.id,
                message.chat.type,
                getattr(message.from_user, "id", "?"),
                len(raw_text),
                getattr(message, "content_type", "unknown"),
            )
        elif update.callback_query:
            log.info(
                "UPDATE callback | update_id=%s user=%s",
                getattr(update, "update_id", "?"),
                getattr(update.callback_query.from_user, "id", "?"),
            )
        else:
            log.info("UPDATE other | update_id=%s", getattr(update, "update_id", "?"))

    async def on_pre_process_callback_query(self, callback_query, data):
        data["diagnostic_callback_data"] = getattr(callback_query, "data", None)
        log.info(
            "UPDATE callback | update_id=%s user=%s chat=%s data=%s",
            getattr(callback_query, "id", "?"),
            getattr(callback_query.from_user, "id", "?"),
            getattr(getattr(callback_query, "message", None), "chat", None).id
            if getattr(callback_query, "message", None) and getattr(callback_query.message, "chat", None)
            else None,
            redact(getattr(callback_query, "data", "") or ""),
        )
        try:
            record_diagnostic(
                update_id=getattr(callback_query, "id", None),
                chat_id=getattr(getattr(callback_query, "message", None), "chat", None).id
                if getattr(callback_query, "message", None) and getattr(callback_query.message, "chat", None)
                else None,
                user_id=getattr(callback_query.from_user, "id", None),
                stage="callback_received",
                result="received",
                context={"callback_data": redact(getattr(callback_query, "data", "") or "")},
            )
        except Exception:
            log.exception("DIAGNOSTIC JOURNAL | failed to record callback")

    async def on_process_callback_query(self, callback_query, data):
        handler = current_handler.get()
        handler_name = getattr(handler, "__name__", repr(handler)) if handler else None
        log.info(
            "CALLBACK DISPATCH | data=%s handler=%s",
            redact(getattr(callback_query, "data", "") or ""),
            handler_name,
        )
        try:
            record_diagnostic(
                update_id=getattr(callback_query, "id", None),
                chat_id=getattr(getattr(callback_query, "message", None), "chat", None).id
                if getattr(callback_query, "message", None) and getattr(callback_query.message, "chat", None)
                else None,
                user_id=getattr(callback_query.from_user, "id", None),
                handler=handler_name,
                stage="callback_dispatch",
                result="handler_selected" if handler else "no_handler",
                context={"callback_data": redact(getattr(callback_query, "data", "") or "")},
            )
        except Exception:
            log.exception("DIAGNOSTIC JOURNAL | failed to record callback dispatch")

    async def on_post_process_callback_query(self, callback_query, results, data):
        handler = current_handler.get()
        elapsed = (
            time.perf_counter() - data["diagnostic_started_at"]
            if data.get("diagnostic_started_at") is not None
            else None
        )
        log.info(
            "CALLBACK DONE | data=%s handler=%s duration_ms=%s",
            redact(getattr(callback_query, "data", "") or ""),
            getattr(handler, "__name__", repr(handler)) if handler else None,
            round(elapsed * 1000, 1) if elapsed is not None else "?",
        )

    async def on_process_message(self, message, data):
        handler = current_handler.get()
        handler_name = getattr(handler, "__name__", repr(handler)) if handler else None
        data["diagnostic_handler"] = handler_name
        if handler:
            log.info("DISPATCH | handler=%s", handler_name)
        else:
            log.info("DISPATCH | handler not selected yet")
        try:
            record_diagnostic(
                update_id=data.get("diagnostic_update_id"),
                chat_id=data.get("diagnostic_chat_id"),
                user_id=data.get("diagnostic_user_id"),
                handler=handler_name,
                stage="dispatch",
                result="handler_selected" if handler else "no_handler",
            )
        except Exception:
            log.exception("DIAGNOSTIC JOURNAL | failed to record dispatch")

    async def on_post_process_message(self, message, results, data):
        handler = current_handler.get()
        elapsed = (
            time.perf_counter() - data["diagnostic_started_at"]
            if data.get("diagnostic_started_at") is not None
            else None
        )
        if handler:
            log.info(
                "HANDLER DONE | handler=%s duration_ms=%s",
                getattr(handler, "__name__", repr(handler)),
                round(elapsed * 1000, 1) if elapsed is not None else "?",
            )
        else:
            log.warning(
                "HANDLER DONE | no handler reported duration_ms=%s",
                round(elapsed * 1000, 1) if elapsed is not None else "?",
            )


dp.middleware.setup(ActivityLoggingMiddleware())


class RuntimeGateMiddleware(BaseMiddleware):
    """Globally silence the bot while preserving founder control."""

    def _allowed(self, user_id, chat_id=None):
        return user_id == config.owner or not bot_is_paused(chat_id)

    async def on_pre_process_message(self, message, data):
        user_id = getattr(message.from_user, "id", None)
        if not self._allowed(user_id, getattr(message.chat, "id", None)):
            log.info("RUNTIME GATE | ignored message from user=%s while bot is in STASIS", user_id)
            raise CancelHandler()

    async def on_pre_process_callback_query(self, callback_query, data):
        user_id = getattr(callback_query.from_user, "id", None)
        if not self._allowed(
            user_id, getattr(getattr(callback_query, "message", None), "chat", None).id
            if getattr(getattr(callback_query, "message", None), "chat", None) else None,
        ):
            log.info("RUNTIME GATE | ignored callback from user=%s while bot is in STASIS", user_id)
            raise CancelHandler()


dp.middleware.setup(RuntimeGateMiddleware())


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


# Founder-only global runtime controls. The commands are intentionally unusual
# and are not included in the public Telegram command menu to avoid collisions.
@dp.message_handler(commands=["stasis"])
async def enter_stasis(message: types.Message):
    if message.from_user.id != config.owner:
        await message.answer("⛔ Команда доступна только Основателю.")
        return

    if bot_is_paused():
        await message.answer(
            "🛰 <b>РЕЖИМ СТАЗИСА</b> уже активен.\n"
            "Все сигналы от пользователей подавлены. "
            "Для возврата используй <code>/awakening</code>."
        )
        return

    set_bot_paused(True, actor_id=message.from_user.id)
    from services.action_cancel import register_runtime_action
    register_runtime_action(message.from_user.id, message.chat.id, previous_enabled=False, scope="global")
    log.warning("RUNTIME STATE | BOT ENTERED STASIS by founder id=%s", message.from_user.id)
    await message.answer(
        "🛰 <b>СТАЗИС АКТИВИРОВАН.</b>\n"
        "Все внешние сигналы подавлены. Бот переходит в режим полной тишины.\n\n"
        "👑 Контур Основателя остаётся активен.\n"
        "Для возвращения в строй: <code>/awakening</code>"
    )


@dp.message_handler(commands=["awakening"])
async def leave_stasis(message: types.Message):
    if message.from_user.id != config.owner:
        await message.answer("⛔ Команда доступна только Основателю.")
        return

    if not bot_is_paused():
        await message.answer("⚡ <b>СИСТЕМА УЖЕ В АКТИВНОМ РЕЖИМЕ.</b>")
        return

    set_bot_paused(False, actor_id=message.from_user.id)
    from services.action_cancel import register_runtime_action
    register_runtime_action(message.from_user.id, message.chat.id, previous_enabled=True, scope="global")
    log.warning("RUNTIME STATE | BOT AWAKENED by founder id=%s", message.from_user.id)
    await message.answer(
        "⚡ <b>ПРОБУЖДЕНИЕ ЗАВЕРШЕНО.</b>\n"
        "Контуры связи восстановлены. Бот снова принимает сигналы."
    )


@dp.message_handler(commands=["health", "проверка"])
async def health_check(message: types.Message):
    """Public, dependency-light bot health check."""
    checks = []
    try:
        await bot.get_me()
        checks.append(("Telegram API", True))
    except Exception:
        checks.append(("Telegram API", False))

    try:
        users.cursor.execute("SELECT 1")
        chats.cursor.execute("SELECT 1")
        checks.append(("База данных", True))
    except Exception:
        checks.append(("База данных", False))

    heartbeat_ok = False
    try:
        age = time.time() - os.path.getmtime(HEARTBEAT_FILE)
        heartbeat_ok = age <= 30
    except (OSError, TypeError):
        pass
    checks.append(("Runtime", heartbeat_ok))

    healthy = all(ok for _, ok in checks)
    uptime_seconds = max(0, int(time.monotonic() - PROCESS_STARTED_AT))
    uptime = str(timedelta(seconds=uptime_seconds))
    paused = bot_is_paused()

    lines = [
        f'{"🟢" if healthy else "⚠️"} <b>ПРОВЕРКА БОТА</b>',
        f'Состояние: <b>{"работоспособен" if healthy else "есть проблемы"}</b>',
        f'Время работы: <b>{uptime}</b>',
        "",
    ]
    for label, ok in checks:
        lines.append(f'{"✅" if ok else "❌"} {label}')
    lines.append(f'{"⏸️" if paused else "▶️"} Стазис: <b>{"активен" if paused else "выключен"}</b>')
    await message.answer("\n".join(lines))


# Diagnostic handler: proves that aiogram is dispatching /debug and /start.
# It is intentionally registered before the imported catch-all handlers.
@dp.message_handler(commands=['debug'])
async def debug_dispatch(message: types.Message):
    if message.from_user.id != config.owner:
        await message.answer("⛔ Эта диагностическая команда доступна только Основателю.")
        return
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
    if message.chat.type != "private":
        return
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
        first_name = message.from_user.first_name or "Пользователь"
        username = message.from_user.username

        users.cursor.execute(
            "INSERT INTO users VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                user_id,
                first_name,
                username,
                "Пользователь",
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
    callback_query = getattr(update, "callback_query", None)
    diagnostic_id = None
    marker_id = None
    try:
        diagnostic_id = record_diagnostic(
            update_id=update_id,
            chat_id=(
                getattr(message.chat, "id", None)
                if message
                else getattr(getattr(callback_query, "message", None).chat, "id", None)
                if callback_query and getattr(callback_query, "message", None) and getattr(callback_query.message, "chat", None)
                else None
            ),
            user_id=(
                getattr(message.from_user, "id", None)
                if message
                else getattr(callback_query.from_user, "id", None) if callback_query else None
            ),
            stage="callback_exception" if callback_query else "exception",
            result="unhandled_exception",
            exception=exception,
            context={
                "text": (message.text or message.caption or "")[:1000] if message else "",
                "content_type": getattr(message, "content_type", None) if message else None,
            },
        )
        if message:
            marker_id = create_runtime_error_marker(
                chat_id=message.chat.id,
                message_id=message.message_id,
                reporter_id=getattr(message.from_user, "id", config.owner),
                message_text=(message.text or message.caption or f"[{message.content_type}]")[:4000],
                diagnostic_id=diagnostic_id,
                exception_type=type(exception).__name__,
                exception_text=str(exception),
            )
        log.error(
            "DIAGNOSTIC AUTO-QA | diagnostic_id=%s marker_id=%s update_id=%s",
            diagnostic_id, marker_id, update_id,
        )
    except Exception:
        log.exception("DIAGNOSTIC AUTO-QA | failed to persist exception")

    if message:
        try:
            await message.answer(
                "⚠️ Ошибка обработчика. Я автоматически сохранила диагностику "
                f"<code>#{diagnostic_id or '?'}</code> и QA-метку "
                f"<code>#{marker_id or '?'}</code>."
            )
        except Exception:
            log.exception("Could not send error notice to the user")
    elif callback_query:
        try:
            await callback_query.answer(
                "⚠️ Ошибка обработчика кнопки. Диагностика записана.",
                show_alert=True,
            )
        except Exception:
            log.exception("Could not answer failed callback query")

    if config.owner:
        try:
            details = (
                "🚨 <b>BOT ERROR</b>\n"
                f"update_id: <code>{html.escape(str(update_id))}</code>\n"
                f"type: <code>{html.escape(type(exception).__name__)}</code>\n"
                f"error: <code>{html.escape(redact(str(exception), 1200))}</code>\n"
            )
            if message:
                details += (
                    f"chat: <code>{html.escape(str(message.chat.id))}</code>\n"
                    f"user: <code>{html.escape(str(getattr(message.from_user, 'id', '?')))}</code>\n"
                    f"text_len: <code>{len(message.text or message.caption or '')}</code>\n"
                    f"diagnostic_id: <code>{html.escape(str(diagnostic_id or '?'))}</code>\n"
                    f"qa_marker: <code>#{html.escape(str(marker_id or '?'))}</code>"
                )
            await bot.send_message(config.owner, details)
        except Exception:
            log.exception("Could not notify owner about runtime error")
    return True



def _runtime_status_snapshot() -> dict:
    now = time.time()
    heartbeat_age = None
    try:
        with open(HEARTBEAT_FILE, "r", encoding="utf-8") as handle:
            heartbeat_age = max(0.0, now - float(handle.read().strip()))
    except (OSError, ValueError, TypeError):
        pass

    process_uptime = None
    if psutil is not None:
        try:
            process_uptime = max(0.0, now - psutil.Process(os.getpid()).create_time())
        except Exception:
            pass

    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=os.path.dirname(os.path.abspath(__file__)),
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=3,
        ).strip()
    except Exception:
        commit = "unknown"

    return {
        "heartbeat_age": heartbeat_age,
        "process_uptime": process_uptime,
        "commit": commit,
        "pid": os.getpid(),
    }


@dp.message_handler(commands=["diagnostics"])
async def runtime_diagnostics(message: types.Message):
    if message.from_user.id != config.owner:
        await message.answer("⛔ Команда доступна только Основателю.")
        return

    status = _runtime_status_snapshot()
    heartbeat_age = status["heartbeat_age"]
    heartbeat_text = f"{heartbeat_age:.1f}s" if heartbeat_age is not None else "missing"
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripts", "healthcheck.py")
    try:
        result = subprocess.run(
            [os.getenv("PYTHON", "python3"), script, "--diagnostics"],
            cwd=os.path.dirname(os.path.abspath(__file__)),
            capture_output=True,
            text=True,
            timeout=20,
            env=os.environ.copy(),
        )
        output = (result.stdout + "\\n" + result.stderr).strip()
        if len(output) > 5000:
            output = output[-5000:]
    except Exception as exc:
        output = f"DIAGNOSTICS ERROR: {type(exc).__name__}: {exc}"

    await message.answer(
        "🧪 <b>NETWORK / RUNTIME DIAGNOSTICS</b>\\n"
        f"Heartbeat: <code>{html.escape(heartbeat_text)}</code>\\n"
        f"PID: <code>{status['pid']}</code>\\n"
        f"Commit: <code>{html.escape(status['commit'])}</code>\\n\\n"
        f"<pre>{html.escape(output)}</pre>"
    )


@dp.message_handler(commands=["status"])
async def runtime_status(message: types.Message):
    if message.from_user.id != config.owner:
        await message.answer("⛔ Команда доступна только Основателю.")
        return

    status = _runtime_status_snapshot()
    heartbeat_age = status["heartbeat_age"]
    heartbeat_state = (
        "🟢 OK" if heartbeat_age is not None and heartbeat_age <= 30
        else "🔴 STALE/MISSING"
    )
    uptime = status["process_uptime"]
    if uptime is None:
        uptime_text = "unknown"
    else:
        uptime_text = f"{int(uptime // 3600)}ч {int((uptime % 3600) // 60)}м {int(uptime % 60)}с"

    heartbeat_text = f"{heartbeat_age:.1f}s назад" if heartbeat_age is not None else "нет"
    await message.answer(
        "🛰 <b>FOUNDER RUNTIME STATUS</b>\n"
        f"Бот: <b>{heartbeat_state}</b>\n"
        f"Heartbeat: <code>{heartbeat_text}</code>\n"
        f"PID: <code>{status['pid']}</code>\n"
        f"Uptime: <code>{uptime_text}</code>\n"
        f"Commit: <code>{html.escape(status['commit'])}</code>"
    )


@dp.message_handler(commands=["restart"])
async def remote_restart(message: types.Message):
    if message.from_user.id != config.owner:
        await message.answer("⛔ Команда доступна только Основателю.")
        return

    request_path = os.path.join(HEALTH_DIR, "restart.request")
    try:
        os.makedirs(HEALTH_DIR, exist_ok=True)
        with open(request_path, "w", encoding="utf-8") as handle:
            handle.write(f"requested_at={time.time()}\nrequested_by={message.from_user.id}\n")
        await message.answer(
            "🔄 <b>ПЕРЕЗАПУСК ЗАПРОШЕН.</b>\n"
            "Текущий процесс завершается, Termux supervisor поднимет его заново."
        )
        log.warning("REMOTE RESTART | founder requested restart; pid=%s", os.getpid())
        await asyncio.sleep(0.3)
        os._exit(0)
    except Exception as exc:
        log.exception("REMOTE RESTART | failed")
        await message.answer(
            f"⚠️ Не удалось подготовить перезапуск: <code>{html.escape(str(exc)[:500])}</code>"
        )


@dp.message_handler(commands=["battery", "charge"])
async def battery_status(message: types.Message):
    if message.from_user.id != config.owner:
        await message.answer("⛔ Команда доступна только Основателю.")
        return

    try:
        status = get_battery_status()
        if status.get("charging"):
            state = "⚡ <b>Заряжается</b>"
        else:
            state = "🔋 <b>Не заряжается</b>"

        percentage = status.get("percentage", "?")
        plugged = str(status.get("plugged", "UNKNOWN")).upper()

        if plugged in {"UNPLUGGED", "NONE", "UNKNOWN"}:
            power_source = "Не подключено к зарядке"
        elif plugged in {"USB", "USB_AC", "PLUGGED_USB"}:
            power_source = "USB"
        elif plugged in {"AC", "PLUGGED_AC"}:
            power_source = "Сеть / адаптер"
        elif plugged in {"WIRELESS", "PLUGGED_WIRELESS"}:
            power_source = "Беспроводная зарядка"
        else:
            power_source = "Подключено к питанию"

        age = int(status.get("age_seconds", 0))
        if status.get("stale"):
            if age >= 60:
                minutes = age // 60
                age_text = f"{minutes} мин. назад"
            else:
                age_text = f"{age} сек. назад"
            freshness = (
                "\n⚠️ <b>Последние известные данные</b> "
                f"(обновлены {age_text}).\n"
                "Termux:API сейчас не отдал свежий ответ."
            )
        else:
            freshness = ""

        await message.answer(
            "🔋 <b>СТАТУС ЗАРЯДКИ</b>\n"
            f"Уровень: <b>{percentage}%</b>\n"
            f"Состояние: {state}\n"
            f"Источник питания: <b>{html.escape(power_source)}</b>"
            f"{freshness}"
        )
    except Exception as exc:
        log.exception("BATTERY STATUS | failed to read battery")
        await message.answer(
            "⚠️ Не удалось получить статус батареи второго телефона.\n"
            f"<code>{html.escape(type(exc).__name__)}: {html.escape(redact(str(exc), 500))}</code>"
        )


@dp.message_handler(commands=['logs'])
async def send_logs(message: types.Message):
    if message.from_user.id != config.owner:
        await message.answer("⛔ Команда доступна только Основателю.")
        return

    try:
        with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as log_file:
            content = log_file.read()

        if not content:
            await message.answer("bot.log пока пуст.")
            return

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
    types.BotCommand("help", "актуальный список команд"),
    types.BotCommand("ai", "обратиться к Аи"),
    types.BotCommand("report", "отправить обращение/жалобу"),
    types.BotCommand("battery", "статус батареи второго телефона"),
]



async def on_startup(dispatcher):
    write_health_heartbeat()
    asyncio.create_task(runtime_heartbeat())
    asyncio.create_task(expiry_loop(bot))
    asyncio.create_task(reminder_loop(bot, config.owner, config.tech_team_ids))
    from handlers.help.help import ThrottlingMiddleware
    dp.middleware.setup(ThrottlingMiddleware())
    log_registered_handlers()

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
import handlers.chat_groups  # noqa: E402,F401


def start_bot():
    """Start polling after main.py has been imported as the real 'main' module."""
    log.info("Starting the bot...")
    # Python 3.14 no longer creates a default event loop automatically.
    # aiogram 2.x expects one to exist before executor.start_polling().
    try:
        asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    executor.start_polling(dp, skip_updates=True, on_startup=on_startup)


if __name__ == "__main__":
    start_bot()
