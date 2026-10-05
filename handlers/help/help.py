import logging
from aiogram import Dispatcher, types
from aiogram.dispatcher import FSMContext
from aiogram.dispatcher.handler import CancelHandler, current_handler
from aiogram.dispatcher.middlewares import BaseMiddleware
from aiogram.utils.exceptions import Throttled

from services.ai_service import ai_status, escape_for_telegram_html, generate_reply, _LAST_ERROR
from services.ai_memory import clear_history
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
from services.issue_tracker import list_markers, render_marker
from services.report_service import create_report, list_open, get_report, answer_report, reminder_loop
from services.chat_members import sync_chat_admins
from services.chat_roles import get_role, set_role
from services.action_cancel import cancel_current_action
from services.ai_relationship import alternate_names, can_call, get_score, invocation_names, is_max_positive, set_alternate_names, set_calls_blocked, set_invocation_names, set_score


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

from core.permissions import get_user_status, get_display_role, has_admin_role, has_moderator_role
from core.identity import is_owner, resolve_role
from core.role_transitions import available_role_targets
from core.command_resolution import is_founder_scope_reply


def _is_report_operator(user_id: int, chat_id: int | None = None) -> bool:
    """Report-center access follows the effective role of the current chat."""
    return is_owner(user_id) or (
        chat_id is not None and has_moderator_role(user_id, chat_id)
    )


def _panel_role(user_id: int, chat_id: int | None = None) -> str:
    if chat_id is not None:
        return get_display_role(user_id, chat_id)
    return get_user_status(user_id) or "Пользователь"



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

        if throttled.exceeded_count <= 2:
            await message.reply('❎ | Не спамь!')
            

# Аи — персональный помощник Системы.
# Без текста команда отвечает в характерном стиле по роли пользователя.
# С текстом передаёт вопрос в AI-провайдер, поэтому ответы не нужно
# прописывать вручную в коде.
def _ai_role(message: types.Message) -> str:
    role = get_display_role(message.from_user.id, message.chat.id)
    return "Основатель" if role == "Создатель бота" else role


def _ai_intro(role: str) -> str:
    if role == "Основатель":
        return "🔐 СПЕЦДОСТУП ПОЛУЧЕН · Я слушаю. Система в полном распоряжении. Приказывайте."
    if role == "Владелец чата":
        return "🔑 ВЛАДЕЛЕЦ ЧАТА · Полномочия этого мира подтверждены. Что прикажете?"
    if role == "Администратор":
        return "🛡️ АДМИНИСТРАТОР · Я слушаю. Полномочия подтверждены. Что прикажете?"
    if role == "Хелпер":
        return "👮 ХЕЛПЕР · Я слушаю. Полномочия подтверждены. Что прикажете?"
    if role == "Модератор":
        return "🔨 МОДЕРАТОР · Я слушаю. Полномочия подтверждены. Что прикажете?"
    return "👤 ПОЛЬЗОВАТЕЛЬ · Я слушаю. Обращайтесь ко мне через «Аи» или «Система»."



def _is_command_catalog_request(prompt: str) -> bool:
    """Recognize deterministic requests for the authoritative command catalogue."""
    normalized = " ".join((prompt or "").casefold().replace("ё", "е").split())
    phrases = (
        "покажи мне команды",
        "покажи команды",
        "покажи список команд",
        "покажи мне список команд",
        "выведи команды",
        "выведи список команд",
        "какие команды",
        "какие есть команды",
        "какие у меня команды",
        "список команд",
        "список доступных команд",
        "доступные команды",
        "команды бота",
        "покажи доступные команды",
    )
    return normalized in phrases or any(
        normalized.startswith(phrase + " ") for phrase in phrases
    )


def _is_memory_clear_request(prompt: str) -> bool:
    normalized = " ".join((prompt or "").casefold().replace("ё", "е").split())
    phrases = (
        "забудь мою историю",
        "забудь историю",
        "очисти мою историю",
        "очисти историю",
        "удали мою историю",
        "удали историю",
        "забудь все обо мне",
        "забудь всё обо мне",
    )
    return normalized in phrases


