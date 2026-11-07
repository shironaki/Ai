/**
 * Non-secret configuration of the heart.
 *
 * Telegram Serverless gives a module no environment variables: the handler
 * receives only the raw update. So the settings live here, in git, and only
 * secrets are injected at publish time into `lib/secrets.js`.
 *
 * OWNER_TG_ID is the Founder's numeric Telegram ID. It is not a secret — it is
 * an identity check — and belongs here so a fresh deploy cannot be claimed by
 * whoever writes first.
 */
export const CONFIG = Object.freeze({
  OWNER_TG_ID: 0,
  TIME_ZONE: "Europe/Moscow",
  AI_MODEL: "openai/gpt-oss-20b",
  AI_MIN_INTERVAL_MS: 1500,

  // The abilities bot (moderation, games, quests, profiles) lives in a separate
  // deployment. The channel is the only transport: both bots are its admins, so
  // both receive every post. Empty values keep the bridge off and the heart
  // fully self-sufficient.
  ABILITIES_CHANNEL_ID: "",
  ABILITIES_SECRET: "",

  // What the heart says about itself when asked who it is.
  NAME: "Аи",

  // The sibling by name, and — when known — her public username. Without a
  // username the heart still says the ability is missing, it simply cannot
  // offer a button; it never invents a link.
  SISTER_NAME: "Юи",
  SISTER_BOT_USERNAME: "",
});
