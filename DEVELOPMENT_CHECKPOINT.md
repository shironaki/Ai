# DEVELOPMENT_CHECKPOINT.md

## Canonical TEST continuation — 2026-10-02 — live Termux verification

### Current state
- Repository: shironaki/Ai
- Active branch: test-global-assistant-upgrade
- Latest TEST runtime verified commit: fb0abf7aab825d91ca68cca1a6e1099d444eafa0
- Latest TEST code/QA commit: `5b7f4c3804e55e4d8855d99b96e14eb980d85c58`.
- Draft PR: #22, base main; main/PROD remains untouched.
- Persistent live diagnostics: GitHub Issue #23.
- Termux bot and supervisor are running and polling is healthy; live health reports `ai=ready`.
- Founder identity is verified live: Telegram owner 1057867710 is recognized; /start reports an existing user and the natural status request is handled by the founder path.
- Screenshot verification: the visible role label is correctly rendered as `👑 ОСНОВАТЕЛЬ`.

### Live findings
- Fresh telemetry at 23:54:44 showed HEALTH OK, polling ready, bot PID 22305 and supervisor PID 8390.
- Live Telegram log confirms owner ID 1057867710, `/start: existing user`, and dispatch through `founder_direct_command`.
- The previous AI fallback was caused by a missing runtime `GROQ_API_KEY`; this has now been provisioned outside Git and live health reports `ai=ready`.
- The updater already sources `~/.config/ai/termux.env`, so a `GROQ_API_KEY` placed there is inherited by the bot/supervisor on restart.
- Never store the actual key in Git or telemetry.

### Implemented
- Healthcheck now reports `ai=ready` or `ai=unconfigured` without exposing the key.
- Termux telemetry now publishes AI configuration state and model name, never the key.
- AI fallback wording now accurately identifies a missing runtime provider key instead of referring generically to host secrets.
- Founder identity/label code was not changed because live verification shows it is working.
- QA marking path was exercised successfully: the bot accepted an issue marker and assigned a QA ID.

### Remaining external dependency
- `GROQ_API_KEY` is provisioned in protected Termux environment storage; the actual secret is not stored in Git or telemetry.
- Live Telegram AI response has been manually verified by the founder.
- Fresh healthcheck confirms `ai=ready` after supervisor recovery.

### Success criteria
- Telegram polling ready;
- `ai=ready` when the provider secret is configured;
- bot process running;
- supervisor process running;
- founder identity and label remain correct;
- QA issue marking and owner QA-list access work;
- no dependency/bootstrap regressions;
- Founder natural moderation execution uses the shared confirmation path (fixed and regression-guarded in TEST).

### QA progress
- CI run #610 on `5ab59b6` completed successfully.
- Found and fixed a real founder moderation bug: the founder branch called `confirm()` without first storing the intent, so the shared executor immediately returned without executing. Fixed in `services/moderation_gateway.py` and guarded by `tests/test_moderation_gateway.py`.
- The moderation fix is on TEST history and is included in current HEAD `5ab59b621b75189079a0eb9b584cc31d568f71c8`.

### Operating rule
Continue working from TEST only. Verify fresh Termux telemetry after runtime changes. Keep main/PROD untouched until live TEST is fully verified and explicitly approved for promotion.

### Deployment pipeline finding
- The repository contains no `wrangler.toml`, `wrangler.json/jsonc`, `package.json`, or Cloudflare Worker source/config matching the repeated Cloudflare preview failures.
- PR #22 is receiving Cloudflare preview failures for TEST commits, while the repository checkpoint explicitly states Cloudflare Workers is not the current deployment target; production target is Render Background Worker.
- Treat the Cloudflare preview as an external/stale integration signal, not as a Telegram runtime blocker. Do not modify Telegram runtime architecture to satisfy it.

