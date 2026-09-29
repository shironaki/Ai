from aiogram import types

from main import config, users, chats, random, bot, InlineKeyboardMarkup, datetime, timedelta, re, dp, sqlite3

#user_status
@dp.message_handler(commands=['setstatus'])
async def set_status(message: types.Message):
    msg = message
    id = msg.from_user.id
    stata = (msg.get_args() or "").strip()
    if not msg.reply_to_message:
        await msg.reply("❗ | Ответьте на сообщение пользователя.")
        return
    status_row = users.cursor.execute("SELECT status from users where id = ?", (message.from_user.id,)).fetchone()
    if not status_row:
        await msg.reply("❗ | Введите /start для регистрации.")
        return
    status = status_row[0]
    name_link = users.cursor.execute("SELECT name from users where id = ?", (msg.reply_to_message.from_user.id,)).fetchone()
    name_link = (name_link[0])
    status_rep = users.cursor.execute("SELECT status from users where id = ?", (msg.reply_to_message.from_user.id,)).fetchone()
    status_rep = (status_rep[0])
    emoji = random.choice(["😐", "🤨", "😔", "😟"])
    if str(status) == 'Система' or int(id) == config.owner:
        if str(stata) == 'Система' or str(stata) == 'Хелпер' or str(stata) == 'NPC' or str(stata) == 'Игрок':
            users.cursor.execute('UPDATE users SET status = ? WHERE id = ?', (stata, msg.reply_to_message.from_user.id))
            users.connect.commit()
            await msg.answer(f'✅ | Успешно!\nу пользователя {name_link}\nОбновлен статус: {stata}')
        else:
            await msg.reply(f'{emoji} | Таких статусов нет!\nВведите "статусы", чтобы увидеть список доступных статусов')
    elif str(status) == 'Хелпер':
        if msg['reply_to_message']['from']['id'] != msg['from']['id']:
            if str(stata) == 'NPC' or str(stata) == 'Игрок':
                if str(status_rep) == 'Система' or str(status_rep) == 'Хелпер':
                    users.cursor.execute('UPDATE users SET status = ? WHERE id = ?', (stata, msg.reply_to_message.from_user.id))
                    users.connect.commit()
                    await msg.answer(f'✅ | Успешно!\nу пользователя {name_link}\nОбновлен статус: {stata}')
                else:
                    await msg.reply(f'{emoji} | Вы пустота, чтобы менять статус этого существа!')
            else:
                await msg.reply(f'{emoji} | Вы никто для изменения статуса этого существа!')
        else:
            await msg.reply(f'{emoji} | ОШИБКА: Вы слишком много на себя берёте.')
    else:
        await msg.reply(f'{emoji} | Вы не являетесь Хелпером!')

# расширение территории
#/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////#

#deluser
@dp.message_handler(commands=['deluser'])
async def deluser(message: types.Message):
    reply = message.reply_to_message
    status_row = users.cursor.execute("SELECT status from users where id = ?", (message.from_user.id,)).fetchone()
    status = status_row[0] if status_row else None

    if str(status) == 'Система' or message.from_user.id == config.owner:
        if reply:
            users.cursor.execute("DELETE FROM users WHERE id = ?", (reply.from_user.id,))
            users.connect.commit()
            await message.reply(
                f"✅ | <b>{reply.from_user.get_mention(as_html=True)}</b> сгорел.",
                parse_mode="html"
            )
    else:
        return await message.reply("❗ | У вас недостаточно могущества для этого действия!")
    
#chatwelcome
@dp.message_handler(commands=["welcome"])
async def rules_cmd(message: types.Message):
    if message.chat.type == "supergroup" or message.chat.type == "group":
        user_id = message.from_user.id
        chat_id = message.chat.id
        new_welcome = message.get_args()
        admins_list = [admin.user.id for admin in await bot.get_chat_administrators(chat_id=chat_id)]
        if user_id in admins_list:
            if new_welcome:
                chats.cursor.execute("UPDATE chats SET welcome=? WHERE chat_id=?", (new_welcome, chat_id,))
                chats.connect.commit()
                await message.answer("👋 Приветствие мира было успешно изменено!")
            else:
                await message.answer("💬 Вы не указали новое приветствие!")
        else:
            await message.answer("🛡️ Вы не являетесь Хелпером этого мира!")
    else:
        await message.answer("Эта заклинание работает только в мире!")
  
