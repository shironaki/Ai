import unittest
from unittest import mock


class ChatMemberAdminSyncTests(unittest.TestCase):
    def test_promotion_to_admin_requires_sync(self):
        from services.chat_members import admin_status_changed

        self.assertTrue(admin_status_changed("member", "administrator"))
        self.assertTrue(admin_status_changed("member", "creator"))

    def test_demotion_from_admin_requires_sync(self):
        from services.chat_members import admin_status_changed

        self.assertTrue(admin_status_changed("administrator", "member"))
        self.assertTrue(admin_status_changed("creator", "member"))

    def test_ordinary_membership_changes_do_not_require_admin_sync(self):
        from services.chat_members import admin_status_changed

        self.assertFalse(admin_status_changed("member", "left"))
        self.assertFalse(admin_status_changed("left", "member"))
        self.assertFalse(admin_status_changed("member", "member"))


    def test_chat_member_update_uses_new_telegram_status(self):
        from services import chat_members

        class User:
            id = 123
            full_name = "QA"
            username = "qa"

        class Member:
            status = "administrator"
            user = User()

        class Chat:
            id = -100123
            type = "supergroup"

        class Update:
            chat = Chat()
            new_chat_member = Member()

        with mock.patch.object(
            chat_members,
            "_existing_bot_role",
            return_value="Модератор",
        ), unittest.mock.patch.object(
            chat_members,
            "observe",
        ) as observed:
            chat_members.observe_chat_member_update(Update())

        observed.assert_called_once_with(
            chat_id=-100123,
            user_id=123,
            name="QA",
            username="qa",
            telegram_status="administrator",
            bot_role="Модератор",
            is_chat_owner=False,
            is_chat_admin=True,
        )

if __name__ == "__main__":
    unittest.main()
