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
    if status in ("Администратор", "Система"):
        return "Администратор"
    if status == "Хелпер":
        return "Хелпер"
    if status == "Модератор":
        return "Модератор"
    return "Игрок"


def _ai_intro(role: str) -> str:
    if role == "Основатель":
        return "👑 ОСНОВАТЕЛЬ · Я слушаю. Система в полном распоряжении. Приказывайте."
    if role == "Администратор":
        return "🛡️ АДМИНИСТРАТОР · Я слушаю. Полномочия подтверждены. Что прикажете?"
    if role == "Хелпер":
        return "👮 ХЕЛПЕР · Я слушаю. Полномочия подтверждены. Что прикажете?"
    if role == "Модератор":
        return "🔨 МОДЕРАТОР · Я слушаю. Полномочия подтверждены. Что прикажете?"
    return "👤 ИГРОК · ⚠️ Как простолюдин посмел обратиться ко мне? Говори причину своего дерзкого обращения."


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
@dp.message_handler(
    lambda m: bool(
        m.text
        and m.chat.type in {"group", "supergroup"}
        and _ai_invocation(m.text) is not None
        and detect_moderation_action(_ai_invocation(m.text) or "")
    )
)
async def natural_moderation_command(message: types.Message):
    """Admin/moderation commands require an explicit AI invocation."""
    prompt = _ai_invocation(message.text)
    if prompt is None:
        await moderation_confirmation(message)
        return
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
        and parse_marker(m.text)
        and m.reply_to_message is None
        and parse_fixed(m.text) is None
    )
)
async def mark_issue_without_target(message: types.Message):
    await message.reply(
        "🧪 Поняла. Но мне нужно знать, <b>что именно отметить</b>. "
        "Ответьте на проблемное сообщение и напишите причину, например: "
        "<code>отметь ошибка в команде</code>."
    )


@dp.message_handler(
    lambda m: bool(
        m.text
        and parse_marker(m.text)
        and m.reply_to_message is not None
    )
)
async def mark_issue(message: types.Message):
    parsed = parse_marker(message.text)
    marker_id = create_marker(
        chat_id=message.chat.id,
        message_id=message.reply_to_message.message_id,
        reporter_id=message.from_user.id,
        reason=parsed["reason"],
        code=parsed["code"],
        message_text=(
            message.reply_to_message.text
            or message.reply_to_message.caption
            or f"[{message.reply_to_message.content_type}]"
        ),
        message_sender_name=message.reply_to_message.from_user.full_name
        if message.reply_to_message.from_user
        else "неизвестен",
        reporter_name=message.from_user.full_name,
    )
    await message.reply(
        f"📝 Принято. Ошибка отмечена как <code>#{marker_id}</code>. "
        "Причина сохранена; Основатель увидит её в QA-списке."
    )


@dp.message_handler(
    lambda m: bool(
        m.text
        and (
            m.text.casefold().strip() in {"/метки", "/issues", "метки", "список меток", "issues"}
            or parse_fixed(m.text) is not None
        )
        and m.from_user.id == config.owner
    )
)
async def issue_control(message: types.Message):
    fixed_id = parse_fixed(message.text)
    if fixed_id is not None:
        if mark_fixed(fixed_id, message.from_user.id):
            await message.reply(f"✅ QA-метка #{fixed_id} отмечена как исправленная.")
        else:
            await message.reply(f"ℹ️ QA-метка #{fixed_id} не найдена или уже закрыта.")
        return
    rows = list_markers()
    text = _render_issue_list(rows)
    # The list is private by design, even if the command is issued from a group.
    if message.chat.type == "private":
        await message.reply(text)
    else:
        await bot.send_message(config.owner, text)
        await message.reply("📬 Список QA-меток отправлен Основателю в личные сообщения.")


