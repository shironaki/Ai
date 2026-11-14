/**
 * Анкета «любимое»: человек говорит, что любит, — она помнит и отвечает сама.
 *
 * Не догадки модели и не переписка: только прямые слова «мой любимый цвет —
 * синий» и ответы на её вопросы из анкеты. Вспоминает тоже без модели: «какой
 * мой любимый цвет?», «что я люблю?».
 *
 * У сказанного есть место, как у памяти: названное в личке в группе не звучит.
 *
 * Здесь разбор фраз и хранение. Что и когда сказать — решает сердце.
 */
import { fold } from "./sources.js";

export const TASTE_KEY = (userId) => `heart:tastes:${userId}`;
/** Отдельная приставка: вопрос, на который она ждёт ответа, в копию души не идёт. */
export const TASTE_ASK_KEY = (chatId, userId) => `heart:tasteask:${chatId}:${userId}`;
/** Сколько она ждёт ответа на вопрос анкеты. */
export const TASTE_ASK_TTL_MS = 10 * 60_000;
export const TASTE_CASUAL_TTL_MS = 3 * 60_000;
const MAX_VALUE = 60;

/**
 * Что спрашивается: имя для кода, как называется (так же зовётся тема словаря
 * о её собственном вкусе), по какому слову узнаётся, вопрос на «ты» и на «вы».
 */
export const TASTES = Object.freeze([
  ["color", "любимый цвет", "цвет", "Какой у тебя любимый цвет?", "Какой у вас любимый цвет?"],
  ["food", "любимая еда", "ед[ау]|блюдо", "Что ты любишь есть больше всего?", "Что вы любите есть больше всего?"],
  ["drink", "любимый напиток", "напиток", "А пить — чай, кофе, что-то ещё?", "А пить — чай, кофе, что-то ещё?"],
  ["music", "любимая музыка", "музык[ау]|песн[яю]|групп[ау]|исполнитель|певец|певиц[ау]", "Какую музыку ты слушаешь чаще всего?", "Какую музыку вы слушаете чаще всего?"],
  ["anime", "любимое аниме", "аниме|тайтл", "Какое аниме у тебя любимое?", "Какое аниме у вас любимое?"],
  ["film", "любимый фильм", "фильм|кино|сериал", "Какой фильм или сериал ты готов пересматривать?", "Какой фильм или сериал вы готовы пересматривать?"],
  ["book", "любимая книга", "книг[ау]", "Какая книга у тебя любимая?", "Какая книга у вас любимая?"],
  ["game", "любимая игра", "(?:видео)?игр[ау]", "Во что ты любишь играть?", "Во что вы любите играть?"],
  ["animal", "любимое животное", "животное|зверь", "Какое животное тебе нравится больше всех?", "Какое животное вам нравится больше всех?"],
  ["season", "любимое время года", "время года|сезон", "Какое время года твоё?", "Какое время года ваше?"],
  ["holiday", "любимый праздник", "праздник", "Какой праздник ты ждёшь сильнее всего?", "Какой праздник вы ждёте сильнее всего?"],
  ["flower", "любимые цветы", "цвет(?:ы|ок)", "Какие цветы тебе нравятся?", "Какие цветы вам нравятся?"],
  ["place", "любимое место", "место", "Есть место, куда тебе всегда хочется вернуться?", "Есть место, куда вам всегда хочется вернуться?"],
  ["subject", "любимый предмет", "предмет|урок", "Какой предмет тебе давался легче всего?", "Какой предмет вам давался легче всего?"],
  ["hero", "любимый персонаж", "персонаж|герой|героиня", "Кто твой любимый персонаж — из аниме, книги, игры?", "Кто ваш любимый персонаж — из аниме, книги, игры?"],
  ["sweet", "любимая сладость", "сладость|десерт|сладкое|вкусняшк[ау]", "А из сладкого что любишь?", "А из сладкого что любите?"],
].map(([key, title, words, ty, vy]) => Object.freeze({ key, title, pattern: new RegExp(`^(?:${words})$`, "u"), ask: Object.freeze({ ty, vy }) })));

