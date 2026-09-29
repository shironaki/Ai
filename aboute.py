from main import (
    ContentType,
    FSMContext,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    Message,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
    State,
    StatesGroup,
    asyncio,
    bot,
    chats,
    config,
    datetime,
    dp,
    gmtime,
    localtime,
    randint,
    random,
    re,
    sqlite3,
    strftime,
    time,
    timedelta,
    types,
    users,
    sleep,
)
from handlers.help.help import ChRass, Rass, rate_limit
from core.permissions import get_role_tag


#Рассылка
#Для юзеров
@dp.callback_query_handler(text="rassilka")
async def send_rass(call: types.CallbackQuery):
    status = users.cursor.execute("SELECT status from users where id = ?", (call.from_user.id,)).fetchone()
    status = (status[0])
    if str(status) in ('Создатель бота', 'Система') or call.from_user.id == config.owner:
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
    if str(status) in ('Создатель бота', 'Система') or message.from_user.id == config.owner:
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

    #helpui
@dp.message_handler(commands=['help', 'хелп', 'команды'], commands_prefix='/!.')
async def help_ui(message):
    help_menu = InlineKeyboardMarkup()
    osnova_bt = InlineKeyboardButton(text = '📖 Основные', callback_data = 'osnova')
    games_bt = InlineKeyboardButton(text = '🎰 Игровые', callback_data = 'games')
    moders_bt = InlineKeyboardButton(text = '👮‍ Для модераторов', callback_data = 'moders')
    rolpl_bt = InlineKeyboardButton(text = '🎭 Role Play', callback_data = 'rolpl')
    cancel_help_bt = InlineKeyboardButton(text = '🚫 Закрыть', callback_data = 'cancel_help')
    help_menu.add(osnova_bt, games_bt)
    help_menu.add(rolpl_bt, moders_bt)
    help_menu.add(cancel_help_bt)
    await message.answer('Все команды бота:', reply_markup=help_menu)

@dp.callback_query_handler(text='cancel_help')
async def handle_help_cdel_button(c: types.CallbackQuery):
    await c.message.delete()

@dp.callback_query_handler(text='osnova')
async def handle_osnova_button(c: types.CallbackQuery):
    cancel_help_menu = InlineKeyboardMarkup()
    cancel_help_bt = InlineKeyboardButton(text = ' Назад', callback_data = 'cancelhelp')
    cancel_help_menu.add(cancel_help_bt)
    await c.message.edit_text(f"""📖 Основные команды:

✅ /start — начало пользования. 
📚 /help — список команд бота. 
👤 Профиль — открыть свой профиль в боте. 
✏️ /bio (текст) — установить описание. 
🗒 Био — вызвать описание. 
🏷 /name — сменить свой ник. 
💸 Передать (кол-во) — передать монеты пользователю.""", reply_markup=cancel_help_menu)

@dp.callback_query_handler(text='games')
async def handle_games_button(c: types.CallbackQuery):
    cancel_help_menu = InlineKeyboardMarkup()
    cancel_help_bt = InlineKeyboardButton(text = 'Назад', callback_data = 'cancelhelp')
    cancel_help_menu.add(cancel_help_bt)
    await c.message.edit_text(f"""🎰 Игровые команды:

💰 Баланс — баланс пользователя, синонимы команды: "Б".
🏦 Пополнить счёт (сумма) — пополнить свой банковский счёт. 
🏦 Снять со счёта (сумма) — снять деньги со своего банковского счёта. 
🕹 Мои игры — список всех ваших игр. 
🎱 Выбери от (число) до (число) — выбирает случайное число в указанном диапазоне. 
🎰 Казино (ставка) — игра в казино. 
🎲 Куб [1-6] (ставка) — игра в кости. 
🎯 Дартс (ставка) — игра в дартс. 
🏀 Бас (ставка) — игра в баскетбол. 
🎳 Боул (ставка) — игра в боулинг. 
⚽ Фут (ставка) — игра в футбол. 
🐇Охота (ставка) — сходить на охоту. 
🧩 Слоты (ставка) — игра в слоты.""", reply_markup=cancel_help_menu)

@dp.callback_query_handler(text='moders')
async def handle_moders_button(c: types.CallbackQuery):
    cancel_help_menu = InlineKeyboardMarkup()
    cancel_help_bt = InlineKeyboardButton(text = 'Назад', callback_data = 'cancelhelp')
    cancel_help_menu.add(cancel_help_bt)
    await c.message.edit_text(f"""👮‍ Команды для администраторов чата:

🕹 Разрешить игры —  разрешить участникам играть в чате. 
🕹 Запретить игры —  запретить участникам играть в чате. 
👮‍♂ Вкл модер — включить команды для модераторов в чате. 
👮‍♂ Выкл модер — выключить команды для модераторов в чате. 
🔇 /mute (время) (причина) — замутить пользователя. 
🔈 /unmute — размутить пользователя. 
🔴 /ban — забанить пользователя. 
🟢 /unban — разбанить пользователя. 
🗑 /del — удалить сообщение. 
🗓 /welcome (текст) — установить приветствие для новых пользователей. 
📜 /rules (текст) — установить правила чата. 
📖 Правила —  вызвать правила чата. 
📛 /report — отправить жалобу админам на участника чата.""", reply_markup=cancel_help_menu)

@dp.callback_query_handler(text='rolpl')
async def handle_rolpl_button(c: types.CallbackQuery):
    cancel_help_menu = InlineKeyboardMarkup()
    cancel_help_bt = InlineKeyboardButton(text = 'Назад', callback_data = 'cancelhelp')
    cancel_help_menu.add(cancel_help_bt)
    await c.message.edit_text(f"""🎭 Role play команды:

💬 /rp — кастомная РП команда. 
🍆 /dick — увеличить член. 
🧰 /work — пойти на работу. 
🏆 Топ б — топ 15 богачей бота. 
🏆 Топ х — топ 15 членов бота. 
🏆 Топ и — топ 15 игроков бота.""", reply_markup=cancel_help_menu)

@dp.callback_query_handler(text='cancelhelp')
async def cancel_help_button_handler(c: types.callback_query):
    help_menu = InlineKeyboardMarkup()
    osnova_bt = InlineKeyboardButton(text = '📖 Основные', callback_data = 'osnova')
    games_bt = InlineKeyboardButton(text = '🎰 Игровые', callback_data = 'games')
    moders_bt = InlineKeyboardButton(text = '👮‍ Для модераторов', callback_data = 'moders')
    rolpl_bt = InlineKeyboardButton(text = '🎭 Role Play', callback_data = 'rolpl')
    cancel_help_bt = InlineKeyboardButton(text = '🚫 Закрыть', callback_data = 'cancel_help')
    help_menu.add(osnova_bt, games_bt)
    help_menu.add(rolpl_bt, moders_bt)
    help_menu.add(cancel_help_bt)
    await c.message.edit_text(text='Все команды бота:', reply_markup=help_menu)


    #Передать
@dp.message_handler(regexp=r"(^Передать|передать) ?(\d+)?")
async def send_money(message: types.Message):
    command_parse = re.compile(r"(^Передать|передать) ?(\d+)?")
    parsed = command_parse.match(message.text)
    if not message.reply_to_message:
        await message.reply("❗ | Используйте команду ответом на сообщение пользователя.")
        return
    suma = parsed.group(2) if parsed else None
    if not suma or int(suma) <= 0:
        await message.reply("❗ | Укажите положительное количество. Например: Передать 100")
        return
    balance = users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone()
    balance = (balance[0])
    name1 = message.reply_to_message.from_user.get_mention(as_html=True)
    name2 = message.from_user.get_mention(as_html=True)
    suma = int(suma)
    data = {}
    data["suma"] = suma
    data['user_id'] = message.reply_to_message.from_user.id
    data1 = {}
    data1["suma"] = suma
    data1['user_id'] = message.from_user.id
    id = message.from_user.id
    users.cursor.execute(f"SELECT id from users WHERE id = '{id}'")
    if users.cursor.fetchone() is None:
        await message.reply(f'Вы не зарегистрированы!\nВведите /start')
    else:
        if int(balance) >= suma:
            users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
            users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", data1)
            users.connect.commit()
            await message.answer(f"👤 | Пользователь: {name2}\n💸 | Передал(-а): <code>{suma}💰</code>\n👤 | Пользователю: {name1}", parse_mode='html')
        else:
            await message.reply(f"❎ | У вас недостаточно монет для передачи!", parse_mode='html')
            users.connect.commit()

#Отдать
@dp.message_handler(regexp=r"(^Отдать|отдать) ?(\d+)?")
async def send_money(message: types.Message):
    balance = users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone()
    balance = (balance[0])
    command_parse = re.compile(r"(^Отдать|отдать) ?(\d+)?")
    parsed = command_parse.match(message.text)
    suma = parsed.group(2)
    name1 = message.reply_to_message.from_user.get_mention(as_html=True)
    name2 = message.from_user.get_mention(as_html=True)
    suma = int(suma)
    data = {}
    data["suma"] = suma
    data['user_id'] = message.reply_to_message.from_user.id
    data1 = {}
    data1["suma"] = suma
    data1['user_id'] = message.from_user.id
    id = message.from_user.id
    users.cursor.execute(f"SELECT id from users WHERE id = '{id}'")
    if users.cursor.fetchone() is None:
        await message.reply(f'Вы не зарегистрированы!\nВведите /start')
    else:
        if int(balance) >= suma:
            users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
            users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", data1)
            users.connect.commit()
            await message.answer(f"👤 | Пользователь: {name2}\n💸 | Передал(-а): <code>{suma}💰</code>\n👤 | Пользователю: {name1}", parse_mode='html')
        else:
            await message.reply(f"❎ | У вас недостаточно монет для передачи!", parse_mode='html')
            users.connect.commit()