async def _handle_direct_action(message: types.Message, prompt: str, role: str) -> bool:
    """Execute safe informational requests directly instead of asking for slash commands."""
    action = detect_direct_action(prompt)
    if action is None:
        return False

    if action == "help":
        from core.command_help import render_help
        await message.reply(render_help(role))
        return True

    if action == "unsupported_settings":
        await message.reply(
            "⚙️ <b>Настройки</b> сейчас не реализованы в Системе. "
            "Я не буду придумывать несуществующую команду или предлагать фиктивный интерфейс."
        )
        return True

    if action == "profile":
        profile = user_summary(message.from_user.id)
        if profile is None:
            await message.reply("Ты ещё не зарегистрирован в Системе. Используй /start один раз.")
            return True

        username = profile.get("username") or "нет"
        await message.reply(
            "<b>📈 ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ</b>\n"
            f"🏷 Никнейм: <b>{escape_for_telegram_html(str(profile.get('name') or 'Игрок'))}</b>\n"
            f"👤 Статус: <b>{escape_for_telegram_html(str(profile.get('status') or 'Игрок'))}</b>\n"
            f"💰 Баланс: <code>{profile.get('balance', 0)}</code>\n"
            f"🎮 Игр сыграно: <b>{profile.get('games', 0)}</b>\n"
            f"👥 Приглашено: <b>{profile.get('invited_users', 0)}</b>\n"
            f"🕰 Регистрация: <b>{escape_for_telegram_html(str(profile.get('regdata') or 'не указана'))}</b>\n"
            f"🔗 Username: <code>{escape_for_telegram_html(str(username))}</code>"
        )
        return True

    if action == "chatinfo":
        chat = chat_summary(message.chat.id)
        if chat is None:
            # Private chats are valid Telegram chats but are intentionally not
            # stored in the world registry. Still return useful live context.
            if message.chat.type == "private":
                await message.reply(
                    "<b>💬 ТЕКУЩИЙ ЧАТ</b>\n"
                    "Тип: <b>личный диалог</b>\n"
                    f"ID: <code>{message.chat.id}</code>\n"
                    f"Пользователь: <b>{escape_for_telegram_html(str(message.from_user.full_name))}</b>"
                )
            else:
                await message.reply("Этот чат ещё не зарегистрирован в Системе.")
            return True

        try:
            members = await message.chat.get_members_count()
            admins = await bot.get_chat_administrators(chat_id=message.chat.id)
            member_line = f"👥 Участников: <b>{members}</b>\n"
            admin_line = f"👮 Администраторов: <b>{len(admins)}</b>\n"
        except Exception:
            member_line = ""
            admin_line = ""

        await message.reply(
            "<b>💬 ИНФОРМАЦИЯ О ЧАТЕ</b>\n"
            f"🗒 Название: <b>{escape_for_telegram_html(str(chat.get('name') or 'Без названия'))}</b>\n"
            f"📎 Username: <code>{escape_for_telegram_html(str(chat.get('username') or 'нет'))}</code>\n"
            f"🕰 Регистрация: <b>{escape_for_telegram_html(str(chat.get('registered_at') or 'не указана'))}</b>\n"
            f"⚙️ Статус: <b>{escape_for_telegram_html(str(chat.get('status') or 'не указан'))}</b>\n"
            f"🎮 Игр сыграно: <b>{chat.get('games', 0)}</b>\n"
            f"🎯 Игры: <b>{escape_for_telegram_html(str(chat.get('game_rule') or 'не указано'))}</b>\n"
            + member_line
            + admin_line
        )
        return True

    if action == "system_stats":
        if role not in {"Основатель", "Создатель бота", "Администратор", "Система"}:
            await message.reply("⛔ Системная статистика доступна только административным ролям.")
            return True

        stats = system_summary()
        await message.reply(
            "<b>⚙️ СТАТИСТИКА СИСТЕМЫ</b>\n"
            f"👤 Зарегистрированных пользователей: <b>{stats['registered_users']}</b>\n"
            f"💬 Зарегистрированных чатов: <b>{stats['registered_chats']}</b>\n"
            f"📨 Пользователей в Л/С: <b>{stats['private_users']}</b>"
        )
        return True

    if action == "system_info":
        stats = None
        if role in {"Основатель", "Создатель бота", "Администратор", "Система"}:
            stats = system_summary()

        lines = [
            "<b>⚙️ СИСТЕМА «АИ»</b>",
            "Я — интерфейс управления и интеллектуальной поддержки Telegram-бота.",
            "",
            "Мои контуры:",
            "• 🧠 AI-помощник — естественные вопросы и команды",
            "• 📊 Данные — безопасное чтение профилей, чатов и системных счётчиков",
            "• 🛡️ Права — роли и проверка разрешений",
            "• 🛰 Runtime — стазис и пробуждение",
            "• 🔎 Диагностика — проверка состояния модулей",
            "• ✉️ Коммуникация — обращения и служебные функции",
        ]
        if stats is not None:
            lines.extend([
                "",
                "<b>Текущие подтверждённые данные:</b>",
                f"👤 Пользователей: <b>{stats['registered_users']}</b>",
                f"💬 Зарегистрированных чатов: <b>{stats['registered_chats']}</b>",
                f"📨 Личных регистраций: <b>{stats['private_users']}</b>",
            ])
        await message.reply("\n".join(lines))
        return True

    if action == "logs":
        if role != "Основатель":
            await message.reply("⛔ Журнал бота доступен только Основателю.")
            return True

        try:
            with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as log_file:
                content = log_file.read()
        except Exception as exc:
            logging.exception("Could not read bot log")
            await message.reply(
                "⚠️ Не удалось прочитать журнал бота. "
                f"Техническая причина: <code>{escape_for_telegram_html(type(exc).__name__)}</code>"
            )
            return True

        if not content:
            await message.reply("📜 Журнал бота пока пуст.")
            return True

        tail = content[-12000:]
        if len(content) > len(tail):
            tail = "…\n" + tail
        await message.reply(
            f"<b>📜 ПОСЛЕДНИЕ ЛОГИ</b>\n<pre>{escape_for_telegram_html(tail)}</pre>"
        )
        return True

    if action == "runtime":
        state = runtime_summary(message.chat.id)
        await message.reply(
            "<b>🛰 СОСТОЯНИЕ RUNTIME</b>\n"
            f"🌐 Глобальный стазис: <b>{'активен' if state['global_paused'] else 'неактивен'}</b>\n"
            f"💬 Стазис текущего чата: <b>{'активен' if state['current_chat_paused'] else 'неактивен'}</b>"
        )
        return True

    if action == "debug":
        if role != "Основатель":
            await message.reply("⛔ Диагностический режим доступен только Основателю.")
            return True
        await message.reply("DEBUG: обработчик сообщений работает.")
        return True

    if action == "ai_diagnostic":
        if role != "Основатель":
            await message.reply("⛔ AI-диагностика доступна только Основателю.")
            return True
        status = ai_status()
        configured = "✅ задан" if status["configured"] else "❌ НЕ задан"
        last_error = _LAST_ERROR.get("value") or "нет — запросов с ошибкой ещё не было"
        await message.reply(
            "<b>🧠 AI DIAGNOSTIC</b>\n"
            f"Ключ: {configured}\n"
            f"Модель: <code>{escape_for_telegram_html(str(status['model']))}</code>\n"
            f"Последняя ошибка: <code>{escape_for_telegram_html(str(last_error)[:1500])}</code>"
        )
        return True

    return False


