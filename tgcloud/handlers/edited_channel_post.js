import { heart } from "../lib/instance.js";

/**
 * Правка поста в канале — так тикает будильник: второй бот раз в минуту
 * правит одно и то же сообщение, канал не засоряется, а сердце просыпается
 * и делает то, что должно случаться «само».
 */
export default async function (post, ctx = {}) {
  try {
    return await heart.onMessage(post, ctx);
  } catch (error) {
    try { await heart.reportCrash(error, ctx); } catch { /* отчёт не должен стать второй поломкой */ }
    return { ok: false, code: "runtime_error" };
  }
}
