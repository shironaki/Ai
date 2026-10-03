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

    def test_deterministic_assistant_actions_reach_real_handlers(self):
        source = (ROOT / "handlers" / "help" / "help.py").read_text(encoding="utf-8")
        for action in ("profile", "chatinfo", "system_stats", "system_info", "runtime"):
            self.assertIn('if direct_action == "' + action + '"', source) if action in ("profile", "chatinfo", "runtime") else self.assertIn('direct_action in {"system_stats", "system_info"}', source)
        self.assertIn('direct_action in {"debug", "logs", "ai_diagnostic"}', source)
        self.assertIn("await info_msg(message)", source)
        self.assertIn("await chatinfo_cmd(message)", source)
        self.assertIn("from main import debug_dispatch, send_logs, ai_diagnostic", source)

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

    def test_moderation_menu_renderer_is_not_recursive(self):
        source = (ROOT / "handlers" / "help" / "command_help.py").read_text(encoding="utf-8")
        start = source.index("def _moderation_menu(call):")
        end = source.find("\n\n@dp.callback_query_handler", start)
        block = source[start:end]
        self.assertNotIn("menu = _moderation_menu(call)", block)
        self.assertIn('callback_data="panel:mod:" + action', block)
        self.assertIn('callback_data="panel:silence"', block)
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
            end = source.find("\n# ", start)
            block = source[start:] if end == -1 else source[start:end]
            self.assertIn("request_moderation(message, message.text.strip())", block)
        self.assertNotIn("restrict_chat_member(", source)
        self.assertNotIn("ban_chat_member(", source)
        self.assertNotIn("unban_chat_member(", source)

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
        self.assertIn("if message.from_user.id != config.owner:", block)


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



if __name__ == "__main__":
    unittest.main()
