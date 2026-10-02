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
from services.issue_tracker import list_markers, render_marker
from services.report_service import create_report, list_open, get_report, answer_report, reminder_loop

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

from core.permissions import get_user_status, has_admin_role, has_moderator_role
from core.identity import is_owner, resolve_role
from core.role_transitions import available_role_targets
from core.command_resolution import is_founder_scope_reply


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

        if throttled.exceeded_count <= 2:
            await message.reply('❎ | Не спамь!')
            

#Обращение
@dp.message_handler(commands=['обращение', 'q', 'вопрос'], commands_prefix='/!.')
async def cmd_quest(message: types.Message):
    id = message.from_user.id
    await message.answer(f'📥 | <b>Отправьте текст/фото для обращения:</b>')
    await Quest.msg.set()

@dp.message_handler(content_types=ContentType.ANY, state=Quest.msg)
async def quest_msgl(message: types.Message, state: FSMContext):
    await state.finish()
    owner = config.owner
    name = message.from_user.get_mention(as_html=True)
    bot_msg = await message.answer(f'Обращение отправляется...')
    await bot.send_message(owner, f'Получено обращение!\n\nОтправитель: {name}\nID: {message.from_user.id}\nЮзернейм: @{message.from_user.username}\n\nОбращение:')
    await message.copy_to(owner)
    await bot_msg.edit_text(f'📤 Обращение отправлено!')

# Аи — персональный помощник Системы.
# Без текста команда отвечает в характерном стиле по роли пользователя.
# С текстом передаёт вопрос в AI-провайдер, поэтому ответы не нужно
# прописывать вручную в коде.
def _ai_role(message: types.Message) -> str:
    if message.from_user.id == config.owner:
        return "Основатель"
    status = get_user_status(message.from_user.id)
    if status == "Администратор":
        return "Администратор"
    if status == "Хелпер":
        return "Хелпер"
    if status == "Модератор":
        return "Модератор"
    return "Пользователь"


def _ai_intro(role: str) -> str:
    if role == "Основатель":
        return "👑 ОСНОВАТЕЛЬ · Я слушаю. Система в полном распоряжении. Приказывайте."
    if role == "Администратор":
        return "🛡️ АДМИНИСТРАТОР · Я слушаю. Полномочия подтверждены. Что прикажете?"
    if role == "Хелпер":
        return "👮 ХЕЛПЕР · Я слушаю. Полномочия подтверждены. Что прикажете?"
    if role == "Модератор":
        return "🔨 МОДЕРАТОР · Я слушаю. Полномочия подтверждены. Что прикажете?"
    return "👤 ПОЛЬЗОВАТЕЛЬ · Я слушаю. Обращайтесь ко мне через «Аи» или «Система»."


@dp.message_handler(commands=["aidiag"])
async def ai_diagnostic(message: types.Message):
    """Owner-only AI runtime diagnostic; never reveals the API key."""
    if message.from_user.id != config.owner:
        return

    status = ai_status()
    configured = "✅ задан" if status["configured"] else "❌ НЕ задан"
    last_error = _LAST_ERROR.get("value") or "нет — запросов с ошибкой ещё не было"
    await message.answer(
        "<b>🧠 AI DIAGNOSTIC</b>\n"
        f"Ключ: {configured}\n"
        f"Модель: <code>{status['model']}</code>\n"
        f"Последняя ошибка: <code>{last_error[:1500]}</code>\n\n"
        "Для проверки ответа отправьте: <code>/ai привет</code>"
    )


def _looks_like_founder_command(prompt: str) -> bool:
    text = prompt.lower().replace("ё", "е")
    hints = (
        "стазис", "стазиз", "режим тишины", "пробуди", "пробуждение",
        "включи", "активируй", "выключи", "отмени", "разбуди",
    )
    return any(hint in text for hint in hints)


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

def _ai_invocation(text: str) -> str | None:
    normalized = (text or "").strip()
    if not normalized:
        return None
    if normalized.startswith("/аи") or normalized.startswith("/ai"):
        parts = normalized.split(maxsplit=1)
        return parts[1].strip() if len(parts) > 1 else ""
    if re.match(r"^аи(?:[,,:]|\\s)", normalized, re.IGNORECASE):
        return re.sub(r"^аи(?:[,,:]|\\s)+", "", normalized, flags=re.IGNORECASE).strip()
    return None


@dp.message_handler(
    lambda m: bool(
        m.text
        and is_cancel_request(m.text)
        and (
            has_pending(m.from_user.id, m.chat.id)
            or has_pending_moderation(m.from_user.id, m.chat.id)
        )
    )
)
async def cancel_pending_request(message: types.Message):
    cancelled = cancel_pending(message.from_user.id, message.chat.id)
    moderation_cancelled = False
    if has_pending_moderation(message.from_user.id, message.chat.id):
        from services.moderation_gateway import pop as pop_moderation
        pop_moderation(message.from_user.id, message.chat.id)
        moderation_cancelled = True
    if cancelled or moderation_cancelled:
        await message.reply("↩️ Ладно. Отставить. Незавершённый запрос отменён, ничего не выполняю.")
        return True


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
        and m.from_user.id == config.owner
    )
)
async def issue_control(message: types.Message):
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
    if text.casefold().startswith("/r"):
        return text[2:].strip()
    if text.casefold().startswith("репорт"):
        return text[6:].strip(" :,-")
    if message.forward_from or message.forward_from_chat:
        return (message.caption or "").strip()
    return None


