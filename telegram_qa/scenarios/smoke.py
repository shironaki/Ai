from __future__ import annotations

from dataclasses import dataclass, field

from telegram_qa.assertions import CheckResult, require_buttons, require_text
from telegram_qa.client import TelegramQAClient, button_texts


@dataclass
class SmokeReport:
    checks: list[CheckResult] = field(default_factory=list)

    @property
    def failed(self) -> list[CheckResult]:
        return [check for check in self.checks if not check.ok]


async def run_smoke(client: TelegramQAClient) -> SmokeReport:
    report = SmokeReport()

    message = await client.send_and_wait("/start")
    report.checks.append(CheckResult("start reply received", bool(message.raw_text), "empty response" if not message.raw_text else ""))

    message = await client.send_and_wait("/help")
    report.checks.append(require_text(message.raw_text, ("help",), name="help reply"))

    message = await client.send_and_wait("покажи мой профиль")
    report.checks.append(require_text(message.raw_text, ("профиль",), name="natural profile routing"))

    message = await client.send_and_wait("/panel")
    texts = button_texts(message)
    report.checks.append(CheckResult("panel reply received", bool(message.raw_text), "empty response" if not message.raw_text else ""))
    report.checks.append(CheckResult("panel has inline controls", bool(texts), "panel returned no inline buttons" if not texts else f"buttons: {texts}"))

    return report
