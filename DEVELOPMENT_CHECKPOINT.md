# DEVELOPMENT_CHECKPOINT.md

## Canonical TEST continuation — 2026-10-01 — Termux dependency bootstrap diagnosis

### Current state
- Repository: shironaki/Ai
- Active branch: test-global-assistant-upgrade
- Latest TEST commit: 01e15b01b8371d59bc593da257d79e5af5df7d26
- Draft PR: #22, base main; main/PROD remains untouched.
- Persistent live diagnostics: GitHub Issue #23.
- Termux live verification is not yet green.
- Supervisor must remain stopped while repairing the bootstrap; do not treat historical Issue #23 telemetry as current health.

### Confirmed live Termux facts
- Python: 3.13.13
- pip: 26.0.1
- The Termux device can download the official `aiohttp==3.14.3` CPython 3.13 Android ARM64 wheel with `--only-binary=:all:`.
- Therefore Android wheel availability is NOT the blocker.
- The 2026-10-01 23:10:52 failure window shows pip resolving `aiogram==2.25.2` together with its obsolete dependency constraint `aiohttp<3.9.0,>=3.8.0`, selecting `aiohttp-3.8.6.tar.gz` and attempting a source build.
- `packaging` is not installed in the current venv, so the prior tag-inspection command failed; this is not itself a runtime blocker.

### TEST repair just committed
- `scripts/termux_update.sh` now isolates aiogram 2.x from the temporary Termux requirements using a PID-specific temp file and an explicit leak check.
- Termux installs `aiohttp>=3.14,<3.15` from Android binary wheels first.
- Termux installs the remaining requirements separately, then installs `aiogram==2.25.2` with `--no-deps`, followed by its pure-Python runtime dependencies.
- Rollback no longer invokes the dependency installer from the restored old revision. This prevents a failed TEST update from immediately re-running the obsolete dependency bootstrap and polluting the diagnostic log with legacy source-build errors.
- No secrets are exposed or changed.

### Required next live action
The device currently contains competing/historical updater activity in the log. Do NOT start the supervisor yet.

After the repository change is pulled to Termux, the next live check must:
1. stop any old `termux_supervisor.sh` process;
2. sync TEST to commit `01e15b01...`;
3. run the updater once in the foreground;
4. inspect only the fresh log window from that run;
5. confirm `TERMUX IMPORTS OK`, pytest success, bot health, and then start the supervisor.

### Success criteria
- health reports HEALTH OK;
- bot process is running;
- supervisor process is running;
- heartbeat is fresh;
- Telegram polling is ready;
- no new aiogram/requests/psutil bootstrap error;
- no remote-ref/lock error;
- founder identity is verified live: configured owner is recognized without requiring a new /start registration.

### Founder identity follow-up
- TEST already contains the founder persistence fix in `base/users.py` and `main.py`.
- Regression coverage exists in `tests/test_founder_identity.py`.
- CI previously passed all 59 runtime tests on the founder fix.
- This remains TEST-only until live Termux verification.

### Operating rule
Work directly from repository state, make fixes in TEST, verify CI, then verify live state through fresh telemetry. Never treat CI or stale Issue #23 telemetry alone as proof of live Telegram health. Keep main/PROD untouched until explicit live TEST verification and user approval.
