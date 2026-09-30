"""Typed models shared by the command pipeline."""

from dataclasses import dataclass, field
from typing import Any, Mapping, Optional


@dataclass(frozen=True)
class CommandIntent:
    command: str
    action: str = ""
    scope: str = "chat"
    target_user_id: Optional[int] = None
    parameters: Mapping[str, Any] = field(default_factory=dict)
    source: str = "text"


@dataclass(frozen=True)
class CommandDecision:
    allowed: bool
    reason: str = ""
    requires_confirmation: bool = False


@dataclass(frozen=True)
class CommandContext:
    user_id: int
    chat_id: int
    role: str
    source: str = "text"
