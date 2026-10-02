"""Telegram adapter for the authoritative command help."""

from aiogram import types
from aiogram.dispatcher import FSMContext
from aiogram.dispatcher.filters.state import State, StatesGroup
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from aiogram.utils.exceptions import BadRequest, MessageToEditNotFound

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
from services.action_cancel import cancel_current_action, register_runtime_action

_PANEL_HISTORY = {}
_PANEL_CURRENT = {}


def _panel_key(call):
    return (call.from_user.id, call.message.chat.id)


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


def _panel_menu(user_id: int, chat_id: int) -> InlineKeyboardMarkup:
    menu = InlineKeyboardMarkup(row_width=2)
    if is_owner(user_id) or has_moderator_role(user_id, chat_id):
        menu.add(InlineKeyboardButton("👥 Пользователи", callback_data="panel:users"))
        menu.add(InlineKeyboardButton("🔨 Модерация", callback_data="panel:moderation"))
    menu.add(InlineKeyboardButton("ℹ️ Информация", callback_data="panel:info"))
    menu.add(InlineKeyboardButton("📬 Репорты", callback_data="panel:reports"))
    menu.add(InlineKeyboardButton("↩️ Отменить текущее действие", callback_data="panel:cancel"))
    if is_owner(user_id):
        menu.add(InlineKeyboardButton("⚙️ Системное", callback_data="panel:system"))
    menu.add(InlineKeyboardButton("✖️ Закрыть", callback_data="panel:close"))
    return menu


def _panel_back(parent: str = "panel:root", label: str = "◀️ Назад"):
    # Navigation is stateful: the explicit parent is retained only for compatibility.
    # The actual destination is the last panel state visited by this user/chat.
    return InlineKeyboardMarkup().add(InlineKeyboardButton(label, callback_data="panel:back"))


def _panel_has_back(reply_markup) -> bool:
    for row in getattr(reply_markup, "inline_keyboard", []) or []:
        for button in row:
            if getattr(button, "callback_data", None) == "panel:back":
                return True
    return False


async def _panel_edit(call, text: str, reply_markup=None, *, push_history: bool = True):
    """Edit the current panel message, preserving real navigation history."""
    key = _panel_key(call)
    if push_history and _panel_has_back(reply_markup) and call.data != "panel:back":
        current = _PANEL_CURRENT.get(key)
        if current and current != call.data:
            _PANEL_HISTORY.setdefault(key, []).append(current)
    if call.data != "panel:back":
        _PANEL_CURRENT[key] = call.data
    try:
        await call.message.edit_text(text, reply_markup=reply_markup)
    except MessageToEditNotFound:
        await call.message.answer(text, reply_markup=reply_markup)
    except BadRequest as exc:
        error_text = str(exc).lower()
        if "message to edit not found" in error_text or "message can't be edited" in error_text:
            await call.message.answer(text, reply_markup=reply_markup)
        elif "message is not modified" in error_text:
            # The requested panel state is already displayed; do not create a duplicate.
            return
        else:
            raise


async def _render_panel_root_message(message: types.Message):
    key = (message.from_user.id, message.chat.id)
    _PANEL_HISTORY.pop(key, None)
    _PANEL_CURRENT[key] = "panel:root"
    menu = _panel_menu(message.from_user.id, message.chat.id)
    await message.answer(
        "<b>🛠 АДМИНИСТРАТИВНАЯ ПАНЕЛЬ</b>\n\n"
        "Уровень: <b>" + _panel_role(message.from_user.id, message.chat.id) + "</b>\n"
        "Показываются только доступные вашему уровню функции.",
        reply_markup=menu,
    )


@dp.message_handler(commands=["panel"])
async def panel_command(message: types.Message):
    if not (is_owner(message.from_user.id) or has_moderator_role(message.from_user.id, message.chat.id)):
        await message.answer("⛔ Панель доступна только персоналу.")
        return
    await _render_panel_root_message(message)


