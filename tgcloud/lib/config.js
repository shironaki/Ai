/**
 * Non-secret configuration of the heart.
 *
 * Telegram Serverless gives a module no environment variables: the handler
 * receives only the raw update. So the settings live here, in git, and only
 * secrets are injected at publish time into `lib/secrets.js`.
 *
 * OWNER_TG_ID is the Founder's numeric Telegram ID. It is not a secret — it is
 * an identity check — and belongs here so a fresh deploy cannot be claimed by
 * whoever writes first and so the founder is known without the bridge. The
 * abilities bot confirms the same identity through `__context`; either source
 * is enough, and neither is guessed.
 */
export const CONFIG = Object.freeze({
  OWNER_TG_ID: 1057867710,
  TIME_ZONE: "Europe/Moscow",
  AI_MODEL: "openai/gpt-oss-20b",
  AI_MIN_INTERVAL_MS: 1500,

  // The VIP perk "the heart answers faster" is a fact, not an adjective: the
  // pause shrinks only when the sister confirms the status. Same number as in
  // the abilities deployment, kept here because the heart has no env.
  AI_VIP_INTERVAL_MS: 700,

  // The abilities bot (moderation, games, quests, profiles) lives in a separate
  // deployment. The channel is the only transport: both bots are its admins, so
  // both receive every post. Empty values keep the bridge off and the heart
  // fully self-sufficient.
  ABILITIES_CHANNEL_ID: "-1004294683725",
  ABILITIES_SECRET: "most-chanel-yui-ai-2026-02-07-2503",

  // What the heart says about itself when asked who it is.
  NAME: "Аи",

  // The sibling by name, and — when known — her public username. Without a
  // username the heart still says the ability is missing, it simply cannot
  // offer a button; it never invents a link.
  SISTER_NAME: "Юи",
  SISTER_BOT_USERNAME: "",
});
