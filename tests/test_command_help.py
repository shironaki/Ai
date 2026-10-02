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


    def test_founder_system_panel_documents_termux_ha_commands(self):
        from pathlib import Path
        panel = Path("handlers/help/command_help.py").read_text(encoding="utf-8")
        self.assertIn('callback_data="panel:system:termux"', panel)
        self.assertIn("ROLE phone1 ACTIVE", panel)
        self.assertIn("ROLE phone2 STANDBY", panel)
        self.assertIn("FORCE phone1 ACTIVE", panel)
        self.assertIn("FORCE phone2 ACTIVE", panel)
