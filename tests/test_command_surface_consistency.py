import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _decorated_commands(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    commands = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call):
                continue
            name = decorator.func
            if not isinstance(name, ast.Attribute) or name.attr != "message_handler":
                continue
            for keyword in decorator.keywords:
                if keyword.arg != "commands" or not isinstance(keyword.value, (ast.List, ast.Tuple, ast.Set)):
                    continue
                for value in keyword.value.elts:
                    if isinstance(value, ast.Constant) and isinstance(value.value, str):
                        commands.add(value.value.casefold())
    return commands


def test_registered_slash_aliases_have_authoritative_handlers():
    from core.command_registry import COMMAND_REGISTRY

    handlers = set()
    for relative in (
        "main.py",
        "handlers/help/help.py",
        "handlers/help/command_help.py",
        "handlers/admin/apanel.py",
    ):
        handlers.update(_decorated_commands(ROOT / relative))

    # These are intentionally routed by non-command filters rather than a
    # commands=[...] decorator, or are panel/natural-language-only surfaces.
    routed_without_command_decorator = {
        "ai", "help", "panel", "report", "cancel", "info",
        "moderation", "silence", "issue_list",
    }

    missing = []
    for spec in COMMAND_REGISTRY:
        for alias in spec.aliases:
            normalized = alias.casefold().strip()
            if " " in normalized or normalized in routed_without_command_decorator:
                continue
            if normalized not in handlers:
                missing.append(f"{spec.key}:{alias}")

    assert not missing, "registry aliases without handlers: " + ", ".join(sorted(missing))


def test_info_and_report_compatibility_aliases_are_explicitly_registered():
    from core.command_registry import resolve_command

    assert resolve_command("/info") is not None
    assert resolve_command("/инфа") is not None
    assert resolve_command("/q") is not None
    assert resolve_command("/r") is not None
    assert resolve_command("/issues") is not None
    assert resolve_command("/метки") is not None


def test_privileged_commands_never_enter_the_public_telegram_menu():
    source = (ROOT / "main.py").read_text(encoding="utf-8")
    start = source.index("BOT_COMMANDS = [")
    end = source.index("]\n\n\nasync def on_startup", start) + 1
    public_menu = source[start:end]
    for command in ("status", "diagnostics", "aidiag", "debug", "stasis", "awakening", "restart", "logs"):
        assert f'BotCommand("{command}"' not in public_menu
