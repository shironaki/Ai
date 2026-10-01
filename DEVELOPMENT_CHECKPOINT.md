# DEVELOPMENT_CHECKPOINT.md

## Canonical TEST continuation — 2026-10-01 — Termux live recovery checkpoint

### Current state
- Repository: shironaki/Ai
- Active branch: test-global-assistant-upgrade
- Latest TEST commit: 2c674931e1bb466ec3f4c1e3b2c4ca358bf9a806
- Draft PR: #22, base main; main/PROD remains untouched.
- Persistent live diagnostics: GitHub Issue #23.
- Current phone uses manual Termux supervisor; Termux:Boot is intentionally deferred to the second phone.

### What is already fixed in TEST
- Termux updater uses bash and loads ~/.config/ai/termux.env.
- BOT_TOKEN is required from the protected Termux environment file.
- TERMUX_GITHUB_TOKEN is used separately for telemetry.
- psutil is optional in main.py and Android/Termux dependency bootstrap skips psutil.
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
The user previously reported that the bot does not reliably recognize the founder/owner and may ask for /start again as if the user is absent from the system. This remains an unresolved TEST follow-up. After Termux runtime is green, inspect owner persistence/registration and founder-role resolution in the repository before changing behavior. Do not guess the user's ID and do not expose secrets.

### Operating rule
Work directly from repository state, make fixes in TEST, verify CI, then verify live state through Issue #23. Never treat CI alone as proof of live Telegram health. Never expose secrets. Keep main/PROD untouched until explicit live TEST verification and user approval.
