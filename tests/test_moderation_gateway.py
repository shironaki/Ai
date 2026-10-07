import unittest


class ModerationGatewayTests(unittest.TestCase):
    def test_action_detection_prefers_unban_over_ban(self):
        from services.moderation_gateway import detect_action

        self.assertEqual(detect_action("разбань его"), "unban")
        self.assertEqual(detect_action("размуть его"), "unmute")

    def test_action_detection_handles_natural_language(self):
        from services.moderation_gateway import detect_action

        self.assertEqual(detect_action("заблокируй его"), "ban")
        self.assertEqual(detect_action("замуть его"), "mute")

    def test_unknown_request_is_not_moderation(self):
        from services.moderation_gateway import detect_action

        self.assertIsNone(detect_action("покажи профиль"))

    def test_duration_parser(self):
        from services.moderation_gateway import _parse_duration

        self.assertEqual(_parse_duration("замуть его на 30 минут"), (30, "минут"))
        self.assertEqual(_parse_duration("заблокируй его на 2 дня"), (2, "дней"))
        self.assertIsNone(_parse_duration("замуть его"))

    def test_moderation_timers_are_superseded_for_same_target(self):
        import sqlite3
        from contextlib import contextmanager
        from unittest.mock import patch
        from services.moderation_scheduler import supersede_timers

        db = sqlite3.connect(":memory:")

        @contextmanager
        def connect(_filename):
            yield db

        with patch("services.moderation_scheduler.connect_db", connect):
            db.execute("CREATE TABLE moderation_timers(id INTEGER PRIMARY KEY, chat_id INTEGER, target_user_id INTEGER, notified INTEGER)")
            db.executemany(
                "INSERT INTO moderation_timers(id,chat_id,target_user_id,notified) VALUES(?,?,?,?)",
                [(1, 100, 7, 0), (2, 100, 8, 0), (3, 200, 7, 0)],
            )
            supersede_timers(chat_id=100, target_user_id=7)
            rows = db.execute("SELECT id,notified FROM moderation_timers ORDER BY id").fetchall()
        self.assertEqual(rows, [(1, 1), (2, 0), (3, 0)])
        db.close()

    def test_founder_path_seeds_pending_intent_before_shared_confirm(self):
        from pathlib import Path

        source = (Path(__file__).resolve().parents[1] / "services" / "moderation_gateway.py").read_text(encoding="utf-8")
        founder_branch = source.split("if message.from_user.id == config.owner or role == \"Создатель бота\":", 1)[1]
        self.assertLess(
            founder_branch.index("remember(message.from_user.id, message.chat.id, intent)"),
            founder_branch.index("return await confirm(message, confirmed=True)"),
        )

if __name__ == "__main__":
    unittest.main()
