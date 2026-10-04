import asyncio
import os
import unittest


class AIMemoryRegressionTests(unittest.TestCase):
    def test_ai_memory_isolated_by_user_and_chat_and_can_be_erased(self):
        from services.ai_memory import append_history, clear_history, load_history

        user_a, user_b = 99100101, 99100102
        chat_a, chat_b = -99100101, -99100102
        clear_history(user_a, chat_a)
        clear_history(user_a, chat_b)
        clear_history(user_b, chat_a)
        try:
            append_history(
                user_a,
                chat_a,
                [
                    {"role": "user", "content": "секретный диалог A"},
                    {"role": "assistant", "content": "ответ A"},
                ],
            )
            append_history(
                user_a,
                chat_b,
                [{"role": "user", "content": "диалог B"}],
            )
            append_history(
                user_b,
                chat_a,
                [{"role": "user", "content": "чужой пользователь"}],
            )

            self.assertEqual(
                [row["content"] for row in load_history(user_a, chat_a)],
                ["секретный диалог A", "ответ A"],
            )
            self.assertEqual(
                [row["content"] for row in load_history(user_a, chat_b)],
                ["диалог B"],
            )
            self.assertNotIn(
                "чужой пользователь",
                str(load_history(user_a, chat_a)),
            )

            removed = clear_history(user_a, chat_a)
            self.assertEqual(removed, 2)
            self.assertEqual(load_history(user_a, chat_a), [])
            self.assertEqual(
                [row["content"] for row in load_history(user_a, chat_b)],
                ["диалог B"],
            )
        finally:
            clear_history(user_a, chat_a)
            clear_history(user_a, chat_b)
            clear_history(user_b, chat_a)

    def test_ai_memory_redacts_credentials_before_storage(self):
        from services.ai_memory import append_history, clear_history, load_history

        user_id, chat_id = 99100103, -99100103
        clear_history(user_id, chat_id)
        try:
            append_history(
                user_id,
                chat_id,
                [{"role": "user", "content": "key ghp_abcdefghijklmnopqrstuvwxyz123456"}],
            )
            stored = load_history(user_id, chat_id)
            self.assertEqual(len(stored), 1)
            self.assertNotIn("ghp_abcdefghijklmnopqrstuvwxyz123456", stored[0]["content"])
            self.assertIn("[REDACTED]", stored[0]["content"])
        finally:
            clear_history(user_id, chat_id)

    def test_ai_service_loads_persistent_history_for_chat_scope(self):
        import services.ai_service as ai_service
        from services.ai_memory import append_history, clear_history

        user_id, chat_id = 99100104, -99100104
        old_key = os.environ.get("GROQ_API_KEY")
        old_request = ai_service._request_sync
        old_history = dict(ai_service._HISTORY)
        old_last_request = dict(ai_service._LAST_REQUEST)
        try:
            clear_history(user_id, chat_id)
            append_history(
                user_id,
                chat_id,
                [
                    {"role": "user", "content": "предыдущий вопрос"},
                    {"role": "assistant", "content": "предыдущий ответ"},
                ],
            )
            os.environ["GROQ_API_KEY"] = "test-key"
            ai_service._HISTORY.pop((user_id, chat_id), None)
            ai_service._LAST_REQUEST.clear()

            captured = []

            def successful_request(messages, model, api_key, **kwargs):
                captured.append(messages)
                return "новый ответ"

            ai_service._request_sync = successful_request
            result = asyncio.run(
                ai_service.generate_reply(
                    user_id,
                    "новый вопрос",
                    chat_id=chat_id,
                )
            )
            self.assertEqual(result, "новый ответ")
            serialized = str(captured[0])
            self.assertIn("предыдущий вопрос", serialized)
            self.assertIn("предыдущий ответ", serialized)
            self.assertIn("новый вопрос", serialized)
        finally:
            clear_history(user_id, chat_id)
            ai_service._request_sync = old_request
            ai_service._HISTORY.clear()
            ai_service._HISTORY.update(old_history)
            ai_service._LAST_REQUEST.clear()
            ai_service._LAST_REQUEST.update(old_last_request)
            if old_key is None:
                os.environ.pop("GROQ_API_KEY", None)
            else:
                os.environ["GROQ_API_KEY"] = old_key
