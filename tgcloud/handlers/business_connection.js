import { heart } from "../lib/instance.js";

/**
 * Секретарь: человек подключил Аи к своему аккаунту Telegram, изменил
 * подключение или снял его (Secretary Mode, «Автоматизация чатов»).
 *
 * Секретарём она работает только у хозяина: чужое подключение сердце не
 * слушает. Здесь — только вход и страховка от исключения.
 */
export default async function (connection, ctx = {}) {
  try {
    return await heart.onBusinessConnection(connection, ctx);
  } catch (error) {
    try { await heart.reportCrash(error, ctx); } catch { /* отчёт не должен стать второй поломкой */ }
    return { ok: false, code: "runtime_error" };
  }
}
