/**
 * Словарь из разговора: чему её научил хозяин и чего она не узнала.
 *
 * Две вещи, обе без модели.
 *
 * 1. Выученное. Хозяин говорит: «на «привет, медвед» отвечай «превед!»» —
 *    и с этой минуты на такую реплику она отвечает так, кому угодно. Править
 *    файл PHRASES.txt для этого не нужно: выученное лежит в базе и важнее
 *    словаря из файла. Учит только хозяин и только в личке: слова, которые
 *    она скажет другим, не должен вкладывать кто попало.
 *
 * 2. Неузнанное. Короткая реплика, которую не взял ни словарь, ни правило,
 *    уходит к модели — и записывается сюда, без автора. По счёту видно, чего
 *    в словаре не хватает на самом деле, а не по догадке.
 */
import { clean } from "./catalogue.js";
import { isLaugh, plainWords, squeezed } from "./slang.js";

export const TAUGHT_KEY = "heart:taught:v1";
export const UNHEARD_KEY = "heart:unheard:v1";
const MAX_ITEMS = 300;
const MAX_ANSWERS = 8;
const MAX_UNHEARD = 200;

const squash = (text) => String(text ?? "").replace(/\s+/gu, " ").trim();
const unquote = (text) => squash(text).replace(/^[«"“„'`]+|[»"”'`]+$/gu, "").trim();
const Q = "[«\"“„'`]";
const E = "[»\"”'`]";
const SAY = "(?:отвечай|говори|скажи|пиши)(?:те)?";
const TEACH = [
  // на «привет, медвед» отвечай «превед!»
  new RegExp(`^(?:а\\s+)?на\\s+${Q}(.+?)${E}\\s*[-—,:]?\\s*${SAY}\\s*[-—:]?\\s*(.+)$`, "iu"),
  // когда говорят «…», отвечай «…» · если скажут «…» — отвечай «…»
  new RegExp(`^(?:когда|если)\\s+(?:(?:тебе|кто-то|кто\\s+то|люди)\\s+)?(?:говорят|скажут|пишут|напишут|спросят|спрашивают)\\s+${Q}?(.+?)${E}?\\s*[-—,:]\\s*(?:то\\s+)?${SAY}\\s*[-—:]?\\s*(.+)$`, "iu"),
  // выучи фразу: привет медвед = превед!
  /^(?:выучи(?:те)?(?:\s+фразу)?|новая\s+фраза|научись|фраза)\s*:\s*(.+?)\s*(?:=>|->|→|=)\s*(.+)$/iu,
];
const LIST = /^(?:(?:фразы|словарь)\s+(?:этого\s+)?(?:чата|группы)|чему\s+я\s+тебя\s+(?:на)?учил[аи]?|(?:покажи\s+)?(?:мои|выученные|свои\s+выученные)\s+фразы|что\s+ты\s+выучила|покажи\s+выученное|выученное|чему\s+ты\s+научена)$/iu;
const DROP = new RegExp(`^(?:забудь|разучи|удали|убери)(?:те)?\\s+(?:выученную\\s+)?фразу\\s+(?:(?:номер\\s+|№\\s*)?(\\d{1,3})|${Q}?(.+?)${E}?)$`, "iu");
const UNHEARD = /^(?:(?:что|чего)\s+(?:ты\s+)?не\s+(?:поняла|узнала)(?:\s+(?:сегодня|за\s+неделю|за\s+день))?|(?:что|чего)\s+не\s+хватает\s+в\s+словаре|(?:покажи\s+)?(?:непонятые|неузнанные|непонятое|неузнанное)(?:\s+фразы)?|что\s+ушло\s+к\s+модели)$/iu;
const UNHEARD_CLEAR = /^(?:забудь|очисти|сотри|удали)(?:те)?\s+(?:все\s+)?(?:непонятое|неузнанное|непонятые(?:\s+фразы)?|неузнанные(?:\s+фразы)?)$/iu;

/**
 * Слова хозяина о словаре → просьба, иначе null:
 *   { add: { when, say } } · { list: true } · { drop: 3 } · { drop: "фраза" }
 *   { unheard: true } · { unheardClear: true }
 */
export function parseTeach(text) {
  const value = squash(text);
  if (!value || value.length > 700) return null;
  const bare = value.replace(/[.!?…]+$/u, "").trim().replace(/ё/giu, "е");
  if (LIST.test(bare)) return { list: true };
  if (UNHEARD_CLEAR.test(bare)) return { unheardClear: true };
  if (UNHEARD.test(bare)) return { unheard: true };
  const drop = bare.match(DROP);
  if (drop) return drop[1] ? { drop: Number(drop[1]) } : { drop: unquote(drop[2]) };
  for (const pattern of TEACH) {
    const found = value.match(pattern);
    if (!found) continue;
    const when = unquote(found[1]), say = unquote(found[2]);
    if (when && say) return { add: { when, say } };
  }
  return null;
}

/** Слова, которые зависят от разговора: неузнанными их считать бессмысленно. */
const CONTEXTUAL = new Set(["да", "нет", "неа", "не", "ну", "ну да", "ну и", "и что", "ну и что", "что делать", "ээ", "эээ", "ага", "угу", "почему", "зачем", "что", "чего", "как", "когда", "где", "кто", "какой", "какая", "а", "и", "или", "может", "наверное", "точно", "правда", "конечно", "давай", "хочу", "не хочу", "не знаю", "не надо", "еще", "дальше", "потом", "тоже", "первое", "второе", "третье"]);

export function createTaught({ store = null, now = () => Date.now(), random = Math.random } = {}) {
  const usable = () => Boolean(store?.available);
  let cache = null, cacheAt = 0;

  async function load() {
    if (cache && now() - cacheAt < 15_000) return cache;
    let saved = null;
    if (usable()) { try { saved = await store.get(TAUGHT_KEY); } catch { saved = null; } }
    const items = Array.isArray(saved?.items) ? saved.items.filter(item => item && typeof item.w === "string" && Array.isArray(item.a) && item.a.length) : [];
    cache = { items };
    cacheAt = now();
    return cache;
  }
  async function save(items) {
    cache = { items };
    cacheAt = now();
    if (!usable()) return false;
    try { await store.set(TAUGHT_KEY, { items, at: now() }); return true; } catch { return false; }
  }

  /** Выучить: та же реплика второй раз — ещё один вариант ответа. */
  async function add(when, say) {
    const key = clean(when), answer = squash(say).slice(0, 400);
    if (!key || key.length > 80) return { ok: false, code: key ? "long" : "empty" };
    if (!answer) return { ok: false, code: "empty" };
    if (!usable()) return { ok: false, code: "storage_unavailable" };
    const items = [...(await load()).items];
    const at = items.findIndex(item => item.w === key);
    if (at >= 0) {
      if (items[at].a.includes(answer)) return { ok: true, duplicate: true, answers: items[at].a.length, total: items.length, when: key };
      if (items[at].a.length >= MAX_ANSWERS) return { ok: false, code: "too_many_answers", answers: items[at].a.length };
      items[at] = { ...items[at], a: [...items[at].a, answer] };
    } else {
      if (items.length >= MAX_ITEMS) return { ok: false, code: "too_many", total: items.length };
      items.push({ w: key, a: [answer], at: now() });
    }
    const item = at >= 0 ? items[at] : items.at(-1);
    return (await save(items)) ? { ok: true, answers: item.a.length, total: items.length, when: key } : { ok: false, code: "storage_unavailable" };
  }

  const list = async () => (await load()).items.map(item => ({ when: item.w, say: [...item.a] }));

  /** Забыть по номеру из списка или по самой реплике. */
  async function drop(which) {
    const items = [...(await load()).items];
    const at = typeof which === "number" ? which - 1 : items.findIndex(item => item.w === clean(which));
    if (!(at >= 0 && at < items.length)) return { ok: false, code: "not_found", total: items.length };
    const [gone] = items.splice(at, 1);
    return (await save(items)) ? { ok: true, when: gone.w, total: items.length } : { ok: false, code: "storage_unavailable" };
  }

  /** Реплика целиком → выученный ответ (один из вариантов) или null. */
  async function match(text) {
    const raw = String(text ?? "").trim();
    if (!raw || raw.length > 160) return null;
    const key = clean(raw);
    if (!key) return null;
    const { items } = await load();
    if (!items.length) return null;
    const item = items.find(entry => entry.w === key);
    if (!item) return null;
    return item.a[Math.min(item.a.length - 1, Math.floor(Math.min(0.999999, Math.max(0, Number(random()) || 0)) * item.a.length))];
  }

  // ── неузнанное ─────────────────────────────────────────────────────────
  /** Годится ли реплика в список неузнанного: короткая, без чисел, ссылок и имён с «@». */
  function worth(text) {
    const raw = String(text ?? "").trim();
    if (!raw || raw.length > 60 || /\d|@|https?:|www\.|\//iu.test(raw)) return "";
    const key = clean(raw);
    if (!key || key.length < 2 || key.split(" ").length > 6 || CONTEXTUAL.has(key)) return "";
    // Смех и растянутое «дааа» — не пробел в словаре: смех она узнаёт сама, а «да» ждёт модель по смыслу.
    if (isLaugh(raw) || CONTEXTUAL.has(plainWords(raw)) || squeezed(raw).some(item => CONTEXTUAL.has(item))) return "";
    return key;
  }
  /** Записать реплику, ушедшую к модели. Без автора: важно, что сказано, а не кем. */
  async function note(text) {
    const key = worth(text);
    if (!key || !usable()) return false;
    let saved = null;
    try { saved = await store.get(UNHEARD_KEY); } catch { saved = null; }
    const map = saved?.map && typeof saved.map === "object" ? { ...saved.map } : {};
    const before = map[key];
    map[key] = { n: (Number(before?.n) || 0) + 1, at: now() };
    const keys = Object.keys(map);
    if (keys.length > MAX_UNHEARD) {
      // Лишнее — самое редкое и самое давнее.
      keys.sort((a, b) => (map[a].n - map[b].n) || (map[a].at - map[b].at));
      for (const gone of keys.slice(0, keys.length - MAX_UNHEARD)) delete map[gone];
    }
    try { await store.set(UNHEARD_KEY, { map, since: Number(saved?.since) || now(), at: now() }); return true; } catch { return false; }
  }
  /** Неузнанное по убыванию счёта: `[{ text, n }]`. `sinceMs` — только за последнее время. */
  async function unheard({ limit = 30, sinceMs = 0 } = {}) {
    if (!usable()) return [];
    let saved = null;
    try { saved = await store.get(UNHEARD_KEY); } catch { saved = null; }
    const map = saved?.map && typeof saved.map === "object" ? saved.map : {};
    return Object.entries(map)
      .filter(([, row]) => !sinceMs || Number(row?.at) >= now() - sinceMs)
      .map(([text, row]) => ({ text, n: Number(row?.n) || 0, at: Number(row?.at) || 0 }))
      .sort((a, b) => (b.n - a.n) || (b.at - a.at))
      .slice(0, limit);
  }
  /** Выученная реплика больше не «неузнанная». */
  async function settle(when) {
    const key = clean(when);
    if (!key || !usable()) return;
    try {
      const saved = await store.get(UNHEARD_KEY);
      if (!saved?.map || !(key in saved.map)) return;
      const map = { ...saved.map };
      delete map[key];
      await store.set(UNHEARD_KEY, { ...saved, map, at: now() });
    } catch { /* список подождёт */ }
  }
  /** Сборка научилась понимать эти реплики сама — из неузнанного они уходят одной записью. Возвращает, сколько ушло. */
  async function settleAll(list) {
    const keys = (Array.isArray(list) ? list : []).map(item => clean(item)).filter(Boolean);
    if (!keys.length || !usable()) return 0;
    try {
      const saved = await store.get(UNHEARD_KEY);
      if (!saved?.map) return 0;
      const map = { ...saved.map };
      let gone = 0;
      for (const key of keys) if (key in map) { delete map[key]; gone += 1; }
      if (gone) await store.set(UNHEARD_KEY, { ...saved, map, at: now() });
      return gone;
    } catch { return 0; }
  }
  const clearUnheard = async () => (usable() ? store.set(UNHEARD_KEY, { map: {}, since: now(), at: now() }).then(() => true).catch(() => false) : false);
  const count = async () => (await load()).items.length;

  return Object.freeze({ add, list, drop, match, note, unheard, settle, settleAll, clearUnheard, count, worth });
}
