from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class CheckResult:
    name: str
    ok: bool
    detail: str = ""


def require_text(text: str, needles: Iterable[str], *, name: str) -> CheckResult:
    haystack = (text or "").casefold()
    missing = [needle for needle in needles if needle.casefold() not in haystack]
    if missing:
        return CheckResult(name, False, f"missing: {', '.join(missing)}")
    return CheckResult(name, True, "expected markers found")


def require_buttons(button_texts: Iterable[str], needles: Iterable[str], *, name: str) -> CheckResult:
    available = list(button_texts)
    haystack = " | ".join(available).casefold()
    missing = [needle for needle in needles if needle.casefold() not in haystack]
    if missing:
        return CheckResult(name, False, f"missing buttons: {', '.join(missing)}; got: {available}")
    return CheckResult(name, True, "expected buttons found")
