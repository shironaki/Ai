import ast
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


def _handler_command_literals(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call):
                continue
            name = decorator.func.attr if isinstance(decorator.func, ast.Attribute) else ""
            if name != "message_handler":
                continue
            for keyword in decorator.keywords:
                if keyword.arg != "commands":
                    continue
                if isinstance(keyword.value, (ast.List, ast.Tuple, ast.Set)):
                    values = {
                        elt.value.casefold()
                        for elt in keyword.value.elts
                        if isinstance(elt, ast.Constant) and isinstance(elt.value, str)
                    }
                    found.append((node.name, values))
    return found


class DispatchRegressionTests(unittest.TestCase):
    def test_help_command_has_single_authoritative_handler(self):
        handlers = []
        for path in (
            ROOT / "main.py",
            ROOT / "handlers" / "help" / "help.py",
            ROOT / "handlers" / "help" / "command_help.py",
            ROOT / "aboute.py",
        ):
            if path.exists():
                for name, commands in _handler_command_literals(path):
                    if {"help", "хелп", "команды"} & commands:
                        handlers.append((path.relative_to(ROOT).as_posix(), name, commands))
        self.assertEqual(len(handlers), 1, handlers)
        self.assertEqual(handlers[0][0], "handlers/help/command_help.py")

    def test_legacy_slash_moderation_routes_through_unified_gateway(self):
        source = (ROOT / "handlers" / "admin" / "apanel.py").read_text(encoding="utf-8")
        self.assertIn("from services.moderation_gateway import request as request_moderation", source)
        for function_name in ("mute", "unmute", "ban", "unban"):
            start = source.index("async def " + function_name + "(")
            end = source.find("\n# ", start)
            block = source[start:] if end == -1 else source[start:end]
            self.assertIn("request_moderation(message, message.text.strip())", block)
        self.assertNotIn("restrict_chat_member(", source)
        self.assertNotIn("ban_chat_member(", source)
        self.assertNotIn("unban_chat_member(", source)

    def test_panel_callbacks_are_registered_and_callback_errors_are_visible(self):
        help_source = (ROOT / "handlers" / "help" / "command_help.py").read_text(encoding="utf-8")
        main_source = (ROOT / "main.py").read_text(encoding="utf-8")
        self.assertIn('callback_data="panel:root"', help_source)
        self.assertIn('lambda c: c.data == "panel:root"', help_source)
        self.assertIn("async def unhandled_callback", help_source)
        self.assertIn('elif callback_query:', main_source)
        self.assertIn('stage="callback_exception"', main_source)

    def test_legacy_broadcast_routes_are_removed_and_panel_route_is_authoritative(self):
        self.assertFalse((ROOT / "aboute.py").exists())
        help_source = (ROOT / "handlers" / "help" / "command_help.py").read_text(encoding="utf-8")
        self.assertIn('panel:system:broadcast', help_source)
        self.assertIn('from services.broadcast_service import broadcast_message', help_source)



if __name__ == "__main__":
    unittest.main()
