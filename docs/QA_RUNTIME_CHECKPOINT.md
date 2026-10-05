# QA / Runtime / Audit Checkpoint

Updated: 2026-10-05

## Mandatory autonomous execution protocol
- Work continuously without an unnecessary stop. A multi-step task is not a reason to pause.
- Execute everything technically possible through the repository, CI, GitHub, QA-agent, runtime-control, logs, telemetry, and project interfaces.
- Read and correlate code, tests, CI, runtime telemetry, diagnostic logs, QA markers, issue-control results, and relevant project artifacts before concluding a problem is unresolved.
- If something is broken, fix the root cause. Do not hide, suppress, or merely silence symptoms.
- If something is not implemented, implement it according to the established architecture, security model, and role/capability rules.
- Self-review every substantive code change against surrounding code, call sites, tests, RBAC/security rules, and regression risks before calling it complete.
- Run relevant tests after substantive fixes and keep iterating until applicable CI is green. Never declare success while CI is failing or materially unverified.
- Never claim a live action, runtime control, QA scenario, log observation, or CI result without direct evidence from the corresponding result source.
- Never fabricate progress, success, telemetry, test results, or capabilities.
- Do not loop on an ineffective approach. Diagnose the failure, change the approach, and move forward.
- Physical/manual actions are the user's responsibility only when they genuinely cannot be performed through the available control plane. Everything else remains the assistant's responsibility.
- Continue until the current objective is resolved or a concrete external blocker is proven with evidence.

## Non-negotiable quality gates
- Founder and QA are separate identities; never conflate them.
- Founder is the immutable global bot creator. QA is the isolated Telethon test account and never Founder.
- Effective role must equal capabilities. Do not reintroduce hidden Telegram-admin/tech-team gates where the role model says otherwise.
- Chat isolation is mandatory:
  - Test supergroup -1004300830848: QA = Владелец чата.
  - Аи supergroup -1002128213860: QA = Модератор.
  - QA authority in one chat must never leak into another.
- QA markers are Founder-only.
- No intentional silent failure.
- No hidden RBAC bypass.
- Live QA claims require a QA-AGENT-RESULT.
- Runtime-control claims require a corresponding runtime control result.
- CI green is the completion gate for code changes unless a documented external infrastructure failure prevents CI execution.
- Termux/Phone 2 setup is closed unless a concrete runtime failure blocks development.

## Live QA control plane
Repository contains scripts/qa_agent.py, an isolated Telethon agent controlled through GitHub Issue #27.
Commands:
- QA-AGENT-CONTROL / STATUS
- QA-AGENT-CONTROL / RUN <scenario>
- QA-AGENT-CONTROL / RUN all
- QA-AGENT-CONTROL / DIALOGS
- QA-AGENT-CONTROL / LOGS
Results use QA-AGENT-RESULT.

Verified 2026-10-05:
- QA STATUS returned ONLINE.
- QA Python: /data/data/com.termux/files/home/Ai/qa_client/.venv/bin/python
- session present; api_hash present; target AiAether1_Bot.
- QA dialogs include Test supergroup 4300830848, basic group 5245105577, and Аи supergroup 2128213860.
- Earlier live RUN smoke succeeded with real Telegram replies.

Important: if a newly added scenario is unknown, runtime checkout/scenario files are stale; this is NOT evidence that QA is unavailable.

## Runtime control plane
Permanent runtime channel: GitHub Issue #23.
Known commands include STATUS, UPDATE, AUTO_FAILOVER, FORCE PHONE1 ACTIVE, and supported FORCE PHONE2 ACTIVE.
Never claim a runtime control executed without its corresponding result.
Known healthy telemetry: HEALTH OK: bot_heartbeat=... role=active telegram=@AiAether1_Bot polling=ready ai=ready.

## Exact stopping point
1. Sent QA STATUS via Issue #27; it returned ONLINE/session present/api_hash present.
2. Sent RUN role_matrix_command_surface_v2.
3. QA returned ValueError: unknown scenario: role_matrix_command_surface_v2.
4. Current repository qa/scenarios.json DOES contain that scenario.
5. Therefore the immediate task is to synchronize/deploy current branch QA scenario/code to the runtime checkout, then rerun live.
6. Runtime control Issue #23 later stopped acknowledging new commands; telemetry shows repeated lease GitHub API timeouts while the bot watchdog intermittently repairs the active bot.
7. Root cause found in control queue: it fetched only the first 10 oldest comment pages, so a large Issue #23 hid new commands. Fixed in termux_control.py with newest-first paging.
8. Root cause found in QA/runtime sync: untracked qa/scenarios.json was intentionally preserved by termux_update.sh. Fixed updater to synchronize explicitly owned QA runtime files with backup.
9. Root cause found in live QA RUN all: report publication hit GitHub HTTP 422 because per-scenario log tails made the report too large. Fixed QA agent with bounded reports and diagnostics-on-failure.
10. Supervisor now restarts termux_control.py when its script hash changes, so pulled control fixes become active without manual process surgery.

## Next sequence
A. Allow the fixed runtime updater/supervisor/control chain to converge; do not rebuild Termux generically.
B. Verify QA STATUS shows the refreshed agent/catalog.
C. Run role_matrix_command_surface_v2 live and verify real Telegram replies.
D. Run focused role/isolation scenarios and then RUN all.
E. Correlate every live failure with bot/runtime logs, diagnostic journal and QA markers; fix root causes, never merely suppress notifications.
F. Re-run static regression tests and CI after fixes.
G. Continue full command/role/capability audit only after live QA is operational and CI is green on the final head.

## Code audit state
Recent fixes include chat-aware role resolution; Telegram authority TTL/startup/new-chat warmup; role-based moderation without hidden admin gates; Founder-only markers; chat-aware report-center authorization/callbacks; authoritative runtime diagnostics/status handlers; background diagnostic telemetry; sanitized runtime errors; bounded AI timeout/timing; chat-aware profile/info; fresh silence confirmation.

Latest confirmed CI: workflow #1854 / run 37310936770, commit f42e99c9316ea33b5e8ebae2b382467a2f736572, success. Later runtime-control/QA synchronization fixes are on the current PR head and require a fresh CI result before being considered complete.

## Evidence rule
Never claim a live Telegram command was tested without a QA result showing sent command + observed reply. Never claim runtime control executed without its result. Never infer infrastructure is unavailable from a stale artifact; inspect the update/supervisor path first.

This file is the continuity source for subsequent chats.
