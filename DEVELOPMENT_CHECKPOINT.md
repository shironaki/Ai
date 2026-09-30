# DEVELOPMENT_CHECKPOINT.md

## Точка продолжения — 2026-09-30 (актуализировано, включая PROD)

Этот файл является контрольной точкой проекта. При продолжении работы сначала прочитать его и продолжать с фактического состояния `main`, не восстанавливая состояние по догадкам.

## Проект

- Репозиторий: `shironaki/Ai`
- Рабочая ветка: `main`
- Python 3.11
- aiogram 2.25.2
- SQLite
- AI: Groq OpenAI-compatible API
- Секреты: `BOT_TOKEN`, `GROQ_API_KEY` только через environment/Codespaces secrets.
- Hosting/server пока не является задачей; не возвращаться к нему без запроса пользователя.
- Цель: полноценный AI-помощник, который понимает естественную речь, безопасно выполняет разрешённые действия и возвращает реальные данные.

## Фактическое состояние main

Последний commit на момент checkpoint до PROD-конфигурации был:
`a3a3a59d16bfedac33a09cba0d75a67e3a0bc7ef`.
После него добавлен Render Blueprint commit:
`621c717fb04d1bd1d76e438b901b352c6f29bd67`
(`deploy: add Render production worker blueprint`).

После исходного PR #13 в main уже вошли:

- PR #14 — обычные личные сообщения переведены через единый assistant gateway; добавлены direct actions для system info/logs.
- PR #15 — закреплён execution honesty contract: AI не может заявлять о невыполненном действии и выдумывать результаты.
- PR #17 — расширена естественная маршрутизация informational requests.
- PR #18 — добавлен подтверждаемый natural-language moderation gateway.
- PR #20 — финализирована conversational routing и запрещено выдумывать диагностические метрики/несуществующие slash-команды.
- PR #21 — естественные moderation-команды в группах/супергруппах выполняются напрямую без префикса AI; сохранены reply-target, role/status checks, confirmation и audit.

Актуальный последний функциональный merge:
`8913c36f5ed91d75e9b1dd34ec25bcff91337219`
(`feat: execute natural moderation commands without AI prefix (#21)`).

## Что уже реально существует

### Direct informational actions

`services/assistant_actions.py` определяет безопасный deterministic routing для:

- help;
- profile;
- chatinfo;
- system_stats;
- system_info;
- runtime;
- debug;
- ai_diagnostic;
- logs;
- unsupported_settings.

`handlers/help/help.py` исполняет эти действия напрямую. Для logs используется реальный `LOG_FILE`, для AI diagnostic — реальные `ai_status()` и `_LAST_ERROR`, для system/profile/chat — read-only data layer.

### AI data layer

`services/ai_data.py` предоставляет только параметризованные read-only данные:

- user_summary;
- chat_summary;
- system_summary;
- runtime_summary;
- verified AI context.

AI не получает произвольный SQL/Python/Telegram API.

### Command registry / policy

`core/command_registry.py` — единый registry non-game команд с metadata:

- key;
- aliases;
- category;
- min_role;
- scope;
- destructive;
- confirmation;
- enabled;
- description.

Legacy game aliases намеренно исключены из core registry.

`core/command_policy.py` и `core/command_models.py` разделяют policy и intent.

### Founder runtime gateway

`services/command_gateway.py` сейчас управляет Founder natural-language stasis/awakening.

Текущий контур:
`natural language -> interpret (AI/fallback) -> policy -> scoped runtime executor -> audit`.

Поддерживаются:
- stasis;
- awakening;
- scope chat/global;
- уточнение области через pending state;
- audit.

Это следующий кандидат на перенос в общий deterministic/typed command executor, чтобы не оставлять отдельный Founder-only контур.

### Moderation gateway

`services/moderation_gateway.py` содержит подтверждаемый natural-language moderation executor.

PR #21 подключил прямой вход для групп/супергрупп без обязательного обращения к AI.

Примеры:
- замутить/размутить;
- заблокировать/разбанить;
- target через reply;
- duration;
- confirmation;
- role/status checks;
- audit.

## Тестовый контур

В `tests/` существуют regression tests для:

- AI data layer;
- AI execution contract;
- assistant actions;
- command help;
- command registry;
- compile;
- moderation gateway;
- runtime;
- security layer.

После каждого изменения обязательно проверять compile/tests фактическим запуском CI или доступным runtime.

## Архитектурный принцип

Главный контракт проекта:

`Telegram -> natural language -> deterministic/AI intent -> registry -> policy -> target/scope validation -> confirmation -> typed executor -> audit -> response`

Для read-only:

`Telegram -> deterministic intent -> read-only executor -> real data -> response`

AI может помогать понимать свободную речь, но не является источником истины о состоянии системы и не получает произвольные исполнительные возможности.

## Следующий этап — продолжать отсюда

## Production deployment checkpoint

- PROD target: Render Background Worker.
- `render.yaml` added and committed: `621c717fb04d1bd1d76e438b901b352c6f29bd67`.
- Render service name: `ai-bot-prod`.
- Runtime: Python, `python run.py`.
- Region: Frankfurt.
- Compute: `0.5c-512mb`, 1 instance.
- Persistent disk: `/var/lib/ai-bot`, 1 GB.
- Runtime env: `BOT_ENV=prod`, `BOT_DATA_DIR=/var/lib/ai-bot`, secrets `BOT_TOKEN` and `GROQ_API_KEY` are dashboard-only.
- TEST remains Codespace + separate Telegram token + `data/test/`.
- PROD must use a different Telegram bot token; never run TEST and PROD with the same token.
- Cloudflare Workers is not the current deployment target: although Python Workers are supported, the runtime model is serverless/fetch-based and would require a different webhook/runtime architecture. Render is the fast path for the existing aiogram polling process.
- Important: Render Background Workers have no free compute plan; this production setup requires paid compute. Persistent disk is also paid.

