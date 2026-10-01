import logging
from aiogram import Dispatcher, types
from aiogram.dispatcher import FSMContext
from aiogram.dispatcher.handler import CancelHandler, current_handler
from aiogram.dispatcher.middlewares import BaseMiddleware
from aiogram.utils.exceptions import Throttled

from services.ai_service import ai_status, escape_for_telegram_html, generate_reply, _LAST_ERROR
from services.command_gateway import execute, has_pending, interpret, pending_prompt, pop_pending, remember, is_cancel_request, cancel_pending
from services.security import redact
from services.assistant_actions import detect_direct_action
from services.moderation_gateway import (
    request as request_moderation,
    confirm as confirm_moderation,
    has_pending as has_pending_moderation,
    detect_action as detect_moderation_action,
)
from services.ai_data import build_verified_context, chat_summary, system_summary, user_summary, runtime_summary
from services.issue_tracker import parse_marker, parse_fixed, create_marker, list_markers, mark_fixed, render_marker

from main import (
    BaseMiddleware,
    ContentType,
    FSMContext,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    State,
    StatesGroup,
    asyncio,
    bot,
    chats,
    config,
    datetime,
    dp,
    psutil,
    random,
    re,
    LOG_FILE,
    sqlite3,
    time,
    timedelta,
    users,
)

from core.permissions import get_user_status


class ChRass(StatesGroup):
    msg = State()

class Rass(StatesGroup):
    msg = State()

class Quest(StatesGroup):
    msg = State()


def rate_limit(limit, key=None):
    def decorator(func):
        setattr(func, 'throttling_rate_limit', limit)
        if key:
            setattr(func, 'throttling_key', key)
        return func

    return decorator

class ThrottlingMiddleware(BaseMiddleware):
    def __init__(self, limit=0, key_prefix='antiflood_'):
        self.rate_limit = limit
        self.prefix = key_prefix
        super(ThrottlingMiddleware, self).__init__()

    async def on_process_message(self, message, data):
        handler = current_handler.get()
        dispatcher = Dispatcher.get_current()
        
        if handler:
            limit = getattr(handler, 'throttling_rate_limit', self.rate_limit)
            key = getattr(handler, 'throttling_key', f"{self.prefix}_{handler.__name__}")
        else:
            limit = self.rate_limit
            key = f"{self.prefix}_message"

        if limit <= 0:
            return

        try:
            await dispatcher.throttle(key, rate=limit)
        except Throttled as t:
            await self.message_throttled(message, t)
            raise CancelHandler()

    async def message_throttled(self, message, throttled):
        handler = current_handler.get()

        if handler:
            key = getattr(handler, 'throttling_key', f"{self.prefix}_{handler.__name__}")
        else:
            key = f"{self.prefix}_message"

        delta = throttled.rate - throttled.delta
        await asyncio.sleep(delta)

        try:
            await message.reply("⏳ Слишком часто. Подожди немного.")
        except Exception:
            pass


# NOTE: The remainder of this file is intentionally preserved below this marker.