#+барьер
@dp.message_handler(lambda msg: msg.text.lower() == 'снять барьер')
async def moder_on(message):
    name = message.from_user.get_mention()
    chat_username = message.chat.username
    admins_list = [admin.user.id for admin in await bot.get_chat_administrators(chat_id=message.chat.id)]
    stts = users.cursor.execute("SELECT status from users where id = ?", (message.from_user.id,)).fetchone()
    status = (stts[0])
    id = message.from_user.id
    users.cursor.execute(f"SELECT id from users WHERE id = '{id}'")
    if users.cursor.fetchone() is None:
        await message.reply(f'Вы не существуете!\nВведите /start')
    else:
        if message.from_user.id in admins_list or str(status) == 'Система':
            mod_cmd = chats.cursor.execute("SELECT mod_cmd from chats where chat_id = ?", (message.chat.id,)).fetchone()
            mod_cmd = (mod_cmd[0])
            if str(mod_cmd) == 'да':
                await message.reply(f'❎ | С этого мира снят магический барьер!')
            else:
                chats.cursor.execute('UPDATE chats SET mod_cmd = ? WHERE chat_id = ?', ("да", message.chat.id))
                chats.connect.commit()
                await message.answer(f'✅ | В этом мире отсутствует магический барьер!')
                await bot.send_message(config.owner, f'{name} снял магический барьер с мира @{chat_username}')
        else:
            await message.reply(f'👮‍♂️❎ | Вы не являетесь Хелпером этого мира!')

#-барьер
@dp.message_handler(lambda msg: msg.text.lower() == 'установить барьер')
async def moder_off(message):
    name = message.from_user.get_mention()
    chat_username = message.chat.username
    admins_list = [admin.user.id for admin in await bot.get_chat_administrators(chat_id=message.chat.id)]
    stts = users.cursor.execute("SELECT status from users where id = ?", (message.from_user.id,)).fetchone()
    status = (stts)
    id = message.from_user.id
    users.cursor.execute(f"SELECT id from users WHERE id = '{id}'")
    if users.cursor.fetchone() is None:
        await message.reply(f'Вы не существуете!\nВведите /start')
    else:
        if message.from_user.id in admins_list or str(status) == 'Система':
            mod_cmd = chats.cursor.execute("SELECT mod_cmd from chats where chat_id = ?", (message.chat.id,)).fetchone()
            mod_cmd = (mod_cmd[0])
            if str(mod_cmd) == 'нет':
                await message.reply(f'❎ | В этом мире установлен магический барьер!')
            else:
                chats.cursor.execute('UPDATE chats SET mod_cmd = ? WHERE chat_id = ?', ("нет", message.chat.id))
                chats.connect.commit()
                await message.answer(f'✅ | В этом мире установлен магический барьер!')
                await bot.send_message(config.owner, f'{name} установил магический барьер в мире @{chat_username}')
        else:
            await message.reply(f'👮‍♂️❎ | Вы не являетесь Хелпером!')

