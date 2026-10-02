import json
import logging
import unittest
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
        from handlers.help.help import _is_founder_scope_reply

        self.assertTrue(_is_founder_scope_reply("в этом чате"))
        self.assertTrue(_is_founder_scope_reply("ГЛОБАЛЬНО"))
        for text in ("подтверждаю", "отмена", "замуть его на 30 минут", "аи статус"):
            self.assertFalse(_is_founder_scope_reply(text))

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


if __name__ == "__main__":
    unittest.main()
