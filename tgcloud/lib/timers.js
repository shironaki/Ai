/**
 * Таймеры — только через этот модуль.
 *
 * В рантайме платформы `setTimeout` нет вовсе: обращение к нему — «ReferenceError:
 * setTimeout is not defined», и обработчик падает. Так с первой сборки был сломан
 * мост к сестре: вопрос уходил в канал, а ждать ответа было нечем — владелец
 * увидел это строкой «Сбои: Обработчик — ReferenceError…» в статусе 16.11.2026.
 *
 * Здесь таймер берётся, только если он есть. Нет — вызывающий обязан обойтись
 * без ожидания: `later` вернёт `null`, `sleep` — сразу. Тест
 * `tests/platform.test.mjs` запускает сердце без таймеров и следит, чтобы в
 * `tgcloud/` не было ни одного обращения к ним мимо этого модуля.
 */
const timer = () => (typeof globalThis.setTimeout === "function" ? globalThis.setTimeout : null);

/** Есть ли в этом рантайме таймеры. Спрашивается при каждом вызове, а не при загрузке. */
export const hasTimers = () => timer() !== null;

/** Позвать `fn` через `ms`. Таймеров нет — `null`, и `fn` не будет позвана никогда. */
export function later(fn, ms) {
  const set = timer();
  return set ? set(fn, ms) : null;
}

/** Отменить то, что вернул `later`. */
export function cancel(handle) {
  if (handle != null && typeof globalThis.clearTimeout === "function") globalThis.clearTimeout(handle);
}

/** Подождать. Таймеров нет — ожидание пропускается, а не падает. */
export function sleep(ms) {
  const set = timer();
  return set && ms > 0 ? new Promise(resolve => set(resolve, ms)) : Promise.resolve();
}
