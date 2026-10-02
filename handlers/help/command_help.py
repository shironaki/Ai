"""Telegram adapter for the authoritative command help."""

from aiogram import types
from aiogram.dispatcher import FSMContext
from aiogram.dispatcher.filters.state import State, StatesGroup
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from base import config
from core.command_help import render_help
from core.permissions import get_user_status, has_moderator_role, has_admin_role
from core.identity import is_owner
from core.role_transitions import available_role_targets
from services.chat_members import sync_chat_admins
from services.chat_roles import get_role, list_roles
from services.silence_service import set_silent, is_silent
from services.ai_data import user_summary
from services.ai_service import escape_for_telegram_html
from main import dp, bot, chats, users, bot_is_paused, set_bot_paused, ContentType
from services.broadcast_service import broadcast_message
from services.action_cancel import cancel_current_action


def _role_for_message(message: types.Message) -> str:
    if message.from_user.id == config.owner:
        return "Основатель"
    status = get_role(message.chat.id, message.from_user.id)
    if status in {
        "Создатель бота",
        "Администратор",
        "Хелпер",
        "Модератор",
    }:
        return status
    return "Пользователь"


@dp.message_handler(commands=["help", "хелп", "команды"], commands_prefix="/!.")
async def authoritative_help(message: types.Message):
    role = _role_for_message(message)
    menu = InlineKeyboardMarkup(row_width=2)
    menu.add(
        InlineKeyboardButton("🧠 Аи", callback_data="help:ai"),
        InlineKeyboardButton("ℹ️ Информация", callback_data="panel:info"),
    )
    menu.add(InlineKeyboardButton("📬 Репорт", callback_data="help:report"))
    if is_owner(message.from_user.id) or has_moderator_role(message.from_user.id, message.chat.id):
        menu.add(InlineKeyboardButton("🛠 Панель", callback_data="panel:root"))
    await message.answer(
        "<b>📖 СИСТЕМА «АИ»</b>\n\n"
        f"Ваш уровень: <b>{role}</b>\n"
        "Основной интерфейс — кнопки и прямое обращение к «Аи» или «Система».\n"
        "Служебные slash-команды не являются основным пользовательским интерфейсом.",
        reply_markup=menu,
    )


@dp.callback_query_handler(lambda c: c.data == "help:ai")
async def help_ai(call: types.CallbackQuery):
    await call.message.answer("🧠 Обратитесь ко мне: «Аи, ...» или «Система, ...».")
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "help:report")
async def help_report(call: types.CallbackQuery):
    await call.message.answer(
        "📬 Репорт — для жалоб, обращений и вопросов к администрации. "
        "Технические поломки отмечаются отдельно как QA-метки."
    )
    await call.answer()

def _panel_role(user_id, chat_id=None):
    if is_owner(user_id):
        return "Создатель бота"
    return (get_role(chat_id, user_id) if chat_id is not None else get_user_status(user_id)) or "Пользователь"


def _panel_back():
    return InlineKeyboardMarkup().add(InlineKeyboardButton("◀️ Назад", callback_data="panel:root"))


