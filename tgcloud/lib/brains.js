/**
 * Мозги: какими моделями сердце может думать прямо сейчас.
 *
 * Раньше модель была одна. Провайдер отвечал «лимит исчерпан» — и сердце
 * пересказывало это человеку, пока лимит не обновится. Но лимиты считаются по
 * каждой модели отдельно, а провайдеров с совместимым API несколько. Поэтому
 * здесь не «модель», а цепочка: основная, запасные на том же ключе, затем
 * другие провайдеры. Упёрлась в одну — думает следующей и помнит, когда
 * первая отдохнёт.
 *
 * Состояние лежит в базе, а не в памяти изолята: «эта модель отдыхает до
 * 14:20» должно пережить перезапуск, иначе каждое сообщение заново стучится
 * в закрытую дверь и тратит запрос.
 */

export const BRAINS_KEY = "heart:brains:v1";
const DAY = 86_400_000;
/** Отдых по умолчанию, когда провайдер не сказал, сколько ждать. */
export const DEFAULT_REST_MS = 60_000;
/** Сколько моделей сердце готово добавить в цепочку само, по списку провайдера. */
const MAX_EXTRAS = 4;
/** Похоже на разговорную модель… */
const CHAT_LIKE = /(?:gpt-oss|llama|qwen|kimi|gemma|mistral|deepseek)/iu;
/** …и точно не она: охранные, голосовые, служебные. */
const NOT_CHAT = /(?:guard|whisper|tts|embed|vision|audio|speech|safeguard|compound|allam|orpheus|playai|distil)/iu;

/**
 * «2m59.56s», «7.66s», «450ms», «1h2m», «120» (секунды) → миллисекунды.
 * Провайдеры пишут время сброса лимита по-разному; непонятное — это null.
 */
export function parseDuration(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/u.test(text)) return Math.round(Number(text) * 1000);
  let total = 0;
  let matched = false;
  for (const [, amount, unit] of text.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/gu)) {
    matched = true;
    total += Number(amount) * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000 })[unit];
  }
  return matched ? Math.round(total) : null;
}

/** Что провайдер сказал о лимитах в заголовках ответа. Нет заголовков — нет чисел. */
export function readLimits(headers) {
  const get = typeof headers?.get === "function" ? (name) => { try { return headers.get(name); } catch { return null; } } : () => null;
  const number = (name) => { const raw = get(name); const value = raw == null || raw === "" ? Number.NaN : Number(raw); return Number.isFinite(value) ? value : null; };
  return {
    retryAfterMs: parseDuration(get("retry-after")),
    remainingRequests: number("x-ratelimit-remaining-requests"),
    remainingTokens: number("x-ratelimit-remaining-tokens"),
    limitRequests: number("x-ratelimit-limit-requests"),
    limitTokens: number("x-ratelimit-limit-tokens"),
    resetRequestsMs: parseDuration(get("x-ratelimit-reset-requests")),
    resetTokensMs: parseDuration(get("x-ratelimit-reset-tokens")),
  };
}

const unique = (items) => [...new Set(items.map(item => String(item ?? "").trim()).filter(Boolean))];