### Current QA continuation
- Stage 2C/2D review confirms the typed command registry/policy exists, but Founder stasis/awakening still has a Founder-specific gateway and moderation has its own target handling.
- Security regression coverage added in `tests/test_security_regression.py`: scope isolation, destructive confirmation, pending-state binding to user+chat, and audit metadata secrecy.
- Shared conservative target/scope resolution is now in `core/command_resolution.py` and is integrated into Founder/moderation gateways; explicit reply targets only, allowlisted scopes only.
- Regression coverage added in `tests/test_command_resolution.py`.
- CI run #616 for prior checkpoint was green; awaiting CI for this new resolver chain.
- Next: inspect command dispatch wiring and confirmation handlers for cross-command pending-state collisions, then add regression coverage. Keep game commands isolated and main/PROD untouched.


### QA continuation result — 2026-10-02
- CI run #626 for f5f264de completed successfully.
- Cross-command confirmation review found a real handler-level collision risk: a pending Founder scope handler matched arbitrary non-command text before moderation confirmation/action handlers, so a Founder with a pending scope clarification could consume подтверждаю or a new moderation request.
- Fixed on TEST by restricting Founder scope dispatch to explicit scope phrases and centralizing the resolver in core/command_resolution.py (is_founder_scope_reply).
- Added regression coverage in tests/test_security_regression.py; the first test attempt correctly exposed a CI-safe import problem because handlers.help imports the live-token main.py, so the test was moved to the pure shared resolver instead.
- Final TEST commit: a96960f577b0a2c3a524e4cea110ea2a183abbd2.
- CI run #639 on the final fix completed successfully (67 tests).
- Result: Founder scope clarification, moderation confirmation, cancellation, and moderation command routing no longer collide at this handler boundary.
- Next QA stage: continue deterministic dispatch review around other shared natural-language handlers and confirmation/cancellation precedence; do not touch main/PROD.


### Global dispatch hardening — 2026-10-02
- Removed the duplicate legacy `/help` message handler from `aboute.py`; authoritative `/help` remains `handlers/help/command_help.py`.
- Fixed the legacy `chat_rassilka` callback owner check to use `call.from_user.id` instead of an undefined `message` object.
- Added `tests/test_dispatch_regression.py` covering single authoritative `/help` routing and the callback regression.
- CI run #645 for this dispatch hardening commit completed successfully.
- Next: continue the broad legacy-handler audit, prioritizing destructive/admin commands and deterministic natural-language routing. Main/PROD remains untouched.

- Unified legacy slash moderation: `/mute`, `/unmute`, `/ban`, `/unban` compatibility handlers in `handlers/admin/apanel.py` now delegate to `services.moderation_gateway`, so confirmation/policy/audit logic is no longer bypassed. Regression coverage added; CI run #651 is green.

### Global administration redesign — 2026-10-02
- Human administration roles were separated from the AI/SYSTEM identity.
- Active human hierarchy is now: Пользователь → Модератор → Хелпер → Администратор → Основатель.
- «Система» is no longer an assignable user status; it denotes the AI/service layer.
- Game-only «Игрок», profile/economy actions and balance mutation commands are disabled from the active administration surface.
- Central role assignment rules were added in `core/role_transitions.py`: lower roles can only grant lower roles; self-promotion and AI/SYSTEM/game roles are rejected.
- The legacy `/dev` dashboard was replaced by a role-aware multi-level administration panel in `handlers/help/help.py`; unavailable functions are not rendered for a role.
- Moderation is presented as one panel section; mute/unmute/ban/unban remain internal compatibility intents while execution stays centralized in `services/moderation_gateway.py`.
- The old barrier concept was removed from the admin command surface and replaced by panel «Тишина» semantics for the whole chat.
- `/System` and legacy System-status elevation were removed from active administration paths.
- `/start` is now restricted to private chats.
- Help was changed from a public command catalog into a button-first interface; AI invocation is unified around «Аи» and «Система», with «Мила» removed.
- User/chat information was made factual and game-independent; Telegram account creation date is explicitly reported as unavailable rather than invented.
- A separate `services/chat_members.py` directory now tracks join/leave observations independently from the global users table.
- New member greetings are generated by AI when no custom chat greeting is configured; moderators can set a fixed greeting or return to automatic AI greetings through the panel. Leave messages are also emitted.
- A separate `services/report_service.py` now stores user reports, assigns stable IDs, provides owner/admin review and per-report replies, and schedules reminders for unanswered reports every two hours.
- QA markers are now internal diagnostics: users no longer create or close them through the public command surface; only the Founder can read the QA list, while status changes are an internal engineering responsibility.
- Public profile remains reserved for the future game subsystem; `инфа` is the active factual information surface.
- CI #731 for the resulting TEST head completed successfully with 75 tests.
- Main/PROD remains untouched. The next block is the deeper chat administration/membership layer, report workflow hardening, and full panel migration of remaining legacy administration actions.

