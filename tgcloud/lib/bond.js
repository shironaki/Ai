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
export const MARKS = Object.freeze(["thanks", "praise", "taught", "apology", "caress", "rude", "jealous", "soothe"]);
/** Сколько держится обида на грубость и радость от доброго слова. */
export const HURT_MS = 3 * 3_600_000;
export const GLAD_MS = 2 * 3_600_000;
/** Сколько держится ревность (0.35.0): два часа — или до первого доброго слова. */
export const JEALOUS_MS = 2 * 3_600_000;
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
  // Ревнует («jealous» — час, когда при ней заговорили о другой), пока не услышит доброе слово,
  // извинение или слово-успокоение («soothe»: «не ревнуй», «ты у меня одна»). Поля нет, пока она не ревнует.
  const jealous = when("jealous");
  const stung = jealous && at - jealous < JEALOUS_MS && Math.max(warm, when("soothe"), when("apology")) <= jealous ? { jealous } : {};
  if (rude && at - rude < HURT_MS && Math.max(warm, when("apology")) <= rude) return { hurt: rude, glad: 0, ...stung };
  return { hurt: 0, glad: warm > rude && at - warm < GLAD_MS ? warm : 0, ...stung };
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
  const object = (value) => (value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {});
  // `rival` — как она называет ту, к кому ревнует («Алиса»); поля нет, пока имени не было.
  const shape = (saved) => ({ c: object(saved?.c), jokes: Array.isArray(saved?.jokes) ? saved.jokes.slice(0, MAX_JOKES) : [], last: object(saved?.last), d: object(saved?.d), ...(typeof saved?.rival === "string" && saved.rival ? { rival: saved.rival.slice(0, 40) } : {}) });
  const load = async (userId) => shape(usable() ? await store.get(KEY(userId)).catch(() => null) : null);
  /**
   * Правка поверх свежей записи. `change(state)` меняет её и возвращает итог; итог с `keep: true` —
   * «писать нечего». Два сообщения одного человека приходят разом: «прочитать и записать» теряло бы
   * поступок одного из них, поэтому запись идёт через `store.update`.
   * Возвращает `{ out, saved }`: итог правки и легла ли она.
   */
  async function amend(userId, change) {
    let out;
    const apply = (saved) => {
      const state = shape(saved);
      out = change(state);
      return out?.keep ? null : { ...state, at: now() };
    };
    if (!usable()) { apply(null); return { out, saved: false }; }
    const saved = await store.update(KEY(userId), apply).catch(() => false);
    return { out, saved: Boolean(saved) };
  }

  /** Ещё раз. Возвращает новый счёт и то, круглое ли это число. */
  async function count(userId, key) {
    if (userId == null || !key) return { n: 0, milestone: false };
    const { out } = await amend(userId, (state) => {
      const n = (Number(state.c[key]) || 0) + 1;
      state.c[key] = n;
      return { n, milestone: MILESTONES.includes(n) };
    });
    return out;
  }

  async function addJoke(userId, text) {
    const joke = fold(text).slice(0, 120);
    if (!joke) return { ok: false, code: "empty" };
    const { out, saved } = await amend(userId, (state) => {
      if (state.jokes.some(item => item.toLowerCase() === joke.toLowerCase())) return { keep: true, ok: true, duplicate: true, total: state.jokes.length };
      if (state.jokes.length >= MAX_JOKES) return { keep: true, ok: false, code: "too_many", total: state.jokes.length };
      state.jokes.push(joke);
      return { ok: true, total: state.jokes.length };
    });
    if (out.keep) { const { keep: _keep, ...answer } = out; return answer; }
    return saved ? out : { ok: false, code: "storage_unavailable" };
  }
  const jokes = async (userId) => (await load(userId)).jokes;
  async function dropJoke(userId, which) {
    const { out } = await amend(userId, (state) => {
      const before = state.jokes.length;
      if (which === "all") state.jokes = [];
      else if (Number.isInteger(which) && which >= 1 && which <= before) state.jokes.splice(which - 1, 1);
      else return { keep: true, ok: false, code: "not_found", total: before };
      return { ok: true, removed: before - state.jokes.length, total: state.jokes.length };
    });
    const { keep: _keep, ...answer } = out;
    return answer;
  }
  const counts = async (userId) => (await load(userId)).c;

  /** Поступок: счёт и час. Возвращает чувство до и после — по нему видно, задело ли и оттаяла ли. */
  async function mark(userId, kind, note = "") {
    if (userId == null || !MARKS.includes(kind)) return null;
    const { out } = await amend(userId, (state) => {
      const before = feelOf(state.last, now());
      state.c[kind] = (Number(state.c[kind]) || 0) + 1;
      if (kind === "jealous") { if (note) state.rival = String(note).slice(0, 40); else delete state.rival; }
      // Порядок поступков важнее часов: два в одну миллисекунду всё равно идут друг за другом.
      state.last[kind] = Math.max(now(), 1 + Math.max(0, ...Object.values(state.last).map(value => Number(value) || 0)));
      return { n: state.c[kind], before, after: feelOf(state.last, now()) };
    });
    return out;
  }
  /** День, когда говорили: всего таких дней, сколько подряд и лучшая серия. Один день считается один раз. */
  async function day(userId, today) {
    if (userId == null || !/^\d{4}-\d{2}-\d{2}$/u.test(String(today))) return null;
    const { out } = await amend(userId, (state) => {
      if (state.d.last === today) return { keep: true, ...state.d, changed: false };
      const streak = state.d.last === dayBefore(today) ? (Number(state.d.streak) || 0) + 1 : 1;
      state.d = { n: (Number(state.d.n) || 0) + 1, streak, best: Math.max(Number(state.d.best) || 0, streak), last: today };
      return { ...state.d, changed: true };
    });
    const { keep: _keep, ...answer } = out;
    return answer;
  }
  /** Чувство сейчас — и имя той, к кому она ревнует, если оно прозвучало. */
  const feltOf = (state) => {
    const felt = feelOf(state.last, now());
    return felt.jealous && state.rival ? { ...felt, rival: state.rival } : felt;
  };
  const feel = async (userId) => feltOf(await load(userId));
  /** Всё, что она помнит о поступках человека: для ответа «как ты ко мне относишься». */
  async function facts(userId) {
    const state = await load(userId);
    return { counts: state.c, last: state.last, days: Number(state.d.n) || 0, streak: Number(state.d.streak) || 0, best: Number(state.d.best) || 0, feel: feltOf(state) };
  }

  /** «Удали всё обо мне»: шутки, счёт и поступки — тоже его данные. */
  const forget = async (userId) => (usable() ? store.remove(KEY(userId)).catch(() => false) : false);

  return Object.freeze({ count, counts, addJoke, jokes, dropJoke, mark, day, feel, facts, forget });
}
