"""Authorization and safety policy for the command pipeline."""

from core.command_models import CommandDecision, CommandIntent
from core.command_registry import resolve_command
from core.identity import role_allows



def evaluate(intent: CommandIntent, role: str, *, confirmed: bool = False) -> CommandDecision:
    spec = resolve_command(intent.command)
    if spec is None or not spec.enabled:
        return CommandDecision(False, "Команда не зарегистрирована.")

    if not role_allows(role, spec.min_role):
        return CommandDecision(False, "Недостаточно прав для этой команды.")

    if intent.scope not in {"chat", "global"}:
        return CommandDecision(False, "Область выполнения не определена.")

    if spec.scope not in {"chat", "global", "both"}:
        return CommandDecision(False, "У команды некорректная политика области.")

    if spec.scope == "chat" and intent.scope != "chat":
        return CommandDecision(False, "Эта команда разрешена только в текущем чате.")

    if spec.scope == "global" and intent.scope != "global":
        return CommandDecision(False, "Эта команда разрешена только глобально.")

    if spec.destructive and spec.confirmation and not confirmed:
        return CommandDecision(True, "Требуется подтверждение.", True)

    return CommandDecision(True)