## Current protocol checkpoint — 2026-10-02

Branch: `test-global-assistant-upgrade`. Main/PROD untouched.

Completed in the current admin block:
- Unified broadcast: one founder-only panel flow for users/chats/all; legacy `rassilka` and `chat_rassilka` handlers removed.
- Unified cancellation: `cancel`/`отмена`/`стоп` synonyms share one cancellation service; panel has «Отменить текущее действие».
- Legacy `aboute.py` handler module removed from startup and deleted because it still registered deferred game/profile/economy handlers despite `GAME_DISABLED` comments.
- Deterministic AI relationship layer added:
  - score -100..100;
  - negative relation can block AI calls;
  - max positive enables alternate invocation names and no-call private AI responses;
  - founder is fixed at 100 and never blocked;
  - primary/alternate invocation names are configurable and persist in SQLite, with environment defaults.
- Founder panel now exposes AI relationship controls and invocation-name settings.
- New regression coverage added for broadcast, cancellation and AI relationship.
- Latest verified CI run: run #897, green, all runtime regression tests passed.

Latest callback fix (2026-10-02): panel callback dispatch is instrumented, callback exceptions now produce visible Telegram feedback + diagnostics, and unknown/obsolete inline callbacks are answered instead of silently ignored. CI #907 is green.

Runtime/UI verification block completed (2026-10-02):
- All panel callback families statically audited; every current callback has a matching handler/answer path, with explicit fallback for obsolete callbacks.
- Natural-language command-list requests are deterministic and render the authoritative registry instead of going to the LLM.
- AI response ceiling increased from 350 to 700 tokens and prompt now requires complete thoughts; typing indicator added during provider generation.
- Runtime diagnostics now record handler/callback duration_ms.
- run.py now uses a per-environment non-blocking PID/file lock to prevent duplicate polling instances.
- CI #925 green; runtime regression suite remains green (88 tests in preceding full run).

Next required work:
1. Fresh Termux/runtime verification of the latest TEST branch; do not claim live deployment until observed.
2. Continue admin/security audit: role assignment paths, chat-founder/admin synchronization, report cadence/forwarded payloads, startup/update delivery.
3. Only after admin block remains green and runtime-verified, continue AI relationship refinement if needed, then AI character/personality block.
4. Keep game/economy/profile disabled and keep Main/PROD untouched.



## UPDATE × HA checkpoint — 2026-10-03

Продолжение протокола после lease/failover hardening.

