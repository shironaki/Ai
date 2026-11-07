/**
 * The bridge between two bots.
 *
 * The heart of Ai lives in another repository; this bot holds the abilities.
 * The heart may ask for one tool call — and only one: no database, no token, no
 * assumption that a request is legitimate because it arrived.
 *
 * What makes a request trustworthy here, in order:
 *   1. HMAC-SHA256 over a canonical form of the envelope, shared secret only;
 *   2. a fresh `ts` and `ttl` — a replay after the window is refused;
 *   3. a one-time `id` — the same call never runs twice, even inside the window;
 *   4. the allowlist — the heart may call only what this bot announced;
 *   5. the actor must be the person whose update is being handled, so the heart
 *      can never act on somebody else's behalf.
 *
 * The module does not choose a secret and does not read one from a chat: it is
 * constructed with it, and stays inert until a secret exists.
 */
export const BRIDGE_VERSION = 1;
export const BRIDGE_TTL_MS = 60_000;
// One-time ids stay long enough that a late duplicate cannot slip in after the
// short validity window has closed.
const SEEN_PREFIX = "bridge:seen:";
export const SEEN_KEEP_MS = 24 * 3600_000;

/** Stable JSON: sorted keys, no undefined entries, no whitespace. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const body = Object.keys(value).sort()
      .filter(key => value[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`);
    return `{${body.join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function bridgePayload(envelope = {}) {
  const { sig, ...rest } = envelope;
  return canonical({ ...rest, v: BRIDGE_VERSION });
}

function subtle() {
  const crypto = globalThis.crypto;
  return crypto && crypto.subtle && typeof crypto.subtle.importKey === "function" ? crypto.subtle : null;
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  const value = String(hex ?? "").trim().toLowerCase();
  if (!/^(?:[0-9a-f]{2})+$/.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index++) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/** Constant-time comparison: a MAC must not leak how much of it matched. */
export function sameBytes(a, b) {
  const left = fromHex(a), right = fromHex(b);
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) diff |= left[index] ^ right[index];
  return diff === 0;
}

