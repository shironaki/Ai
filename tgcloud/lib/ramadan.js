/**
 * Рамадан: какой сегодня день поста, напоминания о конце сухура и об ифтаре.
 *
 * Дни месяца — из расчётной таблицы Умм аль-Кура (`data/hijri.js`), без сети.
 * Точный день начала объявляют по луне, и он бывает на сутки позже или раньше:
 * хозяин поправляет словом («Рамадан на день позже», «Рамадан начался
 * сегодня», «Рамадан закончился») — поправка действует на тот год хиджры, для
 * которого сказана: начало сдвигается, длина месяца — 29 или 30 дней.
 * Вне Рамадана всё здесь молчит: подписка остаётся и сама оживает через год.
 *
 * Постный день — световой: сухур кончается с фаджром этого дня, ифтар — с его
 * магрибом. Времена считает `fajr.js`, здесь только календарь и слова.
 */
import { hijriOf, gregorianOf } from "./feasts.js";

const DAY = 86_400_000;
const RAMADAN = 9;
/** Подписки: `{ subs: { [userId]: { lead, city, lat, lon, tz, said: { suhur, iftar, eve }, fails, since } } }`. */
export const FAST_KEY = "heart:fast:v1";
export const FAST_SUBS_MAX = 200;
/** За сколько минут до фаджра напомнить о конце сухура. */
export const SUHUR_LEAD_DEFAULT = 30;
export const SUHUR_LEAD_MIN = 5;
export const SUHUR_LEAD_MAX = 120;
/** Поправка начала — не больше двух суток в любую сторону: дальше это уже не поправка. */
export const FAST_SHIFT_MAX = 2;

const utc = (y, m, d) => Date.UTC(y, m - 1, d);
const ymd = (at) => { const date = new Date(at); return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() }; };

/** Поправка хозяина для года `hy`: `{ shift, days }` (`days` — 29, 30 или null: как в таблице); для другого года — пустая. */
export function fastRule(saved, hy) {
  const rule = saved?.ramadan;
  if (!rule || Number(rule.hy) !== Number(hy)) return { shift: 0, days: null };
  const shift = Math.max(-FAST_SHIFT_MAX, Math.min(FAST_SHIFT_MAX, Math.round(Number(rule.shift) || 0)));
  return { shift, days: [29, 30].includes(Number(rule.days)) ? Number(rule.days) : null };
}

/** Рамадан года `hy` по таблице: `{ hy, first, days }` — первый день поста и сколько их; вне таблицы — null. */
export function ramadanOf(hy) {
  const first = gregorianOf(hy, RAMADAN, 1), next = gregorianOf(hy, RAMADAN + 1, 1);
  if (!first || !next) return null;
  return { hy, first, days: Math.round((utc(next.y, next.m, next.d) - utc(first.y, first.m, first.d)) / DAY) };
}

/** Рамадан года `hy` с поправкой хозяина: `{ hy, first (мс), days, table: { first, days } }` или null. */
export function ramadanFor(hy, saved = null) {
  const month = ramadanOf(hy);
  if (!month) return null;
  const rule = fastRule(saved, hy);
  const table = utc(month.first.y, month.first.m, month.first.d);
  return { hy, first: table + rule.shift * DAY, days: rule.days ?? month.days, shift: rule.shift, table: { first: table, days: month.days } };
}

/** Ближайший к дню Рамадан — идущий, только что прошедший или будущий: `{ hy, first, days, … , day }`; `day` — номер дня (может быть < 1 и > days). */
export function nearestRamadan(date, saved = null) {
  const at = utc(date.y, date.m, date.d);
  const now = hijriOf(date.y, date.m, date.d);
  if (!now) return null;
  let best = null;
  for (const hy of [now.hy - 1, now.hy, now.hy + 1]) {
    const month = ramadanFor(hy, saved);
    if (!month) continue;
    const day = Math.round((at - month.first) / DAY) + 1;
    const away = day < 1 ? 1 - day : day > month.days ? day - month.days : 0;
    if (!best || away < best.away) best = { ...month, day, away };
  }
  return best;
}

/**
 * День по нашему календарю → постный ли он: `{ hy, day, of, last }` или null.
 * `saved` — настройки хозяина (поправка начала и длины месяца).
 */
