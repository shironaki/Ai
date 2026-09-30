import unittest


class CommandHelpTests(unittest.TestCase):
    def test_help_is_generated_from_registry(self):
        from core.command_help import render_help

        result = render_help("Игрок")
        self.assertIn("/help", result)
        self.assertIn("/ai", result)
        self.assertNotIn("/settings", result)
        self.assertNotIn("/invite", result)
        self.assertNotIn("/logout", result)


if __name__ == "__main__":
    unittest.main()
