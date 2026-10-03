"""Security helpers for logging and external input handling."""

import re


_TOKEN_PATTERNS = (
    re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._-]+"),
    re.compile(r"(?i)(bot\d{6,}:)[A-Za-z0-9_-]{20,}"),
    re.compile(r"(?i)(api[_-]?key\s*[=:]\s*)[^\s,;]+"),
    re.compile(r"(?i)(gsk_)[A-Za-z0-9_-]+"),
    re.compile(r"(?i)(sk-)[A-Za-z0-9_-]+"),
    re.compile(r"(?i)(xox[baprs]-)[A-Za-z0-9-]+"),
    re.compile(r"(?i)((?:ghp|gho|ghu|ghs|github_pat|glpat)-)[A-Za-z0-9_-]+"),
)


def redact(text: object, limit: int = 800) -> str:
    """Remove common credential forms before data reaches logs/diagnostics."""
    value = str(text)
    for pattern in _TOKEN_PATTERNS:
        value = pattern.sub(lambda match: match.group(1) + "[REDACTED]", value)
    value = value.replace("\r", " ").replace("\n", " ")
    return value[:limit]


def redact_exception(exc: BaseException, limit: int = 1200) -> str:
    """Return a bounded, credential-redacted exception summary."""
    return redact(f"{type(exc).__name__}: {exc}", limit=limit)


class RedactingFormatter(__import__("logging").Formatter):
    """Logging formatter that redacts credentials from messages and tracebacks."""

    def format(self, record):
        return redact(super().format(record), 12000)
