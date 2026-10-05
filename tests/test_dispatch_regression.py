import ast
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


def _handler_command_literals(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call):
                continue
            name = decorator.func.attr if isinstance(decorator.func, ast.Attribute) else ""
            if name != "message_handler":
                continue
            for keyword in decorator.keywords:
                if keyword.arg != "commands":
                    continue
                if isinstance(keyword.value, (ast.List, ast.Tuple, ast.Set)):
                    values = {
                        elt.value.casefold()
                        for elt in keyword.value.elts
                        if isinstance(elt, ast.Constant) and isinstance(elt.value, str)
                    }
                    found.append((node.name, values))
    return found


class DispatchRegressionTests(unittest.TestCase):
    def test_start_has_one_authoritative_handler_and_owner_bootstrap(self):
        main_source = (ROOT / "main.py").read_text(encoding="utf-8")
        tree = ast.parse(main_source, filename="main.py")
        start_handlers = [
            node.name
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == "start_dispatch"
        ]
        self.assertEqual(start_handlers, ["start_dispatch"])
        self.assertIn("users.ensure_owner_registered(config.owner)", main_source)
        self.assertIn('re.match(r"^/start(?:@[A-Za-z0-9_]+)?(?:\\s|$)"', main_source)
        self.assertIn('if message.chat.type != "private":', main_source)

    def test_profile_handler_has_registration_guard(self):
        source = (ROOT / "handlers" / "help" / "help.py").read_text(encoding="utf-8")
        self.assertIn("async def info_msg(message):", source)
        self.assertIn('if row is None:', source)
        self.assertIn("Откройте личный чат и выполните первичный запуск.", source)

    def test_ordinary_uninvoked_text_does_not_open_ai_gateway(self):
        source = (ROOT / "handlers" / "help" / "help.py").read_text(encoding="utf-8")
        self.assertNotIn("async def user_natural_ai", source)
        self.assertIn("async def max_relationship_natural_ai", source)
        self.assertIn("is_max_positive(m.from_user.id, config.owner)", source)
        chat_source = (ROOT / "handlers" / "chat_groups.py").read_text(encoding="utf-8")
        self.assertIn("if user_id != config.owner and invocation is None and not max_positive:", chat_source)
        self.assertIn("await _answer_ai(message, prompt)", chat_source)

    def test_deterministic_assistant_actions_reach_real_handlers(self):
        source = (ROOT / "handlers" / "help" / "help.py").read_text(encoding="utf-8")
        for action in ("profile", "chatinfo", "system_stats", "system_info", "runtime"):
            self.assertIn('if direct_action == "' + action + '"', source) if action in ("profile", "chatinfo", "runtime") else self.assertIn('direct_action in {"system_stats", "system_info"}', source)
        self.assertIn('direct_action in {"status", "diagnostics", "debug", "logs", "ai_diagnostic"}', source)
        self.assertIn("await info_msg(message)", source)
        self.assertIn("await chatinfo_cmd(message)", source)
        self.assertIn("from main import debug_dispatch, send_logs, ai_diagnostic", source)

    def test_cancel_handlers_enforce_staff_surface(self):
        source = (ROOT / "handlers" / "help" / "help.py").read_text(encoding="utf-8")
        start = source.index("async def slash_cancel_pending_request")
        end = source.index("async def cancel_pending_request", start)
        slash_block = source[start:end]
        natural_start = end
        natural_end = source.index("\n\n@dp.message_handler(", natural_start)
        natural_block = source[natural_start:natural_end]
        self.assertIn("has_moderator_role", slash_block)
        self.assertIn("has_moderator_role", natural_block)
        self.assertIn("is_owner", slash_block)
        self.assertIn("is_owner", natural_block)

    def test_service_permission_boundaries_are_enforced(self):
        role_source = (ROOT / "services" / "chat_roles.py").read_text(encoding="utf-8")
        ai_source = (ROOT / "services" / "ai_relationship.py").read_text(encoding="utf-8")
        broadcast_source = (ROOT / "services" / "broadcast_service.py").read_text(encoding="utf-8")
        report_source = (ROOT / "services" / "report_service.py").read_text(encoding="utf-8")
        self.assertIn("can_assign(actor_role, role, actor_is_owner=is_owner(granted_by))", role_source)
        self.assertIn("if user_id == __import__(\"base\").config.owner:", role_source)
        self.assertIn("actor_id: int | None = None", ai_source)
        self.assertIn("AI relationship changes require founder actor context", ai_source)
        self.assertIn("AI call blocking changes require founder actor context", ai_source)
        self.assertIn("if actor_id != config.owner:", ai_source)
        self.assertIn("actor_id: int,", broadcast_source)
        self.assertIn("Broadcast execution requires founder actor context", broadcast_source)
        self.assertIn("Report replies require operator actor context", report_source)

    def test_chat_roles_are_surface_local_not_global(self):
        source = (ROOT / "core" / "permissions.py").read_text(encoding="utf-8")
        self.assertIn("if chat_id is not None:", source)
        self.assertIn('return get_role(chat_id, user_id) or "Пользователь"', source)
        self.assertIn("return resolve_role(user_id)", source)
        self.assertNotIn("if chat_role:", source)
        self.assertIn("return row[0] if row else None", source)

    def test_chat_role_display_and_authority_share_the_same_scope(self):
        source = (ROOT / "core" / "permissions.py").read_text(encoding="utf-8")
        self.assertIn("def get_display_role(user_id, chat_id=None):", source)
        self.assertIn("return get_role(chat_id, user_id) or \"Пользователь\"", source)
        self.assertIn("def has_moderator_role(user_id, chat_id=None):", source)
        self.assertIn("def has_admin_role(user_id, chat_id=None):", source)



    def test_chat_owner_authority_is_distinct_from_founder_identity(self):
        role_source = (ROOT / "config" / "role_config.py").read_text(encoding="utf-8")
        permissions = (ROOT / "core" / "permissions.py").read_text(encoding="utf-8")
        members = (ROOT / "services" / "chat_members.py").read_text(encoding="utf-8")
        help_source = (ROOT / "handlers" / "help" / "help.py").read_text(encoding="utf-8")
        main_source = (ROOT / "main.py").read_text(encoding="utf-8")
        self.assertIn('CHAT_OWNER_ROLE = "Владелец чата"', role_source)
        self.assertIn('CHAT_OWNER_ROLE: 45', role_source)
        self.assertIn('CHAT_OWNER_ROLE, OWNER_ROLE', role_source)
        self.assertIn('def get_chat_authority(chat_id: int, user_id: int)', members)
        self.assertIn('if row["is_chat_owner"] or row["telegram_status"] == "creator":', members)
        self.assertIn('authority = get_chat_authority(chat_id, user_id)', permissions)
        self.assertIn('from services.chat_members import get_chat_authority, observe_chat_member_update, refresh_chat_member, sync_chat_admins', main_source)
        self.assertIn('class ChatAuthorityMiddleware', main_source)
        self.assertIn('return "🔐 СПЕЦДОСТУП ПОЛУЧЕН · Я слушаю. Система в полном распоряжении. Приказывайте."', help_source)
        self.assertNotIn('return "👑 ОСНОВАТЕЛЬ · Я слушаю.', help_source)

    def test_moderation_menu_renderer_is_not_recursive(self):
        source = (ROOT / "handlers" / "help" / "command_help.py").read_text(encoding="utf-8")
        start = source.index("def _moderation_menu(call):")
        end = source.find("\n\n@dp.callback_query_handler", start)
        block = source[start:end]
        self.assertNotIn("menu = _moderation_menu(call)", block)
        self.assertIn('callback_data="panel:mod:" + action', block)
        self.assertIn('callback_data="panel:silence"', block)
    def test_runtime_and_silence_state_mutations_require_actor_context(self):
        main_source = (ROOT / "main.py").read_text(encoding="utf-8")
        silence_source = (ROOT / "services" / "silence_service.py").read_text(encoding="utf-8")
        self.assertIn("actor_id: int,", main_source)
        self.assertIn("Runtime state changes require founder actor context", main_source)
        self.assertIn("set_bot_paused(True, actor_id=message.from_user.id)", main_source)
        self.assertIn("set_bot_paused(False, actor_id=message.from_user.id)", main_source)
        self.assertIn("actor_id: int,", silence_source)
        self.assertIn("Chat silence changes require moderator actor context", silence_source)
    def test_termux_control_only_executes_runtime_commands_for_active_lease(self):
        source = (ROOT / "scripts" / "termux_control.py").read_text(encoding="utf-8")
        self.assertIn("def has_active_lease()", source)
        self.assertIn('if command in {"STATUS", "RESTART", "UPDATE"} and not has_active_lease():', source)
        self.assertIn('ignored: command requires active device lease', source)
    def test_public_health_command_is_independent_and_registered(self):
        main_source = (ROOT / "main.py").read_text(encoding="utf-8")
        registry_source = (ROOT / "core" / "command_registry.py").read_text(encoding="utf-8")
        self.assertIn('@dp.message_handler(commands=["health", "проверка"])', main_source)
        self.assertIn("async def health_check(message: types.Message):", main_source)
        start = main_source.index("async def health_check(")
        end = main_source.find("\n@dp.", start)
        block = main_source[start:] if end == -1 else main_source[start:end]
        self.assertIn("await bot.get_me()", block)
        self.assertIn('users.cursor.execute("SELECT 1")', block)
        self.assertIn('chats.cursor.execute("SELECT 1")', block)
        self.assertIn("PROCESS_STARTED_AT", block)
        self.assertIn("bot_is_paused()", block)
        self.assertIn('CommandSpec("health"', registry_source)
        self.assertIn('"health", "проверка"', registry_source)


    def test_help_command_has_single_authoritative_handler(self):
        handlers = []
        for path in (
            ROOT / "main.py",
            ROOT / "handlers" / "help" / "help.py",
            ROOT / "handlers" / "help" / "command_help.py",
            ROOT / "aboute.py",
        ):
            if path.exists():
                for name, commands in _handler_command_literals(path):
                    if {"help", "хелп", "команды"} & commands:
                        handlers.append((path.relative_to(ROOT).as_posix(), name, commands))
        self.assertEqual(len(handlers), 1, handlers)
        self.assertEqual(handlers[0][0], "handlers/help/command_help.py")

    def test_legacy_slash_moderation_routes_through_unified_gateway(self):
        source = (ROOT / "handlers" / "admin" / "apanel.py").read_text(encoding="utf-8")
        self.assertIn("from services.moderation_gateway import request as request_moderation", source)
        for function_name in ("mute", "unmute", "ban", "unban"):
            start = source.index("async def " + function_name + "(")
            end = source.find("\n@dp.", start)
            block = source[start:] if end == -1 else source[start:end]
            self.assertIn("request_moderation(message, message.text.strip())", block)
        self.assertNotIn("restrict_chat_member(", source)
        self.assertNotIn("ban_chat_member(", source)
        self.assertNotIn("unban_chat_member(", source)

    def test_report_prompt_escapes_html_placeholder(self):
        source = (ROOT / "handlers" / "help" / "help.py").read_text(encoding="utf-8")
        self.assertIn("<code>репорт &lt;текст&gt;</code>", source)
        self.assertNotIn("«репорт <текст>»", source)

    def test_registry_information_and_cancel_aliases_have_direct_handlers(self):
        source = (ROOT / "handlers" / "help" / "help.py").read_text(encoding="utf-8")
        self.assertIn('@dp.message_handler(commands=["info", "инфо", "инфа"]', source)
        self.assertIn('@dp.message_handler(commands=["cancel"]', source)

    def test_panel_destructive_confirmations_have_stale_state_guards(self):
        source = (ROOT / "handlers" / "help" / "command_help.py").read_text(encoding="utf-8")
        self.assertIn("_PANEL_CONFIRMATIONS = {}", source)
        self.assertIn('confirmation.get("message_id") != call.message.message_id', source)
        self.assertIn('confirmation.get("expected_enabled")', source)
        self.assertIn('_PANEL_CONFIRMATIONS.pop(key, None)', source)
        self.assertIn('_PANEL_CONFIRMATIONS.pop(key, None)\n    history = _PANEL_HISTORY.get(key)', source)

    def test_legacy_admin_callback_names_are_not_reintroduced(self):
        source = (ROOT / "handlers" / "help" / "help.py").read_text(encoding="utf-8")
        source += "\n" + (ROOT / "handlers" / "help" / "command_help.py").read_text(encoding="utf-8")
        for legacy in ("callback_data='stat'", 'callback_data="stat"', "callback_data='rassilka'", 'callback_data="rassilka"', "callback_data='chat_rassilka'", 'callback_data="chat_rassilka"', "callback_data='cancel_del'", 'callback_data="cancel_del"'):
            self.assertNotIn(legacy, source, legacy)

    def test_panel_navigation_and_action_returns_are_state_safe(self):
        source = (ROOT / "handlers" / "help" / "command_help.py").read_text(encoding="utf-8")
        self.assertIn("state: str | None = None", source)
        self.assertIn('push_history=False,\n            state="panel:moderation"', source)
        self.assertIn('push_history=False,\n        state="panel:system"', source)
        self.assertIn('push_history=False,\n        state="panel:welcome"', source)
        self.assertIn("def _moderation_menu(call):", source)

    def test_panel_callbacks_have_staff_guard_and_validate_callback_arguments(self):
        source = (ROOT / "handlers" / "help" / "command_help.py").read_text(encoding="utf-8")
        self.assertIn("def _panel_guard(call", source)
        for name in ("panel_back", "panel_root", "panel_cancel", "panel_myinfo", "panel_info", "panel_chatinfo", "panel_close"):
            start = source.index("async def " + name + "(")
            end = source.find("\n@dp.", start)
            block = source[start:] if end == -1 else source[start:end]
            self.assertIn("if not _panel_guard(call)", block, name)
        self.assertIn('if role not in allowed_roles:', source)
        self.assertIn('if action not in {"mute", "unmute", "ban", "unban"}:', source)
        self.assertIn('if target not in {"users", "chats", "all"}:', source)
        self.assertIn('if target not in {"primary", "alternate"}:', source)

    def test_unified_panel_cancel_clears_panel_pending_state(self):
        source = (ROOT / "handlers" / "help" / "command_help.py").read_text(encoding="utf-8")
        start = source.index("async def panel_cancel(")
        end = source.find("\n@dp.", start)
        block = source[start:] if end == -1 else source[start:end]
        self.assertIn("from handlers.help.help import _PANEL_PENDING", block)
        self.assertIn("_PANEL_PENDING.pop((call.from_user.id, call.message.chat.id), None)", block)
        self.assertIn("_PANEL_CONFIRMATIONS.pop(_panel_key(call), None)", block)
        self.assertIn("cancel_current_action(call.from_user.id, call.message.chat.id)", block)

    def test_panel_callbacks_are_registered_and_callback_errors_are_visible(self):
        help_source = (ROOT / "handlers" / "help" / "command_help.py").read_text(encoding="utf-8")
        main_source = (ROOT / "main.py").read_text(encoding="utf-8")
        self.assertIn('callback_data="panel:root"', help_source)
        self.assertIn('lambda c: c.data == "panel:root"', help_source)
        self.assertIn("async def unhandled_callback", help_source)
        self.assertIn('elif callback_query:', main_source)
        self.assertIn('stage="callback_exception"', main_source)

    def test_all_panel_callback_families_have_handlers(self):
        source = (ROOT / "handlers" / "help" / "command_help.py").read_text(encoding="utf-8")
        required = (
            "help:ai", "help:report", "panel:root", "panel:cancel", "panel:users",
            "panel:relation", "panel:relation:", "panel:role", "panel:role:",
            "panel:admins", "panel:myinfo", "panel:info", "panel:chatinfo",
            "panel:moderation", "panel:mod:", "panel:silence", "panel:silence:apply",
            "panel:welcome", "panel:welcome:auto", "panel:welcome:fixed",
            "panel:system", "panel:system:broadcast", "panel:broadcast:",
            "panel:system:names", "panel:names:", "panel:system:ai",
            "panel:system:stasis", "panel:system:stasis:apply",
            "panel:system:issues", "panel:system:status", "panel:system:diagnostics", "panel:system:battery",
            "panel:system:logs", "panel:system:debug", "panel:system:restart", "panel:back",
            "panel:reports", "panel:close",
        )
        for value in required:
            self.assertIn(value, source, value)
        handler_patterns = (
            'c.data == "help:ai"', 'c.data == "help:report"', 'c.data == "panel:root"',
            'c.data == "panel:cancel"', 'c.data == "panel:users"', 'c.data == "panel:relation"',
            'c.data.startswith("panel:relation:")', 'c.data == "panel:role"',
            'c.data.startswith("panel:role:")', 'c.data == "panel:admins"',
            'c.data == "panel:myinfo"', 'c.data == "panel:info"', 'c.data == "panel:chatinfo"',
            'c.data == "panel:moderation"', 'c.data.startswith("panel:mod:")',
            'c.data == "panel:silence"', 'c.data == "panel:silence:apply"',
            'c.data == "panel:welcome"', 'c.data == "panel:welcome:auto"',
            'c.data == "panel:welcome:fixed"', 'c.data == "panel:system"',
            'c.data == "panel:system:broadcast"', 'c.data.startswith("panel:broadcast:")',
            'c.data == "panel:system:names"', 'c.data.startswith("panel:names:")',
            'c.data == "panel:system:ai"', 'c.data == "panel:system:stasis"',
            'c.data == "panel:system:stasis:apply"', 'c.data == "panel:system:issues"',
            'c.data == "panel:system:status"', 'c.data == "panel:system:diagnostics"',
            'c.data == "panel:system:battery"', 'c.data == "panel:system:logs"',
            'c.data == "panel:system:debug"', 'c.data == "panel:system:restart"',
            'c.data == "panel:back"', 'c.data == "panel:close"',
        )
        for pattern in handler_patterns:
            self.assertIn(pattern, source, pattern)

    def test_natural_command_catalog_request_is_deterministic(self):
        source = (ROOT / "handlers" / "help" / "help.py").read_text(encoding="utf-8")
        self.assertIn("def _is_command_catalog_request", source)
        self.assertIn("await _render_help_root(message, role=role)", source)
        self.assertIn("_is_command_catalog_request(text)", source)

    def test_ai_invocation_has_safe_boundaries(self):
        source = (ROOT / "handlers" / "help" / "help.py").read_text(encoding="utf-8")
        self.assertIn('r")(?:\\s|$)"', source)
        self.assertIn('r")(?:[,,:]|\\s|$)"', source)
        self.assertIn('return normalized[slash_match.end():].strip()', source)

    def test_group_authority_verification_is_ttl_bound_and_event_invalidated(self):
        source = (ROOT / "main.py").read_text(encoding="utf-8")
        self.assertIn("_CHAT_AUTHORITY_VERIFY_TTL = 15.0", source)
        self.assertIn("_CHAT_AUTHORITY_VERIFY_AT", source)
        self.assertIn("_CHAT_AUTHORITY_VERIFY_AT.pop((chat.id, member_user.id), None)", source)
        self.assertIn("failed to verify user=%s chat=%s duration_ms=%s", source)
        self.assertIn("_sync_registered_chat_authority", source)
        self.assertIn('name="chat-authority-warmup"', source)
        self.assertIn("Do not make ordinary messages wait for getChatAdministrators()", source)

    def test_diagnostic_telemetry_does_not_block_message_dispatch(self):
        source = (ROOT / "main.py").read_text(encoding="utf-8")
        self.assertIn("async def _record_diagnostic_background", source)
        self.assertIn("asyncio.to_thread(record_diagnostic", source)
        self.assertIn('name="diagnostic-update"', source)
        self.assertIn('name="diagnostic-callback"', source)

    def test_runtime_errors_do_not_expose_internal_marker_ids_to_users(self):
        source = (ROOT / "main.py").read_text(encoding="utf-8")
        start = source.index("async def log_update_error(")
        end = source.find("\n\ndef _runtime_status_snapshot", start)
        block = source[start:end]
        self.assertIn("Ошибка автоматически зафиксирована во внутренней диагностике.", block)
        self.assertNotIn("QA-метку", block.split("if message:", 1)[1].split("elif callback_query:", 1)[0])

    def test_runtime_latency_and_single_instance_guards_exist(self):
        main_source = (ROOT / "main.py").read_text(encoding="utf-8")
        run_source = (ROOT / "run.py").read_text(encoding="utf-8")
        self.assertIn("duration_ms", main_source)
        self.assertIn("time.perf_counter()", main_source)
        self.assertIn("fcntl.flock", run_source)
        self.assertIn("LOCK_EX | fcntl.LOCK_NB", run_source)

    def test_founder_only_debug_has_direct_command_guard(self):
        source = (ROOT / "main.py").read_text(encoding="utf-8")
        start = source.index("async def debug_dispatch(")
        end = source.find("\n@dp.", start)
        block = source[start:] if end == -1 else source[start:end]
        self.assertIn("await _founder_command_guard(", block)


    def test_pending_welcome_rechecks_role_and_chat_scope(self):
        source = (ROOT / "handlers" / "help" / "help.py").read_text(encoding="utf-8")
        start = source.index('if pending["kind"] == "welcome":')
        end = source.find('\n    if pending["kind"] == "invocation_names":', start)
        block = source[start:end]
        self.assertIn("has_moderator_role(message.from_user.id, message.chat.id)", block)
        self.assertIn('pending.get("chat_id") != message.chat.id', block)


    def test_report_reply_rechecks_operator_scope(self):
        source = (ROOT / "handlers" / "help" / "help.py").read_text(encoding="utf-8")
        start = source.index("async def report_answer_message(")
        end = source.find("\n\n_PanelKey", start)
        block = source[start:end]
        self.assertIn("_is_report_operator(message.from_user.id)", block)
        self.assertIn("_REPORT_PENDING.pop(key, None)", block)


    def test_broadcast_requires_fresh_owner_confirmation_before_fsm(self):
        source = (ROOT / "handlers" / "help" / "command_help.py").read_text(encoding="utf-8")
        start = source.index("async def panel_broadcast_target(")
        end = source.find("\n@dp.callback_query_handler", start + 10)
        target_block = source[start:end]
        self.assertIn('"kind": "broadcast_target"', target_block)
        self.assertIn('"message_id": call.message.message_id', target_block)
        self.assertNotIn("await BroadcastState.target.set()", target_block)

        start = source.index("async def panel_broadcast_apply(")
        end = source.find("\n@dp.message_handler", start)
        apply_block = source[start:end]
        self.assertIn('confirmation.get("kind") != "broadcast_target"', apply_block)
        self.assertIn('confirmation.get("message_id") != call.message.message_id', apply_block)
        self.assertIn('target not in {"users", "chats", "all"}', apply_block)
        self.assertIn("await BroadcastState.target.set()", apply_block)


    def test_legacy_broadcast_routes_are_removed_and_panel_route_is_authoritative(self):
        self.assertFalse((ROOT / "aboute.py").exists())
        help_source = (ROOT / "handlers" / "help" / "command_help.py").read_text(encoding="utf-8")
        self.assertIn('panel:system:broadcast', help_source)
        self.assertIn('from services.broadcast_service import broadcast_message', help_source)


    def test_founder_only_command_guards_use_direct_bot_messages(self):
        source = (ROOT / "main.py").read_text(encoding="utf-8")
        self.assertIn("async def _founder_command_guard(message: types.Message, text: str) -> bool:", source)
        self.assertIn("await message.reply(text, allow_sending_without_reply=True)", source)
        for command in ("enter_stasis", "leave_stasis", "debug_dispatch", "runtime_diagnostics", "runtime_status", "remote_restart", "battery_status", "send_logs"):
            start = source.index("async def " + command + "(")
            end = source.find("\n@dp.", start)
            block = source[start:] if end == -1 else source[start:end]
            self.assertIn("await _founder_command_guard(", block, command)

    def test_setstatus_handler_has_runtime_admin_guard(self):
        source = (ROOT / "handlers" / "admin" / "apanel.py").read_text(encoding="utf-8")
        start = source.index("async def set_status(")
        end = source.find("\n# ", start)
        block = source[start:] if end == -1 else source[start:end]
        self.assertIn("has_admin_role(message.from_user.id, message.chat.id)", block)
        self.assertIn("Команда доступна только Администратору или Основателю", block)

    def test_slash_moderation_wrappers_do_not_bypass_unified_permission_gateway(self):
        source = (ROOT / "handlers" / "admin" / "apanel.py").read_text(encoding="utf-8")
        for function_name in ("mute", "unmute", "ban", "unban"):
            start = source.index("async def " + function_name + "(")
            end = source.find("\n@dp.", start)
            block = source[start:] if end == -1 else source[start:end]
            self.assertNotIn("is_chat_admin=True", block)
            self.assertIn("request_moderation(message, message.text.strip())", block)


