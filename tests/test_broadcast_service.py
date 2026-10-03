import asyncio
import unittest
from unittest.mock import AsyncMock


class TestBroadcastService(unittest.TestCase):
    def test_broadcast_deduplicates_recipients_and_counts_failures(self):
        from services.broadcast_service import broadcast_message
        from base import config

        message = type("Message", (), {})()
        calls = []

        async def copy_to(recipient_id):
            calls.append(recipient_id)
            if recipient_id == 3:
                raise RuntimeError("delivery failed")

        message.copy_to = copy_to

        sent, failed = asyncio.run(
            broadcast_message(message, [1, 2, 2, 3, 1], actor_id=config.owner, delay=0)
        )

        self.assertEqual(calls, [1, 2, 3])
        self.assertEqual(sent, 2)
        self.assertEqual(failed, 1)


if __name__ == "__main__":
    unittest.main()