#work
@dp.message_handler(commands=['work', 'работа', 'работать'], commands_prefix='/+!.')
async def work_cmd(message: types.Message):
    emoji = random.choice(["😴", "😶‍🌫️", "🫠", "🥶", "🤥", "🫡", "🤨", "😐", "🗿"])
    user_id = message['from']['id']
    row = users.cursor.execute("SELECT work_time FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        await message.reply("Вы не зарегистрированы! Введите /start")
        return
    ltime = row[0]
    current_date_time = datetime.now()
    current_time = current_date_time.time()
    q = current_time.strftime('%H:%M:%S')
    a, b, t1, t2 = f'{ltime}'.split(':'), f'{q}'.split(':'), 0, 0
    for i in range(2, -1, -1):
        t1, t2 = t1 + 60**i*int(a[2-i]), t2 + 60**i*int(b[2-i])
    a = (86400 - t1) * int(t2 < t1) + t2 - t1 * int(not (t2 < t1))
    if a >= 7200:
        money_r = randint(5000, 15000)
        data = {}
        data["rand"] = (money_r)
        data['user_id'] = user_id
        balance = users.cursor.execute("SELECT balance FROM users WHERE id = ?",(user_id,)).fetchone()
        bal = (balance[0])
        await message.reply("👨‍💼 | Вы успешно сходили на работу и заработали: <b>{}💰</b>  \n💳 | Ваш баланс: <b>{}💰</b>".format(money_r, int(bal+money_r)))
        users.cursor.execute("""UPDATE users SET balance = balance + :rand WHERE id = :user_id;""", data)
        users.cursor.execute("UPDATE users SET work_time = ? WHERE id = ?", (q, user_id))
        users.connect.commit()
    else:
        balance = users.cursor.execute("SELECT balance FROM users WHERE id = ?",(user_id,)).fetchone()
        bal = (balance[0])
        await message.reply(f"{emoji} | Ходить на работу можно раз в 2 часа, приходи позже!\n💳 | Сейчас ваш баланс: <b>{bal}</b>💰")


#chatwelcome_msg
@dp.message_handler(lambda msg: msg.text.lower() == 'приветствие')
async def chatwelcome_msg(message):
    if message.chat.type == "supergroup" or message.chat.type == "group":
        chat_id = message.chat.id
        chat_welcome = chats.cursor.execute("SELECT welcome FROM chats WHERE chat_id = ?", (chat_id,)).fetchone()
        welcome = (chat_welcome[0])
        await message.answer("👋 Приветствие чата:\n{}".format(welcome))
    else:
        await message.answer("Эта команда работает только в чатах!")

#Растить хуй
@dp.message_handler(commands=['хуй', 'член', 'dick'], commands_prefix='/+!.')
async def dick_cmd(message: types.Message):
    msg = message
    name = users.cursor.execute("SELECT name from users where id = ?",(msg.from_user.id,)).fetchone()
    name = (name[0])
    emoji = random.choice(["😶‍🌫️", "🫡", "🥶", "🤥", "😴", "🫠", "🤨", "😐", "🗿"])
    id = msg['from']['id']
    row = users.cursor.execute("SELECT dick_time FROM users WHERE id = ?", (id,)).fetchone()
    if not row:
        await msg.reply("Вы не зарегистрированы! Введите /start")
        return
    ltime = row[0]
    current_date_time = datetime.now()
    current_time = current_date_time.time()
    q = current_time.strftime('%H:%M:%S')
    a, b, t1, t2 = f'{ltime}'.split(':'), f'{q}'.split(':'), 0, 0
    
    for i in range(2, -1, -1):
        t1, t2 = t1 + 60**i*int(a[2-i]), t2 + 60**i*int(b[2-i])
    a = (86400 - t1) * int(t2 < t1) + t2 - t1 * int(not (t2 < t1))
    
    if a >= 7200:
        dick_r = randint(-15, 30)
        data = {}
        data["rand"] = (dick_r)
        data['user_id'] = msg.from_user.id
        dick = users.cursor.execute("SELECT dick from users where id = ?",(msg.from_user.id,)).fetchone()
        dick = (dick[0])

        if dick_r > 0:
            await msg.reply(f'💦 | Вы увеличили свой член на <b>{dick_r} см.</b>\n🍆 | Теперь его длина: <b>{dick + dick_r} см.</b>', parse_mode='html')
        else:
            await msg.reply(f'✂️ | Вы уменьшили свой член на <b>{dick_r} см.</b>\n🍆 | Теперь его длина: <b>{dick + dick_r} см.</b>', parse_mode='html')
        
        users.cursor.execute("""UPDATE users SET dick = dick + :rand WHERE id = :user_id;""", data)
        users.cursor.execute('UPDATE users SET dick_time = ? WHERE id = ?', (q, id))
        users.connect.commit()
    else:
        dick = users.cursor.execute("SELECT dick from users where id = ?",(msg.from_user.id,)).fetchone()
        dick = (dick[0])
        await msg.reply(f'{emoji} | Увеличивать член можно раз в 2 часа, приходи позже!\n🍆 | Сейчас его длина: <b>{dick} см.</b>', parse_mode='html')

#Установить ставку
@dp.message_handler(commands=['setstavka'])
async def setbal(message: types.Message):
    args = (message.get_args() or "").strip()
    if not args.isdigit():
        await message.reply("❗ | Укажите число. Пример: /setstavka 100")
        return
    summ = int(args)
    users.cursor.execute("SELECT stavka FROM users WHERE id=?", (message.from_user.id,))
    data = users.cursor.fetchone()
    if data is None:
        await message.reply("Не найден в базе данных!")
    stts = users.cursor.execute("SELECT status from users where id = ?", (message.from_user.id,)).fetchone()
    status = (stts[0])
    if str(status) in ('Создатель бота', 'Система') or message.from_user.id == config.owner:
        reply = message.reply_to_message
        if reply:
            replyuser = reply.from_user
            users.cursor.execute(f'UPDATE users SET stavka=? WHERE id=?', (summ, replyuser.id,))
            users.connect.commit()
            await message.reply(f"Максимальная ставка для {replyuser.full_name} изменена на {args} 💰")
    elif str(status) in ('Администратор', 'Хелпер') or message.from_user.id == config.owner:
        reply = message.reply_to_message
        if reply:
            replyuser = reply.from_user
            users.cursor.execute(f'UPDATE users SET stavka=? WHERE id=?', (summ, replyuser.id,))
            users.connect.commit()
            await message.reply(f"Максимальная ставка для {replyuser.full_name} изменена на {args} 💰")
        else:
            await message.reply(f"❗ | Необходим реплай!")
    else:
        return await message.reply(f"❗ | У вас недостаточно прав для того, чтобы взаимодействовать со ставками пользователей!")

#Установить хуй
@dp.message_handler(commands=['setdick'])
async def setdick(message: types.Message):
    args = (message.get_args() or "").strip()
    if not args.isdigit():
        await message.reply("❗ | Укажите число. Пример: /setdick 20")
        return
    summ = int(args)
    users.cursor.execute("SELECT dick FROM users WHERE id=?", (message.from_user.id,))
    data = users.cursor.fetchone()
    if data is None:
        await message.reply("Не найден в базе данных!")
    stts = users.cursor.execute("SELECT status from users where id = ?", (message.from_user.id,)).fetchone()
    status = (stts[0])
    if str(status) in ('Создатель бота', 'Система') or message.from_user.id == config.owner:
        reply = message.reply_to_message
        if reply:
            replyuser = reply.from_user
            users.cursor.execute(f'UPDATE users SET dick=? WHERE id=?', (summ, replyuser.id,))
            users.connect.commit()
            await message.answer(f"Пользователю {replyuser.full_name}\nИзменили размер хуя на {summ} см.")
    elif str(status) in ('Администратор', 'Хелпер') or message.from_user.id == config.owner:
        reply = message.reply_to_message
        if reply:
            replyuser = reply.from_user
            users.cursor.execute(f'UPDATE users SET dick=? WHERE id=?', (args, replyuser.id,))
            users.connect.commit()
            await message.answer(f"Пользователю {replyuser.full_name}\nИзменлили размер хуя на <code>{summ} см.</code>")
        else:
            await message.reply(f"❗ | Необходим реплай!")
    else:
        return await message.reply(f"❗ | У вас недостаточно прав для того, чтобы взаимодействовать с хуями пользователей! 🙂")

#Своя рп
@dp.message_handler(commands=['rp'])
async def custom_rp(message: types.Message):
    args = message.get_args()
    reply = message.reply_to_message
    status = users.cursor.execute("SELECT status from users where id = ?", (message.from_user.id,)).fetchone()
    status = (status[0])
    id = message.from_user.id
    users.cursor.execute(f"SELECT id from users WHERE id = '{id}'")
    if users.cursor.fetchone() is None:
        await message.reply(f'Вы не зарегистрированы!\nВведите /start')
    else:
        if str(status) in ('Пользователь', 'Игрок', 'Администратор', 'Создатель бота', 'Система'):
            if reply:
                if args:
                    name1 = message.from_user.get_mention(as_html=True)
                    name2 = message.reply_to_message.from_user.get_mention(as_html=True)
                    await message.answer(f'💬 | {name1} {args} {name2}')
                else:
                    await message.answer(f'📝 | Введите РП действие, пример: "/rp поцеловал"')
            else:
                if args:
                    name1 = message.from_user.get_mention(as_html=True)
                    await message.answer(f'💬 | {name1} {args}')
                else:
                    await message.answer(f'📝 | Введите РП действие, пример: "/rp пошёл в магазин"')
        else:
            await message.reply(f'Данная команда доступна лишь пользователям с VIP статусом 💎')

#Био
@dp.message_handler(commands=['bio'])
async def setbio(message: types.Message):
    args = message.get_args()
    name = message.from_user.get_mention(as_html=True)
    users.cursor.execute("SELECT bio FROM users WHERE id=?", (message.from_user.id,))
    data = users.cursor.fetchone()
    vip = users.cursor.execute("SELECT status from users where id = ?", (message.from_user.id,)).fetchone()
    vip = (vip[0])
    id = message.from_user.id
    users.cursor.execute(f"SELECT id from users WHERE id = '{id}'")
    if users.cursor.fetchone() is None:
        await message.reply(f'Вы не зарегистрированы!\nВведите /start')
    else:
        if str(vip) in ('Создатель бота', 'Администратор', 'Хелпер', 'Пользователь', 'Игрок', 'Система') or message.from_user.id == config.owner:
            if len(args) <= 350:
                if args:
                    if data is None:
                        return await message.reply("Не найден в базе данных!")
                    users.cursor.execute(f'UPDATE users SET bio=? WHERE id=?', (args, message.from_user.id,))
                    users.connect.commit()
                    await message.answer(f"📄 | Описание {str(name)} изменено!")
                else:
                    await message.reply('❎ | Ваше описание не может быть пустым!')
            else:
                await message.reply('❎ | Максимальная длина описания 350 символов!')
        else:
            await message.reply(f'Данная команда доступна лишь пользователям с VIP статусом 💎')

#Описание
@dp.message_handler(lambda message: message.text.lower() == 'био')
async def bio_text(message: types.Message):
    bio = users.cursor.execute("SELECT bio from users where id = ?", (message.from_user.id,)).fetchone()
    bio = (bio[0])
    vip = users.cursor.execute("SELECT status from users where id = ?", (message.from_user.id,)).fetchone()
    vip = (vip[0])
    id = message.from_user.id
    users.cursor.execute(f"SELECT id from users WHERE id = '{id}'")
    if users.cursor.fetchone() is None:
        await message.reply(f'Вы не зарегистрированы!\nВведите /start')
    else:
        if str(vip) in ('Создатель бота', 'Администратор', 'Хелпер', 'Пользователь', 'Игрок', 'Система') or message.from_user.id == config.owner:
            await message.reply(f'🗓 | Ваше описание профиля:\n{bio}')
        else:
            await message.reply(f'Данная команда доступна лишь пользователям с VIP статусом 💎')

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
🏷 Роль: {get_role_tag(message.from_user.id)}
💰 Баланс: <code>{balance}</code>
💰 Ставка: <code>{stavka}</code>
🎮 Всего игр: <b>{games}</b>
🍆 Длина члена: <b>{dick}</b> см.
🔗 Реферальная ссылка: <code>t.me/ELAS_game_bot?start={message.from_user.id}</code>
👥 Всего приглашено людей: {invited_users}
🕰 Дата регистрации: {regdata}""", parse_mode='html')

#stata_msg
@dp.message_handler(lambda msg: msg.text.lower() == 'стата')
async def stata_msg(message):
    msg = message
    balance = users.cursor.execute("SELECT balance from users where id = ?", (msg.from_user.id,)).fetchone()
    balance = (balance[0])
    name = users.cursor.execute("SELECT name from users where id = ?", (msg.from_user.id,)).fetchone()
    name = (name[0])
    status = users.cursor.execute("SELECT status from users where id = ?", (msg.from_user.id,)).fetchone()
    status = (status[0])
    games = users.cursor.execute("SELECT games from users where id = ?", (msg.from_user.id,)).fetchone()
    games = (games[0])
    stavka = users.cursor.execute("SELECT stavka from users where id = ?", (msg.from_user.id,)).fetchone()
    stavka = (stavka[0])
    dick = users.cursor.execute("SELECT dick from users where id = ?", (msg.from_user.id,)).fetchone()
    dick = (dick[0])
    regdata = users.cursor.execute("SELECT regdata from users where id = ?", (msg.from_user.id,)).fetchone()
    regdata = (regdata[0])
    id = message.from_user.id
    users.cursor.execute(f"SELECT id from users WHERE id = '{id}'")
    if users.cursor.fetchone() is None:
        await message.reply(f'Вы не зарегистрированы!\nВведите /start')
    else:
        await msg.reply(f"""📈 | Профиль пользователя
📎 Никнейм: {name}
🏷 Роль: {get_role_tag(msg.from_user.id)}
💰 Баланс: <code>{balance}</code>
💰 Ставка: <code>{stavka}</code>
🎮 Всего игр: <b>{games}</b>
🍆 Длина хуя: <b>{dick}</b> см.
🕰 Дата регистрации: {regdata}""", parse_mode='html')

#info_msg
@dp.message_handler(lambda msg: msg.text.lower() == 'инфо')
async def info_msg(message):
    msg = message
    balance = users.cursor.execute("SELECT balance from users where id = ?", (msg.from_user.id,)).fetchone()
    balance = (balance[0])
    name = users.cursor.execute("SELECT name from users where id = ?", (msg.from_user.id,)).fetchone()
    name = (name[0])
    status = users.cursor.execute("SELECT status from users where id = ?", (msg.from_user.id,)).fetchone()
    status = (status[0])
    games = users.cursor.execute("SELECT games from users where id = ?", (msg.from_user.id,)).fetchone()
    games = (games[0])
    stavka = users.cursor.execute("SELECT stavka from users where id = ?", (msg.from_user.id,)).fetchone()
    stavka = (stavka[0])
    dick = users.cursor.execute("SELECT dick from users where id = ?", (msg.from_user.id,)).fetchone()
    dick = (dick[0])
    regdata = users.cursor.execute("SELECT regdata from users where id = ?", (msg.from_user.id,)).fetchone()
    regdata = (regdata[0])
    id = message.from_user.id
    users.cursor.execute(f"SELECT id from users WHERE id = '{id}'")
    if users.cursor.fetchone() is None:
        await message.reply(f'Вы не зарегистрированы!\nВведите /start')
    else:
        await msg.reply(f"""📈 | Профиль пользователя
📎 Никнейм: {name}
🏷 Роль: {get_role_tag(msg.from_user.id)}
💰 Баланс: <code>{balance}</code>
💰 Ставка: <code>{stavka}</code>
🎮 Всего игр: <b>{games}</b>
🍆 Длина хуя: <b>{dick}</b> см.
🕰 Дата регистрации: {regdata}""", parse_mode='html')


#chatrules_msg
@dp.message_handler(lambda msg: msg.text.lower() == 'правила')
async def chatrules_msg(message):
    if message.chat.type == "supergroup" or message.chat.type == "group":
        chat_id = message.chat.id
        chat_rules = chats.cursor.execute("SELECT rules FROM chats WHERE chat_id = ?", (chat_id,)).fetchone()
        rules = (chat_rules[0])
        await message.answer("Правила чата:\n\n{}".format(rules))
    else:
        await message.answer("Эта команда работает только в чатах!")

#chatrules
@dp.message_handler(commands=["rules"])
async def rules_cmd(message: types.Message):
    if message.chat.type == "supergroup" or message.chat.type == "group":
        user_id = message.from_user.id
        chat_id = message.chat.id
        new_rules = message.get_args()
        admins_list = [admin.user.id for admin in await bot.get_chat_administrators(chat_id=chat_id)]
        if user_id in admins_list:
            if new_rules:
                chats.cursor.execute("UPDATE chats SET rules=? WHERE chat_id=?", (new_rules, chat_id,))
                chats.connect.commit()
                await message.answer("📑 Правила чата были успешно изменены!")
            else:
                await message.answer("💬 Вы не указали новые правила!")
        else:
            await message.answer("🛡️ Вы не являетесь администратором этого чата!")
    else:
        await message.answer("Эта команда работает только в чатах!")


#set_name
@dp.message_handler(commands=['name'])
async def set_name(message: types.Message):
    msg = message
    args = msg.get_args()
    uname = msg.from_user.username
    id = msg.from_user.id
    users.cursor.execute("SELECT id FROM users WHERE id=?", (message.from_user.id,))
    data = users.cursor.fetchone()
    if len(args) <= 15:
        if args:
            if data is None:
                return await msg.reply("🤔 | Вы не были найдены в базе данных бота, введите /start для регистрации")
            users.cursor.execute(f'UPDATE users SET name=? WHERE id=?', (args, id,))
            users.cursor.execute(f'UPDATE users SET username=? WHERE id=?', (uname, id,))
            users.connect.commit()
            await msg.reply(f"📝 | Ваш ник изменён на «{args}»")
        else:
            await msg.reply('❎ | Ник не может быть пустым!')
    else:
        await msg.reply('❎ | Максимальная длина ника должна составлять 15 символов!')

#статусы
@dp.message_handler(lambda msg: msg.text.lower() == 'статусы')
async def statuses_msg(message):
    msg = message
    name = msg.from_user.get_mention
    await msg.answer(f"""Все статусы пользователей:
👤 | Пользователь - по умолчанию
👮‍♂️ | Администратор  - член команды администрации бота 
👨‍💻 | Создатель бота - кодер

Все статусы чатов:
👥 | Обычный - по умолчанию 
✅ | Официальный - официальные чаты сетки бота 
👨‍💻 | Администраторский - чаты для администраторов бота""")


#Статистика игр
@dp.message_handler(lambda msg: msg.text.lower() == 'мои игры')
async def mygames(message):
    id = message.from_user.id
    users.cursor.execute(f"SELECT id from users WHERE id = '{id}'")
    if users.cursor.fetchone() is None:
        await message.reply(f'Вы не зарегистрированы!\nВведите /start')
    else:
        casino = users.cursor.execute("SELECT casino from users where id = ?", (message.from_user.id,)).fetchone()
        casino = (casino[0])
        kosti = users.cursor.execute("SELECT kosti from users where id = ?", (message.from_user.id,)).fetchone()
        kosti = (kosti[0])
        darts = users.cursor.execute("SELECT darts from users where id = ?", (message.from_user.id,)).fetchone()
        darts = (darts[0])
        bouling = users.cursor.execute("SELECT bouling from users where id = ?", (message.from_user.id,)).fetchone()
        bouling = (bouling[0])
        footbal = users.cursor.execute("SELECT footbal from users where id = ?", (message.from_user.id,)).fetchone()
        footbal = (footbal[0])
        basket = users.cursor.execute("SELECT basket from users where id = ?", (message.from_user.id,)).fetchone()
        basket = (basket[0])
        ohota = users.cursor.execute("SELECT ohota from users where id = ?", (message.from_user.id,)).fetchone()
        ohota = (ohota[0])
        slots = users.cursor.execute("SELECT slots from users where id = ?", (message.from_user.id,)).fetchone()
        slots = (slots[0])
        await message.answer(f"""📈 | Статистика ваших игр
Казино: <b>{casino}</b> 🎰
Кости: <b>{kosti}</b> 🎲
Дартс: <b>{darts}</b> 🎯
Боулинг: <b>{bouling}</b> 🎳
Футбол: <b>{footbal}</b> ⚽
Баскетбол: <b>{basket}</b> 🏀
Охота: <b>{ohota}</b> 🔫
Слоты: <b>{slots}</b> 🧩""")

#Рандом
@dp.message_handler(regexp=r"(^Выбери|выбери) (^От|от) ?(\d+)? (^До|до) ?(\d+)?")
async def random_vybor(message: types.Message):

    name1 = message.from_user.get_mention(as_html=True)
    command_parse = re.compile(r"(^Выбери|выбери) (^От|от) ?(\d+)? (^До|до) ?(\d+)?")

    parsed = command_parse.match(message.text)
    random1 = parsed.group(3)
    random2 = parsed.group(5)
    rand1 = int(random1)
    rand2 = int(random2)
    
    rand = int(randint(rand1, rand2))
    try:
        await message.answer(f"🎱 | {name1}, я выбираю - <b>{rand}</b>")
    except:
        await message.reply(f'❎ | Введите числа!\nПример:<code>Выбери от 1 до 100</code>')
        return

#Слоты
@dp.message_handler(regexp=r"^(?:Слоты|слоты)\s+(\d+)\s*$")
async def slots(message: types.Message):
    msg = message
    name1 = message.from_user.get_mention(as_html=True)
    command_parse = re.compile(r"(^Слоты|слоты) ?(\d+)?")
    parsed = command_parse.match(message.text)
    summ = parsed.group(2)
    summ = int(summ)
    balance = users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone()
    balance = (balance[0])
    stavka = users.cursor.execute("SELECT stavka from users where id = ?", (message.from_user.id,)).fetchone()
    stavka = (stavka[0])
    sm = ["🍬", "💎", "☃️", "🍭", "🔮️"]
    one = random.choice(sm)
    two = random.choice(sm)
    three = random.choice(sm)
    ss = await message.answer(f'Ставка: <code>{summ}💰</code>\n\n        |🌫️|🌫️|🌫️|', parse_mode='html')
    if message.chat.type == 'private':
        if int(summ) <= int(stavka):
            if int(balance) >= summ:
                await asyncio.sleep(2)
                await ss.edit_text(f'Ставка: <code>{summ}💰</code>\n\n        |{one}|🌫️|🌫️|')
                await asyncio.sleep(2)
                await ss.edit_text(f'Ставка: <code>{summ}💰</code>\n\n        |{one}|{two}|🌫️|')
                await asyncio.sleep(2)
                await ss.edit_text(f'Ставка: <code>{summ}💰</code>\n\n        |{one}|{two}|{three}|')
                await asyncio.sleep(1)
                if((one == "🍬") and (two == "🍬") and (three == "🍬")):
                    summ2 = summ * 3
                    data = {}
                    data["suma"] = int(summ2)
                    data['user_id'] = message.from_user.id
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                    await ss.edit_text( f'{name1}, вам выпало три подряд!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                elif((one == "🍬") and (two == "🍬") and (three != "🍬")):
                    summ2 = summ * 2
                    data = {}
                    data["suma"] = int(summ2)
                    data['user_id'] = message.from_user.id
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                    await ss.edit_text(f'{name1}, вам выпала пара!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                elif((one != "🍬") and (two == "🍬") and (three == "🍬")):
                    summ2 = summ * 2
                    data = {}
                    data["suma"] = int(summ2)
                    data['user_id'] = message.from_user.id
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                    await ss.edit_text(f'{name1}, вам выпала пара!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>')      
                elif((one == "💎") and (two == "💎") and (three == "💎")):
                    summ2 = summ * 7
                    data = {}
                    data["suma"] = int(summ2)
                    data['user_id'] = message.from_user.id
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                    await ss.edit_text(f'{name1}, вам выпало три подряд!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                elif((one == "💎") and (two == "💎") and (three != "💎")):
                    summ2 = summ * 2
                    data = {}
                    data["suma"] = int(summ2)
                    data['user_id'] = message.from_user.id
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                    await ss.edit_text(f'{name1}, вам выпала пара!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                elif((one != "💎") and (two == "💎") and (three == "💎")):
                    summ2 = summ * 2
                    data = {}
                    data["suma"] = int(summ2)
                    data['user_id'] = message.from_user.id
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                    await ss.edit_text(f'{name1}, вам выпала пара!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                elif((one == "☃️") and (two == "☃️") and (three == "☃️")):
                    summ2 = summ * 3
                    data = {}
                    data["suma"] = int(summ2)
                    data['user_id'] = message.from_user.id
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                    await ss.edit_text(f'{name1}, вам выпало три подряд!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                elif((one == "☃️") and (two == "☃️") and (three != "☃️")):
                    summ2 = summ * 2
                    data = {}
                    data["suma"] = int(summ2)
                    data['user_id'] = message.from_user.id
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                    await ss.edit_text(f'{name1}, вам выпала пара!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                elif((one != "☃️") and (two == "☃️") and (three == "☃️")):
                    summ2 = summ * 2
                    data = {}
                    data["suma"] = int(summ2)
                    data['user_id'] = message.from_user.id
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                    await ss.edit_text(f'{name1}, вам выпала пара!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                elif((one == "🍭") and (two == "🍭") and (three == "🍭")):
                    summ2 = summ * 2
                    data = {}
                    data["suma"] = int(summ2)
                    data['user_id'] = message.from_user.id
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                    await ss.edit_text(f'{name1}, вам выпало три подряд!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                elif((one == "🍭") and (two == "🍭") and (three != "🍭")):
                    summ2 = summ * 1
                    data = {}
                    data["suma"] = int(summ2)
                    data['user_id'] = message.from_user.id
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                    await ss.edit_text(f'{name1}, вам выпала пара!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                elif((one != "🍭") and (two == "🍭") and (three == "🍭")):
                    summ2 = summ * 1
                    data = {}
                    data["suma"] = int(summ2)
                    data['user_id'] = message.from_user.id
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                    await ss.edit_text(f'{name1}, вам выпала пара!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                elif((one == "🔮️") and (two == "🔮️") and (three == "🔮️")):
                    summ2 = summ * 2
                    data = {}
                    data["suma"] = int(summ2)
                    data['user_id'] = message.from_user.id
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                    await ss.edit_text(f'{name1}, вам выпало три подряд!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                elif((one == "🔮️") and (two == "🔮️") and (three != "🔮️")):
                    summ2 = summ * 1
                    data = {}
                    data["suma"] = int(summ2)
                    data['user_id'] = message.from_user.id
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                    await ss.edit_text(f'{name1}, вам выпала пара!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                elif((one != "🔮️") and (two == "🔮️") and (three == "🔮️")):
                    summ2 = summ * 1
                    data = {}
                    data["suma"] = int(summ2)
                    data['user_id'] = message.from_user.id
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                    await ss.edit_text(f'{name1}, вам выпала пара!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                else:
                    summ2 = summ * 1
                    data = {}
                    data["suma"] = int(summ2)
                    data['user_id'] = message.from_user.id
                    users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", data)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                    await ss.edit_text(f'{name1}, совпадений нет!\n\n        |{one}|{two}|{three}|\n\nВы проиграли: <code>{summ2}💰</code>', parse_mode='html')
            elif int(balance) < summ:
                await ss.edit_text(f'❎ | У вас нет столько монет!\n💳 | Ваш баланс: {balance}💰', parse_mode='html')
        else:
            await ss.edit_text(f'❎ | Ваша максимальная ставка: {stavka}💰', parse_mode='html')
    else:
        game_rule = chats.cursor.execute("SELECT game_rule from chats where chat_id = ?", (msg.chat.id,)).fetchone()
        game_rule = (game_rule[0])
        if str(game_rule) == 'разрешено':
            if int(summ) <= int(stavka):
                if int(balance) >= summ:
                    await asyncio.sleep(2)
                    await ss.edit_text(f'Ставка: {summ}💰\n\n        |{one}|🌫️|🌫️|')
                    await asyncio.sleep(2)
                    await ss.edit_text(f'Ставка: {summ}💰\n\n        |{one}|{two}|🌫️|')
                    await asyncio.sleep(2)
                    await ss.edit_text(f'Ставка: {summ}💰\n\n        |{one}|{two}|{three}|')
                    await asyncio.sleep(1)
                    if((one == "🍬") and (two == "🍬") and (three == "🍬")):
                        summ2 = summ * 3
                        data = {}
                        data["suma"] = int(summ2)
                        data['user_id'] = message.from_user.id
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                        await ss.edit_text( f'{name1}, вам выпало три подряд!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                    elif((one == "🍬") and (two == "🍬") and (three != "🍬")):
                        summ2 = summ * 2
                        data = {}
                        data["suma"] = int(summ2)
                        data['user_id'] = message.from_user.id
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                        await ss.edit_text(f'{name1}, вам выпала пара!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                    elif((one != "🍬") and (two == "🍬") and (three == "🍬")):
                        summ2 = summ * 2
                        data = {}
                        data["suma"] = int(summ2)
                        data['user_id'] = message.from_user.id
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                        await ss.edit_text(f'{name1}, вам выпала пара!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>')      
                    elif((one == "💎") and (two == "💎") and (three == "💎")):
                        summ2 = summ * 7
                        data = {}
                        data["suma"] = int(summ2)
                        data['user_id'] = message.from_user.id
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                        await ss.edit_text(f'{name1}, вам выпало три подряд!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                    elif((one == "💎") and (two == "💎") and (three != "💎")):
                        summ2 = summ * 2
                        data = {}
                        data["suma"] = int(summ2)
                        data['user_id'] = message.from_user.id
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                        await ss.edit_text(f'{name1}, вам выпала пара!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                    elif((one != "💎") and (two == "💎") and (three == "💎")):
                        summ2 = summ * 2
                        data = {}
                        data["suma"] = int(summ2)
                        data['user_id'] = message.from_user.id
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                        await ss.edit_text(f'{name1}, вам выпала пара!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                    elif((one == "☃️") and (two == "☃️") and (three == "☃️")):
                        summ2 = summ * 3
                        data = {}
                        data["suma"] = int(summ2)
                        data['user_id'] = message.from_user.id
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                        await ss.edit_text(f'{name1}, вам выпало три подряд!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                    elif((one == "☃️") and (two == "☃️") and (three != "☃️")):
                        summ2 = summ * 2
                        data = {}
                        data["suma"] = int(summ2)
                        data['user_id'] = message.from_user.id
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                        await ss.edit_text(f'{name1}, вам выпала пара!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                    elif((one != "☃️") and (two == "☃️") and (three == "☃️")):
                        summ2 = summ * 2
                        data = {}
                        data["suma"] = int(summ2)
                        data['user_id'] = message.from_user.id
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                        await ss.edit_text(f'{name1}, вам выпала пара!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                    elif((one == "🍭") and (two == "🍭") and (three == "🍭")):
                        summ2 = summ * 2
                        data = {}
                        data["suma"] = int(summ2)
                        data['user_id'] = message.from_user.id
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                        await ss.edit_text(f'{name1}, вам выпало три подряд!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                    elif((one == "🍭") and (two == "🍭") and (three != "🍭")):
                        summ2 = summ * 1
                        data = {}
                        data["suma"] = int(summ2)
                        data['user_id'] = message.from_user.id
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                        await ss.edit_text(f'{name1}, вам выпала пара!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                    elif((one != "🍭") and (two == "🍭") and (three == "🍭")):
                        summ2 = summ * 1
                        data = {}
                        data["suma"] = int(summ2)
                        data['user_id'] = message.from_user.id
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                        await ss.edit_text(f'{name1}, вам выпала пара!\n\n        {one}|{two}|{three}\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                    elif((one == "🔮️") and (two == "🔮️") and (three == "🔮️")):
                        summ2 = summ * 2
                        data = {}
                        data["suma"] = int(summ2)
                        data['user_id'] = message.from_user.id
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                        await ss.edit_text(f'{name1}, вам выпало три подряд!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                    elif((one == "🔮️") and (two == "🔮️") and (three != "🔮️")):
                        summ2 = summ * 1
                        data = {}
                        data["suma"] = int(summ2)
                        data['user_id'] = message.from_user.id
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                        await ss.edit_text(f'{name1}, вам выпала пара!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                    elif((one != "🔮️") and (two == "🔮️") and (three == "🔮️")):
                        summ2 = summ * 1
                        data = {}
                        data["suma"] = int(summ2)
                        data['user_id'] = message.from_user.id
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                        await ss.edit_text(f'{name1}, вам выпала пара!\n\n        |{one}|{two}|{three}|\n\nВы выиграли: <code>{summ2}💰</code>', parse_mode='html')
                    else:
                        summ2 = summ * 1
                        data = {}
                        data["suma"] = int(summ2)
                        data['user_id'] = message.from_user.id
                        users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", data)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET slots = slots + 1 WHERE id=?', (message.from_user.id,))
                        await ss.edit_text(f'{name1}, совпадений нет!\n\n        |{one}|{two}|{three}|\n\nВы проиграли: <code>{summ2}💰</code>', parse_mode='html')
                elif int(balance) < summ:
                    await ss.edit_text(f'❎ | У вас нет столько монет!\n💳 | Ваш баланс: {balance}💰', parse_mode='html')
            else:
                await ss.edit_text(f'❎ | Ваша максимальная ставка: {stavka}💰', parse_mode='html')
        else:
            await ss.edit_text(f'🚫 | В этом чате запрещено играть!')


# @Penggrin
def get_casino_values(dice_value):
    casino = ["BAR", "Виноград", "Лимон", "Семь"]
    return [casino[(dice_value - 1) // i % 4] for i in (1, 4, 16)]


# @Penggrin
def get_casino_result(dice, bet, bonus_users):
    data = get_casino_values(dice)

    if not (data[0] == data[1] == data[2]):
        return (False, bet, data)
    
    if data[0] == "Семь":
        return (True, bet * (10 + (0.35 * bonus_users)), data)

    return (True, bet * (5 + (0.35 * bonus_users)), data)
    


#Казино (@Penggrin)
@rate_limit(limit=1.5)
@dp.message_handler(regexp=r"(^Казино|казино) ?(\d+)?")
async def kazino(message: types.Message):
    stavka = int((users.cursor.execute("SELECT stavka from users where id = ?", (message.from_user.id,)).fetchone())[0])
    balance = int((users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone())[0])
    invited_users = int((users.cursor.execute("SELECT invited_users from users where id = ?", (message.from_user.id,)).fetchone())[0])

    name = message.from_user.get_mention(as_html=True)
    args = message.text.lower().split()

    if len(args) < 2:
        await message.reply("❎ | Вы не указали ставку!")
        return

    if int(args[1]) < 1:
        await message.reply("❎ | Ставка не может быть меньше нуля!")
        return

    bet = int(args[1])

    if message.chat.type != 'private':
        game_rule = chats.cursor.execute("SELECT game_rule from chats where chat_id = ?", (message.chat.id,)).fetchone()
        game_rule = (game_rule[0])
        if game_rule != "разрешено":
            await message.reply(f'🚫 | В этом чате запрещено играть!')
            return

    if bet > stavka:
        await message.reply(f'❎ | Максимальная ставка: {stavka}💰')
        return
    if balance < bet:
        await message.reply(f'❎ | У вас нет столько монет!\n💳 | Ваш баланс: {balance}💰')
        return

    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
    users.cursor.execute(f'UPDATE users SET casino = casino + 1 WHERE id=?', (message.from_user.id,))
    if message.chat.type != 'private':
        chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))

    dice = (await bot.send_dice(message.chat.id, emoji="🎰")).dice.value
    result = get_casino_result(dice, bet, invited_users)
    await sleep(2)
    if result[0]: # 7-7-7, bar-bar-bar, etc
        users.cursor.execute(
            """UPDATE users SET balance = :sum WHERE id = :user_id;""",
            {"user_id": message.from_user.id, "sum": balance + result[1]}
        )

        await message.reply(
            f'🎰 | Вам выпала комбинация: {result[2][0]}, {result[2][1]}, {result[2][2]} (№{dice})\n'
            f'💸 | Вы выиграли: <b>{result[1]}💰</b>\n'
            f'💳 | Ваш баланс: <b>{balance + result[1]}💰</b>',
            parse_mode='html'
        )
    else: # 7-bar-bar, bar-7-7, etc
        users.cursor.execute(
            """UPDATE users SET balance = :sum WHERE id = :user_id;""",
            {"user_id": message.from_user.id, "sum": balance - result[1]}
        )

        await message.reply(
            f'🎰 | Вам выпала комбинация: {result[2][0]}, {result[2][1]}, {result[2][2]} (№{dice})\n'
            f'💸 | Вы проиграли: <b>{result[1]}💰</b>\n'
            f'💳 | Ваш баланс: <b>{balance - result[1]}💰</b>',
            parse_mode='html'
        )

    users.connect.commit()
    if message.chat.type != 'private':
        chats.connect.commit()


#Куб
@dp.message_handler(regexp=r"^(?:Куб|куб)\s+(\d+)\s+(\d+)\s*$")
async def kub(message: types.Message):
    msg = message
    command_parse = re.compile(r"(^Куб|куб) ?(\d+)? ?(\d+)?")
    parsed = command_parse.match(message.text)
    stavka = users.cursor.execute("SELECT stavka from users where id = ?", (message.from_user.id,)).fetchone()
    stavka = (stavka[0])
    dice_value = parsed.group(2)
    dice_value = int(dice_value)
    summ = parsed.group(3)
    summ = int(summ)
    name1 = message.from_user.get_mention(as_html=True)
    if message.chat.type == 'private':
        if summ <= int(stavka):
            if dice_value > 6:
                await message.reply(f"❎ | Введите сообщение в формате: \n<b>Куб (число от 1 до 6) (ставка)</b>", parse_mode='html')
            else:
                if not summ:
                    await message.reply(f"❎ | Введите сообщение в формате: \n<b>Куб (число от 1 до 6) (ставка)</b>", parse_mode='html')
                else:
                    if not dice_value:
                        await message.reply(f"❎ | Введите сообщение в формате:\n<b>Куб (число от 1 до 6) (ставка)</b>", parse_mode='html')
                    else:
                        balance = (users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone())[0]
                        invited_users = (users.cursor.execute("SELECT invited_users from users where id = ?", (message.from_user.id,)).fetchone())[0]
                        if balance >= summ:
                            dice_value = int(dice_value)
                            bot_data = await bot.send_dice (message.chat.id)
                            bot_data = bot_data['dice']['value']
                            plus = bot_data + 1
                            minus = bot_data - 1
                            summ2 = summ * 10
                            data = {}
                            data["suma"] = summ
                            data['user_id'] = message.from_user.id
                            data1 = {}
                            data1["suma"] = summ2
                            data1['user_id'] = message.from_user.id
                            await sleep(5)

                            if bot_data > dice_value:
                                await message.reply(f'🎲❌ | Вы проиграли: <b>{summ}💰</b>', parse_mode='html')
                                users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", data)
                                users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                                users.cursor.execute(f'UPDATE users SET kosti = kosti + 1 WHERE id=?', (message.from_user.id,))
                            elif bot_data < dice_value:
                                await message.reply(f'🎲❌ | Вы проиграли: <b>{summ}💰</b>', parse_mode='html')
                                users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", data)
                                users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                                users.cursor.execute(f'UPDATE users SET kosti = kosti + 1 WHERE id=?', (message.from_user.id,))
                            else:
                                await message.reply(f'🎲✅ | Вы выиграли: <b>{summ * (2 + (0.35 * invited_users))}💰</b>', parse_mode='html')
                                users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""",
                                    {"suma": summ * (5 + (0.35 * invited_users)), "user_id": message.from_user.id}
                                )
                                users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                                users.cursor.execute(f'UPDATE users SET kosti = kosti + 1 WHERE id=?', (message.from_user.id,))
                                users.connect.commit()
                        elif balance < summ:
                            balanc = users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone()
                            balance = (balanc[0])
                            await message.reply(f'❎ | У вас нет столько монет!\n💳 | Ваш баланс: {balance}💰', parse_mode='html')
        else:
            await message.reply(f'❎ | Ваша максимальная ставка: {stavka}💰', parse_mode='html')
    else:
        game_rule = chats.cursor.execute("SELECT game_rule from chats where chat_id = ?", (msg.chat.id,)).fetchone()
        game_rule = (game_rule[0])
        if str(game_rule) == 'разрешено':
            if summ <= int(stavka):
                if dice_value > 6:
                    await message.reply(f"❎ | Введите сообщение в формате: \n<b>Куб (число от 1 до 6) (ставка)</b>", parse_mode='html')
                else:
                    if not summ:
                        await message.reply(f"❎ | Введите сообщение в формате: \n<b>Куб (число от 1 до 6) (ставка)</b>", parse_mode='html')
                    else:
                        if not dice_value:
                            await message.reply(f"❎ | Введите сообщение в формате:\n<b>Куб (число от 1 до 6) (ставка)</b>", parse_mode='html')
                        else:
                            balanc = (users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone())[0]
                            invited_users = (users.cursor.execute("SELECT invited_users from users where id = ?", (message.from_user.id,)).fetchone())[0]
                            if balance >= summ:
                                dice_value = int(dice_value)
                                bot_data = await bot.send_dice (message.chat.id)
                                bot_data = bot_data['dice']['value']
                                plus = bot_data + 1
                                minus = bot_data - 1
                                summ2 = summ * 10
                                data = {}
                                data["suma"] = summ
                                data['user_id'] = message.from_user.id
                                data1 = {}
                                data1["suma"] = summ2
                                data1['user_id'] = message.from_user.id
                                await sleep(5)

                                if bot_data > dice_value:
                                    await message.reply(f'🎲❌ | Вы проиграли: <b>{summ}💰</b>', parse_mode='html')
                                    users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", data)
                                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                                    users.cursor.execute(f'UPDATE users SET kosti = kosti + 1 WHERE id=?', (message.from_user.id,))
                                    chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                                    users.connect.commit()
                                    chats.connect.commit()
                                elif bot_data < dice_value:
                                    await message.reply(f'🎲❌ | Вы проиграли: <b>{summ}💰</b>', parse_mode='html')
                                    users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", data)
                                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                                    users.cursor.execute(f'UPDATE users SET kosti = kosti + 1 WHERE id=?', (message.from_user.id,))
                                    chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                                    users.connect.commit()
                                    chats.connect.commit()
                                else:
                                    await message.reply(f'🎲✅ | Вы выиграли: <b>{summ * (2 + (0.35 * invited_users))}💰</b>', parse_mode='html')
                                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""",
                                        {"suma": summ * (5 + (0.35 * invited_users)), "user_id": message.from_user.id}
                                    )
                                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                                    users.cursor.execute(f'UPDATE users SET kosti = kosti + 1 WHERE id=?', (message.from_user.id,))
                                    chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                                    users.connect.commit()
                                    chats.connect.commit()
                            elif balance < summ:
                                balanc = users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone()
                                balance = (balanc[0])
                                await message.reply(f'❎ | У вас нет столько монет!\n💳 | Ваш баланс: {balance}💰', parse_mode='html')
            else:
                await message.reply(f'❎ | Ваша максимальная ставка: {stavka}💰', parse_mode='html')
        else:
            await message.reply(f'🚫 | В этом чате запрещено играть!')

#Дартс
@dp.message_handler(regexp=r"^(?:Дартс|дартс)\s+(\d+)\s*$")
async def darts(message: types.Message):
    msg = message
    command_parse = re.compile(r"(^Дартс|дартс) ?(\d+)?")
    parsed = command_parse.match(message.text)
    summ = parsed.group(2)
    name1 = message.from_user.get_mention(as_html=True)
    summ = int(summ)
    suma = int(summ) * 2
    name1 = message.from_user.get_mention(as_html=True)
    data = {}
    data["suma"] = suma
    data['user_id'] = message.from_user.id
    data1 = {}
    data1["suma"] = summ
    data1['user_id'] = message.from_user.id
    balance = (users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone())[0]
    stavka = (users.cursor.execute("SELECT stavka from users where id = ?", (message.from_user.id,)).fetchone())[0]
    invited_users = (users.cursor.execute("SELECT invited_users from users where id = ?", (message.from_user.id,)).fetchone())[0]

    if message.chat.type == 'private':
        if balance >= summ:
            if summ <= int(stavka):
                bot_data = await bot.send_dice(message.chat.id, emoji='🎯')
                bot_data = bot_data['dice']['value']
                await sleep(3)
                if bot_data == 6:
                    await message.reply(f'🎯✅ | Вы попали прямо в цель и выиграли: <b>{summ * (2 + (0.35 * invited_users))}</b>💰', parse_mode='html')
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""",
                        {"suma": summ * (2 + (0.35 * invited_users)), "user_id": message.from_user.id}
                    )
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET darts = darts + 1 WHERE id=?', (message.from_user.id,))
                    users.connect.commit()
                elif bot_data == 1:
                    await message.reply(f'🎯❌ | Такой себе бросок, деньги остаются при вас')
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET darts = darts + 1 WHERE id=?', (message.from_user.id,))
                    users.connect.commit()
                else:
                    await message.reply(f'🎯❌ | Вы промазали и проиграли: <b>{summ}</b>💰', parse_mode='html')
                    users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", data1)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET darts = darts + 1 WHERE id=?', (message.from_user.id,))
                    users.connect.commit()
            else:
                await message.reply(f'❎ | Ваша максимальная ставка: {stavka}💰', parse_mode='html')
        else:
            await message.reply(f'❎ | У вас нет столько монет!\n💳 | Ваш баланс: {balance}💰', parse_mode='html')
    else:
        game_rule = chats.cursor.execute("SELECT game_rule from chats where chat_id = ?", (msg.chat.id,)).fetchone()
        game_rule = (game_rule[0])
        if str(game_rule) == 'разрешено':
            if balance >= summ:
                if summ <= (stavka):
                    bot_data = await bot.send_dice(message.chat.id, emoji='🎯')
                    bot_data = bot_data['dice']['value']
                    await sleep(3)
                    if bot_data == 6:
                        await message.reply(f'🎯✅ | Вы попали прямо в цель и выиграли: <b>{summ * (2 + (0.35 * invited_users))}</b>💰', parse_mode='html')
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""",
                            {"suma": summ * (2 + (0.35 * invited_users)), "user_id": message.from_user.id}
                        )
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET darts = darts + 1 WHERE id=?', (message.from_user.id,))
                        chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                        chats.connect.commit()
                        users.connect.commit()
                    elif bot_data == 1:
                        await message.reply(f'🎯❌ | Такой себе бросок, деньги остаются при вас')
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET darts = darts + 1 WHERE id=?', (message.from_user.id,))
                        chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                        chats.connect.commit()
                        users.connect.commit()
                    else:
                        await message.reply(f'🎯❌ | Вы промазали и проиграли: <b>{summ}</b>💰', parse_mode='html')
                        users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", data1)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET darts = darts + 1 WHERE id=?', (message.from_user.id,))
                        chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                        chats.connect.commit()
                        users.connect.commit()
                else:
                    await message.reply(f'❎ | Ваша максимальная ставка: {stavka}💰', parse_mode='html')
            else:
                await message.reply(f'❎ | У вас нет столько монет!\n💳 | Ваш баланс: {balance}💰', parse_mode='html')
        else:
            await message.reply(f'🚫 | В этом чате запрещено играть!')

#Боул
@dp.message_handler(regexp=r"^(?:Боул|боул)\s+(\d+)\s*$")
async def boul(message: types.Message):
    msg = message
    command_parse = re.compile(r"(^Боул|боул) ?(\d+)?")
    parsed = command_parse.match(message.text)
    summ = parsed.group(2)
    summ = int(summ)
    suma = int(summ) * 2
    name1 = message.from_user.get_mention(as_html=True)
    data = {}
    data["suma"] = suma
    data['user_id'] = message.from_user.id
    data1 = {}
    data1["suma"] = summ
    data1['user_id'] = message.from_user.id
    balanc = users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone()
    balance = (balanc[0])
    stavka = users.cursor.execute("SELECT stavka from users where id = ?", (message.from_user.id,)).fetchone()
    stavka = (stavka[0])
    invited_users = users.cursor.execute("SELECT invited_users from users where id = ?", (message.from_user.id,)).fetchone()
    invited_users = (invited_users[0])
    if message.chat.type == 'private':
        if balance >= summ:
            if summ <= int(stavka):
                bot_data = await bot.send_dice(message.chat.id, emoji='🎳')
                bot_data = bot_data['dice']['value']
                await sleep(3)
                if bot_data == 6:
                    await message.reply(f'🎳💥 | Вы сбили все кегли и выиграли: <b>{summ * (2 + (0.35 * invited_users))}</b>💰', parse_mode='html')
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""",
                        {"suma": summ * (2 + (0.35 * invited_users)), "user_id": message.from_user.id}
                    )
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET bouling = bouling + 1 WHERE id=?', (message.from_user.id,))
                    users.connect.commit()
                elif bot_data == 1:
                    await message.reply(f'🎳❌ | Такой себе бросок, деньги остаются при вас')
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET bouling = bouling + 1 WHERE id=?', (message.from_user.id,))
                    users.connect.commit()
                else:
                    await message.reply(f'🎳❌ | Вы промазали и проиграли: <b>{summ}</b>💰', parse_mode='html')
                    users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", data1)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET bouling = bouling + 1 WHERE id=?', (message.from_user.id,))
                    users.connect.commit()
            else:
                await message.reply(f'❎ | Ваша максимальная ставка: {stavka}💰', parse_mode='html')
        elif balance < summ:
            balanc = users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone()
            balance = (balanc[0])
            await message.reply(f'❎ | У вас нет столько монет!\n💳 | Ваш баланс: {balance}💰', parse_mode='html')
    else:
        game_rule = chats.cursor.execute("SELECT game_rule from chats where chat_id = ?", (msg.chat.id,)).fetchone()
        game_rule = (game_rule[0])
        if str(game_rule) == 'разрешено':
            if balance >= summ:
                if summ <= int(stavka):
                    bot_data = await bot.send_dice(message.chat.id, emoji='🎳')
                    bot_data = bot_data['dice']['value']
                    await sleep(3)
                    if bot_data == 6:
                        await message.reply(f'🎳💥 | Вы сбили все кегли и выиграли: <b>{summ * (2 + (0.35 * invited_users))}</b>💰', parse_mode='html')
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""",
                            {"suma": summ * (2 + (0.35 * invited_users)), "user_id": message.from_user.id}
                        )
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET bouling = bouling + 1 WHERE id=?', (message.from_user.id,))
                        chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                        chats.connect.commit()
                        users.connect.commit()
                    elif bot_data == 1:
                        await message.reply(f'🎳❌ | Такой себе бросок, деньги остаются при вас')
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET bouling = bouling + 1 WHERE id=?', (message.from_user.id,))
                        chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                        chats.connect.commit()
                        users.connect.commit()
                    else:
                        await message.reply(f'🎳❌ | Вы промазали и проиграли: <b>{summ}</b>💰', parse_mode='html')
                        users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", data1)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET bouling = bouling + 1 WHERE id=?', (message.from_user.id,))
                        chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                        chats.connect.commit()
                        users.connect.commit()
                else:
                    await message.reply(f'❎ | Ваша максимальная ставка: {stavka}💰', parse_mode='html')
            elif balance < summ:
                            balanc = users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone()
                            balance = (balanc[0])
                            await message.reply(f'❎ | У вас нет столько монет!\n💳 | Ваш баланс: {balance}💰', parse_mode='html')
        else:
            await message.reply(f'🚫 | В этом чате запрещено играть!')

#Фут
@dp.message_handler(regexp=r"^(?:Фут|фут)\s+(\d+)\s*$")
async def football(message: types.Message):
    msg = message
    command_parse = re.compile(r"(^Фут|фут) ?(\d+)?")
    parsed = command_parse.match(message.text)
    summ = parsed.group(2)
    name1 = message.from_user.get_mention(as_html=True)
    data = {}
    summ = int(summ)
    data["suma"] = summ
    data['user_id'] = message.from_user.id
    balanc = users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone()
    balance = (balanc[0])
    stavka = users.cursor.execute("SELECT stavka from users where id = ?", (message.from_user.id,)).fetchone()
    stavka = (stavka[0])
    invited_users = int((users.cursor.execute("SELECT invited_users from users where id = ?", (message.from_user.id,)).fetchone())[0])
    if message.chat.type == 'private':
        if balance >= summ:
            if summ <= int(stavka):
                bot_data = await bot.send_dice(message.chat.id, emoji='⚽')
                bot_data = bot_data['dice']['value']
                await sleep(4)
                if bot_data >= 3:
                    await message.reply(f'⚽✅ | Вы попали прямо в ворота и выиграли: <b>{summ * (1 + (0.35 * invited_users))}</b>💰', parse_mode='html')
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""",
                        {"suma": summ * (1 + (0.35 * invited_users)), "user_id": message.from_user.id}
                    )
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET footbal = footbal + 1 WHERE id=?', (message.from_user.id,))
                    users.connect.commit()
                else:
                    await message.reply(f'⚽❌ | Вы промазали и проиграли: <b>{summ}</b>💰', parse_mode='html')
                    users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", data)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET footbal = footbal + 1 WHERE id=?', (message.from_user.id,))
                    users.connect.commit()
            else:
                await message.reply(f'❎ | Ваша максимальная ставка: {stavka}💰', parse_mode='html')
        elif balance < summ:
            balanc = users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone()
            balance = (balanc[0])
            await message.reply(f'❎ | У вас нет столько монет!\n💳 | Ваш баланс: {balance}💰', parse_mode='html')
    else:
        game_rule = chats.cursor.execute("SELECT game_rule from chats where chat_id = ?", (msg.chat.id,)).fetchone()
        game_rule = (game_rule[0])
        if str(game_rule) == 'разрешено':
            if balance >= summ:
                if summ <= int(stavka):
                    bot_data = await bot.send_dice(message.chat.id, emoji='⚽')
                    bot_data = bot_data['dice']['value']
                    await sleep(4)
                    if bot_data >= 3:
                        await message.reply(f'⚽✅ | Вы попали прямо в ворота и выиграли: <b>{summ * (1 + (0.35 * invited_users))}</b>💰', parse_mode='html')
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""",
                            {"suma": summ * (1 + (0.35 * invited_users)), "user_id": message.from_user.id}
                        )
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET footbal = footbal + 1 WHERE id=?', (message.from_user.id,))
                        chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                        users.connect.commit()
                        chats.connect.commit()
                    else:
                        await message.reply(f'⚽❌ | Вы промазали и проиграли: <b>{summ}</b>💰', parse_mode='html')
                        users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", data)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET footbal = footbal + 1 WHERE id=?', (message.from_user.id,))
                        chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                        users.connect.commit()
                        chats.connect.commit()
                else:
                    await message.reply(f'❎ | Ваша максимальная ставка: {stavka}💰', parse_mode='html')
            elif balance < summ:
                            balanc = users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone()
                            balance = (balanc[0])
                            await message.reply(f'❎ | У вас нет столько монет!\n💳 | Ваш баланс: {balance}💰', parse_mode='html')
        else:
            await message.reply(f'🚫 | В этом чате запрещено играть!')

#Баскет
@dp.message_handler(regexp=r"^(?:Бас|бас|Баскет|баскет)\s+(\d+)\s*$")
async def basket(message: types.Message):
    msg = message
    command_parse = re.compile(r"(^Бас|бас|Баскет|баскет) ?(\d+)?")
    parsed = command_parse.match(message.text)
    summ = parsed.group(2)
    name1 = message.from_user.get_mention(as_html=True)
    data = {}
    data["suma"] = summ
    data['user_id'] = message.from_user.id
    balanc = users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone()
    balance = (balanc[0])
    stavka = users.cursor.execute("SELECT stavka from users where id = ?", (message.from_user.id,)).fetchone()
    stavka = (stavka[0])
    invited_users = int((users.cursor.execute("SELECT invited_users from users where id = ?", (message.from_user.id,)).fetchone())[0])
    summ = int(summ)
    if message.chat.type == 'private':
        if balance >= summ:
            if summ <= int(stavka):
                bot_data = await bot.send_dice(message.chat.id, emoji='🏀')
                bot_data = bot_data['dice']['value']
                await sleep(4)
                if bot_data >= 4:
                    await message.reply(f'🏀✅ | Вы попали прямо в кольцо и выиграли: <b>{summ * (1 + (0.35 * invited_users))}</b>💰', parse_mode='html')
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""",
                        {"suma": summ * (1 + (0.35 * invited_users)), "user_id": message.from_user.id}
                    )
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET basket = basket + 1 WHERE id=?', (message.from_user.id,))
                elif bot_data == 3:
                    await message.reply(f'🏀❌ | Упс... мяч застрял в кольце, деньги остаются при вас.', parse_mode='html')
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET basket = basket + 1 WHERE id=?', (message.from_user.id,))
                    users.connect.commit()
                else:
                    await message.reply(f'🏀❌ | Вы промазали и проиграли: <b>{summ}</b>💰', parse_mode='html')
                    users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", data)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET basket = basket + 1 WHERE id=?', (message.from_user.id,))
                    users.connect.commit()
            else:
                await message.reply(f'❎ | Ваша максимальная ставка: {stavka} 💰', parse_mode='html')
        elif balance < summ:
            balanc = users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone()
            balance = (balanc[0])
            await message.reply(f'❎ | У вас нет столько монет!\n💳 | Ваш баланс: {balance}💰', parse_mode='html')
    else:
        game_rule = chats.cursor.execute("SELECT game_rule from chats where chat_id = ?", (msg.chat.id,)).fetchone()
        game_rule = (game_rule[0])
        if str(game_rule) == 'разрешено':
            if balance >= summ:
                if summ <= int(stavka):
                    bot_data = await bot.send_dice(message.chat.id, emoji='🏀')
                    bot_data = bot_data['dice']['value']
                    await sleep(4)
                    if bot_data >= 4:
                        await message.reply(f'🏀✅ | Вы попали прямо в кольцо и выиграли: <b>{summ * (1 + (0.35 * invited_users))}</b>💰', parse_mode='html')
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""",
                            {"suma": summ * (1 + (0.35 * invited_users)), "user_id": message.from_user.id}
                        )
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET basket = basket + 1 WHERE id=?', (message.from_user.id,))
                        chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                        chats.connect.commit()
                        users.connect.commit()
                    elif bot_data == 3:
                        await message.reply(f'🏀❌ | Упс... мяч застрял в кольце, деньги остаются при вас.', parse_mode='html')
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET basket = basket + 1 WHERE id=?', (message.from_user.id,))
                        chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                        chats.connect.commit()
                        users.connect.commit()
                    else:
                        await message.reply(f'🏀❌ | Вы промазали и проиграли: <b>{summ}</b>💰', parse_mode='html')
                        users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", data)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET basket = basket + 1 WHERE id=?', (message.from_user.id,))
                        chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                        chats.connect.commit()
                        users.connect.commit()
                else:
                    await message.reply(f'❎ | Ваша максимальная ставка: {stavka}💰', parse_mode='html')
            elif balance < summ:
                balance = users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone()
                balance = (balance[0])
                await message.reply(f'❎ | У вас нет столько монет!\n💳 | Ваш баланс: {balance}💰', parse_mode='html')
        else:
            await message.reply(f'🚫 | В этом чате запрещено играть!')

#Охота
@rate_limit(limit=1.5)
@dp.message_handler(regexp=r"(^Охота|охота) ?(\d+)?")
async def nc(message: types.Message):
    name1 = message.from_user.get_mention(as_html=True)
    args = message.text.lower().split()

    if len(args) < 2:
        await message.reply("❎ | Вы не указали ставку!")
        return

    if int(args[1]) < 1:
        await message.reply("❎ | Ставка не может быть меньше нуля!")
        return

    summ2 = int(args[1])
    summ3 = int(args[1]) * 2
    summ4 = int(args[1]) * 3

    data = {}
    data["suma"] = int(args[1])
    data['user_id'] = message.from_user.id
    data1 = {}
    data1["suma"] = int(summ2)
    data1['user_id'] = message.from_user.id
    data2 = {}
    data2["suma"] = int(summ3)
    data2['user_id'] = message.from_user.id
    data3 = {}
    data3["suma"] = int(summ4)
    data3['user_id'] = message.from_user.id
    datas = {}
    datas["suma"] = int(args[1]) * 3
    datas['user_id'] = message.from_user.id
    datab = {}
    datab["suma"] = int(args[1]) * 1.5
    datab['user_id'] = message.from_user.id

    cnb = ['Заяц', 'Волк', 'Медведь', 'Мимо', 'Дядя Стёпа', 'Больница']
    game = random.choice(cnb)
    balance = users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone()
    balance = (balance[0])
    stavka = users.cursor.execute("SELECT stavka from users where id = ?", (message.from_user.id,)).fetchone()
    stavka = (stavka[0])
    if message.chat.type == 'private':
        if int(args[1]) <= int(stavka):
            if int(balance) >= int(args[1]):
                gg = await message.reply(f'💥 | Выстрел... посмотрим в кого вы попали')
                await sleep(3)
                if game == 'Заяц':
                    await gg.edit_text(f'💥🐰 | Отлично!\nВы попали в зайца, вот ваша награда: <b>{summ2}</b>💰', parse_mode='html')
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data1)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET ohota = ohota + 1 WHERE id=?', (message.from_user.id,))
                elif game == 'Волк':
                    await gg.edit_text(f'💥🐺 | Отлично!\nВы попали в волка, вот ваша награда: <b>{summ3}</b>💰', parse_mode='html')
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data2)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET ohota = ohota + 1 WHERE id=?', (message.from_user.id,))
                    users.connect.commit()
                elif game == 'Медведь':
                    await gg.edit_text(f'💥🐻 | Отлично!\nВы попали в медведя, вот ваша награда: <b>{summ4}</b>💰', parse_mode='html')
                    users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data3)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET ohota = ohota + 1 WHERE id=?', (message.from_user.id,))
                    users.connect.commit()
                elif game == 'Мимо':
                    await gg.edit_text(f'💥❎ | Вы промазали... Деньги остаются при вас', parse_mode='html')
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET ohota = ohota + 1 WHERE id=?', (message.from_user.id,))
                    users.connect.commit()
                elif game == 'Дядя Стёпа':
                    await gg.edit_text(f'💥😲 | Ёкараный бабай!\nВы попали в своего соседа дядю Стёпу, платите: <b>{int(args[1]) * 3}</b>💰, за его лечение', parse_mode='html')
                    users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", datas)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET ohota = ohota + 1 WHERE id=?', (message.from_user.id,))
                    users.connect.commit()
                elif game == 'Больница':
                    await gg.edit_text(f'🏥🐿 | Бешенная белка прогрызла вашу ногу!\nВы попали в больницу и оплатили: <b>{int(args[1]) * 1.5}</b>💰 за лечение!', parse_mode='html')
                    users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", datab)
                    users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                    users.cursor.execute(f'UPDATE users SET ohota = ohota + 1 WHERE id=?', (message.from_user.id,))
                    users.connect.commit()
            elif int(balance) < int(args[1]):
                await message.reply(f'❎ | У вас нет столько монет!\n💳 | Ваш баланс: {balance}💰 ', parse_mode='html')
        else:
            await message.reply(f'❎ | Ваша максимальная ставка: {stavka}💰', parse_mode='html')
    else:
        game_rule = chats.cursor.execute("SELECT game_rule from chats where chat_id = ?", (message.chat.id,)).fetchone()
        game_rule = (game_rule[0])
        if str(game_rule) == 'разрешено':
            if int(args[1]) <= int(stavka):
                if int(balance) >= int(args[1]):
                    gg = await message.reply(f'💥 | Выстрел... посмотрим в кого вы попали')
                    if game == 'Заяц':
                        await sleep(3)
                        await gg.edit_text(f'💥🐰 | Отлично!\nВы попали в зайца, вот ваша награда: <b>{summ2}</b>💰', parse_mode='html')
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data1)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET ohota = ohota + 1 WHERE id=?', (message.from_user.id,))
                        chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                        chats.connect.commit()
                        users.connect.commit()
                    elif game == 'Волк':
                        await sleep(3)
                        await gg.edit_text(f'💥🐺 | Отлично!\nВы попали в волка, вот ваша награда: <b>{summ3}</b>💰', parse_mode='html')
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data2)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET ohota = ohota + 1 WHERE id=?', (message.from_user.id,))
                        chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                        chats.connect.commit()
                        users.connect.commit()
                    elif game == 'Медведь':
                        await sleep(3)
                        await gg.edit_text(f'💥🐻 | Отлично!\nВы попали в медведя, вот ваша награда: <b>{summ4}</b>💰', parse_mode='html')
                        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data3)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET ohota = ohota + 1 WHERE id=?', (message.from_user.id,))
                        chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                        chats.connect.commit()
                        users.connect.commit()
                    elif game == 'Мимо':
                        await sleep(3)
                        await gg.edit_text(f'💥❎ | Вы промазали... Деньги остаются при вас', parse_mode='html')
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET ohota = ohota + 1 WHERE id=?', (message.from_user.id,))
                        chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                        chats.connect.commit()
                        users.connect.commit()
                    elif game == 'Дядя Стёпа':
                        await sleep(3)
                        await gg.edit_text(f'💥😲 | Ёкараный бабай!\nВы попали в своего соседа дядю Стёпу, платите: <b>{int(args[1]) * 3}</b>💰, за его лечение', parse_mode='html')
                        users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", datas)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET ohota = ohota + 1 WHERE id=?', (message.from_user.id,))
                        chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                        chats.connect.commit()
                        users.connect.commit()
                    elif game == 'Больница':
                        await sleep(3)
                        await gg.edit_text(f'🏥🐿 | Бешенная белка прогрызла вашу ногу!\nВы попали в больницу и оплатили: <b>{int(args[1]) * 1.5}</b>💰 за лечение!', parse_mode='html')
                        users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", datab)
                        users.cursor.execute(f'UPDATE users SET games = games + 1 WHERE id=?', (message.from_user.id,))
                        users.cursor.execute(f'UPDATE users SET ohota = ohota + 1 WHERE id=?', (message.from_user.id,))
                        chats.cursor.execute(f'UPDATE chats SET chat_games = chat_games + 1 WHERE chat_id=?', (message.chat.id,))
                        chats.connect.commit()
                        users.connect.commit()
                elif int(balance) < int(args[1]):
                    await message.reply(f'❎ | У вас нет столько монет!\n💳 | Ваш баланс: {balance}💰 ', parse_mode='html')
            else:
                await message.reply(f'❎ | Ваша максимальная ставка: {stavka} 💰', parse_mode='html')
        else:
            await message.reply(f'🚫 | В этом чате запрещено играть!')

#Пополнить
@dp.message_handler(regexp=r"(^Пополнить счёт|пополнить счёт|^Пополнить счет|пополнить счет) ?(\d+)?")
async def bankplus(message: types.Message):
    balance = users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone()
    balance = (balance[0])
    bank = users.cursor.execute("SELECT bank from users where id = ?", (message.from_user.id,)).fetchone()
    bank = (bank[0])
    command_parse = re.compile(r"(^Пополнить счёт|пополнить счёт|^Пополнить счет|пополнить счет) ?(\d+)?")
    parsed = command_parse.match(message.text)
    suma = parsed.group(2) if parsed else None
    if not suma or int(suma) <= 0:
        await message.reply("❗ | Укажите положительную сумму. Пример: Пополнить счёт 100")
        return
    suma = int(suma)
    data1 = {}
    data1["suma"] = suma
    data1['user_id'] = message.from_user.id
    if int(balance) >= suma:
        users.cursor.execute("""UPDATE users SET bank = bank + :suma WHERE id = :user_id;""", data1)
        users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", data1)
        users.connect.commit()
        await message.reply(f"Вы успешно пополнили свой счёт на <code>{suma}💰</code>", parse_mode='html')
    else:
        await message.reply(f"У вас недостаточно монет для пополнения счёта!", parse_mode='html')

#Снять
@dp.message_handler(regexp=r"(^Снять со счёта|снять со счёта|^Снять со счета|снять со счета) ?(\d+)?")
async def bankminus(message: types.Message):
    balance = users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone()
    balance = (balance[0])
    bank = users.cursor.execute("SELECT bank from users where id = ?", (message.from_user.id,)).fetchone()
    bank = (bank[0])
    command_parse = re.compile(r"(^Снять со счёта|снять со счёта|^Снять со счета|снять со счета) ?(\d+)?")
    parsed = command_parse.match(message.text)
    suma = parsed.group(2) if parsed else None
    if not suma or int(suma) <= 0:
        await message.reply("❗ | Укажите положительную сумму. Пример: Пополнить счёт 100")
        return
    suma = int(suma)
    data1 = {}
    data1["suma"] = suma
    data1['user_id'] = message.from_user.id
    if int(bank) >= suma:
        users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data1)
        users.cursor.execute("""UPDATE users SET bank = bank - :suma WHERE id = :user_id;""", data1)
        users.connect.commit()
        await message.reply(f"Вы успешно сняли <code>{suma}💰</code> со счёта!", parse_mode='html')
    else:
        await message.reply(f"У вас недостаточно средств на счету!", parse_mode='html')
    if message.text.lower() in ["Б", "б", "Баланс", "баланс", "💰", "Мои 💰", "мои 💰", "Мой 💰", "мой 💰"]:
        id = message.from_user.id
        users.cursor.execute(f"SELECT id from users WHERE id = '{id}'")
        if users.cursor.fetchone() is None:
            await message.reply(f'Вы не зарегистрированы!\nВведите /start')
        else:
            if message.reply_to_message:
                name2 = message.reply_to_message.from_user.get_mention(as_html=True)
                balance = users.cursor.execute("SELECT balance from users where id = ?", (message.reply_to_message.from_user.id,)).fetchone()
                balance = (balance[0])
                bank = users.cursor.execute("SELECT bank from users where id = ?", (message.reply_to_message.from_user.id,)).fetchone()
                bank = (bank[0])
                x1 = '{:,}'.format(balance)
                x2 = '{:,}'.format(bank)
                await message.answer(f'👤 | {name2}\n💰 | Баланс: <code>{x1}</code>\n🏦 | Банк: <code>{x2}</code>')
            else:
                name1 = message.from_user.get_mention(as_html=True)
                balance = users.cursor.execute("SELECT balance from users where id = ?", (message.from_user.id,)).fetchone()
                balance = (balance[0])
                bank = users.cursor.execute("SELECT bank from users where id = ?", (message.from_user.id,)).fetchone()
                bank = (bank[0])
                x1 = '{:,}'.format(balance)
                x2 = '{:,}'.format(bank)
                await message.answer(f'👤 | {name1}\n💰 | Баланс: <code>{x1}</code>\n🏦 | Банк: <code>{x2}</code>')

    #Топ богачей
    elif message.text.lower() in ["Топ б", "топ б", "Богачи", "богачи", "Топ 💰", "топ 💰"]:
        top15 = users.cursor.execute('SELECT name, balance FROM users WHERE balance IS NOT Null and status IS NOT "Администратор" and status IS NOT "Создатель бота" ORDER BY balance DESC LIMIT 15').fetchall()
        table = []
        for num, (fname, x) in enumerate(top15, 1):
            table.append(f'{num}. {fname} – {x}💰\n' )
        await message.answer('📊💰 | Топ 15 богачей бота:\n'+''.join(table), parse_mode='html', disable_web_page_preview=True)

    #Топ хуёв
    elif message.text.lower() in ["Топ х", "топ х", "Топ хуёв", "топ хуёв"]:
        top15 = users.cursor.execute('SELECT name, dick FROM users WHERE dick IS NOT Null and status IS NOT "Администратор" and status IS NOT "Создатель бота" ORDER BY dick DESC LIMIT 15').fetchall()
        table = []
        for num, (fname, x) in enumerate(top15, 1):
            table.append(f'{num}. {fname} – {x} см.\n' )
        await message.answer('📊🍆 | Топ 15 членов бота:\n'+''.join(table), parse_mode='markdown', disable_web_page_preview=True)

    #Топ игроков
    elif message.text.lower() in ["Топ и", "топ и", "Топ игроков", "топ игроков", "Топ 🎮", "топ 🎮"]:
        top15 = users.cursor.execute('SELECT name, games FROM users WHERE games IS NOT Null and status IS NOT "Администратор" and status IS NOT "Создатель бота" ORDER BY games DESC LIMIT 15').fetchall()
        table = []
        for num, (fname, x) in enumerate(top15, 1):
            table.append(f'{num}. {fname} - {x}\n' )
        await message.answer('📊🎮 | Топ 15 игроков бота:\n'+''.join(table), parse_mode='html', disable_web_page_preview=True)



# Баланс и рейтинги.
# В старой версии этот блок находился внутри обработчика "Снять со счёта",
# поэтому команды "Баланс" и "Топ ..." фактически никогда не запускались.
@dp.message_handler(lambda msg: msg.text and msg.text.lower() in [
    "б", "баланс", "💰", "мои 💰", "мой 💰", "топ б", "богачи", "топ 💰",
    "топ х", "топ хуёв", "топ и", "топ игроков", "топ 🎮",
])
async def balance_and_tops(message: types.Message):
    user_id = message.from_user.id
    if not users.cursor.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone():
        await message.reply("Вы не зарегистрированы!\nВведите /start")
        return

    text = message.text.lower()

    if text in {"б", "баланс", "💰", "мои 💰", "мой 💰"}:
        target = message.reply_to_message.from_user if message.reply_to_message else message.from_user
        row = users.cursor.execute(
            "SELECT balance, bank FROM users WHERE id = ?",
            (target.id,),
        ).fetchone()
        if not row:
            await message.reply("❗ | Пользователь не зарегистрирован.")
            return
        name = target.get_mention(as_html=True)
        await message.answer(
            f"👤 | {name}\n💰 | Баланс: <code>{row[0]:,}</code>\n"
            f"🏦 | Банк: <code>{row[1]:,}</code>",
            parse_mode="HTML",
        )
        return

    if text in {"топ б", "богачи", "топ 💰"}:
        rows = users.cursor.execute(
            "SELECT name, balance FROM users WHERE balance IS NOT NULL "
            "AND status NOT IN ('Администратор', 'Создатель бота', 'Система') "
            "ORDER BY balance DESC LIMIT 15"
        ).fetchall()
        await message.answer(
            "📊💰 | Топ 15 богачей бота:\n" +
            "".join(f"{i}. {name} – {value}💰\n" for i, (name, value) in enumerate(rows, 1)),
        )
        return

    if text in {"топ х", "топ хуёв"}:
        rows = users.cursor.execute(
            "SELECT name, dick FROM users WHERE dick IS NOT NULL "
            "AND status NOT IN ('Администратор', 'Создатель бота', 'Система') "
            "ORDER BY dick DESC LIMIT 15"
        ).fetchall()
        await message.answer(
            "📊🍆 | Топ 15 членов бота:\n" +
            "".join(f"{i}. {name} – {value} см.\n" for i, (name, value) in enumerate(rows, 1)),
        )
        return

    rows = users.cursor.execute(
        "SELECT name, games FROM users WHERE games IS NOT NULL "
        "AND status NOT IN ('Администратор', 'Создатель бота', 'Система') "
        "ORDER BY games DESC LIMIT 15"
    ).fetchall()
    await message.answer(
        "📊🎮 | Топ 15 игроков бота:\n" +
        "".join(f"{i}. {name} – {value}\n" for i, (name, value) in enumerate(rows, 1)),
    )


#admin_cmd
@dp.message_handler(commands=[''])
async def admins_cmd(message: types.Message):
    status = users.cursor.execute("SELECT status from users where id = ?", (message.from_user.id,)).fetchone()
    status = (status[0])
    if str(status) == 'Хелпер' or str(status) == 'Система':
        await message.reply(f"""Команды для администраторв бота:
