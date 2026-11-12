/**
 * Источники: то, что Аи узнаёт не из модели.
 *
 * Модель помнит мир таким, каким он был при её обучении, и не умеет сказать
 * «не знаю»: погоду она придумает, курс — вспомнит прошлогодний. Поэтому
 * факты берутся там, где они лежат: энциклопедия — в Википедии, погода — у
 * метеослужбы, курс — у Центробанка, города — в собственном списке. Модель
 * остаётся голосом; а когда думать нечем, источник отвечает и без неё.
 *
 * Все источники бесплатные, без ключей и без регистрации. Каждый может не
 * ответить: тогда возвращается `{ ok: false }` — и это не исключение.
 */
import { CITIES } from "./data/cities.js";

const WIKI = "https://ru.wikipedia.org";
const WIKTIONARY = "https://ru.wiktionary.org";
const GEO = "https://geocoding-api.open-meteo.com/v1/search";
const METEO = "https://api.open-meteo.com/v1/forecast";
const CBR = "https://www.cbr-xml-daily.ru/daily_json.js";
const AGENT = "AiHeart/1.0 (Telegram companion bot; no tracking)";

/** К виду для сравнения: регистр, «ё», лишние пробелы. */
export const fold = (text) => String(text ?? "").toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
/** Ключ города: без дефисов и пробелов — «нью йорк» и «Нью-Йорк» одно и то же. */
export const cityKey = (text) => fold(text).replace(/[\s\-–—.]+/gu, "");

const CITY_INDEX = new Map(CITIES.map(name => [cityKey(name), name]));
/** Исключения склонения, которые правилом не взять. */
const IRREGULAR = Object.freeze({ ельце: "елец", ельца: "елец" });

/** Беглая гласная: «Орле» → «Орел», «Волочке» → «Волочек». */
const fleeting = (stem) => (stem.length >= 3 ? `${stem.slice(0, -1)}е${stem.slice(-1)}` : stem);

/** Возможные начальные формы одного слова из названия города. */
function forms(word) {
  const out = [word];
  const add = (...items) => { for (const item of items) if (item && item.length >= 2 && !out.includes(item)) out.push(item); };
  if (IRREGULAR[word]) add(IRREGULAR[word]);
  if (/(?:ом|ем)$/u.test(word)) { const s = word.slice(0, -2); add(`${s}ий`, `${s}ый`, `${s}ой`, s); }
  if (/(?:ой|ей)$/u.test(word)) { const s = word.slice(0, -2); add(`${s}ая`, `${s}яя`); }
  if (/(?:ых|их)$/u.test(word)) { const s = word.slice(0, -2); add(`${s}ые`, `${s}ие`); }
  if (/(?:ах|ях)$/u.test(word)) { const s = word.slice(0, -2); add(`${s}ы`, `${s}и`, `${s}а`); }
  if (/е$/u.test(word)) { const s = word.slice(0, -1); add(`${s}а`, s, `${s}ь`, `${s}я`, `${s}й`, `${s}о`, fleeting(s)); }
  if (/и$/u.test(word)) { const s = word.slice(0, -1); add(`${s}ь`, `${s}я`, `${s}а`); }
  if (/у$/u.test(word)) add(`${word.slice(0, -1)}а`);
  if (/ю$/u.test(word)) add(`${word.slice(0, -1)}я`);
  if (/[ыи]$/u.test(word)) add(`${word.slice(0, -1)}а`);
  return out;
}

/** Все сочетания начальных форм фразы: «нижнем новгороде» → «нижний новгород». */
function phrases(text, limit = 80) {
  const parts = fold(text).split(/[\s\-–—]+/u).filter(Boolean).slice(0, 5);
  if (!parts.length) return [];
  let combos = [[]];
  for (const part of parts) {
    const next = [];
    for (const combo of combos) for (const form of forms(part)) { next.push([...combo, form]); if (next.length >= limit) break; }
    combos = next.slice(0, limit);
  }
  return combos;
}

/** Город из своего списка по фразе в любом падеже — или null. */
export function knownCity(text) {
  const direct = CITY_INDEX.get(cityKey(text));
  if (direct) return direct;
  for (const combo of phrases(text)) {
    const found = CITY_INDEX.get(combo.join(""));
    if (found) return found;
  }
  return null;
}