async def _answer_ai(message: types.Message, prompt: str):
    role = _ai_role(message)
    text = (prompt or "").strip()
    if _is_memory_clear_request(text):
        removed = clear_history(message.from_user.id, message.chat.id)
        from services.ai_service import _HISTORY
        _HISTORY.pop((message.from_user.id, message.chat.id), None)
        await message.reply(
            "🧠 Память этого диалога очищена. "
            f"Удалено записей: <b>{removed}</b>."
        )
        return
    if not text:
        await message.reply(_ai_intro(role))
        return
    direct_action = detect_direct_action(text)
    if direct_action == "help" or _is_command_catalog_request(text):
        from handlers.help.command_help import _render_help_root
        await _render_help_root(message, role=role)
        return
    if direct_action == "panel":
        from handlers.help.command_help import _render_panel_root_message
        if not (is_owner(message.from_user.id) or has_moderator_role(message.from_user.id, message.chat.id)):
            await message.reply("⛔ Панель доступна только персоналу.")
            return
        await _render_panel_root_message(message)
        return
    if direct_action == "profile":
        await info_msg(message)
        return
    if direct_action == "chatinfo":
        await chatinfo_cmd(message)
        return
    if direct_action in {"system_stats", "system_info"}:
        if not (is_owner(message.from_user.id) or has_admin_role(message.from_user.id, message.chat.id)):
            await message.reply("⛔ Системная статистика доступна только персоналу.")
            return
        summary = system_summary()
        await message.reply(
            "<b>🛰 ИНФОРМАЦИЯ О СИСТЕМЕ</b>\n\n"
            f"Пользователей: <b>{summary['registered_users']}</b>\n"
            f"Активных личных чатов: <b>{summary['private_users']}</b>\n"
            f"Зарегистрированных чатов: <b>{summary['registered_chats']}</b>"
        )
        return
    if direct_action == "runtime":
        from core.runtime_state import is_paused
        global_state = "активен" if not is_paused() else "стазис"
        chat_state = "активен" if not is_paused(message.chat.id) else "стазис"
        await message.reply(
            "<b>🛰 RUNTIME</b>\n\n"
            f"Глобально: <b>{global_state}</b>\n"
            f"Этот чат: <b>{chat_state}</b>"
        )
        return
    if direct_action in {"status", "diagnostics", "debug", "logs", "ai_diagnostic"}:
        if not is_owner(message.from_user.id):
            await message.reply("⛔ Эта диагностическая функция доступна только Основателю.")
            return
        from main import debug_dispatch, send_logs, ai_diagnostic
        from handlers.runtime_diagnostics import status_command, diagnostics_command
        handler = {
            "status": status_command,
            "diagnostics": diagnostics_command,
            "debug": debug_dispatch,
            "logs": send_logs,
            "ai_diagnostic": ai_diagnostic,
        }[direct_action]
        await handler(message)
        return
    if await _handle_founder_command(message, text):
        return
    context = build_verified_context(message.from_user.id, message.chat.id, text, role=role)
    try:
        await bot.send_chat_action(message.chat.id, "typing")
    except Exception:
        pass
    answer = await generate_reply(message.from_user.id, text, role, verified_context=context, chat_id=message.chat.id)
    if answer:
        await message.reply(escape_for_telegram_html(answer))
    else:
        await message.reply("🧠 AI-модуль сейчас недоступен. Проверьте конфигурацию или используйте /help.")




@dp.message_handler(commands=["aidiag"])
async def ai_diagnostic(message: types.Message):
    """Owner-only AI runtime diagnostic; never reveals the API key."""
    if message.from_user.id != config.owner:
        await message.reply("⛔ Команда доступна только Основателю.")
        return

    status = ai_status()
    configured = "✅ задан" if status["configured"] else "❌ НЕ задан"
    last_error = _LAST_ERROR.get("value") or "нет — запросов с ошибкой ещё не было"
    await message.answer(
        "<b>🧠 AI DIAGNOSTIC</b>\n"
        f"Ключ: {configured}\n"
        f"Модель: <code>{status['model']}</code>\n"
        f"Последняя ошибка: <code>{escape_for_telegram_html(redact(last_error, 1500))}</code>\n\n"
        "Для проверки ответа отправьте: <code>/ai привет</code>"
    )


def _looks_like_founder_command(prompt: str) -> bool:
    text = prompt.lower().replace("ё", "е")
    hints = (
        "стазис", "стазиз", "режим тишины", "пробуди", "пробуждение",
        "включи", "активируй", "выключи", "отмени", "разбуди",
    )
    return any(hint in text for hint in hints)


