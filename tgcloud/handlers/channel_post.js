import { heart } from "../lib/instance.js";

/**
 * Посты канала. Telegram доставляет их отдельным видом обновления, и без
 * этого файла сердце их не получало вовсе: вопрос к сестре уходил в канал,
 * а её ответ туда же — и терялся.
 *
 * Сюда приходят три вещи: подписанный ответ сестры, её событие и удар
 * будильника (любой другой пост). Разбирает их само сердце.
 */
export default async function (post, ctx = {}) {
  try {
    return await heart.onMessage(post, ctx);
  } catch (error) {
    try { await heart.reportCrash(error, ctx); } catch { /* отчёт не должен стать второй поломкой */ }
    return { ok: false, code: "runtime_error" };
  }
}