async def _answer_ai(message: types.Message, prompt: str):
    role = _ai_role(message)

    if not prompt:
        await message.reply(_ai_intro(role))
        return

    if await _handle_founder_command(message, prompt):
        return

    if await request_moderation(message, prompt):
        return

    if await _handle_direct_action(message, prompt, role):
        return

    try:
        verified_context = build_verified_context(message.from_user.id, message.chat.id, prompt, role)
        answer = await generate_reply(message.from_user.id, prompt, role, verified_context=verified_context)
    except Exception:
        logging.exception("Could not load AI assistant")
        answer = None

    if answer:
        # Bot uses global HTML parse mode; AI output is untrusted and may contain <...>.
        await message.reply(escape_for_telegram_html(answer))
        return

    await message.reply(
        _ai_intro(role)
        + "\n\n"
        + "🧠 Мой интеллектуальный модуль сейчас недоступен. "
          "Если это первый запуск, владельцу нужно добавить GROQ_API_KEY в секреты хоста."
    )


@dp.message_handler(
    lambda m: bool(
        m.text and re.match(
            r"^/(?:аи|ai)(?:@[A-Za-z0-9_]+)?(?:\s+(.*))?$",
            m.text,
            re.IGNORECASE,
        )
    )
)
async def ai_command(message: types.Message):
    await _answer_ai(message, (message.get_args() or "").strip())


@dp.message_handler(lambda m: bool(m.text and (m.text.lower() in ("мила", "аи", "ai") or m.text.lower().startswith(("мила ", "аи ", "ai ", "мила,", "аи,", "ai,")))))
async def bot_msg(message: types.Message):
    match = re.match(r"^(?:мила|аи|ai)\b[\s,:-]*(.*)$", message.text, re.IGNORECASE)
    prompt = match.group(1).strip() if match else ""
    await _answer_ai(message, prompt)


