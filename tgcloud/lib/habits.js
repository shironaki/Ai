/**
 * Привычки: дело, которое человек хочет делать регулярно, и счёт дней подряд.
 *
 * Отличие от цели — цель закрывается один раз, привычка отмечается каждый
 * день. Отличие от напоминания — напоминание можно пропустить без следа, а
 * здесь виден пропуск: серия начинается заново. Наказаний за пропуск нет и
 * наград за серию тоже: это счёт, а не игра.
 *
 * Привычки личные: хранятся по человеку, показываются только в личке.
 * «Удали всё обо мне» стирает и их.
 */
import { fold } from "./sources.js";

export const HABITS_KEY = (userId) => `heart:habits:${userId}`;
export const MAX_HABITS = 10;
const KEEP_DAYS = 400;

const MARK = "(?:отметь|засчитай|зачти)(?:те)?";
const DROP = "(?:удали|убери|сотри|отмени|брось)(?:те)?";
/** Где в строке кончается название и начинается расписание. */
const SCHEDULE = /\s+(?=(?:кажд(?:ый|ую|ое)\s|ежедневно|по\s+(?:будням|утрам|вечерам)|в\s+\d{1,2}(?:[:.]\d{2})?(?:\s|$)))/u;
const clean = (value) => String(value ?? "").replace(/\s+/gu, " ").replace(/^[\s«"'“—–:-]+|[\s»"'”.!,;]+$/gu, "").trim();

/**
 * Разобрать просьбу о привычке:
 *   { op: "add", name, schedule } · { op: "list" } · { op: "done", name | index, soft } · { op: "drop", name | index }
 * `soft` — «сделал зарядку»: это отметка, только если такая привычка у человека есть.
 */
export function parseHabit(value) {
  const flat = String(value ?? "").replace(/\s+/gu, " ").trim().replace(/[?!.…]+$/u, "").trim();
  const text = fold(flat);
  if (!text || text.length > 160) return null;
  let match;
  if ((match = text.match(/^(?:(?:новая|заведи|добавь|создай|хочу)\s+)?привычк[ау]\s*[:—–-]\s*(.{2,120})$/u))) {
    // Название — как написал человек: регистр сохраняется.
    const body = text.length === flat.length ? flat.slice(flat.length - match[1].length) : match[1];
    const at = fold(body).search(SCHEDULE);
    const name = clean(at < 0 ? body : body.slice(0, at)).slice(0, 60);
    let schedule = at < 0 ? "" : fold(body.slice(at)).trim();
    // «в 8» без «каждый день» — привычка всё равно ежедневная.
    if (schedule && /^в\s+\d/u.test(schedule)) schedule = `каждый день ${schedule}`;
    return name.length >= 2 ? { op: "add", name, schedule } : null;
  }
  if (/^(?:(?:покажи|какие)\s+)?(?:мои\s+)?привычки$|^какие\s+у\s+меня\s+привычки$/u.test(text)) return { op: "list" };
  if ((match = text.match(new RegExp(`^${DROP}\\s+привычку\\s+(?:номер\\s+|№\\s*)?(\\d{1,2})$`, "u")))) return { op: "drop", index: Number(match[1]) };
  if ((match = text.match(new RegExp(`^${DROP}\\s+привычку\\s+(.{2,60})$`, "u")))) return { op: "drop", name: clean(match[1]) };
  if ((match = text.match(new RegExp(`^${MARK}\\s+привычку\\s+(?:номер\\s+|№\\s*)?(\\d{1,2})$`, "u")))) return { op: "done", index: Number(match[1]) };
  if ((match = text.match(new RegExp(`^${MARK}\\s+привычку\\s+(.{2,60})$`, "u")))) return { op: "done", name: clean(match[1]) };
  if ((match = text.match(new RegExp(`^${MARK}\\s+(.{2,60})$`, "u")))
    ?? (match = text.match(/^(?:я\s+)?(?:сегодня\s+)?(?:сделал[а]?|выполнил[а]?|закончил[а]?)\s+(.{2,60})$/u))
    ?? (match = text.match(/^(.{2,60}?)\s+(?:—\s+)?(?:сделан[аоы]?|выполнен[аоы]?|готов[аоы]?)$/u))) return { op: "done", name: clean(match[1]), soft: true };
  return null;
}

const stem = (word) => (word.length > 5 ? word.slice(0, -2) : word.length > 3 ? word.slice(0, -1) : word);
/** «Зарядка» и «зарядку» — одна привычка: слова сравниваются по основе. */
export function sameHabit(name, said) {
  const mine = fold(name).split(" ").filter(Boolean);
  const theirs = fold(said).replace(/[^\p{L}\p{N}\s-]+/gu, " ").split(/\s+/u).filter(Boolean);
  if (!mine.length || !theirs.length || theirs.length > mine.length + 1) return false;
  return mine.every(word => theirs.some(other => other === word || (stem(word).length >= 3 && other.startsWith(stem(word)))));
}

const before = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
/** Сколько дней подряд до `today`. Сегодня ещё не отмечено — серия цела до конца дня. */
export function streakOf(days = [], today) {
  const marked = new Set(days);
  let day = marked.has(today) ? today : before(today);
  let run = 0;
  while (marked.has(day)) { run += 1; day = before(day); }
  return run;
}

export function createHabits({ store = null, now = () => Date.now() } = {}) {
  async function read(userId) {
    const saved = store?.available ? await store.get(HABITS_KEY(userId)).catch(() => null) : null;
    return Array.isArray(saved?.items) ? saved.items : [];
  }
  const write = (userId, items) => store.set(HABITS_KEY(userId), { items, at: now() });
  const locate = (items, { name, index }) => (index != null ? (index >= 1 && index <= items.length ? index - 1 : -1) : items.findIndex(item => sameHabit(item.name, name)));

  /** Завести привычку. `when` — как звучит расписание («каждый день в 08:00») или пусто. */
  async function add(userId, name, when = "") {
    if (!store?.available) return { ok: false, code: "storage_unavailable" };
    const items = await read(userId);
    if (items.some(item => fold(item.name) === fold(name))) return { ok: false, code: "exists" };
    if (items.length >= MAX_HABITS) return { ok: false, code: "too_many" };
    const item = { name, days: [], total: 0, created: now(), ...(when ? { when } : {}) };
    return await write(userId, [...items, item]) ? { ok: true, item, count: items.length + 1 } : { ok: false, code: "storage_unavailable" };
  }

  async function list(userId) { return read(userId); }
  async function find(userId, which) {
    const items = await read(userId);
    const at = locate(items, which);
    return at < 0 ? null : items[at];
  }

  /** Отметить сегодня. Повторная отметка за день ничего не меняет. */
  async function mark(userId, which, today) {
    if (!store?.available) return { ok: false, code: "storage_unavailable" };
    const items = await read(userId);
    const at = locate(items, which);
    if (at < 0) return { ok: false, code: "no_such_habit", count: items.length };
    const item = items[at];
    const days = Array.isArray(item.days) ? item.days : [];
    if (days.includes(today)) return { ok: true, item, already: true, streak: streakOf(days, today) };
    const next = { ...item, days: [...days, today].slice(-KEEP_DAYS), total: (Number(item.total) || 0) + 1 };
    if (!await write(userId, items.map((other, index) => (index === at ? next : other)))) return { ok: false, code: "storage_unavailable" };
    return { ok: true, item: next, already: false, streak: streakOf(next.days, today) };
  }

  async function drop(userId, which) {
    if (!store?.available) return { ok: false, code: "storage_unavailable" };
    const items = await read(userId);
    const at = locate(items, which);
    if (at < 0) return { ok: false, code: "no_such_habit", count: items.length };
    if (!await write(userId, items.filter((_, index) => index !== at))) return { ok: false, code: "storage_unavailable" };
    return { ok: true, item: items[at] };
  }

  const wipe = async (userId) => ({ ok: store?.available ? Boolean(await store.remove(HABITS_KEY(userId)).catch(() => false)) : true });

  return Object.freeze({ add, list, find, mark, drop, wipe });
}
