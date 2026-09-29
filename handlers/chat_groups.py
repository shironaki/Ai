import html
from aiogram import types

from main import config, dp, bot, users, chats, datetime
from core.permissions import get_user_status
from services.ai_service import generate_reply


@dp.message_handler(content_types=types.ContentTypes.NEW_CHAT_MEMBERS)
async def new_chat_member(message: types.Message):
    for member in message.new_chat_members:
        if member.id != config.owner:
            row = chats.cursor.execute(
                "SELECT welcome FROM chats WHERE chat_id = ?",
                (message.chat.id,),
            ).fetchone()
            welcome = row[0] if row else "Добро пожаловать в новый мир!"
            await message.answer(welcome)
            return

    await message.answer("<b>Система</b>\nАи приветствует вас.")

    if chats.cursor.execute(
        "SELECT chat_id FROM chats WHERE chat_id = ?",
        (message.chat.id,),
    ).fetchone():
        return

    chats.cursor.execute(
        "INSERT INTO chats VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            message.chat.id,
            message.chat.title,
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

    if config.owner:
        chat_link = "@" + message.chat.username if message.chat.username else ""
        await bot.send_message(
            config.owner,
            f"#НОВЫЙ_ЧАТ\n👥 Название: {message.chat.title}\n"
            f"📎 Ссылка: {chat_link}\n"
            f"✅ ID: <code>{message.chat.id}</code>",
            parse_mode="HTML",
        )


async def echo_message(message: types.Message):
    if message.chat.type == "private" and message.text:
        role = "Основатель" if message.from_user.id == config.owner else "Игрок"
        try:
            status = get_user_status(message.from_user.id)
            if status in ("Администратор", "Система"):
                role = "Администратор"
            elif status in ("Хелпер", "Модератор"):
                role = status

            answer = await generate_reply(message.from_user.id, message.text.strip(), role)
        except Exception:
            answer = None

        if answer:
            # Bot uses global HTML parse mode; AI output is untrusted and may contain <...>.
            await message.answer(html.escape(answer))
        else:
            await message.answer(
                "🧠 Интеллектуальный модуль сейчас недоступен. "
                "Проверьте настройки AI или используйте /help."
            )
        return

    if message.chat.type not in ("group", "supergroup", "private", "channel"):
        return


dp.register_message_handler(echo_message)