if __name__ == "__main__":
    unittest.main()


def test_storage_privacy_boundaries_are_present():
    from pathlib import Path
    connection = Path("database/connection.py").read_text(encoding="utf-8")
    main = Path("main.py").read_text(encoding="utf-8")
    diagnostic = Path("services/diagnostic_journal.py").read_text(encoding="utf-8")
    reports = Path("services/report_service.py").read_text(encoding="utf-8")
    issues = Path("services/issue_tracker.py").read_text(encoding="utf-8")
    assert 'PRAGMA secure_delete=ON' in connection
    assert 'LOG_FILE = os.path.join(DATA_DIR, "bot.log")' in main
    assert 'os.chmod(LOG_FILE, 0o600)' in main
    assert 'DIAGNOSTIC_RETENTION_DAYS = 14' in diagnostic
    assert 'DIAGNOSTIC_MAX_ROWS = 5000' in diagnostic
    assert 'REPORT_RETENTION_DAYS = 90' in reports
    assert 'ISSUE_RETENTION_DAYS = 30' in issues
    assert 'redact(payload, 6000)' in reports
    assert 'redact(message_text, 4000)' in issues


def test_admin_log_view_redacts_credentials_before_rendering():
    from pathlib import Path
    source = Path("handlers/help/command_help.py").read_text(encoding="utf-8")
    marker = 'output = redact(handle.read() or "bot.log пока пуст.", 4500)'
    assert marker in source