def _is_report_request(message: types.Message) -> bool:
    text = (message.text or "").strip().casefold()
    return (
        text.startswith("/report")
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
            "📬 Укажите суть обращения. Можно написать «репорт <текст>» "
            "или ответить «репорт» на сообщение."
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
    try:
        await bot.send_message(
            config.owner,
            "<b>📬 НОВЫЙ РЕПОРТ</b>\n"
            f"ID: <code>#{report_id}</code>\n"
            f"От: <b>{escape_for_telegram_html(message.from_user.full_name)}</b> "
            f"(<code>{message.from_user.id}</code>)\n"
            f"Причина: <b>{escape_for_telegram_html(reason or 'Жалоба по сообщению')}</b>",
            reply_markup=InlineKeyboardMarkup().add(
                InlineKeyboardButton("📖 Открыть репорт", callback_data=f"report:view:{report_id}")
            ),
        )
    except Exception:
        logging.exception("Could not notify owner about report")
    await message.reply(f"📬 Репорт #{report_id} принят. Ответ будет направлен отдельно.")


@dp.callback_query_handler(lambda c: c.data == "panel:reports")
async def panel_reports(call: types.CallbackQuery):
    if not is_owner(call.from_user.id) and not has_admin_role(call.from_user.id):
        await call.answer("Нет доступа.", show_alert=True)
        return
    rows = list_open()
    menu = InlineKeyboardMarkup(row_width=1)
    for row in rows:
        menu.add(
            InlineKeyboardButton(
                f"#{row['id']} · {str(row['reason'])[:42]}",
                callback_data=f"report:view:{row['id']}",
            )
        )
    menu.add(InlineKeyboardButton("◀️ Назад", callback_data="panel:root"))
    await call.message.edit_text(
        "<b>📬 ЦЕНТР ОБРАЩЕНИЙ</b>\n\n"
        + (f"Открытых репортов: <b>{len(rows)}</b>" if rows else "Открытых репортов нет."),
        reply_markup=menu,
    )


@dp.callback_query_handler(lambda c: c.data.startswith("report:view:"))
async def report_view(call: types.CallbackQuery):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    try:
        report_id = int(call.data.rsplit(":", 1)[-1])
    except ValueError:
        await call.answer("Некорректный ID.", show_alert=True)
        return
    row = get_report(report_id)
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
    )
    menu = InlineKeyboardMarkup(row_width=1)
    if row["status"] == "open":
        menu.add(InlineKeyboardButton("✉️ Ответить", callback_data=f"report:answer:{row['id']}"))
    menu.add(InlineKeyboardButton("◀️ Репорты", callback_data="panel:reports"))
    await call.message.edit_text(text, reply_markup=menu)


@dp.callback_query_handler(lambda c: c.data.startswith("report:answer:"))
async def report_answer_start(call: types.CallbackQuery):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    try:
        report_id = int(call.data.rsplit(":", 1)[-1])
    except ValueError:
        await call.answer("Некорректный ID.", show_alert=True)
        return
    row = get_report(report_id)
    if row is None or row["status"] != "open":
        await call.answer("Репорт уже закрыт или не найден.", show_alert=True)
        return
    _REPORT_PENDING[(call.from_user.id, call.message.chat.id)] = report_id
    await call.message.edit_text(
        f"✉️ <b>Ответ на репорт #{report_id}</b>\n\n"
        "Отправьте следующим сообщением текст ответа. "
        "Он будет направлен автору репорта.",
        reply_markup=InlineKeyboardMarkup().add(
            InlineKeyboardButton("◀️ Отмена", callback_data="panel:reports")
        ),
    )
    await call.answer()


@dp.message_handler(
    lambda m: bool((m.from_user.id, m.chat.id) in _REPORT_PENDING and m.text and not m.text.startswith("/"))
)
async def report_answer_message(message: types.Message):
    report_id = _REPORT_PENDING.pop((message.from_user.id, message.chat.id), None)
    if report_id is None:
        return
    row = get_report(report_id)
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
    answer_report(report_id, message.from_user.id, message.text.strip())
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
    actor_role = _panel_role(actor_id)
    if target_role not in available_role_targets(actor_role, actor_is_owner=is_owner(actor_id)):
        return False
    row = users.cursor.execute("SELECT id FROM users WHERE id = ?", (target_user_id,)).fetchone()
    if row is None:
        await message.reply("❗ Пользователь не зарегистрирован в Системе.")
        return False
    users.cursor.execute("UPDATE users SET status = ? WHERE id = ?", (target_role, target_user_id))
    users.connect.commit()
    await message.reply(
        f"✅ Роль пользователя обновлена: <b>{escape_for_telegram_html(target_role)}</b>."
    )
    return True