@dp.message_handler(
    lambda m: bool(
        m.text
        and m.text.casefold().strip() in {
            "покажи панель",
            "покажи мне панель",
            "выведи панель",
            "выведи мне панель",
            "открой панель",
            "открой мне панель",
            "административную панель",
        }
        and (is_owner(m.from_user.id) or has_moderator_role(m.from_user.id, m.chat.id))
    )
)
async def natural_panel_request(message: types.Message):
    await _render_panel_root_message(message)


@dp.callback_query_handler(lambda c: c.data == "panel:back")
async def panel_back(call: types.CallbackQuery):
    key = _panel_key(call)
    history = _PANEL_HISTORY.get(key) or []
    if history:
        target = history.pop()
        _PANEL_CURRENT[key] = target
    else:
        target = "panel:root"
        _PANEL_CURRENT[key] = target

    from handlers.help.help import panel_reports
    renderers = {
        "panel:root": panel_root,
        "panel:reports": panel_reports,
        "panel:users": panel_users,
        "panel:relation": panel_relation_menu,
        "panel:role": panel_role_menu,
        "panel:admins": panel_admins,
        "panel:myinfo": panel_myinfo,
        "panel:info": panel_info,
        "panel:chatinfo": panel_chatinfo,
        "panel:moderation": panel_moderation,
        "panel:silence": panel_silence,
        "panel:welcome": panel_welcome,
        "panel:system": panel_system,
        "panel:system:broadcast": panel_system_broadcast,
        "panel:system:names": panel_system_names,
        "panel:system:ai": panel_system_ai,
        "panel:system:stasis": panel_system_stasis,
        "panel:system:termux": panel_system_termux,
        "panel:system:issues": panel_system_issues,
    }
    renderer = renderers.get(target, panel_root)
    await renderer(call)
    # The renderer receives panel:back, so it must not create a new history entry.
    _PANEL_CURRENT[key] = target
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:root")
async def panel_root(call):
    from main import log
    key = _panel_key(call)
    _PANEL_HISTORY.pop(key, None)
    _PANEL_CURRENT[key] = "panel:root"
    menu = _panel_menu(call.from_user.id, call.message.chat.id)
    log.info(
        "PANEL ROOT ENTER | user=%s chat=%s buttons=%s",
        call.from_user.id,
        call.message.chat.id,
        len(menu.inline_keyboard),
    )
    await call.answer()
    log.info("PANEL ROOT ANSWERED | user=%s chat=%s", call.from_user.id, call.message.chat.id)
    await _panel_edit(
        call,
        "<b>🛠 АДМИНИСТРАТИВНАЯ ПАНЕЛЬ</b>\n\n"
        "Уровень: <b>" + _panel_role(call.from_user.id, call.message.chat.id) + "</b>\n"
        "Показываются только доступные вашему уровню функции.",
        reply_markup=menu,
    )
    log.info("PANEL ROOT EDITED | user=%s chat=%s", call.from_user.id, call.message.chat.id)

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
    menu.add(InlineKeyboardButton("◀️ Назад", callback_data="panel:back"))
    await _panel_edit(call, "<b>👥 ПОЛЬЗОВАТЕЛИ</b>\n\nВыберите действие.", reply_markup=menu)
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
    menu.add(InlineKeyboardButton("◀️ Назад", callback_data="panel:back"))
    await _panel_edit(call, 
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
    await _panel_edit(call, 
        "<b>🤝 ОТНОШЕНИЕ АИ</b>\n\n"
        "Теперь ответьте на сообщение пользователя, которому назначается этот уровень.",
        reply_markup=_panel_back("panel:users"),
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
    menu.add(InlineKeyboardButton("◀️ Назад", callback_data="panel:back"))
    await _panel_edit(call, 
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
    await _panel_edit(call, 
        "<b>🎭 " + role + "</b>\nОтветьте на сообщение пользователя, которому назначается роль.",
        reply_markup=_panel_back("panel:users"),
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
    await _panel_edit(call, 
        "<b>👮 СОСТАВ АДМИНИСТРАТОРОВ</b>\n\n" + body,
        reply_markup=_panel_back("panel:users"),
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:myinfo")
async def panel_myinfo(call):
    data = user_summary(call.from_user.id)
    if not data:
        await call.answer("Нет данных.", show_alert=True)
        return
    await _panel_edit(call, 
        "<b>👤 ИНФОРМАЦИЯ</b>\n\n"
        "Имя: <b>" + escape_for_telegram_html(str(data.get("name") or "—")) + "</b>\n"
        "Username: <code>" + escape_for_telegram_html(str(data.get("username") or "—")) + "</code>\n"
        "ID: <code>" + str(data.get("id")) + "</code>\n"
        "Роль: <b>" + escape_for_telegram_html(str(data.get("status") or "—")) + "</b>\n"
        "Регистрация в Системе: <code>" + escape_for_telegram_html(str(data.get("system_registered_at") or "—")) + "</code>\n"
        "Регистрация в Telegram: <b>не предоставляется Telegram Bot API</b>",
        reply_markup=_panel_back("panel:users"),
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:info")
async def panel_info(call):
    menu = InlineKeyboardMarkup(row_width=1)
    menu.add(InlineKeyboardButton("👤 Моя информация", callback_data="panel:myinfo"))
    menu.add(InlineKeyboardButton("💬 Информация о чате", callback_data="panel:chatinfo"))
    if is_owner(call.from_user.id) or has_moderator_role(call.from_user.id, call.message.chat.id):
        menu.add(InlineKeyboardButton("👮 Состав администраторов", callback_data="panel:admins"))
    menu.add(InlineKeyboardButton("◀️ Назад", callback_data="panel:back"))
    await _panel_edit(call, "<b>ℹ️ ИНФОРМАЦИЯ</b>\n\nФактические данные. Профиль — будущий игровой слой.", reply_markup=menu)
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
        await _panel_edit(call, text, reply_markup=_panel_back("panel:info"))
    except Exception:
        await _panel_edit(call, "⚠️ Telegram не предоставил данные этого чата.", reply_markup=_panel_back("panel:info"))
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
    menu.add(InlineKeyboardButton("◀️ Назад", callback_data="panel:back"))
    await _panel_edit(call, "<b>🔨 МОДЕРАЦИЯ</b>\n\nВыберите действие.", reply_markup=menu)
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
    await _panel_edit(call, "Ответьте на сообщение цели" + extra + ".", reply_markup=_panel_back("panel:moderation"))
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
        InlineKeyboardButton("↩️ Отмена", callback_data="panel:back"),
    )
    await _panel_edit(call, 
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
    menu.add(InlineKeyboardButton("◀️ Назад", callback_data="panel:back"))
    await _panel_edit(call, "<b>👋 ПРИВЕТСТВИЕ</b>", reply_markup=menu)
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:welcome:auto")
async def panel_welcome_auto(call):
    if not (is_owner(call.from_user.id) or has_moderator_role(call.from_user.id, call.message.chat.id)):
        await call.answer("Нет доступа.", show_alert=True)
        return
    chats.cursor.execute("UPDATE chats SET welcome='' WHERE chat_id=?", (call.message.chat.id,))
    chats.connect.commit()
    await _panel_edit(call, "🤖 Авто-Аи включено.", reply_markup=_panel_back("panel:welcome"))
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:welcome:fixed")
async def panel_welcome_fixed(call):
    if not (is_owner(call.from_user.id) or has_moderator_role(call.from_user.id, call.message.chat.id)):
        await call.answer("Нет доступа.", show_alert=True)
        return
    from handlers.help.help import _PANEL_PENDING
    _PANEL_PENDING[(call.from_user.id, call.message.chat.id)] = {"kind": "welcome"}
    await _panel_edit(call, "✏️ Ответьте на это сообщение текстом фиксированного приветствия.", reply_markup=_panel_back("panel:welcome"))
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
        InlineKeyboardButton("↩️ Отмена", callback_data="panel:back"),
    )
    await _panel_edit(call, 
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
    await _panel_edit(call, 
        "<b>📣 ЕДИНАЯ РАССЫЛКА</b>\n\n"
        f"Отправьте следующим сообщением текст, фото или другое сообщение для рассылки {labels[target]}.",
        reply_markup=_panel_back("panel:system:broadcast"),
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
    menu.add(InlineKeyboardButton("🛰 Стазис / пробуждение", callback_data="panel:system:stasis"))
    menu.add(InlineKeyboardButton("📊 Runtime статус", callback_data="panel:system:status"))
    menu.add(InlineKeyboardButton("🩺 Диагностика", callback_data="panel:system:diagnostics"))
    menu.add(InlineKeyboardButton("🔋 Батарея", callback_data="panel:system:battery"))
    menu.add(InlineKeyboardButton("📜 Логи", callback_data="panel:system:logs"))
    menu.add(InlineKeyboardButton("🧪 Debug", callback_data="panel:system:debug"))
    menu.add(InlineKeyboardButton("🔄 Перезапуск", callback_data="panel:system:restart"))
    menu.add(InlineKeyboardButton("🧪 QA-метки", callback_data="panel:system:issues"))
    menu.add(InlineKeyboardButton("📱 Termux HA", callback_data="panel:system:termux"))
    menu.add(InlineKeyboardButton("◀️ Назад", callback_data="panel:back"))
    await _panel_edit(call, "<b>⚙️ СИСТЕМНОЕ</b>", reply_markup=menu)
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
        InlineKeyboardButton("◀️ Назад", callback_data="panel:back"),
    )
    await _panel_edit(call, 
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
    await _panel_edit(call, 
        "🗣 Отправьте через запятую имена вызова Аи. Например: <code>Аи, Система</code>.",
        reply_markup=_panel_back("panel:system:names"),
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:system:ai")
async def panel_system_ai(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    from services.ai_service import ai_status, _LAST_ERROR
    status = ai_status()
    configured = "✅ задан" if status["configured"] else "❌ НЕ задан"
    last_error = _LAST_ERROR.get("value") or "нет — запросов с ошибкой ещё не было"
    await _panel_edit(
        call,
        "<b>🧠 AI DIAGNOSTIC</b>\\n\\n"
        f"Ключ: <b>{configured}</b>\\n"
        f"Модель: <code>{escape_for_telegram_html(str(status['model']))}</code>\\n"
        f"Последняя ошибка: <code>{escape_for_telegram_html(str(last_error)[:1500])}</code>\\n\\n"
        "Для проверки ответа: <code>/ai привет</code>",
        reply_markup=_panel_back("panel:system"),
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:system:status")
async def panel_system_status(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    from main import _runtime_status_snapshot
    status = _runtime_status_snapshot()
    heartbeat_age = status["heartbeat_age"]
    heartbeat = f"{heartbeat_age:.1f}s назад" if heartbeat_age is not None else "нет"
    uptime = status["process_uptime"]
    uptime_text = "unknown" if uptime is None else f"{int(uptime // 3600)}ч {int((uptime % 3600) // 60)}м {int(uptime % 60)}с"
    await _panel_edit(
        call,
        "<b>📊 FOUNDER RUNTIME STATUS</b>\\n"
        f"Бот: <b>{'🟢 OK' if heartbeat_age is not None and heartbeat_age <= 30 else '🔴 STALE/MISSING'}</b>\\n"
        f"Heartbeat: <code>{escape_for_telegram_html(heartbeat)}</code>\\n"
        f"PID: <code>{status['pid']}</code>\\n"
        f"Uptime: <code>{escape_for_telegram_html(uptime_text)}</code>\\n"
        f"Commit: <code>{escape_for_telegram_html(status['commit'])}</code>",
        reply_markup=_panel_back("panel:system"),
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:system:diagnostics")
async def panel_system_diagnostics(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    import os
    import subprocess
    script = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "scripts", "healthcheck.py")
    script = os.path.abspath(script)
    try:
        result = subprocess.run(
            [os.getenv("PYTHON", "python3"), script, "--diagnostics"],
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            capture_output=True,
            text=True,
            timeout=20,
            env=os.environ.copy(),
        )
        output = (result.stdout + "\\n" + result.stderr).strip() or "Диагностика не вернула текст."
    except Exception as exc:
        output = f"{type(exc).__name__}: {exc}"
    if len(output) > 4500:
        output = output[-4500:]
    await _panel_edit(
        call,
        "<b>🩺 NETWORK / RUNTIME DIAGNOSTICS</b>\\n\\n<pre>"
        + escape_for_telegram_html(output)
        + "</pre>",
        reply_markup=_panel_back("panel:system"),
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:system:battery")
async def panel_system_battery(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    from services.battery_status import get_battery_status
    try:
        status = get_battery_status()
        charging = status.get("charging")
        percentage = status.get("percentage", "?")
        plugged = str(status.get("plugged", "UNKNOWN")).upper()
        state = "⚡ Заряжается" if charging else "🔋 Не заряжается"
        await _panel_edit(
            call,
            "<b>🔋 СТАТУС ЗАРЯДКИ</b>\\n"
            f"Уровень: <b>{percentage}%</b>\\n"
            f"Состояние: <b>{state}</b>\\n"
            f"Источник: <b>{escape_for_telegram_html(plugged)}</b>",
            reply_markup=_panel_back("panel:system"),
        )
    except Exception as exc:
        await _panel_edit(
            call,
            "⚠️ <b>Ошибка батареи</b>\\n<code>"
            + escape_for_telegram_html(f"{type(exc).__name__}: {exc}")
            + "</code>",
            reply_markup=_panel_back("panel:system"),
        )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:system:logs")
async def panel_system_logs(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    from main import LOG_FILE
    import os
    try:
        with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as handle:
            output = handle.read() or "bot.log пока пуст."
    except Exception as exc:
        output = f"{type(exc).__name__}: {exc}"
    if len(output) > 4500:
        output = output[-4500:]
    await _panel_edit(
        call,
        "<b>📜 ПОСЛЕДНИЕ ЛОГИ</b>\\n\\n<pre>" + escape_for_telegram_html(output) + "</pre>",
        reply_markup=_panel_back("panel:system"),
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:system:debug")
async def panel_system_debug(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    await _panel_edit(
        call,
        "🧪 <b>DEBUG</b>\\n\\nОбработчики сообщений активны.\\n"
        "Полный dispatch-лог записывается автоматически.",
        reply_markup=_panel_back("panel:system"),
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:system:restart")
async def panel_system_restart(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    menu = InlineKeyboardMarkup(row_width=2)
    menu.add(
        InlineKeyboardButton("🔄 Подтвердить", callback_data="panel:system:restart:apply"),
        InlineKeyboardButton("↩️ Отмена", callback_data="panel:back"),
    )
    await _panel_edit(
        call,
        "<b>🔄 ПЕРЕЗАПУСК</b>\\n\\nПодтвердите перезапуск текущего процесса.",
        reply_markup=menu,
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:system:restart:apply")
async def panel_system_restart_apply(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    from main import HEALTH_DIR, log, asyncio, os
    request_path = os.path.join(HEALTH_DIR, "restart.request")
    try:
        os.makedirs(HEALTH_DIR, exist_ok=True)
        with open(request_path, "w", encoding="utf-8") as handle:
            handle.write(f"requested_at={__import__('time').time()}\\nrequested_by={call.from_user.id}\\n")
        await call.answer("Перезапуск запрошен.", show_alert=True)
        await call.message.edit_text(
            "🔄 <b>ПЕРЕЗАПУСК ЗАПРОШЕН</b>\\n"
            "Текущий процесс завершится, supervisor поднимет его заново."
        )
        log.warning("REMOTE RESTART | founder requested restart from panel")
        await asyncio.sleep(0.3)
        os._exit(0)
    except Exception as exc:
        await call.answer(f"Ошибка: {type(exc).__name__}", show_alert=True)


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
        InlineKeyboardButton("↩️ Отмена", callback_data="panel:back"),
    )
    await _panel_edit(call, 
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
    register_runtime_action(call.from_user.id, call.message.chat.id, previous_enabled=enabled, scope="global")
    await _panel_edit(call, 
        "<b>🛰 СТАЗИС</b>\\n\\nСостояние: <b>" + ("активен" if not enabled else "снят") + "</b>",
        reply_markup=_panel_back("panel:system"),
    )
    await call.answer("Стазис активирован." if not enabled else "Стазис снят.", show_alert=True)


@dp.callback_query_handler(lambda c: c.data == "panel:system:termux")
async def panel_system_termux(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    menu = InlineKeyboardMarkup(row_width=1)
    menu.add(InlineKeyboardButton("🔁 ROLE — штатное переключение", callback_data="panel:system:termux:role"))
    menu.add(InlineKeyboardButton("🚨 FORCE — аварийный takeover", callback_data="panel:system:termux:force"))
    menu.add(InlineKeyboardButton("◀️ Назад", callback_data="panel:back"))
    await _panel_edit(
        call,
        "<b>📱 TERMUX HIGH AVAILABILITY</b>\\n\\n"
        "Управление выполняется через GitHub Issue #23.\\n"
        "В каждый момент времени бот должен работать только на одном телефоне.",
        reply_markup=menu,
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:system:termux:role")
async def panel_system_termux_role(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    await _panel_edit(
        call,
        "<b>🔁 ROLE — штатное переключение</b>\\n\\n"
        "<code>ROLE phone1 ACTIVE</code>\\n"
        "<code>ROLE phone1 STANDBY</code>\\n"
        "<code>ROLE phone2 ACTIVE</code>\\n"
        "<code>ROLE phone2 STANDBY</code>\\n\\n"
        "Команду отправляйте отдельным комментарием в Issue #23. "
        "Обычный ROLE ACTIVE не перехватывает активную lease другого телефона.",
        reply_markup=_panel_back("panel:system:termux"),
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:system:termux:force")
async def panel_system_termux_force(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    await _panel_edit(
        call,
        "<b>🚨 FORCE — аварийное переключение</b>\\n\\n"
        "<code>FORCE phone1 ACTIVE</code>\\n"
        "<code>FORCE phone2 ACTIVE</code>\\n\\n"
        "Используйте только при аварии, когда штатный ROLE не подходит. "
        "Целевой телефон меняет центральную lease, ждёт fence-интервал и затем запускает бот. "
        "После неуспешного healthcheck lease откатывается.",
        reply_markup=_panel_back("panel:system:termux"),
    )
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:system:issues")
async def panel_system_issues(call):
    if not is_owner(call.from_user.id):
        await call.answer("Только Основатель.", show_alert=True)
        return
    from services.issue_tracker import list_markers, render_marker
    rows = list_markers()
    body = "\n\n".join(escape_for_telegram_html(render_marker(row)) for row in rows) or "Список пуст."
    await _panel_edit(call, "<b>🧪 QA-МЕТКИ</b>\n\n" + body, reply_markup=_panel_back("panel:system"))
    await call.answer()


@dp.callback_query_handler(lambda c: c.data == "panel:close")
async def panel_close(call):
    key = _panel_key(call)
    _PANEL_HISTORY.pop(key, None)
    _PANEL_CURRENT.pop(key, None)
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

