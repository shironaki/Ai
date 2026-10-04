import ast
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


def _command_declarations(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found = {}
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        commands = set()
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call):
                continue
            func = decorator.func
            if not isinstance(func, ast.Attribute) or func.attr != "message_handler":
                continue
            for kw in decorator.keywords:
                if kw.arg != "commands":
                    continue
                if isinstance(kw.value, (ast.List, ast.Tuple, ast.Set)):
                    for item in kw.value.elts:
                        if isinstance(item, ast.Constant) and isinstance(item.value, str):
                            commands.add(item.value.casefold())
        for command in commands:
            found.setdefault(command, []).append(node)
    return found


class PrivilegedCommandRoutingTests(unittest.TestCase):
    PRIVILEGED = {"status", "diagnostics", "aidiag", "debug", "stasis"}

    def test_every_privileged_registry_command_has_a_concrete_handler(self):
        from core.command_registry import COMMAND_REGISTRY

        declarations = {}
        for path in (
            ROOT / "main.py",
            ROOT / "handlers" / "help" / "help.py",
            ROOT / "handlers" / "runtime_diagnostics.py",
        ):
            declarations.update({
                key: value
                for key, value in _command_declarations(path).items()
            })

        for spec in COMMAND_REGISTRY:
            if spec.key not in self.PRIVILEGED:
                continue
            for alias in spec.aliases:
                self.assertIn(
                    alias.casefold(),
                    declarations,
                    f"{spec.key}: /{alias} has registry metadata but no concrete handler",
                )

    def test_privileged_handlers_have_explicit_founder_denial(self):
        checks = {
            "main.py": {"debug": "_founder_command_guard", "stasis": "_founder_command_guard"},
            "handlers/help/help.py": {"aidiag": "Команда доступна только Основателю"},
            "handlers/runtime_diagnostics.py": {
                "status": "_founder_guard",
                "diagnostics": "_founder_guard",
            },
        }
        for relative, command_checks in checks.items():
            declarations = _command_declarations(ROOT / relative)
            source = (ROOT / relative).read_text(encoding="utf-8")
            for command, marker in command_checks.items():
                nodes = declarations.get(command, [])
                self.assertTrue(nodes, f"/{command} handler missing")
                body = "\n".join(
                    ast.get_source_segment(source, node) or "" for node in nodes
                )
                self.assertIn(marker, body, f"/{command} lacks explicit denial guard")

    def test_natural_language_aliases_use_the_same_privileged_actions(self):
        from services.assistant_actions import detect_direct_action

        self.assertEqual(detect_direct_action("статус бота"), "status")
        self.assertEqual(detect_direct_action("диагностика системы"), "diagnostics")
        self.assertEqual(detect_direct_action("/status"), "status")
        self.assertEqual(detect_direct_action("/diagnostics"), "diagnostics")

    def test_policy_denies_all_five_to_an_ordinary_user(self):
        from core.command_models import CommandIntent
        from core.command_policy import evaluate

        for command in sorted(self.PRIVILEGED):
            decision = evaluate(CommandIntent(command, scope="global"), "Пользователь")
            self.assertFalse(decision.allowed, command)
            self.assertIn("прав", decision.reason)

    def test_global_scope_is_required_for_status_and_diagnostics(self):
        from core.command_models import CommandIntent
        from core.command_policy import evaluate

        for command in ("status", "diagnostics", "debug"):
            decision = evaluate(CommandIntent(command, scope="chat"), "Создатель бота")
            self.assertFalse(decision.allowed, command)
            self.assertIn("глобально", decision.reason)

    def test_group_and_private_are_both_real_handler_surfaces(self):
        # The handlers intentionally do not hard-code a chat type. Founder-only
        # global diagnostics can be invoked from either Telegram surface.
        declarations = _command_declarations(ROOT / "handlers" / "runtime_diagnostics.py")
        self.assertIn("status", declarations)
        self.assertIn("diagnostics", declarations)


if __name__ == "__main__":
    unittest.main()
