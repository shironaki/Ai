/**
 * Своё с каждым: счёт общих мелочей и «наши шутки».
 *
 * Модель здесь не нужна. Она считает, сколько раз человек её обнял или
 * погладил, и на круглом числе говорит об этом; помнит шутки, которые человек
 * сам назвал общими, и изредка возвращает их в приветствии. Из таких мелочей
 * и складывается «она меня помнит».
 */
const KEY = (userId) => `heart:bond:${userId}`;
export const MILESTONES = Object.freeze([10, 25, 50, 100, 250, 500, 1000, 2500, 5000]);
const MAX_JOKES = 12;
/** Поступки, которые она помнит за каждым — и за хозяином тоже: её чувства к нему живые. */
export const MARKS = Object.freeze(["thanks", "praise", "taught", "apology", "caress", "rude"]);
/** Сколько держится обида на грубость и радость от доброго слова. */
export const HURT_MS = 3 * 3_600_000;
export const GLAD_MS = 2 * 3_600_000;
const WARM = ["thanks", "praise", "taught", "caress"];

/**
 * Что она сейчас чувствует к человеку по его последним поступкам: `{ hurt, glad }` — час
 * поступка или 0. Грубость задевает на три часа; извинение и любое доброе слово после неё
 * обиду снимают. Доброе слово радует на два часа; извинение само радости не приносит.
 */
export function feelOf(last = {}, at = Date.now()) {
  const when = (key) => Number(last?.[key]) || 0;
  const rude = when("rude");
  const warm = Math.max(0, ...WARM.map(when));
  if (rude && at - rude < HURT_MS && Math.max(warm, when("apology")) <= rude) return { hurt: rude, glad: 0 };
  return { hurt: 0, glad: warm > rude && at - warm < GLAD_MS ? warm : 0 };
}
const dayBefore = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

const fold = (text) => String(text ?? "").replace(/\s+/gu, " ").trim();
const ADD = /^(?:это\s+)?(?:наш(?:а|е)?\s+(?:шутка|прикол|мем|фраза|словечко)|запомни(?:те)?\s+(?:нашу\s+)?(?:шутку|прикол|мем)|пусть\s+это\s+будет\s+наш(?:а|ей)?\s+шутк(?:а|ой))\s*[:—–-]\s*([\s\S]{2,120})$/iu;
const LIST = /^(?:наши\s+(?:шутки|приколы|мемы)|какие\s+у\s+нас\s+(?:шутки|приколы|мемы)|покажи\s+(?:наши\s+)?(?:шутки|приколы)|что\s+у\s+нас\s+общего|наши\s+общие\s+шутки)$/iu;
const DROP = /^(?:забудь|удали|убери)(?:те)?\s+(?:наш[уи]\s+|все\s+(?:наши\s+)?)?(?:шутк[уи]|прикол[ы]?|мем[ы]?)(?:\s+(?:номер\s+|№\s*)?(\d{1,2}))?$/iu;

