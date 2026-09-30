import unittest


class AIExecutionContractTests(unittest.TestCase):
    def test_model_is_forbidden_to_claim_unexecuted_actions(self):
        from services.ai_service import _system_prompt

        prompt = _system_prompt("Основатель")
        self.assertIn("Ты не являешься непосредственным исполнителем команд", prompt)
        self.assertIn("не утверждай, что изменил роль", prompt)
        self.assertIn("не подключено", prompt)

    def test_model_must_not_invent_unverified_system_results(self):
        from services.ai_service import _system_prompt

        prompt = _system_prompt("Игрок")
        self.assertIn("не угадывай и не сочиняй", prompt.lower())
        self.assertIn("подтверждённые данные для этого запроса не переданы", prompt)


if __name__ == "__main__":
    unittest.main()
