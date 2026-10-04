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


## Administrative panel audit — 2026-10-03
- Full command surface was audited against the runtime handlers and command registry.
- Founder/administrator panel now exposes the operational runtime controls that previously existed only as slash commands: runtime status, diagnostics, battery, logs, debug, restart, AI diagnostic, stasis/awakening, broadcasts, invocation names, QA markers, and Termux HA.
- Added explicit `/panel` and natural-language panel requests for authorized staff.
- Panel navigation now keeps per-user/per-chat history; **Назад** returns to the actual previous panel state instead of a hard-coded menu.
- Reports were moved onto the same navigation path so report list/view/answer screens participate in panel history.
- Restart from the panel requires explicit confirmation.
- Global runtime actions are registered with the unified undo system and can be cancelled from another chat; this fixes the case where global Stasis was active but the panel reported no last action.
- Command registry now includes the runtime commands `/status`, `/diagnostics`, `/battery`, `/charge`, `/restart`, and `/panel`.
- Regression coverage was expanded for panel callbacks, navigation, runtime undo, command catalog, and Termux supervisor PID syntax.
- CI run `1143` on commit `bbe8d4280916b87f360329cbaa4b78813b00fb73` completed successfully: compile/import/runtime regression suite passed.
- A hidden Termux supervisor PID regression was found during this audit and fixed: supervisor now writes its real shell PID using the shell PID variable.
- Current branch head: `bbe8d4280916b87f360329cbaa4b78813b00fb73`.

## Next development focus
Return to bot feature work from this audited branch. Do not reopen the panel/Termux architecture unless a concrete regression appears.

## Final handoff update — 2026-10-04

- Current branch: `test-global-assistant-upgrade`.
- Latest checkpoint commit: `33ae46a9a6cb68a4547c90abdf9e9650de6c92bc`.
- `main/PROD` remains untouched.
- Security hardening is now the baseline, not an optional follow-up:
  - permission boundaries rechecked;
  - Telegram exfiltration surfaces rechecked;
  - AI context/history isolation rechecked;
  - report recipient/operator binding rechecked;
  - diagnostics/logs/errors credential-redacted;
  - runtime logs confined to protected `BOT_DATA_DIR`;
  - data/log POSIX permissions hardened;
  - retention limits and storage redaction active;
  - updater log initialization order corrected;
  - stale historical `aboute.py` search results verified as non-current; file is absent from the current branch.
- Repository self-audit found no new `eval`, `exec`, `shell=True`, `os.system`, or TODO/FIXME/HACK residue in the current branch.
- Do not delete working modules merely because GitHub search exposes an old historical snapshot; verify the current branch first.
- Latest green CI before the documentation-only checkpoint: Python integrity check #1418 / commit `4d159ad385dfece709cf449eee3a1d107c0e6327`, SUCCESS.
- The checkpoint update itself is documentation-only; it does not change runtime behavior.
- Next work: feature development. Every new feature must receive the same security self-audit, regression coverage, and green CI gate.

