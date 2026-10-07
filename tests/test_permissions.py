import unittest
from unittest.mock import patch


class PermissionParityTests(unittest.TestCase):
    def test_chat_creator_overrides_global_helper_only_in_that_chat(self):
        from core.permissions import get_display_role, has_moderator_role

        with patch("core.permissions.is_owner", return_value=False), patch(
            "core.permissions.resolve_role", return_value="Хелпер"
        ), patch(
            "core.permissions._telegram_authority",
            side_effect=lambda user_id, chat_id: (
                "Администратор" if chat_id == -1001 else None
            ),
        ), patch(
            "core.permissions._local_bot_role", return_value=None
        ):
            self.assertEqual(get_display_role(7, -1001), "Администратор")
            self.assertTrue(has_moderator_role(7, -1001))
            self.assertEqual(get_display_role(7, -1002), "Хелпер")
            self.assertFalse(has_moderator_role(7, -1002))

    def test_explicit_local_moderator_overrides_global_helper_only_in_that_chat(self):
        from core.permissions import get_display_role, has_moderator_role

        with patch("core.permissions.is_owner", return_value=False), patch(
            "core.permissions.resolve_role", return_value="Хелпер"
        ), patch(
            "core.permissions._telegram_authority", return_value=None
        ), patch(
            "core.permissions._local_bot_role",
            side_effect=lambda user_id, chat_id: "Модератор" if chat_id == -1004 else None,
        ):
            self.assertEqual(get_display_role(9, -1004), "Модератор")
            self.assertTrue(has_moderator_role(9, -1004))
            self.assertEqual(get_display_role(9, -1005), "Хелпер")
            self.assertFalse(has_moderator_role(9, -1005))

    def test_telegram_admin_without_creator_authority_is_not_local_admin(self):
        from core.permissions import get_display_role, has_admin_role

        with patch("core.permissions.is_owner", return_value=False), patch(
            "core.permissions.resolve_role", return_value="Пользователь"
        ), patch(
            "core.permissions._telegram_authority", return_value=None
        ), patch(
            "core.permissions._local_bot_role", return_value=None
        ):
            self.assertEqual(get_display_role(8, -1003), "Пользователь")
            self.assertFalse(has_admin_role(8, -1003))


if __name__ == "__main__":
    unittest.main()
