import ast
import asyncio
import os
import subprocess
import sys
import shutil
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

    def test_ai_history_isolated_between_chats(self):
        import services.ai_service as ai_service

        user_id = 987654323
        chat_a, chat_b = -10001, -10002
        old_key = os.environ.get("GROQ_API_KEY")
        old_request = ai_service._request_sync
        old_history = dict(ai_service._HISTORY)
        old_last_request = dict(ai_service._LAST_REQUEST)
        try:
            os.environ["GROQ_API_KEY"] = "test-key"
            ai_service._HISTORY.clear()
            ai_service._LAST_REQUEST.clear()
            captured = []

            def successful_request(messages, model, api_key, **kwargs):
                captured.append(messages)
                return "ответ"

            ai_service._request_sync = successful_request
            asyncio.run(ai_service.generate_reply(user_id, "сообщение A", chat_id=chat_a))
            ai_service._LAST_REQUEST.clear()
            asyncio.run(ai_service.generate_reply(user_id, "сообщение B", chat_id=chat_b))

            self.assertEqual(
                ai_service._HISTORY[(user_id, chat_a)][0]["content"],
                "сообщение A",
            )
            self.assertEqual(
                ai_service._HISTORY[(user_id, chat_b)][0]["content"],
                "сообщение B",
            )
            self.assertNotIn("сообщение A", str(captured[1]))
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

    def test_ai_continuation_failure_keeps_initial_answer(self):
        import services.ai_service as ai_service

        user_id = 987654325
        old_key = os.environ.get("GROQ_API_KEY")
        old_request = ai_service._request_sync
        old_history = dict(ai_service._HISTORY)
        old_last_request = dict(ai_service._LAST_REQUEST)
        try:
            os.environ["GROQ_API_KEY"] = "test-key"
            ai_service._HISTORY.clear()
            ai_service._LAST_REQUEST.clear()
            calls = {"count": 0}

            def request_with_failed_continuation(messages, model, api_key, **kwargs):
                calls["count"] += 1
                if calls["count"] == 1:
                    return "Это достаточно длинный ответ, который обрывается"
                raise RuntimeError("continuation unavailable")

            ai_service._request_sync = request_with_failed_continuation
            result = asyncio.run(ai_service.generate_reply(user_id, "продолжи", chat_id=-10005))
            self.assertEqual(result, "Это достаточно длинный ответ, который обрывается")
            self.assertEqual(ai_service._HISTORY[(user_id, -10005)][-1]["content"], result)
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

    def test_ai_request_throttle_isolated_between_chats(self):
        import services.ai_service as ai_service

        user_id = 987654324
        chat_a, chat_b = -10003, -10004
        old_key = os.environ.get("GROQ_API_KEY")
        old_request = ai_service._request_sync
        old_last_request = dict(ai_service._LAST_REQUEST)
        try:
            os.environ["GROQ_API_KEY"] = "test-key"
            ai_service._LAST_REQUEST.clear()
            ai_service._request_sync = lambda *args, **kwargs: "ответ"
            first = asyncio.run(ai_service.generate_reply(user_id, "запрос A", chat_id=chat_a))
            second = asyncio.run(ai_service.generate_reply(user_id, "запрос B", chat_id=chat_b))
            self.assertEqual(first, "ответ")
            self.assertEqual(second, "ответ")
            self.assertIn((user_id, chat_a), ai_service._LAST_REQUEST)
            self.assertIn((user_id, chat_b), ai_service._LAST_REQUEST)
        finally:
            ai_service._request_sync = old_request
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

    def test_termux_control_runtime_commands_require_active_lease(self):
        import scripts.termux_control as control

        old_device = control.DEVICE_ID
        old_read = control.read_lease
        try:
            control.DEVICE_ID = "phone2"
            control.read_lease = lambda: ({"owner": "phone1", "expires_at": int(__import__("time").time()) + 120}, "lease-sha")
            self.assertEqual(control.execute("RESTART"), "ignored: command requires active device lease")
            self.assertEqual(control.execute("UPDATE"), "ignored: command requires active device lease")
            self.assertEqual(control.execute("STATUS"), "ignored: command requires active device lease")
        finally:
            control.DEVICE_ID = old_device
            control.read_lease = old_read
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
            elif os.name == "nt":
                # Prefer the real Git-for-Windows bash shipped with Git. The
                # bash.exe on PATH may be only a WSL guidance shim.
                git_exe = shutil.which("git")
                bash_exe = None
                if git_exe:
                    candidate = Path(git_exe).resolve().parent.parent / "bin" / "bash.exe"
                    if candidate.exists():
                        bash_exe = str(candidate)
                if not bash_exe:
                    self.skipTest("Git Bash is not available on Windows")
                subprocess.run([bash_exe, "-n", str(path)], check=True)
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
        if os.name == "nt":
            git_exe = shutil.which("git")
            bash_exe = None
            if git_exe:
                candidate = Path(git_exe).resolve().parent.parent / "bin" / "bash.exe"
                if candidate.exists():
                    bash_exe = str(candidate)
            if not bash_exe:
                self.skipTest("Git Bash is not available on Windows")
            subprocess.run([bash_exe, "-n", str(ROOT / "start.sh")], check=True)
        else:
            subprocess.run(["bash", "-n", str(ROOT / "start.sh")], check=True)

    def test_termux_supervisor_records_real_pid(self):
        source = (ROOT / "scripts" / "termux_supervisor.sh").read_text(encoding="utf-8")
        pid_lines = [
            line.strip()
            for line in source.splitlines()
            if "SUPERVISOR_PID" in line and line.strip().startswith("echo ")
        ]
        expected = 'echo "' + chr(36) * 2 + '" > "' + chr(36) + 'SUPERVISOR_PID"'
        self.assertEqual(pid_lines, [expected])

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


    def test_termux_lease_race_rejects_concurrent_renewal_or_acquisition(self):
        import scripts.termux_control as control

        old_device = control.DEVICE_ID
        old_read = control.read_lease
        old_write = control.write_lease
        try:
            control.DEVICE_ID = "phone2"
            control.read_lease = lambda: (
                {"owner": "phone2", "expires_at": int(__import__("time").time()) + control.LEASE_RENEW_BEFORE - 1},
                "parent-a",
            )
            control.write_lease = lambda lease, parent: False
            acquired, message = control.acquire_or_renew_lease()
            self.assertFalse(acquired)
            self.assertIn("renewal conflict", message)
        finally:
            control.DEVICE_ID = old_device
            control.read_lease = old_read
            control.write_lease = old_write

    def test_termux_force_takeover_fences_only_after_cas_success(self):
        import scripts.termux_control as control

        old_device = control.DEVICE_ID
        old_read = control.read_lease
        old_write = control.write_lease
        old_role = control.ROLEFILE
        try:
            control.DEVICE_ID = "phone2"
            control.read_lease = lambda: (
                {"owner": "phone1", "expires_at": int(__import__("time").time()) + 120},
                "parent-a",
            )
            control.write_lease = lambda lease, parent: False
            self.assertIn("lease changed concurrently", control.force_takeover())
        finally:
            control.DEVICE_ID = old_device
            control.read_lease = old_read
            control.write_lease = old_write
            control.ROLEFILE = old_role

    def test_termux_watchdog_fails_closed_without_initial_lease(self):
        source = (ROOT / "scripts" / "termux_lease_watchdog.py").read_text(encoding="utf-8")
        self.assertIn("Fail closed if the watchdog cannot establish a valid lease", source)
        self.assertIn("stop_bot()", source)
        self.assertIn("INTERVAL = max(3", source)

    def test_termux_update_refuses_bot_start_without_fresh_lease(self):
        source = (ROOT / "scripts" / "termux_update.sh").read_text(encoding="utf-8")
        self.assertIn("has_fresh_active_lease()", source)
        self.assertIn('git fetch origin "$LEASE_BRANCH"', source)
        self.assertIn('git show "origin/$LEASE_BRANCH:$LEASE_PATH"', source)
        self.assertNotIn("urllib.request", source)
        self.assertIn('STOP: refusing to start bot without a fresh active lease', source)


    def test_termux_returning_old_active_device_cannot_reclaim_live_lease(self):
        import scripts.termux_control as control

        old_device = control.DEVICE_ID
        old_read = control.read_lease
        old_write = control.write_lease
        try:
            # phone1 returns after phone2 already became active.
            control.DEVICE_ID = "phone1"
            control.read_lease = lambda: (
                {"owner": "phone2", "expires_at": int(__import__("time").time()) + 120},
                "parent-phone2",
            )
            writes = []
            control.write_lease = lambda lease, parent: writes.append((lease, parent)) or True
            acquired, message = control.acquire_or_renew_lease()
            self.assertFalse(acquired)
            self.assertIn("lease held by phone2", message)
            self.assertEqual(writes, [])
        finally:
            control.DEVICE_ID = old_device
            control.read_lease = old_read
            control.write_lease = old_write

    def test_termux_auto_failover_only_promotes_when_lease_is_acquirable(self):
        import scripts.termux_control as control

        old_device = control.DEVICE_ID
        old_read = control.read_lease
        old_write = control.write_lease
        try:
            control.DEVICE_ID = "phone2"
            control.read_lease = lambda: (
                {"owner": "phone1", "expires_at": int(__import__("time").time()) + 90},
                "parent-phone1",
            )
            writes = []
            control.write_lease = lambda lease, parent: writes.append((lease, parent)) or True
            acquired, message = control.acquire_or_renew_lease()
            self.assertFalse(acquired)
            self.assertIn("lease held by phone1", message)
            self.assertEqual(writes, [])
        finally:
            control.DEVICE_ID = old_device
            control.read_lease = old_read
            control.write_lease = old_write

    def test_termux_standby_role_stops_runtime_before_releasing_lease(self):
        source = (ROOT / "scripts" / "termux_control.py").read_text(encoding="utf-8")
        stop_pos = source.index("stopped = stop_bot_for_role()")
        release_pos = source.index("released, lease_message = release_lease()", stop_pos)
        self.assertLess(stop_pos, release_pos)

    def test_termux_active_role_is_fenced_when_lease_acquisition_fails(self):
        source = (ROOT / "scripts" / "termux_control.py").read_text(encoding="utf-8")
        acquire_pos = source.index("acquired, lease_message = acquire_or_renew_lease()")
        stop_pos = source.index("stop_bot_for_role()", acquire_pos)
        standby_pos = source.index('ROLEFILE.write_text("standby\\n"', stop_pos)
        self.assertLess(acquire_pos, stop_pos)
        self.assertLess(stop_pos, standby_pos)


    def test_termux_update_fences_lease_at_each_restart_boundary(self):
        source = (ROOT / "scripts" / "termux_update.sh").read_text(encoding="utf-8")
        self.assertIn('if is_active_role && ! has_fresh_active_lease; then', source)
        self.assertIn('FENCE: lease lost after dependency installation', source)
        self.assertIn('FENCE: lease lost after tests', source)
        self.assertIn('FENCE: lease lost before restart', source)
        self.assertIn('STOP: refusing to start bot without a fresh active lease', source)

    def test_termux_update_loads_device_id_after_termux_env(self):
        source = (ROOT / "scripts/termux_update.sh").read_text(encoding="utf-8")
        env_pos = source.index('set +a')
        device_pos = source.index('DEVICE_ID="${TERMUX_DEVICE_ID:-}"', env_pos)
        self.assertLess(env_pos, device_pos)

    def test_termux_update_never_installs_dependencies_on_standby(self):
        source = (ROOT / "scripts/termux_update.sh").read_text(encoding="utf-8")
        standby_pos = source.index('log "UPDATE: standby skips dependency installation')
        deps_pos = source.index('install_dependencies', standby_pos)
        self.assertLess(standby_pos, deps_pos)

    def test_termux_update_stops_active_runtime_before_code_pull(self):
        source = (ROOT / "scripts/termux_update.sh").read_text(encoding="utf-8")
        update_pos = source.index('log "UPDATE: $LOCAL -> $REMOTE"')
        stop_pos = source.index('stop_bot', update_pos)
        pull_pos = source.index('git pull --ff-only origin "$BRANCH"', stop_pos)
        self.assertLess(stop_pos, pull_pos)

    def test_termux_update_github_failure_can_only_restart_with_fresh_lease(self):
        source = (ROOT / "scripts/termux_update.sh").read_text(encoding="utf-8")
        fail_pos = source.index('log "STOP: fast-forward update failed"')
        lease_pos = source.index('has_fresh_active_lease', fail_pos)
        start_pos = source.index('start_bot', lease_pos)
        self.assertLess(lease_pos, start_pos)


    def test_termux_update_carries_pre_update_commit_into_rollback(self):
        source = (ROOT / "scripts/termux_update.sh").read_text(encoding="utf-8")
        self.assertIn('ROLLBACK_COMMIT="${TERMUX_UPDATE_ROLLBACK_COMMIT:-}"', source)
        self.assertIn('TERMUX_UPDATE_ROLLBACK_COMMIT="$LOCAL"', source)
        self.assertIn('rollback "$ROLLBACK_COMMIT"', source)
        self.assertNotIn('rollback "$LOCAL"', source)

    def test_termux_update_fences_after_failed_restart_before_rollback_start(self):
        source = (ROOT / "scripts/termux_update.sh").read_text(encoding="utf-8")
        restart_pos = source.index('if ! start_bot; then')
        rollback_pos = source.index('rollback "$ROLLBACK_COMMIT"', restart_pos)
        self.assertLess(restart_pos, rollback_pos)
        self.assertIn('start_bot() {', source)
        self.assertIn('has_fresh_active_lease', source)


    def test_termux_supervisor_is_singleton(self):
        source = (ROOT / "scripts" / "termux_supervisor.sh").read_text(encoding="utf-8")
        self.assertIn('SUPERVISOR_LOCKDIR="$REPO/.termux-supervisor.lock"', source)
        self.assertIn('if ! mkdir "$SUPERVISOR_LOCKDIR" 2>/dev/null; then', source)
        self.assertIn('rmdir "$SUPERVISOR_LOCKDIR"', source)

    def test_termux_watchdog_verifies_pid_identity_before_fencing(self):
        source = (ROOT / "scripts" / "termux_lease_watchdog.py").read_text(encoding="utf-8")
        self.assertIn('/proc/{pid}/cmdline', source)
        self.assertIn('str(ROOT / "run.py") in cmdline', source)
        self.assertIn('if not bot_running():', source)

    def test_termux_restart_rechecks_lease_at_process_start_boundary(self):
        source = (ROOT / "scripts" / "termux_control.py").read_text(encoding="utf-8")
        restart_pos = source.index('def restart_bot() -> str:')
        lease_pos = source.index('if not has_active_lease():', restart_pos)
        spawn_pos = source.index('subprocess.Popen(', restart_pos)
        self.assertLess(lease_pos, spawn_pos)
        self.assertIn('restart denied: active lease is no longer owned', source)


    def test_termux_supervisor_recovers_stale_lock_only_after_pid_validation(self):
        source = (ROOT / "scripts" / "termux_supervisor.sh").read_text(encoding="utf-8")
        lock_pos = source.index('if ! mkdir "$SUPERVISOR_LOCKDIR"')
        pid_check = source.index('supervisor_process_matches "$existing_pid"', lock_pos)
        remove_pos = source.index('rm -rf "$SUPERVISOR_LOCKDIR"', pid_check)
        self.assertLess(pid_check, remove_pos)
        self.assertIn('termux_supervisor.sh', source)

    def test_termux_supervisor_self_restarts_after_script_update(self):
        source = (ROOT / "scripts" / "termux_supervisor.sh").read_text(encoding="utf-8")
        self.assertIn("SUPERVISOR_HASHFILE=", source)
        self.assertIn("ensure_supervisor_revision()", source)
        self.assertIn('exec "$0"', source)
        self.assertIn("ensure_supervisor_revision", source.split("while true; do", 1)[1])

    def test_termux_control_heartbeat_writes_real_newline(self):
        source = (ROOT / "scripts" / "termux_control.py").read_text(encoding="utf-8")
        self.assertIn('CONTROL_HEARTBEAT.write_text(f"{time.time():.3f}\\n", encoding="utf-8")', source)
        self.assertNotIn('CONTROL_HEARTBEAT.write_text(f"{time.time():.3f}\\\\n", encoding="utf-8")', source)


if __name__ == "__main__":
    unittest.main()
