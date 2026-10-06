# Architecture

## Runtime

- `run.py` — единственная точка запуска.
- `main.py` — создание Bot/Dispatcher, middleware, диагностика и startup.
- `handlers/` — Telegram-команды и callbacks.

## Application layers

- `config/` — централизованные роли и их visible tags.
- `core/` — permissions, command models, registry and authorization policy.
- `services/` — AI, command gateway, audit and security helpers.
- `database/` — structured SQLite read layer and schemas.
- `base/` — compatibility layer for existing gameplay reads/writes; it remains active until every write path is migrated safely.
- `handlers/` — Telegram transport layer. Handlers should delegate policy/business decisions to core/services instead of duplicating them.

## Command architecture

User-facing non-game commands have one registry in `core/command_registry.py`.
A command is described by:

- stable key;
- aliases;
- category;
- minimum role;
- supported scope (`chat`, `global` or `both`);
- destructive flag;
- confirmation requirement.

Natural-language AI must produce an intent, not executable code. The intended pipeline is:

`Telegram -> intent -> registry -> policy -> target/scope validation -> confirmation -> executor -> audit`.

The AI layer is never allowed to execute arbitrary Python, SQL, shell commands or Telegram API methods. Read-only facts are supplied through `services/ai_data.py`, which exposes fixed parameterized queries only.

Legacy game commands are intentionally outside the core registry. The game system will be rebuilt as a separate module.

## Roles

Human authorization is split by source and scope:

- 👑 **Основатель** — hidden, immutable and derived only from `config.owner`; never assignable or displayed as a normal role.
- 🛡️ **Администратор** — local authority derived from Telegram chat ownership; it exists only for the current `chat_id`.
- 🔨 **Модератор** — local role assigned by that chat's Administrator; never global.
- 👮 **Хелпер** — global technical role assigned only by the Founder; intended for the report center and technical support across chats.
- 👤 **Пользователь** — default human role.

Telegram administrator/creator status is an authority source, not a persistent bot role. Global Helper state lives in `global_roles`; local Moderator state lives in `chat_roles(chat_id,user_id)`.

Permission checks use `core.permissions` and command policy, while report access is handled separately from moderation access so a Helper does not gain local moderation powers.

## AI

The AI integration lives in `services/ai_service.py` and uses the optional `GROQ_API_KEY` environment secret.

- Conversation history is short-lived in memory.
- API keys are never stored in repository files.
- Provider errors are redacted before diagnostics.
- AI command classification is allowlisted and currently supports only the runtime commands.\n- AI answers can receive verified profile/chat/system/runtime facts from the read-only data layer; absent facts must not be invented.
- Future command expansion must add registry entries and typed executors, not arbitrary code execution.

## Database

The live bot still uses `base/users.py` and `base/chats.py` for legacy write paths. The new `database/` layer points at the same default database files and remains read-oriented until all writes are migrated safely.

Local database directories are best-effort restricted to owner-only filesystem permissions on POSIX systems.

## Security/runtime rules

- Secrets are environment variables only.
- `.env*`, credential/key files, SQLite databases and runtime data are ignored by Git.
- Permission checks remain active even when a command is hidden from Telegram's public command menu.
- Destructive command intents require explicit confirmation.
- Founder pending intents are bound to both user and chat, preventing cross-chat scope confusion.
- Runtime logs do not store ordinary message content.
- Error diagnostics redact common API/token formats.
- Audit events contain command metadata only; AI prompts, message text and credentials are excluded.\n- Command scope is explicit: chat-only commands cannot be promoted to global execution, even by the Founder.
- Runtime logs stay outside Git.
- Python 3.11 syntax is checked by GitHub Actions on pushes and pull requests.
