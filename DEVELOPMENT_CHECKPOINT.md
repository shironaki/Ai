# DEVELOPMENT_CHECKPOINT.md

## Canonical TEST continuation — 2026-10-02 — live Termux verification

### Current state
- Repository: shironaki/Ai
- Active branch: test-global-assistant-upgrade
- Latest TEST runtime verified commit: 476db85b8403833bd5b9a7ba2e25da968701b4c6
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
- CI run #602 on `fb0abf7` completed successfully.
- Found and fixed a real founder moderation bug: the founder branch called `confirm()` without first storing the intent, so the shared executor immediately returned without executing. Fixed in `services/moderation_gateway.py` and guarded by `tests/test_moderation_gateway.py`.
- The latest fix is on TEST commit `2b487a5c723a8b961d8a61242ca3fb0fd9c7d8f2`; CI for this newest commit is pending.

### Operating rule
Continue working from TEST only. Verify fresh Termux telemetry after runtime changes. Keep main/PROD untouched until live TEST is fully verified and explicitly approved for promotion.
