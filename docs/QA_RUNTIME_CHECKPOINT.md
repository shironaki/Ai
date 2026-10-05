# QA / Runtime / Audit Checkpoint

Updated: 2026-10-05

## Protocol
- Founder and QA are separate identities; never conflate them.
- Founder is the immutable global bot creator. QA is the isolated Telethon test account and never Founder.
- Effective role must equal capabilities. Do not reintroduce hidden Telegram-admin/tech-team gates where the role model says otherwise.
- Chat isolation is mandatory:
  - `Тест` supergroup `-1004300830848`: QA = `Владелец чата`.
  - `Аи` supergroup `-1002128213860`: QA = `Модератор`.
  - QA authority in one chat must never leak into another.
- QA markers are Founder-only.
- Termux/Phone 2 setup is closed unless a concrete runtime failure blocks development.
- Before saying live testing is unavailable, inspect/use the existing QA/runtime infrastructure.

## Live QA control plane
Repository contains `scripts/qa_agent.py`, an isolated Telethon agent controlled through GitHub Issue #27.
Commands:
- `<!-- QA-AGENT-CONTROL -->\nSTATUS`
- `RUN <scenario>`
- `RUN all`
- `DIALOGS`
- `LOGS`
Results use `<!-- QA-AGENT-RESULT -->`.

Verified 2026-10-05:
- QA `STATUS` returned ONLINE.
- QA Python: `/data/data/com.termux/files/home/Ai/qa_client/.venv/bin/python`
- session present; api_hash present; target `AiAether1_Bot`.
- QA dialogs include `Тест` supergroup 4300830848, basic group 5245105577, and `Аи` supergroup 2128213860.
- Earlier live `RUN smoke` succeeded with real Telegram replies.

Important: if a newly added scenario is unknown, runtime checkout/scenario files are stale; this is NOT evidence that QA is unavailable.

## Runtime control plane
Permanent runtime channel: GitHub Issue #23.
Known commands include `STATUS`, `UPDATE`, `AUTO_FAILOVER`, `FORCE PHONE1 ACTIVE`, and supported `FORCE PHONE2 ACTIVE`.
Never claim a runtime control executed without its corresponding result.
Known healthy telemetry: `HEALTH OK: bot_heartbeat=... role=active telegram=@AiAether1_Bot polling=ready ai=ready`.

## Exact stopping point
1. Sent QA `STATUS` via Issue #27; it returned ONLINE/session present/api_hash present.
2. Sent `RUN role_matrix_command_surface_v2`.
3. QA returned `ValueError: unknown scenario: role_matrix_command_surface_v2`.
4. Current repository `qa/scenarios.json` DOES contain that scenario.
5. Therefore the immediate task is to synchronize/deploy current branch QA scenario/code to the runtime checkout, then rerun live.
6. `UPDATE` was sent to Issue #23 but no result was observed in the checked window; do not assume it executed.
7. `FORCE PHONE2 ACTIVE` was then sent; its result was not yet confirmed at checkpoint time.

## Next sequence
A. Restore runtime checkout freshness for `scripts/qa_agent.py` + `qa/scenarios.json` using the existing supervisor/update mechanism; do not rebuild Termux generically.
B. Verify QA `STATUS`.
C. Run `role_matrix_command_surface_v2` live.
D. Run focused role/isolation scenarios and then `RUN all`.
E. Correlate every live failure with bot/runtime logs, diagnostic journal and QA markers; fix root causes, never merely suppress notifications.
F. Re-run static regression tests and CI after fixes.
G. Continue full command/role/capability audit only after live QA is operational.

## Code audit state
Recent fixes include chat-aware role resolution; Telegram authority TTL/startup/new-chat warmup; role-based moderation without hidden admin gates; Founder-only markers; chat-aware report-center authorization/callbacks; authoritative runtime diagnostics/status handlers; background diagnostic telemetry; sanitized runtime errors; bounded AI timeout/timing; chat-aware profile/info; fresh silence confirmation.

Latest CI requiring recheck: workflow #1854 / run `37310936770`, commit `f42e99c9316ea33b5e8ebae2b382467a2f736572`. Do not call it green until rechecked.

## Evidence rule
Never claim a live Telegram command was tested without a QA result showing sent command + observed reply. Never claim runtime control executed without its result. Never infer infrastructure is unavailable from a stale artifact; inspect the update/supervisor path first.
