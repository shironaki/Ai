"""Authorization and safety policy for the command pipeline."""

from core.command_models import CommandDecision, CommandIntent
from core.command_registry import resolve_command


_ROLE_ORDER = {
    "Игрок": 10,
    "Модератор": 20,
    "Хелпер": 30,
    "Администратор": 40,
    "Создатель бота": 50,
    "Система": 60,
}


def _role_allows(actual: str, required: str) -> bool:
    return _ROLE_ORDER.get(actual, 0) >= _ROLE_ORDER.get(required, 0)


def evaluate(intent: CommandIntent, role: str, *, confirmed: bool = False) -> CommandDecision:
    spec = resolve_command(intent.command)
    if spec is None or not spec.enabled:
        return CommandDecision(False, "Команда не зарегистрирована.")

    if not _role_allows(role, spec.min_role):
        return CommandDecision(False, "Недостаточно прав для этой команды.")

    if intent.scope not in {"chat", "global"}:
        return CommandDecision(False, "Область выполнения не определена.")

    if intent.scope == "global" and spec.scope != "global" and role != "Создатель бота":
        return CommandDecision(False, "Эта команда не разрешена вне текущего чата.")

    if spec.destructive and spec.confirmation and not confirmed:
        return CommandDecision(True, "Требуется подтверждение.", True)

    return CommandDecision(True)
