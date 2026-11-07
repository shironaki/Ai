/**
 * Deploy-time secret slot. Keep this file EMPTY in git.
 *
 * Telegram Serverless has no environment variables, so a provider key that lives
 * in a GitHub secret can only reach the runtime if it is written into a
 * deployed module at publish time. `scripts/deploy.sh` fills this file from the
 * `AI_PROVIDER_KEY` secret, publishes, and restores it immediately.
 *
 * Precedence: the value set by /aikey in the database wins, then this module.
 * Never commit a real value here. If one appears: rotate the key, then
 * `git checkout -- tgcloud/lib/secrets.js`.
 */
export const AI_API_KEY = "";

/**
 * Числовой Telegram ID владельца. Здесь, а не в config.js, потому что `Ai` —
 * публичный репозиторий, а ID — личные данные: он приходит из GitHub-секрета
 * только на время публикации, как и ключ провайдера. Пустое значение означает
 * «владелец не задан»: отчёты о поломках копятся, но никому не уходят.
 */
export const OWNER_TG_ID = "";
