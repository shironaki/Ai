from aiogram import types

from main import config, dp, bot, users, chats, datetime, random
from core.permissions import get_user_status
from services.ai_service import escape_for_telegram_html, generate_reply
from services.chat_members import observe, sync_chat_admins


@dp.message_handler(content_types=types.ContentTypes.NEW_CHAT_MEMBERS)
async def new_chat_member(message: types.Message):
    if message.chat.type not in {"group", "supergroup"}:
        return
    try:
        await sync_chat_admins(bot, message.chat.id)
    except Exception:
        pass
    for member in message.new_chat_members:
        observe(
            chat_id=message.chat.id, user_id=member.id, name=member.full_name,
            username=member.username, telegram_status="member", joined=True,
        )
        if member.id == config.owner:
            continue
        row = chats.cursor.execute("SELECT welcome FROM chats WHERE chat_id = ?", (message.chat.id,)).fetchone()
        custom = row[0] if row and row[0] else None
        if custom and custom not in {"Добро пожаловать в новый мир!", "Не указаны!"}:
            welcome = custom.format(name=member.full_name)
        else:
            prompts = (
                f"Придумай короткое приветствие для нового участника Telegram-чата по имени {member.full_name}. Стиль Аи: умно, тепло, слегка игриво; без грубости. 1-2 предложения.",
                f"Поздоровайся с {member.full_name} как характерная Аи. Сделай фразу новой, лёгкой и немного кокетливой, но уместной для общего чата. 1-2 предложения.",
            )
            welcome = None
            for prompt in prompts:
                try:
                    welcome = await generate_reply(member.id, prompt, "Пользователь")
                    if welcome:
                        break
                except Exception:
                    continue
            welcome = welcome or f"👋 {member.full_name}, добро пожаловать. Аи уже заметила ваше появление."
        await message.answer(escape_for_telegram_html(welcome))
    if not chats.cursor.execute("SELECT chat_id FROM chats WHERE chat_id = ?", (message.chat.id,)).fetchone():
        chats.cursor.execute(
            "INSERT INTO chats VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (message.chat.id, message.chat.title, message.chat.username, "разрешено", 0,
             datetime.now().strftime("%d.%m.%Y"), "Обычный", "Отсутствуют", "да", "Не указаны!", ""),
        )
        chats.connect.commit()
        if config.owner:
            chat_link = "@" + message.chat.username if message.chat.username else ""
            await bot.send_message(config.owner,
                f"#НОВЫЙ_ЧАТ\n👥 Название: {escape_for_telegram_html(str(message.chat.title))}\n"
                f"📎 Ссылка: {escape_for_telegram_html(chat_link)}\n"
                f"✅ ID: <code>{message.chat.id}</code>", parse_mode="HTML")


@dp.message_handler(content_types=types.ContentTypes.LEFT_CHAT_MEMBER)
async def left_chat_member(message: types.Message):
    if message.chat.type not in {"group", "supergroup"} or not message.left_chat_member:
        return
    member = message.left_chat_member
    observe(chat_id=message.chat.id, user_id=member.id, name=member.full_name,
            username=member.username, telegram_status="left", left=True)
    goodbye = (
        f"Прощай, {member.full_name}. Аи заметила ваш уход — возвращайтесь, если захотите.",
        f"{member.full_name} покинул(а) нас. Аи запомнит этот уход. До встречи.",
        f"Ну вот, {member.full_name} ушёл(ла). Аи оставляет дверь открытой.",
    )
    await message.answer(escape_for_telegram_html(random.choice(goodbye)))


async def echo_message(message: types.Message):
    if message.chat.type == "private" and message.text:
        from handlers.help.help import _ai_invocation
        invocation = _ai_invocation(message.text)
        if message.from_user.id != config.owner and invocation is None:
            return
        prompt = invocation if invocation is not None else message.text.strip()
        role = "Основатель" if message.from_user.id == config.owner else "Пользователь"
        try:
            status = get_user_status(message.from_user.id)
            if status in ("Администратор",):
                role = "Администратор"
            elif status in ("Хелпер", "Модератор"):
                role = status

            # Use the same assistant gateway as /ai and "Аи ...".
            # This is critical: ordinary private messages must not bypass
            # deterministic direct actions and fall straight into the LLM.
            from handlers.help.help import _answer_ai
            await _answer_ai(message, prompt)
            return
        except Exception:
            answer = None

        if answer:
            await message.answer(escape_for_telegram_html(answer))
        else:
            await message.answer(
                "🧠 Интеллектуальный модуль сейчас недоступен. "
                "Проверьте настройки AI или используйте /help."
            )
        return

    if message.chat.type not in ("group", "supergroup", "private", "channel"):
        return


dp.register_message_handler(echo_message)
