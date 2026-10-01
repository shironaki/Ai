# DEVELOPMENT_CHECKPOINT.md

## Canonical TEST continuation — 2026-10-01 — typed command executor hardening

### Current state
- Repository: `shironaki/Ai`
- Active branch: `test-global-assistant-upgrade`
- Latest code commit: `2d811fe2dc4ae2f5e54c9d637fe4ac4e43be901b`
- Draft PR: #22, base `main`; main/PROD remains untouched.
- GitHub Actions `Python integrity check` run #515: completed / success.

### Completed in this block
- Founder natural-language stasis/awakening now passes through a registry-backed typed executor.
- Natural-language scope resolution is centralized: only explicit chat/global markers are accepted; unknown scope is not silently converted during execution.
- Command intents are normalized against the authoritative command registry before execution.
- Unsupported registered commands fail closed with an explicit executor-missing result instead of falling through.
- Added regression coverage for explicit scope resolution, invalid scope rejection, and unregistered-command rejection.
- Existing audit, policy, confirmation, and role gates remain in the execution path.

### Runtime hardening status
- CI verifies the repository and runtime regression suite.
- Live Codespaces/Termux state is not inferred from CI.
- PROD/main remains untouched.

### Next global block
Continue the same architecture with a shared target resolver for typed commands:
- current chat;
- reply-target user;
- explicitly supplied username;
- explicitly supplied Telegram ID only where the command policy allows it.
AI may produce intent data, but target resolution must be deterministic and policy-bound.

### Operating rule
Work from the repository state, make the fix, verify CI, and only then hand the result to the user for live checking. Never expose secrets and never treat CI alone as proof of live Telegram health.
