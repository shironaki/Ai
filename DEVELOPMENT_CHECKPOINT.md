# DEVELOPMENT_CHECKPOINT.md

## Canonical TEST continuation — 2026-10-01 — runtime recovery hardening

### Current state
- Repository: `shironaki/Ai`
- Active branch: `test-global-assistant-upgrade`
- Latest commit: `84179b9e0e288c08d5172188f5588ca836ad945e`
- Draft PR: #22, base `main`; main/PROD remains untouched.
- GitHub Actions `Python integrity check` run #509: **completed / success**.
- Job `check`: all steps completed successfully, including compile, application import, AI-without-credentials check, and runtime regression tests.

### Failure that was fixed in this block
The bot can be alive as a `run.py` process while Telegram polling is unhealthy. Previously, the recovery path could detect that unhealthy state and call `start_bot` without first stopping the stale process. With Telegram long polling, that can create a second polling process and produce a 409 conflict loop.

### Fix
- `autoupdate.sh` now distinguishes:
  - healthy process -> leave it alone;
  - unhealthy existing process -> stop the stale process first, then start exactly one replacement;
  - no process -> start recovery normally.
- `codespace_boot.sh` applies the same stale-process recovery rule during boot.
- Added regression coverage for the recovery invariant in `tests/test_runtime.py`.
- Existing real health-check remains authoritative: fresh asyncio heartbeat + Telegram `getMe` + no webhook + no recent polling conflict.

### Verified
- CI run #509 for `84179b9...`: success.
- Runtime regression tests: success.
- No secret values were added or exposed.
- PROD/main was not modified.

### Still unresolved / requires live contour
The repository cannot itself prove the currently running Codespace/Termux process state. The next required action is live runtime verification:
1. Codespace: run the current TEST recovery path and verify Telegram response.
2. If Codespace is down, execute the boot/recovery path and inspect the resulting health-check state.
3. Termux: perform the first real-device update -> tests -> restart -> health-check cycle.
4. Only after those live checks pass, close the hardening block and continue to the planned global typed command executor / target-scope resolver work.

### Operating rule
Do not declare runtime healthy from CI alone. CI success is necessary but not sufficient; live Telegram health must be verified before moving on.
