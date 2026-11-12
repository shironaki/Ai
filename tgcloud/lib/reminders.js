/**
 * Напоминания: «напомни через час позвонить маме», «напомни завтра в 9 про
 * отчёт».
 *
 * Время разбирает код, а не модель: модель путает «через час» с «в час», а
 * ошибка здесь — это пропущенный звонок. Понятое наполовину задаёт вопрос.
 *
 * Срабатывает напоминание, когда сердце просыпается: от будильника или от
 * любого входящего сообщения. Насколько точно — зависит от того, как часто
 * её будят, и она говорит об этом честно при постановке.
 */
import { localParts, zonedEpoch } from "./time.js";

export const REMINDERS_KEY = "heart:reminders:v1";
const LIMIT = 200;
const PER_USER = 20;
const DAY = 86_400_000;
const MAX_AHEAD = 366 * DAY;

const TRIGGER = /^(?:напомни(?:те)?|напомнишь|поставь(?:те)?\s+напоминание|напоминание\s*[:—-])(?:\s+(?:мне|нам|пожалуйста))*(?=$|[\s,:—-])[\s,:—-]*/iu;

const NUMBER_WORDS = Object.freeze({
  "один": 1, "одну": 1, "одна": 1, "два": 2, "две": 2, "пару": 2, "пара": 2, "три": 3, "несколько": 3, "четыре": 4, "пять": 5,
  "шесть": 6, "семь": 7, "восемь": 8, "девять": 9, "десять": 10, "пятнадцать": 15, "двадцать": 20, "тридцать": 30,
  "сорок": 40, "сорок пять": 45, "пятьдесят": 50, "полтора": 1.5, "полторы": 1.5,
});
const UNIT_MS = [
  [/^(?:сек|секунд[уы]?)$/u, 1000],
  [/^(?:мин|минут[уыа]?|минуток|минутку)$/u, 60_000],
  [/^(?:ч|час|часа|часов|часик|часика)$/u, 3_600_000],
  [/^(?:день|дня|дней|сутки|суток)$/u, DAY],
  [/^(?:недел[юиь])$/u, 7 * DAY],
  [/^(?:месяц|месяца|месяцев)$/u, 30 * DAY],
];
const WEEKDAYS = Object.freeze({
  "воскресенье": 0, "понедельник": 1, "вторник": 2, "среду": 3, "среда": 3, "четверг": 4, "пятницу": 5, "пятница": 5, "субботу": 6, "суббота": 6,
});
const MONTHS = Object.freeze({
  "января": 1, "февраля": 2, "марта": 3, "апреля": 4, "мая": 5, "июня": 6, "июля": 7, "августа": 8, "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12,
});
const PART_OF_DAY = Object.freeze({ "утром": 9, "днем": 14, "вечером": 19, "ночью": 23 });

const NUM = `(\\d{1,4}(?:[.,]\\d)?|${Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join("|")})`;
const UNIT = "(сек|секунд[уы]?|мин|минут[уыа]?|минуток|минутку|ч|час|часа|часов|часик|часика|день|дня|дней|сутки|суток|недел[юиь]|месяц|месяца|месяцев)";
const EDGE = "(?=$|[\\s,.!?;:])";

/** «Через …»: число и единица, «полчаса», «час», «минуту». */
const RELATIVE = new RegExp(`(?:^|\\s)через\\s+(?:(полчаса|полчасика)|(?:${NUM}\\s+)?${UNIT})${EDGE}`, "iu");
const DAY_WORD = new RegExp(`(?:^|\\s)(сегодня|завтра|послезавтра)${EDGE}`, "iu");
const WEEKDAY = new RegExp(`(?:^|\\s)(?:в|во)\\s+(${Object.keys(WEEKDAYS).join("|")})${EDGE}`, "iu");
const DATE_NUM = new RegExp(`(?:^|\\s)(\\d{1,2})[.](\\d{1,2})(?:[.](\\d{4}|\\d{2}))?${EDGE}`, "u");
const DATE_WORD = new RegExp(`(?:^|\\s)(\\d{1,2})(?:-?го)?\\s+(${Object.keys(MONTHS).join("|")})(?:\\s+(\\d{4}))?${EDGE}`, "iu");
const CLOCK = new RegExp(`(?:^|\\s)(?:в|к)\\s+(\\d{1,2})(?:[:.](\\d{2}))?(?:\\s*(?:ч|час(?:а|ов)?))?(?:\\s+(утра|дня|вечера|ночи))?${EDGE}`, "iu");
const PART = new RegExp(`(?:^|\\s)(утром|днем|вечером|ночью)${EDGE}`, "iu");

const plain = (value) => String(value ?? "").toLowerCase().replace(/ё/gu, "е");

/** Вырезать найденное выражение из фразы, оставив остальной текст. */
function cut(text, match) {
  return `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`;
}

