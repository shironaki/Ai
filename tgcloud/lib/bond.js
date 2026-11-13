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
    if (!usable()) return { c: {}, jokes: [] };
    const saved = await store.get(KEY(userId)).catch(() => null);
    return { c: saved?.c && typeof saved.c === "object" ? { ...saved.c } : {}, jokes: Array.isArray(saved?.jokes) ? saved.jokes.slice(0, MAX_JOKES) : [] };
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

  return Object.freeze({ count, counts, addJoke, jokes, dropJoke });
}
