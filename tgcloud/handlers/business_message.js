import { heart } from "../lib/instance.js";

/**
 * Секретарь: письмо из личного чата хозяина — и чужое, и его собственное.
 *
 * Это не разговор с Аи: обычный разбор (`heart.onMessage`) сюда не зовётся —
 * ни команд, ни игр, ни модели. Пока хозяин не сказал «отвечай за меня», она
 * в этих чатах молчит и ничего не записывает.
 */
export default async function (message, ctx = {}) {
  try {
    return await heart.onBusinessMessage(message, ctx);
  } catch (error) {
    try { await heart.reportCrash(error, ctx); } catch { /* отчёт не должен стать второй поломкой */ }
    return { ok: false, code: "runtime_error" };
  }
}
