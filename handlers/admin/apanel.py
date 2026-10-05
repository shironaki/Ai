from aiogram import types

from main import config, users, chats, random, bot, InlineKeyboardMarkup, datetime, timedelta, re, dp, sqlite3
from core.permissions import has_admin_role, has_moderator_role
from services.moderation_gateway import request as request_moderation

# Role assignment compatibility entry point.
# The admin panel is the primary UI; this alias delegates to the same hierarchy.

@dp.message_handler(commands=['setstatus'])
async def set_status(message: types.Message):
    if not has_admin_role(message.from_user.id, message.chat.id):
        await message.reply("⛔ Команда доступна только Администратору или Основателю.")
        return
    if not message.reply_to_message:
        await message.reply("❗ | Ответьте на сообщение пользователя.")
        return
    from core.identity import is_owner, resolve_role
    from core.role_transitions import available_role_targets
    from core.permissions import get_user_status

    actor_id = message.from_user.id
    actor_role = get_user_status(actor_id, message.chat.id) or resolve_role(actor_id)
    target_role = (message.get_args() or "").strip()
    allowed = available_role_targets(actor_role, actor_is_owner=is_owner(actor_id))
    if target_role not in allowed:
        await message.reply(
            "⛔ | Эту роль нельзя назначить из вашего уровня. "
            "AI/SYSTEM, Основатель и игровые роли через этот контур не назначаются."
        )
        return
    target_id = message.reply_to_message.from_user.id
    if target_id == actor_id:
        await message.reply("⛔ | Нельзя назначить роль самому себе.")
        return
    if get_user_status(target_id) is None:
        await message.reply("❗ | Пользователь не зарегистрирован в Системе.")
        return
    from services.chat_roles import set_role
    if not set_role(message.chat.id, target_id, target_role, actor_id):
        await message.reply("⛔ | Роль не может быть назначена в этом контуре.")
        return
    from services.role_audit import record_role_grant
    record_role_grant(chat_id=message.chat.id, actor_id=actor_id, target_id=target_id, role=target_role)
    await message.answer(
        f"✅ | Роль пользователя обновлена: <b>{target_role}</b>",
        parse_mode="html",
    )

# расширение территории
#/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////#

#deluser intentionally disabled; destructive deletion will be redesigned later.\n\n#chatwelcome
@dp.message_handler(commands=["welcome"])
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