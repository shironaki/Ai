import unittest


class CommandRegistryTests(unittest.TestCase):
    def test_aliases_are_unique_and_resolvable(self):
        from core.command_registry import COMMAND_REGISTRY, resolve_command

        self.assertGreater(len(COMMAND_REGISTRY), 10)
        self.assertIsNotNone(resolve_command("/стазис"))
        self.assertIsNotNone(resolve_command("профиль"))

    def test_destructive_commands_require_confirmation(self):
        from core.command_registry import COMMAND_REGISTRY

        for spec in COMMAND_REGISTRY:
            if spec.destructive:
                self.assertTrue(spec.confirmation, spec.key)

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


if __name__ == "__main__":
    unittest.main()