export function fastDay(date, saved = null) {
  if (!date) return null;
  const near = nearestRamadan(date, saved);
  if (!near || near.away) return null;
  return { hy: near.hy, day: near.day, of: near.days, last: near.day === near.days };
}

/** Ближайший первый день поста не раньше `date` (с поправкой хозяина): `{ hy, y, m, d, left }` или null. */
export function nextRamadan(date, saved = null) {
  const at = utc(date.y, date.m, date.d);
  const now = hijriOf(date.y, date.m, date.d);
  if (!now) return null;
  for (let hy = now.hy; hy <= now.hy + 1; hy += 1) {
    const month = ramadanFor(hy, saved);
    if (month && month.first >= at) return { hy, ...ymd(month.first), left: Math.round((month.first - at) / DAY) };
  }
  return null;
}

const fold = (text) => String(text ?? "").toLowerCase().replace(/ё/gu, "е").replace(/[«»"]/gu, "").replace(/[,;:]+/gu, " ").replace(/\s+/gu, " ").trim().replace(/[.!?…]+$/u, "").trim();
const MONTH = "(?:рамадан\\S{0,2}|рамазан\\S{0,2})";
const FAST = `(?:пост\\S{0,2}|уразы|ураза|уразе|уразу|${MONTH})`;
const MEALS = "(?:сухур\\S{0,2}|сахур\\S{0,2}|ифтар\\S{0,2}|разговени\\S{1,2})";
const ABOUT = `(?:о|об|про|в)\\s+(?:${FAST}|${MEALS}(?:\\s+и\\s+(?:об?\\s+)?${MEALS})?)`;
const LEAD = "(?:\\s+за\\s+(\\d{1,3})\\s*(?:минут\\S{0,2}|мин))?";
const ON = [
  new RegExp(`^(?:напоминай|напомни|предупреждай|сообщай|говори|буди)\\s+(?:мне\\s+|меня\\s+)?${ABOUT}${LEAD}$`, "u"),
  new RegExp(`^(?:напоминай|предупреждай|буди)\\s+(?:мне\\s+|меня\\s+)?(?:на\\s+|к\\s+|перед\\s+)${MEALS}${LEAD}$`, "u"),
  new RegExp(`^(?:включи|поставь|сделай)\\s+напоминани[ея]\\s+${ABOUT}${LEAD}$`, "u"),
];
const OFF = new RegExp(`^(?:не\\s+(?:напоминай|надо\\s+напоминать|нужно\\s+напоминать|предупреждай|сообщай|буди)|хватит\\s+напоминать|перестань\\s+напоминать|отключи\\s+напоминани[ея]|выключи\\s+напоминани[ея]|убери\\s+напоминани[ея])\\s+(?:мне\\s+|меня\\s+)?(?:${ABOUT}|(?:на\\s+|к\\s+|перед\\s+)${MEALS})$`, "u");
const DAY_ASK = [
  new RegExp(`^(?:а\\s+)?(?:какой|который)\\s+(?:сегодня\\s+|сейчас\\s+|идет\\s+)?день\\s+(?:${FAST})(?:\\s+сегодня)?$`, "u"),
  new RegExp(`^(?:а\\s+)?(?:сегодня\\s+|сейчас\\s+)?(?:какой|который)\\s+(?:по\\s+счету\\s+)?день\\s+(?:${FAST})$`, "u"),
  // Одно слово «рамадан» — не вопрос: им может оказаться ход в игре в слова.
  new RegExp(`^(?:а\\s+)?(?:(?:сейчас|сегодня|уже)\\s+(?:идет\\s+)?${MONTH}|идет\\s+(?:ли\\s+)?${MONTH}|${MONTH}\\s+(?:сейчас|сегодня|идет|уже\\s+идет|начался|уже\\s+начался|уже))$`, "u"),
  new RegExp(`^(?:а\\s+)?сколько\\s+(?:дней\\s+)?(?:${FAST}\\s+)?(?:осталось|еще)(?:\\s+(?:до\\s+конца\\s+)?${FAST})?$`, "u"),
  new RegExp(`^(?:а\\s+)?сколько\\s+(?:дней\\s+)?(?:осталось\\s+)?до\\s+конца\\s+(?:${FAST})$`, "u"),
  new RegExp(`^(?:а\\s+)?когда\\s+(?:кончится|закончится|конец|кончается|заканчивается)\\s+(?:${FAST})$`, "u"),
];
const SHIFT = [
  [new RegExp(`^${MONTH}\\s+(?:на\\s+)?(?:день|сутки)\\s+позже$|^(?:сдвинь|передвинь|перенеси)\\s+${MONTH}\\s+на\\s+(?:день|сутки)\\s+(?:позже|вперед)$`, "u"), { shift: 1 }],
  [new RegExp(`^${MONTH}\\s+(?:на\\s+)?(?:день|сутки)\\s+раньше$|^(?:сдвинь|передвинь|перенеси)\\s+${MONTH}\\s+на\\s+(?:день|сутки)\\s+(?:раньше|назад)$`, "u"), { shift: -1 }],
  [new RegExp(`^${MONTH}\\s+по\\s+(?:расчету|таблице|календарю)$|^(?:убери|сними|сбрось|отмени)\\s+поправку\\s+${MONTH}$`, "u"), { shift: 0 }],
  [new RegExp(`^(?:${MONTH}|пост)\\s+(?:начался|начинается|начнется|объявили|объявлен)\\s+(?:с\\s+)?(?:сегодня|сегодняшнего\\s+дня)$|^сегодня\\s+(?:первый\\s+день\\s+(?:${FAST})|начался\\s+${MONTH}|начало\\s+${MONTH})$`, "u"), { start: "today" }],
  [new RegExp(`^(?:${MONTH}|пост)\\s+(?:начинается|начнется|начался|объявили|объявлен)\\s+(?:с\\s+)?(?:завтра|завтрашнего\\s+дня)$|^завтра\\s+(?:первый\\s+день\\s+(?:${FAST})|начинается\\s+${MONTH}|начало\\s+${MONTH})$`, "u"), { start: "tomorrow" }],
  [new RegExp(`^(?:${MONTH}|пост)\\s+(?:закончился|кончился|завершился|завершен|окончен)$|^сегодня\\s+(?:ураза[-\\s]байрам|ид\\s+аль[-\\s]фитр|праздник\\s+разговения)$`, "u"), { end: "today" }],
  [new RegExp(`^завтра\\s+(?:ураза[-\\s]байрам|ид\\s+аль[-\\s]фитр|праздник\\s+разговения)$|^(?:ураза[-\\s]байрам|ид\\s+аль[-\\s]фитр)\\s+завтра$|^сегодня\\s+последний\\s+день\\s+(?:${FAST})$`, "u"), { end: "tomorrow" }],
];

/**
 * Слова о посте → просьба, иначе null:
 *   { day: true }                — «какой день поста», «сейчас Рамадан?», «сколько осталось до конца Рамадана»;
 *   { remind: 30 } / { remind: false } — «напоминай о сухуре и ифтаре», «напоминай о посте за 40 минут», «не напоминай о посте»;
 *   { shift: 1 | -1 | 0 }        — «Рамадан на день позже», «…на день раньше», «Рамадан по расчёту»;
 *   { start: "today" | "tomorrow" } — «Рамадан начался сегодня», «Рамадан начинается завтра»;
 *   { end: "today" | "tomorrow" }   — «Рамадан закончился», «завтра Ураза-байрам» (месяц короче или длиннее таблицы).
 * «Когда Рамадан», «когда ифтар», «сколько до сухура» — у праздников и намазов: там уже отвечают.
 */
export function parseFast(text) {
  const value = fold(text);
  if (!value || value.length > 90 || !/рамадан|рамазан|пост|ураз|сухур|сахур|ифтар|разговен|ид аль/u.test(value)) return null;
  for (const [pattern, result] of SHIFT) if (pattern.test(value)) return { ...result };
  if (OFF.test(value)) return { remind: false };
  for (const pattern of ON) {
    const found = value.match(pattern);
    if (!found) continue;
    const minutes = found[1] == null ? SUHUR_LEAD_DEFAULT : Number(found[1]);
    return minutes >= SUHUR_LEAD_MIN && minutes <= SUHUR_LEAD_MAX ? { remind: minutes } : { remind: SUHUR_LEAD_DEFAULT, clamped: true };
  }
  if (DAY_ASK.some(pattern => pattern.test(value))) return { day: true };
  return null;
}