@dp.message_handler(
    lambda m: bool(
        m.text
        and not m.text.startswith("/")
        and m.from_user.id != config.owner
        and not is_max_positive(m.from_user.id, config.owner)
        and detect_direct_action(m.text) in {
            "help",
            "panel",
            "profile",
            "chatinfo",
            "system_stats",
            "runtime",
            "status",
            "diagnostics",
            "debug",
            "ai_diagnostic",
            "logs",
            "system_info",
            "unsupported_settings",
        }
    )
)
async def direct_informational_action(message: types.Message):
    """Handle recognized safe informational requests without requiring an AI invocation prefix."""
    await _answer_ai(message, message.text)


async def _handle_founder_command(message: types.Message, prompt: str):
    """Founder gets a direct command path; scope defaults to current chat unless global is explicit."""
    if message.from_user.id != config.owner or not _looks_like_founder_command(prompt):
        return False

    intent = await interpret(prompt)
    if not intent:
        return False

    if intent.get("scope") == "unknown":
        # Founder commands are not stalled by a scope interrogation.
        # Explicit global wording still wins; otherwise the safe default is this chat.
        intent["scope"] = "chat"

    result = await execute(message.from_user.id, message.chat.id, intent, confirmed=True)
    if result:
        await message.reply(result)
        return True
    return False



@dp.message_handler(
    lambda m: bool(
        m.text
        and m.from_user.id == config.owner
        and has_pending(m.from_user.id, m.chat.id)
        and is_founder_scope_reply(m.text)
        and not m.text.startswith("/")
    )
)
async def founder_command_scope(message: types.Message):
    text = message.text.lower().replace("ё", "е").strip()
    if text in {"везде", "глобально", "во всех чатах", "весь бот", "повсеместно"}:
        scope = "global"
    elif text in {"в этом чате", "этот чат", "здесь", "только здесь", "в этом мире", "только в этом мире"}:
        scope = "chat"
    else:
        await message.reply(pending_prompt())
        return

    intent = pop_pending(message.from_user.id, message.chat.id)
    if not intent:
        return
    intent["scope"] = scope
    result = await execute(message.from_user.id, message.chat.id, intent)
    if result:
        await message.reply(result)

def _ai_invocation(text: str, *, include_alternates: bool = False) -> str | None:
    normalized = (text or "").strip()
    if not normalized:
        return None
    names = invocation_names()
    if include_alternates:
        names = tuple(dict.fromkeys((*names, *alternate_names())))
    slash_names = ("ai", *names)
    slash_pattern = (
        r"^/(?:"
        + "|".join(re.escape(name) for name in slash_names)
        + r")(?:\s|$)"
    )
    slash_match = re.match(slash_pattern, normalized, re.IGNORECASE)
    if slash_match:
        return normalized[slash_match.end():].strip()

    natural_pattern = (
        r"^(?:"
        + "|".join(re.escape(name) for name in names)
        + r")(?:[,,:]|\s|$)"
    )
    natural_match = re.match(natural_pattern, normalized, re.IGNORECASE)
    if natural_match:
        return normalized[natural_match.end():].strip()
    return None


@dp.message_handler(lambda m: bool(m.text and _ai_invocation(m.text) is not None))
async def direct_ai_invocation(message: types.Message):
    user_id = message.from_user.id
    if not can_call(user_id, config.owner):
        return
    invocation = _ai_invocation(
        message.text,
        include_alternates=is_max_positive(user_id, config.owner),
    )
    if invocation is not None:
        await _answer_ai(message, invocation)


@dp.message_handler(commands=["forget", "забудь"], commands_prefix="/!.")
async def slash_forget_ai_memory(message: types.Message):
    """Let a user erase only their own AI memory, without affecting anyone else."""
    removed = clear_history(message.from_user.id, message.chat.id)
    from services.ai_service import _HISTORY
    _HISTORY.pop((message.from_user.id, message.chat.id), None)
    await message.reply(
        "🧠 Память этого диалога очищена. "
        f"Удалено записей: <b>{removed}</b>."
    )


