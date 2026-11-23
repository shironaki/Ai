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
 *
 * Пути (0.54.2). Первый живой опыт (22.11.2026) не прошёл: новый пост бота двери до двери не дошёл. Чей это отказ —
 * Telegram, платформы или наш, — из опыта не видно, поэтому запрос принимается тремя путями, а ответ уходит тем же:
 *   • `direct` — личное сообщение бота (Bot API 10.0, «Bot-to-Bot Communication»): бот приложения пишет Аи по имени,
 *     она отвечает ему лично; режим должен быть включён у обоих ботов (`ready` включает его у Аи);
 *   • `edit` — правка поста в канале двери: правку чужого бота сердце слышит вживую (так бьёт будильник); ответ —
 *     пост-заготовка и тут же его правка: если слышны только правки, до бота двери дойдёт она;
 *   • `post` — новый пост в канале двери, как в 0.54.0.
 * Конверт и подпись у всех путей одни. Что дверь услышала (путь, время, итог), она записывает: `line` — для
 * статуса, `says` — для телефона после опыта.
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
/** Пути запроса — в том порядке, в каком их пробует опыт: от описанного Telegram к обходам. */
export const DOOR_WAYS = Object.freeze(["direct", "edit", "post"]);
/**
 * Сколько последних событий двери помнит сердце (два круга опыта — девять событий) и за какое время показывает их,
 * когда телефон не назвал, с какого события считать.
 */
export const DOOR_HEARD_MAX = 16;
export const DOOR_HEARD_MS = 900_000;
/** Заготовка ответа в канале: пост с этим знаком сердце тут же правит в ответ (путь `edit`). */
export const DOOR_SLOT_TEXT = "⏳";
/** С этого слова начинается строка, которую сердце отдаёт телефону на вопрос «что с дверью» (`says`). */
export const DOOR_SAYS = "DOOR-SAYS";
/**
 * Что можно делать через дверь: всё, что делает страница комнаты, кроме `oops` — это журнал ошибок самой страницы —
 * и `say` (0.55.1, слово ей в комнате): дверь остаётся как была, новое через неё — только по команде владельца
 * (сообщение 63). Новое действие комнаты сюда само не попадает: `tests/door.test.mjs` назовёт его и попросит решить.
 */
export const DOOR_ALLOW = Object.freeze(["look", "pet", "feed", "play", "tea", "water", "pat", "book", "quiet", "wear", "brew", "call", "window", "lamp", "music", "pick", "album", "gift", "snap"]);
export const DOOR_NOT_ALLOWED = Object.freeze(["oops", "say"]);
/**
 * Пакетная синхронизация (0.59.0, `docs/DOOR.md`, раздел 14) — действие самой двери, а не комнаты: очередь
 * приложения, которое работает без сети. Знаков в поле `in`: у одиночного действия — 1024, у пачки — 3000.
 */
export const DOOR_SYNC = "sync";
export const DOOR_IN_MAX = 1024;
export const DOOR_SYNC_IN_MAX = 3000;
/** Событий в пачке; сколько последних событий установки сердце помнит (без срока); сколько установок у человека. */
export const DOOR_SYNC_EVENTS = 12;
export const DOOR_SYNC_KEEP = 64;
export const DOOR_SYNC_DEVICES = 8;
/** Сколько событие числится «в работе» у другого запуска; дольше — тот запуск оборвался. */
export const DOOR_SYNC_PENDING_MS = 30_000;
/** Что кладут в очередь: всё, что меняет комнату. `look` и `album` — чтение. */
export const DOOR_SYNC_DO = Object.freeze(["pet", "feed", "play", "tea", "water", "pat", "book", "quiet", "wear", "brew", "call", "window", "lamp", "music", "pick", "gift", "snap"]);
/** Отказы комнаты, после которых событие остаётся в очереди: память не ответила, слишком часто, комната закрыта, поломка. */
export const DOOR_SYNC_LATER = Object.freeze(["storage", "slow", "off", "runtime_error"]);
/** Поля записей комнаты, которые не считаются переменой: заходы и номера действий. */
export const DOOR_SYNC_IDLE = Object.freeze(["near", "n", "ops", "ids", "word"]);
export const DOOR_SYNC_KEY = (uid) => `heart:door:sync:${uid}`;

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

