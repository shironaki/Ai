import unittest


class IssueTrackerTests(unittest.TestCase):
    def test_marker_parser_supports_reason_and_code(self):
        from services.issue_tracker import parse_marker
        parsed = parse_marker("отметь код 1 ошибка в команде стазис")
        self.assertEqual(parsed["code"], 1)
        self.assertEqual(parsed["reason"], "ошибка в команде стазис")

    def test_marker_parser_requires_marker_keyword(self):
        from services.issue_tracker import parse_marker
        self.assertIsNone(parse_marker("ошибка в команде"))

    def test_fixed_parser(self):
        from services.issue_tracker import parse_fixed
        self.assertEqual(parse_fixed("исправлено #12"), 12)
        self.assertIsNone(parse_fixed("исправлено"))


    def test_marker_parser_accepts_plain_reason(self):
        from services.issue_tracker import parse_marker
        parsed = parse_marker("отметь команда стазис не работает")
        self.assertIsNone(parsed["code"])
        self.assertEqual(parsed["reason"], "команда стазис не работает")

    def test_fixed_parser_does_not_consume_issue_reason(self):
        from services.issue_tracker import parse_fixed
        self.assertIsNone(parse_fixed("исправить команда стазис"))
