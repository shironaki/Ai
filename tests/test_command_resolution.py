import unittest


class CommandResolutionTests(unittest.TestCase):
    def test_scope_resolution_is_allowlisted(self):
        from core.command_resolution import resolve_scope

        self.assertEqual(resolve_scope("chat"), "chat")
        self.assertEqual(resolve_scope("GLOBAL"), "global")
        self.assertEqual(resolve_scope(None), "chat")
        self.assertIsNone(resolve_scope("admin"))
        self.assertIsNone(resolve_scope("all_users"))

    def test_target_resolution_requires_explicit_reply(self):
        from core.command_resolution import resolve_reply_target

        class User:
            id = 7

        class Reply:
            from_user = User()

        class Message:
            reply_to_message = Reply()

        self.assertEqual(resolve_reply_target(Message()).id, 7)
        self.assertIsNone(resolve_reply_target(type("Message", (), {"reply_to_message": None})()))


if __name__ == "__main__":
    unittest.main()
