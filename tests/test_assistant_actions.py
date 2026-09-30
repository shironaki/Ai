import unittest


class AssistantActionTests(unittest.TestCase):
    def test_profile_word_order_is_supported(self):
        from services.assistant_actions import detect_direct_action

        self.assertEqual(detect_direct_action("Профиль мой мне покажи"), "profile")

    def test_profile_statistics_is_supported(self):
        from services.assistant_actions import detect_direct_action

        self.assertEqual(detect_direct_action("Покажи мою статистику"), "profile")

    def test_chat_statistics_is_supported(self):
        from services.assistant_actions import detect_direct_action

        self.assertEqual(
            detect_direct_action("Покажи статистику этого чата"),
            "chatinfo",
        )

    def test_system_statistics_is_supported(self):
        from services.assistant_actions import detect_direct_action

        self.assertEqual(
            detect_direct_action("Выдай мне информацию о системе"),
            "system_stats",
        )

    def test_debug_and_ai_diagnostic_are_direct_actions(self):
        from services.assistant_actions import detect_direct_action

        self.assertEqual(detect_direct_action("Выведи мне дебаг"), "debug")
        self.assertEqual(
            detect_direct_action("Выведи мне аи диагностику"),
            "ai_diagnostic",
        )

    def test_help_is_direct_action(self):
        from services.assistant_actions import detect_direct_action

        self.assertEqual(
            detect_direct_action("Покажи доступные мне команды"),
            "help",
        )

    def test_settings_are_reported_as_unsupported(self):
        from services.assistant_actions import detect_direct_action

        self.assertEqual(
            detect_direct_action("Есть ли у тебя /settings?"),
            "unsupported_settings",
        )

    def test_unrelated_prompt_is_not_routed(self):
        from services.assistant_actions import detect_direct_action

        self.assertIsNone(detect_direct_action("расскажи анекдот"))


if __name__ == "__main__":
    unittest.main()