export function createDoor({ key = "", onRoom = null, api = null, store = null, now = () => Date.now(), ownerId = 0, guests = false, allow = DOOR_ALLOW, build = "", report = null, tidy = true, busy = [], stateKeys = null } = {}) {
  const parsed = doorKey(key);
  // Канал, по которому уже ходит другое (мост с сестрой, а по нему и будильник), дверью быть не может: дверь забирает
  // себе все посты своего канала, и мост с будильником замолчали бы без единого слова. С таким ключом двери нет.
  const taken = Boolean(parsed) && (Array.isArray(busy) ? busy : [busy]).some(item => String(item ?? "") === parsed.channel);
  const enabled = Boolean(parsed) && !taken && typeof onRoom === "function" && typeof api?.sendMessage === "function";
  const channel = parsed?.channel ?? "", secret = parsed?.secret ?? "";
  const permit = new Set((Array.isArray(allow) ? allow : DOOR_ALLOW).map(String));
  const tell = async (item) => { if (typeof report === "function") { try { await report({ component: "door", title: "Дверь приложения", severity: "degraded", ...item }); } catch { /* весть не важнее двери */ } } };

  const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

  /**
   * Каким путём пришло: пост канала двери — `post`, его правка — `edit`, личное сообщение бота с конвертом двери —
   * `direct`. Пусто — не к двери. От ботов сердце не слушает ничего, кроме этого конверта.
   */
  const wayOf = (message) => {
    if (!enabled) return "";
    const type = message?.chat?.type;
    if (type === "channel") return String(message?.chat?.id ?? "") === channel ? (message?.edit_date ? "edit" : "post") : "";
    // Личный чат с ботом: тип «private»; как именно Telegram назовёт чат бота с ботом, вживую не видели, поэтому
    // годится и чат, чей номер — номер самого отправителя (у групп и каналов номера отрицательные).
    const own = type === "private" || (message?.from?.id != null && String(message?.chat?.id) === String(message.from.id));
    if (own && message?.from?.is_bot === true && doorRead(message?.text) !== null) return "direct";
    return "";
  };

  /** Пост из канала двери — дело двери, каким бы он ни был: будильник такими постами не заводится. */
  const mine = (message) => wayOf(message) !== "";

  // Без звука: владелец — участник своего канала двери, и каждый ответ приложению звенел бы у него в телефоне.
  const QUIET = { disable_web_page_preview: true, disable_notification: true };
  async function send(envelope, to = {}) {
    const text = doorWire({ ...envelope, sig: await hmac(secret, doorPayload(envelope)) });
    if (to.way === "direct") {
      // Боту пишут по имени (Bot API 10.0: «by passing their @username»); по номеру чата — запасной путь.
      let failure = null;
      for (const chat_id of [to.name ? `@${to.name}` : null, to.chat].filter(item => item != null)) {
        try { await api.sendMessage({ chat_id, text, ...QUIET }); return; } catch (error) { failure = error; }
      }
      throw failure ?? new Error("door: no chat");
    }
    // Запрос пришёл правкой — и ответ уходит правкой: заготовка, затем её текст. Слышны боту двери и новые посты —
    // он увидит заготовку и пропустит её; слышны только правки — увидит ответ.
    if (to.way === "edit" && typeof api.editMessageText === "function") {
      const slot = await api.sendMessage({ chat_id: channel, text: DOOR_SLOT_TEXT, ...QUIET });
      if (slot?.message_id != null) {
        try { await api.editMessageText({ chat_id: channel, message_id: slot.message_id, text, disable_web_page_preview: true }); return; } catch { /* правка не вышла — обычным постом */ }
      }
    }
    await api.sendMessage({ chat_id: channel, text, ...QUIET });
  }

  /**
   * Что дверь услышала: путь, время, чем кончилось. Последние события — для строки статуса и для телефона. У каждого
   * свой номер по порядку: «что было после такого-то» по номеру считается точно, а по времени — нет: часы у разных
   * запусков платформы расходятся на минуты (журнал, 15.11.2026).
   */
  async function hear(way, code) {
    if (!store?.available) return false;
    return store.update(DOOR_STATE_KEY, (before) => {
      const state = plain(before), seq = (Number(state.seq) || 0) + 1;
      return { ...state, seq, heard: [{ n: seq, at: now(), way, code: String(code ?? "") }, ...(Array.isArray(state.heard) ? state.heard : [])].slice(0, DOOR_HEARD_MAX) };
    }).catch(() => false);
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
        ...(Array.isArray(state.heard) ? { heard: state.heard, seq: Number(state.seq) || 0 } : {}), ...(state.b2b && typeof state.b2b === "object" ? { b2b: state.b2b } : {}),
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
  async function note(at, code, re = "", to = {}) {
    const allowed = await account(at, (state) => (state.notes.length >= DOOR_NOTES || state.posts >= DOOR_PER_MINUTE ? null
      : { notes: [...state.notes, at], posts: state.posts + 1, refused: state.refused + 1, last: at, code }));
    if (allowed !== "go") return { ok: false, code: `door_${code}`, noted: false };
    try { await send({ v: 1, t: "e", re: /^[A-Za-z0-9_-]{8,40}$/u.test(String(re)) ? String(re) : "", code, ts: now(), build }, to); } catch { /* пометка не важнее двери */ }
    return { ok: false, code: `door_${code}`, noted: true };
  }

  async function answer(id, result, to = {}) {
    let parts = doorParts(JSON.stringify(result));
    if (parts.length > DOOR_PARTS_MAX) parts = doorParts(JSON.stringify({ ok: false, code: "too_big", text: "Ответ не помещается в дверь.", build }));
    for (let index = 0; index < parts.length; index += 1) await send({ v: 1, t: "a", re: id, n: index + 1, of: parts.length, ts: now(), body: parts[index] }, to);
    return parts.length;
  }

  async function onPost(message, { dry = false } = {}) {
    const way = wayOf(message);
    if (!way) return { ok: false, code: "door_off" };
    const out = await serve(message, way, dry);
    // Репетиция ничего не пишет; нет базы — писать некуда.
    if (!dry && out?.code !== "door_storage") await hear(way, out?.code);
    return out;
  }

  async function serve(message, way, dry) {
    const envelope = doorRead(message?.text);
    if (envelope === null) return { ok: true, code: "door_ignored" };
    // Время запроса сверяется с временем Telegram: у поста это время поста, у правки — время правки.
    const posted = Number(way === "edit" ? message?.edit_date : message?.date) * 1000;
    const to = { way, chat: message?.chat?.id, name: String(message?.from?.username ?? "") };
    const at = Number.isFinite(posted) && posted > 0 ? posted : now();
    if (dry) return { ok: true, code: "door_request", side_effects: "none" };
    if (!store?.available) return { ok: false, code: "door_storage" };
    if (envelope === false) return note(at, "bad_envelope", "", to);
    // Ответы и пометки в канале — не ей: свои посты к боту не возвращаются, чужие ответы она не читает.
    if (envelope.t !== "q") return { ok: true, code: "door_ignored" };
    const { id, ts, uid, sig } = envelope, op = envelope.do, input = envelope.in ?? "";
    const shaped = Number(envelope.v) === 1 && typeof id === "string" && /^[A-Za-z0-9_-]{8,40}$/u.test(id)
      && Number.isSafeInteger(ts) && ts > 0 && Number.isSafeInteger(uid) && uid > 0
      && typeof op === "string" && /^[a-z]{1,16}$/u.test(op) && typeof input === "string" && input.length <= (op === DOOR_SYNC ? DOOR_SYNC_IN_MAX : DOOR_IN_MAX)
      && typeof sig === "string" && /^[0-9a-f]{64}$/u.test(sig);
    if (!shaped) return note(at, "bad_envelope", id, to);
    let expected;
    try { expected = await hmac(secret, doorPayload({ ...envelope, in: input })); } catch { return { ok: false, code: "door_crypto" }; }
    if (!sameBytes(expected, sig)) {
      await tell({ code: "bad_signature", detail: "к двери пришёл запрос с неверной подписью — не пустила", hint: "Ключ в строке KEY_DOOR на телефоне и ключ у посредника должны совпадать знак в знак. Запросы не ваши — смените ключ и опубликуйте заново." });
      return note(at, "bad_signature", id, to);
    }
    if (!Number.isFinite(posted) || Math.abs(ts - posted) > DOOR_SKEW_MS) return note(at, "stale", id, to);
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
    // У пачки `retry` — список событий, поэтому секунды до новой минуты названы иначе: `wait`.
    if (gate === "slow") result = refuse("slow", "Слишком часто. Чуть позже.", { [op === DOOR_SYNC ? "wait" : "retry"]: 60 - Math.floor((at % 60_000) / 1000) });
    else if (!(guests === true || (Number(ownerId) > 0 && uid === Number(ownerId)))) result = refuse("door_closed", "Дверь приложения пока открыта только хозяину.");
    else if (op === DOOR_SYNC ? !syncOn : !permit.has(op)) result = refuse("forbidden", "Через приложение этого не делают.");
    else {
      let fields = null;
      try { fields = input ? JSON.parse(input) : {}; } catch { fields = null; }
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) result = refuse("bad_input", "Не разобрала, что передано.");
      else if (op === DOOR_SYNC) {
        result = await sync(uid, fields);
        // Снимок не помещается в восемь постов — подтверждения важнее: ответ уходит без него.
        if (doorParts(JSON.stringify(result)).length > DOOR_PARTS_MAX) result = { ...result, snapshot: { ok: false, do: "look", code: "too_big", text: "Снимок не поместился в ответ. Возьмите его действием look.", build } };
      } else result = await onRoom({ ...fields, do: op }, { initData: { user: { id: uid } }, door: true });
    }
    // Любой ответ на пачку назван её действием — и отказ двери тоже.
    if (op === DOOR_SYNC && result?.do !== DOOR_SYNC) result = { ...result, do: DOOR_SYNC };
    let posts = 0;
    try { posts = await answer(id, result, to); }
    catch {
      await tell(way === "direct"
        ? { code: "send_failed", detail: "не могу ответить боту приложения лично", hint: "У меня и у бота приложения должен быть включён режим общения ботов: @BotFather → бот → Bot Settings → Bot-to-Bot Communication Mode." }
        : { code: "send_failed", detail: "не могу написать ответ в канал двери", hint: "Дайте мне в канале двери право публиковать сообщения." });
      return { ok: false, code: "door_send_failed" };
    }
    // Длинный ответ занял несколько постов — досчитать; отказ двери — в итоги.
    if (posts > 1 || (result?.ok !== true && gate === "go")) {
      await account(at, (state) => ({ posts: state.posts + Math.max(0, posts - 1), refused: state.refused + (result?.ok !== true && gate === "go" ? 1 : 0), code: result?.ok === true ? op : String(result?.code ?? "refused") }));
    }
    // Канал — провод, а не журнал: прочитанный запрос убирается. Нет права — не беда.
    if (tidy && way !== "direct" && message?.message_id != null && typeof api.deleteMessage === "function") {
      try { await api.deleteMessage({ chat_id: channel, message_id: message.message_id }); } catch { /* останется в канале */ }
    }
    return { ok: true, code: "door_answer", do: op, parts: posts, answered: result?.ok === true };
  }

  /* ── пакетная синхронизация (0.59.0): действие двери `sync` ─────────────────────────────────────────────────
   * Приложение на телефоне работает без сети: действия ложатся в его очередь, а сюда приходят пачками. Договор —
   * `docs/DOOR.md`, раздел 14; запрос владельца — `docs/SYNC-CONTRACT.md` в репозитории приложения.
   *   • события применяются по порядку к нынешней комнате — теми же действиями, что и одиночные;
   *   • сердце помнит последние события каждой установки (`DOOR_SYNC_KEEP`) без срока: то же событие второй раз
   *     не применяется, другое под тем же номером — отказ `seq_conflict`;
   *   • курсор — номер перемены комнаты с печатью ключом двери; перемену сердце видит по отпечатку того, что
   *     комната помнит (`stateKeys`), каким бы входом её ни изменили.
   * ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
  // Список действий сузили настройкой — пачки идут, только если в нём названо и `sync`.
  const syncOn = allow === DOOR_ALLOW || !Array.isArray(allow) || allow.map(String).includes(DOOR_SYNC);
  const checked = async (name) => {
    if (typeof store.getChecked === "function") { const got = await store.getChecked(name); if (!got?.ok) throw new Error("door: memory is silent"); return got.value ?? null; }
    return (await store.get(name)) ?? null;
  };
  /** Курсор снимка — «c1.<номер перемены>.<печать>»: чужой или испорченный с печатью не сойдётся. */
  const cursorOf = async (uid, rev) => `c1.${rev}.${(await hmac(secret, `AI-DOOR1\ncursor\n${uid}\n${rev}`)).slice(0, 16)}`;
  const cursorRev = async (uid, value) => {
    const found = /^c1\.([1-9]\d{0,14})\.[0-9a-f]{16}$/u.exec(String(value ?? ""));
    return found && (await cursorOf(uid, Number(found[1]))) === String(value) ? Number(found[1]) : null;
  };
  /** Отпечаток того, что комната помнит. Служебное (заходы, номера действий) — не перемена. */
  const markOf = async (uid) => {
    const parts = [];
    for (const name of typeof stateKeys === "function" ? stateKeys(uid) : []) {
      const value = await checked(name);
      parts.push(canonical(value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([field]) => !DOOR_SYNC_IDLE.includes(field))) : value));
    }
    return (await hmac(secret, `AI-DOOR1\nstate\n${uid}\n${parts.join("\n")}`)).slice(0, 24);
  };
  /** Запись синхронизации человека: счёт перемен, отпечаток и события установок (`seq` → номер, отпечаток, исход). */
  const syncBook = (saved) => {
    const state = plain(saved), devices = {};
    for (const [name, entry] of Object.entries(plain(state.devices))) {
      if (/^[a-z0-9]{16,32}$/u.test(name)) devices[name] = { at: Number(plain(entry).at) || 0, floor: Number(plain(entry).floor) || 0, seen: { ...plain(plain(entry).seen) } };
    }
    return { v: 1, rev: Number.isSafeInteger(state.rev) && state.rev > 0 ? state.rev : 0, mark: typeof state.mark === "string" ? state.mark : "", devices };
  };

  async function sync(uid, fields) {
    const refuse = (code, text, more = {}) => ({ ok: false, do: DOOR_SYNC, code, text, build, ...more });
    const ctx = { initData: { user: { id: uid } }, door: true, sync: true };
    // 1. Вид пачки. Что не так с ней целиком — отказ всей пачке: ничего не применяется и не запоминается.
    const device = fields.device, base = fields.base ?? null, list = fields.events;
    if (Number(fields.v) !== 1) return refuse("bad_sync", "Версия пачки — не 1.");
    if (typeof device !== "string" || !/^[a-z0-9]{16,32}$/u.test(device)) return refuse("bad_sync", "Номер установки device — от 16 до 32 знаков: a–z и 0–9.");
    if (base !== null && !(typeof base === "string" && base.length <= 64)) return refuse("bad_sync", "Курсор base — строка до 64 знаков или null.");
    if (!Array.isArray(list) || list.length > DOOR_SYNC_EVENTS) return refuse("bad_sync", `Событий в пачке — от 0 до ${DOOR_SYNC_EVENTS}.`);
    const events = [], named = new Set();
    let top = 0;
    for (const raw of list) {
      const item = plain(raw);
      if (typeof item.id !== "string" || !/^[a-z0-9]{20}$/u.test(item.id) || named.has(item.id)) return refuse("bad_sync", "У каждого события свой номер id: ровно 20 знаков a–z и 0–9.");
      if (!Number.isSafeInteger(item.seq) || item.seq <= top) return refuse("bad_sync", "Номера seq — целые, больше нуля и идут по возрастанию.");
      named.add(item.id); top = item.seq; events.push(item);
    }
    const all = events.map(item => item.id);
    const silent = () => refuse("storage", "Память сейчас не отвечает. Пачка не тронута: повторите позже.", { server_ts: now(), cursor: null, ack: [], rejected: [], retry: all, conflicts: [], snapshot: null });
    const key = DOOR_SYNC_KEY(uid), at = now(), token = Math.random().toString(36).slice(2, 12);

    // 2. Что сердце помнит и какая комната сейчас. Изменилась с прошлой сверки (чат, страница, одиночное действие
    //    двери) — счёт перемен идёт дальше: курсор прошлого снимка устарел.
    let rev = 0, markNow = "";
    try {
      const book = syncBook(await checked(key));
      markNow = await markOf(uid);
      rev = book.rev > 0 && book.mark === markNow ? book.rev : book.rev + 1;
    } catch { return silent(); }

    /** Снимок — после всего; курсор — ровно к нему. Заодно в запись ложатся исходы событий этой пачки. */
    const finish = async (head, lists, outcomes = new Map()) => {
      let snapshot = null, markAfter = null;
      try { snapshot = await onRoom({ do: "look", again: true }, ctx); } catch { snapshot = null; }
      try { markAfter = await markOf(uid); } catch { markAfter = null; }
      if (markAfter !== null && markAfter !== markNow) rev += 1;
      await store.update(key, (before) => {
        const book = syncBook(before), mine = book.devices[device] ?? { at: 0, floor: 0, seen: {} }, seen = { ...mine.seen };
        for (const [seq, outcome] of outcomes) {
          const entry = seen[seq];
          // Заявку перехватил другой запуск — она уже не наша.
          if (!Array.isArray(entry) || entry[2] !== "p" || entry[4] !== token) continue;
          if (outcome === null) delete seen[seq]; else seen[seq] = [entry[0], entry[1], ...outcome];
        }
        // Помнятся последние события установки; что вытеснено — ниже «пола»: такой номер уже не проверить.
        let floor = mine.floor;
        const order = Object.keys(seen).map(Number).sort((a, b) => a - b);
        while (order.length > DOOR_SYNC_KEEP) { const gone = order.shift(); floor = Math.max(floor, gone); delete seen[gone]; }
        const devices = { ...book.devices, [device]: { at, floor, seen } };
        for (const name of Object.keys(devices).sort((a, b) => devices[b].at - devices[a].at).slice(DOOR_SYNC_DEVICES)) delete devices[name];
        return { v: 1, rev: Math.max(book.rev, rev), mark: markAfter ?? book.mark, devices };
      }).catch(() => false);
      return {
        ...head, do: DOOR_SYNC, build, server_ts: now(), cursor: await cursorOf(uid, rev), ...lists,
        snapshot: snapshot ?? { ok: false, do: "look", code: "runtime_error", text: "Снимок не собрался. Возьмите его действием look.", build },
      };
    };

    // 3. Курсор приложения. Не мой или из будущего — ничего не применять: приложению нужен свежий снимок.
    let stale = false;
    if (base !== null) {
      const seen = await cursorRev(uid, base);
      if (seen === null || seen > rev) {
        return finish({ ok: false, code: "bad_cursor", text: "Курсор не мой или из будущего. Ничего не применено: возьмите снимок и курсор из этого ответа и повторите пачку." }, { ack: [], rejected: [], retry: all, conflicts: [] });
      }
      stale = seen < rev;
    }

    // 4. Заявка — одной правкой записи: что уже подтверждено, что отвергнуто, что новое («в работе»).
    const digests = new Map();
    for (const item of events) digests.set(item.id, (await hmac(secret, `AI-DOOR1\nevent\n${String(item.do)}\n${canonical(item.in ?? {})}`)).slice(0, 16));
    let verdicts = null;
    const claimed = await store.update(key, (before) => {
      const book = syncBook(before), mine = book.devices[device] ?? { at: 0, floor: 0, seen: {} }, seen = { ...mine.seen };
      const byId = new Map(Object.entries(seen).filter(([, entry]) => Array.isArray(entry)).map(([seq, entry]) => [entry[0], Number(seq)]));
      const plan = new Map();
      for (const item of events) {
        const known = seen[item.seq], digest = digests.get(item.id);
        if (Array.isArray(known)) {
          if (known[0] !== item.id || known[1] !== digest) plan.set(item.id, { kind: "no", code: "seq_conflict", text: "Под этим номером seq я уже помню другое событие. Не применено." });
          else if (known[2] === "a") plan.set(item.id, { kind: "ack" });
          else if (known[2] === "r") plan.set(item.id, { kind: "no", code: String(known[3] ?? "refused"), text: String(known[4] ?? "") });
          // «В работе» у другого запуска: подождать. Дольше полуминуты — тот запуск оборвался: применяем заново
          // (комната второй раз не примет — она помнит номер действия).
          else if (known[4] !== token && at - Number(known[3]) >= 0 && at - Number(known[3]) < DOOR_SYNC_PENDING_MS) plan.set(item.id, { kind: "busy" });
          else { seen[item.seq] = [item.id, digest, "p", at, token]; plan.set(item.id, { kind: "new" }); }
          continue;
        }
        if (item.seq <= mine.floor) { plan.set(item.id, { kind: "no", code: "seq_old", text: "Номер seq старше тех, что я помню: проверить его уже нельзя. Не применено." }); continue; }
        if (byId.has(item.id)) { plan.set(item.id, { kind: "no", code: "id_conflict", text: "Этот номер id я уже помню под другим seq. Не применено." }); continue; }
        const flaw = !DOOR_SYNC_DO.includes(item.do) ? ["bad_do", "Такое действие в очередь не кладут."]
          : !permit.has(item.do) ? ["forbidden", "Через приложение этого не делают."]
            : !(item.in === undefined || (item.in && typeof item.in === "object" && !Array.isArray(item.in))) ? ["bad_in", "Поля действия in — объект."]
              : !(Number.isSafeInteger(item.at) && item.at > 0) ? ["bad_at", "Время действия at — целое число миллисекунд."] : null;
        if (flaw) { seen[item.seq] = [item.id, digest, "r", flaw[0], flaw[1]]; plan.set(item.id, { kind: "no", code: flaw[0], text: flaw[1] }); }
        else { seen[item.seq] = [item.id, digest, "p", at, token]; plan.set(item.id, { kind: "new" }); }
        byId.set(item.id, item.seq);
      }
      verdicts = plan;
      return { ...book, devices: { ...book.devices, [device]: { at, floor: mine.floor, seen } } };
    }).catch(() => false);
    if (claimed !== true || !verdicts) return silent();

    // 5. По порядку — к нынешней комнате. Временный отказ останавливает пачку: что после него, ждёт своей очереди.
    const ack = [], rejected = [], retry = [], conflicts = [], outcomes = new Map();
    let halted = false;
    for (const item of events) {
      const verdict = verdicts.get(item.id);
      if (verdict.kind === "ack") { ack.push(item.id); continue; }
      if (verdict.kind === "no") { rejected.push({ id: item.id, code: verdict.code, text: verdict.text, final: true }); continue; }
      if (verdict.kind === "busy") { retry.push(item.id); halted = true; continue; }
      if (halted) { retry.push(item.id); outcomes.set(item.seq, null); continue; }
      let result = null;
      try { result = await onRoom({ ...plain(item.in), do: item.do, id: item.id }, ctx); } catch { result = null; }
      if (result?.ok === true) {
        ack.push(item.id); outcomes.set(item.seq, ["a"]);
        if (stale) conflicts.push({ id: item.id, code: "rebased", text: "Комната изменилась, пока действие ждало в очереди: применено поверх нынешнего состояния." });
        continue;
      }
      const code = String(result?.code ?? "runtime_error");
      if (!result || DOOR_SYNC_LATER.includes(code)) { retry.push(item.id); outcomes.set(item.seq, null); halted = true; continue; }
      const text = String(result.text ?? "").slice(0, 200);
      rejected.push({ id: item.id, code, text, final: true }); outcomes.set(item.seq, ["r", code, text]);
    }
    return finish({ ok: true }, { ack, rejected, retry, conflicts }, outcomes);
  }

  /** Одноразовые номера старше суток не нужны: такой запрос не пройдёт уже по времени. */
  async function sweep() {
    if (!enabled || typeof store?.sweep !== "function") return false;
    return store.sweep(DOOR_SEEN_PREFIX, 24 * 3600_000);
  }

  /**
   * Конверт двери пришёл не туда: из другого канала, из группы, не от бота. Запомнить, откуда и какой: по этой записи
   * видно, что ключ записан на один канал, а посредник пишет в другой, — или что Telegram отдаёт сообщение бота не в
   * том виде, какого ждёт `wayOf` (вживую этот вид до опыта никто не видел).
   */
  async function stray(message) {
    if (!enabled || wayOf(message) || doorRead(message?.text) === null) return false;
    const from = message?.from;
    await hear("stray", `${message?.chat?.type ?? "чат"} ${message?.chat?.id ?? "?"}${from ? (from.is_bot === true ? ", от бота" : ", не от бота") : ""}`);
    return true;
  }

  /**
   * Режим общения ботов (Bot API 10.0): без него бот приложения не может написать Аи лично, а она — ответить ему.
   * С Bot API 10.5 бот включает режим себе сам (`setMySettings`); не вышло — причина ложится в статус, и режим
   * включают руками в @BotFather. Зовётся после публикации и по вопросу телефона.
   */
  async function ready() {
    if (!enabled || !store?.available || typeof api?.setMySettings !== "function") return null;
    let b2b;
    try { await api.setMySettings({ can_communicate_with_bots: true }); b2b = { ok: true, at: now() }; }
    catch (error) { b2b = { ok: false, at: now(), why: String(error?.description ?? error?.message ?? error).replace(/\s+/gu, " ").slice(0, 120) }; }
    await store.update(DOOR_STATE_KEY, (before) => ({ ...plain(before), b2b })).catch(() => false);
    return b2b;
  }

  const WAY_WORD = { direct: "личное сообщение бота", edit: "правка поста", post: "новый пост" };
  const CODE_WORD = {
    door_answer: "запрос, ответила", door_ignored: "не запрос, просто слово", door_replay: "повтор прежнего запроса",
    door_bad_signature: "запрос с чужой подписью: ключи у сторон разные", door_stale: "запрос, время в нём разошлось со временем Telegram",
    door_bad_envelope: "запрос не разобрала", door_late: "запрос опоздал больше чем на десять минут", door_full: "запросов слишком много",
    door_send_failed: "запрос был, ответить не смогла", door_crypto: "подпись проверить нечем",
  };
  const ago = (at) => { const s = Math.max(0, Math.round((now() - Number(at)) / 1000)); return s < 90 ? `${s} с назад` : s < 5400 ? `${Math.round(s / 60)} мин назад` : `${Math.round(s / 3600)} ч назад`; };
  const B2B_HINT = "включите сами: @BotFather → /mybots → бот Аи → Bot Settings → Bot-to-Bot Communication Mode";

  /** Строка для статуса хозяина. Пусто — ключа двери нет вовсе: о двери, которой нет, она не говорит. */
  async function line() {
    if (!String(key ?? "").trim()) return "";
    if (!parsed) return "закрыта — ключ записан не так: нужен вид «номер канала:секрет», секрет от 32 знаков";
    if (taken) return "закрыта — канал двери тот же, что у моста: двери нужен свой канал";
    if (!enabled) return "закрыта — нет комнаты или связи с Telegram";
    const state = store?.available ? await store.get(DOOR_STATE_KEY).catch(() => null) : null;
    const today = Number(state?.day) === Math.floor(now() / 86_400_000);
    const asked = today ? Number(state?.asked) || 0 : 0, refused = today ? Number(state?.refused) || 0 : 0;
    const heard = Array.isArray(state?.heard) ? state.heard : [], served = heard.find(item => item?.code === "door_answer"), latest = heard[0];
    // Каким путём дверь слышит: последний исполненный запрос; не было такого — последнее, что вообще пришло.
    const path = served ? `путь: ${WAY_WORD[served.way] ?? served.way}`
      : !latest ? "от бота двери пока ничего не приходило"
      : latest.way === "stray" ? `запрос двери пришёл не туда (${latest.code})`
      : `слышала: ${WAY_WORD[latest.way] ?? latest.way} ${ago(latest.at)} — ${CODE_WORD[latest.code] ?? latest.code}`;
    const mode = state?.b2b && state.b2b.ok === false ? ` · общение ботов не включилось (${state.b2b.why || "причина неизвестна"})` : "";
    return `открыта ${guests === true ? "всем, кого назовёт посредник" : "только вам"} · за сутки запросов: ${asked}${refused ? `, отказов: ${refused}${state?.code ? ` (последний — ${state.code})` : ""}` : ""} · ${path}${mode}`;
  }

  /**
   * То же для телефона — до и после опыта (`bash scripts/phone.sh door`): что дверь слышала по каждому пути.
   * Строки разделены знаком «|». В первой — имя бота Аи (по нему ей пишут лично) и номер последнего услышанного:
   * телефон берёт его до опыта и называет после (`after`) — тогда в ответе только то, что пришло за сам опыт.
   * Без номера — всё за последние четверть часа, со временем «столько-то назад» по часам этого запуска.
   */
  async function says({ name = "", after = null } = {}) {
    const state = store?.available ? await store.get(DOOR_STATE_KEY).catch(() => null) : null;
    const head = `${DOOR_SAYS} name=${/^[A-Za-z0-9_]{3,40}$/u.test(String(name)) ? name : "-"} seq=${Number(state?.seq) || 0}`;
    if (!String(key ?? "").trim()) return `${head} | У сердца нет ключа двери: оно опубликовано без строки KEY_DOOR.`;
    if (!enabled) return `${head} | Дверь у сердца ${await line()}.`;
    const since = Number.isSafeInteger(Number(after)) && after !== null && after !== "" ? Number(after) : null;
    const heard = (Array.isArray(state?.heard) ? state.heard : []).filter(item => (since === null ? now() - Number(item?.at) < DOOR_HEARD_MS : Number(item?.n) > since));
    const when = (item) => (since === null ? `${ago(item.at)}: ` : "");
    const rows = DOOR_WAYS.map((way) => {
      const item = heard.find(entry => entry.way === way);
      return `• ${WAY_WORD[way]} — ${item ? `${when(item)}${CODE_WORD[item.code] ?? item.code}` : "не слышала"}`;
    });
    const lost = heard.find(entry => entry.way === "stray");
    if (lost) rows.push(`• запрос двери пришёл не туда — ${when(lost)}${lost.code}; если это канал — ключ записан на другой`);
    const mode = !state?.b2b ? "Общение ботов у Аи: ещё не включала." : state.b2b.ok ? "Общение ботов у Аи: включено." : `Общение ботов у Аи не включилось (${state.b2b.why || "причина неизвестна"}) — ${B2B_HINT}.`;
    return [head, since === null ? "Что слышала Аи от бота двери за последние четверть часа:" : "Что слышала Аи от бота двери за этот опыт:", ...rows, mode].join(" | ");
  }

  return Object.freeze({ enabled, channel, mine, onPost, stray, ready, says, sweep, line });
}
