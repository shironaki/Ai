import { createBridge } from "./bridge.js";

/**
 * The abilities port: how the heart asks another bot to do something.
 *
 * The heart decides *what* is worth doing; the abilities bot (moderation, games,
 * quests, profiles) decides *whether* it may be done, in that chat, for that
 * person. The heart never gets to overrule that, and it never learns the other
 * bot's rights.
 *
 * Wire: one line in a private channel both bots administer.
 *   request  AI-BRIDGE1 {"v":1,"id":"…","tool":"profile",…,"sig":"…"}
 *   answer   AI-BRIDGE1 {"v":1,"id":"…","ok":true,"code":"ok","text":"…","sig":"…"}
 *
 * Without a channel and a secret the port is closed, and the heart answers
 * alone — degraded, not broken.
 */
export const BUS_PREFIX = "AI-BRIDGE1 ";
const CATALOG_TOOL = "__catalog";
const CONTEXT_TOOL = "__context";

export function encodeEnvelope(value) {
  return BUS_PREFIX + JSON.stringify(value);
}

export function decodeEnvelope(text) {
  const raw = String(text ?? "");
  if (!raw.startsWith(BUS_PREFIX)) return null;
  try {
    const value = JSON.parse(raw.slice(BUS_PREFIX.length));
    return value && typeof value === "object" ? value : null;
  } catch { return null; }
}

export function createAbilities({ secret = "", channelId = "", api = null, send = null, now = () => Date.now(), ttl = 60_000 } = {}) {
  const bridge = createBridge({ secret, capabilities: { call: async () => ({ ok: false }) }, now });
  const open = () => bridge.enabled && String(channelId ?? "") !== "" && String(channelId) !== "0";
  const pending = new Map();
  /** `chatType:actor` → { at, tools }. Bounded below. */
  const catalogCache = new Map();
  const contextCache = new Map();

  async function post(line) {
    if (typeof send === "function") return send(line);
    if (!api || typeof api.sendMessage !== "function") throw Error("bridge_not_connected");
    return api.sendMessage({ chat_id: channelId, text: line, disable_web_page_preview: true });
  }

  /** Seal one call, post it, and wait for the signed answer. */
  async function call(tool, { actor = null, chat = null, chatType = null, args = {}, timeout = 20_000 } = {}) {
    if (!open()) return { ok: false, code: "bridge_not_configured", text: "" };
    const sealed = await bridge.seal({ tool, args, actor, chat, chatType, ttl });
    if (!sealed.ok) return { ok: false, code: sealed.code, text: "" };

    const answer = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(sealed.envelope.id); reject(Object.assign(Error("bridge_timeout"), { code: "bridge_timeout" })); }, timeout);
      pending.set(sealed.envelope.id, { resolve: (value) => { clearTimeout(timer); resolve(value); } });
    });

    try { await post(encodeEnvelope(sealed.envelope)); }
    catch { pending.delete(sealed.envelope.id); return { ok: false, code: "bridge_send_failed", text: "" }; }

    try { return await answer; }
    catch (error) { return { ok: false, code: error.code ?? "bridge_timeout", text: "" }; }
  }

  /** Feed a channel post. Returns true when it was the answer we waited for. */
  async function onPost(text) {
    const envelope = decodeEnvelope(text);
    if (!envelope?.sig) return false;
    const verified = await bridge.verifyResult(envelope);
    const waiter = pending.get(String(envelope.id));
    if (!verified.ok || !waiter) return false;
    pending.delete(String(envelope.id));
    waiter.resolve({ ...verified.result, data: verified.result.data });
    return true;
  }

  /**
   * What the other bot says it can do, scoped to this role. Cached.
   *
   * `ok` is the important half: a refused or unanswered catalogue used to come
   * back as an empty list, and the heart then told the person "этого нет в этом
   * чате". That is a guess dressed as a fact. Now silence is named as silence.
   */
  async function catalogue({ actor = null, chat = null, chatType = null, ttlMs = 600_000 } = {}) {
    if (!open()) return { ok: false, code: "bridge_closed", tools: [] };
    // Кэш по паре «тип чата + человек»: список зависит и от места, и от роли.
    // Общий кэш показывал игроку умения владельца, а владельцу — только личные.
    const key = `${chatType ?? "any"}:${actor ?? "any"}`;
    const cached = catalogCache.get(key);
    if (cached && now() - cached.at < ttlMs && cached.tools.length) return { ok: true, code: "ok", tools: cached.tools };
    const result = await call(CATALOG_TOOL, { actor, chat, chatType, timeout: 15_000 });
    if (result.ok && Array.isArray(result.data)) {
      const tools = result.data.filter(tool => tool && tool.name);
      catalogCache.set(key, { at: now(), tools });
      if (catalogCache.size > 64) for (const [k, item] of catalogCache) if (now() - item.at > ttlMs) catalogCache.delete(k);
      return { ok: true, code: "ok", tools };
    }
    return { ok: false, code: result.code ?? "bridge_no_answer", tools: cached?.tools ?? [] };
  }

  /** The list alone, for callers that only need it. */
  async function catalog(options = {}) {
    return (await catalogue(options)).tools;
  }

  /**
   * Что сестра знает о человеке: роль, VIP, варны. Кэш короткий — минута.
   * Права меняются: снятый админ не должен ещё десять минут разговаривать с
   * сердцем как админ. Минуты хватает, чтобы серия сообщений не гоняла запрос
   * по каналу на каждое слово.
   */
  async function context({ actor = null, chat = null, chatType = null, ttlMs = 60_000 } = {}) {
    if (!open()) return null;
    const cacheKey = `${chatType ?? "any"}:${chat}:${actor}`;
    const cached = contextCache.get(cacheKey);
    if (cached && now() - cached.at < ttlMs) return cached.value;
    const result = await call(CONTEXT_TOOL, { actor, chat, chatType, timeout: 12_000 });
    if (!result.ok) return null;
    const value = result.data && typeof result.data === "object" ? result.data : {};
    contextCache.set(cacheKey, { at: now(), value });
    if (contextCache.size > 128) for (const [key, item] of contextCache) if (now() - item.at > ttlMs) contextCache.delete(key);
    return value;
  }

  /** Verification of an incoming envelope, for anything else that listens. */
  async function verify(envelope) {
    try { return await bridge.verify(envelope); }
    catch { return { ok: false, code: "crypto_unavailable" }; }
  }

  return Object.freeze({ open, call, onPost, catalog, catalogue, context, verify, decode: decodeEnvelope, bridge });
}