@dp.callback_query_handler(lambda c: c.data == "panel:root")
async def panel_root(call):
    menu = InlineKeyboardMarkup(row_width=2)
    if is_owner(call.from_user.id) or has_moderator_role(call.from_user.id, call.message.chat.id):
        menu.add(InlineKeyboardButton("👥 Пользователи", callback_data="panel:users"))
        menu.add(InlineKeyboardButton("🔨 Модерация", callback_data="panel:moderation"))
    menu.add(InlineKeyboardButton("ℹ️ Информация", callback_data="panel:info"))
    menu.add(InlineKeyboardButton("📬 Репорты", callback_data="panel:reports"))
    menu.add(InlineKeyboardButton("↩️ Отменить текущее действие", callback_data="panel:cancel"))
    if is_owner(call.from_user.id):
        menu.add(InlineKeyboardButton("⚙️ Системное", callback_data="panel:system"))
    menu.add(InlineKeyboardButton("✖️ Закрыть", callback_data="panel:close"))
    await call.message.edit_text(
        "<b>🛠 АДМИНИСТРАТИВНАЯ ПАНЕЛЬ</b>\n\n"
        "Уровень: <b>" + _panel_role(call.from_user.id, call.message.chat.id) + "</b>\n"
        "Показываются только доступные вашему уровню функции.",
        reply_markup=menu,
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:cancel")
async def panel_cancel(call: types.CallbackQuery):
    cancelled = cancel_current_action(call.from_user.id, call.message.chat.id)
    await call.answer(
        "Текущее действие отменено." if cancelled else "Незавершённого действия нет.",
        show_alert=True,
    )


@dp.callback_query_handler(lambda c: c.data == "panel:users")
async def panel_users(call):
    if not (is_owner(call.from_user.id) or has_moderator_role(call.from_user.id, call.message.chat.id)):
        await call.answer("Нет доступа.", show_alert=True)
        return
    menu = InlineKeyboardMarkup(row_width=1)
    menu.add(InlineKeyboardButton("👤 Моя информация", callback_data="panel:myinfo"))
    menu.add(InlineKeyboardButton("👮 Состав администраторов", callback_data="panel:admins"))
    if is_owner(call.from_user.id) or _panel_role(call.from_user.id, call.message.chat.id) in {"Администратор", "Хелпер"}:
        menu.add(InlineKeyboardButton("🎭 Назначить роль", callback_data="panel:role"))
    if is_owner(call.from_user.id):
        menu.add(InlineKeyboardButton("🤝 Отношение Аи", callback_data="panel:relation"))
    menu.add(InlineKeyboardButton("◀️ Назад", callback_data="panel:root"))
    await call.message.edit_text("<b>👥 ПОЛЬЗОВАТЕЛИ</b>\n\nВыберите действие.", reply_markup=menu)
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:relation")
async def panel_relation_menu(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    menu = InlineKeyboardMarkup(row_width=2)
    for score, label in ((100, "💖 +100"), (50, "🙂 +50"), (0, "😐 0"), (-50, "🙁 -50"), (-100, "⛔ -100")):
        menu.insert(InlineKeyboardButton(label, callback_data=f"panel:relation:{score}"))
    menu.add(InlineKeyboardButton("🔕 -100 + блок вызова", callback_data="panel:relation:block"))
    menu.add(InlineKeyboardButton("◀️ Назад", callback_data="panel:users"))
    await call.message.edit_text(
        "<b>🤝 ОТНОШЕНИЕ АИ</b>\n\n"
        "Выберите уровень, затем ответьте на сообщение пользователя.",
        reply_markup=menu,
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data.startswith("panel:relation:"))
async def panel_relation_select(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    raw = call.data.rsplit(":", 1)[-1]
    if raw == "block":
        score, block = -100, True
    else:
        try:
            score = int(raw)
        except ValueError:
            await call.answer("Некорректный уровень.", show_alert=True)
            return
        block = None
    from handlers.help.help import _PANEL_PENDING
    _PANEL_PENDING[(call.from_user.id, call.message.chat.id)] = {
        "kind": "relation",
        "score": score,
        "block": block,
    }
    await call.message.edit_text(
        "<b>🤝 ОТНОШЕНИЕ АИ</b>\n\n"
        "Теперь ответьте на сообщение пользователя, которому назначается этот уровень.",
        reply_markup=_panel_back(),
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:role")
async def panel_role_menu(call):
    if not (is_owner(call.from_user.id) or has_moderator_role(call.from_user.id, call.message.chat.id)):
        await call.answer("Нет доступа.", show_alert=True)
        return
    targets = available_role_targets(_panel_role(call.from_user.id, call.message.chat.id), actor_is_owner=is_owner(call.from_user.id))
    menu = InlineKeyboardMarkup(row_width=1)
    for role in targets:
        menu.add(InlineKeyboardButton(role, callback_data="panel:role:" + role))
    menu.add(InlineKeyboardButton("◀️ Назад", callback_data="panel:users"))
    await call.message.edit_text(
        "<b>🎭 НАЗНАЧЕНИЕ РОЛИ</b>\n\nВыберите роль, затем ответьте на сообщение пользователя.",
        reply_markup=menu,
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data.startswith("panel:role:"))
async def panel_role_select(call):
    role = call.data.split(":", 2)[2]
    if not (is_owner(call.from_user.id) or has_moderator_role(call.from_user.id, call.message.chat.id)):
        await call.answer("Нет доступа.", show_alert=True)
        return
    from handlers.help.help import _PANEL_PENDING
    _PANEL_PENDING[(call.from_user.id, call.message.chat.id)] = {"kind": "role", "target_role": role}
    await call.message.edit_text(
        "<b>🎭 " + role + "</b>\nОтветьте на сообщение пользователя, которому назначается роль.",
        reply_markup=_panel_back(),
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:admins")
async def panel_admins(call):
    if not (is_owner(call.from_user.id) or has_moderator_role(call.from_user.id, call.message.chat.id)):
        await call.answer("Нет доступа.", show_alert=True)
        return
    if is_owner(call.from_user.id):
        rows = chats.cursor.execute("SELECT chat_id,name FROM chats ORDER BY chat_id").fetchall()
        targets = [(int(r[0]), str(r[1] or r[0])) for r in rows]
    else:
        targets = [(call.message.chat.id, str(getattr(call.message.chat, "title", None) or call.message.chat.id))]

    sections = []
    for chat_id, name in targets:
        try:
            admins = await sync_chat_admins(bot, chat_id)
        except Exception:
            admins = []
        admin_by_id = {admin.user.id: admin for admin in admins}
        role_rows = list_roles(chat_id)
        role_by_id = {int(row["user_id"]): row for row in role_rows}
        user_ids = list(dict.fromkeys([*admin_by_id.keys(), *role_by_id.keys()]))
        lines = [
            "<b>💬 " + escape_for_telegram_html(name) + "</b> <code>" + str(chat_id) + "</code>"
        ]
        if not user_ids:
            lines.append("Нет данных о составе.")
        for user_id in user_ids:
            admin = admin_by_id.get(user_id)
            role_row = role_by_id.get(user_id)
            if admin:
                mark = "👑" if getattr(admin, "status", "") == "creator" else "🛡"
                display_name = admin.user.full_name
                telegram_part = (
                    "создатель Telegram-чата"
                    if getattr(admin, "status", "") == "creator"
                    else "администратор Telegram"
                )
            else:
                mark = "🤖"
                user = users.cursor.execute(
                    "SELECT name,username FROM users WHERE id=?", (user_id,)
                ).fetchone()
                display_name = user["name"] if user else str(user_id)
                telegram_part = "роль Аи без статуса Telegram-администратора"

            line = (
                mark + " " + escape_for_telegram_html(str(display_name))
                + " · " + escape_for_telegram_html(telegram_part)
            )
            if role_row:
                actor = users.cursor.execute(
                    "SELECT name FROM users WHERE id=?", (role_row["granted_by"],)
                ).fetchone()
                actor_name = actor["name"] if actor else str(role_row["granted_by"])
                line += (
                    " · роль Аи: <b>" + escape_for_telegram_html(str(role_row["role"])) + "</b>"
                    " · выдал: " + escape_for_telegram_html(str(actor_name))
                )
            lines.append(line)
        sections.append("\n".join(lines))

    body = "\n\n".join(sections) or "Нет доступных данных."
    await call.message.edit_text(
        "<b>👮 СОСТАВ АДМИНИСТРАТОРОВ</b>\n\n" + body,
        reply_markup=_panel_back(),
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:myinfo")
async def panel_myinfo(call):
    data = user_summary(call.from_user.id)
    if not data:
        await call.answer("Нет данных.", show_alert=True)
        return
    await call.message.edit_text(
        "<b>👤 ИНФОРМАЦИЯ</b>\n\n"
        "Имя: <b>" + escape_for_telegram_html(str(data.get("name") or "—")) + "</b>\n"
        "Username: <code>" + escape_for_telegram_html(str(data.get("username") or "—")) + "</code>\n"
        "ID: <code>" + str(data.get("id")) + "</code>\n"
        "Роль: <b>" + escape_for_telegram_html(str(data.get("status") or "—")) + "</b>\n"
        "Регистрация в Системе: <code>" + escape_for_telegram_html(str(data.get("system_registered_at") or "—")) + "</code>\n"
        "Регистрация в Telegram: <b>не предоставляется Telegram Bot API</b>",
        reply_markup=_panel_back(),
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:info")
async def panel_info(call):
    menu = InlineKeyboardMarkup(row_width=1)
    menu.add(InlineKeyboardButton("👤 Моя информация", callback_data="panel:myinfo"))
    menu.add(InlineKeyboardButton("💬 Информация о чате", callback_data="panel:chatinfo"))
    if is_owner(call.from_user.id) or has_moderator_role(call.from_user.id, call.message.chat.id):
        menu.add(InlineKeyboardButton("👮 Состав администраторов", callback_data="panel:admins"))
    menu.add(InlineKeyboardButton("◀️ Назад", callback_data="panel:root"))
    await call.message.edit_text("<b>ℹ️ ИНФОРМАЦИЯ</b>\n\nФактические данные. Профиль — будущий игровой слой.", reply_markup=menu)
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:chatinfo")
async def panel_chatinfo(call):
    try:
        chat = await bot.get_chat(call.message.chat.id)
        count = await bot.get_chat_members_count(call.message.chat.id)
        admins = await bot.get_chat_administrators(call.message.chat.id)
        await sync_chat_admins(bot, call.message.chat.id)
        text = (
            "<b>💬 ИНФОРМАЦИЯ О ЧАТЕ</b>\n\n"
            "Название: <b>" + escape_for_telegram_html(str(getattr(chat, "title", None) or "—")) + "</b>\n"
            "Username: <code>" + escape_for_telegram_html(str(getattr(chat, "username", None) or "—")) + "</code>\n"
            "Тип: <b>" + str(getattr(chat, "type", "—")) + "</b>\n"
            "ID: <code>" + str(chat.id) + "</code>\n"
            "Участников по Telegram: <b>" + str(count) + "</b>\n"
            "Администраторов: <b>" + str(len(admins)) + "</b>"
        )
        await call.message.edit_text(text, reply_markup=_panel_back())
    except Exception:
        await call.message.edit_text("⚠️ Telegram не предоставил данные этого чата.", reply_markup=_panel_back())
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:moderation")
async def panel_moderation(call):
    if not (is_owner(call.from_user.id) or has_moderator_role(call.from_user.id, call.message.chat.id)):
        await call.answer("Нет доступа.", show_alert=True)
        return
    menu = InlineKeyboardMarkup(row_width=2)
    for action, label in (("mute", "🔇 Мут"), ("unmute", "🔊 Размут"), ("ban", "🔴 Бан"), ("unban", "🟢 Разбан")):
        menu.insert(InlineKeyboardButton(label, callback_data="panel:mod:" + action))
    menu.add(InlineKeyboardButton("🔇 Тишина: " + ("вкл" if is_silent(call.message.chat.id) else "выкл"), callback_data="panel:silence"))
    menu.add(InlineKeyboardButton("👋 Приветствие", callback_data="panel:welcome"))
    menu.add(InlineKeyboardButton("◀️ Назад", callback_data="panel:root"))
    await call.message.edit_text("<b>🔨 МОДЕРАЦИЯ</b>\n\nВыберите действие.", reply_markup=menu)
    await call.answer()


@dp.callback_query_handler(lambda c: c.data.startswith("panel:mod:"))
async def panel_mod_select(call):
    action = call.data.rsplit(":", 1)[-1]
    if not (is_owner(call.from_user.id) or has_moderator_role(call.from_user.id, call.message.chat.id)):
        await call.answer("Нет доступа.", show_alert=True)
        return
    from handlers.help.help import _PANEL_PENDING
    _PANEL_PENDING[(call.from_user.id, call.message.chat.id)] = {"kind": "moderation", "action": action}
    extra = " и укажите длительность (например: 10м)" if action in {"mute", "ban"} else ""
    await call.message.edit_text("Ответьте на сообщение цели" + extra + ".", reply_markup=_panel_back())
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:silence")
async def panel_silence(call):
    if not (is_owner(call.from_user.id) or has_moderator_role(call.from_user.id, call.message.chat.id)):
        await call.answer("Нет доступа.", show_alert=True)
        return
    enabled = is_silent(call.message.chat.id)
    action = "снять тишину" if enabled else "включить тишину"
    menu = InlineKeyboardMarkup(row_width=2)
    menu.add(
        InlineKeyboardButton("✅ Подтвердить", callback_data="panel:silence:apply"),
        InlineKeyboardButton("↩️ Отмена", callback_data="panel:moderation"),
    )
    await call.message.edit_text(
        "<b>🔇 ТИШИНА</b>\\n\\nПодтвердите: <b>" + action + "</b> для всего чата?",
        reply_markup=menu,
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:silence:apply")
async def panel_silence_apply(call):
    if not (is_owner(call.from_user.id) or has_moderator_role(call.from_user.id, call.message.chat.id)):
        await call.answer("Нет доступа.", show_alert=True)
        return
    try:
        from aiogram.types import ChatPermissions
        enabled = is_silent(call.message.chat.id)
        new_state = not enabled
        if new_state:
            chat = await bot.get_chat(call.message.chat.id)
            previous = permissions_dict(getattr(chat, "permissions", None))
            await bot.set_chat_permissions(
                call.message.chat.id,
                ChatPermissions(
                    can_send_messages=False,
                    can_send_media_messages=False,
                    can_send_polls=False,
                    can_send_other_messages=False,
                    can_add_web_page_previews=False,
                    can_invite_users=previous.get("can_invite_users", True),
                ),
            )
            set_silent(call.message.chat.id, True, previous)
        else:
            previous = get_previous_permissions(call.message.chat.id)
            restore = previous or {"can_send_messages": True}
            await bot.set_chat_permissions(
                call.message.chat.id,
                ChatPermissions(**restore),
            )
            set_silent(call.message.chat.id, False)
        await call.answer("Тишина снята." if enabled else "Тишина включена.", show_alert=True)
        await panel_moderation(call)
    except Exception:
        await call.answer("Telegram не разрешил изменить права чата.", show_alert=True)


@dp.callback_query_handler(lambda c: c.data == "panel:welcome")
async def panel_welcome(call):
    if not (is_owner(call.from_user.id) or has_moderator_role(call.from_user.id, call.message.chat.id)):
        await call.answer("Нет доступа.", show_alert=True)
        return
    if call.message.chat.type not in {"group", "supergroup"}:
        await call.answer("Приветствие доступно только группам.", show_alert=True)
        return
    menu = InlineKeyboardMarkup(row_width=1)
    menu.add(InlineKeyboardButton("🤖 Авто-Аи", callback_data="panel:welcome:auto"))
    menu.add(InlineKeyboardButton("✏️ Фиксированное", callback_data="panel:welcome:fixed"))
    menu.add(InlineKeyboardButton("◀️ Назад", callback_data="panel:moderation"))
    await call.message.edit_text("<b>👋 ПРИВЕТСТВИЕ</b>", reply_markup=menu)
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:welcome:auto")
async def panel_welcome_auto(call):
    if not (is_owner(call.from_user.id) or has_moderator_role(call.from_user.id, call.message.chat.id)):
        await call.answer("Нет доступа.", show_alert=True)
        return
    chats.cursor.execute("UPDATE chats SET welcome='' WHERE chat_id=?", (call.message.chat.id,))
    chats.connect.commit()
    await call.message.edit_text("🤖 Авто-Аи включено.", reply_markup=_panel_back())
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:welcome:fixed")
async def panel_welcome_fixed(call):
    if not (is_owner(call.from_user.id) or has_moderator_role(call.from_user.id, call.message.chat.id)):
        await call.answer("Нет доступа.", show_alert=True)
        return
    from handlers.help.help import _PANEL_PENDING
    _PANEL_PENDING[(call.from_user.id, call.message.chat.id)] = {"kind": "welcome"}
    await call.message.edit_text("✏️ Ответьте на это сообщение текстом фиксированного приветствия.", reply_markup=_panel_back())
    await call.answer()


class BroadcastState(StatesGroup):
    target = State()


@dp.callback_query_handler(lambda c: c.data == "panel:system:broadcast")
async def panel_system_broadcast(call: types.CallbackQuery):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    menu = InlineKeyboardMarkup(row_width=1)
    menu.add(
        InlineKeyboardButton("👤 Пользователям", callback_data="panel:broadcast:users"),
        InlineKeyboardButton("💬 Чатам", callback_data="panel:broadcast:chats"),
        InlineKeyboardButton("🌐 Всем", callback_data="panel:broadcast:all"),
        InlineKeyboardButton("↩️ Отмена", callback_data="panel:system"),
    )
    await call.message.edit_text(
        "<b>📣 ЕДИНАЯ РАССЫЛКА</b>\n\nВыберите аудиторию.",
        reply_markup=menu,
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data.startswith("panel:broadcast:"))
async def panel_broadcast_target(call: types.CallbackQuery):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    target = call.data.rsplit(":", 1)[-1]
    await BroadcastState.target.set()
    state = FSMContext.current()
    await state.update_data(broadcast_target=target)
    labels = {"users": "пользователям", "chats": "чатам", "all": "пользователям и чатам"}
    await call.message.edit_text(
        "<b>📣 ЕДИНАЯ РАССЫЛКА</b>\n\n"
        f"Отправьте следующим сообщением текст, фото или другое сообщение для рассылки {labels[target]}.",
        reply_markup=_panel_back(),
    )
    await call.answer()


@dp.message_handler(content_types=ContentType.ANY, state=BroadcastState.target)
async def panel_broadcast_message(message: types.Message, state: FSMContext):
    if not is_owner(message.from_user.id):
        await state.finish()
        return
    data = await state.get_data()
    target = data.get("broadcast_target")
    await state.finish()

    user_ids = []
    chat_ids = []
    if target in {"users", "all"}:
        user_ids = [int(row[0]) for row in users.cursor.execute("SELECT id FROM users").fetchall()]
    if target in {"chats", "all"}:
        chat_ids = [int(row[0]) for row in chats.cursor.execute("SELECT chat_id FROM chats").fetchall()]
    recipients = user_ids + chat_ids
    status = await message.answer("📣 Рассылка началась…")
    sent, failed = await broadcast_message(message, recipients)
    await status.edit_text(
        "📣 <b>Рассылка завершена.</b>\n\n"
        f"✅ Успешно: <b>{sent}</b>\n"
        f"❌ Неуспешно: <b>{failed}</b>"
    )


@dp.callback_query_handler(lambda c: c.data == "panel:system")
async def panel_system(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    menu = InlineKeyboardMarkup(row_width=1)
    menu.add(InlineKeyboardButton("🧠 AI diagnostic", callback_data="panel:system:ai"))
    menu.add(InlineKeyboardButton("📣 Рассылка", callback_data="panel:system:broadcast"))
    menu.add(InlineKeyboardButton("🗣 Имена вызова Аи", callback_data="panel:system:names"))
    menu.add(InlineKeyboardButton("🛰 Стазис", callback_data="panel:system:stasis"))
    menu.add(InlineKeyboardButton("🧪 QA-метки", callback_data="panel:system:issues"))
    menu.add(InlineKeyboardButton("◀️ Назад", callback_data="panel:root"))
    await call.message.edit_text("<b>⚙️ СИСТЕМНОЕ</b>", reply_markup=menu)
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:system:names")
async def panel_system_names(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    menu = InlineKeyboardMarkup(row_width=1)
    menu.add(
        InlineKeyboardButton("🗣 Основные имена", callback_data="panel:names:primary"),
        InlineKeyboardButton("✨ Альтернативные", callback_data="panel:names:alternate"),
        InlineKeyboardButton("◀️ Назад", callback_data="panel:system"),
    )
    await call.message.edit_text(
        "<b>🗣 ИМЕНА ВЫЗОВА АИ</b>\n\n"
        "Основные имена работают всегда. Альтернативные разрешены при максимальном положительном отношении.",
        reply_markup=menu,
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data.startswith("panel:names:"))
async def panel_system_names_select(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    target = call.data.rsplit(":", 1)[-1]
    from handlers.help.help import _PANEL_PENDING
    _PANEL_PENDING[(call.from_user.id, call.message.chat.id)] = {
        "kind": "invocation_names",
        "target": target,
    }
    await call.message.edit_text(
        "🗣 Отправьте через запятую имена вызова Аи. Например: <code>Аи, Система</code>.",
        reply_markup=_panel_back(),
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:system:ai")
async def panel_system_ai(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    await call.answer("Диагностика: /aidiag (секреты не выводятся).", show_alert=True)


@dp.callback_query_handler(lambda c: c.data == "panel:system:stasis")
async def panel_system_stasis(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    enabled = bot_is_paused()
    action = "снять глобальный стазис" if enabled else "активировать глобальный стазис"
    menu = InlineKeyboardMarkup(row_width=2)
    menu.add(
        InlineKeyboardButton("✅ Подтвердить", callback_data="panel:system:stasis:apply"),
        InlineKeyboardButton("↩️ Отмена", callback_data="panel:system"),
    )
    await call.message.edit_text(
        "<b>🛰 СТАЗИС</b>\\n\\nПодтвердите: <b>" + action + "</b>?",
        reply_markup=menu,
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:system:stasis:apply")
async def panel_system_stasis_apply(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    enabled = bot_is_paused()
    set_bot_paused(not enabled)
    await call.message.edit_text(
        "<b>🛰 СТАЗИС</b>\\n\\nСостояние: <b>" + ("активен" if not enabled else "снят") + "</b>",
        reply_markup=_panel_back(),
    )
    await call.answer("Стазис активирован." if not enabled else "Стазис снят.", show_alert=True)


@dp.callback_query_handler(lambda c: c.data == "panel:system:issues")
async def panel_system_issues(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    from services.issue_tracker import list_markers, render_marker
    rows = list_markers()
    body = "\n\n".join(escape_for_telegram_html(render_marker(row)) for row in rows) or "Список пуст."
    await call.message.edit_text("<b>🧪 QA-МЕТКИ</b>\n\n" + body, reply_markup=_panel_back())
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:close")
async def panel_close(call):
    await call.message.delete()
    await call.answer()

@dp.callback_query_handler()
async def unhandled_callback(call: types.CallbackQuery):
    """Never leave an unknown/obsolete inline button without feedback."""
    from main import log
    log.warning(
        "CALLBACK UNHANDLED | user=%s chat=%s data=%s",
        call.from_user.id,
        getattr(getattr(call.message, "chat", None), "id", None),
        call.data,
    )
    await call.answer(
        "Эта кнопка устарела. Откройте /help и вызовите панель заново.",
        show_alert=True,
    )