- `scripts/termux_update.sh` теперь загружает `TERMUX_DEVICE_ID` после `termux.env`, поэтому device identity не теряется при bootstrap.
- Active runtime перед code update останавливается; обновление и последующий restart допускаются только при свежем центральном lease.
- Lease перепроверяется после code update, установки зависимостей, тестов и непосредственно перед restart.
- Standby может синхронизировать код, но не устанавливает runtime dependencies и не запускает бота.
- При GitHub/update failure active runtime может быть поднят обратно только при свежем lease; standby не запускается.
- Rollback теперь получает именно pre-update commit через `TERMUX_UPDATE_ROLLBACK_COMMIT`; прежний дефект, при котором rollback мог указывать на уже обновлённый `HEAD`, устранён.
- Потеря lease во время update оставляет runtime остановленным; старый/вернувшийся телефон не может самовольно восстановить active состояние.
- Если второй телефон становится active во время update, следующая lease-проверка fencing останавливает старый runtime и запрещает restart.
- Последний CI: Python integrity check run #1335 (`37123124349`) — SUCCESS; job `check` `111202997005`, runtime regression suite: 148 tests, OK.
- Main/PROD не изменялся; рабочая ветка остаётся `test-global-assistant-upgrade`.

Следующий крупный блок протокола: финальный сквозной аудит Termux supervisor/watchdog/update/control на предмет оставшихся race-window между lease renewal, healthcheck, process PID и GitHub outage, затем live TEST verification.


## Final runtime race-window checkpoint — 2026-10-03

Сквозной аудит supervisor/watchdog/control/update завершён.

- scripts/termux_supervisor.sh: добавлен singleton lock; повторный supervisor не запускается.
- Singleton lock имеет stale-lock recovery только после проверки существующего PID и command line; случайный PID не считается живым supervisor.
- scripts/termux_lease_watchdog.py: PID из termux-bot.pid теперь проверяется по command line (run.py) до SIGTERM; stale/reused PID не позволяет убить посторонний процесс.
- scripts/termux_control.py: restart_bot() повторно проверяет центральный lease непосредственно перед запуском процесса, закрывая TOCTOU между первоначальной проверкой команды и Popen.
- Existing lease watchdog остаётся последним локальным fencing-механизмом: при потере lease или истечении последнего достоверно наблюдённого expiry бот останавливается; при невозможности получить initial lease watchdog fail-closed.
- run.py сохраняет локальный file lock против двух polling-process на одном устройстве.
- scripts/termux_update.sh остаётся fenced на каждом restart boundary и не запускает standby; rollback использует pre-update commit.
- Последний CI: Python integrity check #1349 (37129298543) — SUCCESS; job check 111221021327; runtime/security suite: 151 tests, OK.
- Дополнительный duplicate CI #1348 также SUCCESS.
- Main/PROD не изменялся; рабочая ветка test-global-assistant-upgrade.

Следующая точка: live TEST verification на двух физических Termux runtime — active/standby, lease renewal, controlled failover, return of old device, UPDATE и healthcheck. Кодовый race-аудит завершён.


## Security: data/storage privacy hardening — 2026-10-03

- SQLite runtime data remains outside Git and under `BOT_DATA_DIR`.
- SQLite connections enable `foreign_keys`, busy timeout and `secure_delete=ON`.
- Runtime `bot.log` is stored inside `BOT_DATA_DIR` and is chmod 600 on POSIX; data directory is chmod 700.
- Diagnostic journal is bounded to 14 days / 5000 rows and stores redacted exception/context data.
- QA issue markers retain only bounded history; fixed/broken entries expire after 30 days / 3000 rows, and stored message/reason text is credential-redacted.
- User reports retain open cases; answered cases expire after 90 days / 5000 rows, with reason/payload credential-redaction.
- Git ignores SQLite, WAL/SHM, logs, runtime data, secrets and PID/lock files.
- Admin log viewer already redacts credential patterns before Telegram rendering.
- TEST/PROD data paths remain isolated through `BOT_ENV` / `BOT_DATA_DIR`.
- Next security block: compromise recovery / backup hygiene and remaining privacy paths.

## Final security/self-audit checkpoint — 2026-10-04

