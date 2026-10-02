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
        self.assertIn("/status", result)
        self.assertIn("/diagnostics", result)
        self.assertIn("/battery, /charge", result)
        self.assertIn("/restart", result)


    def test_founder_system_panel_documents_termux_ha_commands(self):
        from pathlib import Path
        panel = Path("handlers/help/command_help.py").read_text(encoding="utf-8")
        self.assertIn('callback_data="panel:system:termux"', panel)
        self.assertIn("ROLE phone1 ACTIVE", panel)
        self.assertIn("ROLE phone2 STANDBY", panel)
        self.assertIn("FORCE phone1 ACTIVE", panel)
        self.assertIn("FORCE phone2 ACTIVE", panel)


    def test_panel_exposes_runtime_controls_and_stateful_back(self):
        from pathlib import Path
        panel = Path("handlers/help/command_help.py").read_text(encoding="utf-8")
        for value in (
            'callback_data="panel:system:status"',
            'callback_data="panel:system:diagnostics"',
            'callback_data="panel:system:battery"',
            'callback_data="panel:system:logs"',
            'callback_data="panel:system:debug"',
            'callback_data="panel:system:restart"',
            'callback_data="panel:back"',
            '_PANEL_HISTORY',
            '_PANEL_CURRENT',
        ):
            self.assertIn(value, panel)

    def test_panel_command_and_natural_request_are_registered(self):
        from pathlib import Path
        panel = Path("handlers/help/command_help.py").read_text(encoding="utf-8")
        self.assertIn('@dp.message_handler(commands=["panel"])', panel)
        self.assertIn("async def natural_panel_request", panel)


if __name__ == "__main__":
    unittest.main()