@dp.message_handler(commands=["cancel"], commands_prefix="/!.")
async def slash_cancel_pending_request(message: types.Message):
    if not (is_owner(message.from_user.id) or has_moderator_role(message.from_user.id, message.chat.id)):
        await message.reply("⛔ /cancel доступна только персоналу.")
        return
    if cancel_current_action(message.from_user.id, message.chat.id):
        await message.reply("↩️ Ладно. Отставить. Текущее действие отменено. Ничего не выполняю.")
    else:
        await message.reply("ℹ️ Сейчас нет действия, которое можно отменить.")


@dp.message_handler(lambda m: bool(m.text and is_cancel_request(m.text)))
async def cancel_pending_request(message: types.Message):
    if not (is_owner(message.from_user.id) or has_moderator_role(message.from_user.id, message.chat.id)):
        await message.reply("⛔ Отмена доступна только персоналу.")
        return
    if cancel_current_action(message.from_user.id, message.chat.id):
        await message.reply("↩️ Ладно. Отставить. Текущее действие отменено. Ничего не выполняю.")
    else:
        await message.reply("ℹ️ Сейчас нет действия, которое можно отменить.")


@dp.message_handler(
    lambda m: bool(
        m.text
        and has_pending_moderation(m.from_user.id, m.chat.id)
        and not m.text.startswith("/")
        and m.text.casefold().strip() in {"подтверждаю", "подтверждаю действие", "да, подтверждаю", "отмена", "отменить", "нет"}
    )
)
async def natural_moderation_confirmation(message: types.Message):
    await moderation_confirmation(message)


@dp.message_handler(
    lambda m: bool(
        m.text
        and m.chat.type in {"group", "supergroup"}
        and (
            detect_moderation_action(_ai_invocation(m.text) or "")
            if _ai_invocation(m.text) is not None
            else detect_moderation_action(m.text)
        )
    )
)
async def natural_moderation_command(message: types.Message):
    """Route both direct and AI-prefixed natural moderation commands."""
    prompt = _ai_invocation(message.text)
    if prompt is None:
        prompt = message.text.strip()
    await request_moderation(message, prompt)


async def moderation_confirmation(message: types.Message):
    answer = message.text.casefold().strip()
    if answer in {"отмена", "отменить", "нет"}:
        from services.moderation_gateway import pop as pop_moderation
        pop_moderation(message.from_user.id, message.chat.id)
        await message.reply("↩️ Действие отменено. Ничего не изменено.")
        return
    await confirm_moderation(message)



def _render_issue_list(rows) -> str:
    if not rows:
        return "🧪 <b>QA-метки</b>\nСписок пуст."
    return "🧪 <b>QA-метки</b>\n\n" + "\n\n".join(
        escape_for_telegram_html(render_marker(row)) for row in rows
    )


@dp.message_handler(
    lambda m: bool(
        m.text
        and m.text.casefold().strip() in {"метки", "список меток", "/метки", "/issues", "issues"}
    )
)
async def issue_control(message: types.Message):
    if message.from_user.id != config.owner:
        await message.reply("⛔ Команда доступна только Основателю.")
        return
    rows = list_markers()
    rendered = _render_issue_list(rows)
    if message.chat.type == "private":
        await message.reply(rendered)
    else:
        await bot.send_message(config.owner, rendered)
        await message.reply("📬 Список QA-меток отправлен Основателю в личные сообщения.")


_REPORT_PENDING: dict[tuple[int, int], int] = {}


def _report_reason(message: types.Message) -> str | None:
    text = (message.text or "").strip()
    if text.casefold().startswith("/report"):
        return text[7:].strip()
    if text.casefold().startswith("репорт"):
        return text[6:].strip(" :,-")
    if message.forward_from or message.forward_from_chat:
        return (message.caption or "").strip()
    return None


def _is_report_request(message: types.Message) -> bool:
    text = (message.text or "").strip().casefold()
    return (
        text.startswith("/report")
        or text.startswith("/q ") or text == "/q"
        or text.startswith("/r ")
        or text == "/r"
        or text == "репорт"
        or text.startswith("репорт ")
        or bool(message.forward_from or message.forward_from_chat) and not text
    )


