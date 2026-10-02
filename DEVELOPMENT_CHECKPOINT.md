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

Next required work:
1. Fresh Termux/runtime verification of the latest TEST branch; do not claim live deployment until observed.
2. Continue admin/security audit: role assignment paths, chat-founder/admin synchronization, report cadence/forwarded payloads, startup/update delivery.
3. Only after admin block remains green and runtime-verified, continue AI relationship refinement if needed, then AI character/personality block.
4. Keep game/economy/profile disabled and keep Main/PROD untouched.

