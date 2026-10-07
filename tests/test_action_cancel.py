import unittest


class ActionCancelTests(unittest.TestCase):
    def test_unified_cancel_clears_only_one_pending_action(self):
        from services.action_cancel import cancel_current_action
        from services.command_gateway import remember, has_pending
        from services.moderation_gateway import _PENDING

        user_id, chat_id = 1001, -2002
        remember(user_id, chat_id, {"command": "stasis"})
        _PENDING[(user_id, chat_id)] = {"action": "mute", "target": 3003}

        self.assertTrue(cancel_current_action(user_id, chat_id))
        self.assertFalse(has_pending(user_id, chat_id))
        self.assertIn((user_id, chat_id), _PENDING)
        self.assertTrue(cancel_current_action(user_id, chat_id))
        self.assertNotIn((user_id, chat_id), _PENDING)
        self.assertFalse(cancel_current_action(user_id, chat_id))

    def test_cancel_phrase_covers_last_action_wording(self):
        from services.command_gateway import is_cancel_request

        for phrase in (
            "отмени последнее действие",
            "отменить последнее действие",
            "забудь последнее действие",
        ):
            self.assertTrue(is_cancel_request(phrase), phrase)

    def test_cancel_is_idempotent_after_pending_action_is_consumed(self):
        from services.command_gateway import remember, pop_pending, cancel_pending

        user_id, chat_id = 110001, -110002
        remember(user_id, chat_id, {"command": "stasis"})
        self.assertIsNotNone(pop_pending(user_id, chat_id))
        self.assertFalse(cancel_pending(user_id, chat_id))

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



    def test_local_runtime_undo_is_limited_to_original_chat(self):
        from core.runtime_state import is_paused, set_paused
        from services.action_cancel import cancel_current_action, register_runtime_action

        user_id = 920001
        original_chat = 920002
        other_chat = 920003
        set_paused(False, scope="chat", chat_id=original_chat)
        register_runtime_action(
            user_id,
            original_chat,
            previous_enabled=False,
            scope="chat",
        )
        set_paused(True, scope="chat", chat_id=original_chat)
        self.assertFalse(cancel_current_action(user_id, other_chat))
        self.assertTrue(is_paused(original_chat))
        self.assertTrue(cancel_current_action(user_id, original_chat))
        self.assertFalse(is_paused(original_chat))

    def test_global_runtime_undo_is_not_limited_to_original_chat(self):
        from core.runtime_state import is_paused, set_paused
        from services.action_cancel import cancel_current_action, has_runtime_action, register_runtime_action

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
        self.assertFalse(has_runtime_action(user_id, other_chat))


if __name__ == "__main__":
    unittest.main()
