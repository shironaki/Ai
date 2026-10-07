import unittest


class SecurityLayerTests(unittest.TestCase):
    def test_redactor_hides_bearer_and_api_key_values(self):
        from services.security import redact

        value = redact("Bearer super-secret-token api_key=another-secret")
        self.assertNotIn("super-secret-token", value)
        self.assertNotIn("another-secret", value)
        self.assertIn("[REDACTED]", value)

    def test_redactor_hides_common_platform_credentials(self):
        from services.security import redact
        value = redact("xoxb-very-secret github_pat-super-secret glpat-secret")
        self.assertNotIn("xoxb-very-secret", value)
        self.assertNotIn("github_pat-super-secret", value)
        self.assertNotIn("glpat-secret", value)

    def test_diagnostic_journal_redacts_exception_and_context(self):
        import services.diagnostic_journal as journal
        event = journal.record(stage="security-test", exception=RuntimeError("Bearer super-secret-token"), context={"callback_data": "api_key=another-secret"})
        row = journal.latest(event)
        self.assertNotIn("super-secret-token", str(row))
        self.assertNotIn("another-secret", str(row))

    def test_role_model_separates_global_helper_from_local_admin(self):
        from config.role_config import (
            OWNER_ROLE,
            ASSIGNABLE_ROLES,
            GLOBAL_ASSIGNABLE_ROLES,
            ROLE_TAGS,
            can_grant_role,
        )
        from core.role_transitions import available_role_targets

        self.assertNotIn(OWNER_ROLE, ROLE_TAGS)
        self.assertEqual(ASSIGNABLE_ROLES, ("Модератор",))
        self.assertEqual(GLOBAL_ASSIGNABLE_ROLES, ("Хелпер",))
        self.assertEqual(available_role_targets("Создатель бота", actor_is_owner=True), ("Хелпер",))
        self.assertEqual(available_role_targets("Администратор"), ("Модератор",))
        self.assertFalse(can_grant_role("Администратор", "Хелпер"))
        self.assertFalse(can_grant_role("Модератор", "Модератор"))

    def test_command_policy_rejects_unknown_and_insufficient_role(self):
        from core.command_models import CommandIntent
        from core.command_policy import evaluate

        unknown = evaluate(CommandIntent("not_registered"), "Создатель бота")
        self.assertFalse(unknown.allowed)

        admin_only = evaluate(CommandIntent("setstatus"), "Игрок")
        self.assertFalse(admin_only.allowed)

    def test_destructive_policy_requires_confirmation(self):
        from core.command_models import CommandIntent
        from core.command_policy import evaluate

        decision = evaluate(CommandIntent("ban"), "Создатель бота")
        self.assertTrue(decision.allowed)
        self.assertTrue(decision.requires_confirmation)

        confirmed = evaluate(
            CommandIntent("ban"),
            "Создатель бота",
            confirmed=True,
        )
        self.assertTrue(confirmed.allowed)
        self.assertFalse(confirmed.requires_confirmation)


    def test_scope_policy_does_not_allow_global_for_chat_only_command(self):
        from core.command_models import CommandIntent
        from core.command_policy import evaluate

        decision = evaluate(
            CommandIntent("mute", scope="global"),
            "Создатель бота",
        )
        self.assertFalse(decision.allowed)

    def test_runtime_commands_allow_both_scopes(self):
        from core.command_models import CommandIntent
        from core.command_policy import evaluate

        chat = evaluate(CommandIntent("stasis", scope="chat"), "Создатель бота")
        global_ = evaluate(CommandIntent("stasis", scope="global"), "Создатель бота")
        self.assertTrue(chat.allowed)
        self.assertTrue(global_.allowed)

    def test_moderation_gateway_resolves_role_in_current_chat(self):
        source = __import__("pathlib").Path("services/moderation_gateway.py").read_text(encoding="utf-8")
        self.assertIn("get_display_role(message.from_user.id, message.chat.id)", source)
        self.assertNotIn("get_display_role(message.from_user.id)\\n", source)

    def test_pending_founder_command_is_bound_to_chat(self):
        from services.command_gateway import (
            has_pending,
            pop_pending,
            remember,
        )

        intent = {"command": "stasis", "action": "enable", "scope": "unknown"}
        remember(1, 100, intent)

        self.assertTrue(has_pending(1, 100))
        self.assertFalse(has_pending(1, 200))
        self.assertIsNone(pop_pending(1, 200))
        self.assertEqual(pop_pending(1, 100), intent)


if __name__ == "__main__":
    unittest.main()