#кляп
@dp.message_handler(commands=['мут', 'mute','дебафф'], commands_prefix='!?./', is_chat_admin=True)
async def mute(message):
    msg = message
    if not msg.reply_to_message:
        await msg.reply("❗ | Ответьте на сообщение пользователя.")
        return
    name1 = msg.from_user.get_mention()
    name2 = msg.reply_to_message.from_user.get_mention()
    mod_cmd = chats.cursor.execute("SELECT mod_cmd from chats where chat_id = ?", (message.chat.id,)).fetchone()
    mod_cmd = (mod_cmd[0])
    if str(mod_cmd) == 'да':
        if not message.reply_to_message:
            await message.reply("Укажи на дефективного!")
            return
        try:
            muteint = int(message.text.split()[1])
            mutetype = message.text.split()[2]
            comment = " ".join(message.text.split()[3:])
        except IndexError:
            await message.reply('❎ | Учи заклинание')
            return
        if str(comment) != '':
            if mutetype == "ч" or mutetype == "часов" or mutetype == "час" or mutetype == "часа":
                await bot.restrict_chat_member(message.chat.id, message.reply_to_message.from_user.id, types.ChatPermissions(False), until_date=timedelta(hours=muteint))
                await message.answer(f'👤 | Система \n🔇 | Зачаровала {name2}\n🛡 ️| ID наказуемого: <code>{message.reply_to_message.from_user.id}</code>\n🕰 | Длительность мута: {muteint} {mutetype}\n💬 | Причина: {comment}')
            if mutetype == "м" or mutetype == "минут" or mutetype == "минуты" or mutetype == "минута":
                await bot.restrict_chat_member(message.chat.id, message.reply_to_message.from_user.id, types.ChatPermissions(False), until_date=timedelta(minutes=muteint))
                await message.answer(f'👤 | Система \n🔇 | Зачаровала {name2}\n🛡 ️| ID наказуемого: <code>{message.reply_to_message.from_user.id}</code>\n🕰 | Длительность мута: {muteint} {mutetype}\n💬 | Причина: {comment}')
            if mutetype == "д" or mutetype == "дней" or mutetype == "день" or mutetype == "дня":
                await bot.restrict_chat_member(message.chat.id, message.reply_to_message.from_user.id, types.ChatPermissions(False), until_date=timedelta(days=muteint))
                await message.answer(f'👤 | Система \n🔇 | Зачаровала {name2}\n🛡 ️| ID наказуемого: <code>{message.reply_to_message.from_user.id}</code>\n🕰 | Длительность мута: {muteint} {mutetype}\n💬 | Причина: {comment}')
        else:
            if mutetype == "ч" or mutetype == "часов" or mutetype == "час" or mutetype == "часа": 
                await bot.restrict_chat_member(message.chat.id, message.reply_to_message.from_user.id, types.ChatPermissions(False), until_date=timedelta(hours=muteint))
                await message.answer(f'👤 | Система \n🔇 | Зачаровала {name2}\n🛡 ️| ID наказуемого: <code>{message.reply_to_message.from_user.id}</code>\n🕰 | Длительность мута: {muteint} {mutetype}')
            if mutetype == "м" or mutetype == "минут" or mutetype == "минуты" or mutetype == "минута":
                await bot.restrict_chat_member(message.chat.id, message.reply_to_message.from_user.id, types.ChatPermissions(False), until_date=timedelta(minutes=muteint))
                await message.answer(f'👤 | Система \n🔇 | Зачаровала {name2}\n🛡 ️| ID наказуемого: <code>{message.reply_to_message.from_user.id}</code>\n🕰 | Длительность мута: {muteint} {mutetype}')
            if mutetype == "д" or mutetype == "дней" or mutetype == "день" or mutetype == "дня":
                await bot.restrict_chat_member(message.chat.id, message.reply_to_message.from_user.id, types.ChatPermissions(False), until_date=timedelta(days=muteint))
                await message.answer(f'👤 | Система \n🔇 | Зачаровала {name2}\n🛡 ️| ID наказуемого: <code>{message.reply_to_message.from_user.id}</code>\n🕰 | Длительность мута: {muteint} {mutetype}')
    else:
        pass

#Анмут
@dp.message_handler(commands=['андебафф', 'размут', 'unmute'], commands_prefix='!?./', is_chat_admin=True)
async def unmute(message):
    msg = message
    if not msg.reply_to_message:
        await msg.reply("❗ | Ответьте на сообщение пользователя.")
        return
    name1 = msg.from_user.get_mention()
    name2 = msg.reply_to_message.from_user.get_mention()
    mod_cmd = chats.cursor.execute("SELECT mod_cmd from chats where chat_id = ?", (message.chat.id,)).fetchone()
    mod_cmd = (mod_cmd[0])
    if str(mod_cmd) == 'да':
        if not message.reply_to_message:
            await message.reply("Укажи на исправившегося!")
            return
        await bot.restrict_chat_member(message.chat.id, message.reply_to_message.from_user.id, types.ChatPermissions(True, True, True, True))
        await message.reply(f'👤 | Система \n📢 | Сняла чары с {name2}')
        await bot.send_message(message.reply_to_message.from_user.id, f'✅ | Вы снова можете использовать свой голос @{message.chat.username}')
    else:
        pass

