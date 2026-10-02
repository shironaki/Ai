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

    def test_runtime_action_can_be_undone(self):
        from core.runtime_state import is_paused, set_paused
        from services.action_cancel import cancel_current_action, has_runtime_action, register_runtime_action

        user_id, chat_id = 900001, 900002
        set_paused(False, scope="global")
        register_runtime_action(
            user_id,
            chat_id,
            previous_enabled=False,
            scope="global",
        )
        set_paused(True, scope="global")
        self.assertTrue(is_paused())
        self.assertTrue(cancel_current_action(user_id, chat_id))
        self.assertFalse(is_paused())

        self.assertFalse(has_runtime_action(user_id, other_chat))


    def test_global_runtime_undo_is_not_limited_to_original_chat(self):
        from core.runtime_state import is_paused, set_paused
        from services.action_cancel import cancel_current_action, register_runtime_action

        user_id = 910001
        original_chat = 910002
        other_chat = 910003
        set_paused(False, scope="global")
        register_runtime_action(
            user_id,
            original_chat,
            previous_enabled=False,
            scope="global",
        )
        set_paused(True, scope="global")
        self.assertTrue(cancel_current_action(user_id, other_chat))
        self.assertFalse(is_paused())


if __name__ == "__main__":
    unittest.main()
