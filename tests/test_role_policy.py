import unittest

from config.role_config import ASSIGNABLE_ROLES, GLOBAL_ASSIGNABLE_ROLES, GAME_ROLE, SYSTEM_ROLE
from core.command_registry import resolve_command
from core.role_transitions import available_role_targets, assignment_error, can_assign


class RolePolicyTests(unittest.TestCase):
    def test_system_and_game_roles_are_not_assignable(self):
        self.assertNotIn(SYSTEM_ROLE, ASSIGNABLE_ROLES)
        self.assertNotIn(GAME_ROLE, ASSIGNABLE_ROLES)
        self.assertIsNotNone(assignment_error("Администратор", SYSTEM_ROLE))
        self.assertIsNotNone(assignment_error("Администратор", GAME_ROLE))

    def test_admin_can_assign_only_local_moderator(self):
        self.assertTrue(can_assign("Администратор", "Модератор"))
        self.assertFalse(can_assign("Администратор", "Хелпер"))
        self.assertFalse(can_assign("Администратор", "Администратор"))
        self.assertFalse(can_assign("Администратор", "Создатель бота"))
        self.assertEqual(available_role_targets("Администратор"), ("Модератор",))

    def test_helper_cannot_assign_local_roles(self):
        self.assertEqual(available_role_targets("Хелпер"), ())
        self.assertFalse(can_assign("Хелпер", "Модератор"))
        self.assertFalse(can_assign("Хелпер", "Хелпер"))
        self.assertFalse(can_assign("Хелпер", "Администратор"))

    def test_owner_can_assign_only_global_helper(self):
        self.assertEqual(GLOBAL_ASSIGNABLE_ROLES, ("Хелпер",))
        self.assertEqual(
            available_role_targets("Создатель бота", actor_is_owner=True),
            ("Хелпер",),
        )
        self.assertTrue(can_assign("Создатель бота", "Хелпер", actor_is_owner=True))
        self.assertFalse(can_assign("Создатель бота", "Модератор", actor_is_owner=True))
        self.assertFalse(can_assign("Создатель бота", "Администратор", actor_is_owner=True))
        self.assertFalse(can_assign("Создатель бота", "Система", actor_is_owner=True))

    def test_unified_command_aliases(self):
        self.assertEqual(resolve_command("выдай статус").key, "setstatus")
        self.assertEqual(resolve_command("инфа").key, "info")
        self.assertEqual(resolve_command("репорт").key, "report")
        self.assertEqual(resolve_command("репорты").key, "reports")
        self.assertEqual(resolve_command("отмена").key, "cancel")


if __name__ == "__main__":
    unittest.main()
