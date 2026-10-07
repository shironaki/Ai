import sqlite3
import unittest
from contextlib import contextmanager
from unittest.mock import patch


class ChatRoleIsolationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row

        @contextmanager
        def connect(_filename):
            yield self.db

        self.connect_patch = patch("services.chat_roles.connect_db", connect)
        self.connect_patch.start()

    def tearDown(self):
        self.connect_patch.stop()
        self.db.close()

    def test_same_user_can_have_different_local_moderator_roles_per_chat(self):
        from services.chat_roles import set_role, get_role

        with patch("core.identity.is_owner", return_value=False), patch(
            "core.permissions.get_display_role", return_value="Администратор"
        ), patch("base.config.owner", 999999):
            self.assertTrue(set_role(100, 7, "Модератор", 1))
            self.assertTrue(set_role(200, 7, "Модератор", 1))

        self.assertEqual(get_role(100, 7), "Модератор")
        self.assertEqual(get_role(200, 7), "Модератор")
        self.assertIsNone(get_role(300, 7))

    def test_global_helper_can_manage_roles_when_also_chat_creator(self):
        from services.chat_roles import set_role, get_role

        with patch("core.identity.is_owner", return_value=False), patch(
            "core.identity.resolve_role", return_value="Хелпер"
        ), patch(
            "core.permissions.get_display_role", return_value="Администратор"
        ), patch(
            "services.chat_members.get_chat_authority", return_value="Администратор"
        ), patch("base.config.owner", 999999):
            self.assertTrue(set_role(100, 7, "Модератор", 1))

        self.assertEqual(get_role(100, 7), "Модератор")

    def test_global_helper_without_chat_creator_authority_is_rejected(self):
        from services.chat_roles import set_role

        with patch("core.identity.is_owner", return_value=False), patch(
            "core.identity.resolve_role", return_value="Хелпер"
        ), patch(
            "core.permissions.get_display_role", return_value="Хелпер"
        ), patch(
            "services.chat_members.get_chat_authority", return_value=None
        ), patch("base.config.owner", 999999):
            self.assertFalse(set_role(100, 7, "Модератор", 1))

    def test_service_identity_and_non_local_roles_cannot_be_assigned(self):
        from services.chat_roles import set_role

        for role in ("Создатель бота", "Основатель", "Система", "Игрок", "Администратор", "Хелпер"):
            self.assertFalse(set_role(100, 7, role, 1))


if __name__ == "__main__":
    unittest.main()
    def test_global_helper_target_does_not_block_admin_assignment(self):
        from services.chat_roles import set_role, get_role
        with patch("core.identity.resolve_role", return_value="Хелпер"), \
             patch("core.permissions.get_display_role", return_value="Администратор"), \
             patch("services.chat_members.get_chat_authority", return_value="Администратор"):
            self.assertTrue(set_role(100, 7, "Модератор", 1))
        self.assertEqual(get_role(100, 7), "Модератор")