# Аннигиляция | Пинок Системы
@dp.message_handler(commands=['аннигилировать', 'ban'], commands_prefix='!?./', is_chat_admin=True)
async def ban(message):
    msg = message
    if not msg.reply_to_message:
        await msg.reply("❗ | Ответьте на сообщение пользователя.")
        return
    name1 = msg.from_user.get_mention()
    name2 = msg.reply_to_message.from_user.get_mention()
    mod_cmd = chats.cursor.execute("SELECT mod_cmd from chats where chat_id = ?", (message.chat.id,)).fetchone()
    mod_cmd = (mod_cmd[0])
    if str(mod_cmd) == 'да':
        if not message.reply_to_message:
            await message.reply("Укажи на усеченного!")
            return
        try:
            banint = int(message.text.split()[1])
            bantype = message.text.split()[2]
            comment = " ".join(message.text.split()[3:])
        except IndexError:
            await message.reply('❎ | Учи заклинание')
            return
        if str(comment) != '':
            if bantype == "ч" or bantype == "часов" or bantype == "час" or bantype == "часа": 
                await bot.ban_chat_member(message.chat.id, message.reply_to_message.from_user.id, until_date=timedelta(hours=banint))
                await message.answer(f'👤 | Система \n🔇 | Аннигилировала {name2}\n🛡 ️| ID наказуемого: <code>{message.reply_to_message.from_user.id}</code>\n🕰 | Длительность бана: {banint} {bantype}\n💬 | Причина: {comment}')
            if bantype == "м" or bantype == "минут" or bantype == "минуты" or bantype  == "минута":
                await bot.ban_chat_member(message.chat.id, message.reply_to_message.from_user.id, until_date=timedelta(minutes=banint))
                await message.answer(f'👤 | Система \n🔇 | Аннигилировала {name2}\n🛡 ️| ID наказуемого: <code>{message.reply_to_message.from_user.id}</code>\n🕰 | Длительность бана: {banint} {bantype}\n💬 | Причина: {comment}')
            if bantype == "д" or bantype == "дней" or bantype == "день" or bantype == "дня":
                await bot.ban_chat_member(message.chat.id, message.reply_to_message.from_user.id, until_date=timedelta(days=banint))
                await message.answer(f'👤 | Система \n🔇 | Аннигилировала {name2}\n🛡 ️| ID наказуемого: <code>{message.reply_to_message.from_user.id}</code>\n🕰 | Длительность бана: {banint} {bantype}\n💬 | Причина: {comment}')
        else:
            if bantype == "ч" or bantype == "часов" or bantype == "час" or bantype == "часа":
                await bot.ban_chat_member(message.chat.id, message.reply_to_message.from_user.id, until_date=timedelta(hours=banint))
                await message.answer(f'👤 | Система \n🔇 | Аннигилировала {name2}\n🛡 ️| ID наказуемого: <code>{message.reply_to_message.from_user.id}</code>\n🕰 | Длительность бана: {banint} {bantype}')
            if bantype == "м" or bantype == "минут" or bantype == "минуты" or bantype == "минута":
                await bot.ban_chat_member(message.chat.id, message.reply_to_message.from_user.id, until_date=timedelta(minutes=banint))
                await message.answer(f'👤 | Система \n🔇 | Аннигилировала {name2}\n🛡 ️| ID наказуемого: <code>{message.reply_to_message.from_user.id}</code>\n🕰 | Длительность бана: {banint} {bantype}')
            if bantype == "д" or bantype == "дней" or bantype == "день" or bantype == "дня ":
                await bot.ban_chat_member(message.chat.id, message.reply_to_message.from_user.id, until_date=timedelta(days=banint))
                await message.answer(f'👤 | Система \n🔇 | Аннигилировала {name2}\n🛡 ️| ID наказуемого: <code>{message.reply_to_message.from_user.id}</code>\n🕰 | Длительность бана: {banint} {bantype}')
    else:
        pass

