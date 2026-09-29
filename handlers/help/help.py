import html
import logging
from aiogram import Dispatcher, types
from aiogram.dispatcher import FSMContext
from aiogram.dispatcher.handler import CancelHandler, current_handler
from aiogram.dispatcher.middlewares import BaseMiddleware
from aiogram.utils.exceptions import Throttled

from services.ai_service import ai_status, generate_reply, _LAST_ERROR

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


async def _answer_ai(message: types.Message, prompt: str):
    role = _ai_role(message)

    if not prompt:
        await message.reply(_ai_intro(role))
        return

    try:
        answer = await generate_reply(message.from_user.id, prompt, role)
    except Exception:
        logging.exception("Could not load AI assistant")
        answer = None

    if answer:
        # Bot uses global HTML parse mode; AI output is untrusted and may contain <...>.
        await message.reply(html.escape(answer))
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


#Девборд
@dp.message_handler(commands=['дев', 'dev'], commands_prefix='/!.')
async def adm_ui(message):
    admins_list = [admin.user.id for admin in await bot.get_chat_administrators(chat_id=message.chat.id)]
    status = users.cursor.execute("SELECT status from users where id = ?", (message.from_user.id,)).fetchone()
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
    status = users.cursor.execute("SELECT status from users where id = ?", (c.from_user.id,)).fetchone()
    status = (status[0])
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
    chat_name = chats.cursor.execute("SELECT chat_name from chats where chat_id = ?", (msg.chat.id,)).fetchone()
    chat_name = (chat_name[0])
    chat_username = chats.cursor.execute("SELECT chat_username from chats where chat_id = ?", (msg.chat.id,)).fetchone()
    chat_username = (chat_username[0])
    chat_status = chats.cursor.execute("SELECT chat_status from chats where chat_id = ?", (msg.chat.id,)).fetchone()
    chat_status = (chat_status[0])
    chat_games = chats.cursor.execute("SELECT chat_games from chats where chat_id = ?", (msg.chat.id,)).fetchone()
    chat_games = (chat_games[0])
    game_rule = chats.cursor.execute("SELECT game_rule from chats where chat_id = ?", (msg.chat.id,)).fetchone()
    game_rule = (game_rule[0])
    reg_data = chats.cursor.execute("SELECT reg_data from chats where chat_id = ?", (msg.chat.id,)).fetchone()
    reg_data = (reg_data[0])
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
    balance = (users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone())[0]
    name = (users.cursor.execute("SELECT name from users where id = ?", (message.from_user.id,)).fetchone())[0]
    status = (users.cursor.execute("SELECT status from users where id = ?", (message.from_user.id,)).fetchone())[0]
    games = (users.cursor.execute("SELECT games from users where id = ?", (message.from_user.id,)).fetchone())[0]
    stavka = (users.cursor.execute("SELECT stavka from users where id = ?", (message.from_user.id,)).fetchone())[0]
    dick = (users.cursor.execute("SELECT dick from users where id = ?", (message.from_user.id,)).fetchone())[0]
    regdata = (users.cursor.execute("SELECT regdata from users where id = ?", (message.from_user.id,)).fetchone())[0]
    invited_users = (users.cursor.execute("SELECT invited_users from users where id = ?", (message.from_user.id,)).fetchone())[0]

    users.cursor.execute(f"SELECT id from users WHERE id = '{message.from_user.id}'")
    if users.cursor.fetchone() is None:
        await message.reply(f'Вы не зарегистрированы!\nВведите /start')
    else:
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
