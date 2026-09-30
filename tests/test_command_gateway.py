import unittest


class CommandGatewayTests(unittest.TestCase):
    def test_cancel_phrases_are_detected(self):
        from services.command_gateway import is_cancel_request
        self.assertTrue(is_cancel_request("Отмени последний запрос"))
        self.assertTrue(is_cancel_request("отставить"))
        self.assertTrue(is_cancel_request("Забудь"))

    def test_unrelated_text_is_not_cancel(self):
        from services.command_gateway import is_cancel_request
        self.assertFalse(is_cancel_request("активируй стазис"))