const WMO = Object.freeze({
  0: "ясно", 1: "почти ясно", 2: "переменная облачность", 3: "пасмурно",
  45: "туман", 48: "туман с изморозью",
  51: "слабая морось", 53: "морось", 55: "сильная морось", 56: "ледяная морось", 57: "ледяная морось",
  61: "небольшой дождь", 63: "дождь", 65: "сильный дождь", 66: "ледяной дождь", 67: "ледяной дождь",
  71: "небольшой снег", 73: "снег", 75: "сильный снег", 77: "снежная крупа",
  80: "небольшой ливень", 81: "ливень", 82: "сильный ливень", 85: "снегопад", 86: "сильный снегопад",
  95: "гроза", 96: "гроза с градом", 99: "гроза с градом",
});
const sky = (code) => WMO[Number(code)] ?? "без осадков";
const degrees = (value) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return "?";
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}°`;
};

/** Окончания: твёрдое мужское («доллар»), мягкое («рубль»), женское («лира»). */
const HARD = "(?:а|у|ом|е|ы|ов|ам|ами|ах)?";
const SOFT = "(?:ь|я|ю|ем|е|и|ей|ям|ями|ях)";
const FEM = "(?:а|ы|е|у|ой|ам|ами|ах)?";
const word = (body) => new RegExp(`^(?:${body})$`, "u");

/** Валюты, которые называют словами. Курс — рублей за единицу, по данным ЦБ. */
const CURRENCIES = Object.freeze([
  ["RUB", word(`рубл${SOFT}|руб\\.?|rub|rur|₽|р\\.?`), ["рубль", "рубля", "рублей"]],
  ["CAD", word(`канадск[а-я]{2,3}\\s+доллар${HARD}|cad`), ["канадский доллар", "канадских доллара", "канадских долларов"]],
  ["USD", word(`доллар${HARD}(?:\\s+сша)?|бакс${HARD}|usd|\\$`), ["доллар", "доллара", "долларов"]],
  ["EUR", word("евро|eur|€"), ["евро", "евро", "евро"]],
  ["CNY", word(`юан${SOFT}|cny|rmb`), ["юань", "юаня", "юаней"]],
  ["GBP", word(`фунт${HARD}(?:\\s+стерлингов)?|gbp|£`), ["фунт", "фунта", "фунтов"]],
  ["JPY", word(`[ий]ен${FEM}|jpy|¥`), ["иена", "иены", "иен"]],
  ["KZT", word("тенге|kzt"), ["тенге", "тенге", "тенге"]],
  ["BYN", word(`белорусск[а-я]{2,3}\\s+рубл${SOFT}|byn`), ["белорусский рубль", "белорусских рубля", "белорусских рублей"]],
  ["TRY", word(`(?:турецк[а-я]{2,3}\\s+)?лир${FEM}|try`), ["лира", "лиры", "лир"]],
  ["UAH", word(`гривн${FEM}|гривен|uah`), ["гривна", "гривны", "гривен"]],
  ["CHF", word(`(?:швейцарск[а-я]{2,3}\\s+)?франк${HARD}|франки|chf`), ["франк", "франка", "франков"]],
  ["AED", word(`дирхам${HARD}|aed`), ["дирхам", "дирхама", "дирхамов"]],
  ["PLN", word("злот(?:ый|ых|ого|ые|ым|ыми)|pln"), ["злотый", "злотых", "злотых"]],
  ["GEL", word("лари|gel"), ["лари", "лари", "лари"]],
  ["AMD", word(`драм${HARD}|amd`), ["драм", "драма", "драмов"]],
  ["UZS", word(`(?:узбекск[а-я]{2,3}\\s+)?сум${HARD}|uzs`), ["сум", "сума", "сумов"]],
  ["KGS", word(`(?:киргизск[а-я]{2,3}\\s+)?сом${HARD}|kgs`), ["сом", "сома", "сомов"]],
  ["AZN", word(`манат${HARD}|azn`), ["манат", "маната", "манатов"]],
  ["INR", word("рупи(?:я|и|ю|ей|й|ям|ями|ях)|inr"), ["рупия", "рупии", "рупий"]],
  ["KRW", word(`вон${FEM}|krw`), ["вона", "воны", "вон"]],
  ["THB", word(`бат${HARD}|thb`), ["бат", "бата", "батов"]],
  ["CZK", word(`(?:чешск[а-я]{2,3}\\s+)?крон${FEM}|czk`), ["крона", "кроны", "крон"]],
]);
const CURRENCY_NAMES = new Map(CURRENCIES.map(([code, , names]) => [code, names]));

/** «долларов», «евро», «usd» → код валюты или null. */
export function currencyCode(word) {
  const value = fold(word).replace(/[.,!?]+$/u, "");
  if (!value) return null;
  for (const [code, pattern] of CURRENCIES) if (pattern.test(value)) return code;
  return null;
}

const pluralOf = (n, [one, few, many]) => {
  const whole = Math.abs(Math.trunc(n));
  if (!Number.isInteger(n)) return few;
  const d = whole % 10, h = whole % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};
const money = (value, digits = 2) => {
  const fixed = Number(value).toFixed(digits);
  const [whole, frac] = fixed.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/gu, "\u202f")}${frac ? `,${frac}` : ""}`;
};
const NUMBER = "(\\d[\\d\\s\\u00a0\\u202f]*(?:[.,]\\d+)?)";
const SCALE = "(?:\\s*(тыс(?:яч[аи]?|\\.)?|млн\\.?|миллион(?:а|ов)?|млрд\\.?|миллиард(?:а|ов)?))?";
const amountOf = (digits, scale = "") => {
  const base = Number(String(digits).replace(/[\s\u00a0\u202f]/gu, "").replace(",", "."));
  const k = /^тыс/u.test(scale) ? 1e3 : /^(?:млн|миллион)/u.test(scale) ? 1e6 : /^(?:млрд|миллиард)/u.test(scale) ? 1e9 : 1;
  return Number((base * k).toPrecision(12));
};

