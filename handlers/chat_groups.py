from aiogram import types

from main import config, dp, bot, users, chats, datetime, random
from services.ai_service import escape_for_telegram_html, generate_reply
from services.chat_members import admin_status_changed, observe, sync_chat_admins
from services.ai_relationship import can_call, is_max_positive


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
                    welcome = await generate_reply(member.id, prompt, "Пользователь", chat_id=message.chat.id)
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


@dp.chat_member_handler()
async def chat_member_event(update: types.ChatMemberUpdated):
    if update.chat.type not in {"group", "supergroup", "channel"}:
        return
    member = update.new_chat_member.user
    old_status = getattr(update.old_chat_member, "status", None)
    new_status = getattr(update.new_chat_member, "status", None)
    joined = new_status in {"member", "administrator", "creator"} and old_status in {"left", "kicked", None}
    left = new_status in {"left", "kicked"} and old_status not in {"left", "kicked"}
    if admin_status_changed(old_status, new_status):
        try:
            await sync_chat_admins(bot, update.chat.id)
        except Exception:
            pass
    if not (joined or left):
        return
    if not chats.cursor.execute("SELECT chat_id FROM chats WHERE chat_id = ?", (update.chat.id,)).fetchone():
        try:
            chats.cursor.execute(
                "INSERT INTO chats VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (update.chat.id, getattr(update.chat, "title", None), getattr(update.chat, "username", None),
                 "разрешено", 0, datetime.now().strftime("%d.%m.%Y"), "Обычный",
                 "Отсутствуют", "да", "Не указаны!", ""),
            )
            chats.connect.commit()
        except Exception:
            pass
    observe(
        chat_id=update.chat.id,
        user_id=member.id,
        name=member.full_name,
        username=member.username,
        telegram_status=new_status,
        joined=joined,
        left=left,
    )
    if left and update.chat.type in {"group", "supergroup"}:
        await update.chat.bot.send_message(
            update.chat.id,
            escape_for_telegram_html(
                random.choice((
                    f"Прощай, {member.full_name}. Аи заметила ваш уход — возвращайтесь, если захотите.",
                    f"{member.full_name} покинул(а) нас. Аи оставляет дверь открытой.",
                ))
            ),
        )


async def echo_message(message: types.Message):
    if message.chat.type == "private" and message.text:
        from handlers.help.help import _ai_invocation
        user_id = message.from_user.id
        max_positive = is_max_positive(user_id, config.owner)
        if not can_call(user_id, config.owner):
            return
        invocation = _ai_invocation(message.text, include_alternates=max_positive)
        if user_id != config.owner and invocation is None and not max_positive:
            return
        prompt = invocation if invocation is not None else message.text.strip()
        try:
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
