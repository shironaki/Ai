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

export function createBridge({ secret = "", store = null, capabilities, now = () => Date.now(), ttl = BRIDGE_TTL_MS, allowed = null, slack = 0 } = {}) {
  if (!capabilities || typeof capabilities.call !== "function") throw new TypeError("createBridge needs capabilities");
  const enabled = String(secret ?? "").length >= 16;
  const permit = Array.isArray(allowed) ? new Set(allowed) : null;

  /** Seal a call. The heart signs; this bot verifies the same bytes. */
  async function seal({ tool, args = {}, actor, chat, chatType = null, ttl: lifetime = ttl } = {}) {
    if (!enabled) return { ok: false, code: "bridge_not_configured", text: "Мост не настроен: нет общего секрета." };
    // Chat type decides which tools exist: a group-only ability must not show up
    // in a private chat, and vice versa. It travels inside the signature, so the
    // other side cannot be told "this was a group" by anyone but us.
    const scope = ["private", "group", "supergroup"].includes(chatType) ? chatType : null;
    const envelope = {
      v: BRIDGE_VERSION,
      id: `${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      ts: now(),
      ttl: Math.max(1000, Math.min(600_000, Number(lifetime) || ttl)),
      tool: String(tool ?? ""),
      args,
      actor: actor == null ? null : String(actor),
      chat: chat == null ? null : String(chat),
      ...(scope ? { chatType: scope } : {}),
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
    // `slack` — допуск на часы: у двух ботов они могут расходиться на минуты (см. abilities.js).
    // Повтор старого конверта он не пропускает: одноразовый `id` помнится сутки.
    const limit = Math.max(Number(envelope.ttl ?? ttl), Number(slack) || 0);
    if (!Number.isFinite(age) || Math.abs(age) > limit) return { ok: false, code: "expired", age };
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

/* ───────────────────────────────────────────────────────────────────────────────────────────────────────────
 * Дверь приложения (0.54.0). Договор целиком — `docs/DOOR.md`; здесь — сторона сердца.
 *
 * Второй вход в ту же комнату: не со страницы внутри Telegram (`endpoints/room.js`), а из отдельного приложения.
 * Приложение говорит с доверенным посредником; посредник проверил, кто вошёл (Telegram ID), и пишет подписанный
 * запрос постом в закрытый канал двери — своим ботом, не ботом Аи. Сердце получает пост как обычное обновление
 * (`handlers/channel_post.js`), проверяет его и зовёт ту же `onRoom`: та же база, тот же договор ответа. Ответ
 * уходит постом в тот же канал, тоже подписанный. Ни токена публикации, ни ключа бота у посредника нет.
 *
 * Что делает запрос годным, по порядку:
 *   1. пост пришёл из канала двери — его номер записан в ключе рядом с секретом;
 *   2. подпись HMAC-SHA256 общим секретом — над строкой из полей (`doorPayload`), не над JSON: одинаково на любом
 *      языке, без «канонического вида»;
 *   3. время в запросе сходится с временем поста, которое поставил Telegram (`message.date`), до двух минут.
 *      Часы платформы для этого не годятся: у разных запусков они расходятся на минуты (журнал, 15.11.2026);
 *   4. одноразовый `id`: тот же запрос второй раз не исполняется;
 *   5. частота — на дверь целиком и на человека;
 *   6. кого пускать (пока — только хозяина) и что разрешено делать (`DOOR_ALLOW`).
 * Модуль не выбирает ключ и не читает его из чата: его собирают с ключом, без ключа двери нет.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────── */
export const DOOR_PREFIX = "AI-DOOR1 ";
export const DOOR_SEEN_PREFIX = "heart:door:seen:";
export const DOOR_STATE_KEY = "heart:door:state";
/** На сколько время в запросе может расходиться с временем поста по часам Telegram. */
export const DOOR_SKEW_MS = 120_000;
/** Пост старше этого по часам сердца не исполняется: его уже никто не ждёт. Десять минут — допуск на часы платформы. */
export const DOOR_LATE_MS = 600_000;
/** Знаков в одном посте (у Telegram предел 4096) и частей в одном ответе. */
export const DOOR_POST_MAX = 3900;
export const DOOR_PARTS_MAX = 8;
/** Постов сердца в канал двери за минуту (Telegram даёт боту около двадцати в один чат) и запросов одного человека. */
export const DOOR_PER_MINUTE = 18;
export const DOOR_PER_PERSON = 10;
/** Пометок «дверь не пустила» (неверная подпись, просрочено, не разобрать) — за десять минут. */
export const DOOR_NOTES = 3;
export const DOOR_NOTES_MS = 600_000;
/**
 * Что можно делать через дверь: всё, что делает страница комнаты, кроме `oops` — это журнал ошибок самой страницы.
 * Новое действие комнаты сюда само не попадает: `tests/door.test.mjs` назовёт его и попросит решить.
 */
export const DOOR_ALLOW = Object.freeze(["look", "pet", "feed", "play", "tea", "water", "pat", "book", "quiet", "wear", "brew", "call", "window", "lamp", "music", "pick", "album", "gift", "snap"]);
export const DOOR_NOT_ALLOWED = Object.freeze(["oops"]);

/** Ключ двери — «номер канала:секрет» одной строкой (`KEY_DOOR` на телефоне): секрет без канала ничего не открывает. */
export function doorKey(value) {
  const found = /^(-100\d{5,15}):([\x21-\x7e]{32,})$/u.exec(String(value ?? "").trim());
  return found ? { channel: found[1], secret: found[2] } : null;
}

/**
 * Строка под подпись: вид конверта и его поля через перевод строки. Последнее поле — единственное, где перевод
 * строки мог бы встретиться; остальные проверяются по виду до подписи, так что склеить два разных конверта в одну
 * строку нельзя. Числа — как есть, десятичной записью.
 */
export function doorPayload(envelope = {}) {
  const line = (...fields) => ["AI-DOOR1", ...fields.map(field => String(field ?? ""))].join("\n");
  if (envelope.t === "q") return line("q", envelope.id, envelope.ts, envelope.uid, envelope.do, envelope.in);
  if (envelope.t === "a") return line("a", envelope.re, envelope.n, envelope.of, envelope.ts, envelope.body);
  return line("e", envelope.re, envelope.code, envelope.ts, envelope.build);
}

// Знаки, которые идут в пост как есть: латиница с цифрами, кириллица и привычная пунктуация. Всё остальное (эмодзи,
// неразрывные пробелы, значки) уходит записью `\uXXXX` — JSON читает её сам, а Telegram в таких знаках ничего не
// поправит и не срежет. Подпись от этого не зависит: она над значениями полей, а не над текстом поста.
const DOOR_PLAIN = "«»—–…№";
const doorPlain = (code) => (code >= 0x20 && code <= 0x7e) || (code >= 0x400 && code <= 0x4ff) || DOOR_PLAIN.includes(String.fromCharCode(code));
const doorEscape = (piece) => Array.from({ length: piece.length }, (_, index) => `\\u${piece.charCodeAt(index).toString(16).padStart(4, "0")}`).join("");

/** Текст поста с конвертом. */
export function doorWire(envelope) {
  return DOOR_PREFIX + JSON.stringify(envelope).replace(/[^\x20-\x7e\u0400-\u04ff«»—–…№]/gu, doorEscape);
}

/** Конверт из текста поста: `null` — это не конверт двери, `false` — начат как конверт, но не читается. */
export function doorRead(text) {
  const raw = String(text ?? "").trim(), head = DOOR_PREFIX.trim();
  if (!raw.startsWith(head)) return null;
  try {
    const value = JSON.parse(raw.slice(head.length));
    return value && typeof value === "object" && !Array.isArray(value) ? value : false;
  } catch { return false; }
}

/**
 * Разрезать ответ на части, каждая из которых влезет в один пост. Считается не длина куска, а сколько он займёт в
 * посте: кавычка и обратная черта — два знака, знак вне «простых» — шесть. Пара суррогатов не разрывается.
 */
export function doorParts(text, room = DOOR_POST_MAX - 260) {
  const source = String(text ?? ""), parts = [];
  let from = 0, cost = 0;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    const price = code === 0x22 || code === 0x5c ? 2 : doorPlain(code) ? 1 : 6;
    if (cost + price > room && !(code >= 0xdc00 && code <= 0xdfff)) { parts.push(source.slice(from, index)); from = index; cost = 0; }
    cost += price;
  }
  parts.push(source.slice(from));
  return parts;
}

export function createDoor({ key = "", onRoom = null, api = null, store = null, now = () => Date.now(), ownerId = 0, guests = false, allow = DOOR_ALLOW, build = "", report = null, tidy = true, busy = [] } = {}) {
  const parsed = doorKey(key);
  // Канал, по которому уже ходит другое (мост с сестрой, а по нему и будильник), дверью быть не может: дверь забирает
  // себе все посты своего канала, и мост с будильником замолчали бы без единого слова. С таким ключом двери нет.
  const taken = Boolean(parsed) && (Array.isArray(busy) ? busy : [busy]).some(item => String(item ?? "") === parsed.channel);
  const enabled = Boolean(parsed) && !taken && typeof onRoom === "function" && typeof api?.sendMessage === "function";
  const channel = parsed?.channel ?? "", secret = parsed?.secret ?? "";
  const permit = new Set((Array.isArray(allow) ? allow : DOOR_ALLOW).map(String));
  const tell = async (item) => { if (typeof report === "function") { try { await report({ component: "door", title: "Дверь приложения", severity: "degraded", ...item }); } catch { /* весть не важнее двери */ } } };

  /** Пост из канала двери — дело двери, каким бы он ни был: будильник такими постами не заводится. */
  const mine = (message) => enabled && String(message?.chat?.id ?? "") === channel;

  // Без звука: владелец — участник своего канала двери, и каждый ответ приложению звенел бы у него в телефоне.
  async function send(envelope) {
    await api.sendMessage({ chat_id: channel, text: doorWire({ ...envelope, sig: await hmac(secret, doorPayload(envelope)) }), disable_web_page_preview: true, disable_notification: true });
  }

  /**
   * Учёт одной правкой базы: окно в минуту по времени поста (часы Telegram — одни на всех), счёт постов сердца и
   * запросов человека, пометки за десять минут, итоги за сутки для строки статуса. `plan` получает прежнее
   * состояние и возвращает, что прибавить, или `null` — «не пускать и ничего не писать».
   */
  async function account(at, plan) {
    let verdict = null;
    const kept = await store.update(DOOR_STATE_KEY, (before) => {
      const state = before && typeof before === "object" && !Array.isArray(before) ? before : {};
      const min = Math.floor(at / 60_000), day = Math.floor(at / 86_400_000);
      const sameMin = Number(state.min) === min, sameDay = Number(state.day) === day;
      const fresh = {
        min, posts: sameMin ? Number(state.posts) || 0 : 0, by: sameMin && state.by && typeof state.by === "object" ? state.by : {},
        notes: (Array.isArray(state.notes) ? state.notes : []).filter(item => at - Number(item) < DOOR_NOTES_MS && Number(item) <= at),
        day, asked: sameDay ? Number(state.asked) || 0 : 0, refused: sameDay ? Number(state.refused) || 0 : 0,
        last: Number(state.last) || 0, code: String(state.code ?? ""),
      };
      const next = plan(fresh);
      verdict = next ? next.verdict ?? "go" : "stop";
      if (!next) return null;
      const { verdict: _verdict, ...rest } = next;
      return { ...fresh, ...rest };
    }).catch(() => false);
    return kept ? verdict : verdict === "stop" ? "stop" : "lost";
  }

  /** Пометка «дверь не пустила»: подписана, как всё, что пишет сердце, но это не ответ — запрос не исполнялся. */
  async function note(at, code, re = "") {
    const allowed = await account(at, (state) => (state.notes.length >= DOOR_NOTES || state.posts >= DOOR_PER_MINUTE ? null
      : { notes: [...state.notes, at], posts: state.posts + 1, refused: state.refused + 1, last: at, code }));
    if (allowed !== "go") return { ok: false, code: `door_${code}`, noted: false };
    try { await send({ v: 1, t: "e", re: /^[A-Za-z0-9_-]{8,40}$/u.test(String(re)) ? String(re) : "", code, ts: now(), build }); } catch { /* пометка не важнее двери */ }
    return { ok: false, code: `door_${code}`, noted: true };
  }

  async function answer(id, result) {
    let parts = doorParts(JSON.stringify(result));
    if (parts.length > DOOR_PARTS_MAX) parts = doorParts(JSON.stringify({ ok: false, code: "too_big", text: "Ответ не помещается в дверь.", build }));
    for (let index = 0; index < parts.length; index += 1) await send({ v: 1, t: "a", re: id, n: index + 1, of: parts.length, ts: now(), body: parts[index] });
    return parts.length;
  }

  async function onPost(message, { dry = false } = {}) {
    if (!enabled) return { ok: false, code: "door_off" };
    // Правка поста — не запрос: у неё прежнее время, а запрос живёт две минуты.
    if (message?.edit_date) return { ok: true, code: "door_ignored" };
    const envelope = doorRead(message?.text);
    if (envelope === null) return { ok: true, code: "door_ignored" };
    const posted = Number(message?.date) * 1000;
    const at = Number.isFinite(posted) && posted > 0 ? posted : now();
    if (dry) return { ok: true, code: "door_request", side_effects: "none" };
    if (!store?.available) return { ok: false, code: "door_storage" };
    if (envelope === false) return note(at, "bad_envelope");
    // Ответы и пометки в канале — не ей: свои посты к боту не возвращаются, чужие ответы она не читает.
    if (envelope.t !== "q") return { ok: true, code: "door_ignored" };
    const { id, ts, uid, sig } = envelope, op = envelope.do, input = envelope.in ?? "";
    const shaped = Number(envelope.v) === 1 && typeof id === "string" && /^[A-Za-z0-9_-]{8,40}$/u.test(id)
      && Number.isSafeInteger(ts) && ts > 0 && Number.isSafeInteger(uid) && uid > 0
      && typeof op === "string" && /^[a-z]{1,16}$/u.test(op) && typeof input === "string" && input.length <= 1024
      && typeof sig === "string" && /^[0-9a-f]{64}$/u.test(sig);
    if (!shaped) return note(at, "bad_envelope", id);
    let expected;
    try { expected = await hmac(secret, doorPayload({ ...envelope, in: input })); } catch { return { ok: false, code: "door_crypto" }; }
    if (!sameBytes(expected, sig)) {
      await tell({ code: "bad_signature", detail: "в канал двери пришёл запрос с неверной подписью — не пустила", hint: "Ключ в строке KEY_DOOR на телефоне и ключ у посредника должны совпадать знак в знак. Запросы не ваши — смените ключ и опубликуйте заново." });
      return note(at, "bad_signature", id);
    }
    if (!Number.isFinite(posted) || Math.abs(ts - posted) > DOOR_SKEW_MS) return note(at, "stale", id);
    if (now() - posted > DOOR_LATE_MS) return { ok: false, code: "door_late" };

    // Частота: дверь целиком — молча (ответ тоже пост, а постов больше не дают); человек — отказом словами.
    const person = String(uid);
    const gate = await account(at, (state) => {
      if (state.posts >= DOOR_PER_MINUTE) return null;
      const mineSoFar = Number(state.by[person]) || 0, slow = mineSoFar >= DOOR_PER_PERSON;
      return { verdict: slow ? "slow" : "go", posts: state.posts + 1, by: { ...state.by, [person]: mineSoFar + 1 }, asked: state.asked + 1, refused: state.refused + (slow ? 1 : 0), last: at, code: slow ? "slow" : op };
    });
    if (gate === "stop") return { ok: false, code: "door_full" };
    if (gate === "lost") return { ok: false, code: "door_storage" };

    // Одноразовый номер. Значение у каждой попытки своё: иначе две одинаковые записи друг от друга не отличить.
    const stamp = { at: now(), n: Math.random().toString(36).slice(2, 12) };
    let fresh = false;
    try { fresh = await store.setIfAbsent(`${DOOR_SEEN_PREFIX}${id}`, stamp); } catch { fresh = false; }
    if (!fresh) return { ok: false, code: "door_replay" };

    const refuse = (code, text, more = {}) => ({ ok: false, code, text, build, ...more });
    let result;
    if (gate === "slow") result = refuse("slow", "Слишком часто. Чуть позже.", { retry: 60 - Math.floor((at % 60_000) / 1000) });
    else if (!(guests === true || (Number(ownerId) > 0 && uid === Number(ownerId)))) result = refuse("door_closed", "Дверь приложения пока открыта только хозяину.");
    else if (!permit.has(op)) result = refuse("forbidden", "Через приложение этого не делают.");
    else {
      let fields = null;
      try { fields = input ? JSON.parse(input) : {}; } catch { fields = null; }
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) result = refuse("bad_input", "Не разобрала, что передано.");
      else result = await onRoom({ ...fields, do: op }, { initData: { user: { id: uid } }, door: true });
    }
    let posts = 0;
    try { posts = await answer(id, result); }
    catch {
      await tell({ code: "send_failed", detail: "не могу написать ответ в канал двери", hint: "Дайте мне в канале двери право публиковать сообщения." });
      return { ok: false, code: "door_send_failed" };
    }
    // Длинный ответ занял несколько постов — досчитать; отказ двери — в итоги.
    if (posts > 1 || (result?.ok !== true && gate === "go")) {
      await account(at, (state) => ({ posts: state.posts + Math.max(0, posts - 1), refused: state.refused + (result?.ok !== true && gate === "go" ? 1 : 0), code: result?.ok === true ? op : String(result?.code ?? "refused") }));
    }
    // Канал — провод, а не журнал: прочитанный запрос убирается. Нет права — не беда.
    if (tidy && message?.message_id != null && typeof api.deleteMessage === "function") {
      try { await api.deleteMessage({ chat_id: channel, message_id: message.message_id }); } catch { /* останется в канале */ }
    }
    return { ok: true, code: "door_answer", do: op, parts: posts, answered: result?.ok === true };
  }

  /** Одноразовые номера старше суток не нужны: такой запрос не пройдёт уже по времени. */
  async function sweep() {
    if (!enabled || typeof store?.sweep !== "function") return false;
    return store.sweep(DOOR_SEEN_PREFIX, 24 * 3600_000);
  }

  /** Строка для статуса хозяина. Пусто — ключа двери нет вовсе: о двери, которой нет, она не говорит. */
  async function line() {
    if (!String(key ?? "").trim()) return "";
    if (!parsed) return "закрыта — ключ записан не так: нужен вид «номер канала:секрет», секрет от 32 знаков";
    if (taken) return "закрыта — канал двери тот же, что у моста: двери нужен свой канал";
    if (!enabled) return "закрыта — нет комнаты или связи с Telegram";
    const state = store?.available ? await store.get(DOOR_STATE_KEY).catch(() => null) : null;
    const today = Number(state?.day) === Math.floor(now() / 86_400_000);
    const asked = today ? Number(state?.asked) || 0 : 0, refused = today ? Number(state?.refused) || 0 : 0;
    return `открыта ${guests === true ? "всем, кого назовёт посредник" : "только вам"} · за сутки запросов: ${asked}${refused ? `, отказов: ${refused}${state?.code ? ` (последний — ${state.code})` : ""}` : ""}`;
  }

  return Object.freeze({ enabled, channel, mine, onPost, sweep, line });
}
