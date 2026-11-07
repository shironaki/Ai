/**
 * Events: the heart speaking without being asked.
 *
 * The point of two bots is not only "say something and the other one does it".
 * It is also the reverse: something *happened* — someone joined, a game ended,
 * a reminder came due — and the heart reacts on its own, because the sister
 * told her. That is what "выполнять команды без ввода" means in practice.
 *
 * Rules that keep this from becoming noise:
 *   - only signed envelopes from the connected channel are accepted;
 *   - only an allowlist of kinds is reacted to, so a new kind in the other
 *     repository cannot start a monologue here;
 *   - one reaction per kind per chat per cooldown, and a hard daily cap;
 *   - the wording is fixed, not generated: a greeting must not cost a request
 *     and must not invent facts about a person the heart has never met.
 */

export const EVENT_TOOL = "__event";

/** Kinds the heart is willing to answer. Anything else is ignored silently. */
export const KINDS = Object.freeze(["member_joined", "game_finished", "reminder", "level_up"]);

export const COOLDOWN_MS = 10 * 60_000;
export const MAX_PER_DAY = 8;

/** Deterministic but not identical wording: the id picks the phrase. */
const TEMPLATES = Object.freeze({
  member_joined: [
    "{name} появился. Добро пожаловать.",
    "Смотрю, у нас {name}. Здравствуй.",
    "{name} здесь. Устраивайся.",
  ],
  game_finished: [
    "{name} закончил партию. {detail}",
    "Партия закрыта: {name}. {detail}",
  ],
  reminder: ["{detail}", "{detail} — напоминаю."],
  level_up: [
    "{name} поднялся. {detail}",
    "{name}, с уровнем. {detail}",
  ],
});

function fill(template, { name = "", detail = "" } = {}) {
  return template
    .replace(/\{name\}/g, String(name || "кто-то"))
    .replace(/\{detail\}/g, String(detail || ""))
    .replace(/\s+([.!?,])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function composeEvent({ kind, id = "", name = "", detail = "" } = {}) {
  const variants = TEMPLATES[kind];
  if (!variants) return "";
  // A stable pick: the same event never changes its wording on a retry.
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return fill(variants[hash % variants.length], { name, detail });
}

export function createEvents({ abilities = null, store = null, now = () => Date.now(), send = null, cooldownMs = COOLDOWN_MS, maxPerDay = MAX_PER_DAY } = {}) {
  const seen = new Map();
  const memory = new Map();

  async function read(key) {
    if (store && store.available) {
      const value = await store.get(key);
      if (value != null) return value;
    }
    return memory.get(key) ?? null;
  }

  async function write(key, value) {
    memory.set(key, value);
    if (store && store.available) await store.set(key, value);
  }

  /** One id, one reaction — a duplicated post must not speak twice. */
  function firstTime(id) {
    const stamp = now();
    if (seen.has(id)) return false;
    if (seen.size > 256) for (const [key, at] of seen) if (stamp - at > 24 * 3600_000) seen.delete(key);
    seen.set(id, stamp);
    return true;
  }

  const day = () => new Date(now()).toISOString().slice(0, 10);

  async function allowed(chatId, kind) {
    const key = `heart:event:last:${chatId}:${kind}`;
    const last = Number(await read(key)) || 0;
    if (now() - last < cooldownMs) return false;
    const countKey = `heart:event:count:${chatId}:${day()}`;
    const count = Number(await read(countKey)) || 0;
    return count < maxPerDay;
  }

  async function remember(chatId, kind) {
    await write(`heart:event:last:${chatId}:${kind}`, now());
    const countKey = `heart:event:count:${chatId}:${day()}`;
    await write(countKey, (Number(await read(countKey)) || 0) + 1);
  }

  /**
   * A channel post. Returns true when it was an event and was handled here —
   * the same post is never also treated as a bridge answer or a conversation.
   */
  async function onPost(text) {
    if (!abilities || typeof abilities.open !== "function" || !abilities.open()) return false;
    const envelope = abilities.decode?.(text) ?? null;
    if (!envelope || envelope.tool !== EVENT_TOOL || !envelope.sig) return false;

    const verified = await abilities.verify(envelope);
    if (!verified?.ok) return false;
    if (!firstTime(String(envelope.id))) return true; // handled, deliberately silent

    const kind = String(envelope.args?.kind ?? "");
    if (!KINDS.includes(kind)) return true;
    const chatId = envelope.args?.chatId ?? envelope.chat;
    if (chatId == null) return true;
    if (!await allowed(chatId, kind)) return true;

    const line = composeEvent({ kind, id: envelope.id, name: envelope.args?.name, detail: envelope.args?.detail });
    if (!line) return true;
    await remember(chatId, kind);
    if (typeof send === "function") await send(chatId, line);
    return true;
  }

  return Object.freeze({ onPost, composeEvent, KINDS, cooldownMs, maxPerDay });
}
