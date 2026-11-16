/**
 * Deploy-time secret slot. Keep this file EMPTY in git.
 *
 * Telegram Serverless has no environment variables, so a provider key that lives
 * in a GitHub secret can only reach the runtime if it is written into a
 * deployed module at publish time. The **Heart** workflow (`mode: deploy`)
 * fills this file from the secrets, publishes, and restores it immediately.
 *
 * Never commit a real value here. If one appears: rotate the key, then
 * `git checkout -- tgcloud/lib/secrets.js`.
 */
export const AI_API_KEY = "";

/**
 * Числовой Telegram ID владельца — запасной источник: основной лежит в
 * `config.js`. Приходит из GitHub-секрета OWNER_TG_ID только на время
 * публикации. Пусто и там, и здесь — «владелец не задан»: отчёты о поломках
 * копятся, но никому не уходят.
 */
export const OWNER_TG_ID = "";

/**
 * Ключи запасных провайдеров: `{ "имя": "ключ" }`, имя — `id` из
 * `CONFIG.AI_PROVIDERS`. Приходят из GitHub-секрета AI_EXTRA_KEYS (JSON) на
 * время публикации. Пустой объект — запасных провайдеров нет.
 */
export const AI_EXTRA_KEYS = {};
