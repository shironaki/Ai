import unittest


class CommandStateIsolationTests(unittest.TestCase):
    def test_founder_pending_state_isolated_by_chat(self):
        from services.command_gateway import remember, pop_pending, has_pending

        user_id = 700001
        chat_a = -100101
        chat_b = -100202
        remember(user_id, chat_a, {"command": "stasis", "scope": "chat"})
        self.assertTrue(has_pending(user_id, chat_a))
        self.assertFalse(has_pending(user_id, chat_b))
        self.assertIsNone(pop_pending(user_id, chat_b))
        self.assertEqual(pop_pending(user_id, chat_a)["scope"], "chat")

    def test_moderation_pending_state_isolated_by_chat(self):
        from services.moderation_gateway import remember, pop, has_pending

        user_id = 700002
        chat_a = -100303
        chat_b = -100404
        intent = {"command": "mute", "target_user_id": 8}
        remember(user_id, chat_a, intent)
        self.assertTrue(has_pending(user_id, chat_a))
        self.assertFalse(has_pending(user_id, chat_b))
        self.assertIsNone(pop(user_id, chat_b))
        self.assertEqual(pop(user_id, chat_a), intent)


if __name__ == "__main__":
    unittest.main()
