/**
 * Намазы словами: «намазы на сегодня», «когда магриб», «следующий намаз»,
 * «напоминай о намазе за 10 минут». Сам расчёт — в `fajr.js` (`prayersOn`),
 * здесь только разбор просьбы и названия.
 *
 * Названия — как их произносят по-русски, с татарскими и «бытовыми»
 * вариантами: «ахшам», «икенде», «вечерний намаз». «Ифтар» — это время
 * магриба, «сухур» кончается с фаджром: спрашивают и так.
 */

import { methodByName } from "./fajr.js";

/** Пять намазов и восход (он не намаз: с ним кончается время фаджра). */
export const PRAYERS = Object.freeze([
  { key: "fajr", title: "Фаджр", gen: "фаджра", bell: true },
  { key: "sunrise", title: "Восход", gen: "восхода", bell: false },
  { key: "dhuhr", title: "Зухр", gen: "зухра", bell: true },
  { key: "asr", title: "Аср", gen: "асра", bell: true },
  { key: "maghrib", title: "Магриб", gen: "магриба", bell: true },
  { key: "isha", title: "Иша", gen: "иша", bell: true },
]);
export const PRAYER_KEYS = Object.freeze(PRAYERS.filter(item => item.bell).map(item => item.key));
export const prayerInfo = (key) => PRAYERS.find(item => item.key === key) ?? null;

/** Хранилище напоминаний о намазе: `{ subs: { [userId]: { lead, city, lat, lon, tz, said, fails } } }`. */
export const PRAYER_KEY = "heart:prayer:v1";
export const PRAYER_SUBS_MAX = 200;
export const PRAYER_LEAD_DEFAULT = 10;
export const PRAYER_LEAD_MAX = 60;
/** Проспала начало — скажет и после, но не позже чем через столько. */
export const PRAYER_LATE_MS = 10 * 60_000;