#Воскрешение
@dp.message_handler(commands=['воскресить', 'unban'], commands_prefix='!?./', is_chat_admin=True)
async def unban(message):
    msg = message
    if not msg.reply_to_message:
        await msg.reply("❗ | Ответьте на сообщение пользователя.")
        return
    name1 = msg.from_user.get_mention()
    name2 = msg.reply_to_message.from_user.get_mention()
    mod_cmd = chats.cursor.execute("SELECT mod_cmd from chats where chat_id = ?", (message.chat.id,)).fetchone()
    mod_cmd = (mod_cmd[0])
    if str(mod_cmd) == 'да':
        if not msg.reply_to_message:
            await msg.reply("Укажи на очищенного!")
            return
        await bot.unban_chat_member(msg.chat.id, msg.reply_to_message.from_user.id, only_if_banned=True)
        await msg.reply(f'👤 | Система \n📢 | Воскресила {name2}')
        await bot.send_message(message.reply_to_message.from_user.id, f'✅ | Вы были воскрешенны в мире @{message.chat.username}')
    else:
        pass
    
#Выдать
@dp.message_handler(regexp=r"(^Выдать|выдать) ?(\d+)?")
async def vidat(message: types.Message):
    command_parse = re.compile(r"(^Выдать|выдать) ?(\d+)?")
    parsed = command_parse.match(message.text)
    suma = parsed.group(2) if parsed else None
    if not message.reply_to_message:
        await message.reply("❗ | Используйте команду ответом на сообщение.")
        return
    if not suma or int(suma) <= 0:
        await message.reply("❗ | Укажите положительное число.")
        return
    name1 = message.from_user.get_mention(as_html=True)
    name2 = message.reply_to_message.from_user.get_mention(as_html=True)
    data = {}
    data["suma"] = suma
    data['user_id'] = message.reply_to_message.from_user.id
    stts = users.cursor.execute("SELECT status from users where id = ?", (message.from_user.id,)).fetchone()
    status = (stts[0])
    if str(status) == 'Администратор':
        if suma is None:
            await message.reply(f'Введите число!')
        else:
            users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
            await message.answer(f"Администратор: {name1}\nВыдал: {suma} 💰\nПользователю: {name2}", parse_mode='html')
            await bot.send_message(config.owner, f'{name1} выдал {suma}💰 пользователю {name2}')
    elif str(status) == 'Создатель бота':
        if suma is None:
            await message.reply(f'Введите число!')
        else:
            users.cursor.execute("""UPDATE users SET balance = balance + :suma WHERE id = :user_id;""", data)
            await message.answer(f"Администратор: {name1}\nВыдал: {suma} 💰\nПользователю: {name2}", parse_mode='html')
    else:
        await message.reply(f"🚫 | У вас недостаточно прав для того, чтобы взаимодействовать с балансами пользователей!", parse_mode='html')
    users.connect.commit()

#Забрать
@dp.message_handler(regexp=r"(^Забрать|забрать) ?(\d+)?")
async def zabrat(message: types.Message):
    command_parse = re.compile(r"(^Забрать|забрать) ?(\d+)?")
    parsed = command_parse.match(message.text)
    suma = parsed.group(2) if parsed else None
    if not message.reply_to_message:
        await message.reply("❗ | Используйте команду ответом на сообщение.")
        return
    if not suma or int(suma) <= 0:
        await message.reply("❗ | Укажите положительное число.")
        return
    name1 = message.from_user.get_mention(as_html=True)
    name2 = message.reply_to_message.from_user.get_mention(as_html=True)
    data = {}
    data["suma"] = suma
    data['user_id'] = message.reply_to_message.from_user.id
    stts = users.cursor.execute("SELECT status from users where id = ?", (message.from_user.id,)).fetchone()
    status = (stts[0])
    if str(status) == 'Администратор':
        if suma is None:
            await message.reply(f'Введите число!')
        else:
            users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", data)
            await message.answer(f"Администратор: {name1}\nЗабрал: {suma} 💰\nУ пользователя: {name2}", parse_mode='html')
            await bot.send_message(config.owner, f'{name1} забрал {suma}💰 у пользователя {name2}')
    elif str(status) == 'Создатель бота':
        if suma is None:
            await message.reply(f'Введите число!')
        else:
            users.cursor.execute("""UPDATE users SET balance = balance - :suma WHERE id = :user_id;""", data)
            await message.answer(f"Администратор: {name1}\nЗабрал: {suma} 💰\nУ пользователя: {name2}", parse_mode='html')
    else:
        await message.reply(f"🚫 | У вас недостаточно прав для того, чтобы взаимодействовать с балансами пользователей!", parse_mode='html')
    users.connect.commit()

