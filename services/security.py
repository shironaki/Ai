"""Security helpers for logging and external input handling."""

import re


_TOKEN_PATTERNS = (
    re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._-]+"),
    re.compile(r"(?i)(bot\d{6,}:[A-Za-z0-9_-]{20,})"),
    re.compile(r"(?i)(api[_-]?key\s*[=:]\s*)[^\s,;]+"),
)


def redact(text: object, limit: int = 800) -> str:
    value = str(text)
    for pattern in _TOKEN_PATTERNS:
        value = pattern.sub(lambda match: match.group(1) + "[REDACTED]", value)
    value = value.replace("\r", " ").replace("\n", " ")
    return value[:limit]
