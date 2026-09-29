from aiogram import types

from main import config, users, chats, random, bot, InlineKeyboardMarkup, datetime, timedelta, re, dp, sqlite3

#user_status
@dp.message_handler(commands=['setbal'])
async def setbal(message: types.Message):
    args = (message.get_args() or "").strip()
    if not args.isdigit():
        await message.reply("❗ | Формат: /setbal 100")
        return
    if not _is_bot_admin(message.from_user.id):
        await message.reply("❗ | Недостаточно прав.")
        return
    if not message.reply_to_message:
        await message.reply("❗ | Необходим реплай на пользователя.")
        return

    amount = int(args)
    target_id = message.reply_to_message.from_user.id
    users.cursor.execute("UPDATE users SET balance = ? WHERE id = ?", (amount, target_id))
    users.connect.commit()
    await message.answer(
        f"💰 | Баланс {message.reply_to_message.from_user.get_mention(as_html=True)} установлен: <b>{amount}</b>",
        parse_mode="HTML",
    )

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
