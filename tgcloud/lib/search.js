/**
 * Поиск: «найди в интернете …», «загугли …», «что пишут про …» — и то, чем она
 * занята, когда сама не знает ответа (слово владельца 15.11.2026: знание должно
 * соответствовать слову «интеллект»).
 *
 * Чем ищет, по порядку:
 *   1. Tavily — если в файле ключей есть `KEY_TAVILY`: бесплатный запас у него
 *      возвращается каждый месяц, поэтому он первый;
 *   2. Exa — `KEY_EXA`: его бесплатный запас тоже возвращается каждый месяц;
 *   3. You — `KEY_YOU`: запас выдаётся один раз, поэтому он последний из трёх —
 *      на случай, когда первые двое не ответили или ничего не нашли;
 *   4. Википедия — без ключа, всегда: до трёх статей, у первой вступление целиком.
 * Ключи этих трёх владелец получил сам (16.11.2026); Brave убран — ключа к нему нет.
 * Поисковиков без ключа здесь нет намеренно: DuckDuckGo и Bing ботам не отвечают
 * или прямо запрещают такое использование (проверено 15.11.2026).
 *
 * Найденное — справка для модели, а не ответ: отвечает она сама, источники
 * называет код.
 */
const fold = (text) => String(text ?? "").toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();

const WHERE = "(?:в\\s+(?:интернете|инете|сети|гугле|поисковике|яндексе)|по\\s+интернету)";
const HEAD = new RegExp(`^(?:(?:найди|поищи|посмотри|глянь|узнай|проверь|погляди)(?:те)?\\s+(?:мне\\s+|пожалуйста\\s+)?${WHERE}\\s*[:,—-]?\\s*|(?:за|по|на)гугли(?:те)?\\s*[:,—-]?\\s+|гугл\\s*[:—-]\\s*|(?:найди|поищи)(?:те)?\\s+(?:мне\\s+)?(?:информацию|инфу|сведения|данные)\\s+(?:о|об|про|по|насчет)\\s+|что\\s+(?:пишут|говорят|известно|слышно)\\s+(?:${WHERE}\\s+)?(?:о|об|про|насчет)\\s+)(.{2,200})$`, "u");
const TAIL = new RegExp(`^(?:найди|поищи|посмотри|глянь|узнай)(?:те)?\\s+(?:мне\\s+)?(.{2,200}?)\\s+${WHERE}$`, "u");
/** О себе и о собеседнике в сети искать нечего: это разговор. */
const PERSONAL = /(?:^|\s)(?:я|ты|мы|мне|меня|мной|тебе|тебя|тобой|нас|нам|мой|моя|мое|мои|моего|моей|твой|твоя|твое|твои|твоего|твоей|наш|наша|наше|наши|себя|себе)(?=\s|$)/u;