const DAY_WORD = /(?:^|\s)(?:на\s+)?(сегодня|сейчас|завтра|послезавтра)(?=\s|$)/u;
const WEATHER = /^(?:(?:а|ну|и)\s+)?(?:(?:какая|какой|какую|что|как|скажи|покажи|подскажи|узнай|сколько)\s+)?(?:(?:там|у\s+нас|сейчас|сегодня|завтра|послезавтра|будет|за\s+окном)\s+){0,2}(?:погод[аыуе]|прогноз(?:\s+погоды)?|(?:с|по)\s+погодой|температур[аы]|градусов)(?=\s|$)(.*)$/u;

/** «Что такое X», «кто такой X» — вопрос, на который есть энциклопедия. */
const FACT = /^(?:(?:а|ну|и|слушай|скажи|подскажи)[\s,]+)?(?:что\s+такое|кто\s+так(?:ой|ая|ие|ое)|что\s+значит(?:\s+слово)?|что\s+означает(?:\s+слово)?)\s+(.+)$/u;
const PERSONAL = /(?:^|\s)(?:я|ты|мы|вы|он|она|они|мне|меня|тебе|тебя|нас|вас|нам|вам|мой|моя|мое|мои|твой|твоя|твое|твои|наш|наша|наше|ваш|ваша|себя|себе|это|этот|эта|эти|тут|здесь|там|сейчас|сегодня|для\s+тебя|по-твоему)(?=\s|$)/u;