/** Текст напоминания: без «что», «чтобы», «о том, что» в начале и без хвостовых знаков. */
export function cleanReminder(value) {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .replace(/^[\s,.:;—-]+/u, "")
    .replace(/^(?:пожалуйста|плиз)[\s,]+/iu, "")
    .replace(/^(?:о\s+том,?\s+)?(?:что|чтобы|чтоб)\s+/iu, "")
    .replace(/^(?:про|насчет|насчёт|о|об)\s+/iu, "")
    .replace(/[\s,.;:!?—-]+$/u, "")
    .trim()
    .slice(0, 300);
}

/**
 * Разобрать просьбу о напоминании.
 *
 * Возвращает `null`, если это не просьба; `{ ok: true, at, text }`, если время
 * понято; `{ ok: false, need: "time" | "future" }`, если понята только половина.
 */
export function parseReminder(input, { now = Date.now(), timeZone = "UTC" } = {}) {
  const raw = String(input ?? "").replace(/\s+/gu, " ").trim();
  const head = raw.match(TRIGGER);
  if (!head) return null;
  let rest = raw.slice(head[0].length);
  // Регистр и «ё» мешают разбору времени, но не тексту: ищем в приведённой
  // копии, вырезаем из исходной по тем же позициям (длина строк одинакова).
  const find = (pattern) => plain(rest).match(pattern);

  const relative = find(RELATIVE);
  if (relative) {
    rest = cut(rest, relative);
    let ms;
    if (relative[1]) ms = 30 * 60_000;
    else {
      const amount = relative[2] == null ? 1 : (NUMBER_WORDS[relative[2]] ?? Number(String(relative[2]).replace(",", ".")));
      const unit = UNIT_MS.find(([pattern]) => pattern.test(relative[3]));
      ms = Number.isFinite(amount) && unit ? Math.round(amount * unit[1]) : Number.NaN;
    }
    if (!Number.isFinite(ms) || ms < 20_000 || ms > MAX_AHEAD) return { ok: false, need: "future" };
    return { ok: true, at: now + ms, text: cleanReminder(rest) };
  }

  const today = localParts(now, timeZone);
  let date = null;      // { y, m, d }
  let explicitDay = false;
  const addDays = (base, days) => {
    const moved = new Date(Date.UTC(base.y, base.m - 1, base.d + days));
    return { y: moved.getUTCFullYear(), m: moved.getUTCMonth() + 1, d: moved.getUTCDate() };
  };

  const dayWord = find(DAY_WORD);
  if (dayWord) {
    rest = cut(rest, dayWord);
    date = addDays(today, ({ "сегодня": 0, "завтра": 1, "послезавтра": 2 })[dayWord[1]]);
    explicitDay = true;
  }
  const weekday = !date && find(WEEKDAY);
  if (weekday) {
    rest = cut(rest, weekday);
    const ahead = (WEEKDAYS[weekday[1]] - today.weekday + 7) % 7 || 7;
    date = addDays(today, ahead);
    explicitDay = true;
  }
  const dateWord = !date && find(DATE_WORD);
  if (dateWord) {
    rest = cut(rest, dateWord);
    const m = MONTHS[dateWord[2]];
    const d = Number(dateWord[1]);
    let y = dateWord[3] ? Number(dateWord[3]) : today.y;
    if (!dateWord[3] && (m < today.m || (m === today.m && d < today.d))) y += 1;
    date = { y, m, d };
    explicitDay = true;
  }
  const dateNum = !date && find(DATE_NUM);
  if (dateNum) {
    const d = Number(dateNum[1]), m = Number(dateNum[2]);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      rest = cut(rest, dateNum);
      let y = dateNum[3] ? Number(dateNum[3].length === 2 ? `20${dateNum[3]}` : dateNum[3]) : today.y;
      if (!dateNum[3] && (m < today.m || (m === today.m && d < today.d))) y += 1;
      date = { y, m, d };
      explicitDay = true;
    }
  }

  let hh = null, mm = 0;
  const clock = find(CLOCK);
  if (clock) {
    const hour = Number(clock[1]);
    const minute = clock[2] ? Number(clock[2]) : 0;
    if (hour <= 24 && minute <= 59) {
      rest = cut(rest, clock);
      hh = hour % 24; mm = minute;
      const half = clock[3];
      if ((half === "вечера" || half === "дня") && hh < 12) hh += 12;
      if (half === "ночи" && hh === 12) hh = 0;
    }
  }
  const part = find(PART);
  if (part) {
    rest = cut(rest, part);
    if (hh == null) hh = PART_OF_DAY[part[1]];
    // «в 7 вечером» — то же, что «в 7 вечера».
    else if ((part[1] === "вечером" || part[1] === "днем") && hh < 12) hh += 12;
  }

  if (!date && hh == null) return { ok: false, need: "time", text: cleanReminder(rest) };
  if (hh == null) hh = 9;                       // «напомни завтра» — утром
  date ??= { y: today.y, m: today.m, d: today.d };
  let at = zonedEpoch({ ...date, hh, mm }, timeZone);
  // «В 9» без дня, а девять уже прошло — значит завтра в девять.
  if (!explicitDay && at <= now + 20_000) at = zonedEpoch({ ...addDays(date, 1), hh, mm }, timeZone);
  if (!(at > now + 20_000) || at - now > MAX_AHEAD) return { ok: false, need: "future" };
  return { ok: true, at, text: cleanReminder(rest) };
}

