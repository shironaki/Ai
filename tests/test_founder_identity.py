import unittest
from unittest.mock import patch


class FounderIdentityPersistenceTests(unittest.TestCase):
    def test_missing_founder_is_seeded_in_legacy_registry(self):
        from base import users

        with patch.object(users.cursor, "execute", return_value=None) as execute, patch.object(users.connect, "commit") as commit:
            # The first execute is the lookup; return None means the founder row is absent.
            execute.side_effect = [None, None]
            users.ensure_owner_registered(123456789, "Founder", "founder_user")

        self.assertEqual(execute.call_count, 2)
        self.assertIn("SELECT id FROM users", execute.call_args_list[0].args[0])
        self.assertIn("INSERT INTO users", execute.call_args_list[1].args[0])
        self.assertEqual(execute.call_args_list[1].args[1][0], 123456789)
        self.assertEqual(execute.call_args_list[1].args[1][3], "Создатель бота")
        commit.assert_called_once()

    def test_existing_founder_profile_is_refreshed(self):
        from base import users

        with patch.object(users.cursor, "execute", return_value=(123456789,)) as execute, patch.object(users.connect, "commit") as commit:
            users.ensure_owner_registered(123456789, "Updated Founder", "updated_founder")

        self.assertEqual(execute.call_count, 2)
        self.assertIn("UPDATE users SET", execute.call_args_list[1].args[0])
        self.assertEqual(execute.call_args_list[1].args[1], ("Updated Founder", "updated_founder", 123456789))
        commit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