const squash = (text) => String(text ?? "").toLowerCase().replace(/ё/gu, "е").replace(/[«»"]/gu, "").replace(/[,;:]+/gu, " ").replace(/\s+/gu, " ").trim().replace(/[.!?…]+$/u, "").trim();

const NAME = Object.freeze({
  fajr: "(?:фаджр\\S{0,2}|фаджр-намаз\\S{0,2}|сухур\\S{0,2}|сахур\\S{0,2}|иртэнге|иртянге)",
  sunrise: "(?:шурук\\S{0,2})",
  dhuhr: "(?:зухр\\S{0,2}|зухор\\S{0,2}|обеденн\\S+\\s+намаз\\S{0,2}|полуденн\\S+\\s+намаз\\S{0,2}|дневн\\S+\\s+намаз\\S{0,2}|ойля|ойлэ|уйля|уйлэ)",
  asr: "(?:аср\\S{0,2}|икенде|икинде|икинди|послеполуденн\\S+\\s+намаз\\S{0,2}|предвечерн\\S+\\s+намаз\\S{0,2})",
  maghrib: "(?:магриб\\S{0,2}|вечерн\\S+\\s+намаз\\S{0,2}|ахшам\\S{0,2}|акшам\\S{0,2}|ифтар\\S{0,2})",
  isha: "(?:иша|иша-намаз\\S{0,2}|ночн\\S+\\s+намаз\\S{0,2}|ясту|яссы|ясу)",
});
const WHEN = "(?:а\\s+)?(?:когда|во\\s+сколько|в\\s+котором\\s+часу|скажи\\s+время|время)";
const DAY = "(сегодня|завтра)";
const NAMAZ = "намаз(?:а|у|ом|е|ы|ов|ам|ами|ах)?";
const ONE = Object.entries(NAME).map(([key, name]) => [key, [
  new RegExp(`^${WHEN}\\s+(?:у\\s+(?:меня|нас)\\s+)?(?:будет\\s+)?(?:${DAY}\\s+)?${name}(?:\\s+${DAY})?$`, "u"),
  new RegExp(`^${name}\\s+(?:${DAY}\\s+)?(?:когда|во\\s+сколько)(?:\\s+${DAY})?$`, "u"),
  new RegExp(`^${name}\\s+${DAY}$`, "u"),
], new RegExp(`^(?:а\\s+)?(?:через\\s+)?сколько\\s+(?:(?:осталось|еще|времени|минут)\\s+)*до\\s+${name}$`, "u")]);

const LIST = [
  new RegExp(`^(?:а\\s+)?(?:(?:покажи|скажи|напиши|дай|назови)\\s+)?(?:время|времена|расписание|график)\\s+${NAMAZ}(?:\\s+на)?(?:\\s+${DAY})?$`, "u"),
  new RegExp(`^(?:а\\s+)?(?:все\\s+)?намазы(?:\\s+на)?(?:\\s+${DAY})?$`, "u"),
  new RegExp(`^${WHEN}\\s+(?:у\\s+(?:меня|нас)\\s+)?(?:${DAY}\\s+)?${NAMAZ}(?:\\s+${DAY})?$`, "u"),
];
const NEXT = new RegExp(`^(?:а\\s+)?(?:(?:какой|когда|во\\s+сколько)\\s+(?:сейчас\\s+|у\\s+нас\\s+|будет\\s+)?(?:следующий|ближайший)\\s+намаз|(?:следующий|ближайший)\\s+намаз(?:\\s+(?:когда|во\\s+сколько))?|(?:через\\s+)?сколько\\s+(?:(?:осталось|еще|времени|минут)\\s+)*до\\s+(?:следующего\\s+|ближайшего\\s+)?намаза|какой\\s+сейчас\\s+намаз|скоро\\s+(?:ли\\s+)?намаз)$`, "u");
const ABOUT = `(?:о|об|про|перед|к)\\s+(?:кажд(?:ом|ым|ому)\\s+)?${NAMAZ}`;
const LEAD = "(?:за\\s+(\\d{1,2})\\s*(?:минут\\S{0,2}|мин)|(заранее)|(вовремя|в\\s+срок|в\\s+момент|минута\\s+в\\s+минуту))";
const REMIND_ON = [
  new RegExp(`^(?:напоминай|напомни|предупреждай|сообщай|говори)\\s+(?:мне\\s+)?${ABOUT}(?:\\s+${LEAD})?$`, "u"),
  new RegExp(`^(?:напоминай|напомни|предупреждай|сообщай|говори)\\s+(?:мне\\s+)?${LEAD}\\s+(?:до\\s+(?:каждого\\s+)?намаза|${ABOUT})$`, "u"),
  new RegExp(`^(?:включи|поставь|сделай)\\s+напоминани[ея]\\s+${ABOUT}(?:\\s+${LEAD})?$`, "u"),
];
const REMIND_OFF = new RegExp(`^(?:(?:не\\s+(?:напоминай|надо\\s+напоминать|нужно\\s+напоминать|предупреждай|сообщай)|хватит\\s+напоминать|перестань\\s+напоминать)\\s+(?:мне\\s+)?(?:больше\\s+)?${ABOUT}|(?:отключи|выключи|убери|сними)\\s+напоминани[ея]\\s+${ABOUT})$`, "u");
const HOW = new RegExp(`^(?:а\\s+)?(?:как|по\\s+како(?:му|й)\\s+(?:методу|правилу|расчету))\\s+ты\\s+считаешь\\s+(?:время\\s+)?${NAMAZ}$`, "u");
const ASR_SCHOOL = /^(?:считай\s+)?аср\s+(?:по\s+|как\s+у\s+|в\s+)?(?:(ханафи\S*|ханафитск\S*|абу\s+ханиф\S*|двум\s+теням|две\s+тени)|(шафи\S*|шафиитск\S*|большинств\S*|одной\s+тени|одну\s+тень|обычн\S*))$/u;

// Метод целиком: «считай намазы по Турции», «намазы по ДУМ», «метод намазов — Диянет».
const BY = "(?:по|как\\s+(?:в|у))\\s+(?:методу\\s+|расчету\\s+|правилу\\s+|мазхабу\\s+)?";
// Второе в паре — «просьба о методе и без узнанного названия»: «намазы по пятницам» — разговор, а «считай намазы по Марсу» — просьба.
const METHOD = [
  [new RegExp(`^(?:считай|рассчитывай|ставь)\\s+(?:все\\s+)?(?:намазы|врем(?:я|ена)\\s+${NAMAZ})\\s+${BY}(.{2,40})$`, "u"), true],
  [new RegExp(`^намазы\\s+${BY}(.{2,40})$`, "u"), false],
  [new RegExp(`^метод\\s+(?:расчета\\s+)?${NAMAZ}\\s+(?:[—–-]\\s+)?(.{2,40})$`, "u"), true],
];
/** Мазхаб, названный вместо метода: от него зависит только аср. */
const HANAFI = /^(?:ханафи\S*|ханафитск\S*(?:\s+(?:мазхаб\S*|школ\S*))?|абу\s+ханиф\S*)$/u;
const OTHERS = /^(?:шафи\S*|шафиитск\S*|малики\S*|ханбали\S*)(?:\s+(?:мазхаб\S*|школ\S*))?$/u;

// Поправка хозяина: «поправка магриба +3», «поправка для фаджра минус 2 минуты».
const SHIFT_NAME = Object.freeze({
  fajr: "фаджр\\S{0,2}", sunrise: "(?:восход\\S{0,2}|шурук\\S{0,2})", dhuhr: "(?:зухр\\S{0,2}|зухор\\S{0,2})",
  asr: "аср\\S{0,2}", maghrib: "магриб\\S{0,2}", isha: "(?:иша|иши)",
});
const SHIFT_SET = Object.entries(SHIFT_NAME).map(([key, name]) => [key,
  new RegExp(`^поправк[аиу]\\s+(?:для\\s+|к\\s+|на\\s+)?${name}\\s+(?:на\\s+)?(плюс\\s+|минус\\s+|[+\\-−–]\\s*)?(\\d{1,2})(?:\\s*(?:минут\\S{0,2}|мин))?$`, "u"),
  new RegExp(`^(?:убери|сними|сбрось|отмени)\\s+поправку\\s+(?:для\\s+|к\\s+|на\\s+)?${name}$|^${name}\\s+без\\s+поправки$`, "u"),
]);
const SHIFT_CLEAR = new RegExp(`^(?:убери|сними|сбрось|отмени)\\s+(?:все\\s+)?поправки\\s+(?:к\\s+|для\\s+|у\\s+)?${NAMAZ}$|^намазы\\s+без\\s+поправок$|^считай\\s+намазы\\s+без\\s+поправок$`, "u");
const SHIFT_LIST = new RegExp(`^(?:(?:какие|покажи|твои)\\s+)?поправки\\s+(?:к\\s+|для\\s+|у\\s+)?${NAMAZ}$`, "u");
/** Предел поправки в минутах — тот же, что в расчёте (`SHIFT_MAX` в fajr.js). */
const SHIFT_LIMIT = 30;

/**
 * Слова о намазе → просьба, иначе null:
 *   { list: true, tomorrow }        — «намазы на сегодня», «расписание намазов на завтра», «когда намаз»;
 *   { one: "maghrib", tomorrow }    — «когда магриб», «во сколько завтра иша», «когда ифтар»;
 *   { one: "maghrib", left: true }  — «сколько до магриба»;
 *   { next: true }                  — «следующий намаз», «сколько до намаза»;
 *   { remind: 10 } / { remind: false } — «напоминай о намазе за 10 минут», «не напоминай о намазе»;
 *   { asr: 2 }                      — «аср по ханафи» (1 — «аср по шафии»);
 *   { how: true }                   — «как ты считаешь намазы», «поправки намазов»;
 *   { shift: { key, minutes } }     — «поправка магриба +3» (0 — снять одну);
 *   { shift: { clear: true } }      — «убери поправки намазов»;
 *   { method: "turkey" }            — «считай намазы по Турции», «намазы по ДУМ».
 * О фаджре («когда фаджр») отвечает `parseFajr`: у него свой, подробный ответ.
 */
export function parsePrayer(text) {
  const value = squash(text);
  if (!value || value.length > 90) return null;
  if (!/намаз|фаджр|сухур|сахур|шурук|зухр|зухор|аср|икенд|икинд|магриб|ахшам|акшам|ифтар|иша|ясту|яссы|ойл|уйл|иртэнге|иртянге|поправк/u.test(value)) return null;
  if (HOW.test(value) || SHIFT_LIST.test(value)) return { how: true };
  if (SHIFT_CLEAR.test(value)) return { shift: { clear: true } };
  for (const [key, set, drop] of SHIFT_SET) {
    if (drop.test(value)) return { shift: { key, minutes: 0 } };
    const found = value.match(set);
    if (!found) continue;
    const minutes = Number(found[2]) * (/минус|[-−–]/u.test(found[1] ?? "") ? -1 : 1);
    return Math.abs(minutes) <= SHIFT_LIMIT ? { shift: { key, minutes } } : { shift: { key, tooBig: true } };
  }
  const school = value.match(ASR_SCHOOL);
  if (school) return { asr: school[1] ? 2 : 1 };
  for (const [pattern, asking] of METHOD) {
    const found = value.match(pattern);
    if (!found) continue;
    const name = found[1].trim();
    if (HANAFI.test(name)) return { asr: 2 };
    if (OTHERS.test(name)) return { asr: 1 };
    const key = methodByName(name);
    if (key) return { method: key };
    if (asking && /^как(?:ой|ому|им)(?:\s|$)/u.test(name)) return { how: true };
    // Название не узнано, но просьба — о методе: ответить списком, а не отдавать модели.
    if (asking) return { method: "" };
  }
  if (REMIND_OFF.test(value)) return { remind: false };
  for (const pattern of REMIND_ON) {
    const found = value.match(pattern);
    if (!found) continue;
    if (found[3]) return { remind: 0 };
    const minutes = found[1] == null ? PRAYER_LEAD_DEFAULT : Number(found[1]);
    return minutes >= 0 && minutes <= PRAYER_LEAD_MAX ? { remind: minutes } : null;
  }
  if (NEXT.test(value)) return { next: true };
  for (const pattern of LIST) {
    const found = value.match(pattern);
    if (found) return { list: true, tomorrow: found.slice(1).includes("завтра") };
  }
  for (const [key, patterns, left] of ONE) {
    if (left.test(value)) return { one: key, left: true };
    for (const pattern of patterns) {
      const found = value.match(pattern);
      if (found) return { one: key, tomorrow: found.slice(1).includes("завтра") };
    }
  }
  return null;
}

/** «через 1 ч 12 мин», «через 7 мин», «через минуту». */
export function inWords(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes === 1) return "через минуту";
  if (minutes < 60) return `через ${minutes} мин`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return `через ${hours} ч${rest ? ` ${rest} мин` : ""}`;
}
