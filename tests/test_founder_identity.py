import unittest
from unittest.mock import MagicMock


class FounderIdentityPersistenceTests(unittest.TestCase):
    def test_missing_founder_is_seeded_in_legacy_registry(self):
        from base import users

        real_cursor, real_connect = users.cursor, users.connect
        cursor = MagicMock()
        connect = MagicMock()
        cursor.execute.side_effect = [
            MagicMock(fetchone=MagicMock(return_value=None)),
            MagicMock(fetchone=MagicMock(return_value=None)),
        ]
        users.cursor, users.connect = cursor, connect
        try:
            users.ensure_owner_registered(123456789, "Founder", "founder_user")
        finally:
            users.cursor, users.connect = real_cursor, real_connect

        self.assertEqual(cursor.execute.call_count, 2)
        self.assertIn("SELECT id FROM users", cursor.execute.call_args_list[0].args[0])
        self.assertIn("INSERT INTO users", cursor.execute.call_args_list[1].args[0])
        self.assertEqual(cursor.execute.call_args_list[1].args[1][0], 123456789)
        self.assertEqual(cursor.execute.call_args_list[1].args[1][3], "Создатель бота")
        connect.commit.assert_called_once()

    def test_existing_founder_profile_is_refreshed(self):
        from base import users

        real_cursor, real_connect = users.cursor, users.connect
        cursor = MagicMock()
        connect = MagicMock()
        cursor.execute.side_effect = [
            MagicMock(fetchone=MagicMock(return_value=(123456789,))),
            MagicMock(fetchone=MagicMock(return_value=None)),
        ]
        users.cursor, users.connect = cursor, connect
        try:
            users.ensure_owner_registered(123456789, "Updated Founder", "updated_founder")
        finally:
            users.cursor, users.connect = real_cursor, real_connect

        self.assertEqual(cursor.execute.call_count, 2)
        self.assertIn("UPDATE users SET", cursor.execute.call_args_list[1].args[0])
        self.assertEqual(cursor.execute.call_args_list[1].args[1], ("Updated Founder", "updated_founder", 123456789))
        connect.commit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
