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

    def test_system_info_is_direct_action(self):
        from services.assistant_actions import detect_direct_action

        self.assertEqual(
            detect_direct_action("О системе расскажи"),
            "system_info",
        )
        self.assertEqual(
            detect_direct_action("Выдай информацию о системе"),
            "system_stats",
        )

    def test_logs_are_direct_action(self):
        from services.assistant_actions import detect_direct_action

        self.assertEqual(detect_direct_action("Выведи логи"), "logs")
        self.assertEqual(detect_direct_action("Покажи журнал"), "logs")

    def test_ai_diagnostic_variants_are_direct_action(self):
        from services.assistant_actions import detect_direct_action

        self.assertEqual(
            detect_direct_action("Сделай аи диагностику"),
            "ai_diagnostic",
        )
        self.assertEqual(
            detect_direct_action("Выведи аи диагностику"),
            "ai_diagnostic",
        )

    def test_broader_natural_phrasing_is_supported(self):
        from services.assistant_actions import detect_direct_action

        self.assertEqual(detect_direct_action("Покажи лог"), "logs")
        self.assertEqual(detect_direct_action("Расскажи о системе"), "system_info")
        self.assertEqual(detect_direct_action("Покажи информацию обо мне"), "profile")
        self.assertEqual(detect_direct_action("Статистика текущего чата"), "chatinfo")
        self.assertEqual(detect_direct_action("Покажи диагностику ИИ"), "ai_diagnostic")
        self.assertEqual(detect_direct_action("Покажи отладку"), "debug")

    def test_stasis_status_is_read_only(self):
        from services.assistant_actions import detect_direct_action

        self.assertEqual(detect_direct_action("Активен ли сейчас стазис?"), "runtime")
        self.assertEqual(detect_direct_action("Какой сейчас статус стазиса?"), "runtime")

    def test_unrelated_prompt_is_not_routed(self):
        from services.assistant_actions import detect_direct_action

        self.assertIsNone(detect_direct_action("расскажи анекдот"))


if __name__ == "__main__":
    unittest.main()
