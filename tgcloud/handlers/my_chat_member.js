import { heart } from "../lib/instance.js";

/**
 * С ней самой что-то сделали: добавили в чат, сделали админом, сняли права,
 * убрали; в личке — человек заблокировал её или вернул.
 *
 * Сердце ведёт по этому список своих чатов, пробует «сообщения для одного»,
 * когда получает права, и стирает рабочее о чате, из которого её убрали.
 * Здесь — только вход и страховка от исключения.
 */
export default async function (update, ctx = {}) {
  try {
    return await heart.onMyChatMember(update, ctx);
  } catch (error) {
    try { await heart.reportCrash(error, ctx); } catch { /* отчёт не должен стать второй поломкой */ }
    return { ok: false, code: "runtime_error" };
  }
}
