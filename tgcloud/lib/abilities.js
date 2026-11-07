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
  const catalogCache = { at: 0, tools: [] };

  async function post(line) {
    if (typeof send === "function") return send(line);
    if (!api || typeof api.sendMessage !== "function") throw Error("bridge_not_connected");
    return api.sendMessage({ chat_id: channelId, text: line, disable_web_page_preview: true });
  }

  /** Seal one call, post it, and wait for the signed answer. */
  async function call(tool, { actor = null, chat = null, args = {}, timeout = 20_000 } = {}) {
    if (!open()) return { ok: false, code: "bridge_not_configured", text: "" };
    const sealed = await bridge.seal({ tool, args, actor, chat, ttl });
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

  /** What the other bot says it can do, scoped to this role. Cached. */
  async function catalog({ actor = null, chat = null, ttlMs = 600_000 } = {}) {
    if (!open()) return [];
    if (now() - catalogCache.at < ttlMs && catalogCache.tools.length) return catalogCache.tools;
    const result = await call(CATALOG_TOOL, { actor, chat, timeout: 15_000 });
    if (result.ok && Array.isArray(result.data)) {
      catalogCache.tools = result.data.filter(tool => tool && tool.name);
      catalogCache.at = now();
    }
    return catalogCache.tools;
  }

  /** Verification of an incoming envelope, for anything else that listens. */
  async function verify(envelope) {
    try { return await bridge.verify(envelope); }
    catch { return { ok: false, code: "crypto_unavailable" }; }
  }

  return Object.freeze({ open, call, onPost, catalog, verify, decode: decodeEnvelope, bridge });
}

/**
 * Phrase → tool. Deliberately short and literal: the model words an answer, it
 * never chooses an action. If the abilities bot has not announced the tool, the
 * heart says the feature is not connected instead of pretending.
 */
export const PHRASES = Object.freeze([
  { tool: "profile", test: /^(?:покажи|открой|мой)\s+профил[ья]?$/iu },
  { tool: "info", test: /^(?:покажи|что)\s+(?:об|про)\s+(?:этом|нём|нем|участнике)/iu },
  { tool: "quests", test: /^(?:покажи\s+)?(?:квесты|задания|мои задания)$/iu },
  { tool: "play", test: /^(?:давай\s+)?(?:поиграем|игры|во что поиграть)$/iu },
  { tool: "warns", test: /^(?:мои\s+)?(?:варны|предупреждения)$/iu },
  { tool: "report", test: /^(?:пожаловаться|жалоба|обращение)$/iu },
]);

export function matchPhrase(text) {
  const value = String(text ?? "").trim();
  if (!value) return null;
  for (const phrase of PHRASES) if (phrase.test.test(value)) return phrase.tool;
  return null;
}
