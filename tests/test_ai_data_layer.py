import unittest
from unittest.mock import patch


class AIDataLayerTests(unittest.TestCase):
    def test_unknown_prompt_returns_no_data_context(self):
        from services.ai_data import build_verified_context

        self.assertIsNone(
            build_verified_context(1, -100, "расскажи анекдот")
        )

    def test_profile_context_uses_real_read_only_provider(self):
        from services.ai_data import build_verified_context

        with patch(
            "services.ai_data.user_summary",
            return_value={
                "id": 1,
                "name": "Test",
                "username": "tester",
                "status": "Игрок",
                "balance": 25,
                "games": 3,
                "regdata": "2026-09-30",
                "invited_users": 0,
            },
        ):
            result = build_verified_context(1, -100, "покажи мой профиль")

        self.assertIn("ПРОВЕРЕННЫЕ ДАННЫЕ ПРОФИЛЯ", result)
        self.assertIn("'balance': 25", result)
        self.assertNotIn("uptime", result.casefold())

    def test_system_context_contains_only_declared_metrics(self):
        from services.ai_data import build_verified_context

        with patch(
            "services.ai_data.system_summary",
            return_value={
                "registered_users": 3,
                "private_users": 1,
                "registered_chats": 2,
            },
        ):
            result = build_verified_context(1, -100, "покажи статистику системы", role="Основатель")

        self.assertIn("'registered_users': 3", result)
        self.assertIn("'registered_chats': 2", result)
        self.assertNotIn("1302456", result)

    def test_system_context_is_restricted_for_regular_player(self):
        from services.ai_data import build_verified_context

        with patch(
            "services.ai_data.system_summary",
            return_value={
                "registered_users": 999,
                "private_users": 999,
                "registered_chats": 999,
            },
        ) as summary:
            result = build_verified_context(
                1,
                -100,
                "покажи статистику системы",
                role="Игрок",
            )

        summary.assert_not_called()
        self.assertIn("доступ к системным счётчикам", result)
        self.assertNotIn("999", result)


if __name__ == "__main__":
    unittest.main()