/** Тема для энциклопедии из вопроса — или null, если вопрос личный. */
export function factQuery(text) {
  const value = fold(text).replace(/[?!.…]+$/u, "").trim();
  const match = value.match(FACT);
  if (!match) return null;
  const topic = match[1].replace(/^[«"']+|[»"']+$/gu, "").trim();
  if (!topic || topic.length > 60 || topic.split(" ").length > 5 || PERSONAL.test(topic)) return null;
  return topic;
}

/**
 * Что из сказанного — просьба к источнику. `value` — фраза в нижнем регистре
 * без хвостовой пунктуации. Возвращает `{ kind, … }` или null.
 */
export function detectSource(value) {
  const text = fold(value).replace(/[?!.…]+$/u, "").trim();
  if (!text) return null;

  // ── энциклопедия, названная прямо ─────────────────────────────────────
  let match = text.match(/^(?:вики|википеди[яию]|wiki)\s*[:,—-]?\s+(.{2,80})$/u)
    ?? text.match(/^(?:что\s+(?:пишет|говорит|сказано\s+в|написано\s+в)|посмотри\s+в|найди\s+в|поищи\s+в|глянь\s+в|загляни\s+в)\s+(?:вики|википеди[яию])\s+(?:(?:о|об|про|насчет)\s+)?(.{2,80})$/u)
    ?? text.match(/^(?:найди|поищи|посмотри)\s+(.{2,80}?)\s+в\s+(?:вики|википедии)$/u);
  if (match) return { kind: "wiki", query: match[1].replace(/^[«"']+|[»"']+$/gu, "").trim() };

  // ── погода ────────────────────────────────────────────────────────────
  match = text.match(WEATHER);
  if (match) {
    const head = text.slice(0, text.length - match[1].length);
    const dayWord = (text.match(DAY_WORD) ?? [])[1] ?? "";
    let tail = ` ${match[1]} `
      .replace(/\s(?:на\s+)?(?:сегодня|сейчас|завтра|послезавтра)(?=\s)/gu, " ")
      .replace(/\s(?:будет|ожидается|ждать|там|за\s+окном|на\s+улице|у\s+нас|воздуха|погоды)(?=\s)/gu, " ")
      .replace(/\s+/gu, " ").trim();
    const explicit = /^(?:в|во|на|для|по)\s+/u.test(tail);
    tail = tail.replace(/^(?:в|во|на|для|по)\s+(?:городе\s+|г\.\s*)?/u, "").replace(/^(?:городе|город|г\.)\s+/u, "").trim();
    if (tail.split(" ").length > 4) return null;
    return { kind: "weather", place: tail, explicit, day: dayWord === "завтра" ? 1 : dayWord === "послезавтра" ? 2 : 0, asked: head.trim() };
  }

  // ── курс и пересчёт ───────────────────────────────────────────────────
  match = text.match(new RegExp(`^(?:(?:сколько\\s+(?:будет\\s+|это\\s+)?|переведи\\s+|конвертируй\\s+|пересчитай\\s+))?${NUMBER}${SCALE}\\s*(\\S+(?:\\s+\\S+)?)\\s+(?:в|на)\\s+(\\S+(?:\\s+\\S+)?)$`, "u"));
  if (match) {
    const from = currencyCode(match[3]);
    const to = currencyCode(match[4]);
    if (from && to && from !== to) return { kind: "convert", amount: amountOf(match[1], match[2] ?? ""), from, to };
  }
  if (/^(?:(?:какой|какие|покажи|скажи)\s+)?(?:(?:сейчас|сегодня)\s+)?курс(?:ы)?(?:\s+(?:валют|цб|центробанка|на\s+сегодня|сегодня|сейчас))*$/u.test(text)) return { kind: "rates", codes: ["USD", "EUR", "CNY"] };
  match = text.match(/^(?:(?:какой|покажи|скажи)\s+)?(?:(?:сейчас|сегодня)\s+)?курс\s+(.+?)(?:\s+(?:к\s+рублю|в\s+рублях|на\s+сегодня|сегодня|сейчас|цб|по\s+цб))*$/u)
    ?? text.match(/^(?:сколько\s+(?:сейчас\s+|сегодня\s+)?сто(?:ит|ят)|почем(?:\s+сейчас)?)\s+(.+?)(?:\s+(?:в\s+рублях|сегодня|сейчас))*$/u);
  if (match) {
    const codes = match[1].split(/\s*(?:,|\sи\s)\s*/u).map(currencyCode).filter(code => code && code !== "RUB");
    if (codes.length) return { kind: "rates", codes: [...new Set(codes)].slice(0, 5) };
  }

  // ── часы и календарь ──────────────────────────────────────────────────
  if (/^(?:который\s+(?:сейчас\s+)?час|сколько\s+(?:сейчас\s+)?времени|сколько\s+на\s+(?:твоих\s+)?часах|какое\s+(?:сегодня|сейчас)\s+число|какая\s+(?:сегодня|сейчас)\s+дата|какой\s+(?:сегодня|сейчас)\s+день(?:\s+недели)?|какое\s+сегодня|что\s+сегодня\s+за\s+день)$/u.test(text)) return { kind: "clock" };
  match = text.match(/^(?:который\s+(?:сейчас\s+)?час|сколько\s+(?:сейчас\s+)?времени|какое\s+(?:сейчас\s+)?время)\s+(?:сейчас\s+)?(?:в|во|на)\s+(?:городе\s+)?(.{2,40})$/u);
  if (match) return { kind: "clock", place: match[1].trim() };
  match = text.match(/^сколько\s+(?:осталось\s+)?(?:дней\s+)?до\s+(.{3,40})$/u);
  if (match) return { kind: "until", target: match[1] };

  return null;
}

const MONTHS = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
const HOLIDAYS = Object.freeze([
  [/^нов(?:ого|ый)\s+год[а]?$/u, 1, 1, "Нового года"],
  [/^рождеств[ао]$/u, 1, 7, "Рождества"],
  [/^(?:8|восьмого)\s+марта$/u, 3, 8, "8 Марта"],
  [/^(?:23|двадцать\s+третьего)\s+февраля$/u, 2, 23, "23 февраля"],
  [/^(?:9|девятого)\s+мая|^дня\s+победы$/u, 5, 9, "Дня Победы"],
  [/^(?:1|первого)\s+сентября|^дня\s+знаний$/u, 9, 1, "1 сентября"],
  [/^(?:дня\s+)?(?:святого\s+)?валентина|^14\s+февраля$/u, 2, 14, "Дня святого Валентина"],
  [/^(?:1|первого)\s+мая$/u, 5, 1, "1 мая"],
  [/^лета$/u, 6, 1, "лета"], [/^осени$/u, 9, 1, "осени"], [/^зимы$/u, 12, 1, "зимы"], [/^весны$/u, 3, 1, "весны"],
]);

/** «до нового года», «до 25.12», «до 8 марта» → { month, day, year?, label }. */
export function parseTarget(text) {
  const value = fold(text).replace(/[?!.…]+$/u, "").trim();
  for (const [pattern, month, day, label] of HOLIDAYS) if (pattern.test(value)) return { month, day, label };
  let match = value.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?$/u);
  if (match) return { day: Number(match[1]), month: Number(match[2]), year: match[3] ? Number(match[3]) : null, label: "" };
  match = value.match(/^(\d{1,2})\s+([а-я]+)(?:\s+(\d{4}))?(?:\s+года)?$/u);
  if (match) {
    const index = MONTHS.findIndex(stem => match[2].startsWith(stem) && (stem !== "ма" || /^ма[йя]$/u.test(match[2])));
    if (index >= 0) return { day: Number(match[1]), month: index + 1, year: match[3] ? Number(match[3]) : null, label: "" };
  }
  return null;
}

export function createSources({ fetchImpl = null, store = null, now = () => Date.now(), timeoutMs = 4500 } = {}) {
  const available = () => typeof (fetchImpl ?? globalThis.fetch) === "function";

  /** Один GET. Никогда не бросает: нет сети, не тот статус, не JSON — это ответ, а не падение. */
  async function getJson(url, { timeout = timeoutMs } = {}) {
    const doFetch = fetchImpl ?? globalThis.fetch;
    if (typeof doFetch !== "function") return { ok: false, code: "unavailable" };
    const options = { method: "GET", headers: { Accept: "application/json", "Api-User-Agent": AGENT } };
    try { if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") options.signal = AbortSignal.timeout(timeout); } catch { /* без таймера — как есть */ }
    let response;
    try { response = await doFetch(url, options); } catch { return { ok: false, code: "network" }; }
    const status = Number(response?.status) || 0;
    const good = response?.ok === true || (typeof response?.ok !== "boolean" && status >= 200 && status < 300);
    if (!good) return { ok: false, code: status === 404 ? "not_found" : "http", status };
    try { return { ok: true, status, data: await response.json() }; } catch { return { ok: false, code: "invalid" }; }
  }

  /** Запас в базе: источник может молчать, а вчерашний ответ ещё годится. */
  async function cached(key, freshMs, load, { staleMs = 0 } = {}) {
    let saved = null;
    if (store?.available) { try { saved = await store.get(key); } catch { saved = null; } }
    if (saved?.at && now() - saved.at < freshMs) return { ...saved.value, cached: true };
    const loaded = await load();
    if (loaded?.ok) {
      if (store?.available) { try { await store.set(key, { at: now(), value: loaded }); } catch { /* без запаса */ } }
      return loaded;
    }
    if (saved?.at && staleMs && now() - saved.at < staleMs) return { ...saved.value, stale: true };
    return loaded;
  }

  // ── Википедия ───────────────────────────────────────────────────────────
  const cut = (text, limit) => {
    const clean = String(text ?? "").replace(/\s+/gu, " ").trim();
    if (clean.length <= limit) return clean;
    const slice = clean.slice(0, limit);
    const stop = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
    return stop > limit * 0.5 ? slice.slice(0, stop + 1) : `${slice.slice(0, slice.lastIndexOf(" "))}…`;
  };

  async function summary(title) {
    const got = await getJson(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(String(title).trim().replace(/\s+/gu, "_"))}?redirect=true`);
    if (!got.ok) return { ok: false, code: got.code === "not_found" ? "not_found" : "network" };
    const data = got.data ?? {};
    if (data.type === "disambiguation") return { ok: false, code: "ambiguous", title: String(data.title ?? title) };
    const extract = String(data.extract ?? "").trim();
    if (!extract) return { ok: false, code: "not_found" };
    return {
      ok: true,
      title: String(data.title ?? title),
      description: String(data.description ?? ""),
      extract,
      url: String(data.content_urls?.desktop?.page ?? `${WIKI}/wiki/${encodeURIComponent(String(data.title ?? title).replace(/\s+/gu, "_"))}`),
      image: String(data.originalimage?.source ?? data.thumbnail?.source ?? ""),
      thumb: String(data.thumbnail?.source ?? ""),
    };
  }

  async function searchTitles(query, limit = 4) {
    const got = await getJson(`${WIKI}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${limit}&utf8=1`);
    if (!got.ok) return null;
    const items = got.data?.query?.search;
    return Array.isArray(items) ? items.map(item => String(item?.title ?? "")).filter(Boolean) : [];
  }

  /**
   * Статья по теме. `search: false` — только точное название (для справки
   * модели: чужая статья по созвучию хуже, чем никакой).
   */
  async function wiki(query, { search = true, limit = 700 } = {}) {
    const topic = String(query ?? "").replace(/\s+/gu, " ").trim();
    if (!topic) return { ok: false, code: "not_found" };
    const found = await cached(`heart:src:wiki:${fold(topic).slice(0, 80)}:${search ? 1 : 0}`, 7 * 86_400_000, async () => {
      // В запасе лежит начало статьи, а не вся: полторы тысячи знаков хватает на любой ответ.
      const keep = (page) => ({ ...page, extract: page.extract.slice(0, 1500) });
      let page = await summary(topic);
      if (page.ok) return keep(page);
      if (page.code === "network") return page;
      if (!search) return page;
      const titles = await searchTitles(topic);
      if (titles == null) return { ok: false, code: "network" };
      if (page.code === "ambiguous") {
        const options = titles.filter(title => fold(title) !== fold(page.title) && !/значения/u.test(title)).slice(0, 4);
        return { ok: false, code: "ambiguous", title: page.title, options };
      }
      for (const title of titles.slice(0, 2)) {
        page = await summary(title);
        if (page.ok) return keep(page);
      }
      return { ok: false, code: "not_found" };
    });
    return found?.ok ? { ...found, text: cut(found.extract, limit) } : found;
  }

  // ── слова: есть ли такое слово (для игр) ────────────────────────────────
  /** true — слово есть в словаре, false — нет, null — проверить не удалось. */
  async function wordExists(word) {
    const value = fold(word);
    if (!/^[а-я-]{2,30}$/u.test(value)) return false;
    const got = await getJson(`${WIKTIONARY}/w/api.php?action=query&titles=${encodeURIComponent(value)}&format=json&utf8=1`, { timeout: 3500 });
    if (!got.ok) return null;
    const pages = got.data?.query?.pages;
    if (!pages || typeof pages !== "object") return null;
    return Object.values(pages).some(page => page && page.missing === undefined && Number(page.pageid) > 0);
  }

  // ── города и погода ─────────────────────────────────────────────────────
  async function geocode(name) {
    const got = await getJson(`${GEO}?name=${encodeURIComponent(name)}&count=5&language=ru&format=json`, { timeout: 3500 });
    if (!got.ok) return null;
    return Array.isArray(got.data?.results) ? got.data.results : [];
  }

  /**
   * Найти место по фразе в любом падеже. Справочник ищет по началу слова
   * («Москве» → «Москверо»), поэтому принимается только точное совпадение
   * названия с одной из начальных форм.
   */
  async function findPlace(text) {
    const phrase = fold(text);
    if (!phrase || phrase.length > 60) return { ok: false, code: "unknown_place" };
    return cached(`heart:src:geo:${cityKey(phrase).slice(0, 60)}`, 30 * 86_400_000, async () => {
      const own = knownCity(phrase);
      const candidates = own ? [own] : [...new Set([phrase, ...phrases(phrase, 12).map(combo => combo.join(" "))])].slice(0, 5);
      let failed = 0;
      for (const candidate of candidates) {
        const results = await geocode(candidate);
        if (results == null) { failed++; if (failed >= 2) break; continue; }
        const wanted = cityKey(candidate);
        const hit = results.find(item => cityKey(item?.name) === wanted && /^PPL/u.test(String(item?.feature_code ?? "PPL")));
        if (hit) {
          return {
            ok: true, name: String(hit.name), country: String(hit.country ?? ""), region: String(hit.admin1 ?? ""),
            latitude: Number(hit.latitude), longitude: Number(hit.longitude), timezone: String(hit.timezone ?? ""),
          };
        }
      }
      return { ok: false, code: failed ? "network" : "unknown_place" };
    });
  }

  /** Есть ли такой город: свой список, затем справочник. null — проверить не удалось. */
  async function cityExists(name) {
    const own = CITY_INDEX.get(cityKey(name));
    if (own) return { ok: true, name: own, own: true };
    const place = await findPlace(name);
    if (place?.ok) return { ok: true, name: place.name, own: false };
    return place?.code === "network" ? null : { ok: false };
  }

  async function weather(placeText, { day = 0 } = {}) {
    const place = await findPlace(placeText);
    if (!place?.ok) return { ok: false, code: place?.code ?? "unknown_place" };
    const url = `${METEO}?latitude=${place.latitude}&longitude=${place.longitude}`
      + "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m"
      + "&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max"
      + "&timezone=auto&forecast_days=3&wind_speed_unit=ms";
    const got = await cached(`heart:src:meteo:${cityKey(place.name)}`, 20 * 60_000, async () => {
      const answer = await getJson(url);
      return answer.ok && answer.data?.daily ? { ok: true, current: answer.data.current ?? null, daily: answer.data.daily } : { ok: false, code: "network" };
    }, { staleMs: 3 * 3_600_000 });
    if (!got?.ok) return { ok: false, code: "network", place };
    const { current, daily } = got;
    const dayLine = (index, label) => {
      const low = daily.temperature_2m_min?.[index], high = daily.temperature_2m_max?.[index];
      if (low == null || high == null) return "";
      const rain = Number(daily.precipitation_probability_max?.[index]);
      return `${label}: от ${degrees(low)} до ${degrees(high)}, ${sky(daily.weather_code?.[index])}${Number.isFinite(rain) && rain >= 20 ? `, осадки — ${Math.round(rain)}%` : ""}.`;
    };
    const where = place.region && place.region !== place.name && place.country !== "Россия" ? `${place.name} (${place.country})` : place.name;
    const lines = [];
    if (day === 0 && current) {
      const wind = Number(current.wind_speed_10m);
      const feels = Math.round(Number(current.apparent_temperature));
      const real = Math.round(Number(current.temperature_2m));
      lines.push(`${where}, сейчас ${degrees(current.temperature_2m)}${Number.isFinite(feels) && Math.abs(feels - real) >= 2 ? ` (ощущается как ${degrees(feels)})` : ""}, ${sky(current.weather_code)}${Number.isFinite(wind) ? `, ветер ${Math.round(wind)} м/с` : ""}.`);
      lines.push(dayLine(0, "Сегодня"), dayLine(1, "Завтра"));
    } else if (day === 0) {
      lines.push(`${where}.`, dayLine(0, "Сегодня"), dayLine(1, "Завтра"));
    } else {
      lines.push(`${where}.`, dayLine(day, day === 1 ? "Завтра" : "Послезавтра"));
      if (day === 1) lines.push(dayLine(2, "Послезавтра"));
    }
    const text = lines.filter(Boolean).join("\n");
    if (!text.includes("°")) return { ok: false, code: "network", place };
    return { ok: true, place, text: `${text}${got.stale ? "\n(Свежих данных нет — это прогноз трёхчасовой давности.)" : ""}`, source: "Open-Meteo" };
  }

  // ── курсы ───────────────────────────────────────────────────────────────
  async function table() {
    return cached("heart:src:rates", 3 * 3_600_000, async () => {
      const got = await getJson(CBR);
      const list = got.ok ? got.data?.Valute : null;
      if (!list || typeof list !== "object") return { ok: false, code: "network" };
      const rates = {};
      for (const [code, row] of Object.entries(list)) {
        const nominal = Number(row?.Nominal) || 1;
        const value = Number(row?.Value);
        if (Number.isFinite(value) && value > 0) rates[code] = { value: value / nominal, previous: Number(row?.Previous) / nominal || null };
      }
      return { ok: true, date: String(got.data?.Date ?? "").slice(0, 10), rates };
    }, { staleMs: 4 * 86_400_000 });
  }
  const dateLabel = (iso) => (/^\d{4}-\d{2}-\d{2}$/u.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : "");

  async function rates(codes = ["USD", "EUR", "CNY"]) {
    const got = await table();
    if (!got?.ok) return { ok: false, code: "network" };
    const lines = [];
    for (const code of codes) {
      const row = got.rates[code];
      if (!row) continue;
      const diff = row.previous ? row.value - row.previous : 0;
      const small = row.value < 1;
      const per = small ? 100 : 1;
      const names = CURRENCY_NAMES.get(code) ?? [code, code, code];
      lines.push(`${per === 1 ? names[0] : `${per} ${names[2]}`} — ${money(row.value * per)} ₽${Math.abs(diff * per) >= 0.005 ? ` (за день ${diff > 0 ? "+" : "−"}${money(Math.abs(diff * per))})` : ""}`);
    }
    if (!lines.length) return { ok: false, code: "unknown_currency" };
    return { ok: true, text: `Курс ЦБ${dateLabel(got.date) ? ` на ${dateLabel(got.date)}` : ""}:\n${lines.join("\n")}`, date: got.date, source: "ЦБ РФ" };
  }

  async function convert(amount, from, to) {
    const got = await table();
    if (!got?.ok) return { ok: false, code: "network" };
    const rub = (code) => (code === "RUB" ? 1 : got.rates[code]?.value ?? null);
    const a = rub(from), b = rub(to);
    if (!a || !b || !Number.isFinite(amount) || amount <= 0) return { ok: false, code: "unknown_currency" };
    const result = amount * a / b;
    const names = (code) => CURRENCY_NAMES.get(code) ?? [code, code, code];
    const sign = (code) => (code === "RUB" ? "₽" : code === "USD" ? "$" : code === "EUR" ? "€" : "");
    const left = `${money(amount, Number.isInteger(amount) ? 0 : 2)} ${pluralOf(amount, names(from))}`;
    const right = `${money(result)} ${sign(to) || pluralOf(Math.round(result), names(to))}`;
    return { ok: true, text: `${left} — это ${right} по курсу ЦБ${dateLabel(got.date) ? ` на ${dateLabel(got.date)}` : ""}.`, value: result, source: "ЦБ РФ" };
  }

  // ── картинки и гифки ────────────────────────────────────────────────────
  /** Случайная картинка зверя: адрес файла или null. */
  async function animal(kind) {
    if (kind === "cat") { const got = await getJson("https://api.thecatapi.com/v1/images/search", { timeout: 4000 }); return got.ok ? String(got.data?.[0]?.url ?? "") || null : null; }
    if (kind === "dog") { const got = await getJson("https://dog.ceo/api/breeds/image/random", { timeout: 4000 }); return got.ok ? String(got.data?.message ?? "") || null : null; }
    if (kind === "fox") { const got = await getJson("https://randomfox.ca/floof/", { timeout: 4000 }); return got.ok ? String(got.data?.image ?? "") || null : null; }
    return null;
  }

  /** Гифка-жест: обнять, погладить, помахать. Адрес файла или null. */
  async function gesture(category) {
    if (!/^[a-z]{2,16}$/u.test(String(category))) return null;
    const got = await getJson(`https://nekos.best/api/v2/${category}`, { timeout: 4000 });
    return got.ok ? String(got.data?.results?.[0]?.url ?? "") || null : null;
  }

  /**
   * Живая проба: доходит ли платформа до источников. «Подключено» — это
   * настройка, «ответил» — факт; владелец видит второе.
   */
  async function probe() {
    const [encyclopedia, meteo, bank] = await Promise.all([
      getJson(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent("Москва")}`, { timeout: 3500 }),
      getJson(`${GEO}?name=${encodeURIComponent("Москва")}&count=1&language=ru&format=json`, { timeout: 3500 }),
      getJson(CBR, { timeout: 3500 }),
    ]);
    return { wiki: encyclopedia.ok, weather: meteo.ok, rates: bank.ok };
  }

  return Object.freeze({ available, wiki, wordExists, findPlace, cityExists, weather, rates, convert, animal, gesture, probe });
}
