import unittest


class CommandRegistryTests(unittest.TestCase):
    def test_aliases_are_unique_and_resolvable(self):
        from core.command_registry import COMMAND_REGISTRY, resolve_command

        self.assertGreater(len(COMMAND_REGISTRY), 10)
        self.assertIsNotNone(resolve_command("/стазис"))
        self.assertIsNotNone(resolve_command("инфа"))
        self.assertIsNone(resolve_command("профиль"))

    def test_destructive_commands_require_confirmation(self):
        from core.command_registry import COMMAND_REGISTRY

        for spec in COMMAND_REGISTRY:
            if spec.destructive:
                self.assertTrue(spec.confirmation, spec.key)


    def test_cancel_is_staff_surface_only(self):
        from core.command_registry import command_catalog
        self.assertNotIn("/cancel", command_catalog("Пользователь"))
        self.assertIn("/cancel", command_catalog("Модератор"))

    def test_founder_catalog_is_grounded_in_registry(self):
        from core.command_registry import command_catalog

        catalog = command_catalog("Основатель")
        self.assertIn("/start", catalog)
        self.assertIn("/stasis", catalog)
        self.assertIn("/awakening", catalog)
        self.assertNotIn("/settings", catalog)
        self.assertNotIn("/invite", catalog)
        self.assertNotIn("/logout", catalog)
        self.assertNotIn("/stats", catalog)
        self.assertNotIn("/settings", catalog)

    def test_legacy_game_commands_are_not_registered(self):
        from core.command_registry import resolve_command, is_legacy_game_alias

        for command in (
            "слоты", "казино", "куб", "дартс", "боул", "фут",
            "бас", "баскет", "охота",
        ):
            self.assertTrue(is_legacy_game_alias(command))
            self.assertIsNone(resolve_command(command))

    def test_game_economy_commands_are_not_in_core_registry(self):
        from core.command_registry import resolve_command

        for command in ("пополнить счет", "снять со счета", "setstavka", "setdick"):
            self.assertIsNone(resolve_command(command))

    def test_role_matrix_has_expected_boundaries(self):
        from core.command_registry import command_catalog

        user = command_catalog("Пользователь")
        moderator = command_catalog("Модератор")
        admin = command_catalog("Администратор")
        helper = command_catalog("Хелпер")
        founder = command_catalog("Создатель бота")

        for value in ("/panel", "/cancel", "/mute", "/ban", "/setstatus", "/status", "/diagnostics", "/reports"):
            self.assertNotIn(value, user, value)

        for value in ("/panel", "/cancel", "/mute", "/ban"):
            self.assertIn(value, moderator, value)
        self.assertIn("/setstatus", moderator)
        self.assertNotIn("/status", moderator)

        self.assertIn("/panel", admin)
        self.assertIn("/setstatus", admin)
        self.assertNotIn("/mute", helper)
        self.assertIn("/reports", helper)
        self.assertNotIn("/panel", helper)

        self.assertIn("/setstatus", founder)
        self.assertIn("/status", founder)
        self.assertIn("/diagnostics", founder)
        self.assertIn("/setstatus", founder)

    def test_scope_matrix_rejects_privileged_commands_in_wrong_scope(self):
        from core.command_models import CommandIntent
        from core.command_policy import evaluate

        denied = evaluate(CommandIntent("status", scope="chat"), "Создатель бота")
        self.assertFalse(denied.allowed)
        self.assertIn("глобально", denied.reason)

        denied = evaluate(CommandIntent("start", scope="chat"), "Пользователь")
        self.assertFalse(denied.allowed)
        self.assertIn("личном чате", denied.reason)

        allowed = evaluate(CommandIntent("setstatus", scope="chat"), "Администратор")
        self.assertTrue(allowed.allowed)


if __name__ == "__main__":
    unittest.main()
