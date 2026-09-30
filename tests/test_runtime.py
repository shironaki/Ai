import ast
import asyncio
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class RuntimeRegressionTests(unittest.TestCase):
    def test_ai_html_sanitizer_escapes_untrusted_tags(self):
        from services.ai_service import escape_for_telegram_html

        self.assertEqual(
            escape_for_telegram_html('Название <название> & "тест"'),
            'Название &lt;название&gt; &amp; "тест"',
        )

    def test_ai_status_is_safe_without_credentials(self):
        old = os.environ.pop("GROQ_API_KEY", None)
        try:
            from services.ai_service import ai_status

            self.assertFalse(ai_status()["configured"])
            self.assertTrue(ai_status()["model"])
        finally:
            if old is not None:
                os.environ["GROQ_API_KEY"] = old

    def test_ai_diagnostic_error_is_html_safe(self):
        import services.ai_service as ai_service

        old_key = os.environ.get("GROQ_API_KEY")
        old_request = ai_service._request_sync
        old_last_error = ai_service._LAST_ERROR["value"]

        try:
            os.environ["GROQ_API_KEY"] = "test-key"

            def failing_request(*args, **kwargs):
                bad_text = "bad " + chr(60) + "tag" + chr(62) + " " + chr(38) + " broken"
                raise RuntimeError(bad_text)

            ai_service._request_sync = failing_request
            result = asyncio.run(ai_service.generate_reply(987654322, "проверка"))
            self.assertIsNone(result)
            self.assertEqual(
                ai_service._LAST_ERROR["value"],
                "RuntimeError: bad &lt;tag&gt; &amp; broken",
            )
        finally:
            ai_service._request_sync = old_request
            ai_service._LAST_ERROR["value"] = old_last_error
            if old_key is None:
                os.environ.pop("GROQ_API_KEY", None)
            else:
                os.environ["GROQ_API_KEY"] = old_key

    def test_ai_failed_request_does_not_pollute_context(self):
        import services.ai_service as ai_service

        user_id = 987654321
        old_key = os.environ.get("GROQ_API_KEY")
        old_request = ai_service._request_sync
        old_history = dict(ai_service._HISTORY)
        old_last_request = dict(ai_service._LAST_REQUEST)

        try:
            os.environ["GROQ_API_KEY"] = "test-key"
            ai_service._HISTORY.clear()
            ai_service._LAST_REQUEST.clear()

            def failing_request(*args, **kwargs):
                raise RuntimeError("synthetic provider failure")

            ai_service._request_sync = failing_request
            result = asyncio.run(ai_service.generate_reply(user_id, "первый запрос"))
            self.assertIsNone(result)
            self.assertEqual(ai_service._HISTORY.get(user_id), [])

            ai_service._LAST_REQUEST.clear()

            def successful_request(messages, model, api_key):
                self.assertEqual(messages[-1]["content"], "второй запрос")
                return "ответ"

            ai_service._request_sync = successful_request
            result = asyncio.run(ai_service.generate_reply(user_id, "второй запрос"))
            self.assertEqual(result, "ответ")
            self.assertEqual(
                ai_service._HISTORY[user_id],
                [
                    {"role": "user", "content": "второй запрос"},
                    {"role": "assistant", "content": "ответ"},
                ],
            )
        finally:
            ai_service._request_sync = old_request
            ai_service._HISTORY.clear()
            ai_service._HISTORY.update(old_history)
            ai_service._LAST_REQUEST.clear()
            ai_service._LAST_REQUEST.update(old_last_request)
            if old_key is None:
                os.environ.pop("GROQ_API_KEY", None)
            else:
                os.environ["GROQ_API_KEY"] = old_key

    def test_handlers_do_not_index_missing_fetchone_results(self):
        handler_paths = (
            ROOT / "handlers" / "help" / "help.py",
            ROOT / "handlers" / "admin" / "apanel.py",
            ROOT / "handlers" / "chat_groups.py",
        )
        for path in handler_paths:
            source = path.read_text(encoding="utf-8")
            self.assertNotRegex(
                source,
                r"fetchone\\s*\\(\\)\\s*\\[",
                msg=f"unsafe fetchone indexing remains in {path}",
            )

    def test_entrypoint_does_not_spawn_a_second_main_process(self):
        source = (ROOT / "run.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        calls = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "start_bot"
        ]
        self.assertEqual(len(calls), 1)

    def test_test_environment_isolates_sqlite_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = os.environ.copy()
            env["BOT_ENV"] = "test"
            env["BOT_DATA_DIR"] = tmp
            env.pop("BOT_TOKEN", None)
            code = (
                "from base import users, chats; "
                "print(users.DB_PATH); print(chats.DB_PATH)"
            )
            result = subprocess.run(
                [sys.executable, "-c", code],
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
                check=True,
            )
            paths = result.stdout.strip().splitlines()
            self.assertEqual(len(paths), 2)
            self.assertTrue(all(Path(path).parent == Path(tmp) for path in paths))

    def test_start_script_passes_shell_syntax(self):
        subprocess.run(
            ["bash", "-n", str(ROOT / "start.sh")],
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