- Рабочая ветка: `test-global-assistant-upgrade`; `main/PROD` не изменялся.
- Завершён крупный self-audit по Telegram exfiltration, runtime logs, diagnostics, exceptions и legacy-хламу.
- Runtime logs унифицированы через `BOT_DATA_DIR`; `autoupdate.sh` и `scripts/termux_update.sh` больше не должны создавать рабочие bot/update logs в корне репозитория.
- `BOT_DATA_DIR` инициализируется до создания updater logs; POSIX permissions: data dir 700, logs 600.
- Добавлен credential-redacting logging formatter; runtime exceptions/tracebacks и диагностические ответы перед Telegram также проходят redaction.
- Admin log/diagnostic output остаётся redacted перед рендерингом.
- AI history/context isolation и report operator/recipient boundaries повторно проверены; прямых cross-user data paths не обнаружено.
- Проверены command/callback permission boundaries, public health/debug/system/profile/chat-info surfaces и SQL data layer; пользовательский ввод не получает executable SQL/Python capability.
- Проверен repository tree: `aboute.py` в текущей ветке отсутствует; найденные GitHub search hits по нему относятся к старым историческим commit snapshots и не являются текущим кодом.
- Проверен поиск опасных конструкций: текущий security audit не обнаружил новых `eval`, `exec`, `shell=True`, `os.system` или TODO/FIXME/HACK-хвостов в рабочей ветке.
- Не удалялись рабочие модули только по имени/старому индексу GitHub: удаление выполнялось бы только после подтверждения отсутствия текущих references.
- Добавлены regression tests для Telegram exfiltration redaction и защищённого runtime log location.
- Последний CI: Python integrity check #1418, commit `4d159ad385dfece709cf449eee3a1d107c0e6327` — **SUCCESS**; compile/import/AI-no-credentials/runtime regressions/direct dependency audit/legacy dependency report — зелёные.
- Следующий этап: переход от security hardening к функциональным фичам, сохраняя правило: каждая новая фича проходит permission/security self-audit и regression CI перед переходом дальше.

## AI memory feature checkpoint — 2026-10-04

- Implemented the first functional AI-memory block on `test-global-assistant-upgrade`.
- AI conversation context is now persistently stored in `ai_memory.db`, outside Git and under the protected `BOT_DATA_DIR`.
- Memory scope is strictly `(user_id, chat_id)`; the bot does not archive arbitrary group messages and one user's AI context cannot be loaded into another user's context.
- Stored turns are credential-redacted and bounded to 30 days / 40 messages per user+chat scope.
- Existing provider history remains capped to the short active context window; persistence survives bot restarts without sending unrelated chat history to the provider.
- Added user-controlled deletion of the current AI conversation memory through `/forget`, `/забудь`, and deterministic natural-language requests such as «Аи, забудь мою историю».
- Deletion clears both persistent storage and the current in-process AI cache for the exact user+chat scope.
- Added regression coverage for cross-user/cross-chat isolation, credential redaction, persistence across process-memory loss, and command routing.
- Security rule preserved: no global/shared AI memory and no automatic ingestion of ordinary group messages.
- Main/PROD remains untouched.
- Next functional block: richer personal preferences and AI behavior settings, built on the same isolated memory/security boundary.


## Protocol checkpoint — 2026-10-06 — role/runtime continuation