def test_telegram_exfiltration_surfaces_redact_sensitive_runtime_output():
    from pathlib import Path
    security = Path("services/security.py").read_text(encoding="utf-8")
    main = Path("main.py").read_text(encoding="utf-8")
    help_source = Path("handlers/help/help.py").read_text(encoding="utf-8")
    assert "class RedactingFormatter" in security
    assert "RedactingFormatter(" in main
    assert 'content = redact(log_file.read(), 12000)' in main
    assert 'redact(str(exception), 1200)' in main
    assert 'redact(str(exc), 500)' in main
    # Debug output is now returned as a fixed diagnostic message; raw command output
    # is no longer exposed through the help gateway.
    assert 'async def debug_dispatch' in main
    assert 'DEBUG: обработчик сообщений работает.' in main

def test_runtime_logs_use_protected_bot_data_directory():
    from pathlib import Path
    autoupdate = Path("autoupdate.sh").read_text(encoding="utf-8")
    termux = Path("scripts/termux_update.sh").read_text(encoding="utf-8")
    assert 'export BOT_DATA_DIR="${BOT_DATA_DIR:-data/${BOT_ENV}}"' in autoupdate
    assert 'LOG="$DATA_DIR/autoupdate.log"' in autoupdate
    assert 'LOG="$DATA_DIR/termux-autoupdate.log"' in termux
    assert '>> "$DATA_DIR/bot.log" 2>&1' in termux
