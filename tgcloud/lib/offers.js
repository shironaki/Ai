/**
 * «Запомнить?» — она замечает в разговоре имя, город и день рождения и
 * спрашивает, записать ли. Сама ничего не пишет: человек сказал это к слову,
 * а не для анкеты, и решать ему. «Да» — записано, «нет» — больше об этом не
 * спросит.
 *
 * Замечает только сказанное прямо и о себе: «меня зовут …», «я из …», «у
 * меня день рождения …». Догадок («наверное, он из Казани») здесь нет.
 */
import { fold, knownCity } from "./sources.js";
import { cleanAddress } from "./personal.js";

export const OFFER_KEY = (userId) => `heart:offer:${userId}`;
/** Сколько ждёт ответа на вопрос: дольше «да» уже может быть о другом. */
export const OFFER_TTL_MS = 10 * 60_000;

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** После «меня зовут» это не имя: «меня зовут на свадьбу». */
const NOT_NAME = /^(?:на|в|во|к|ко|и|а|не|все|всех|друзья|домой|гулять|обедать|ужинать|есть|пить|играть|работать|туда|сюда|так|как|когда|просто|тоже|уже|опять|снова|сегодня|завтра|вчера|обратно|назад|замуж|с|со)$/u;

const NAME = /(?:^|[\s,.!?(])(?:меня\s+зовут|мое\s+имя(?:\s*[—–-])?)\s+([\p{L}][\p{L}-]{1,24})(?=$|[\s,.!?)])/u;
const CITY = /(?:^|[\s,.!?(])(?:я\s+(?:сейчас\s+)?(?:живу|нахожусь|обитаю)\s+в(?:\s+городе)?|я\s+(?:сам[а]?\s+)?(?:родом\s+)?из(?:\s+города)?)\s+([\p{L}][\p{L} -]{1,30}?)(?=$|[,.!?)]|\s+(?:и|а|но|уже|там|тут|где|с|со|у|на|это|если|когда|так)\s)/u;
const BIRTH = "(?:у\\s+меня\\s+(?:день\\s+рождения|др)|мой\\s+(?:день\\s+рождения|др)|я\\s+родил(?:ся|ась)|день\\s+рождения\\s+у\\s+меня)";
const BIRTH_WORDS = new RegExp(`${BIRTH}\\s*(?:[—–:-]\\s*)?(\\d{1,2})(?:-?го)?\\s+(${MONTHS.join("|")})(?:\\s+(\\d{4}))?`, "u");
const BIRTH_DIGITS = new RegExp(`${BIRTH}\\s*(?:[—–:-]\\s*)?(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{4}))?(?=$|[\\s,.!?)])`, "u");

/**
 * Что человек сказал о себе. Возвращает
 *   { kind: "name", value } · { kind: "city", value } · { kind: "birthday", day, month, year, value }
 * или null. Первый найденный факт — один вопрос за раз.
 */
export function detectFact(text) {
  const raw = String(text ?? "").replace(/\s+/gu, " ").trim();
  const value = fold(raw);
  if (!value || value.length > 400 || value.length !== raw.length) return null;
  let match;
  if ((match = value.match(NAME)) && !NOT_NAME.test(match[1])) {
    const at = match.index + match[0].length - match[1].length;
    const said = raw.slice(at, at + match[1].length);
    // Имя с большой буквы — или им кончается фраза: «меня зовут оля».
    const ends = /^(?:$|[,.!?)])/u.test(value.slice(at + match[1].length).trimStart()) || value.length === at + match[1].length;
    const name = cleanAddress(`${said[0].toUpperCase()}${said.slice(1)}`);
    if (name && (said[0] !== said[0].toLowerCase() || ends)) return { kind: "name", value: name };
  }
  if ((match = value.match(CITY))) {
    const city = knownCity(match[1]);
    if (city) return { kind: "city", value: city };
  }
  if ((match = value.match(BIRTH_WORDS)) ?? (match = value.match(BIRTH_DIGITS))) {
    const day = Number(match[1]);
    const month = /^\d+$/u.test(match[2]) ? Number(match[2]) : MONTHS.indexOf(match[2]) + 1;
    const year = match[3] ? Number(match[3]) : null;
    if (month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN[month - 1] && (year == null || (year >= 1900 && year <= 2100))) {
      return { kind: "birthday", day, month, year, value: `${day} ${MONTHS[month - 1]}` };
    }
  }
  return null;
}

/** Ярлык факта: по нему она помнит, о чём уже спрашивала. */
export const factTag = (fact) => `${fact.kind}:${fold(fact.value)}`;

/** Вопрос человеку. `formal` — на «вы». */
export function offerText(fact, formal = true) {
  if (fact.kind === "name") return formal ? `Запомнить, что вас зовут ${fact.value}? «Да» — так и буду обращаться.` : `Запомнить, что тебя зовут ${fact.value}? «Да» — так и буду обращаться.`;
  if (fact.kind === "city") return `Запомнить ${formal ? "ваш" : "твой"} город — ${fact.value}? «Да» — и погоду с часами буду считать по нему.`;
  return `Запомнить ${formal ? "ваш" : "твой"} день рождения — ${fact.value}? «Да» — и поздравлю каждый год.`;
}
