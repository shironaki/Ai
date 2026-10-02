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
                "fetchone\\s*\\(\\)\\s*\\[",
                msg=f"unsafe fetchone indexing remains in {path}",
            )

    def test_runtime_state_supports_global_and_chat_scopes(self):
        from core.runtime_state import is_paused, set_paused
        set_paused(False, scope="global")
        set_paused(False, scope="chat", chat_id=1001)
        set_paused(True, scope="chat", chat_id=1001)
        self.assertTrue(is_paused(1001))
        self.assertFalse(is_paused(1002))
        set_paused(True, scope="global")
        self.assertTrue(is_paused(1001))
        self.assertTrue(is_paused(1002))
        set_paused(False, scope="global")
        self.assertFalse(is_paused(1002))
        set_paused(False, scope="chat", chat_id=1001)

    def test_founder_interpret_uses_deterministic_path_before_ai(self):
        import services.command_gateway as command_gateway

        async def forbidden_classifier(*args, **kwargs):
            raise AssertionError("AI classifier should not be called for known Founder commands")

        old_classifier = command_gateway.classify_command
        try:
            command_gateway.classify_command = forbidden_classifier
            result = asyncio.run(
                command_gateway.interpret("стазис включи в этом чате")
            )
            self.assertEqual(
                result,
                {"command": "stasis", "action": "enable", "scope": "chat"},
            )
        finally:
            command_gateway.classify_command = old_classifier

    def test_founder_command_fallback_recognizes_scopes(self):
        from services.command_gateway import _extract_fallback
        self.assertEqual(
            _extract_fallback("стазис включи в этом чате"),
            {"command": "stasis", "action": "enable", "scope": "chat"},
        )
        self.assertEqual(
            _extract_fallback("выключи стазис везде"),
            {"command": "awakening", "action": "disable", "scope": "global"},
        )

    def test_entrypoint_does_not_spawn_a_second_main_process(self):
        source = (ROOT / "run.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        calls = [
            node for node in ast.walk(tree)
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

    def test_termux_lease_denies_another_live_owner(self):
        import scripts.termux_control as control

        old_device = control.DEVICE_ID
        old_read = control.read_lease
        try:
            control.DEVICE_ID = "phone2"
            control.read_lease = lambda: ({"owner": "phone1", "expires_at": int(__import__("time").time()) + 120}, "lease-sha")
            acquired, message = control.acquire_or_renew_lease()
            self.assertFalse(acquired)
            self.assertIn("lease held by phone1 for", message)
        finally:
            control.DEVICE_ID = old_device
            control.read_lease = old_read

    def test_termux_lease_renews_only_near_expiry(self):
        import scripts.termux_control as control

        old_device = control.DEVICE_ID
        old_read = control.read_lease
        old_write = control.write_lease
        calls = []
        try:
            control.DEVICE_ID = "phone1"
            control.read_lease = lambda: ({"owner": "phone1", "expires_at": int(__import__("time").time()) + control.LEASE_RENEW_BEFORE - 1}, "lease-sha")
            control.write_lease = lambda lease, parent: calls.append((lease, parent)) or True
            acquired, message = control.acquire_or_renew_lease()
            self.assertTrue(acquired)
            self.assertIn("lease renewed", message)
            self.assertEqual(calls[0][0]["owner"], "phone1")
            self.assertGreater(calls[0][0]["expires_at"], int(__import__("time").time()))
        finally:
            control.DEVICE_ID = old_device
            control.read_lease = old_read
            control.write_lease = old_write

    def test_termux_lease_denies_unexpired_other_owner(self):
        import scripts.termux_control as control

        old_device = control.DEVICE_ID
        old_read = control.read_lease
        try:
            control.DEVICE_ID = "phone2"
            control.read_lease = lambda: ({"owner": "phone1", "expires_at": int(__import__("time").time()) + 120}, "lease-sha")
            acquired, message = control.acquire_or_renew_lease()
            self.assertFalse(acquired)
            self.assertIn("lease held by phone1", message)
        finally:
            control.DEVICE_ID = old_device
            control.read_lease = old_read

    def test_termux_lease_acquire_uses_remote_parent_and_cas_push(self):
        import scripts.termux_control as control

        old_device = control.DEVICE_ID
        old_read = control.read_lease
        old_write = control.write_lease
        calls = []
        try:
            control.DEVICE_ID = "phone2"
            control.read_lease = lambda: ({"owner": ""}, "lease-sha")
            def fake_write(lease, parent):
                calls.append((lease, parent))
                return True
            control.write_lease = fake_write
            acquired, message = control.acquire_or_renew_lease()
            self.assertTrue(acquired)
            self.assertIn("lease acquired owner=phone2", message)
            self.assertEqual(calls[0][1], "lease-sha")
            self.assertEqual(calls[0][0]["owner"], "phone2")
        finally:
            control.DEVICE_ID = old_device
            control.read_lease = old_read
            control.write_lease = old_write

    def test_termux_force_command_requires_target_device_and_active(self):
        import scripts.termux_control as control

        old_device = control.DEVICE_ID
        old_force = control.force_takeover
        try:
            control.DEVICE_ID = "phone2"
            control.force_takeover = lambda: "forced"
            self.assertEqual(control.execute("FORCE phone2 ACTIVE"), "forced")
            self.assertEqual(
                control.execute("FORCE phone1 ACTIVE"),
                "ignored: command targets another device",
            )
            self.assertIn(
                "FORCE syntax",
                control.execute("FORCE phone2 STANDBY"),
            )
        finally:
            control.DEVICE_ID = old_device
            control.force_takeover = old_force

    def test_runtime_hardening_scripts_are_syntactically_valid(self):
        scripts = (
            ROOT / "autoupdate.sh",
            ROOT / "codespace_boot.sh",
            ROOT / "scripts" / "termux_update.sh",
            ROOT / "scripts" / "termux_supervisor.sh",
            ROOT / "scripts" / "termux_lease_watchdog.py",
            ROOT / "scripts" / "termux_boot.sh",
        )
        for path in scripts:
            if path.suffix == ".py":
                subprocess.run([str(sys.executable), "-m", "py_compile", str(path)], check=True)
            else:
                subprocess.run(["bash", "-n", str(path)], check=True)

    def test_runtime_hardening_does_not_persist_git_credentials(self):
        boot = (ROOT / "codespace_boot.sh").read_text(encoding="utf-8")
        updater = (ROOT / "autoupdate.sh").read_text(encoding="utf-8")
        self.assertNotIn("git config --local credential.helper", boot)
        self.assertIn("git config --local --unset-all credential.helper", boot)
        self.assertIn("GIT_CONFIG_COUNT=1", updater)
        self.assertIn("git config --local --unset-all credential.helper", updater)
        self.assertIn("scripts/healthcheck.py", updater)
        health = (ROOT / "scripts" / "healthcheck.py").read_text(encoding="utf-8")
        self.assertIn("getWebhookInfo", health)
        self.assertIn("polling conflict detected", health)

    def test_runtime_pid_files_are_ignored(self):
        gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
        self.assertRegex(gitignore, r"(?m)^\*\.pid$")

    def test_runtime_recovery_stops_unhealthy_process_before_restart(self):
        updater = (ROOT / "autoupdate.sh").read_text(encoding="utf-8")
        boot = (ROOT / "codespace_boot.sh").read_text(encoding="utf-8")
        self.assertIn("BOT unhealthy; stopping stale process before recovery", updater)
        self.assertIn("existing process is unhealthy; stopping stale process before recovery", boot)

    def test_start_script_passes_shell_syntax(self):
        subprocess.run(["bash", "-n", str(ROOT / "start.sh")], check=True)

    def test_termux_supervisor_records_real_pid(self):
        source = (ROOT / "scripts" / "termux_supervisor.sh").read_text(encoding="utf-8")
        pid_lines = [line.strip() for line in source.splitlines() if "SUPERVISOR_PID" in line and line.strip().startswith("echo ")]
        self.assertIn('echo "

    def test_termux_update_self_heals_dependencies_while_bot_is_running(self):
        source = (ROOT / "scripts" / "termux_update.sh").read_text(encoding="utf-8")
        self.assertIn(
            'import aiogram, aiohttp, requests',
            source,
        )
        self.assertIn(
            'while bot is running; reinstalling dependencies',
            source,
        )

if __name__ == "__main__":
    unittest.main()
 + '$" > "$SUPERVISOR_PID"', pid_lines)


    def test_termux_update_self_heals_dependencies_while_bot_is_running(self):
        source = (ROOT / "scripts" / "termux_update.sh").read_text(encoding="utf-8")
        self.assertIn(
            'import aiogram, aiohttp, requests',
            source,
        )
        self.assertIn(
            'while bot is running; reinstalling dependencies',
            source,
        )

if __name__ == "__main__":
    unittest.main()
