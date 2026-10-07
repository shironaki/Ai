import json
import logging
import unittest
from pathlib import Path
from unittest.mock import patch


class SecurityRegressionTests(unittest.TestCase):
    def test_stasis_scope_cannot_cross_global_policy(self):
        from core.command_models import CommandIntent
        from core.command_policy import evaluate

        decision = evaluate(
            CommandIntent(command="logs", scope="chat"),
            "Создатель бота",
        )
        self.assertFalse(decision.allowed)

    def test_destructive_command_requires_explicit_confirmation(self):
        from core.command_models import CommandIntent
        from core.command_policy import evaluate

        intent = CommandIntent(command="mute", scope="chat")
        self.assertTrue(evaluate(intent, "Модератор").requires_confirmation)
        self.assertTrue(evaluate(intent, "Модератор", confirmed=True).allowed)

    def test_pending_state_is_bound_to_user_and_chat(self):
        from services import command_gateway

        command_gateway.cancel_pending(1001, 2001)
        command_gateway.remember(
            1001,
            2001,
            {"command": "stasis", "action": "enable", "scope": "chat"},
        )
        try:
            self.assertTrue(command_gateway.has_pending(1001, 2001))
            self.assertFalse(command_gateway.has_pending(1002, 2001))
            self.assertFalse(command_gateway.has_pending(1001, 2002))
        finally:
            command_gateway.cancel_pending(1001, 2001)

    def test_founder_scope_handler_does_not_consume_confirmation_words(self):
        from core.command_resolution import is_founder_scope_reply

        self.assertTrue(is_founder_scope_reply("в этом чате"))
        self.assertTrue(is_founder_scope_reply("ГЛОБАЛЬНО"))
        for text in ("подтверждаю", "отмена", "замуть его на 30 минут", "аи статус"):
            self.assertFalse(is_founder_scope_reply(text))

    def test_audit_event_contains_metadata_only(self):
        from services.audit_service import record

        with self.assertLogs("services.audit_service", level=logging.INFO) as captured:
            record(
                user_id=1,
                chat_id=2,
                command="mute",
                scope="chat",
                result="executed",
            )
        event = json.loads(captured.output[0].split("AUDIT ", 1)[1])
        self.assertEqual(
            set(event),
            {"ts", "user_id", "chat_id", "command", "scope", "result"},
        )
        self.assertNotIn("prompt", event)
        self.assertNotIn("message", event)
        self.assertNotIn("token", event)
        self.assertNotIn("credentials", event)


    def test_telegram_admin_is_not_bot_administrator_role(self):
        from services.chat_members import get_chat_authority

        class Row(dict):
            __getattr__ = dict.get

        with patch("services.chat_members.connect_db") as connect:
            db = connect.return_value.__enter__.return_value
            db.execute.return_value.fetchone.return_value = Row(
                telegram_status="administrator",
                is_chat_owner=0,
                is_chat_admin=1,
            )
            self.assertIsNone(get_chat_authority(123, 456))


    def test_failed_telegram_authority_refresh_fails_closed(self):
        from services.chat_members import invalidate_chat_authority

        with patch("services.chat_members.connect_db") as connect:
            db = connect.return_value.__enter__.return_value
            invalidate_chat_authority(123, 456)
            self.assertEqual(
                db.execute.call_args_list[-1],
                __import__("unittest").mock.call(
                    "UPDATE chat_members SET telegram_status='unknown', is_chat_owner=0, is_chat_admin=0 WHERE chat_id=? AND user_id=?",
                    (123, 456),
                ),
            )
            db.commit.assert_called()


    def test_chat_owner_authority_overrides_chat_role(self):
        from core.permissions import get_display_role, get_user_status

        with patch("core.permissions.is_owner", return_value=False), \
             patch("services.chat_members.get_chat_authority", return_value="Администратор"), \
             patch("services.chat_roles.get_role", return_value="Модератор"):
            self.assertEqual(get_user_status(123, 456), "Администратор")
            self.assertEqual(get_display_role(123, 456), "Администратор")

    def test_chat_admin_authority_overrides_chat_role(self):
        from core.permissions import has_admin_role, has_moderator_role, get_display_role

        with patch("core.permissions.is_owner", return_value=False), \
             patch("services.chat_members.get_chat_authority", return_value="Администратор"), \
             patch("services.chat_roles.get_role", return_value="Модератор"):
            self.assertTrue(has_admin_role(123, 456))
            self.assertTrue(has_moderator_role(123, 456))
            self.assertEqual(get_display_role(123, 456), "Администратор")

    def test_two_chat_matrix_keeps_telegram_authority_and_local_roles_isolated(self):
        from core.permissions import get_display_role, get_user_status

        def authority(chat_id, user_id):
            if chat_id == 100 and user_id == 7:
                return "Администратор"
            if chat_id == 200 and user_id == 7:
                return None
            return None

        def local_role(chat_id, user_id):
            if chat_id == 200 and user_id == 7:
                return "Модератор"
            return None

        with patch("core.permissions.is_owner", return_value=False), \
             patch("services.chat_members.get_chat_authority", side_effect=authority), \
             patch("services.chat_roles.get_role", side_effect=local_role):
            self.assertEqual(get_user_status(7, 100), "Администратор")
            self.assertEqual(get_display_role(7, 100), "Администратор")
            self.assertEqual(get_user_status(7, 200), "Модератор")
            self.assertEqual(get_display_role(7, 200), "Модератор")
            self.assertEqual(get_user_status(7, 300), "Пользователь")
            self.assertEqual(get_display_role(7, 300), "Пользователь")

    def test_role_matrix_maps_capabilities_to_each_chat_authority(self):
        from core.permissions import get_user_status, has_admin_role, has_moderator_role

        def authority(chat_id, user_id):
            if chat_id == 100 and user_id == 7:
                return "Администратор"
            return None

        def local_role(chat_id, user_id):
            if chat_id == 200 and user_id == 7:
                return "Модератор"
            return None

        with patch("core.permissions.is_owner", return_value=False), \
             patch("services.chat_members.get_chat_authority", side_effect=authority), \
             patch("services.chat_roles.get_role", side_effect=local_role):
            self.assertEqual(get_user_status(7, 100), "Администратор")
            self.assertTrue(has_moderator_role(7, 100))
            self.assertTrue(has_admin_role(7, 100))
            self.assertEqual(get_user_status(7, 200), "Модератор")
            self.assertTrue(has_moderator_role(7, 200))
            self.assertFalse(has_admin_role(7, 200))


    def test_user_service_status_uses_authoritative_role_resolver(self):
        from services.user_service import get_status

        with patch("core.permissions.get_display_role", return_value="Модератор"):
            self.assertEqual(get_status(7, 123), "Модератор")

    def test_user_summary_does_not_fall_back_to_legacy_global_status(self):
        from services.ai_data import user_summary

        class Row(dict):
            pass

        with patch("services.ai_data.get_user", return_value=Row(
            id=7,
            name="QA",
            username="qa",
            status="Модератор",
            regdata="04.10.2026",
        )), patch("services.ai_data.get_display_role", return_value="Пользователь"):
            summary = user_summary(7)
            self.assertEqual(summary["status"], "Пользователь")

    def test_user_summary_uses_chat_effective_role(self):
        from services.ai_data import user_summary

        class Row(dict):
            pass

        with patch("services.ai_data.get_user", return_value=Row(
            id=7,
            name="QA",
            username="qa",
            status="Пользователь",
            regdata="04.10.2026",
        )), patch("services.ai_data.get_display_role", return_value="Модератор") as role:
            summary = user_summary(7, 200)

        self.assertEqual(summary["status"], "Модератор")
        role.assert_called_once_with(7, 200)

    def test_user_summary_without_chat_uses_authoritative_global_role(self):
        from services.ai_data import user_summary

        class Row(dict):
            pass

        with patch("services.ai_data.get_user", return_value=Row(
            id=7,
            name="QA",
            username="qa",
            status="Модератор",
            regdata="04.10.2026",
        )), patch("services.ai_data.get_display_role", return_value="Пользователь") as role:
            summary = user_summary(7)

        self.assertEqual(summary["status"], "Пользователь")
        self.assertEqual(summary["id"], 7)
        role.assert_called_once_with(7, None)

    def test_registered_aliases_match_real_dispatch_surface(self):
        from core.command_registry import COMMAND_REGISTRY

        specs = {item.key: item for item in COMMAND_REGISTRY}
        self.assertTrue({"help", "хелп", "команды"} <= specs["help"].aliases)
        self.assertTrue({"welcome", "приветствие"} <= specs["welcome"].aliases)
        self.assertIn("тишина", specs["silence"].aliases)
        self.assertIn("модерация", specs["moderation"].aliases)
        self.assertFalse(specs["welcome"].confirmation)
        self.assertFalse(specs["setstatus"].confirmation)

    def test_role_based_moderation_has_no_hidden_telegram_admin_gate(self):
        from pathlib import Path

        root = Path(__file__).resolve().parents[1]
        source = (root / "handlers" / "admin" / "apanel.py").read_text(encoding="utf-8")
        for command in ("unmute", "ban", "unban"):
            line = next(
                line for line in source.splitlines()
                if "@dp.message_handler" in line and command in line
            )
            self.assertNotIn("is_chat_admin=True", line)

    def test_welcome_uses_effective_role_without_extra_telegram_admin_gate(self):
        from pathlib import Path

        root = Path(__file__).resolve().parents[1]
        source = (root / "handlers" / "admin" / "apanel.py").read_text(encoding="utf-8")
        block = source[source.index("async def rules_cmd"):source.index("# Legacy barrier commands")]
        self.assertIn("has_moderator_role(message.from_user.id, message.chat.id)", block)
        self.assertNotIn("get_chat_administrators", block)

    def test_silence_apply_requires_live_confirmation_state(self):
        from pathlib import Path

        root = Path(__file__).resolve().parents[1]
        source = (root / "handlers" / "help" / "command_help.py").read_text(encoding="utf-8")
        block = source[source.index('async def panel_silence_apply'):source.index('@dp.callback_query_handler(lambda c: c.data == "panel:welcome")')]
        self.assertIn('confirmation.get("kind") != "silence"', block)
        self.assertIn('confirmation.get("message_id") != call.message.message_id', block)
        self.assertIn('confirmation.get("expected_enabled")', block)

    def test_new_member_welcome_ai_is_chat_scoped(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / "handlers" / "chat_groups.py").read_text(encoding="utf-8")
        self.assertIn('generate_reply(member.id, prompt, "Пользователь", chat_id=message.chat.id)', source)

    def test_panel_role_assignment_is_visible_only_to_chat_admins_and_has_role_writer(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / "handlers" / "help" / "command_help.py").read_text(encoding="utf-8")
        users_block = source[source.index("async def panel_users"):source.index('async def panel_relation_menu')]
        self.assertIn('_panel_role(call.from_user.id, call.message.chat.id) == "Администратор"', users_block)
        self.assertNotIn('in {"Администратор", "Хелпер"}', users_block)
        role_menu = source[source.index("async def panel_role_menu"):source.index("async def panel_admins")]
        role_select = source[source.index("async def panel_role_select"):source.index("async def panel_admins")]
        self.assertIn('_panel_role(call.from_user.id, call.message.chat.id) == "Администратор"', role_menu)
        self.assertIn('_panel_role(call.from_user.id, call.message.chat.id) == "Администратор"', role_select)
        self.assertIn("from services.chat_roles import get_role, list_roles, set_role", source)
        help_source = (root / "handlers" / "help" / "help.py").read_text(encoding="utf-8")
        role_block = help_source[help_source.index("async def _apply_panel_role"):help_source.index("#chatinfo")]
        self.assertIn("set_role(message.chat.id, target_user_id, target_role, actor_id)", role_block)

    def test_panel_back_clears_all_panel_scoped_pending_state(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / "handlers" / "help" / "command_help.py").read_text(encoding="utf-8")
        block = source[source.index("async def panel_back"):source.index("async def panel_root", source.index("async def panel_back"))]
        self.assertIn("_PANEL_CONFIRMATIONS.pop(key, None)", block)
        self.assertIn("_PANEL_PENDING.pop(key, None)", block)
        self.assertIn("_REPORT_PENDING.pop(key, None)", block)
        self.assertIn("await FSMContext.current().finish()", block)

    def test_panel_myinfo_uses_chat_effective_role(self):
        from pathlib import Path

        root = Path(__file__).resolve().parents[1]
        source = (root / "handlers" / "help" / "command_help.py").read_text(encoding="utf-8")
        block = source[source.index("async def panel_myinfo"):source.index("async def panel_info")]
        self.assertIn("user_summary(call.from_user.id, call.message.chat.id)", block)

    def test_qa_marker_access_remains_founder_only(self):
        from core.command_registry import COMMAND_REGISTRY

        spec = next(item for item in COMMAND_REGISTRY if item.key == "issue_list")
        self.assertEqual(spec.min_role, "Создатель бота")
        self.assertEqual(spec.scope, "global")

    def test_qa_marker_rendering_preserves_workflow_state_and_newlines(self):
        from services.issue_tracker import render_marker

        row = (
            42, 100, 200, 7, "QA",
            "проверка",
            "runtime",
            "Автоматическая диагностика",
            None,
            "in_progress",
            "2026-10-05T00:00:00+00:00",
            None,
            None,
            None,
            "проверка фикса",
        )
        rendered = render_marker(row)
        self.assertIn("в работе", rendered)
        self.assertIn("решение: проверка фикса", rendered)
        self.assertNotIn(r"\nрешение", rendered)


    def test_ai_request_timeout_is_bounded(self):
        from services.ai_service import _REQUEST_TIMEOUT

        connect_timeout, read_timeout = _REQUEST_TIMEOUT
        self.assertGreater(connect_timeout, 0)
        self.assertGreater(read_timeout, 0)
        self.assertLessEqual(connect_timeout, 10)
        self.assertLessEqual(read_timeout, 30)

    def test_founder_remains_global_and_immutable(self):
        from core.permissions import get_display_role, get_user_status

        with patch("core.permissions.is_owner", return_value=True), \
             patch("services.chat_members.get_chat_authority", return_value="Пользователь"), \
             patch("services.chat_roles.get_role", return_value="Модератор"):
            self.assertEqual(get_user_status(1, 999), "Создатель бота")
            self.assertEqual(get_display_role(1, 999), "Создатель бота")

    def test_safe_natural_informational_actions_reach_regular_users(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / "handlers" / "help" / "help.py").read_text(encoding="utf-8")
        self.assertIn("async def direct_informational_action(message: types.Message):", source)
        self.assertIn('m.from_user.id != config.owner', source)
        self.assertIn('detect_direct_action(m.text) in {', source)
        self.assertIn('"profile"', source)
        self.assertIn('"chatinfo"', source)

    def test_lease_watchdog_fences_invalid_initial_lease(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / "scripts" / "termux_lease_watchdog.py").read_text(encoding="utf-8")
        block = source[source.index("def main"):source.index('if __name__ == "__main__"')]
        self.assertIn("owner, last_expiry = read_lease()", block)
        self.assertIn("if owner != DEVICE_ID or last_expiry <= now:", block)

    def test_lease_watchdog_keeps_pid_state_until_process_is_dead(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / "scripts" / "termux_lease_watchdog.py").read_text(encoding="utf-8")
        block = source[source.index("def stop_bot"):source.index("def main")]
        self.assertIn("signal.SIGTERM", block)
        self.assertIn("signal.SIGKILL", block)
        self.assertIn("return False", block)
        self.assertNotIn("os.kill(pid, signal.SIGTERM)\n    except Exception:\n        pass\n    BOT_PIDFILE.unlink", block)

    def test_report_service_has_no_hidden_tech_team_bypass(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / "services" / "report_service.py").read_text(encoding="utf-8")
        block = source[source.index("def answer_report"):source.index("def due_reminders")]
        self.assertNotIn("tech_team_ids", block)
        self.assertIn('get_global_role(answered_by) != "Хелпер"', block)

    def test_report_reminders_target_founder_and_global_helpers_only(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / "services" / "report_service.py").read_text(encoding="utf-8")
        block = source[source.index("async def reminder_loop"):]
        self.assertIn('list_global_users_by_role("Хелпер")', block)
        self.assertIn("recipients = tuple(dict.fromkeys((owner_id, *helper_ids)))", block)
        self.assertNotIn("recipient_ids", block)

    def test_helper_report_answer_callback_uses_global_scope(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / "handlers" / "help" / "help.py").read_text(encoding="utf-8")
        block = source[source.index("async def report_answer_start"):source.index("_PanelKey = tuple", source.index("async def report_answer_start"))]
        self.assertIn('resolve_role(call.from_user.id) == "Хелпер"', block)
        self.assertIn("get_report(report_id) if global_report_operator", block)

    def test_termux_update_writes_qa_hash_with_real_newline(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / "scripts" / "termux_update.sh").read_text(encoding="utf-8")
        self.assertIn('printf "%s\\n" "$current_hash" > "$hashfile"', source)
        self.assertNotIn('printf "%s\\\\n" "$current_hash" > "$hashfile"', source)

    def test_termux_control_stop_preserves_pid_while_process_lives(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / "scripts" / "termux_control.py").read_text(encoding="utf-8")
        block = source[source.index("def stop_bot_for_role"):source.index("def has_active_lease")]
        self.assertIn("os.kill(int(pid), 9)", block)
        self.assertIn("PID state preserved", block)
        self.assertIn("return \"bot stopped\"", block)

    def test_termux_control_restart_preserves_pid_if_old_bot_survives(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / "scripts" / "termux_control.py").read_text(encoding="utf-8")
        block = source[source.index("def restart_bot"):source.index("def set_role")]
        self.assertIn("os.kill(int(pid), 9)", block)
        self.assertIn("old bot process still alive; PID state preserved", block)
        self.assertIn("if bot_running():", block)

    def test_qa_agent_binds_replies_to_target_bot(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / "scripts" / "qa_agent.py").read_text(encoding="utf-8")
        self.assertIn("target_bot_id = getattr(target_entity, \"id\", None)", source)
        self.assertIn("sender.id != target_bot_id", source)
        self.assertIn("getattr(sender, \"bot\", False)", source)

    def test_report_callbacks_use_effective_chat_role(self):
        from pathlib import Path

        root = Path(__file__).resolve().parents[1]
        source = (root / "handlers" / "help" / "help.py").read_text(encoding="utf-8")
        for handler in ("async def report_view", "async def report_answer_start"):
            start = source.index(handler)
            block = source[start:source.find("\n@dp.", start + 1)]
            self.assertIn("_is_report_operator(call.from_user.id, call.message.chat.id)", block)


    def test_global_helper_who_owns_chat_keeps_local_admin_authority(self):
        from core.permissions import get_display_role, has_admin_role, has_moderator_role

        with (
            patch("core.permissions.is_owner", return_value=False),
            patch("core.permissions.resolve_role", return_value="Хелпер"),
            patch("services.chat_members.get_chat_authority", return_value="Администратор"),
            patch("services.chat_roles.get_role", return_value="Модератор"),
        ):
            self.assertEqual(get_display_role(7, 123), "Администратор")
            self.assertTrue(has_admin_role(7, 123))
            self.assertTrue(has_moderator_role(7, 123))

    def test_global_helper_cannot_gain_local_moderation_from_legacy_role(self):
        from core.permissions import has_moderator_role

        with patch("core.permissions.is_owner", return_value=False), \
             patch("core.permissions.resolve_role", return_value="Хелпер"), \
             patch("services.chat_roles.get_role", return_value="Модератор"), \
             patch("services.chat_members.get_chat_authority", return_value=None):
            self.assertFalse(has_moderator_role(7, 123))

    def test_local_role_assignment_rejects_global_helper_target(self):
        from services.chat_roles import set_role

        with patch("core.identity.resolve_role", return_value="Хелпер"):
            self.assertFalse(set_role(123, 7, "Модератор", 9))

    def test_report_creation_notifies_only_founder_and_global_helpers(self):
        from pathlib import Path
        root = Path(__file__).resolve().parents[1]
        source = (root / "handlers" / "help" / "help.py").read_text(encoding="utf-8")
        start = source.index("async def unified_report_request")
        end = source.index('\n@dp.callback_query_handler(lambda c: c.data == "reports:list")', start)
        block = source[start:end]
        self.assertIn("helper_ids = tuple(list_global_users_by_role(\"Хелпер\"))", block)
        self.assertIn("recipients = tuple(dict.fromkeys((config.owner, *helper_ids)))", block)
        self.assertNotIn("tech_team_ids", block)

    def test_qa_agent_accepts_only_target_bot_replies(self):
        from pathlib import Path
        root = Path(__file__).resolve().parents[1]
        source = (root / "scripts" / "qa_agent.py").read_text(encoding="utf-8")
        self.assertIn('target_entity = await client.get_entity(os.environ["QA_TARGET"])', source)
        self.assertIn('target_bot_id = getattr(target_entity, "id", None)', source)
        self.assertIn('if not target_bot_id or not getattr(target_entity, "bot", False):', source)
        self.assertIn("sender.id != target_bot_id", source)
        self.assertNotIn("sender.id != me.id", source)
        self.assertIn('    target_entity = await client.get_entity(os.environ["QA_TARGET"])\n    target_bot_id = getattr(target_entity, "id", None)', source)
        self.assertNotIn('        target_entity = await client.get_entity(os.environ["QA_TARGET"])\n', source)
        self.assertIn('print(json.dumps(asyncio.run(main()), ensure_ascii=False))', source)


if __name__ == "__main__":
    unittest.main()