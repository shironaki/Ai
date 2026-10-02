import unittest

from config.role_config import ASSIGNABLE_ROLES, GAME_ROLE, SYSTEM_ROLE
from core.command_registry import resolve_command
from core.role_transitions import available_role_targets, assignment_error, can_assign


class RolePolicyTests(unittest.TestCase):
    def test_system_and_game_roles_are_not_assignable(self):
        self.assertNotIn(SYSTEM_ROLE, ASSIGNABLE_ROLES)
        self.assertNotIn(GAME_ROLE, ASSIGNABLE_ROLES)
        self.assertIsNotNone(assignment_error("Администратор", SYSTEM_ROLE))
        self.assertIsNotNone(assignment_error("Администратор", GAME_ROLE))

    def test_admin_can_assign_lower_roles_only(self):
        self.assertTrue(can_assign("Администратор", "Хелпер"))
        self.assertTrue(can_assign("Администратор", "Модератор"))
        self.assertFalse(can_assign("Администратор", "Администратор"))
        self.assertFalse(can_assign("Администратор", "Создатель бота"))
        self.assertEqual(available_role_targets("Администратор"), ("Модератор", "Хелпер"))

    def test_helper_can_only_assign_moderator(self):
        self.assertEqual(available_role_targets("Хелпер"), ("Модератор",))
        self.assertFalse(can_assign("Хелпер", "Хелпер"))
        self.assertFalse(can_assign("Хелпер", "Администратор"))

    def test_owner_can_assign_human_admin_roles_but_not_system(self):
        self.assertEqual(
            available_role_targets("Создатель бота", actor_is_owner=True),
            ("Модератор", "Хелпер", "Администратор"),
        )
        self.assertFalse(can_assign("Создатель бота", "Система", actor_is_owner=True))

    def test_unified_command_aliases(self):
        self.assertEqual(resolve_command("выдай статус").key, "setstatus")
        self.assertEqual(resolve_command("инфа").key, "info")
        self.assertEqual(resolve_command("репорт").key, "report")
        self.assertEqual(resolve_command("отмена").key, "cancel")


if __name__ == "__main__":
    unittest.main()