/**
 * Phrase → tool. Deliberately short and literal: the model words an answer, it
 * never chooses an action. If the abilities bot has not announced the tool, the
 * heart says the feature is not connected instead of pretending.
 */
export const PHRASES = Object.freeze([
  // Одно слово — тоже просьба. «Профиль», набранный без «покажи», раньше
  // уходил к модели, и та придумывала роль и данные; это дороже молчания.
  { tool: "profile", test: /^(?:(?:покажи|открой|мой|посмотреть)\s+)?профил[ья]?$/iu },
  { tool: "info", test: /^(?:(?:покажи|что)\s+)?(?:об|про)\s+(?:этом|нём|нем|участнике)/iu },
  { tool: "quests", test: /^(?:(?:покажи|мои)\s+)?(?:квесты|задания)$/iu },
  { tool: "play", test: /^(?:(?:давай\s+)?(?:поиграем|игры|во что поиграть))$/iu },
  { tool: "warns", test: /^(?:(?:мои|покажи)\s+)?(?:варны|предупреждения)$/iu },
  { tool: "report", test: /^(?:пожаловаться|жалоба|обращение)$/iu },
]);

/**
 * Живая речь не совпадает с образцом буква в букву: «покажи мне профиль» и
 * «мой профиль» — та же просьба, что «покажи профиль». Раньше они уходили к
 * модели, а модель на вопрос о профиле придумывала роль, ID и уровень. Одно
 * лишнее слово не должно превращать факт в выдумку.
 */
const FILLER = /(?:^|\s)(?:пожалуйста|плиз|мне|мой|мою|моя|мои|моё|мое)(?=\s|$)/giu;

export function matchPhrase(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  for (const phrase of PHRASES) if (phrase.test.test(raw)) return phrase.tool;
  // Запятые и точки — тоже шум: «покажи, пожалуйста, профиль».
  const value = raw.replace(/[,.!?;:]/gu, " ").replace(FILLER, " ").replace(/\s+/gu, " ").trim();
  if (!value) return null;
  for (const phrase of PHRASES) if (phrase.test.test(value)) return phrase.tool;
  return null;
}