@dp.message_handler(
    lambda m: bool(
        m.text
        and m.from_user.id == config.owner
        and not m.text.startswith("/")
    )
)
async def founder_direct_command(message: types.Message):
    # Founder gets direct execution/read-only system actions without a wake word.
    # Ordinary conversation is not treated as a command; use "Аи, ..." or /ai
    # when a conversational AI response is wanted.
    prompt = message.text.strip()
    if await _handle_founder_command(message, prompt):
        return
    role = _ai_role(message)
    if await _handle_direct_action(message, prompt, role):
        return
    if is_cancel_request(prompt):
        if cancel_pending(message.from_user.id, message.chat.id):
            await message.reply("↩️ Ладно. Отставить. Незавершённый запрос отменён.")
        return


#Девборд
@dp.message_handler(commands=['дев', 'dev'], commands_prefix='/!.')
async def adm_ui(message):
    admins_list = [admin.user.id for admin in await bot.get_chat_administrators(chat_id=message.chat.id)]
    status_row = users.cursor.execute("SELECT status from users where id = ?", (message.from_user.id,)).fetchone()
    status = status_row[0] if status_row else None
    if message.from_user.id in admins_list or str(status) == 'Система':
        admin_menu = InlineKeyboardMarkup()
        statistics_bt = InlineKeyboardButton(text = '📊 Статистика', callback_data = 'stat') # type: ignore
        mail_bt = InlineKeyboardButton(text = '✉️ Рассылка', callback_data = 'rassilka') # type: ignore
        mail_bt2 = InlineKeyboardButton(text = '💬 Чат рассылка', callback_data = 'chat_rassilka')
        ping_bt = InlineKeyboardButton(text = '🖥 Ресурсы бота', callback_data = 'ping')
        cancel_del_menu = InlineKeyboardMarkup()
        cancel_del_bt = InlineKeyboardButton(text = '❌ Закрыть ❌', callback_data = 'cancel_del') # type: ignore
        admin_menu.add(statistics_bt, ping_bt)
        admin_menu.add(mail_bt, mail_bt2)
        admin_menu.add(cancel_del_bt)
        await message.answer('🛠 Выберите пункт меню:', reply_markup=admin_menu)
    else:
        await message.reply(f'Вы не разработчик!')

@dp.callback_query_handler(text='cancel_del')
async def handle_cdel_button(c: types.CallbackQuery):
    status_row = users.cursor.execute("SELECT status from users where id = ?", (c.from_user.id,)).fetchone()
    status = status_row[0] if status_row else None
    if str(status) == 'Система':
        await c.message.delete()
    else:
        pass

@dp.callback_query_handler(text='stat')
async def handle_stat_button(c: types.CallbackQuery):
    status = users.cursor.execute("SELECT status from users where id = ?", (c.from_user.id,)).fetchone()
    status = (status[0])
    if str(status) == 'Система':
        cancel_menu = InlineKeyboardMarkup()
        cancel_bt = InlineKeyboardButton(text = '🚫 Отмена', callback_data = 'cancel')
        cancel_menu.add(cancel_bt)
        us = users.cursor.execute('SELECT * FROM users').fetchall()
        ch = chats.cursor.execute('SELECT * FROM chats').fetchall()
        ls = users.cursor.execute('SELECT * FROM users WHERE ls is 1').fetchall()
        await c.message.edit_text(f"""#СТАТИСТИКА
Юзеров: <b>{len(us)}</b> 👤
Чатов: <b>{len(ch)}</b> 👥
Л/С: <b>{len(ls)}</b> ✅""", reply_markup = cancel_menu)
    else:
        pass

@dp.callback_query_handler(text='ping')
async def handle_ping_button(c: types.CallbackQuery):
    status = users.cursor.execute("SELECT status from users where id = ?", (c.from_user.id,)).fetchone()
    status = (status[0])
    if str(status) == 'Система':
        cancel_menu = InlineKeyboardMarkup()
        cancel_bt = InlineKeyboardButton(text = '🚫 Отмена', callback_data = 'cancel')
        cancel_menu.add(cancel_bt)
        cpu = psutil.cpu_percent()
        mem = psutil.virtual_memory().percent
        a = time.time()
        bot_msg = await c.message.edit_text(text='Проверка...')
        if bot_msg:
            b = time.time()
        await c.message.edit_text(f'Пинг: <b>{round((b-a)*1000, 2)}</b> мс\nОЗУ: <b>{mem}</b>% \nCPU: <b>{cpu}</b>%', reply_markup = cancel_menu)
    else:
        pass

