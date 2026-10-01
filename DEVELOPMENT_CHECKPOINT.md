# DEVELOPMENT_CHECKPOINT.md

## Canonical TEST continuation — 2026-10-01 — autonomous Termux recovery + live telemetry

### Current state
- Repository: shironaki/Ai
- Active branch: test-global-assistant-upgrade
- Draft PR: #22, base main; main/PROD remains untouched.
- The previous typed command-executor experiment was reverted after a live runtime regression.
- Stable command gateway/runtime behavior is restored.
- Current phone runs the supervisor manually; Termux:Boot is intentionally deferred to the second phone.

### Completed in this block
- Termux updater treats every remote commit as a transactional update.
- Before accepting a new revision, Termux installs dependencies and runs the full pytest suite.
- The updated bot must start and pass the real Telegram health check.
- If dependency installation, tests, startup, or health verification fails, Termux automatically resets to the previous local commit and restores dependencies from that revision.
- Supervisor starts the bot when missing, restarts it on failed health, and keeps polling the TEST branch.
- Added live runtime telemetry through GitHub Issue #23.
- Telemetry publishes a sanitized snapshot every 5 minutes and immediately after updater failures.
- Telemetry stays outside the code working tree, so diagnostics cannot block updates.
- Shell syntax coverage validates the Termux automation scripts.

### Runtime hardening status
- CI verifies repository integrity and runtime regression coverage.
- Live Telegram/Termux state is never inferred from CI.
- TEST only; PROD/main remains untouched.
- The remaining one-time live setup is secure GitHub authentication for the Termux telemetry reporter.
- Termux:Boot remains deferred for the second phone.

### Operating rule
Work directly from repository state, make the fix, wait for completed CI, then hand the result to the user for live checking. Runtime diagnostics must be observable through the GitHub telemetry channel; do not require the user to paste logs unless the telemetry channel itself is unavailable. Never expose secrets and never treat CI alone as proof of live Telegram health.
