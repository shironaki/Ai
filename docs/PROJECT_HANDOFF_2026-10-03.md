# Project Handoff — 2026-10-03

## Current branch
- `test-global-assistant-upgrade`
- Latest functional changes include the Termux high-availability layer and emergency takeover.
- Latest panel commits:
  - `3fb067a` — Termux HA controls in Founder system panel.
  - `1df4ef7` — test coverage for the Termux HA panel.

## Termux two-phone HA — completed
- Two phones: `phone1` and `phone2`.
- Exactly one bot polling process is intended to be active.
- Each phone runs a persistent Termux supervisor; standby keeps the supervisor alive but the bot stopped.
- Role state: `data/test/runtime/termux-role`.
- Central lease: branch `termux-lease`, file `lease.json`.
- Default lease TTL: 120 seconds.
- Automatic failover is enabled by default.
- Active bot is fenced by `scripts/termux_lease_watchdog.py`.
- Supervisor heartbeat and bot heartbeat are used by healthcheck.
- Normal role switching uses Issue #23:
  - `ROLE phone1 ACTIVE`
  - `ROLE phone1 STANDBY`
  - `ROLE phone2 ACTIVE`
  - `ROLE phone2 STANDBY`
- Emergency takeover uses:
  - `FORCE phone1 ACTIVE`
  - `FORCE phone2 ACTIVE`
- FORCE is target-specific, replaces the central lease, waits the configured fence interval (minimum 15s; default 20s), starts the bot, verifies health, and rolls the lease back on failed healthcheck.
- FORCE is an emergency control; normal switching should use ROLE.
- Fencing is not an absolute guarantee if the old device is completely unreachable.

## Founder panel
The System panel now contains **📱 Termux HA** with:
- **ROLE — штатное переключение**
- **FORCE — аварийный takeover**
and the exact Issue #23 command syntax.

The panel only documents/organizes these controls; it does not silently execute GitHub Issue commands.

## Current bot work state
- Founder/runtime gateway, owner registration refresh, command registry/help, AI service hardening, moderation/report panels, and runtime health controls are already in the current branch history.
- Return to bot feature development from the current branch; do not reopen the finished two-phone HA design unless a concrete defect is found.
- Keep `main`/PROD untouched.
