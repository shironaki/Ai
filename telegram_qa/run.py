from __future__ import annotations

import argparse
import asyncio

from telegram_qa.client import QAConfig, TelegramQAClient
from telegram_qa.scenarios.smoke import run_smoke


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run live Telegram QA against the configured bot.")
    parser.add_argument("scenario", choices=("smoke",), help="scenario to execute")
    return parser.parse_args()


async def main() -> int:
    args = parse_args()
    config = QAConfig.from_env()
    client = TelegramQAClient(config)
    await client.start()
    try:
        report = await run_smoke(client)
    finally:
        await client.stop()

    for check in report.checks:
        state = "PASS" if check.ok else "FAIL"
        suffix = f" — {check.detail}" if check.detail else ""
        print(f"[{state}] {check.name}{suffix}")

    print(f"TOTAL={len(report.checks)} FAILED={len(report.failed)}")
    return 1 if report.failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