/** «Наша шутка: …», «наши шутки», «забудь шутку 2» → просьба, иначе null. */
export function parseJoke(text) {
  const value = fold(text).replace(/[.!?…]+$/u, "");
  if (!value) return null;
  const add = value.match(ADD);
  if (add) return { add: add[1].replace(/^[«"']+|[»"']+$/gu, "").trim() };
  if (LIST.test(value)) return { list: true };
  const drop = value.match(DROP);
  if (drop) return drop[1] ? { drop: Number(drop[1]) } : { drop: "all" };
  return null;
}

export function createBond({ store, now = () => Date.now() } = {}) {
  const usable = () => Boolean(store?.available);
  async function load(userId) {
    if (!usable()) return { c: {}, jokes: [], last: {}, d: {} };
    const saved = await store.get(KEY(userId)).catch(() => null);
    const object = (value) => (value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {});
    return { c: object(saved?.c), jokes: Array.isArray(saved?.jokes) ? saved.jokes.slice(0, MAX_JOKES) : [], last: object(saved?.last), d: object(saved?.d) };
  }
  const save = async (userId, state) => (usable() ? store.set(KEY(userId), { ...state, at: now() }).catch(() => false) : false);

  /** Ещё раз. Возвращает новый счёт и то, круглое ли это число. */
  async function count(userId, key) {
    if (userId == null || !key) return { n: 0, milestone: false };
    const state = await load(userId);
    const n = (Number(state.c[key]) || 0) + 1;
    state.c[key] = n;
    await save(userId, state);
    return { n, milestone: MILESTONES.includes(n) };
  }

  async function addJoke(userId, text) {
    const joke = fold(text).slice(0, 120);
    if (!joke) return { ok: false, code: "empty" };
    const state = await load(userId);
    if (state.jokes.some(item => item.toLowerCase() === joke.toLowerCase())) return { ok: true, duplicate: true, total: state.jokes.length };
    if (state.jokes.length >= MAX_JOKES) return { ok: false, code: "too_many", total: state.jokes.length };
    state.jokes.push(joke);
    const saved = await save(userId, state);
    return saved ? { ok: true, total: state.jokes.length } : { ok: false, code: "storage_unavailable" };
  }
  const jokes = async (userId) => (await load(userId)).jokes;
  async function dropJoke(userId, which) {
    const state = await load(userId);
    const before = state.jokes.length;
    if (which === "all") state.jokes = [];
    else if (Number.isInteger(which) && which >= 1 && which <= before) state.jokes.splice(which - 1, 1);
    else return { ok: false, code: "not_found", total: before };
    await save(userId, state);
    return { ok: true, removed: before - state.jokes.length, total: state.jokes.length };
  }
  const counts = async (userId) => (await load(userId)).c;

  /** Поступок: счёт и час. Возвращает чувство до и после — по нему видно, задело ли и оттаяла ли. */
  async function mark(userId, kind) {
    if (userId == null || !MARKS.includes(kind)) return null;
    const state = await load(userId);
    const before = feelOf(state.last, now());
    state.c[kind] = (Number(state.c[kind]) || 0) + 1;
    // Порядок поступков важнее часов: два в одну миллисекунду всё равно идут друг за другом.
    state.last[kind] = Math.max(now(), 1 + Math.max(0, ...Object.values(state.last).map(value => Number(value) || 0)));
    await save(userId, state);
    return { n: state.c[kind], before, after: feelOf(state.last, now()) };
  }
  /** День, когда говорили: всего таких дней, сколько подряд и лучшая серия. Один день считается один раз. */
  async function day(userId, today) {
    if (userId == null || !/^\d{4}-\d{2}-\d{2}$/u.test(String(today))) return null;
    const state = await load(userId);
    if (state.d.last === today) return { ...state.d, changed: false };
    const streak = state.d.last === dayBefore(today) ? (Number(state.d.streak) || 0) + 1 : 1;
    state.d = { n: (Number(state.d.n) || 0) + 1, streak, best: Math.max(Number(state.d.best) || 0, streak), last: today };
    await save(userId, state);
    return { ...state.d, changed: true };
  }
  const feel = async (userId) => feelOf((await load(userId)).last, now());
  /** Всё, что она помнит о поступках человека: для ответа «как ты ко мне относишься». */
  async function facts(userId) {
    const state = await load(userId);
    return { counts: state.c, last: state.last, days: Number(state.d.n) || 0, streak: Number(state.d.streak) || 0, best: Number(state.d.best) || 0, feel: feelOf(state.last, now()) };
  }

  /** «Удали всё обо мне»: шутки, счёт и поступки — тоже его данные. */
  const forget = async (userId) => (usable() ? store.remove(KEY(userId)).catch(() => false) : false);

  return Object.freeze({ count, counts, addJoke, jokes, dropJoke, mark, day, feel, facts, forget });
}
