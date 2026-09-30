import unittest


class SecurityLayerTests(unittest.TestCase):
    def test_redactor_hides_bearer_and_api_key_values(self):
        from services.security import redact

        value = redact("Bearer super-secret-token api_key=another-secret")
        self.assertNotIn("super-secret-token", value)
        self.assertNotIn("another-secret", value)
        self.assertIn("[REDACTED]", value)

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