@dp.message_handler(
    lambda m: bool(m.content_type and _is_report_request(m))
)
async def unified_report_request(message: types.Message):
    reason = _report_reason(message)
    if message.forward_from or message.forward_from_chat:
        payload = message.text or message.caption or "Пересланное сообщение"
        target_id = getattr(message.forward_from, "id", None)
    else:
        payload = message.reply_to_message.text if message.reply_to_message else None
        target_id = (
            message.reply_to_message.from_user.id
            if message.reply_to_message and message.reply_to_message.from_user
            else None
        )
    if not reason and not message.reply_to_message and not (message.forward_from or message.forward_from_chat):
        await message.reply(
            "📬 Укажите суть обращения. Можно написать "
            "<code>репорт &lt;текст&gt;</code> или ответить «репорт» на сообщение."
        )
        return
    report_id = create_report(
        reporter_id=message.from_user.id,
        reporter_name=message.from_user.full_name,
        source_chat_id=message.chat.id,
        source_message_id=message.message_id,
        target_user_id=target_id,
        reason=reason or "Жалоба по сообщению",
        payload=payload,
    )
    recipients = tuple(dict.fromkeys((config.owner, *getattr(config, "tech_team_ids", ()))) )
    notification = (
        "<b>📬 НОВЫЙ РЕПОРТ</b>\n"
        f"ID: <code>#{report_id}</code>\n"
        f"От: <b>{escape_for_telegram_html(message.from_user.full_name)}</b> "
        f"(<code>{message.from_user.id}</code>)\n"
        f"Источник чата: <code>{message.chat.id}</code>\n"
        f"Причина: <b>{escape_for_telegram_html(reason or 'Жалоба по сообщению')}</b>\n\n"
        "ℹ️ Репорты — для жалоб, обращений и запросов. Технические ошибки фиксируются внутренними QA-метками."
    )
    for recipient_id in recipients:
        try:
            await bot.send_message(
                recipient_id,
                notification,
                reply_markup=InlineKeyboardMarkup().add(
                    InlineKeyboardButton("📖 Открыть репорт", callback_data=f"report:view:{report_id}")
                ),
            )
            if recipient_id != message.from_user.id:
                try:
                    await message.copy_to(recipient_id)
                except Exception:
                    pass
        except Exception:
            logging.exception("Could not notify report recipient %s", recipient_id)
    await message.reply(f"📬 Репорт #{report_id} принят. Ответ будет направлен отдельно.")


@dp.callback_query_handler(lambda c: c.data == "panel:reports")
async def panel_reports(call: types.CallbackQuery):
    if not _is_report_operator(call.from_user.id, call.message.chat.id):
        await call.answer("Нет доступа.", show_alert=True)
        return
    rows = list_open() if is_owner(call.from_user.id) else list_open(source_chat_id=call.message.chat.id)
    menu = InlineKeyboardMarkup(row_width=1)
    for row in rows:
        menu.add(
            InlineKeyboardButton(
                f"#{row['id']} · {str(row['reason'])[:42]}",
                callback_data=f"report:view:{row['id']}",
            )
        )
    menu.add(InlineKeyboardButton("◀️ Назад", callback_data="panel:back"))
    from handlers.help.command_help import _panel_edit
    await _panel_edit(
        call,
        "<b>📬 ЦЕНТР ОБРАЩЕНИЙ</b>\n\n"
        + (f"Открытых репортов: <b>{len(rows)}</b>" if rows else "Открытых репортов нет."),
        reply_markup=menu,
    )


@dp.callback_query_handler(lambda c: c.data.startswith("report:view:"))
async def report_view(call: types.CallbackQuery):
    if not _is_report_operator(call.from_user.id, call.message.chat.id):
        await call.answer("Нет доступа к центру обращений.", show_alert=True)
        return
    try:
        report_id = int(call.data.rsplit(":", 1)[-1])
    except ValueError:
        await call.answer("Некорректный ID.", show_alert=True)
        return
    row = get_report(report_id) if is_owner(call.from_user.id) else get_report(report_id, call.message.chat.id)
    if row is None:
        await call.answer("Репорт не найден.", show_alert=True)
        return
    text = (
        "<b>📬 РЕПОРТ #" + str(row["id"]) + "</b>\n\n"
        f"Статус: <b>{row['status']}</b>\n"
        f"Автор: <b>{escape_for_telegram_html(str(row['reporter_name'] or row['reporter_id']))}</b>\n"
        f"Причина: <b>{escape_for_telegram_html(str(row['reason']))}</b>\n"
        f"Создан: <code>{escape_for_telegram_html(str(row['created_at']))}</code>\n"
        f"Сообщение: <code>{escape_for_telegram_html(str(row['payload'] or 'не сохранено'))}</code>"
        + (f"\nОтвет: <b>{escape_for_telegram_html(str(row['answer_text']))}</b>" if row['answer_text'] else "")
    )
    menu = InlineKeyboardMarkup(row_width=1)
    if row["status"] == "open":
        menu.add(InlineKeyboardButton("✉️ Ответить", callback_data=f"report:answer:{row['id']}"))
    menu.add(InlineKeyboardButton("◀️ Назад", callback_data="panel:back"))
    from handlers.help.command_help import _panel_edit
    await _panel_edit(call, text, reply_markup=menu)