#Установить баланс
@dp.message_handler(commands=['setbal'])
async def setbal(message: types.Message):
    args = (message.get_args() or "").strip()
    if not args.isdigit():
        await message.reply("❗ | Укажите число. Пример: /setbal 100")
        return
    summ = int(args)
    users.cursor.execute("SELECT balance FROM users WHERE id=?", (message.from_user.id,))
    data = users.cursor.fetchone()
    if data is None:
        await message.reply("Не найден в базе данных!")
    stts = users.cursor.execute("SELECT status from users where id = ?", (message.from_user.id,)).fetchone()
    status = (stts[0])
    if str(status) == 'Создатель бота':
        reply = message.reply_to_message
        if reply:
            replyuser = reply.from_user
            users.cursor.execute(f'UPDATE users SET balance=? WHERE id=?', (summ, replyuser.id,))
            users.connect.commit()
            await message.answer(f"Пользователю: {replyuser.full_name}\nИзменлили баланс на: {summ} 💰")
    elif str(status) == 'Администратор':
        reply = message.reply_to_message
        if reply:
            replyuser = reply.from_user
            users.cursor.execute(f'UPDATE users SET balance=? WHERE id=?', (args, replyuser.id,))
            users.connect.commit()
            await message.answer(f"Пользователю: {replyuser.full_name}\nИзменлили баланс на: {summ} 💰")
        else:
            await message.reply(f"❗ | Необходим реплай!")
    else:
        return await message.reply(f"❗ | У вас недостаточно прав для того, чтобы взаимодействовать с балансами пользователей!")


#репорт
@dp.message_handler(commands=['r', 'report'])
async def cmd_report(message: types.Message):
    try:
        if message.text == '/report' or message.text == '/r' or not message.reply_to_message:
            await bot.send_message(message.chat.id, '📖 Введите причину репорта отвечая на сообщение с нарушением, пример: \n<code>/report спам/реклама</code>')
        else:
            members = await message.chat.get_member(message.reply_to_message.from_user.id)
            info = await bot.get_chat_member(message.chat.id, message.from_user.id)
            report = message.text.replace('/r ', '')
            report = report.replace('/report ', '')
            admins = await bot.get_chat_administrators('@' + message.chat.username)
            send = 0
            for admin in admins:
                if admin.user.username != 'Аи':
                    try:
                        await bot.send_message(config.owner, f'📬 Репорт по причине: ' + str(report) + f'\n\nhttps://t.me/{message.chat.username}/{message.reply_to_message.message_id}')
                    except:
                        pass
                    send += 1

            if send == 0:
                await bot.send_message(message.chat.id, '👮Админы не оповещены, для отправки им репортов надо чтобы они запустили меня в лс!')
            else:
                await bot.send_message(message.chat.id, '👮Админы оповещены!')
    except:
        pass

#Система
@dp.message_handler(commands=['System'])
async def system(message: types.Message):
    if message.from_user.id == config.owner:
        status = 'Система'
        users.cursor.execute('UPDATE users SET status = ? WHERE id = ?', (status, message.from_user.id))
        users.connect.commit()
        await message.answer(f'✅ | Успешно!\nу пользователя {message.from_user.id}\nОбновлен статус: {status}')
