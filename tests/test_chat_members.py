import unittest


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


if __name__ == "__main__":
    unittest.main()
