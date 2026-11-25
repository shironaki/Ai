/**
 * Небольшие события её дня, альбом воспоминаний, её вещи и подарки (0.49.0, сообщение 48).
 *
 * Владелец: «небольшие события, которые возникают естественно… события не должны повторяться слишком часто»,
 * «альбом воспоминаний: первые события, рисунки, памятные даты, забавные происшествия с Байтом — не журнал действий,
 * а небольшая коллекция», «личные предметы… некоторые появляются после значимых событий», «особенные встречи: если
 * человек долго не заходил — небольшая сценка: чем занималась, что произошло, что хочет рассказать», «хранить историю
 * отдельно от текущего состояния комнаты».
 *
 * Здесь три вещи, и все — отдельно от записи комнаты (`room.js`, `heart:room:<id>`):
 *   • события её дня (`eventFor`) — считаются из даты, а не хранятся: день — её, поэтому событие одно на всех, как и
 *     расписание (`dayPlan`). Отсюда же её вещи (`ownThings`): наброски, найденная книга, открытка — следы событий;
 *   • альбом человека (`createKeepsakes`, ключ `heart:keepsake:<id>`): что было при нём или что она ему рассказала —
 *     первые разы, памятные даты, события, подарки, снимки. Не больше шестидесяти записей; «первые» не вытесняются;
 *   • подарки (идея 163) и снимок на память (идея 165) — записи того же альбома.
 */
import { dayPlan } from "./room.js";