@dp.callback_query_handler(lambda c: c.data.startswith("report:answer:"))
async def report_answer_start(call: types.CallbackQuery):
    if not _is_report_operator(call.from_user.id, call.message.chat.id):
        await call.answer("Нет доступа к центру обращений.", show_alert=True)
        return
    try:
        report_id = int(call.data.rsplit(":", 1)[-1])
    except ValueError:
        await call.answer("Некорректный ID.", show_alert=True)
        return
    row = get_report(report_id) if is_owner(call.from_user.id) else get_report(report_id, call.message.chat.id)
    if row is None or row["status"] != "open":
        await call.answer("Репорт уже закрыт или не найден.", show_alert=True)
        return
    _REPORT_PENDING[(call.from_user.id, call.message.chat.id)] = report_id
    from handlers.help.command_help import _panel_edit
    await _panel_edit(
        call,
        f"✉️ <b>Ответ на репорт #{report_id}</b>\n\n"
        "Отправьте следующим сообщением текст ответа. "
        "Он будет направлен автору репорта.",
        reply_markup=InlineKeyboardMarkup().add(
            InlineKeyboardButton("◀️ Отмена", callback_data="panel:back")
        ),
    )
    await call.answer()


@dp.message_handler(
    lambda m: bool((m.from_user.id, m.chat.id) in _REPORT_PENDING and m.text and not m.text.startswith("/"))
)
async def report_answer_message(message: types.Message):
    key = (message.from_user.id, message.chat.id)
    report_id = _REPORT_PENDING.get(key)
    if report_id is None:
        return
    if not _is_report_operator(message.from_user.id, message.chat.id):
        _REPORT_PENDING.pop(key, None)
        await message.reply("⛔ Доступ к центру обращений больше не подтверждён.")
        return
    _REPORT_PENDING.pop(key, None)
    row = get_report(report_id) if is_owner(message.from_user.id) else get_report(report_id, message.chat.id)
    if row is None or row["status"] != "open":
        await message.reply("⚠️ Репорт уже закрыт или не найден.")
        return
    try:
        await bot.send_message(
            row["reporter_id"],
            f"📬 <b>Ответ по вашему репорту #{report_id}</b>\n\n"
            + escape_for_telegram_html(message.text.strip()),
        )
    except Exception:
        await message.reply(
            "⚠️ Не удалось доставить ответ в личные сообщения автору. "
            "Попросите его открыть личный чат с Аи."
        )
        return
    if not answer_report(
        report_id,
        message.from_user.id,
        message.text.strip(),
        source_chat_id=None if is_owner(message.from_user.id) else message.chat.id,
    ):
        await message.reply("⚠️ Не удалось закрыть репорт: он уже изменён или больше не относится к этому чату.")
        return
    await message.reply(f"✅ Ответ по репорту #{report_id} отправлен.")


_PanelKey = tuple[int, int]
_PANEL_PENDING: dict[_PanelKey, dict] = {}