#chatinfo
@dp.message_handler(commands=['chatinfo', 'чатинфо'], commands_prefix='/!.')
async def chatinfo_cmd(message: types.Message):
    summary = chat_summary(message.chat.id)
    if summary is None:
        await message.reply("Этот чат ещё не зарегистрирован в Системе.")
        return
    try:
        tg_chat = await bot.get_chat(message.chat.id)
        members = await bot.get_chat_members_count(message.chat.id)
        admins = await bot.get_chat_administrators(chat_id=message.chat.id)
    except Exception:
        tg_chat = message.chat
        members = None
        admins = []
    admin_count = len(admins)
    await message.answer(
        "<b>💬 ИНФОРМАЦИЯ О ЧАТЕ</b>\n\n"
        f"Название: <b>{escape_for_telegram_html(str(getattr(tg_chat, 'title', None) or summary.get('name') or '—'))}</b>\n"
        f"Username: <code>{escape_for_telegram_html(str(getattr(tg_chat, 'username', None) or summary.get('username') or '—'))}</code>\n"
        f"Тип: <b>{escape_for_telegram_html(str(getattr(tg_chat, 'type', '—')))}</b>\n"
        f"ID: <code>{message.chat.id}</code>\n"
        f"Участников по Telegram: <b>{members if members is not None else 'нет данных'}</b>\n"
        f"Администраторов: <b>{admin_count}</b>\n"
        f"Регистрация в Системе: <code>{escape_for_telegram_html(str(summary.get('system_registered_at') or '—'))}</code>"
    )

#profile_msg
@dp.message_handler(lambda msg: bool(msg.text and msg.text.casefold().strip() == "инфа"))
async def info_msg(message):
    summary = user_summary(message.from_user.id)
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


#Рассылка
#Для юзеров
@dp.callback_query_handler(text="rassilka")
async def send_rass(call: types.CallbackQuery):
    status = users.cursor.execute("SELECT status from users where id = ?", (call.from_user.id,)).fetchone()
    status = (status[0])
    if str(status) == 'Система':
        await call.message.edit_text(text='🖋 Введите текст/фото для рассылки:')
        await Rass.msg.set()
    else:
        pass

@dp.message_handler(content_types=ContentType.ANY, state=Rass.msg)
async def rassilka_msgl(message: types.Message, state: FSMContext):
    await state.finish()
    users.cursor.execute(f"SELECT id FROM users")
    users_query = users.cursor.fetchall()
    user_ids = [user[0] for user in users_query]
    nowtim = time.time()
    confirm = []
    decline = []
    bot_msg = await message.answer(f'Рассылка началась...')
    for i in user_ids:
        try:
            await message.copy_to(i)
            confirm.append(i)
        except:
            decline.append(i)
        await asyncio.sleep(0.15)
    nowtime = time.time()
    uptime = round(nowtime - nowtim)
    uptimestr = str(time.strftime("%H:%M:%S", time.gmtime(int(uptime))))
    await bot_msg.edit_text(f'📣 Рассылка завершена!\n\n✅ Успешно: {len(confirm)}\n❌ Неуспешно: {len(decline)}\n⌚ Время: {str(uptimestr)}')

#Для чатов
@dp.callback_query_handler(text="chat_rassilka")
async def send_rass(call: types.CallbackQuery):
    status = users.cursor.execute("SELECT status from users where id = ?", (call.from_user.id,)).fetchone()
    status = (status[0])
    if str(status) == 'Система':
        await call.message.edit_text(text='🖋 Введите текст/фото для рассылки:')
        await ChRass.msg.set()
    else:
        pass

@dp.message_handler(content_types=ContentType.ANY, state=ChRass.msg)
async def rassilka_msgl(message: types.Message, state: FSMContext):
    await state.finish()
    chats.cursor.execute(f"SELECT chat_id FROM chats")
    chats_query = chats.cursor.fetchall()
    chat_ids = [chat[0] for chat in chats_query]
    nowtim = time.time()
    confirm = []
    decline = []
    bot_msg = await message.answer(f'Рассылка началась...')
    for i in chat_ids:
        try:
            await message.copy_to(i)
            confirm.append(i)
        except:
            decline.append(i)
        await asyncio.sleep(0.15)
    nowtime = time.time()
    uptime = round(nowtime - nowtim)
    uptimestr = str(time.strftime("%H:%M:%S", time.gmtime(int(uptime))))
    await bot_msg.edit_text(f'📣 Рассылка завершена!\n\n✅ Успешно: {len(confirm)}\n❌ Неуспешно: {len(decline)}\n⌚ Время: {str(uptimestr)}')
