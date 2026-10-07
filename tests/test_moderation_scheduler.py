import unittest
from datetime import datetime, timezone, timedelta
from contextlib import contextmanager
from unittest.mock import AsyncMock, patch


class ModerationSchedulerTests(unittest.IsolatedAsyncioTestCase):
    async def test_expiry_notification_retries_when_group_delivery_fails(self):
        import sqlite3
        from services.moderation_scheduler import _notify_expired

        db = sqlite3.connect(":memory:")

        @contextmanager
        def connect(_filename):
            yield db

        row = (1, 100, 7, "user", 2, "mute", (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(), 0)
        db.execute("CREATE TABLE moderation_timers(id INTEGER PRIMARY KEY, notified INTEGER)")
        db.execute("INSERT INTO moderation_timers(id, notified) VALUES(1, 0)")

        bot = AsyncMock()
        bot.send_message.side_effect = RuntimeError("telegram unavailable")

        with patch("services.moderation_scheduler.connect_db", connect):
            delivered = await _notify_expired(bot, row)

        self.assertFalse(delivered)
        self.assertEqual(db.execute("SELECT notified FROM moderation_timers WHERE id=1").fetchone()[0], 0)
        db.close()

    async def test_private_delivery_failure_does_not_block_group_ack(self):
        import sqlite3
        from services.moderation_scheduler import _notify_expired

        db = sqlite3.connect(":memory:")

        @contextmanager
        def connect(_filename):
            yield db

        row = (1, 100, 7, "user", 2, "mute", (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(), 0)
        db.execute("CREATE TABLE moderation_timers(id INTEGER PRIMARY KEY, notified INTEGER)")
        db.execute("INSERT INTO moderation_timers(id, notified) VALUES(1, 0)")

        bot = AsyncMock()
        bot.send_message.side_effect = [None, RuntimeError("private unavailable")]

        with patch("services.moderation_scheduler.connect_db", connect):
            delivered = await _notify_expired(bot, row)

        self.assertTrue(delivered)
        self.assertEqual(db.execute("SELECT notified FROM moderation_timers WHERE id=1").fetchone()[0], 1)
        self.assertEqual(bot.send_message.await_count, 2)
        db.close()


if __name__ == "__main__":
    unittest.main()