@dp.message_handler(
    lambda m: bool(
        m.reply_to_message
        and (m.from_user.id, m.chat.id) in _PANEL_PENDING
        and m.text
        and not m.text.startswith("/")
    )
)
async def panel_pending_action(message: types.Message):
    pending = _PANEL_PENDING.pop((message.from_user.id, message.chat.id), None)
    if not pending:
        return
    if pending["kind"] == "moderation":
        action = pending["action"]
        suffix = ""
        if action in {"mute", "ban"}:
            suffix = " " + message.text.strip()
        else:
            suffix = ""
        phrase = {
            "mute": "мут",
            "unmute": "снять мут",
            "ban": "бан",
            "unban": "разбанить",
        }[action] + suffix
        handled = await request_moderation(message, phrase)
        if not handled:
            await message.reply("⚠️ Не удалось сформировать действие. Проверьте цель и параметры.")
        return
    if pending["kind"] == "welcome":
        if not (is_owner(message.from_user.id) or has_moderator_role(message.from_user.id, message.chat.id)):
            await message.reply("⛔ Доступ к настройке приветствия больше не подтверждён.")
            return
        if pending.get("chat_id") != message.chat.id:
            await message.reply("⛔ Это действие относится к другому чату и было отменено.")
            return
        if message.chat.type not in {"group", "supergroup"}:
            await message.reply("⛔ Приветствие можно установить только в группе или супергруппе.")
            return
        text_value = (message.text or "").strip()
        if not text_value:
            await message.reply("❗ Нужен текст приветствия.")
            return
        chats.cursor.execute("UPDATE chats SET welcome = ? WHERE chat_id = ?", (text_value[:1000], message.chat.id))
        chats.connect.commit()
        await message.reply("✅ Единое приветствие сохранено.")
        return
    if pending["kind"] == "invocation_names":
        if not is_owner(message.from_user.id):
            await message.reply("⛔ Только Основатель может менять имена вызова Аи.")
            return
        value = (message.text or "").strip()
        if not value:
            await message.reply("❗ Укажите хотя бы одно имя.")
            return
        if pending["target"] == "primary":
            names = set_invocation_names(value, actor_id=message.from_user.id)
            await message.reply("✅ Основные имена вызова: <b>" + escape_for_telegram_html(", ".join(names)) + "</b>")
        else:
            names = set_alternate_names(value, actor_id=message.from_user.id)
            await message.reply("✅ Альтернативные имена: <b>" + escape_for_telegram_html(", ".join(names)) + "</b>")
        return

    if pending["kind"] == "relation":
        if not is_owner(message.from_user.id):
            await message.reply("⛔ Только Основатель может менять отношение Аи.")
            return
        if not message.reply_to_message:
            await message.reply("❗ Ответьте на сообщение пользователя, для которого меняется отношение.")
            return
        target_id = message.reply_to_message.from_user.id
        if target_id == config.owner:
            await message.reply("👑 Отношение к Основателю фиксировано на максимальном уровне.")
            return
        score = int(pending["score"])
        value = set_score(target_id, score, config.owner, actor_id=message.from_user.id)
        if pending.get("block") is not None:
            set_calls_blocked(target_id, pending["block"], config.owner, actor_id=message.from_user.id)
        await message.reply(
            f"🤝 Отношение Аи обновлено: <b>{value}/100</b>."
            + ("\n🔕 Вызовы Аи заблокированы." if pending.get("block") else "")
        )
        return

    if pending["kind"] == "role":
        target = message.reply_to_message.from_user
        target_role = pending["target_role"]
        if target.id == message.from_user.id:
            await message.reply("⛔ Нельзя назначить роль самому себе через административную панель.")
            return
        if not await _apply_panel_role(message, target.id, target_role):
            await message.reply("⛔ Роль не может быть назначена этому пользователю.")
        return


async def _apply_panel_role(message: types.Message, target_user_id: int, target_role: str) -> bool:
    actor_id = message.from_user.id
    actor_role = _panel_role(actor_id, message.chat.id)
    if target_role not in available_role_targets(actor_role, actor_is_owner=is_owner(actor_id)):
        return False
    row = users.cursor.execute("SELECT id FROM users WHERE id = ?", (target_user_id,)).fetchone()
    if row is None:
        await message.reply("❗ Пользователь не зарегистрирован в Системе.")
        return False
    if not set_role(message.chat.id, target_user_id, target_role, actor_id):
        return False
    from services.role_audit import record_role_grant
    record_role_grant(chat_id=message.chat.id, actor_id=actor_id, target_id=target_user_id, role=target_role)
    await message.reply(
        f"✅ Роль пользователя обновлена: <b>{escape_for_telegram_html(target_role)}</b>."
    )
    return True