const BY_KEY = new Map(TASTES.map(item => [item.key, item]));
export const tasteByKey = (key) => BY_KEY.get(key) ?? null;
/** Тема словаря «любимый цвет» → вид вкуса: чтобы к её ответу добавить «а ваш — …». */
export const tasteByTitle = (title) => TASTES.find(item => item.title === title) ?? null;

const kindOf = (noun) => TASTES.find(item => item.pattern.test(noun)) ?? null;
const NOUN = "[а-я]+(?:\\s+года)?";
const ADJ = "(?:сам(?:ый|ая|ое|ые)\\s+)?любим(?:ый|ая|ое|ые)";
const DASH = "(?:\\s*[—–:=-]\\s*|\\s+это\\s+|\\s+)";

/** Значение — одна короткая строка, как сказал человек; без точки в конце. */
export function cleanTaste(value) {
  let text = String(value ?? "").replace(/\s+/gu, " ").trim().replace(/[.!…]+$/u, "").trim();
  // Кавычки снимаются, только когда в них всё значение: «Пицца «Маргарита»» остаётся как есть.
  const inner = text.match(/^[«"„“']([^«»"„“”']+)[»"”“']$/u);
  if (inner) text = inner[1].trim();
  if (!text || text.length > MAX_VALUE || /[\n<>]/u.test(text) || /https?:|t\.me\//iu.test(text)) return "";
  return text;
}

/**
 * Что человек хочет от анкеты:
 *   { set: kind, value }   — «мой любимый цвет — синий»;
 *   { get: kind }          — «какой мой любимый цвет?»;
 *   { list: true }         — «что я люблю?», «моя анкета»;
 *   { start: true }        — «анкета», «спроси меня о любимом»;
 *   { drop: kind }         — «забудь мой любимый цвет»;
 *   { clear: true }        — «забудь анкету».
 * Не про анкету — null. Слова о ней самой («твой любимый цвет») сюда не попадают.
 */
export function parseTaste(text) {
  const raw = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!raw || raw.length > 140) return null;
  const value = fold(raw).replace(/^(?:а|и|ну|кстати)[\s,]+/u, "").replace(/^запомни(?:те)?[\s,:—-]+(?:что\s+)?/u, "");
  const bare = value.replace(/[.!?…]+$/u, "").trim();

  if (/^(?:(?:давай|начн[её]м|продолжим|заполним|устрой|проведи)\s+)?анкет[ауы]?(?:\s+(?:любим(?:ого|ое|ых)|про\s+любимое|о\s+любимом))?$|^спроси(?:те)?\s+(?:меня\s+)?(?:о|про|об)\s+(?:мо(?:ем|их)\s+)?(?:любим(?:ом|ое|ых)|вкус(?:ах|ы))$|^спроси(?:те)?\s+(?:меня\s+)?,?\s*что\s+я\s+люблю$|^узнай\s+меня\s+(?:получше|поближе|лучше)$/u.test(bare)) return { start: true };
  if (/^(?:забудь|сотри|очисти|удали)(?:те)?\s+(?:мою\s+|всю\s+)?анкету$|^забудь(?:те)?\s+(?:вс[её]\s+)?(?:,\s*)?что\s+я\s+люблю$/u.test(bare)) return { clear: true };
  if (/^(?:что|чего)\s+я\s+люблю$|^(?:покажи\s+)?мо[яю]\s+анкет[ау]$|^мо[еи]\s+любим(?:ое|ые)$|^что\s+ты\s+(?:знаешь|помнишь)\s+(?:о|про)\s+мо(?:их|и)\s+(?:вкус(?:ах|ы)|любим(?:ых|ые|ом|ое))$|^что\s+я\s+(?:тебе\s+)?(?:рассказывал[а]?|говорил[а]?)\s+(?:о|про)\s+любим(?:ом|ое)$|^что\s+мне\s+нравится$/u.test(bare)) return { list: true };

  let match = bare.match(new RegExp(`^(?:забудь|сотри|удали)(?:те)?\\s+(?:мо[йюеи]\\s+)?(?:${ADJ}|любим(?:ую|ого))\\s+(${NOUN})$`, "u"));
  if (match) { const kind = kindOf(match[1]); return kind ? { drop: kind.key } : null; }

  // Вопрос о своём: без «мой» или «у меня» это вопрос о ней, и отвечает словарь.
  match = bare.match(new RegExp(`^(?:как(?:ой|ая|ое|ие)|что\\s+за)\\s+(?:у\\s+меня\\s+|мо[йяеи]\\s+)(?:${ADJ}\\s+)(${NOUN})$`, "u"))
    ?? bare.match(new RegExp(`^(?:как(?:ой|ая|ое|ие)\\s+)?${ADJ}\\s+(${NOUN})\\s+у\\s+меня$`, "u"))
    ?? bare.match(new RegExp(`^мо[йяеи]\\s+${ADJ}\\s+(${NOUN})\\s+как(?:ой|ая|ое|ие)$`, "u"))
    ?? bare.match(new RegExp(`^(?:ты\\s+)?(?:помнишь|знаешь)\\s*,?\\s*(?:как(?:ой|ая|ое|ие)\\s+)?(?:у\\s+меня\\s+|мо[йяеи]\\s+)${ADJ}\\s+(${NOUN})$`, "u"));
  if (match) { const kind = kindOf(match[1]); return kind ? { get: kind.key } : null; }

  // Рассказ: значение берётся из исходной строки — с заглавными, как сказал человек.
  const told = new RegExp(`^(?:мо[йяеи]\\s+${ADJ}|${ADJ}\\s+у\\s+меня|у\\s+меня\\s+${ADJ})\\s+(${NOUN})${DASH}(.+)$`, "u");
  const told2 = new RegExp(`^${ADJ}\\s+(${NOUN})\\s+у\\s+меня${DASH}(.+)$`, "u");
  match = bare.match(told2) ?? bare.match(told);
  if (match) {
    const kind = kindOf(match[1].trim());
    if (!kind) return null;
    const tail = match[2].trim();
    if (!tail || /^(?:как(?:ой|ая|ое|ие)|что|кто)(?:\s|$)/u.test(tail) || value.endsWith("?")) return null;
    // Хвост исходной строки той же длины: регистр и «ё» — как у человека.
    const picked = cleanTaste(raw.replace(/[.!…]+$/u, "").trim().slice(-tail.length));
    return picked ? { set: kind.key, value: picked } : null;
  }
  return null;
}