export function createBrains({
  store = null, now = () => Date.now(),
  primary = "", fallbacks = [], baseUrl = "",
  /** Другие провайдеры: [{ id, baseUrl, models: [], key }] — ключ уже подставлен. */
  providers = [],
} = {}) {
  let cache = null;
  let cacheAt = 0;
  const memory = { models: {}, extras: { at: 0, ids: [] } };

  async function read() {
    if (cache && now() - cacheAt < 30_000) return cache;
    let saved = null;
    try { saved = store && typeof store.get === "function" ? await store.get(BRAINS_KEY) : null; } catch { saved = null; }
    const value = saved && typeof saved === "object" ? saved : memory;
    cache = {
      models: value.models && typeof value.models === "object" ? value.models : {},
      extras: { at: Number(value.extras?.at) || 0, ids: Array.isArray(value.extras?.ids) ? value.extras.ids : [] },
    };
    cacheAt = now();
    return cache;
  }

  async function write(state) {
    cache = state;
    cacheAt = now();
    memory.models = state.models;
    memory.extras = state.extras;
    try { if (store && typeof store.set === "function") await store.set(BRAINS_KEY, state); } catch { /* останется в памяти изолята */ }
  }

  /**
   * Вся цепочка по порядку: основная модель, запасные, найденные самой, затем
   * другие провайдеры. `apiKey` — ключ основного провайдера на этот запрос.
   */
  async function all({ apiKey = "", model = "" } = {}) {
    const state = await read();
    const main = unique([model || primary, ...fallbacks, ...state.extras.ids]);
    const list = apiKey ? main.map(name => ({ id: `main:${name}`, provider: "main", model: name, baseUrl, key: apiKey })) : [];
    for (const provider of providers) {
      const key = String(provider?.key ?? "").trim();
      const url = String(provider?.baseUrl ?? "").trim().replace(/\/+$/u, "");
      if (!key || !url || !provider?.id) continue;
      for (const name of unique(provider.models ?? [])) list.push({ id: `${provider.id}:${name}`, provider: String(provider.id), model: name, baseUrl: url, key });
    }
    return list.map(item => ({ ...item, plain: state.models[item.id]?.plain === true }));
  }

  /** Те, кто не отдыхает. Пустой список — думать сейчас нечем. */
  async function available(options = {}) {
    const state = await read();
    return (await all(options)).filter(item => !(Number(state.models[item.id]?.until) > now()));
  }

  async function patch(id, change) {
    const state = await read();
    const next = { ...state, models: { ...state.models, [id]: { ...(state.models[id] ?? {}), ...change, at: now() } } };
    await write(next);
  }

  /** Модель упёрлась в лимит или упала: отдыхает `ms`, не больше суток. */
  const rest = (id, { ms = DEFAULT_REST_MS, why = "limit" } = {}) =>
    patch(id, { until: now() + Math.max(1000, Math.min(DAY, Number(ms) || DEFAULT_REST_MS)), why });

  /** Модели больше нет у провайдера: сутки не трогаем, потом проверим снова. */
  const retire = (id, { why = "gone" } = {}) => patch(id, { until: now() + DAY, why });

  /** Модель не принимает дополнительные параметры: впредь спрашиваем проще. */
  const simplify = (id) => patch(id, { plain: true });

  /**
   * Запомнить остаток лимита. Пишется, только когда остаток заметно изменился:
   * запись на каждый ответ — лишняя операция с базой.
   */
  async function note(id, limits = {}) {
    if (limits.remainingRequests == null && limits.remainingTokens == null) return;
    const state = await read();
    const before = state.models[id] ?? {};
    const drift = (a, b) => a == null || b == null ? a !== b : Math.abs(a - b) >= Math.max(5, Math.abs(b) * 0.1);
    if (!drift(limits.remainingRequests, before.remainReq ?? null) && !drift(limits.remainingTokens, before.remainTok ?? null) && !(Number(before.until) > 0)) return;
    await patch(id, {
      remainReq: limits.remainingRequests, limitReq: limits.limitRequests,
      remainTok: limits.remainingTokens, limitTok: limits.limitTokens,
      until: 0, why: "",
    });
  }

  /**
   * Спросить у основного провайдера, какие модели есть на самом деле, и
   * добавить в цепочку разговорные. Не чаще раза в сутки: это запасной выход,
   * когда знакомые модели кончились или сняты.
   */
  async function discover({ fetchImpl = null, apiKey = "", signal = undefined } = {}) {
    const state = await read();
    if (!apiKey || typeof fetchImpl !== "function" || !baseUrl) return { ok: false, code: "unavailable", added: [] };
    if (now() - state.extras.at < DAY) return { ok: true, code: "fresh", added: [] };
    let ids = [];
    try {
      const options = { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } };
      if (signal !== undefined) options.signal = signal;
      const response = await fetchImpl(`${baseUrl}/models`, options);
      const data = response?.ok === false ? null : await response.json();
      ids = Array.isArray(data?.data) ? data.data.filter(item => item && item.active !== false).map(item => String(item.id ?? "")) : [];
    } catch { ids = []; }
    const known = new Set(unique([primary, ...fallbacks]));
    const added = unique(ids).filter(id => !known.has(id) && CHAT_LIKE.test(id) && !NOT_CHAT.test(id)).slice(0, MAX_EXTRAS);
    // Пустой ответ тоже запоминается: иначе каждый отказ стоил бы ещё запроса.
    await write({ ...state, extras: { at: now(), ids: added } });
    return { ok: true, code: "listed", added };
  }

  /** Цепочка для владельца: кто думает, кто отдыхает и до какого часа. */
  async function describe(options = {}) {
    const state = await read();
    return (await all(options)).map(item => {
      const row = state.models[item.id] ?? {};
      const resting = Number(row.until) > now();
      return {
        id: item.id, model: item.model, provider: item.provider,
        ok: !resting, until: resting ? Number(row.until) : 0, why: resting ? String(row.why ?? "") : "",
        remainingRequests: row.remainReq ?? null, remainingTokens: row.remainTok ?? null,
      };
    });
  }

  /** Когда ближайшая модель вернётся: чтобы сказать человеку правду о сроке. */
  async function nextAt(options = {}) {
    const state = await read();
    const times = (await all(options)).map(item => Number(state.models[item.id]?.until) || 0).filter(until => until > now());
    return times.length ? Math.min(...times) : 0;
  }

  /**
   * Почему думать нечем: лимит или поломка. Это разные вести — «лимит вышел,
   * вернётся сам» и «нет связи» — и путать их нельзя.
   */
  async function whyResting(options = {}) {
    const list = (await describe(options)).filter(item => !item.ok);
    if (!list.length) return "";
    return list.every(item => item.why === "limit") ? "limit" : list.some(item => item.why === "limit") ? "mixed" : "fault";
  }

  return Object.freeze({ all, available, rest, retire, simplify, note, discover, describe, nextAt, whyResting });
}
