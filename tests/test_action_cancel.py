import unittest


class ActionCancelTests(unittest.TestCase):
    def test_unified_cancel_clears_command_and_moderation_pending(self):
        from services.action_cancel import cancel_current_action
        from services.command_gateway import remember, has_pending
        from services.moderation_gateway import _PENDING

        user_id, chat_id = 1001, -2002
        remember(user_id, chat_id, {"command": "stasis"})
        _PENDING[(user_id, chat_id)] = {"action": "mute", "target": 3003}

        self.assertTrue(cancel_current_action(user_id, chat_id))
        self.assertFalse(has_pending(user_id, chat_id))
        self.assertNotIn((user_id, chat_id), _PENDING)
        self.assertFalse(cancel_current_action(user_id, chat_id))


if __name__ == "__main__":
    unittest.main()
