import { api, db, fetch as sdkFetch } from "sdk";
import { createHeart } from "../lib/heart.js";

/**
 * The entry point Telegram Serverless calls for every update of this bot.
 *
 * The handler is thin on purpose: it builds the heart once per isolate and
 * delegates. Everything that can be reasoned about — the character, memory, the
 * decision whether a request is a conversation or an ability — lives in
 * `lib/heart.js` and is tested without Telegram.
 */
const heart = createHeart({ db, api, fetchImpl: sdkFetch });

export default async function (message, ctx = {}) {
  try {
    const result = await heart.onMessage(message, ctx);
    // A test run must be able to prove the route without touching Telegram.
    return ctx.testRun === true ? { ...result, side_effects: "none" } : result;
  } catch (error) {
    // A thrown update kills the whole batch on this platform: never let it.
    // But a swallowed exception is a silent fault: the owner is told.
    try { await heart.reportCrash(error, ctx); } catch { /* the report must not become a second fault */ }
    return { ok: false, code: "runtime_error" };
  }
}