/** «Найди в интернете …» → { query }, иначе null. Запрос — как написал человек. */
export function parseSearch(text) {
  const raw = String(text ?? "").replace(/\s+/gu, " ").trim().replace(/[?!.…]+$/u, "").trim();
  if (!raw || raw.length > 260) return null;
  const low = fold(raw);
  const found = low.match(HEAD) ?? low.match(TAIL);
  if (!found) return null;
  const at = low.indexOf(found[1]);
  const query = (at >= 0 ? raw.slice(at, at + found[1].length) : found[1]).replace(/^[«"“„'`:\s]+|[»"”'`\s]+$/gu, "").trim();
  if (query.length < 2 || PERSONAL.test(fold(query))) return null;
  return { query };
}

const QUESTION = /^(?:а\s+|ну\s+|и\s+|скажи\s+|подскажи\s+|слушай\s+)*(?:кто|что|где|куда|откуда|когда|почему|зачем|отчего|как|сколько|какой|какая|какое|какие|каков[аоы]?|чей|чья|чье|чьи|правда\s+ли|верно\s+ли|в\s+каком|на\s+каком|из\s+чего|с\s+какого|до\s+какого)(?=\s)/u;
/** Стоит ли искать самой: вопрос о мире, а не о собеседнике и не о ней. */
export function worthSearch(text) {
  const value = fold(text).replace(/[?!.…]+$/u, "").trim();
  if (value.length < 12 || value.length > 200) return false;
  if (PERSONAL.test(value) || /(?:^|\s)(?:у\s+тебя|для\s+тебя|по-твоему|как\s+думаешь|как\s+считаешь|на\s+твой\s+взгляд)(?=\s|$)/u.test(value)) return false;
  return QUESTION.test(value) || /\?\s*$/u.test(String(text ?? "").trim());
}

const hostOf = (url) => String(url ?? "").replace(/^https?:\/\/(?:www\.)?/u, "").split(/[/?#]/u)[0];
const squash = (text, limit) => String(text ?? "").replace(/\s+/gu, " ").trim().slice(0, limit);

export function createSearch({ fetchImpl = null, keys = {}, sources = null, timeoutMs = 9000 } = {}) {
  const key = (name) => String(keys?.[name] ?? "").trim();
  const signal = () => { try { return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined; } catch { return undefined; } };
  const doFetch = () => fetchImpl ?? globalThis.fetch;

  /** Один запрос к поисковику с ключом: разобранный JSON или null. Никогда не бросает. */
  async function ask(url, options) {
    const run = doFetch();
    if (typeof run !== "function") return null;
    try {
      const timer = signal();
      const response = await run(url, { ...options, ...(timer ? { signal: timer } : {}) });
      const status = Number(response?.status) || 0;
      if (!(response?.ok === true || (typeof response?.ok !== "boolean" && status >= 200 && status < 300))) return null;
      return await response.json();
    } catch { return null; }
  }
  const shaped = (rows, pick) => (Array.isArray(rows) ? rows : []).map(pick).filter(item => item.url && item.text).slice(0, 4)
    .map(item => ({ title: squash(item.title, 120) || hostOf(item.url), url: String(item.url), text: squash(item.text, 900) }));

  async function tavily(query) {
    const data = await ask("https://api.tavily.com/search", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key("tavily")}` },
      body: JSON.stringify({ query, max_results: 4, search_depth: "basic" }),
    });
    return shaped(data?.results, item => ({ title: item?.title, url: item?.url, text: item?.content }));
  }
  /** Exa: «выдержки» — куски страницы, которые отвечают на запрос (формы — по документации 16.11.2026). */
  async function exa(query) {
    const data = await ask("https://api.exa.ai/search", {
      method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key("exa") },
      body: JSON.stringify({ query, type: "auto", numResults: 4, contents: { highlights: true } }),
    });
    return shaped(data?.results, item => ({
      title: item?.title, url: item?.url,
      text: Array.isArray(item?.highlights) && item.highlights.length ? item.highlights.join(" … ") : (item?.summary || item?.text),
    }));
  }
  /** You: обычный поиск с короткими выдержками; язык выдачи — русский. */
  async function you(query) {
    const data = await ask("https://ydc-index.io/v1/search", {
      method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": key("you") },
      body: JSON.stringify({ query, count: 4, language: "RU" }),
    });
    return shaped(data?.results?.web, item => ({
      title: item?.title, url: item?.url,
      text: Array.isArray(item?.snippets) && item.snippets.length ? item.snippets.join(" … ") : item?.description,
    }));
  }
  /** Поисковики с ключом — в том порядке, в каком их спрашивают. */
  const ENGINES = [["tavily", "Tavily", tavily], ["exa", "Exa", exa], ["you", "You", you]];

  /** Чем она сейчас может искать — словами, для статуса. */
  const providers = () => [...ENGINES.filter(([id]) => key(id)).map(([, title]) => title), sources?.available?.() !== false && typeof sources?.lookup === "function" ? "Википедия" : ""].filter(Boolean);

  /** Есть ли ключ настоящего поисковика: такие запросы считаны, Википедия — нет. */
  const keyed = () => ENGINES.some(([id]) => Boolean(key(id)));

  /**
   * Найти: `{ ok, via, results: [{ title, url, text }] }`. Отказы: network — никто
   * не ответил; not_found — ответили, но пусто; off — искать нечем.
   * `paid: false` — поисковики с ключом не трогать (дневной запас вышел).
   */
  async function find(query, { paid = true } = {}) {
    const words = squash(query, 200);
    if (!words) return { ok: false, code: "not_found" };
    if (!providers().length) return { ok: false, code: "off" };
    if (paid) {
      for (const [id, title, engine] of ENGINES) {
        if (!key(id)) continue;
        const results = await engine(words);
        if (results.length) return { ok: true, via: title, results };
      }
    }
    if (typeof sources?.lookup !== "function") return { ok: false, code: "not_found" };
    const wiki = await sources.lookup(words).catch(() => ({ ok: false, code: "network" }));
    return wiki.ok ? { ok: true, via: "Википедия", results: wiki.results.slice(0, 3) } : { ok: false, code: wiki.code === "network" ? "network" : "not_found" };
  }

  return Object.freeze({ find, providers, keyed });
}

/** Найденное → справка для модели и источники для человека. */
export function referenceOf(query, found) {
  const results = Array.isArray(found?.results) ? found.results : [];
  let left = 3000;
  const parts = [];
  for (const [index, item] of results.entries()) {
    // Обрывок в пару десятков знаков справкой не считается: бюджет кончился.
    if (left < 60) break;
    const part = `[${index + 1}] ${item.title}: ${item.text}`.slice(0, left);
    parts.push(part);
    left -= part.length + 1;
  }
  return {
    kind: "search", via: String(found?.via ?? ""), title: squash(query, 160), text: parts.join("\n"),
    sources: results.slice(0, parts.length || 1).slice(0, 3).map(item => ({ title: item.title, url: item.url, host: hostOf(item.url) })),
  };
}