export async function hmac(secret, payload) {
  const engine = subtle();
  if (!engine) throw Error("crypto_unavailable");
  const key = await engine.importKey("raw", new TextEncoder().encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await engine.sign("HMAC", key, new TextEncoder().encode(payload));
  return toHex(signature);
}

export function createBridge({ secret = "", store = null, capabilities, now = () => Date.now(), ttl = BRIDGE_TTL_MS, allowed = null } = {}) {
  if (!capabilities || typeof capabilities.call !== "function") throw new TypeError("createBridge needs capabilities");
  const enabled = String(secret ?? "").length >= 16;
  const permit = Array.isArray(allowed) ? new Set(allowed) : null;

  /** Seal a call. The heart signs; this bot verifies the same bytes. */
  async function seal({ tool, args = {}, actor, chat, ttl: lifetime = ttl } = {}) {
    if (!enabled) return { ok: false, code: "bridge_not_configured", text: "Мост не настроен: нет общего секрета." };
    const envelope = {
      v: BRIDGE_VERSION,
      id: `${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      ts: now(),
      ttl: Math.max(1000, Math.min(600_000, Number(lifetime) || ttl)),
      tool: String(tool ?? ""),
      args,
      actor: actor == null ? null : String(actor),
      chat: chat == null ? null : String(chat),
    };
    try { return { ok: true, envelope: { ...envelope, sig: await hmac(secret, bridgePayload(envelope)) } }; }
    catch { return { ok: false, code: "crypto_unavailable", text: "Подпись недоступна: платформа не даёт WebCrypto." }; }
  }

  async function verify(envelope) {
    if (!enabled) return { ok: false, code: "bridge_not_configured" };
    if (!envelope || typeof envelope !== "object") return { ok: false, code: "bad_envelope" };
    if (Number(envelope.v) !== BRIDGE_VERSION) return { ok: false, code: "bad_version" };
    if (!envelope.id || !envelope.sig || !envelope.tool) return { ok: false, code: "bad_envelope" };
    let expected;
    try { expected = await hmac(secret, bridgePayload(envelope)); }
    catch { return { ok: false, code: "crypto_unavailable" }; }
    if (!sameBytes(expected, envelope.sig)) return { ok: false, code: "bad_signature" };
    const age = now() - Number(envelope.ts);
    if (!Number.isFinite(age) || Math.abs(age) > Number(envelope.ttl ?? ttl)) return { ok: false, code: "expired" };
    return { ok: true };
  }

  /**
   * Handle one signed call. `expect` is what the Telegram update says: the same
   * actor and the same chat. A bridge call can never widen those.
   */
  async function handle(envelope, { expect = {}, context = {} } = {}) {
    const checked = await verify(envelope);
    if (!checked.ok) return { ok: false, code: checked.code, text: "Запрос отклонён: подпись, срок или формат не сошлись." };

    if (envelope.actor != null && expect.actorId != null && String(envelope.actor) !== String(expect.actorId)) {
      return { ok: false, code: "actor_mismatch", text: "Запрос отклонён: другой автор." };
    }
    if (envelope.chat != null && expect.chatId != null && String(envelope.chat) !== String(expect.chatId)) {
      return { ok: false, code: "chat_mismatch", text: "Запрос отклонён: другой чат." };
    }
    const actorId = expect.actorId ?? envelope.actor;
    const chatId = expect.chatId ?? envelope.chat;
    const chatType = expect.chatType ?? "private";

    if (permit && !permit.has(String(envelope.tool))) {
      return { ok: false, code: "tool_not_allowed", text: `Мост не объявлял инструмент «${envelope.tool}».` };
    }

    // One-time id, kept a day: the window is a minute, but a late duplicate
    // must not slip in after the clock moved.
    if (store && typeof store.setIfAbsent === "function") {
      let fresh = false;
      try { fresh = await store.setIfAbsent(`${SEEN_PREFIX}${envelope.id}`, { at: now(), tool: envelope.tool }); }
      catch { return { ok: false, code: "bridge_storage_unavailable", text: "Запрос отклонён: не удалось отметиться." }; }
      if (!fresh) return { ok: false, code: "replayed", text: "Запрос уже исполнялся." };
    }

    const result = await capabilities.call({
      name: envelope.tool,
      params: envelope.args ?? {},
      actorId,
      chatId,
      chatType,
      context,
    });
    return { ...result, id: envelope.id, tool: envelope.tool };
  }

  /**
   * The answer travels signed in the opposite direction: the heart must be able
   * to tell a real refusal by this bot from a JSON line somebody pasted into
   * the channel.
   */
  async function sealResult({ id, tool = null, result = {} } = {}) {
    if (!enabled) return { ok: false, code: "bridge_not_configured" };
    const body = {
      v: BRIDGE_VERSION,
      id: String(id ?? ""),
      ts: now(),
      tool,
      ok: result.ok === true,
      code: result.code ?? (result.ok === true ? "ok" : "refused"),
      text: String(result.text ?? ""),
    };
    // Structured results (a catalogue, a list) are part of the signed body, so
    // nothing can be appended to an answer that was already agreed.
    if (result.data !== undefined) body.data = result.data;
    try { return { ok: true, envelope: { ...body, sig: await hmac(secret, bridgePayload(body)) } }; }
    catch { return { ok: false, code: "crypto_unavailable" }; }
  }

  async function verifyResult(envelope) {
    const checked = await verify(envelope);
    if (!checked.ok) return checked;
    const result = { id: envelope.id, tool: envelope.tool, ok: envelope.ok === true, code: envelope.code, text: envelope.text };
    if (envelope.data !== undefined) result.data = envelope.data;
    return { ok: true, result };
  }

  return Object.freeze({ enabled, seal, sealResult, verify, verifyResult, handle });
}
