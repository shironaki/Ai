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


if __name__ == "__main__":
    unittest.main()
