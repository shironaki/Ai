import { heart } from "../lib/instance.js";

/**
 * The entry point Telegram Serverless calls for every message to this bot.
 *
 * The handler is thin on purpose: everything that can be reasoned about — the
 * character, memory, the decision whether a request is a conversation or an
 * ability — lives in `lib/heart.js` and is tested without Telegram.
 *
 * Будильник входит сюда же: `tgcloud run handlers/message --ctx '{ tick: true }'`.
 * Обновление из Telegram такого контекста получить не может: его задаёт
 * только владелец токена публикации. Тем же входом телефон спрашивает, что
 * слышала дверь приложения: `--ctx '{ door: "state", after: N }'` (`phone.sh door`).
 */
export default async function (message, ctx = {}) {
  try {
    if (ctx?.tick === true) return await heart.tick(ctx);
    if (ctx?.door === "state") return await heart.doorState(ctx);
    const result = await heart.onMessage(message, ctx);
    // A test run must be able to prove the route without touching Telegram.
    return ctx?.testRun === true ? { ...result, side_effects: "none" } : result;
  } catch (error) {
    // A thrown update kills the whole batch on this platform: never let it.
    // But a swallowed exception is a silent fault: the owner is told.
    try { await heart.reportCrash(error, ctx); } catch { /* the report must not become a second fault */ }
    return { ok: false, code: "runtime_error" };
  }
}
