import os
import unittest


class AIRelationshipTests(unittest.TestCase):
    def test_founder_is_always_max_positive(self):
        from services.ai_relationship import get_score, is_max_positive, can_call

        owner = 1057867710
        self.assertEqual(get_score(owner, owner), 100)
        self.assertTrue(is_max_positive(owner, owner))
        self.assertTrue(can_call(owner, owner))

    def test_invocation_free_bonus_unlocks_at_75_percent(self):
        from services.ai_relationship import set_score, is_max_positive

        user_id = 778898
        set_score(user_id, 74, 1057867710, actor_id=1057867710)
        self.assertFalse(is_max_positive(user_id))
        set_score(user_id, 75, 1057867710, actor_id=1057867710)
        self.assertTrue(is_max_positive(user_id))

    def test_negative_relationship_blocks_calls(self):
        from services.ai_relationship import set_score, relationship_state, can_call

        user_id = 778899
        set_score(user_id, -80, 1057867710, actor_id=1057867710)
        self.assertEqual(relationship_state(user_id), "negative")
        self.assertFalse(can_call(user_id))

    def test_invocation_names_are_configurable(self):
        from services.ai_relationship import invocation_names, set_invocation_names

        old = os.environ.get("AI_INVOCATION_NAMES")
        from database.connection import connect_db
        try:
            invocation_names()
            with connect_db("users.db") as db:
                db.execute("DELETE FROM ai_settings WHERE key='invocation_names'")
                db.commit()
            os.environ["AI_INVOCATION_NAMES"] = "система, оператор"
            self.assertEqual(invocation_names(), ("система", "оператор"))
            self.assertEqual(set_invocation_names("Аи, Система", actor_id=1057867710), ("аи", "система"))
            self.assertEqual(invocation_names(), ("аи", "система"))
        finally:
            invocation_names()
            with connect_db("users.db") as db:
                db.execute("DELETE FROM ai_settings WHERE key='invocation_names'")
                db.commit()
            if old is None:
                os.environ.pop("AI_INVOCATION_NAMES", None)
            else:
                os.environ["AI_INVOCATION_NAMES"] = old


if __name__ == "__main__":
    unittest.main()