/** Слова-отклики: это не ответ, а реакция на сказанное ею. */
const REACTION = /^(?:круто|прикольно|класс(?:но)?|норм(?:ально)?|тоже|так\s+же|аналогично|красиво|мило|неплохо|соглас(?:ен|на)|вау|ого|понял[а]?|интересно|забавно|супер|здорово|отлично|мне\s+тоже|и\s+мне|и\s+я|я\s+тоже|у\s+меня\s+тоже|как\s+у\s+меня|точно|верно|ну\s+да|бывает|неожиданно|красивый|хороший|неплохой|отличный)(?:[\s,.!)]|$)/u;

/** Ответ на вопрос анкеты: «стоп» — закончить, «не знаю» — пропустить, иначе — само значение. */
export function readAnswer(text) {
  const raw = String(text ?? "").replace(/\s+/gu, " ").trim();
  const value = fold(raw).replace(/[.!…]+$/u, "").trim();
  if (!value) return null;
  if (/^(?:хватит|стоп|потом|позже|не\s+хочу|не\s+сейчас|законч(?:им|и)|вс[её]|достаточно|отмена|отбой|надоело)$/u.test(value)) return { stop: true };
  if (/^(?:не\s+знаю|пропусти(?:ть|м)?|дальше|следующий|нет(?:\s+такого|у)?|никак(?:ой|ая|ое|ие)|ничего|без\s+понятия|хз|затрудняюсь)$/u.test(value)) return { skip: true };
  // Вопрос, служебное слово или длинная речь — не ответ: пусть идёт обычным путём.
  if (raw.endsWith("?") || raw.startsWith("/") || raw.length > MAX_VALUE || value.split(" ").length > 7) return null;
  if (/^(?:спасибо|спс|ок(?:ей)?|ага|угу|понятно|ясно|хорошо|ладно|да|привет|пока|что|чего|а|ну|хм+|ха+|лол|кек|эм+|мм+|в\s+смысле|зачем|почему)$/u.test(value)) return null;
  const reaction = value.match(REACTION);
  if (reaction && reaction[0].trim().length === value.length) return null;
  const picked = cleanTaste(raw);
  return picked ? { value: picked } : null;
}

