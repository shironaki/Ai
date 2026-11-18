import { heart } from "../lib/instance.js";

/**
 * Мини-приложение «Комната»: функция, которую зовёт страница (`miniapp/`).
 *
 * Со страницы — `Telegram.WebApp.Serverless.call("room", { do: "look" }, …)`; платформа отдаёт вызов сюда как
 * `POST /api/room` и сама проверяет, кто зашёл: `ctx.initData.user`. Без верных данных Telegram функция не
 * запускается вовсе.
 *
 * Как и обработчики, функция тонкая: что видно в комнате и что можно сделать, решает сердце (`heart.onRoom`,
 * правила — `lib/room.js`). Отказ — обычный ответ `{ ok: false, code, text }`, а не исключение: страница скажет
 * его словами. Репетиция: `tgcloud run endpoints/room '{ do: "look" }' --ctx '{ testRun: true }'`.
 */
export default async function (input, ctx = {}) {
  try {
    return await heart.onRoom(input ?? {}, ctx ?? {});
  } catch (error) {
    try { await heart.reportCrash(error, ctx); } catch { /* отчёт не должен стать второй поломкой */ }
    return { ok: false, code: "runtime_error", text: "Комната сейчас недоступна — загляните чуть позже." };
  }
}
