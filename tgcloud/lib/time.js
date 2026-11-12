import { CONFIG } from "./config.js";

export function validTimeZone(value) {
  if (typeof value !== "string" || value.length > 80) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); return true; } catch { return false; }
}
export function effectiveTimeZone(value) {
  return validTimeZone(value) ? value : validTimeZone(CONFIG.TIME_ZONE) ? CONFIG.TIME_ZONE : "UTC";
}
export function calendarDate(at, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: effectiveTimeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at));
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function localTimestamp(at, timeZone) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: effectiveTimeZone(timeZone), day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));
}
export async function personalTimeZone(store, userId) {
  const row = await store.getChecked(`assistant:settings:user:${userId}`);
  if (!row.ok) throw Error("timezone_storage_unavailable");
  return { timeZone: effectiveTimeZone(row.value?.timezone), explicit: validTimeZone(row.value?.timezone) };
}

/** Час по местному времени (0–23): по нему решается «утро» и «ночь». */
export function localHour(at, timeZone) {
  try {
    const hour = new Intl.DateTimeFormat("en-GB", { timeZone: effectiveTimeZone(timeZone), hour: "2-digit", hourCycle: "h23" }).format(new Date(at));
    const value = Number(String(hour).replace(/\D/gu, ""));
    return Number.isFinite(value) ? value % 24 : new Date(at).getUTCHours();
  } catch { return new Date(at).getUTCHours(); }
}

/** «14:05» по местному времени — для фраз «до 14:05». */
export function localClock(at, timeZone) {
  try {
    return new Intl.DateTimeFormat("ru-RU", { timeZone: effectiveTimeZone(timeZone), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));
  } catch { return new Date(at).toISOString().slice(11, 16); }
}

/**
 * «вторник, 11 ноября 2026 г., 14:05» — строка для подсказки модели. Без неё
 * на вопрос «какой сегодня день» модель называла дату из своих учебных данных.
 */
export function nowLine(at, timeZone) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: effectiveTimeZone(timeZone), weekday: "long", day: "numeric", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date(at));
  } catch { return new Date(at).toISOString().slice(0, 16).replace("T", " "); }
}

/** «пятница, 13 ноября» — день словами, без года и часов: для утреннего приветствия. */
export function dayLine(at, timeZone) {
  try {
    return new Intl.DateTimeFormat("ru-RU", { timeZone: effectiveTimeZone(timeZone), weekday: "long", day: "numeric", month: "long" }).format(new Date(at));
  } catch { return new Date(at).toISOString().slice(0, 10); }
}

/** Смещение пояса от UTC в минутах на данный момент: Москва → 180. */
export function zoneOffsetMinutes(at, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: effectiveTimeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(at));
    const get = (type) => Number(parts.find(part => part.type === type)?.value);
    const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
    return Math.round((local - Math.floor(at / 60_000) * 60_000) / 60_000);
  } catch { return 0; }
}

/** Местные дата и время по частям: для «завтра в 9» и «сколько времени в Токио». */
export function localParts(at, timeZone) {
  const shifted = new Date(Math.floor(at / 60_000) * 60_000 + zoneOffsetMinutes(at, timeZone) * 60_000);
  return {
    y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate(),
    hh: shifted.getUTCHours(), mm: shifted.getUTCMinutes(), weekday: shifted.getUTCDay(),
  };
}

/**
 * Местное «год-месяц-день час:минута» → момент времени. Два прохода: смещение
 * пояса зависит от самого момента (переход на летнее время).
 */
export function zonedEpoch({ y, m, d, hh = 0, mm = 0 }, timeZone) {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall;
  for (let pass = 0; pass < 2; pass++) guess = wall - zoneOffsetMinutes(guess, timeZone) * 60_000;
  return guess;
}