/** Ответ «к слову», на её встречное «а ваш?»: только короткое и только похожее на ответ. */
export function readCasual(text) {
  const answer = readAnswer(text);
  if (!answer?.value) return null;
  const value = fold(answer.value);
  if (value.split(" ").length > 3 || /[=+*/\\<>@#:;()]/u.test(value) || REACTION.test(value)) return null;
  return answer;
}

export function createTastes({ store, now = () => Date.now() } = {}) {
  if (!store) throw new TypeError("createTastes needs store");

  async function read(userId) {
    const saved = await store.get(TASTE_KEY(userId)).catch(() => null);
    const items = saved?.items && typeof saved.items === "object" ? saved.items : {};
    const out = {};
    for (const { key } of TASTES) {
      const value = cleanTaste(items[key]?.v);
      if (value) out[key] = { v: value, shared: items[key].shared === true };
    }
    return out;
  }

  /** Что видно в этом месте: в группе — только названное при всех. */
  async function list(userId, { inGroup = false } = {}) {
    const items = await read(userId);
    return TASTES.filter(item => items[item.key] && (!inGroup || items[item.key].shared)).map(item => ({ key: item.key, title: item.title, value: items[item.key].v }));
  }

  async function get(userId, key, place = {}) {
    return (await list(userId, place)).find(item => item.key === key)?.value ?? "";
  }

  async function set(userId, key, value, { inGroup = false } = {}) {
    const clean = cleanTaste(value);
    if (!BY_KEY.has(key) || !clean) return { ok: false, code: "bad_value" };
    const items = await read(userId);
    const before = items[key]?.v ?? "";
    // Сказанное при всех остаётся общим, даже если потом повторено в личке.
    items[key] = { v: clean, shared: inGroup || (items[key]?.shared === true && before.toLowerCase() === clean.toLowerCase()) };
    const kept = await store.set(TASTE_KEY(userId), { items, at: now() }).then(result => result !== false).catch(() => false);
    return kept ? { ok: true, value: clean, before } : { ok: false, code: "storage_unavailable" };
  }

  async function drop(userId, key) {
    const items = await read(userId);
    if (!items[key]) return { ok: true, had: false };
    delete items[key];
    const kept = await store.set(TASTE_KEY(userId), { items, at: now() }).then(result => result !== false).catch(() => false);
    return kept ? { ok: true, had: true } : { ok: false, code: "storage_unavailable" };
  }

  async function clear(userId) {
    const had = Object.keys(await read(userId)).length;
    const kept = await store.set(TASTE_KEY(userId), { items: {}, at: now() }).then(result => result !== false).catch(() => false);
    return kept ? { ok: true, had } : { ok: false, code: "storage_unavailable" };
  }

  /** Следующий вопрос анкеты: первое, чего она не знает и что ещё не пропущено. */
  async function next(userId, { skipped = [] } = {}) {
    const items = await read(userId);
    return TASTES.find(item => !items[item.key] && !skipped.includes(item.key)) ?? null;
  }

  // ── вопрос, на который она ждёт ответа ──────────────────────────────────
  async function asking(chatId, userId) {
    const saved = await store.get(TASTE_ASK_KEY(chatId, userId)).catch(() => null);
    if (!saved?.kind || !BY_KEY.has(saved.kind)) return null;
    // Встречный вопрос «а ваш?» ждёт недолго: через три минуты слово уже о другом.
    if (now() - Number(saved.at) > (saved.casual ? TASTE_CASUAL_TTL_MS : TASTE_ASK_TTL_MS)) return null;
    return { kind: saved.kind, casual: saved.casual === true, skipped: Array.isArray(saved.skipped) ? saved.skipped.filter(key => BY_KEY.has(key)) : [] };
  }
  const ask = (chatId, userId, kind, { skipped = [], casual = false } = {}) => store.set(TASTE_ASK_KEY(chatId, userId), { kind, skipped, ...(casual ? { casual: true } : {}), at: now() }).then(result => result !== false).catch(() => false);
  const rest = (chatId, userId) => store.set(TASTE_ASK_KEY(chatId, userId), { kind: "", at: 0 }).then(result => result !== false).catch(() => false);

  return { list, get, set, drop, clear, next, asking, ask, rest };
}