- Active branch: `test-global-assistant-upgrade`; Main/PROD remains untouched.
- Canonical human-role model remains: hidden immutable Founder; local Telegram creator = Administrator; local assignable Moderator; global Founder-assigned Helper; default User.
- Telegram `administrator` status is deliberately **not** bot Administrator authority; only actual creator/owner maps to local Administrator.
- Global Helper is technical/report-center staff only and must not inherit local moderation powers.
- Local roles are keyed by `(chat_id,user_id)`; report access is global only for Founder/Helper and chat-scoped for local Administrator/Moderator.
- Latest verified CI before this checkpoint: run `37472221050` (#2122), commit `ce75e84cf6061e9749c170352896467b3dc29301` — **SUCCESS**. Runtime regression suite passed; previous runtime-stop and QA target-bot boundary fixes are verified.
- Deep audit found one real hidden panel defect: the role-assignment button was rendered for global Helper even though Helper has no role-assignment authority, and `_apply_panel_role()` referenced `set_role` without importing it. Fixed in `fe8254deaf39767da8122ee6707573b0bd7803d9`.
- Regression guard added in `80d87fff1c52a192bb9a890b16d6e6ae1f52ddc0`: Helper no longer receives the role-assignment UI; panel role writer import/use is explicitly checked.
- CI for current HEAD `80d87fff1c52a192bb9a890b16d6e6ae1f52ddc0` is currently in progress: Python integrity check run `37475816318` (#2125), job `112310801456`. Setup/dependency installation is running; compile/import/runtime regression steps have not completed yet. Do **not** call this HEAD green until the run completes.
- QA agent review: `QA_TARGET` is resolved once to a concrete bot entity and reply acceptance is bound to that bot ID. Scenario `target` values are chat targets, not alternate bot targets, so the current binding is consistent with the scenario format.
- Pending/cancellation state was audited: command, moderation, panel, report and runtime reversible state use `(user_id,chat_id)` boundaries; global runtime undo additionally uses an explicit global key `(user_id,0)`.
- Role-callback hardening commit `22b41148d078aada88920cfa52b8c433604e1710` and regression `51d6cf87bd4eead25b17d4249f5976ddbb11aaf7` are verified by CI run `37476021772` (#2133) — **SUCCESS**.
- A deeper AI scope audit then found a real Telegram welcome-path issue: `handlers/chat_groups.py` called `generate_reply()` without `chat_id`, which could reuse user-only AI history/rate-limit state across chats. Fixed in `75e454052d73811896286408693432f0774abf87` and regression-locked in `6ff36e0745bb0ca520761bc916e55b908bfdb13d`.
- Current branch HEAD at checkpoint writing time: `6ff36e0745bb0ca520761bc916e55b908bfdb13d`.
- CI for current HEAD is in progress: run `37476105615` (#2138). Install dependencies is still running; no green conclusion yet.
- Continue next from current HEAD after verifying run #2138; then continue the broad hidden-code audit and live Termux verification. Main/PROD remains untouched.: first verify CI #2125, then continue broad hidden-code audit of panel callbacks, local settings/chat state, moderation target state, report scope, and Termux live runtime. Routine work continues without unnecessary stopping.

## Protocol checkpoint — 2026-10-06 — role/runtime deep audit continuation

- Branch: `test-global-assistant-upgrade`; Main/PROD remains untouched.
- Latest verified TEST commit: `4633e7b8dc3569bf7e335d385df846062a984e8b`.
- CI run `37482727658` (#2151) for that commit: **SUCCESS**. Compile, import, AI-no-credentials, runtime regression tests, direct dependency audit and legacy transitive dependency audit all passed.
- Role boundary fix: `core/permissions.py` now gives the current chat's real Telegram creator `Администратор` authority even when the same person is globally `Хелпер`. The global Helper identity remains global for report/technical access, while Helper without local creator authority still cannot moderate.
- Regression added: `test_global_helper_who_owns_chat_keeps_local_admin_authority`.
- Termux updater fix: `scripts/termux_update.sh` now writes the QA hash with a real newline; the previous literal `\\n` caused hash mismatch and could restart QA-agent repeatedly. Regression: `test_termux_update_writes_qa_hash_with_real_newline`.
- Termux control fix: `scripts/termux_control.py::restart_bot()` now force-fences a bot that survives the graceful timeout and preserves PID state if the old process remains alive; it cannot unlink the PID and spawn a duplicate. Regression: `test_termux_control_restart_preserves_pid_if_old_bot_survives`.
- Existing runtime stop boundary remains protected: `stop_bot_for_role()` preserves PID state while a process is alive.
- QA target audit completed: `QA_TARGET` is the concrete target bot; scenario `target` values are chat IDs, so filtering replies by the single resolved target bot ID is correct for the current scenario format.
- Current panel/report audit: role assignment UI is restricted to Founder or current chat Administrator; local role writes use `set_role(chat_id,...)`; report callbacks are global only for Founder/Helper and chat-scoped for local authority.
- Live telemetry: the last known successful Phone2 state was `role=active`, polling `ready`, `ai=ready`. A fresh control-plane `UPDATE` was submitted today, but no result was returned.
- Current lease branch contains the historical CRLF path `lease.json\\r` with `owner=pc1` and an expired `expires_at`. Therefore the current physical runtime is **not freshly live-verified** from this session, and no claim of live synchronization is made.
- Do not force a device takeover automatically without an explicit/verified active-device decision; continue code/security audit while live control-plane is unavailable.
- Next continuation: re-check control-plane/lease, then perform live TEST verification when an active runtime is reachable; meanwhile continue hidden scope/state audit. Main/PROD remains untouched.


## Protocol checkpoint — 2026-10-07 — blocks 1–3 command/STATE/role audit

- Branch: `test-global-assistant-upgrade`; Main/PROD untouched.
- Blocks 1–3 completed as one pass: authoritative command registry/handlers, command and pending-state isolation, Telegram/app role parity.
- Command surface audit: registered aliases were checked against concrete handlers or explicitly documented non-decorator routing. Privileged commands remain Founder-gated and global-scope constrained; destructive moderation actions remain centralized behind confirmation/policy.
- Direct legacy moderation aliases `/mute`, `/unmute`, `/ban`, `/unban` still delegate into `services/moderation_gateway.py`; no direct execution bypass was found.
- Pending command, moderation and report/panel state is keyed by `(user_id, chat_id)`; global runtime undo uses the explicit `(user_id, 0)` key only for genuinely global actions.
- Report access remains global only for Founder/Helper; local Administrator/Moderator access is constrained to the current chat/source chat.
- Telegram authority parity: only actual Telegram creator/owner maps to local `Администратор`; ordinary Telegram administrators do not automatically receive bot Administrator authority.
- Global Helper remains technical/report-center staff and does not inherit local moderation authority unless the same person is independently the Telegram creator of the current chat.
- Previously found creator+Helper role-assignment mismatch is fixed in `41fd746d62c643f4b5fca62630ef5f96182066ae` and is covered by current regression tests.
- Current TEST HEAD: `baaaa93161a8ee3658eff0244626196fcabe4230`.
- CI Python integrity check run #2161 (`37513627874`) for the current HEAD completed **SUCCESS**; compile/import, AI-no-credentials, runtime regression, direct dependency and legacy dependency checks all passed.
- No new permission/state-isolation defect requiring a code change was found in blocks 1–3. The next block is chained scenario execution and then the Termux/runtime/update verification sequence.


## Protocol checkpoint — 2026-10-07 — blocks 4–7 completion pass

- Branch remains `test-global-assistant-upgrade`; Main/PROD untouched.
- Block 4: chained command scenarios reviewed across request → pending state → confirmation → execution → cancellation → repeat in another chat. No cross-chat pending collision found; destructive moderation remains centralized through the moderation gateway.
- Block 5: hidden state audit completed for command, moderation, panel, report, runtime undo, AI history/rate-limit and chat-scoped runtime state. Boundaries remain user+chat; global runtime undo is explicitly keyed as global.
- Block 6: Telegram authority/role transitions reviewed end-to-end. Creator authority is scoped to the current chat; ordinary Telegram administrators do not become bot Administrators; global Helper does not inherit local moderation unless independently creator. Found and fixed a hidden actor/target mix-up in `services/chat_roles.py`: the Helper restriction now evaluates `granted_by`, not the target user. Regression added in `tests/test_chat_roles.py`.
- Security/runtime finding: Termux supervisor/control/report paths still wrote logs to repository-root files despite the protected `BOT_DATA_DIR` policy. Fixed supervisor, control and telemetry paths to route runtime logs through `BOT_DATA_DIR`; added regression coverage in `tests/test_runtime.py`.
- Current code commit before this checkpoint: `25e8917514599f6cb7940ceea34ed290fb9dba2f`.
- CI #2175 is running for that code commit; do not call it green until completion.
- Block 7 runtime conclusion: the Termux control/update/watchdog code is statically and regression-covered for lease fencing, PID identity, singleton supervisor, update restart boundaries, rollback, stale runtime replacement and fail-closed watchdog behavior. Live physical runtime telemetry is currently not fresh: Issue #23 contains control commands but no corresponding current telemetry result. Therefore no false claim of live TEST synchronization is made. Once CI is green and a fresh telemetry response is available, the final runtime step is to verify active/standby process state and health on the physical device.


## Protocol checkpoint — 2026-10-07 — final runtime-path correction and CI/live-control verification

- Branch: `test-global-assistant-upgrade`; Main/PROD untouched.
- Final code commit for this pass: `152a5b8d544bf3a163704ea8e509c956651120ef`.
- Found one residual Termux supervisor logging path after the previous block-7 patch: three supervisor subprocesses still appended to repository-root `termux-autoupdate.log`. Replaced all three with the already protected `LOG_FILE`, which resolves through `BOT_DATA_DIR`.
- Verified `QA_RUNNER` is explicitly initialized inside `start_qa_agent()`; no undefined-variable regression remains.
- `tests/test_runtime.py::test_termux_runtime_logs_use_bot_data_dir` explicitly rejects the root log path and checks the BOT_DATA_DIR routing for supervisor/control/report.
- CI Python integrity check run #2179 (`37575128823`) for commit `152a5b8d544bf3a163704ea8e509c956651120ef` completed **SUCCESS**. Setup, compile, import, AI-no-credentials, runtime regression tests, direct dependency audit and legacy dependency audit all passed.
- A fresh TEST control-plane `UPDATE` and `STATUS` were submitted to Issue #23 after CI success. No new control acknowledgement/telemetry snapshot was returned during this verification window; the newest available runtime telemetry remains historical.
- Last available physical Phone2 telemetry still showed `HEALTH OK`, `role=active`, Telegram polling `ready`, AI `ready`, but it predates the final supervisor log-path commit. Therefore physical runtime synchronization with commit `152a5b8d544bf3a163704ea8e509c956651120ef` is **not claimed**.
- Repeated historical runtime log entries show `lease check unavailable; preserving active role`; this remains a runtime connectivity/lease-control issue, not a reason to weaken functional role/state tests. The user explicitly prioritized functional continuity over lease-owner cleanup.
- Current branch comparison: TEST is intentionally diverged from Main; do not merge/rebase Main automatically. Main/PROD remains untouched.
- Completion status for this pass: code audit + hidden state/role audit + runtime-path correction + CI validation are complete. The only unresolved item is fresh physical Termux telemetry/acknowledgement from the device.


## Protocol checkpoint — 2026-10-07 — Termux lease-channel recovery attempt

- Physical control-plane investigation continued after CI completion.
- Confirmed `termux-lease` contained the historical malformed filename `lease.json\\r`; this was the source of the earlier `git show ... lease.json\\r` failures.
- The TEST `scripts/termux_control.py` already contains a compatibility fallback from `lease.json` to the CRLF legacy path and writes future leases to the normalized `lease.json` path.
- To make the control branch compatible with both old and current runtimes, a normalized `lease.json` was created on `termux-lease` with an empty/expired lease. This does not touch Main/PROD or application code.
- A new `FORCE PHONE2 ACTIVE` command was submitted after normalization, but no fresh control-result comment appeared. Therefore the physical Phone2 runtime/control polling is currently unreachable or not processing the issue queue.
- No fabricated telemetry is recorded. The last real physical health remains the historical Phone2 `HEALTH OK / polling=ready / ai=ready` snapshot from 2026-10-05.
