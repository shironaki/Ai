from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from pathlib import Path

from telethon import TelegramClient
from telethon.tl.custom.message import Message


@dataclass(frozen=True)
class QAConfig:
    api_id: int
    api_hash: str
    session: str
    target: str

    @classmethod
    def from_env(cls) -> "QAConfig":
        api_id = os.getenv("TELEGRAM_API_ID")
        api_hash = os.getenv("TELEGRAM_API_HASH")
        session = os.getenv("TELEGRAM_QA_SESSION", "telegram_qa/session")
        target = os.getenv("TELEGRAM_QA_TARGET")
        missing = [name for name, value in (("TELEGRAM_API_ID", api_id), ("TELEGRAM_API_HASH", api_hash), ("TELEGRAM_QA_TARGET", target)) if not value]
        if missing:
            raise RuntimeError("Missing environment variables: " + ", ".join(missing))
        return cls(int(api_id), api_hash, session, target)


def button_texts(message: Message) -> list[str]:
    result: list[str] = []
    for row in message.buttons or []:
        for button in row:
            text = getattr(button, "text", None)
            if text:
                result.append(text)
    return result


class TelegramQAClient:
    def __init__(self, config: QAConfig):
        Path(config.session).parent.mkdir(parents=True, exist_ok=True)
        self.config = config
        self.client = TelegramClient(config.session, config.api_id, config.api_hash)

    async def start(self) -> None:
        await self.client.start()
        if not await self.client.is_user_authorized():
            raise RuntimeError("QA Telegram session is not authorized")

    async def stop(self) -> None:
        await self.client.disconnect()

    async def send(self, text: str) -> Message:
        return await self.client.send_message(self.config.target, text)

    async def wait_for_reply(self, *, after_id: int, timeout: float = 15.0) -> Message:
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            messages = await self.client.get_messages(self.config.target, limit=10)
            for message in reversed(messages):
                if message.id > after_id and not message.out:
                    return message
            if asyncio.get_running_loop().time() >= deadline:
                raise TimeoutError(f"No incoming bot reply after message {after_id}")
            await asyncio.sleep(0.5)

    async def send_and_wait(self, text: str, *, timeout: float = 15.0) -> Message:
        sent = await self.send(text)
        return await self.wait_for_reply(after_id=sent.id, timeout=timeout)

    async def click(self, message: Message, row: int, column: int) -> Message:
        before_id = message.id
        result = await message.click(row=row, column=column)
        if isinstance(result, Message):
            return result
        deadline = asyncio.get_running_loop().time() + 10.0
        while asyncio.get_running_loop().time() < deadline:
            messages = await self.client.get_messages(self.config.target, limit=5)
            for candidate in messages:
                if candidate.id >= before_id and not candidate.out:
                    return candidate
            await asyncio.sleep(0.5)
        raise RuntimeError("Callback click produced no observable incoming bot message")
