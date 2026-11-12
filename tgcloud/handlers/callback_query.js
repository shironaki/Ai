import { heart } from "../lib/instance.js";

/**
 * Нажатия кнопок под сообщениями Аи: «играть», «я в игре», ход в
 * крестиках-ноликах, «посмотреть слово».
 *
 * Telegram доставляет нажатие отдельным видом обновления; платформа включает
 * его в подписку, как только этот файл опубликован. Разбирает нажатие само
 * сердце — здесь только вход и страховка от исключения.
 */
export default async function (query, ctx = {}) {
  try {
    return await heart.onCallback(query, ctx);
  } catch (error) {
    try { await heart.reportCrash(error, ctx); } catch { /* отчёт не должен стать второй поломкой */ }
    return { ok: false, code: "runtime_error" };
  }
}