"Выдать (количество)" - выдать монеты пользоватлею
"Забрать (количество)" - забрать монеты у пользователя
/setbal - изменить баланс пользователю
/user_status - изменить статус пользователя""")
    else:
        pass
    #Разрешить игры
@dp.message_handler(lambda msg: msg.text.lower() == 'разрешить игры')
async def games_on(message):
    name = message.from_user.get_mention()
    chat_username = message.chat.username
    admins_list = [admin.user.id for admin in await bot.get_chat_administrators(chat_id=message.chat.id)]
    stts = users.cursor.execute("SELECT status from users where id = ?", (message.from_user.id,)).fetchone()
    status = (stts[0])
    id = message.from_user.id
    users.cursor.execute(f"SELECT id from users WHERE id = '{id}'")
    if users.cursor.fetchone() is None:
        await message.reply(f'Вы не зарегистрированы!\nВведите /start')
    else:
        if message.from_user.id in admins_list or str(status) in ('Создатель бота', 'Система') or message.from_user.id == config.owner:
            game_rule = chats.cursor.execute("SELECT game_rule from chats where chat_id = ?", (message.chat.id,)).fetchone()
            game_rule = (game_rule[0])
            if str(game_rule) == 'разрешено':
                await message.reply(f'🎮❗| В этом чате игры уже разрешены!')
            else:
                chats.cursor.execute('UPDATE chats SET game_rule = ? WHERE chat_id = ?', ("разрешено", message.chat.id))
                chats.connect.commit()
                await message.answer(f'🎮✅ | В этом чате игры теперь разрешены!')
                await bot.send_message(config.owner, f'{name} разрешил игры в чате @{chat_username}')
        else:
            await message.reply(f'👮‍♂️❎ | Вы не являетесь администратором этого чата!')

#Запретить игры
@dp.message_handler(lambda msg: msg.text.lower() == 'запретить игры')
async def games_off(message):
    name = message.from_user.get_mention()
    chat_username = message.chat.username
    admins_list = [admin.user.id for admin in await bot.get_chat_administrators(chat_id=message.chat.id)]
    stts = users.cursor.execute("SELECT status from users where id = ?", (message.from_user.id,)).fetchone()
    status = (stts[0])
    id = message.from_user.id
    users.cursor.execute(f"SELECT id from users WHERE id = '{id}'")
    if users.cursor.fetchone() is None:
        await message.reply(f'Вы не зарегистрированы!\nВведите /start')
    else:
        if message.from_user.id in admins_list or str(status) in ('Создатель бота', 'Система') or message.from_user.id == config.owner:
            game_rule = chats.cursor.execute("SELECT game_rule from chats where chat_id = ?", (message.chat.id,)).fetchone()
            game_rule = (game_rule[0])
            if str(game_rule) == 'запрещено':
                await message.reply(f'🎮❗| В этом чате игры уже запрещены!')
            else:
                chats.cursor.execute('UPDATE chats SET game_rule = ? WHERE chat_id = ?', ("запрещено", message.chat.id))
                chats.connect.commit()
                await message.answer(f'🎮❎ | В этом чате игры теперь запрещены!')
                await bot.send_message(config.owner, f'{name} запретил игры в чате @{chat_username}')
        else:
            await message.reply(f'👮‍♂️❎ | Вы не являетесь администратором этого чата!')