export function createReminders({ store = null, now = () => Date.now() } = {}) {
  const memory = { seq: 0, items: [] };
  let nextDue = 0;
  let readAt = 0;

  async function read() {
    let saved = null;
    try { saved = store && typeof store.get === "function" ? await store.get(REMINDERS_KEY) : null; } catch { saved = null; }
    const value = saved && typeof saved === "object" ? saved : memory;
    const state = { seq: Number(value.seq) || 0, items: Array.isArray(value.items) ? value.items : [] };
    readAt = now();
    nextDue = state.items.length ? Math.min(...state.items.map(item => Number(item.at) || 0)) : Infinity;
    return state;
  }

  async function write(state) {
    memory.seq = state.seq;
    memory.items = state.items;
    nextDue = state.items.length ? Math.min(...state.items.map(item => Number(item.at) || 0)) : Infinity;
    if (!store || typeof store.set !== "function") return true;
    try { return Boolean(await store.set(REMINDERS_KEY, state)); } catch { return false; }
  }

  async function add({ userId, chatId, at, text = "", messageId = null, threadId = null, inGroup = false } = {}) {
    if (userId == null || chatId == null || !Number.isFinite(at)) return { ok: false, code: "invalid" };
    const state = await read();
    if (state.items.filter(item => String(item.userId) === String(userId)).length >= PER_USER) return { ok: false, code: "too_many" };
    if (state.items.length >= LIMIT) return { ok: false, code: "full" };
    const item = { id: state.seq + 1, userId: String(userId), chatId, at, text: cleanReminder(text), messageId, threadId, inGroup: Boolean(inGroup), created: now(), tries: 0 };
    if (!await write({ seq: item.id, items: [...state.items, item] })) return { ok: false, code: "storage_unavailable" };
    return { ok: true, item };
  }

  /** Напоминания человека по порядку срока: номера в списке — по этому порядку. */
  async function list(userId) {
    const state = await read();
    return state.items.filter(item => String(item.userId) === String(userId)).sort((a, b) => a.at - b.at);
  }

  /** Отменить по номеру из списка (с единицы) или все разом. */
  async function cancel(userId, index = null) {
    const state = await read();
    const mine = state.items.filter(item => String(item.userId) === String(userId)).sort((a, b) => a.at - b.at);
    const gone = index == null ? mine : mine.slice(Number(index) - 1, Number(index));
    if (!gone.length) return { ok: false, code: "no_such_reminder", count: mine.length };
    const ids = new Set(gone.map(item => item.id));
    if (!await write({ ...state, items: state.items.filter(item => !ids.has(item.id)) })) return { ok: false, code: "storage_unavailable" };
    return { ok: true, removed: gone, count: mine.length - gone.length };
  }

  /**
   * Чей срок пришёл. База читается не на каждое обновление: изолят помнит
   * ближайший срок и заглядывает в неё раз в минуту — вдруг напоминание
   * поставили через другой изолят.
   */
  async function due({ limit = 5 } = {}) {
    if (readAt && now() < nextDue && now() - readAt < 60_000) return [];
    const state = await read();
    return state.items.filter(item => Number(item.at) <= now()).sort((a, b) => a.at - b.at).slice(0, limit);
  }

  /** Напоминание ушло — убрать; не ушло — попробовать ещё дважды. */
  async function settle(id, delivered) {
    const state = await read();
    const item = state.items.find(entry => entry.id === id);
    if (!item) return { ok: true, dropped: false };
    const tries = Number(item.tries ?? 0) + 1;
    const drop = delivered || tries >= 3;
    const items = drop ? state.items.filter(entry => entry.id !== id) : state.items.map(entry => entry.id === id ? { ...entry, tries } : entry);
    await write({ ...state, items });
    return { ok: true, dropped: drop && !delivered };
  }

  async function size() {
    return (await read()).items.length;
  }

  /** «Удали всё обо мне» касается и напоминаний. */
  const wipe = (userId) => cancel(userId, null).then(() => ({ ok: true })).catch(() => ({ ok: false }));

  return Object.freeze({ add, list, cancel, due, settle, size, wipe });
}