### Этап 2C — единый Natural-language command executor

Не расширять бесконечно `assistant_actions.py` отдельными if/phrase блоками.

Нужно построить общий слой:

1. deterministic intent parser для известных команд;
2. registry lookup;
3. policy evaluation;
4. target resolver;
5. scope resolver;
6. confirmation state;
7. typed executor;
8. audit;
9. Telegram response.

Первый перенос — `stasis/awakening` из `services/command_gateway.py` в общий контур.

### Этап 2D — target resolver

Безопасно разрешать только:

- текущий чат;
- пользователя из reply;
- явно указанный username;
- явно указанный Telegram ID только там, где конкретный executor это разрешает.

AI не выбирает произвольную цель.

### Этап 2E — security regression

Проверить:

- no arbitrary SQL;
- no arbitrary Python;
- no shell;
- no arbitrary Telegram API through AI;
- secrets не попадают в ответы/логи;
- audit не содержит prompt/message/credentials;
- chat/global scopes не смешиваются;
- confirmation привязана к user + chat;
- destructive actions никогда не исполняются без required confirmation.

## Game scope

Старые игровые команды пока не переписывать по одной. Они намеренно изолированы от core registry. Игровой слой будет переписан отдельно после стабилизации AI assistant/command executor.

## Рабочие правила

1. Перед изменением читать актуальный код.
2. Работать крупными законченными блоками.
3. После изменений фактически запускать/проверять тесты.
4. Не объявлять проверку без результата.
5. Не выдумывать отсутствующие данные.
6. Не использовать LLM как источник системных фактов.
7. Не возвращать пользователя к slash-команде, если действие безопасно и уже имеет executor.
8. Не спрашивать подтверждение каждого технического шага, если задача уже определена.
9. Если одна ошибка повторилась дважды или три последовательных изменения не улучшили ситуацию — остановиться и показать точную проблему.

## Контрольная фраза

Мы остановились после PR #21. В main уже есть единый natural-language вход для обычных informational requests и прямое natural-language moderation execution в группах. Следующий технический блок — не добавлять новые разрозненные phrase handlers, а собрать единый typed natural-language command executor и перенести в него Founder stasis/awakening, затем сделать общий target/scope resolver и закрыть security regression.


## TEST checkpoint — 2026-09-30 — Assistant character/control/QA block

### User-approved behavior contract
- TEST remains the active development contour; this branch is not PROD and must not be merged until runtime verification in Codespaces is complete.
- Аи has a stable character contract: confident, sometimes cheeky, sometimes warm, able to tease lightly or be stubborn when facts are certain; character must never replace factual accuracy or invent execution.
- Founder/Основатель has a direct natural-language path without the mandatory “Аи” wake word. Known Founder command requests execute directly; when scope is omitted, current chat is the safe default, while explicit “везде/глобально” selects global scope.
- Other roles, including Администратор, must address the assistant explicitly through “Аи, …”, “/аи …”, or “/ai …” for natural-language command execution.
- Admin/moderation natural-language execution is gated behind explicit AI invocation.
- Administrative moderation cannot target the Founder without a separate Founder permission flow.
- A universal cancellation path exists for pending Founder/moderation requests: “отмени последний запрос”, “отмена”, “отставить”, “не трожь”, “забудь”, etc.
- QA issue markers are public to create, but private to inspect: replying to a problematic message with “отметь …” or “исправить …” creates a persistent marker; optional код N is stored. Only Founder can view /метки/the QA list and mark an item fixed with “исправлено N”.
- QA markers are persisted in SQLite issue_markers; they are separate from runtime/audit logs.
- The marker list shows open/fixed state, reason, code, chat/message references and timestamps. When invoked from a group, the list is sent to the Founder in private chat.

### Current TEST branch
- Branch: test-global-assistant-upgrade
- Draft PR: #22 — TEST: character, founder control, cancellation and QA markers
- Latest tested SHA: 74ffe26100f2a9ef89fa85a677bbdb8d8f683fac
- GitHub Actions Python integrity check: latest push and PR runs both success.
- Main remains untouched by this block.
- PROD migration is explicitly deferred until Codespaces bot runtime verification is completed.

### Next runtime verification matrix
1. Founder: natural “активируй стазис” executes without asking for scope.
2. Founder: cancellation phrases clear any pending command state.
3. Admin: “Аи, замуть ...” reaches moderation executor; bare “замуть ...” does not.
4. Admin/moderator: moderation target equal to Founder is rejected without separate Founder permission.
5. Any user: reply to a broken message with “отметь код 1 ошибка ...” creates a marker.
6. Founder private: /метки shows markers; “исправлено N” changes status to fixed.
7. Non-Founder: /метки exposes no QA list.
8. Character: ordinary conversational requests get the new Aи personality without changing factual/execution contracts.

### Protocol
Codespace TEST -> runtime verification -> fix/regression test -> CI -> stable checkpoint -> only then migrate the same block to PROD -> continue next work again on TEST.
