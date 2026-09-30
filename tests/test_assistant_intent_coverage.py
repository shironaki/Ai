import unittest


class AssistantIntentCoverageTests(unittest.TestCase):
    def setUp(self):
        from services.assistant_actions import detect_direct_action
        self.detect = detect_direct_action

    def test_system_info_variants(self):
        for prompt in (
            "О системе расскажи",
            "Расскажи про бота",
            "Что за система?",
            "Какие возможности у бота?",
        ):
            self.assertEqual(self.detect(prompt), "system_info")

    def test_diagnostic_variants(self):
        for prompt in (
            "Сделай аи диагностику",
            "Запусти AI диагностику",
            "Покажи диагностику ИИ",
        ):
            self.assertEqual(self.detect(prompt), "ai_diagnostic")

    def test_debug_variants(self):
        for prompt in (
            "Выведи дебаг",
            "Покажи debug",
            "Запусти диагностику обработчика",
        ):
            self.assertEqual(self.detect(prompt), "debug")

    def test_logs_variants(self):
        for prompt in (
            "Выведи логи",
            "Покажи журнал бота",
            "Покажи последние логи",
        ):
            self.assertEqual(self.detect(prompt), "logs")

    def test_chat_and_profile_variants(self):
        self.assertEqual(self.detect("Покажи статистику этого мира"), "chatinfo")
        self.assertEqual(self.detect("Покажи мои показатели"), "profile")
        self.assertEqual(self.detect("Информацию обо мне"), "profile")

    def test_help_variants(self):
        self.assertEqual(self.detect("Что мне доступно?"), "help")
        self.assertEqual(self.detect("Список команд"), "help")

    def test_unrelated_prompt_is_left_to_ai(self):
        self.assertIsNone(self.detect("расскажи мне сказку"))


if __name__ == "__main__":
    unittest.main()
