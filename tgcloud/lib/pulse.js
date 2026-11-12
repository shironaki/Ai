import { plural } from "./sibling.js";

/**
 * Пульс: что сердце делало за день, числами.
 *
 * «Работает» — это ощущение, а не факт. Сколько раз она ответила, сколько раз
 * упёрлась в лимит, сколько раз её поправили — раньше этого не знал никто,
 * включая владельца. Пульс считает день по календарю владельца и отдаёт
 * одну и ту же сводку и в `/status`, и в утренней вести.
 *
 * Счётчики копятся в памяти обращения и пишутся одной записью в конце:
 * десяток событий одного сообщения не должен стоить десяти записей в базу.
 */
export const pulseKey = (day) => `heart:pulse:${day}`;

/** «18 400» вместо «18400». Изолят без Intl получает число как есть. */
function number(value) {
  try { return new Intl.NumberFormat("ru-RU").format(Number(value) || 0); }
  catch { return String(Number(value) || 0); }
}

export function createPulse({ store = null, now = () => Date.now(), dayOf = (at) => new Date(at).toISOString().slice(0, 10) } = {}) {
  let pending = {};
  const memory = new Map();

  /** Отметить событие. Имя модели считается отдельно: `model:<имя>`. */
  function bump(name, by = 1) {
    if (!name || !Number.isFinite(by) || by === 0) return;
    pending[name] = (pending[name] ?? 0) + by;
  }

  async function read(day) {
    let value = null;
    try { value = store && typeof store.get === "function" ? await store.get(pulseKey(day)) : null; } catch { value = null; }
    if (value == null) value = memory.get(day) ?? null;
    return value && typeof value === "object" ? value : {};
  }

  /** Записать накопленное. Гонка двух изолятов стоит потерянной единицы, не ошибки. */
  async function commit() {
    const batch = pending;
    pending = {};
    if (!Object.keys(batch).length) return { ok: true, written: false };
    const day = dayOf(now());
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await read(day);
      const next = { ...before };
      for (const [name, by] of Object.entries(batch)) next[name] = (Number(next[name]) || 0) + by;
      memory.set(day, next);
      if (!store || typeof store.set !== "function") return { ok: true, written: true };
      const saved = Object.keys(before).length && typeof store.compareSet === "function"
        ? await store.compareSet(pulseKey(day), before, next)
        : await store.set(pulseKey(day), next);
      if (saved) return { ok: true, written: true };
    }
    return { ok: false, written: false };
  }

  const day = (date = dayOf(now())) => read(date);

  /** Был ли день вообще: пустой день не стоит вести владельцу. */
  function active(counters = {}) {
    return ["replies", "ruled", "reactions", "failed", "queued", "limited", "corrected", "lessons"].some(name => Number(counters[name]) > 0);
  }

  /** Сводка словами. Строки с нулями не печатаются: тишина — не новость. */
  function lines(counters = {}) {
    const c = (name) => Number(counters[name]) || 0;
    const out = [];
    const talk = [
      c("replies") ? `${number(c("replies"))} ${plural(c("replies"), "ответ", "ответа", "ответов")} моделью` : "",
      c("ruled") ? `${number(c("ruled"))} без модели` : "",
      c("reactions") ? `${number(c("reactions"))} ${plural(c("reactions"), "реакция", "реакции", "реакций")}` : "",
      c("silent") ? `промолчала сама: ${number(c("silent"))}` : "",
    ].filter(Boolean);
    out.push(`Разговоры: ${talk.length ? talk.join(" · ") : "тихо"}`);
    const models = Object.entries(counters)
      .filter(([name, value]) => name.startsWith("model:") && Number(value) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .map(([name, value]) => `${name.slice(6)} ×${number(value)}`);
    if (c("tokens") || models.length) out.push(`Мысли: ${number(c("tokens"))} ${plural(c("tokens"), "токен", "токена", "токенов")}${models.length ? ` (${models.join(", ")})` : ""}`);
    const limit = [
      c("limited") ? `упиралась ${number(c("limited"))} ${plural(c("limited"), "раз", "раза", "раз")}` : "",
      c("switched") ? `думала запасной: ${number(c("switched"))}` : "",
      c("queued") ? `отложила: ${number(c("queued"))}` : "",
      c("late") ? `дослала: ${number(c("late"))}` : "",
      c("dropped") ? `не успела: ${number(c("dropped"))}` : "",
    ].filter(Boolean);
    if (limit.length) out.push(`Лимит: ${limit.join(" · ")}`);
    const study = [
      c("corrected") ? `поправили ${number(c("corrected"))} ${plural(c("corrected"), "раз", "раза", "раз")}${c("replies") ? ` (${Math.round(c("corrected") * 100 / c("replies"))}% ответов)` : ""}` : "",
      c("thanked") ? `поблагодарили: ${number(c("thanked"))}` : "",
      c("lessons") ? `новых уроков: ${number(c("lessons"))}` : "",
      c("unknown") ? `не знала ответа: ${number(c("unknown"))}` : "",
    ].filter(Boolean);
    if (study.length) out.push(`Учёба: ${study.join(" · ")}`);
    if (c("failed")) out.push(`Не смогла ответить: ${number(c("failed"))}`);
    if (c("bridge_missed")) out.push(`Мост молчал: ${number(c("bridge_missed"))}`);
    return out;
  }

  return Object.freeze({ bump, commit, day, active, lines });
}
