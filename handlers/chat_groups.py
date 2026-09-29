from aiogram import types

from main import config, dp, bot, users, chats, datetime, timedelta, InlineKeyboardMarkup, sqlite3



#start_cmd
@dp.message_handler(commands=['start', 'начать'])
async def start_cmd(message: types.Message):
    now = datetime.now()
    time_dice = current_date = datetime.now() - timedelta(seconds=18000)
    current = current_date.time()
    regdata = now.strftime("%d.%m.%Y")
    ttime = current.strftime('%H:%M:%S')
    bio = "Не установлено..."
    start_str = """<b>Система 'Аи' приветствует Вас!</b> """

    if message.chat.type in ['supergroup', 'group', 'private', 'channel'] and message.from_user.id:
        await message.reply(start_str)

        users.cursor.execute("SELECT id FROM users WHERE id = {}".format(message.from_user.id))
        if users.cursor.fetchone():
            return

        users.cursor.execute(
            "INSERT INTO users VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            (message.from_user.id, message["from"]["first_name"], message["from"]["username"], "Игрок", 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, regdata, ttime, 0, bio, 0, 1, "00:000:00", 0)
        )
        users.connect.commit()
        await bot.send_message(
            config.owner,
            "Новый игрок!\nНик: {}\nID: {}\nЮзернейм: @{}\nЗарегистрировался(ась) в л/с.".format(message["from"]["first_name"], message.from_user.id, message["from"]["username"])
        )
    else:
        users.cursor.execute("SELECT id FROM users WHERE id = {}".format(message.from_user.id))
        if users.cursor.fetchone():
            await message.reply("<b>Система 'Аи' приветствует Вас!</b> ")
            return

        users.cursor.execute(
            "INSERT INTO users VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            (message.from_user.id, message["from"]["first_name"], message["from"]["username"], "Игрок", 30, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, regdata, ttime, 0, bio, 0, 1, "00:00:00", 0)
        )
        users.connect.commit()
        await bot.send_message(
            config.owner,
            "Новый игрок!\nНик: {}\nID: {}\nЮзернейм: @{}\nЗарегистрировался(ась) в чате.".format(message["from"]["first_name"], message.from_user.id, message["from"]["username"])
        )

        await message.reply("<b>Система 'Аи' приветствует Вас!</b> ")
    
    args = message.text.split()
    if len(args) <= 1:
        return

    try:
        users.cursor.execute('UPDATE users SET invited_users = invited_users + 1 WHERE id=?', (int(args[1]),))
        await bot.send_message(int(args[1]), "❤️ Кто-то только что зарегистрировался по твоей реферальной ссылке!")
    except Exception:
        pass


 #Текстовые команды: ВОТ ЭХО БОТА
async def echo_message(message: types.Message):
    if message.chat.type == "private" and message.text:
        await message.answer("Не распознал сообщение. Посмотрите команды: /help")

    #Регистрация чата
    msg = message
    chat_id = msg.chat.id
    chat_name = msg.chat.title
    chat_username = msg.chat.username
    now = datetime.now()
    reg_data = now.strftime("%d.%m.%Y")
    chat_status = "Обычный"
    game_rule = "разрешено"
    chat_rules = "Отсутствуют"
    mod_cmd = 'да'
    rules = "Не указаны!"
    welcome = "Добро пожаловать в новый мир!"
    chats.cursor.execute(f"SELECT chat_id FROM chats WHERE chat_id = '{chat_id}'")
    if message.chat.type == "supergroup" or message.chat.type == "group" or message.chat.type == 'private' or message.chat.type == 'channel':
        if chats.cursor.fetchone() is None:
            chats.cursor.execute("INSERT INTO chats VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);", (chat_id, chat_name, chat_username, game_rule, 0, reg_data, chat_status, chat_rules, mod_cmd, rules, welcome))
            await bot.send_message(config.owner, f'#НОВЫЙ_ЧАТ\n👥 Название: {chat_name}\n📎 Ссылка: @{chat_username}\n✅ ID: <code>{chat_id}</code>')
            chats.connect.commit()
        else:
            pass
    else:
        pass


#invited (@Penggrin)
@dp.message_handler(content_types=types.ContentTypes.NEW_CHAT_MEMBERS)
async def new_chat_member(message: types.Message):
    if message.new_chat_members[0]['id'] != 1057867710:
        welcome = (chats.cursor.execute("SELECT welcome FROM chats WHERE chat_id = ?", (message.chat.id,)).fetchone())
        await message.answer(f"{welcome}")
        return

    result = """<b>Система</b> 
    Аи приветствует вас."""

    await message.answer(result)

    chats.cursor.execute(f"SELECT chat_id FROM chats WHERE chat_id = '{message.chat.id}'")
    if chats.cursor.fetchone():
        return

    chats.cursor.execute("INSERT INTO chats VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);", (message.chat.id, message.chat.title, message.chat.username, "разрешено", 0, datetime.now().strftime("%d.%m.%Y"), "Обычный", "Отсутствуют", 'да', "Не указаны!", "Добро пожаловать в новый мир!"))
    chats.connect.commit()

        # Отсылаем уведомление владельцу бота
    if config.owner:
        chat_link = "@" + message.chat.username if message.chat.username else ""
        await bot.send_message(config.owner, f'#НОВЫЙ_ЧАТ\n👥 Название: {message.chat.title}\n📎 Ссылка: {chat_link}\n✅ ID: <code>{message.chat.id}</code>', parse_mode='HTML')
    else:
        print('Ошибка: Нет указанного владельца.')


dp.register_message_handler(echo_message)