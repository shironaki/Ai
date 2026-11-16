/**
 * Слова с повторением (идея 71, «репетитор»): человек даёт пары «слово —
 * перевод», она спрашивает их по расписанию — через день, три, неделю, две,
 * месяц, три месяца. Ошибся — слово возвращается в начало пути.
 *
 * Без модели: спрашивает и проверяет код. Перевод к слову без пары находит
 * переводчик (если он есть). Только в личке: это личный список.
 *
 * Здесь разбор слов и счёт; хранение и разговор — в сердце.
 */
export const CARDS_KEY = (userId) => `heart:cards:${userId}`;
export const CARDS_ASK_KEY = (userId) => `heart:cards:ask:${userId}`;
export const CARDS_MAX = 200;
export const SIDE_MAX = 80;
export const SESSION_MAX = 10;
export const ASK_TTL_MS = 15 * 60_000;
/** Через сколько дней спросить снова после 1-го, 2-го, … верного ответа подряд. */
export const STEPS_DAYS = Object.freeze([1, 3, 7, 14, 30, 90]);
const DAY = 86_400_000;

const fold = (text) => String(text ?? "").toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
const plain = (text) => fold(text).replace(/[^\p{L}\p{N}\s'-]+/gu, " ").replace(/\s+/gu, " ").trim();
const side = (text) => String(text ?? "").replace(/\s+/gu, " ").trim().replace(/^[«"“„'`]+|[»"”'`.!]+$/gu, "").trim().slice(0, SIDE_MAX);

const ADD = /^(?:запомни|добавь|запиши|сохрани)(?:те)?\s+(?:мне\s+)?(?:новое\s+)?слов[оа]\s*[:—–-]?\s*(.+)$/iu;
const LIST = /^(?:(?:покажи|какие)\s+)?(?:мои\s+слова|слова\s+(?:для|на)\s+повторени[яе]|мой\s+словарик|мои\s+карточки)$/u;
const ASK = /^(?:(?:спроси|проверь|погоняй)\s+(?:меня\s+)?(?:по\s+)?(все\s+)?(?:мои\s+|моим\s+)?слова(?:м)?|(?:давай\s+)?(?:повторим|повторять|учить|учим)\s+(все\s+)?(?:мои\s+)?слова|тренировка\s+слов|повторение\s+слов)$/u;
const DROP = /^(?:убери|удали|забудь|вычеркни|сотри)\s+слово\s+(.+)$/iu;
const CLEAR = /^(?:удали|убери|очисти|сотри|забудь)\s+(?:все\s+(?:мои\s+)?|мои\s+)слова$/u;
const STOP = /^(?:стоп|хватит|достаточно|закончим|закончили|потом|все|на\s+сегодня\s+(?:хватит|все))$/u;

/**
 * Слова → просьба, иначе null:
 *   { add: { front, back? } } — «запомни слово apple — яблоко»; без пары — перевод найдёт переводчик;
 *   { list } — «мои слова»; { ask, all? } — «спроси слова», «спроси все слова»;
 *   { drop } — «убери слово 3» / «убери слово apple»; { clear } — «удали все слова»;
 *   { stop } — «стоп», «хватит»: кончает опрос (слова обычные, сердце читает их только во время опроса).
 */
export function parseCards(text) {
  const raw = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!raw || raw.length > 260) return null;
  const value = fold(raw).replace(/[.!?…]+$/u, "").trim();
  if (LIST.test(value)) return { list: true };
  let found = value.match(ASK);
  if (found) return { ask: true, ...(found[1] || found[2] ? { all: true } : {}) };
  if (CLEAR.test(value)) return { clear: true };
  if (STOP.test(value)) return { stop: true };
  found = raw.match(DROP);
  if (found) {
    const what = side(found[1]);
    if (!what) return null;
    return { drop: /^\d{1,3}$/u.test(what) ? Number(what) : what };
  }
  found = raw.match(ADD);
  if (found) {
    // Пара — через тире или дефис с пробелами, знак равенства или двоеточие: «ice-cream — мороженое» не рвётся.
    const pair = found[1].split(/\s+[—–-]\s+|\s*=\s*|:\s+/u);
    const front = side(pair[0]);
    const back = side(pair.slice(1).join(" — "));
    if (!front) return null;
    return { add: { front, ...(back ? { back } : {}) } };
  }
  return null;
}

/** Записи из базы → чистый список: `[{ f, b, s, due, n, ok }]`. */
export function cardsOf(saved) {
  const items = Array.isArray(saved?.items) ? saved.items : [];
  return items
    .filter(item => item && typeof item.f === "string" && typeof item.b === "string" && item.f && item.b)
    .map(item => ({ f: item.f.slice(0, SIDE_MAX), b: item.b.slice(0, SIDE_MAX), s: Math.max(0, Math.min(STEPS_DAYS.length, Math.round(Number(item.s) || 0))), due: Number(item.due) || 0, n: Math.max(0, Math.round(Number(item.n) || 0)), ok: Math.max(0, Math.round(Number(item.ok) || 0)) }))
    .slice(0, CARDS_MAX);
}

export const sameCard = (item, front) => fold(item.f) === fold(front);

/** Что пора спросить: самые давние — первыми. `all` — весь список. */
export function dueCards(items, at, { all = false, limit = SESSION_MAX } = {}) {
  return items.filter(item => all || item.due <= at).sort((a, b) => a.due - b.due).slice(0, limit);
}

/** Верен ли ответ: совпал с переводом или с одним из вариантов («яблоко, яблочко»); лишние слова вокруг — не ошибка. */
export function rightAnswer(answer, back) {
  const said = plain(answer);
  if (!said) return false;
  return String(back ?? "").split(/[,;/]|\s+или\s+/u).map(plain).filter(Boolean)
    .some(want => said === want || (want.length >= 2 && ` ${said} `.includes(` ${want} `)));
}

/** Карточка после ответа: верно — следующий срок, нет — в начало пути и спросить снова в следующий раз. */
export function graded(item, right, at) {
  if (!right) return { ...item, s: 0, due: at, n: item.n + 1 };
  const days = STEPS_DAYS[Math.min(item.s, STEPS_DAYS.length - 1)];
  return { ...item, s: Math.min(item.s + 1, STEPS_DAYS.length), due: at + days * DAY, n: item.n + 1, ok: item.ok + 1 };
}

/** Когда спросит: «сегодня», «завтра», «через 5 дней». */
export function dueWords(due, at) {
  const days = Math.ceil((due - at) / DAY);
  if (days <= 0) return "сегодня";
  if (days === 1) return "завтра";
  const tail = days % 100, one = days % 10;
  return `через ${days} ${tail >= 11 && tail <= 14 ? "дней" : one === 1 ? "день" : one >= 2 && one <= 4 ? "дня" : "дней"}`;
}
