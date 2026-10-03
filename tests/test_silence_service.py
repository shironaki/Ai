import sqlite3
import unittest
from contextlib import contextmanager
from unittest.mock import patch


class SilenceStateTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row

        @contextmanager
        def connect(_filename):
            yield self.db

        self.patch = patch("services.silence_service.connect_db", connect)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.db.close()

    def test_silence_preserves_and_reads_previous_permissions(self):
        from services.silence_service import (
            get_previous_permissions,
            is_silent,
            permissions_dict,
            set_silent,
        )

        previous = {
            "can_send_messages": True,
            "can_send_media_messages": False,
            "can_send_polls": True,
            "can_send_other_messages": False,
            "can_add_web_page_previews": False,
            "can_change_info": False,
            "can_invite_users": True,
            "can_pin_messages": False,
        }
        with patch("services.silence_service.has_moderator_role", return_value=True):
            set_silent(123, True, previous, actor_id=1)

        self.assertTrue(is_silent(123))
        self.assertEqual(get_previous_permissions(123), previous)

        with patch("services.silence_service.has_moderator_role", return_value=True):
            set_silent(123, False, actor_id=1)
        self.assertFalse(is_silent(123))
        self.assertIsNone(get_previous_permissions(123))

    def test_permissions_dict_is_limited_to_chat_permissions(self):
        from services.silence_service import permissions_dict

        class Permissions:
            can_send_messages = True
            can_invite_users = False
            secret = "must not persist"

        data = permissions_dict(Permissions())
        self.assertNotIn("secret", data)
        self.assertEqual(data["can_send_messages"], True)
        self.assertEqual(data["can_invite_users"], False)


if __name__ == "__main__":
    unittest.main()
