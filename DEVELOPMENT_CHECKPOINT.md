# DEVELOPMENT_CHECKPOINT.md

## Canonical TEST continuation — 2026-10-01 — Termux live recovery checkpoint

### Current state
- Repository: shironaki/Ai
- Active branch: test-global-assistant-upgrade
- Latest TEST commit: 30123cabe89f5237b1bc3068965f34eabbbc16f3
- Draft PR: #22, base main; main/PROD remains untouched.
- Persistent live diagnostics: GitHub Issue #23.
- Current phone uses manual Termux supervisor; Termux:Boot is intentionally deferred to the second phone.

### What is already fixed in TEST
- Termux updater uses bash and loads ~/.config/ai/termux.env.
- BOT_TOKEN is required from the protected Termux environment file.
- TERMUX_GITHUB_TOKEN is used separately for telemetry.
- psutil is optional in main.py and Android/Termux dependency bootstrap skips psutil.
- Termux runtime requirements were reduced to the packages actually used by the current code (`aiogram`, `requests`).
- Termux bootstrap now installs a modern Android-compatible `aiohttp` wheel separately and installs aiogram 2.x without re-resolving its obsolete aiohttp constraint, preventing source builds of old aiohttp/Pillow.
- Founder regression tests now mock the database objects safely; CI is green again (59 tests).
- Termux updater installs dependencies before pytest, then performs Telegram health verification.
- Failed update/bootstrap/startup/health paths are designed to rollback to the previous local commit.
- Supervisor writes its PID and runs the updater/report loop.
- Telemetry publishes sanitized runtime snapshots to Issue #23.

### Latest live action completed by user
The user successfully executed the clean Termux recovery block:
1. stopped old termux_supervisor.sh processes;
2. deleted the stale origin/test-global-assistant-upgrade remote ref;
3. fetched origin/test-global-assistant-upgrade successfully;
4. hard-reset the working tree to origin/test-global-assistant-upgrade at 2c67493;
5. removed and recreated .venv;
6. verified BOT_TOKEN exists without exposing it;
7. started a fresh supervisor with PID 30864.

### Live state at handoff
The latest telemetry snapshot available immediately before this checkpoint still contained historical failure tails: missing aiogram/requests, old psutil Android incompatibility, old stale-ref errors, and supervisor not running. It predates or is concurrent with the fresh supervisor startup and therefore is NOT proof that the new bootstrap failed.
Do not ask the user to repeat the cleanup block unless a newer telemetry snapshot proves the fresh supervisor failed.

### Latest TEST bootstrap repair
- Root cause of the live bootstrap failure: the legacy `requirements.txt` pulled unused native packages and, through `aiogram==2.25.2`, an old aiohttp range. On Termux/Python 3.13 this caused pip to build aiohttp/Pillow from source and fail on missing JPEG development libraries.
- TEST repair is committed in `requirements.txt` and `scripts/termux_update.sh`.
- CI run #574 is green: dependency install, compile, application import, AI service check, and all 59 runtime tests passed.
- The live Termux telemetry still predates this repair and remains on old commit `2c674931...`; supervisor is not currently running. No conclusion about the repaired bootstrap can be drawn until Termux pulls the new TEST commit.

### Exact continuation condition
On the next check, inspect Issue #23 first. Continue from the newest telemetry snapshot only.
Success criteria:
- health reports HEALTH OK;
- bot process is running;
- supervisor process is running;
- heartbeat is fresh;
- Telegram polling is ready;
- no new aiogram/requests/psutil bootstrap error;
- no new remote-ref lock error.

If the fresh bootstrap fails, fix the Termux bootstrap mechanism in TEST directly rather than repeatedly cycling the user through manual cleanup.

### Owner/founder follow-up
- Root cause identified: founder authorization already resolves from `config.owner`, but legacy handlers still required a row in `users.db` and could therefore ask the founder for `/start` after a fresh database/bootstrap.
- TEST fix committed in `base/users.py` and `main.py`: the configured founder is persisted in the legacy registry and their live Telegram name/username are refreshed on incoming messages. No owner ID is guessed or changed.
- Regression coverage added in `tests/test_founder_identity.py`.
- CI passed on the fix: compile, application import, AI service check, and full runtime regression suite all successful.
- This fix is TEST-only and is not yet live on Termux until the supervisor advances to the new commit.
- Do not expose secrets.

### Operating rule
Work directly from repository state, make fixes in TEST, verify CI, then verify live state through Issue #23. Never treat CI alone as proof of live Telegram health. Never expose secrets. Keep main/PROD untouched until explicit live TEST verification and user approval.