@dp.callback_query_handler(text='cancel')
async def cancel_wnum_button_handler(c: types.callback_query):
    status = users.cursor.execute("SELECT status from users where id = ?", (c.from_user.id,)).fetchone()
    status = (status[0])
    if str(status) == 'Система':
        admin_menu = InlineKeyboardMarkup()
        statistics_bt = InlineKeyboardButton(text = '📊 Статистика', callback_data = 'stat')
        mail_bt = InlineKeyboardButton(text = '✉️ Рассылка', callback_data = 'rassilka')
        mail_bt2 = InlineKeyboardButton(text = '💬 Чат рассылка', callback_data = 'chat_rassilka')
        ping_bt = InlineKeyboardButton(text = '🖥 Ресурсы бота', callback_data = 'ping')
        cancel_del_menu = InlineKeyboardMarkup()
        cancel_del_bt = InlineKeyboardButton(text = '❌ Закрыть ❌', callback_data = 'cancel_del')
        admin_menu.add(statistics_bt, ping_bt)
        admin_menu.add(mail_bt, mail_bt2)
        admin_menu.add(cancel_del_bt)
        await c.message.edit_text('🛠 Выберите пункт меню:', reply_markup=admin_menu)
    else:
        pass

#chatinfo
@dp.message_handler(commands=['chatinfo', 'чатинфо'], commands_prefix='/!.')
async def chatinfo_cmd(message: types.Message):
    msg = message
    chat_row = chats.cursor.execute(
        "SELECT chat_name, chat_username, chat_status, chat_games, game_rule, reg_data "
        "FROM chats WHERE chat_id = ?",
        (msg.chat.id,),
    ).fetchone()
    if chat_row is None:
        await msg.reply("Этот чат ещё не зарегистрирован в Системе.")
        return

    chat_name, chat_username, chat_status, chat_games, game_rule, reg_data = chat_row
    members = await message.chat.get_members_count()
    admins_id = [(admin.user.id) for admin in await bot.get_chat_administrators(chat_id=message.chat.id)]
    if str(chat_status) == 'Официальный':
        stat = "✅"
    elif str(chat_status) == 'Администраторский':
        stat = "‍👨‍💻️"
    elif str(chat_status) == 'VIP чат':
        stat = "💎"
    elif str(chat_status) == 'Обычный':
        stat = "👥"
    if str(game_rule) == 'разрешено':
        rule = "✅"
    elif str(game_rule) == 'запрещено':
        rule = "❎"
    await msg.answer(f"""Информация о мире:
🗒️ | Название: {chat_name}
📎 | Ссылка: @{chat_username}
🕰 | Дата регистрации: {reg_data}
{stat} | Статус: {chat_status}
🎮 | Игр сыграно: {chat_games}
{rule} | Играть в чате {game_rule}
👤 | Количество участников: {members}
👮‍♂️ | Администраторов в чате: {len(admins_id)}""")

#profile_msg
@dp.message_handler(lambda msg: ((msg.text.lower() == 'инфа') or (msg.text.lower() == "профиль")))
async def profile_msg(message):
    row = users.cursor.execute(
        "SELECT name, status, balance, stavka, games, dick, regdata, invited_users "
        "FROM users WHERE id = ?",
        (message.from_user.id,),
    ).fetchone()

    if row is None:
        await message.reply("Вы не зарегистрированы!\nВведите /start")
        return

    name, status, balance, stavka, games, dick, regdata, invited_users = row
    await message.reply(f"""📈 | Профиль пользователя
🏷 Никнейм: {name}
👤 Статус: {status}
💰 Баланс: <code>{balance}</code>
💰 Ставка: <code>{stavka}</code>
🎮 Всего игр: <b>{games}</b>
🍆 Длина члена: <b>{dick}</b> см.
🔗 Реферальная ссылка: <code>t.me/angelfredoombot?start={message.from_user.id}</code>
👥 Всего приглашено людей: {invited_users}
🕰 Дата регистрации: {regdata}""", parse_mode='html')


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