#chatinfo
@dp.message_handler(commands=['chatinfo', 'чатинфо'], commands_prefix='/!.')
async def chatinfo_cmd(message: types.Message):
    target_chat_id = message.chat.id
    args = (message.get_args() or "").strip()
    if args:
        if not is_owner(message.from_user.id):
            await message.reply("Только Основатель может запрашивать информацию о другом чате.")
            return
        try:
            target_chat_id = int(args)
        except ValueError:
            await message.reply("Укажите корректный chat_id.")
            return
    summary = chat_summary(target_chat_id)
    if summary is None and target_chat_id == message.chat.id:
        await message.reply("Этот чат ещё не зарегистрирован в Системе.")
        return
    try:
        tg_chat = await bot.get_chat(target_chat_id)
        members = await bot.get_chat_members_count(target_chat_id)
        admins = await bot.get_chat_administrators(chat_id=target_chat_id)
        try:
            await sync_chat_admins(bot, target_chat_id)
        except Exception:
            pass
    except Exception:
        if target_chat_id != message.chat.id:
            await message.reply("Telegram не предоставил доступ к этому чату.")
            return
        tg_chat = message.chat
        members = None
        admins = []
    name = getattr(tg_chat, "title", None) or (summary or {}).get("name") or "—"
    username = getattr(tg_chat, "username", None) or (summary or {}).get("username") or "—"
    await message.answer(
        "<b>💬 ИНФОРМАЦИЯ О ЧАТЕ</b>\\n\\n"
        f"Название: <b>{escape_for_telegram_html(str(name))}</b>\\n"
        f"Username: <code>{escape_for_telegram_html(str(username))}</code>\\n"
        f"Тип: <b>{escape_for_telegram_html(str(getattr(tg_chat, 'type', '—')))}</b>\\n"
        f"ID: <code>{target_chat_id}</code>\\n"
        f"Участников по Telegram: <b>{members if members is not None else 'нет данных'}</b>\\n"
        f"Администраторов: <b>{len(admins)}</b>\\n"
        f"Регистрация в Системе: <code>{escape_for_telegram_html(str((summary or {}).get('system_registered_at') or '—'))}</code>"
    )

#profile_msg
@dp.message_handler(commands=["info", "инфо", "инфа"], commands_prefix="/!.")
@dp.message_handler(lambda msg: bool(msg.text and msg.text.casefold().strip() == "инфа"))
async def info_msg(message):
    summary = user_summary(message.from_user.id, message.chat.id)
    if summary is None:
        await message.reply("Вы ещё не зарегистрированы в Системе. Откройте личный чат и выполните первичный запуск.")
        return
    await message.reply(
        "<b>👤 ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ</b>\n\n"
        f"Имя: <b>{escape_for_telegram_html(str(summary.get('name') or '—'))}</b>\n"
        f"Username: <code>{escape_for_telegram_html(str(summary.get('username') or '—'))}</code>\n"
        f"ID: <code>{summary.get('id')}</code>\n"
        f"Роль: <b>{escape_for_telegram_html(str(summary.get('status') or '—'))}</b>\n"
        f"Регистрация в Системе: <code>{escape_for_telegram_html(str(summary.get('system_registered_at') or '—'))}</code>\n"
        "Регистрация в Telegram: <b>не предоставляется Telegram Bot API</b>",
    )




@dp.message_handler(
    lambda m: bool(
        m.text
        and m.from_user.id == config.owner
        and not m.text.startswith("/")
        and not is_cancel_request(m.text)
        and not has_pending(m.from_user.id, m.chat.id)
        and not has_pending_moderation(m.from_user.id, m.chat.id)
        and not (m.from_user.id, m.chat.id) in globals().get("_PANEL_PENDING", {})
        and not (m.from_user.id, m.chat.id) in globals().get("_REPORT_PENDING", {})
    )
)
async def founder_natural_ai(message: types.Message):
    """Founder may address Аи naturally without a slash command or invocation name."""
    await _answer_ai(message, message.text)


@dp.message_handler(
    lambda m: bool(
        m.text
        and not m.text.startswith("/")
        and m.from_user.id != config.owner
        and is_max_positive(m.from_user.id, config.owner)
        and not is_cancel_request(m.text)
        and not has_pending(m.from_user.id, m.chat.id)
        and not has_pending_moderation(m.from_user.id, m.chat.id)
        and not (m.from_user.id, m.chat.id) in globals().get("_PANEL_PENDING", {})
        and not (m.from_user.id, m.chat.id) in globals().get("_REPORT_PENDING", {})
    )
)
async def max_relationship_natural_ai(message: types.Message):
    """100% relationship unlocks invocation-free AI replies for this user."""
    await _answer_ai(message, message.text)