const DAY = 86_400_000;
const hashOf = (text) => { let hash = 2166136261; for (const char of String(text)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0; return hash; };
/** Номер календарного дня «2026-11-18» и обратно. */
export const dayNumber = (day) => { const at = Date.parse(`${String(day).slice(0, 10)}T00:00:00Z`); return Number.isFinite(at) ? Math.floor(at / DAY) : 0; };
export const dayOf = (number) => new Date(number * DAY).toISOString().slice(0, 10);

// ── события её дня ───────────────────────────────────────────────────────────
/**
 * Что бывает (его список): нашла интересную книгу, решила навести порядок, нарисовала что-то для комнаты, увидела
 * красивое небо, Байт устроил шалость, решила сделать перерыв. `stage` — в каком эпизоде дня это случается;
 * `her` и `pose` — чем она тогда занята и где (картинка); `cat` — событие о Байте: её оно с места не снимает;
 * `thing` — что после него остаётся в комнате; `pool` — запас слов «+комната:событие:<pool>» и «+комната:было:<pool>».
 */
export const EVENTS = Object.freeze([
  { key: "book", pool: "книга", stage: "занятия", her: "дело", pose: "read", thing: "book" },
  { key: "tidy", pool: "порядок", stage: "порядок", her: "дело", pose: "dust" },
  { key: "sketch", pool: "набросок", stage: "дела", her: "дело", pose: "desk", thing: "sketch" },
  { key: "sky", pool: "небо", stage: "вечер", her: "уют", pose: "sill", thing: "card" },
  { key: "prank", pool: "шалость", stage: "игра", cat: true },
  { key: "break", pool: "перерыв", stage: "занятия", her: "уют", pose: "chair" },
].map(event => Object.freeze(event)));
export const eventByKey = (key) => EVENTS.find(event => event.key === key) ?? null;
/** Сколько минут длится событие: потом она возвращается к своему дню. */
export const EVENT_MIN = 25;
/**
 * Событие этого дня или `null`. Не чаще одного в день и не каждый день — три дня из пяти; виды идут по кругу, так что
 * один и тот же повторяется не раньше чем через шесть дней. `from` и `to` — минуты от полуночи: внутри своего эпизода.
 * `hours` (0.63.0) — часы её дня для этого человека, `{ wake, bed }`: у хозяина эпизоды стоят иначе, и событие
 * должно попасть в свой эпизод по его часам. Прошлые дни считаются без них: там важно только, было ли событие.
 */
export function eventFor(day, hours = {}) {
  const number = dayNumber(day);
  if (!number) return null;
  const seed = hashOf(`event:${String(day).slice(0, 10)}`);
  if (seed % 5 >= 3) return null;
  const event = EVENTS[number % EVENTS.length];
  const stage = dayPlan(String(day).slice(0, 10), hours ?? {}).find(item => item.name === event.stage);
  if (!stage) return null;
  const room = Math.max(1, Math.floor(stage.to - stage.from - EVENT_MIN - 4));
  const from = Math.floor(stage.from) + 2 + ((seed >>> 3) % room);
  return { ...event, day: String(day).slice(0, 10), from, to: from + EVENT_MIN };
}
/** Идёт ли событие в эту минуту дня. */
export const eventNow = (day, minute, hours = {}) => { const event = eventFor(day, hours); return event && minute >= event.from && minute < event.to ? event : null; };
/** События дней между `fromDay` и `toDay` (не включая оба), не дальше недели назад: о них она расскажет при встрече. */
export function missedEvents(fromDay, toDay, limit = 7) {
  const last = dayNumber(toDay), first = Math.max(dayNumber(fromDay), last - limit - 1), list = [];
  for (let number = first + 1; number < last; number += 1) { const event = eventFor(dayOf(number)); if (event) list.push(event); }
  return list;
}
/**
 * Её вещи — следы её событий (считаются, а не хранятся): наброски на стекле — три последних за полтора месяца;
 * найденная книга лежит десять дней, потом уходит на полку; открытка с небом стоит две недели. Сегодняшнее событие
 * оставляет вещь, когда оно уже кончилось (`minute` — минута дня).
 */
export function ownThings(day, minute = 1440) {
  const number = dayNumber(day), sketches = [];
  let book = "", card = "";
  for (let back = 0; back <= 45 && number; back += 1) {
    const event = eventFor(dayOf(number - back));
    if (!event || (back === 0 && minute < event.to)) continue;
    if (event.key === "sketch" && sketches.length < 3) sketches.push(event.day);
    if (event.key === "book" && !book && back <= 10) book = event.day;
    if (event.key === "sky" && !card && back <= 14) card = event.day;
  }
  return { sketches, book, card };
}
/**
 * Когда Байт приносит добычу: раз в три дня (в среднем), на четверть часа, вечером — к ней, пока она не спит. Тоже
 * считается из даты: то же при повторном заходе и в чате. `null` — сегодня не приносит.
 */
export function catGift(day) {
  const seed = hashOf(`gift:${String(day).slice(0, 10)}`);
  if (seed % 3 !== 0) return null;
  const stage = dayPlan(String(day).slice(0, 10)).find(item => item.name === "вечер");
  if (!stage) return null;
  const from = Math.floor(stage.from) + 20 + ((seed >>> 4) % 90);
  return { from, to: from + 15 };
}

// ── альбом ───────────────────────────────────────────────────────────────────
export const KEEPSAKE_KEY = (userId) => `heart:keepsake:${userId}`;
export const KEEPSAKE_MAX = 60;
/** Снимков на память — не больше восьми и не чаще раза в десять минут. */
export const SNAP_MAX = 8;
export const SNAP_EVERY_MS = 10 * 60_000;
/** Подарки (идея 163): цветок, книга, игрушка Байту — не чаще раза в неделю; цветок стоит неделю. */
export const GIFTS = Object.freeze(["flower", "book", "toy"]);
export const GIFT_EVERY_MS = 7 * DAY;
export const FLOWER_MS = 7 * DAY;
/** Виды записей: первый раз, памятная дата, событие её дня, случай с Байтом, сценка дня, подарок, снимок. */
export const KINDS = Object.freeze(["first", "date", "event", "cat", "scene", "gift", "snap"]);
/** Памятные даты: неделя, месяц, сто дней, год знакомства. */
export const MILESTONES = Object.freeze([7, 30, 100, 365]);
/**
 * Подписи записей — не её речь, а подпись в альбоме; `{ты|вы}` раскрывает сердце. Что не названо — подпись по виду.
 */
export const CAPTIONS = Object.freeze({
  "first:visit": "Первый раз у меня в комнате", "first:tea": "Первая чашка чая от {тебя|вас}", "first:feed": "Первый корм Байту от {тебя|вас}",
  "first:pet": "Байт впервые дал {тебе|вам} себя погладить", "first:play": "Первая игра с Байтом", "first:water": "Первая вода Колючке от {тебя|вас}",
  "first:pat": "Меня впервые погладили по голове", "first:book": "Первая книга, которую {ты мне предложил|вы мне предложили}", "first:music": "Первый танец под колонку",
  "first:quiet": "Первый тихий час рядом", "first:window": "Окно впервые открыли при {тебе|вас}", "first:scene": "Первая сценка дня", "first:call": "Байт впервые пришёл на {твой|ваш} зов",
  "first:gift": "Первый подарок", "first:snap": "Первый снимок на память",
  "date:7": "Неделя, как мы знакомы", "date:30": "Месяц, как мы знакомы", "date:100": "Сто дней, как мы знакомы", "date:365": "Год, как мы знакомы",
  "event:book": "Нашла интересную книгу", "event:tidy": "Навела порядок — и кое-что нашла", "event:sketch": "Нарисовала набросок для комнаты", "event:sky": "Красивое небо за окном",
  "event:prank": "Байт устроил шалость", "event:break": "Устроила себе перерыв",
  "cat:gift": "Байт принёс добычу", "gift:flower": "Цветок от {тебя|вас}", "gift:book": "Книга от {тебя|вас}", "gift:toy": "Игрушка Байту от {тебя|вас}",
  scene: "Сценка дня", snap: "Снимок на память",
});
export const captionOf = (item) => CAPTIONS[`${item?.k}:${item?.key}`] ?? CAPTIONS[item?.k] ?? "Памятный день";
/** Какие подарки сейчас видны в комнате: цветок — неделю, книга и игрушка — последние. */
export function giftsShown(items, at = 0) {
  const list = Array.isArray(items) ? items : [], last = (key) => list.filter(item => item?.k === "gift" && item.key === key).at(-1);
  return GIFTS.filter(key => { const item = last(key); return Boolean(item) && (key !== "flower" || at - Number(item.at) < FLOWER_MS); });
}

export function createKeepsakes({ store = null, now = () => Date.now() } = {}) {
  const usable = () => Boolean(store?.available);
  const text = (value, limit) => (typeof value === "string" ? value.slice(0, limit) : "");
  /** Запись альбома как она лежит → список: только годные записи, не больше положенного. */
  const shaped = (saved) => ({
    items: (Array.isArray(saved?.items) ? saved.items : []).filter(item => item && typeof item === "object" && KINDS.includes(item.k)).slice(-KEEPSAKE_MAX),
    gift: Number(saved?.gift) > 0 ? Number(saved.gift) : 0, snap: Number(saved?.snap) > 0 ? Number(saved.snap) : 0,
  });
  /** Одна и та же запись — не дважды: «первый чай» — один навсегда, событие — одно на свой день, снимок — по времени. */
  const idOf = (item) => (item.k === "first" || item.k === "date" ? `${item.k}:${item.key}` : item.k === "snap" || item.k === "gift" ? `${item.k}:${item.key ?? ""}:${item.at}` : `${item.k}:${item.key ?? ""}:${item.day ?? ""}`);
  /** Лишнее вытесняется с начала, но «первые разы» и даты остаются: это и есть память. */
  const trimmed = (items) => {
    const list = [...items];
    for (let index = 0; list.length > KEEPSAKE_MAX && index < list.length;) { if (list[index].k === "first" || list[index].k === "date") index += 1; else list.splice(index, 1); }
    return list.slice(-KEEPSAKE_MAX);
  };

  /** Альбом человека. `lost` — память не ответила: это не «пустой альбом», и писать поверх нельзя. */
  async function read(userId) {
    let saved = null, lost = false;
    if (usable()) {
      try {
        if (typeof store.getChecked === "function") { const got = await store.getChecked(KEEPSAKE_KEY(userId)); if (got?.ok) saved = got.value; else lost = true; }
        else saved = await store.get(KEEPSAKE_KEY(userId));
      } catch { lost = true; }
    }
    return { ...shaped(saved), ...(lost ? { lost: true } : {}) };
  }
  /** Правка альбома поверх самой свежей записи (`store.update`); `change` возвращает новый альбом или `null`. */
  async function amend(userId, change) {
    if (!usable() || typeof store.update !== "function") return { saved: false, album: shaped(null) };
    let called = false, next = null, before = null;
    let saved = false;
    try { saved = await store.update(KEEPSAKE_KEY(userId), (value) => { called = true; before = shaped(value); next = change(before) ?? null; return next; }) === true; } catch { saved = false; }
    if (!called) return { saved: false, lost: true, album: shaped(null) };
    return next == null ? { saved: true, album: before } : { saved, album: saved ? shaped(next) : before };
  }
  /**
   * Добавить записи: `{ k, key, day, at, … }`. Уже лежащие пропускаются. `known` — альбом, прочитанный только что:
   * если нового в нём нет, в хранилище не ходим вовсе. Возвращает `added` — что легло.
   */
  async function add(userId, entries, known = null) {
    const wanted = (Array.isArray(entries) ? entries : []).filter(item => item && KINDS.includes(item.k));
    if (!wanted.length) return { added: [], saved: true };
    if (known && !known.lost) { const have = new Set(known.items.map(idOf)); if (wanted.every(item => have.has(idOf(item)))) return { added: [], saved: true }; }
    let added = [];
    const done = await amend(userId, (album) => {
      const have = new Set(album.items.map(idOf));
      added = wanted.filter(item => !have.has(idOf(item)) && have.add(idOf(item)));
      return added.length ? { ...album, items: trimmed([...album.items, ...added]) } : null;
    });
    return { added: done.saved ? added : [], saved: done.saved, ...(done.lost ? { lost: true } : {}) };
  }
  /** Подарок: не чаще раза в неделю. `early` — рано, `left` — сколько миллисекунд ждать. */
  async function gift(userId, kind, { day = "" } = {}) {
    if (!GIFTS.includes(kind)) return { ok: false, code: "unknown" };
    const at = now();
    let early = 0, first = false;
    const done = await amend(userId, (album) => {
      early = album.gift > 0 && at - album.gift < GIFT_EVERY_MS ? GIFT_EVERY_MS - (at - album.gift) : 0;
      if (early) return null;
      first = !album.items.some(item => item.k === "gift");
      return { ...album, gift: at, items: trimmed([...album.items, { k: "gift", key: kind, day, at }, ...(first ? [{ k: "first", key: "gift", day, at }] : [])]) };
    });
    if (done.lost || (!early && !done.saved)) return { ok: false, code: "storage" };
    return early ? { ok: true, early: true, left: early, album: done.album } : { ok: true, early: false, first, album: done.album };
  }
  /** Снимок на память: `view` — комната в эту минуту (её собирает сердце, не страница), `line` — её слова. */
  async function snap(userId, view, line, { day = "" } = {}) {
    const at = now();
    let early = false;
    const item = { k: "snap", key: "", day, at, view, line: text(line, 240) };
    const done = await amend(userId, (album) => {
      early = album.snap > 0 && at - album.snap < SNAP_EVERY_MS;
      if (early) return null;
      const snaps = album.items.filter(entry => entry.k === "snap"), drop = snaps.length >= SNAP_MAX ? snaps[0] : null;
      const first = !snaps.length && !album.items.some(entry => entry.k === "first" && entry.key === "snap");
      return { ...album, snap: at, items: trimmed([...album.items.filter(entry => entry !== drop), item, ...(first ? [{ k: "first", key: "snap", day, at }] : [])]) };
    });
    if (done.lost || (!early && !done.saved)) return { ok: false, code: "storage" };
    return early ? { ok: true, early: true, album: done.album } : { ok: true, early: false, item, album: done.album };
  }
  /** Стереть альбом человека («удали всё обо мне»). */
  async function clear(userId) { try { return usable() ? await store.remove(KEEPSAKE_KEY(userId)) : false; } catch { return false; } }

  return { read, add, gift, snap, clear };
}
