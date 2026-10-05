from aiogram import types

from main import config, users, chats, random, bot, InlineKeyboardMarkup, datetime, timedelta, re, dp, sqlite3
from core.permissions import has_admin_role, has_moderator_role
from services.moderation_gateway import request as request_moderation

# Role assignment compatibility entry point.
# The admin panel is the primary UI; this alias delegates to the same hierarchy.

@dp.message_handler(commands=['setstatus'])
async def set_status(message: types.Message):
    from core.identity import is_owner
    from core.permissions import has_admin_role
    from services.chat_roles import set_role
    from services.global_roles import set_global_role
    from core.role_transitions import available_role_targets

    actor_id = message.from_user.id
    if not message.reply_to_message:
        await message.reply("❗ | Ответьте на сообщение пользователя.")
        return

    target_role = (message.get_args() or "").strip()
    target_id = message.reply_to_message.from_user.id
    if target_id == actor_id:
        await message.reply("⛔ | Нельзя назначить роль самому себе.")
        return

    if target_role != "Модератор":
        await message.reply("⛔ | В административном контуре назначается только роль Модератор.")
        return

    if is_owner(actor_id):
        if set_global_role(target_id, target_role, actor_id):
            await message.answer(
                "✅ | Глобальная роль пользователя обновлена: <b>Модератор</b>",
                parse_mode="html",
            )
        else:
            await message.reply("⛔ | Глобальная роль не может быть назначена этому пользователю.")
        return

    if not has_admin_role(actor_id, message.chat.id):
        await message.reply("⛔ | Только Основатель или Владелец чата может назначать локальную роль.")
        return

    if set_role(message.chat.id, target_id, target_role, actor_id):
        from services.role_audit import record_role_grant
        record_role_grant(
            chat_id=message.chat.id,
            actor_id=actor_id,
            target_id=target_id,
            role=target_role,
        )
        await message.answer(
            "✅ | Локальная роль в этом чате обновлена: <b>Модератор</b>",
            parse_mode="html",
        )
        return

    await message.reply("⛔ | Локальная роль не может быть назначена в этом чате.")

# расширение территории
#/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////#

#deluser intentionally disabled; destructive deletion will be redesigned later.\n\n#chatwelcome
@dp.message_handler(commands=["welcome", "приветствие"])
async def rules_cmd(message: types.Message):
    if not has_moderator_role(message.from_user.id, message.chat.id):
        await message.answer("👮‍♂️ | У вас нет роли для управления этим миром.")
        return
    if message.chat.type == "supergroup" or message.chat.type == "group":
        user_id = message.from_user.id
        chat_id = message.chat.id
        new_welcome = message.get_args()
        if new_welcome:
            chats.cursor.execute("UPDATE chats SET welcome=? WHERE chat_id=?", (new_welcome, chat_id,))
            chats.connect.commit()
            await message.answer("👋 Приветствие мира было успешно изменено!")
        else:
            await message.answer("💬 Вы не указали новое приветствие!")
    else:
        await message.answer("Эта заклинание работает только в мире!")
  
# Legacy barrier commands removed: the unified «тишина» action is panel-only.\n\n#кляп
@dp.message_handler(commands=['мут', 'mute','дебафф'], commands_prefix='!?./')
async def mute(message):
    """Compatibility wrapper; execution is centralized in moderation_gateway."""
    await request_moderation(message, message.text.strip())

#Анмут
@dp.message_handler(commands=['андебафф', 'размут', 'unmute'], commands_prefix='!?./')
async def unmute(message):
    """Compatibility wrapper; execution is centralized in moderation_gateway."""
    await request_moderation(message, message.text.strip())

# Аннигиляция | Пинок Системы
@dp.message_handler(commands=['аннигилировать', 'ban'], commands_prefix='!?./')
async def ban(message):
    """Compatibility wrapper; execution is centralized in moderation_gateway."""
    await request_moderation(message, message.text.strip())

#Воскрешение
@dp.message_handler(commands=['воскресить', 'unban'], commands_prefix='!?./')
async def unban(message):
    """Compatibility wrapper; execution is centralized in moderation_gateway."""
    await request_moderation(message, message.text.strip())

# Game economy is disabled until the dedicated game subsystem is reintroduced.\n\n# Unified reports live in handlers/help/help.py and services/report_service.py.\n