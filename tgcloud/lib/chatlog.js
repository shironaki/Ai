/**
 * Память чата: «что я пропустил?».
 *
 * Она запоминает последние сообщения группы — имя и начало текста — на двое
 * суток. По вопросу «что я пропустил?» пересказывает то, что было после
 * последнего сообщения спросившего; в разговоре видит, о чём шла речь рядом.
 * Админ может это выключить: «не запоминай чат».
 *
 * Хранится только текст от людей, без команд; длинное обрезается. Через двое
 * суток запись удаляется сама.
 */
const PREFIX = (chatId) => `heart:log:${chatId}:`;
const pad = (id) => String(Math.max(0, Math.round(Number(id) || 0))).padStart(12, "0");
export const LOG_PREFIX = "heart:log:";
export const LOG_TTL_MS = 2 * 86_400_000;
const MAX_TEXT = 280;

const fold = (text) => String(text ?? "").toLowerCase().replace(/ё/gu, "е").replace(/[.!?…]+$/u, "").replace(/\s+/gu, " ").trim();
const MISSED = /^(?:а\s+)?(?:что\s+я\s+пропустил[а]?|что\s+(?:тут|здесь|в\s+чате)\s+(?:было|происходило|случилось|обсуждали|творилось)(?:\s+без\s+меня)?|что\s+было\s+(?:без\s+меня|пока\s+меня\s+не\s+было)|что\s+(?:обсуждали|нового)\s+(?:без\s+меня|в\s+чате|тут|здесь)|о\s+ч[её]м\s+(?:тут\s+|здесь\s+|в\s+чате\s+)?(?:говорили|болтали|речь|шла\s+речь|спорили|беседа)|перескажи\s+чат|(?:краткая\s+)?сводка\s+чата|кратко\s+о\s+чате|что\s+я\s+проспал[а]?|введи\s+(?:меня\s+)?в\s+курс(?:\s+дела)?)$/u;
const OFF = /^(?:не\s+(?:запоминай|читай|записывай|храни)\s+(?:этот\s+)?чат|забудь\s+(?:этот\s+)?чат|выключи\s+память\s+чата|не\s+следи\s+за\s+чатом)$/u;
const ON = /^(?:запоминай\s+(?:этот\s+)?чат|включи\s+память\s+чата|можешь\s+(?:читать|запоминать)\s+чат|следи\s+за\s+чатом)$/u;

/** «Что я пропустил?» → { missed }, «не запоминай чат» → { off }, «запоминай чат» → { on }. */
export function parseMissed(text) {
  const value = fold(text);
  if (!value || value.length > 60) return null;
  if (MISSED.test(value)) return { missed: true };
  if (OFF.test(value)) return { off: true };
  if (ON.test(value)) return { on: true };
  return null;
}

export function createChatLog({ store, now = () => Date.now() } = {}) {
  const usable = () => Boolean(store?.available) && typeof store.tail === "function";

  /** Записать реплику группы. Команды, пустое и ботов сюда не приносят. */
  async function note(chatId, { id, userId, name, text, at = now() } = {}) {
    const body = String(text ?? "").replace(/\s+/gu, " ").trim();
    if (!usable() || chatId == null || id == null || !body || body.startsWith("/")) return false;
    return store.set(`${PREFIX(chatId)}${pad(id)}`, { u: String(userId ?? ""), n: String(name ?? "").slice(0, 40), t: body.length > MAX_TEXT ? `${body.slice(0, MAX_TEXT).trimEnd()}…` : body, at }).catch(() => false);
  }

  /** Последние реплики чата по порядку: `[{ id, u, n, t, at }]`. */
  async function recent(chatId, limit = 200) {
    if (!usable()) return [];
    const rows = await store.tail(PREFIX(chatId), limit).catch(() => null);
    const fresh = now() - LOG_TTL_MS;
    return (rows ?? []).map(row => ({ id: Number(row.key.slice(PREFIX(chatId).length)), ...row.value })).filter(row => row.t && Number(row.at) > fresh);
  }

  /**
   * Что было после последней реплики человека (не считая той, которой он
   * спрашивает). Не писал вовсе — всё, что помнится.
   */
  async function missedBy(chatId, userId, { askId = null, limit = 200 } = {}) {
    const rows = (await recent(chatId, limit)).filter(row => askId == null || row.id < Number(askId));
    let last = -1;
    for (let index = rows.length - 1; index >= 0; index -= 1) if (rows[index].u === String(userId)) { last = index; break; }
    const missed = rows.slice(last + 1).filter(row => row.u !== String(userId));
    return { rows: missed, since: last >= 0 ? rows[last].at : null, known: rows.length };
  }

  async function forget(chatId) {
    if (!store?.available || typeof store.sweep !== "function") return false;
    // «Старше, чем из будущего» — то есть всё, включая записанное в эту же секунду.
    return store.sweep(PREFIX(chatId), -LOG_TTL_MS).catch(() => false);
  }

  return Object.freeze({ note, recent, missedBy, forget });
}

/** Сводка без модели: кто сколько сказал и последние реплики. */
export function digest(rows, { plural = (n, a, b, c) => (n === 1 ? a : n < 5 ? b : c) } = {}) {
  if (!rows.length) return "";
  const by = new Map();
  for (const row of rows) by.set(row.n || "кто-то", (by.get(row.n || "кто-то") ?? 0) + 1);
  const people = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => `${name} — ${count}`).join(", ");
  const tail = rows.slice(-6).map(row => `• ${row.n || "кто-то"}: ${row.t.length > 120 ? `${row.t.slice(0, 120).trimEnd()}…` : row.t}`).join("\n");
  return `${rows.length} ${plural(rows.length, "сообщение", "сообщения", "сообщений")}. Больше всех писали: ${people}.\n\nПоследнее:\n${tail}`;
}

/** Реплики для модели: «Имя: текст», самые свежие, не длиннее `budget` знаков. */
export function transcript(rows, budget = 2800) {
  const out = [];
  let used = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const line = `${rows[index].n || "кто-то"}: ${rows[index].t}`;
    if (used + line.length + 1 > budget) break;
    out.unshift(line);
    used += line.length + 1;
  }
  return out.join("\n");
}
