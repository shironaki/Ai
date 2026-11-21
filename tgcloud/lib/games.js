/**
 * Игры: судья — код, модель в них не участвует.
 *
 * Модель не умеет честно играть: она забывает загаданное число, засчитывает
 * несуществующий город и «угадывает» слово, которого не загадывала. Поэтому
 * загаданное лежит в базе, ход проверяет правило, а слова Аи — готовые фразы.
 * Игра идёт и тогда, когда думать нечем: лимит модели на неё не влияет.
 *
 * Это игры-разговоры: без ставок и наград — они дело сестры. Игры вдвоём и
 * компанией, где в игру входят кнопкой, живут в `party.js`.
 *
 * Состояние — одна запись на чат. Новая игра заменяет прежнюю; брошенная
 * забывается через два часа.
 */
import { CITIES } from "./data/cities.js";
import { FIVE_LETTER, LONG_WORDS, RIDDLES, MOVIES } from "./data/games.js";
import { fold, cityKey } from "./sources.js";

export const GAME_KEY = (chatId) => `heart:game:${chatId}`;
export const GAME_TTL_MS = 2 * 3_600_000;
/** «Ещё» после законченной игры — в пределах десяти минут. */
const AGAIN_MS = 10 * 60_000;

/** Что есть: имя для кода и слова для человека. */
export const GAMES = Object.freeze([
  ["cities", "города", "«сыграем в города»"],
  ["words", "слова", "«сыграем в слова»"],
  ["number", "угадай число", "«загадай число»"],
  ["guess", "я угадываю число", "«угадай моё число»"],
  ["bulls", "быки и коровы", "«быки и коровы»"],
  ["hangman", "виселица", "«виселица»"],
  ["five", "5 букв", "«5 букв»"],
  ["riddle", "загадки", "«загадай загадку»"],
  ["anagram", "анаграммы", "«анаграмма»"],
  ["movie", "фильм по эмодзи", "«фильм по эмодзи»"],
  ["rps", "камень-ножницы-бумага", "«камень, ножницы, бумага»"],
]);
const TITLE = Object.fromEntries(GAMES.map(([kind, title]) => [kind, title]));

const LEAD = "(?:(?:а|ну)\\s+)?(?:(?:давай(?:те)?|го|хочу|может|пошли|предлагаю)\\s+)?(?:(?:сыграем|поиграем|сыграть|поиграть|играем|играть|сыграй|поиграй|игра|игру)\\s+)?(?:со\\s+мной\\s+)?(?:в\\s+)?";
/** [игра, как её называют, можно ли одним словом без «сыграем в»]. */
const NAMED = [
  ["cities", "города", true],
  ["words", "слова", false],
  ["number", "угадай\\s+число|угадайк[ау]|угадать\\s+число", true],
  ["bulls", "быки\\s+и\\s+коровы|быков\\s+и\\s+коров|быки\\s+коровы", true],
  ["hangman", "виселиц[ауы]", true],
  ["five", "(?:5|пять)\\s+букв|вордли|wordle", true],
  ["riddle", "загадк[иу]|загадка", true],
  ["anagram", "анаграмм[ауы]", true],
  ["movie", "(?:угадай\\s+)?(?:фильм|кино)\\s+по\\s+(?:эмодзи|смайлам|смайликам)|эмодзи[\\s-]кино|угадай\\s+фильм", true],
  ["rps", "камень[\\s,-]+ножницы[\\s,-]+бумаг[ау]|кнб|цу[\\s-]?е[\\s-]?фа", true],
].map(([kind, body, bare]) => [kind, new RegExp(`^(${LEAD})(?:${body})$`, "u"), bare]);

const MENU = /^(?:(?:а|ну)\s+)?(?:давай(?:те)?\s+)?(?:сыграем|поиграем|поиграй\s+со\s+мной|сыграй\s+со\s+мной|устроим\s+игру|поиграть|играть|игры|твои\s+игры|список\s+игр|во\s+что\s+(?:можно\s+|мы\s+можем\s+|с\s+тобой\s+можно\s+|ты\s+умеешь\s+)?(?:поиграть|сыграть|поиграем|сыграем|играть)|(?:какие|что\s+за)\s+(?:у\s+тебя\s+)?(?:есть\s+)?игры(?:\s+(?:есть|у\s+тебя))*|хочу\s+(?:играть|поиграть))$/u;
const SISTER = /^игры\s+(?:у\s+)?(?:юи|сестры)$|^(?:дуэль|турнир)$/u;
const COUNT_WORD = Object.freeze({ один: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6 });

const sure = (intent, arg = null) => ({ intent, confidence: "sure", arg });
const maybe = (intent, question) => ({ intent, confidence: "maybe", question });

/**
 * Просьба об игре — или null. `value` — фраза после `normalize` (нижний
 * регистр, без хвостовой пунктуации), `soft` — та же фраза с исходным
 * регистром: из неё берутся варианты для «выбери».
 */
export function parseGame(value, soft = value) {
  if (!value) return null;
  if (MENU.test(value)) return sure("play", null);
  if (SISTER.test(value)) return sure("sister_play");

  // ── мгновенное: кубик, монетка, число, выбор, шар ──────────────────────
  let match = value.match(/^(?:(?:кинь|брось|бросай|кидай|подбрось|кидаю|бросаю)(?:те)?\s+)?(?:(\d{1,2}|один|одну|два|две|три|четыре|пять|шесть)\s+)?(?:кубик(?:а|и|ов)?|кост[ьи]|костей|дайс(?:ы|а|ов)?)$/u);
  if (match) return sure("roll", { kind: "dice", count: COUNT_WORD[match[1]] ?? (Number(match[1]) || 1), sides: 6 });
  match = value.match(/^(?:(?:кинь|брось)\s+)?(\d{0,2})[dд](\d{1,4})$/u);
  if (match) return sure("roll", { kind: "dice", count: Number(match[1]) || 1, sides: Number(match[2]) });
  if (/^(?:(?:подбрось|кинь|брось|подкинь)(?:те)?\s+)?монетк?[ау]$|^орел\s+или\s+решка$/u.test(value)) return sure("roll", { kind: "coin" });

  match = value.match(/^(?:загадай|задумай)(?:те)?\s+(?:мне\s+)?число(?:\s+от\s+(\d{1,7})\s+до\s+(\d{1,7}))?$/u);
  if (match) return sure("play", { game: "number", from: match[1] ? Number(match[1]) : 1, to: match[2] ? Number(match[2]) : 100 });
  if (/^(?:угадай|отгадай)(?:те)?\s+мое\s+число$|^я\s+(?:загадал[аи]?|задумал[аи]?)\s+число$/u.test(value)) return sure("play", { game: "guess" });
  match = value.match(/^(?:(?:назови|выбери|дай|скажи)\s+)?(?:случайное\s+|любое\s+|рандомное\s+)?число\s+от\s+(-?\d{1,9})\s+до\s+(-?\d{1,9})$/u);
  if (match) return sure("roll", { kind: "range", from: Number(match[1]), to: Number(match[2]) });

  match = String(soft).match(/^(?:выбери|выбирай|реши|выбор)(?:\s+за\s+меня)?\s*[:,—-]?\s+(.+)$/iu)
    ?? String(soft).match(/^(?:что|кого|куда|какой|какую|какое)\s+(?:мне\s+)?(?:выбрать|лучше|взять|надеть|посмотреть|съесть|заказать)\s*[:,—-]\s*(.+)$/iu);
  if (match) {
    const options = match[1].split(/\s+или\s+|\s*[,;/]\s*/iu).map(item => item.replace(/^(?:или|либо)\s+/iu, "").trim()).filter(Boolean);
    if (options.length >= 2 && options.length <= 12 && options.every(item => item.length <= 60)) return sure("roll", { kind: "choose", options });
  }
  if (/^(?:выбери|выбирай|реши)\s+за\s+меня$/u.test(value)) return maybe("roll", "Из чего выбирать? Например: «выбери: чай или кофе».");

  match = String(soft).match(/^(?:шар\s+(?:судьбы|предсказаний)|магический\s+шар)\s*[,:—-]?\s+(.{3,200})$/iu) ?? String(soft).match(/^шар\s*[,:—-]\s*(.{3,200})$/iu);
  if (match) return sure("roll", { kind: "ball", question: match[1].trim() });
  if (/^(?:шар\s+(?:судьбы|предсказаний)|магический\s+шар|спроси\s+шар)$/u.test(value)) return maybe("roll", "Спросите шар о чём-нибудь: «шар судьбы, стоит ли идти?»");

  // ── игры по имени ─────────────────────────────────────────────────────
  if (/^(?:загадай(?:те)?|задай(?:те)?|дай(?:те)?|хочу)\s+(?:мне\s+)?(?:еще\s+)?(?:одну\s+)?загадку$|^(?:еще|другую|следующую)\s+(?:одну\s+)?загадку$/u.test(value)) return sure("play", { game: "riddle" });
  if (/^(?:загадай|дай|задай)(?:те)?\s+(?:мне\s+)?(?:еще\s+)?(?:анаграмму|слово)$/u.test(value)) return sure("play", { game: /слово$/u.test(value) ? "hangman" : "anagram" });
  if (/^(?:загадай|дай|задай)(?:те)?\s+(?:мне\s+)?(?:еще\s+)?(?:фильм|кино)$/u.test(value)) return sure("play", { game: "movie" });
  for (const [kind, pattern, bare] of NAMED) {
    const found = value.match(pattern);
    if (found && (bare || found[1].trim())) return sure("play", { game: kind });
  }
  return null;
}

// ── общие мелочи ──────────────────────────────────────────────────────────
const f = (formal, polite, close) => (formal === false ? close : polite);
const letters = (text) => fold(text).replace(/[^а-я]/gu, "");
const first = (text) => letters(text)[0] ?? "";
/** Последняя буква, на которую можно начать слово: ь, ъ, ы и й пропускаются. */
export function tail(text) {
  const value = letters(text);
  for (let i = value.length - 1; i >= 0; i--) if (!"ьъый".includes(value[i])) return value[i];
  return "";
}
const upper = (letter) => String(letter).toUpperCase();
const plural = (n, one, few, many) => {
  const d = Math.abs(n) % 10, h = Math.abs(n) % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};
const capital = (text) => String(text).replace(/(^|[\s-])([а-яё])/gu, (_, gap, ch) => `${gap}${ch.toUpperCase()}`);
const clean = (text) => String(text ?? "").trim().replace(/^[«"'(]+|[»"').!?…,;:]+$/gu, "").trim();

/** Слова разговора, которые не бывают ходом: «привет» — не город и не отгадка. */
const CHAT_WORDS = new Set((
  "привет здравствуй здравствуйте пока да нет ага угу ок окей ладно хорошо спасибо пожалуйста давай давайте что как почему зачем когда где кто куда "
  + "ну вот так это тоже еще уже потом сейчас может наверное конечно точно правда неправда хм эм ой ух ого вау лол кек ахах хаха "
  + "понятно ясно круто класс супер отлично молодец умница жаль блин черт стой подожди погоди минуту секунду думаю дальше ход твой ваш мой я ты вы мы "
  + "пойду спать утро вечер ночь день норм нормально плохо зачем ничего никак некогда занят занята"
).split(/\s+/u));
const STARTERS = /^(?:как|что|почему|зачем|кто|где|когда|куда|откуда|сколько|а\s+ты|ты|вы|ну\s+и|расскажи|скажи|объясни|покажи|напомни|запомни|забудь)(?=\s|$)/u;
const chatty = (text) => {
  const value = fold(text).replace(/[.!?…,;:]+$/u, "");
  const words = value.split(/[\s,]+/u).filter(Boolean);
  return (words.length > 0 && words.every(word => CHAT_WORDS.has(word))) || STARTERS.test(value) || /\?\s*$/u.test(String(text));
};

const STOP = /^(?:стоп|хватит|сдаюсь|сдаемся|закончим|закончить|закончи(?:ть)?\s+игру|законч(?:им|ить)\s+игру|не\s+хочу(?:\s+(?:больше\s+)?играть)?|больше\s+не\s+играю|надоело|выход|конец\s+игры|стоп\s+игра|отбой|я\s+пас|пас|выйти\s+из\s+игры)$/u;
const HINT = /^(?:подсказк[ауи]|подскажи(?:те)?|намекни(?:те)?|намек|дай(?:те)?\s+подсказку|помоги(?:те)?|не\s+знаю|без\s+понятия|хз|затрудняюсь)$/u;
const WHAT = /^(?:во\s+что\s+(?:мы\s+)?играем|что\s+за\s+игра|повтори(?:те)?|напомни\s+(?:условие|правила|задание)|какая\s+буква|на\s+какую\s+букву|что\s+там|условие|правила|поле|покажи\s+поле)$/u;
const AGAIN = /^(?:еще|еще\s+раз|еще\s+одну|еще\s+один|еще\s+разок|давай\s+еще|снова|заново|повторим|реванш|следующ(?:ую|ий|ая|ее)|дальше|еще\s+давай|го\s+еще)$/u;

const BALL = Object.freeze([
  "Бесспорно.", "Предрешено.", "Никаких сомнений.", "Определённо да.", "Можно быть уверенным.",
  "Мне кажется — да.", "Вероятнее всего.", "Хорошие перспективы.", "Знаки говорят — да.", "Да.",
  "Пока не ясно, попробуйте снова.", "Спросите позже.", "Лучше не рассказывать.", "Сейчас нельзя предсказать.", "Сосредоточьтесь и спросите опять.",
  "Даже не думайте.", "Мой ответ — нет.", "По моим данным — нет.", "Перспективы не очень хорошие.", "Весьма сомнительно.",
]);
const CHOICE = Object.freeze(["Выбираю: %s.", "Пусть будет %s.", "Моё слово — %s.", "Я бы взяла %s."]);

const OWN_WORDS = Object.freeze([...new Set([...FIVE_LETTER, ...LONG_WORDS])]);
const OWN_WORD_SET = new Set(OWN_WORDS.map(fold));
const CITY_NAME = new Map(CITIES.map(name => [cityKey(name), name]));
const HANG_WORDS = LONG_WORDS.filter(word => [...word].length >= 6 && [...word].length <= 10);
const ANAGRAM_WORDS = OWN_WORDS.filter(word => [...word].length >= 5 && [...word].length <= 8);
const RPS = Object.freeze(["камень", "ножницы", "бумага"]);
const RPS_BEATS = Object.freeze({ камень: "ножницы", ножницы: "бумага", бумага: "камень" });
const RPS_WHY = Object.freeze({ камень: "камень тупит ножницы", ножницы: "ножницы режут бумагу", бумага: "бумага накрывает камень" });
const ORDINAL = ["Первая", "Вторая", "Третья", "Четвёртая", "Пятая", "Шестая", "Седьмая", "Восьмая", "Девятая", "Десятая"];

export function createGames({ store = null, sources = null, random = Math.random, now = () => Date.now() } = {}) {
  const memory = new Map();
  const usable = () => Boolean(store?.available);
  const rnd = (n) => Math.min(n - 1, Math.max(0, Math.floor(random() * n)));
  const pick = (list) => list[rnd(list.length)];

  async function read(chatId) {
    let saved = null;
    if (usable()) { try { saved = await store.get(GAME_KEY(chatId)); } catch { saved = null; } }
    else saved = memory.get(String(chatId)) ?? null;
    const record = saved && typeof saved === "object" ? saved : {};
    const fresh = record.active && now() - Number(record.at) < GAME_TTL_MS;
    return { active: fresh ? record.active : null, at: Number(record.at) || 0, seen: record.seen && typeof record.seen === "object" ? record.seen : {}, last: record.last ?? null };
  }
  async function write(chatId, record) {
    const value = { ...record, at: now() };
    if (usable()) { try { await store.set(GAME_KEY(chatId), value); } catch { /* игра останется в памяти обращения */ } }
    else { if (memory.size > 256) memory.clear(); memory.set(String(chatId), value); }
  }

  /** Взять то, чего в этом чате ещё не было; всё было — начать круг заново. */
  function unseen(record, kind, size) {
    let used = Array.isArray(record.seen[kind]) ? record.seen[kind].filter(i => Number.isInteger(i) && i >= 0 && i < size) : [];
    if (used.length >= size) used = [];
    const free = [];
    for (let i = 0; i < size; i++) if (!used.includes(i)) free.push(i);
    const index = pick(free);
    record.seen = { ...record.seen, [kind]: [...used, index].slice(-Math.max(1, size - 1)) };
    return index;
  }

  // ── цепочка: города и слова ─────────────────────────────────────────────
  const CHAIN = {
    cities: {
      own: CITIES, find: (text) => CITY_NAME.get(cityKey(text)) ?? null, key: cityKey,
      shape: (text) => /^[а-яё][а-яё \-–.]{1,40}$/iu.test(text) && text.split(/\s+/u).length <= 4,
      check: async (text) => { const got = sources ? await sources.cityExists(text) : null; return got == null ? null : got.ok ? got.name : false; },
      thing: "город", unknown: (text) => `Города «${capital(text)}» я не знаю`, was: "уже был",
      rules: "называем города по очереди, каждый следующий — на последнюю букву предыдущего (ь, ъ, ы и й пропускаем)",
    },
    words: {
      own: OWN_WORDS, find: (text) => (OWN_WORD_SET.has(fold(text)) ? fold(text) : null), key: fold,
      shape: (text) => /^[а-яё]{2,30}$/iu.test(text),
      check: async (text) => { const got = sources ? await sources.wordExists(text) : null; return got == null ? null : got ? fold(text) : false; },
      thing: "слово", unknown: (text) => `Слова «${fold(text)}» я в словаре не нашла`, was: "уже было",
      rules: "называем существительные по очереди, каждое следующее — на последнюю букву предыдущего (ь, ъ, ы и й пропускаем)",
    },
  };
  const chainNext = (kind, letter, used) => CHAIN[kind].own.filter(item => first(item) === letter && !used.includes(CHAIN[kind].key(item)));
  const show = (kind, item) => (kind === "cities" ? item : `«${item}»`);

  function chainStart(kind, formal) {
    const rules = CHAIN[kind];
    const mine = pick(rules.own);
    const state = { kind, used: [rules.key(mine)], last: mine, letter: tail(mine), turns: 0 };
    return { state, text: `Играем в ${TITLE[kind]}: ${rules.rules}. Начну: ${show(kind, mine)}. ${f(formal, "Вам", "Тебе")} на «${upper(state.letter)}».` };
  }

  async function chainMove(state, input, { formal }) {
    const rules = CHAIN[state.kind];
    const raw = clean(input);
    if (!rules.shape(raw)) return null;
    const need = state.letter;
    const known = rules.find(raw);
    let name = known;
    let note = "";
    if (known) {
      if (first(known) !== need) return { text: `Нужен ${rules.thing} на «${upper(need)}», а ${show(state.kind, known)} — на «${upper(first(known))}».` };
    } else {
      // Не из её списка и не на ту букву — это, скорее всего, разговор, а не ход.
      if (chatty(raw) || first(raw) !== need) return null;
      const checked = await rules.check(raw);
      if (checked === false) return { text: `${rules.unknown(raw)}. ${f(formal, "Назовите", "Назови")} другой на «${upper(need)}» — или «сдаюсь».` };
      if (checked == null) { name = state.kind === "cities" ? capital(fold(raw)) : fold(raw); note = `Проверить ${show(state.kind, name)} сейчас не могу — верю на слово. `; }
      else name = checked;
      if (first(name) !== need) return { text: `Нужен ${rules.thing} на «${upper(need)}».` };
    }
    const key = rules.key(name);
    if (state.used.includes(key)) return { text: `${capital(show(state.kind, name))} ${rules.was}. Другой вариант на «${upper(need)}»?` };
    const used = [...state.used, key];
    const letter = tail(name);
    const options = chainNext(state.kind, letter, used);
    const turns = state.turns + 1;
    if (!options.length) {
      return { end: "won", text: `${note}На «${upper(letter)}» у меня больше ничего нет — сдаюсь. Победа ${f(formal, "ваша", "твоя")}: ${turns} ${plural(turns, "ход", "хода", "ходов")}.` };
    }
    const mine = pick(options);
    return {
      state: { ...state, used: [...used, rules.key(mine)], last: mine, letter: tail(mine), turns },
      text: `${note}${capital(show(state.kind, mine))}. ${f(formal, "Вам", "Тебе")} на «${upper(tail(mine))}».`,
    };
  }

  function chainHint(state) {
    const options = chainNext(state.kind, state.letter, state.used);
    if (!options.length) return { text: `На «${upper(state.letter)}» я и сама ничего не помню. Можно сказать «сдаюсь» — будет ничья.` };
    const word = pick(options);
    return { text: `Подсказка: есть ${CHAIN[state.kind].thing} на «${[...word].slice(0, 2).join("")}…», букв в нём — ${letters(word).length}.` };
  }

  // ── остальные игры ──────────────────────────────────────────────────────
  const board = (state) => [...state.word].map(ch => (state.open.includes(fold(ch)) ? ch : "_")).join(" ");
  const hangLine = (state) => `${board(state)}\nОшибок: ${state.fails} из 7${state.wrong ? ` (${[...state.wrong].join(", ")})` : ""}.`;

  function colour(secret, guess) {
    const a = [...fold(secret)], b = [...fold(guess)];
    const marks = new Array(5).fill("⬜");
    const left = {};
    a.forEach((ch, i) => { if (b[i] === ch) marks[i] = "🟩"; else left[ch] = (left[ch] ?? 0) + 1; });
    b.forEach((ch, i) => { if (marks[i] !== "🟩" && left[ch] > 0) { marks[i] = "🟨"; left[ch]--; } });
    return marks.join("");
  }
  const fiveBoard = (state) => state.rows.map(row => `${colour(state.secret, row)}  ${row.toUpperCase()}`).join("\n");

  function scramble(word) {
    const chars = [...word];
    for (let attempt = 0; attempt < 8; attempt++) {
      const mixed = [...chars];
      for (let i = mixed.length - 1; i > 0; i--) { const j = rnd(i + 1); [mixed[i], mixed[j]] = [mixed[j], mixed[i]]; }
      if (mixed.join("") !== word) return mixed.join("");
    }
    return [...chars.slice(1), chars[0]].join("");
  }
  const spaced = (word) => [...word.toUpperCase()].join(" ");
  const sameLetters = (a, b) => [...fold(a)].sort().join("") === [...fold(b)].sort().join("");
  const answerOf = (state) => (state.kind === "riddle" ? RIDDLES[state.index] : MOVIES[state.index]);
  const norm = (text) => fold(text).replace(/[^а-яa-z0-9\s]/gu, " ").replace(/\s+/gu, " ").trim();

  const ENGINE = {
    cities: { start: (o) => chainStart("cities", o.formal), move: chainMove, hint: chainHint,
      prompt: (s) => `Играем в города. Последний — ${s.last}; нужен город на «${upper(s.letter)}».`,
      reveal: (s) => { const options = chainNext("cities", s.letter, s.used); return `Сыграно ходов: ${s.turns}.${options.length ? ` На «${upper(s.letter)}» был, например, ${pick(options)}.` : ""}`; } },
    words: { start: (o) => chainStart("words", o.formal), move: chainMove, hint: chainHint,
      prompt: (s) => `Играем в слова. Последнее — «${s.last}»; нужно слово на «${upper(s.letter)}».`,
      reveal: (s) => { const options = chainNext("words", s.letter, s.used); return `Сыграно ходов: ${s.turns}.${options.length ? ` На «${upper(s.letter)}» было, например, «${pick(options)}».` : ""}`; } },

    number: {
      start: ({ formal, from = 1, to = 100 }) => {
        let low = Math.max(0, Math.min(from, to)), high = Math.min(1_000_000, Math.max(from, to));
        if (high - low < 1) { low = 1; high = 100; }
        const secret = low + rnd(high - low + 1);
        return { state: { kind: "number", secret, low, high, lo: low, hi: high, tries: 0 }, text: `Загадала число от ${low} до ${high}. ${f(formal, "Угадывайте", "Угадывай")} — скажу, больше оно или меньше.` };
      },
      move: (s, input) => {
        const found = clean(input).match(/^(?:это\s+|может\s+|наверное\s+|пусть\s+)?(\d{1,7})$/u);
        if (!found) return null;
        const n = Number(found[1]);
        if (n < s.low || n > s.high) return { text: `Моё число — от ${s.low} до ${s.high}.` };
        const tries = s.tries + 1;
        if (n === s.secret) return { end: "won", text: `Да, это ${s.secret}! Угадано с ${tries}-й попытки.` };
        const more = s.secret > n;
        return { state: { ...s, tries, lo: more ? Math.max(s.lo, n + 1) : s.lo, hi: more ? s.hi : Math.min(s.hi, n - 1) }, text: more ? `Больше, чем ${n}.` : `Меньше, чем ${n}.` };
      },
      hint: (s) => ({ text: `Оно между ${s.lo} и ${s.hi}${s.hi - s.lo > 3 ? ` и ${s.secret % 2 ? "нечётное" : "чётное"}` : ""}.` }),
      prompt: (s) => `Я загадала число от ${s.low} до ${s.high}; попыток было: ${s.tries}.`,
      reveal: (s) => `Это было ${s.secret}.`,
    },

    guess: {
      start: ({ formal }) => ({ state: { kind: "guess", low: 1, high: 100, ask: 50, tries: 1 }, text: `${f(formal, "Загадайте", "Загадай")} число от 1 до 100 — угадаю не больше чем за семь вопросов. ${f(formal, "Отвечайте", "Отвечай")} «больше», «меньше» или «да».\nЭто 50?` }),
      move: (s, input, { formal }) => {
        const value = fold(clean(input));
        if (/^(?:да|угадала|верно|правильно|это\s+оно|точно|в\s+точку|\+)$/u.test(value)) return { end: "done", text: `Угадала с ${s.tries}-го вопроса: ${s.ask}.` };
        const more = /^(?:больше|выше|мало|маловато|>)$/u.test(value);
        const less = /^(?:меньше|ниже|много|многовато|<)$/u.test(value);
        if (!more && !less) return null;
        const low = more ? s.ask + 1 : s.low, high = less ? s.ask - 1 : s.high;
        if (low > high) return { end: "void", text: `Так не сходится: чисел между ними не осталось. Кто-то перепутал «больше» и «меньше» — и это не я. Заново — «угадай моё число».` };
        const ask = Math.floor((low + high) / 2);
        if (low === high) return { state: { ...s, low, high, ask, tries: s.tries + 1 }, text: `Тогда это ${ask}. Верно?` };
        return { state: { ...s, low, high, ask, tries: s.tries + 1 }, text: `Это ${ask}?` };
      },
      hint: (s, { formal }) => ({ text: `Подсказывать тут ${f(formal, "вам", "тебе")}: «больше», «меньше» или «да». Мой вопрос: это ${s.ask}?` }),
      prompt: (s) => `Я угадываю число. Мой вопрос: это ${s.ask}? Ответ — «больше», «меньше» или «да».`,
      reveal: () => "Число осталось тайной.",
    },

    bulls: {
      start: ({ formal }) => {
        // Первая цифра — не ноль; остальные — любые из оставшихся.
        const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
        let secret = digits.splice(rnd(digits.length), 1)[0];
        digits.unshift("0");
        while (secret.length < 4) secret += digits.splice(rnd(digits.length), 1)[0];
        return { state: { kind: "bulls", secret, tries: 0, hints: 0 }, text: `Быки и коровы: я загадала число из четырёх разных цифр. ${f(formal, "Назовите", "Назови")} своё — отвечу: бык — цифра на своём месте, корова — цифра есть, но не там. Попыток — двенадцать.` };
      },
      move: (s, input) => {
        const guess = clean(input).replace(/\s+/gu, "");
        if (!/^\d{4}$/u.test(guess)) return null;
        if (new Set(guess).size < 4) return { text: "Цифры не должны повторяться. Попытка не засчитана." };
        const tries = s.tries + 1;
        let bulls = 0, cows = 0;
        [...guess].forEach((ch, i) => { if (s.secret[i] === ch) bulls++; else if (s.secret.includes(ch)) cows++; });
        if (bulls === 4) return { end: "won", text: `Четыре быка — это ${s.secret}! Попыток: ${tries}.` };
        if (tries >= 12) return { end: "lost", text: `${bulls} ${plural(bulls, "бык", "быка", "быков")}, ${cows} ${plural(cows, "корова", "коровы", "коров")}. Двенадцать попыток вышли: это было ${s.secret}.` };
        return { state: { ...s, tries }, text: `${guess}: ${bulls} ${plural(bulls, "бык", "быка", "быков")}, ${cows} ${plural(cows, "корова", "коровы", "коров")}. Попытка ${tries} из 12.` };
      },
      hint: (s) => (s.hints >= 2 ? { text: "Две подсказки уже были — дальше сами." } : { state: { ...s, hints: s.hints + 1 }, text: `${ORDINAL[s.hints]} цифра — ${s.secret[s.hints]}.` }),
      prompt: (s) => `Быки и коровы: число из четырёх разных цифр, попытка ${s.tries + 1} из 12.`,
      reveal: (s) => `Это было ${s.secret}.`,
    },

    hangman: {
      start: ({ formal, record }) => {
        const word = HANG_WORDS[unseen(record, "hangman", HANG_WORDS.length)];
        const state = { kind: "hangman", word, open: "", wrong: "", fails: 0, hints: 0 };
        return { state, text: `Виселица: слово из ${[...word].length} букв. ${f(formal, "Называйте", "Называй")} буквы по одной — или всё слово сразу. Семь ошибок — и я победила.\n\n${board(state)}` };
      },
      move: (s, input) => {
        const value = fold(clean(input));
        const target = fold(s.word);
        if (/^[а-я]$/u.test(value)) {
          if (s.open.includes(value) || s.wrong.includes(value)) return { text: `Буква «${value}» уже была.\n\n${hangLine(s)}` };
          if (target.includes(value)) {
            const next = { ...s, open: s.open + value };
            if ([...target].every(ch => next.open.includes(ch))) return { end: "won", text: `Есть «${value}» — и это всё слово: «${s.word}»! Ошибок: ${s.fails}.` };
            return { state: next, text: `Есть «${value}».\n\n${hangLine(next)}` };
          }
          const next = { ...s, wrong: s.wrong + value, fails: s.fails + 1 };
          if (next.fails >= 7) return { end: "lost", text: `Буквы «${value}» нет, и это седьмая ошибка. Слово было «${s.word}».` };
          return { state: next, text: `Буквы «${value}» нет.\n\n${hangLine(next)}` };
        }
        if (!/^[а-я]+$/u.test(value) || [...value].length !== [...target].length) return null;
        if (value === target) return { end: "won", text: `Да, «${s.word}»! Ошибок: ${s.fails}.` };
        const next = { ...s, fails: s.fails + 1 };
        if (next.fails >= 7) return { end: "lost", text: `Нет, не «${value}», и это седьмая ошибка. Слово было «${s.word}».` };
        return { state: next, text: `Нет, не «${value}».\n\n${hangLine(next)}` };
      },
      hint: (s) => {
        if (s.hints >= 2) return { text: `Две подсказки уже были.\n\n${hangLine(s)}` };
        const hidden = [...new Set([...fold(s.word)])].filter(ch => !s.open.includes(ch));
        if (hidden.length <= 1) return { text: `Осталась одна буква — подсказывать нечего.\n\n${hangLine(s)}` };
        const next = { ...s, open: s.open + pick(hidden), hints: s.hints + 1 };
        return { state: next, text: `Открыла одну букву.\n\n${hangLine(next)}` };
      },
      prompt: (s) => `Виселица.\n\n${hangLine(s)}`,
      reveal: (s) => `Слово было «${s.word}».`,
    },

    five: {
      start: ({ formal, record }) => {
        const secret = FIVE_LETTER[unseen(record, "five", FIVE_LETTER.length)];
        return { state: { kind: "five", secret, rows: [], hints: 0 }, text: `«5 букв»: я загадала существительное из пяти букв, попыток — шесть. ${f(formal, "Назовите", "Назови")} слово: 🟩 — буква на месте, 🟨 — есть, но не там, ⬜ — такой буквы нет.` };
      },
      move: async (s, input) => {
        const value = fold(clean(input));
        if (!/^[а-я]{5}$/u.test(value) || chatty(value)) return null;
        // Своего списка мало для чужих слов: незнакомое проверяется по словарю.
        // Словарь молчит — попытка засчитывается: сомнение в пользу игрока.
        if (!OWN_WORD_SET.has(value) && sources && await sources.wordExists(value) === false) {
          return { text: `Слова «${value}» я не знаю — попытка не засчитана.` };
        }
        const next = { ...s, rows: [...s.rows, value] };
        if (value === fold(s.secret)) return { end: "won", text: `${fiveBoard(next)}\n\nДа, «${s.secret}»! Попыток: ${next.rows.length} из 6.` };
        if (next.rows.length >= 6) return { end: "lost", text: `${fiveBoard(next)}\n\nПопытки вышли. Слово было «${s.secret}».` };
        return { state: next, text: `${fiveBoard(next)}\n\nПопытка ${next.rows.length} из 6.` };
      },
      hint: (s) => {
        if (s.hints >= 2) return { text: "Две подсказки уже были." };
        const secret = [...fold(s.secret)];
        const placed = new Set();
        for (const row of s.rows) [...row].forEach((ch, i) => { if (secret[i] === ch) placed.add(i); });
        const free = secret.map((_, i) => i).filter(i => !placed.has(i));
        if (!free.length) return { text: "Все буквы уже на местах." };
        const index = free[s.hints % free.length];
        return { state: { ...s, hints: s.hints + 1 }, text: `${ORDINAL[index]} буква — «${secret[index]}».` };
      },
      prompt: (s) => `«5 букв», попытка ${s.rows.length + 1} из 6.${s.rows.length ? `\n\n${fiveBoard(s)}` : ""}`,
      reveal: (s) => `Слово было «${s.secret}».`,
    },

    riddle: {
      start: ({ formal, record }) => {
        const index = unseen(record, "riddle", RIDDLES.length);
        return { state: { kind: "riddle", index, tries: 0 }, text: `Загадка:\n${RIDDLES[index][0]}\n\nОтвет — одним словом. Трудно — ${f(formal, "скажите", "скажи")} «подсказка» или «сдаюсь».` };
      },
      move: (s, input) => judged(s, input, "Ещё загадку?"),
      hint: (s) => { const answer = RIDDLES[s.index][1]; return { text: `Первая буква — «${upper(first(answer))}», букв — ${letters(answer).length}.` }; },
      prompt: (s) => `Загадка:\n${RIDDLES[s.index][0]}`,
      reveal: (s) => `Отгадка — ${RIDDLES[s.index][1]}.`,
    },

    movie: {
      start: ({ formal, record }) => {
        const index = unseen(record, "movie", MOVIES.length);
        return { state: { kind: "movie", index, tries: 0 }, text: `${f(formal, "Угадайте", "Угадай")} фильм или мультфильм:\n\n${MOVIES[index][0]}` };
      },
      move: (s, input) => judged(s, input, "Ещё фильм?"),
      hint: (s) => { const title = MOVIES[s.index][1]; const count = title.split(/[\s-]+/u).length; return { text: `В названии ${count} ${plural(count, "слово", "слова", "слов")}, первое — на «${upper(first(title) || title[0])}».` }; },
      prompt: (s) => `Фильм по эмодзи:\n\n${MOVIES[s.index][0]}`,
      reveal: (s) => `Это «${MOVIES[s.index][1]}».`,
    },

    anagram: {
      start: ({ formal, record }) => {
        const word = ANAGRAM_WORDS[unseen(record, "anagram", ANAGRAM_WORDS.length)];
        const mixed = scramble(word);
        return { state: { kind: "anagram", word, mixed, tries: 0, hints: 0 }, text: `Анаграмма — ${f(formal, "соберите", "собери")} слово из букв:\n\n${spaced(mixed)}` };
      },
      move: async (s, input) => {
        const value = fold(clean(input));
        if (!/^[а-я]+$/u.test(value) || [...value].length !== [...s.word].length || chatty(value)) return null;
        if (value === fold(s.word)) return { end: "won", text: `Верно — «${s.word}»!` };
        if (!sameLetters(value, s.word)) return { state: { ...s, tries: s.tries + 1 }, text: `Буквы не те. Напомню:\n\n${spaced(s.mixed)}` };
        const exists = OWN_WORD_SET.has(value) ? true : sources ? await sources.wordExists(value) : null;
        if (exists) return { end: "won", text: `Тоже слово — засчитано! Я загадывала «${s.word}».` };
        return { state: { ...s, tries: s.tries + 1 }, text: `Буквы те, но слова «${value}» я не знаю. Ещё попытка?` };
      },
      hint: (s) => (s.hints >= 2 ? { text: "Две подсказки уже были." } : { state: { ...s, hints: s.hints + 1 }, text: `Слово начинается на «${[...s.word].slice(0, s.hints + 1).join("")}…».` }),
      prompt: (s) => `Анаграмма:\n\n${spaced(s.mixed)}`,
      reveal: (s) => `Это было «${s.word}».`,
    },

    rps: {
      start: ({ formal }) => ({ state: { kind: "rps", pick: pick(RPS), me: 0, you: 0 }, text: `Камень, ножницы, бумага — до трёх побед. Свой ход я уже сделала и спрятала. ${f(formal, "Ваш", "Твой")}?` }),
      move: (s, input, { formal }) => {
        const value = fold(clean(input));
        const theirs = /^(?:камень|✊|🪨|👊)$/u.test(value) ? "камень" : /^(?:ножницы|✌️|✌|✂️|✂)$/u.test(value) ? "ножницы" : /^(?:бумага|бумагу|✋|🖐️|🖐|📄)$/u.test(value) ? "бумага" : null;
        if (!theirs) return null;
        const mine = s.pick;
        let me = s.me, you = s.you, line;
        if (mine === theirs) line = `У меня тоже ${mine} — ничья.`;
        else if (RPS_BEATS[theirs] === mine) { you++; line = `У меня ${mine}: ${RPS_WHY[theirs]} — раунд ${f(formal, "ваш", "твой")}.`; }
        else { me++; line = `У меня ${mine}: ${RPS_WHY[mine]} — раунд мой.`; }
        const score = `Счёт ${you}:${me}${you === me ? "" : you > me ? ` в ${f(formal, "вашу", "твою")} пользу` : " в мою пользу"}.`;
        if (you >= 3) return { end: "won", text: `${line} ${score} Победа ${f(formal, "ваша", "твоя")}.` };
        if (me >= 3) return { end: "lost", text: `${line} ${score} Победа моя.` };
        return { state: { ...s, pick: pick(RPS), me, you }, text: `${line} ${score} Следующий ход я уже спрятала.` };
      },
      hint: () => ({ text: "Подсказать свой ход? Нет уж: он спрятан честно." }),
      prompt: (s, { formal }) => `Камень, ножницы, бумага: счёт ${s.you}:${s.me}. Мой ход спрятан — ${f(formal, "ваш", "твой")}?`,
      reveal: (s) => `У меня ${({ камень: "был камень", ножницы: "были ножницы", бумага: "была бумага" })[s.pick]}. Счёт ${s.you}:${s.me}.`,
    },
  };

  /** Отгадка словами: загадка и фильм. Верно, если назван один из ответов. */
  function judged(s, input, more) {
    const raw = clean(input);
    if (!raw || raw.split(/\s+/u).length > (s.kind === "movie" ? 8 : 4) || /\?\s*$/u.test(String(input))) return null;
    const said = norm(raw);
    const [, ...answers] = answerOf(s);
    const hit = answers.some(answer => {
      const want = norm(answer);
      if (said === want) return true;
      if (` ${said} `.includes(` ${want} `)) return true;
      // «Властелин колец: братство кольца» и «гарри поттер и философский камень».
      return s.kind === "movie" && want.includes(said) && said.length >= 5 && said.length >= want.length * 0.6;
    });
    if (hit) return { end: "won", text: `Верно — ${s.kind === "movie" ? `«${answers[0]}»` : answers[0]}! ${more}` };
    if (chatty(raw)) return null;
    const tries = s.tries + 1;
    const hint = tries === 3 ? ` ${ENGINE[s.kind].hint(s).text}` : "";
    return { state: { ...s, tries }, text: `Нет, не «${raw}».${hint}` };
  }

  // ── то, что видит сердце ────────────────────────────────────────────────
  /** Список игр словами. */
  function menu({ sister = "", party = "", inGroup = false } = {}) {
    return [
      "Во что сыграем? Судья — я, жульничать не умею:",
      "",
      ...GAMES.map(([, title, phrase]) => `• ${title} — ${phrase};`),
      "• а ещё «кинь кубик», «подбрось монетку», «выбери: чай или кофе», «шар судьбы, …».",
      ...(party ? ["", inGroup ? `С кнопками, вдвоём и компанией: ${party}. Играет тот, кто сам нажал кнопку.` : `С кнопками: ${party}. В группе их больше — крокодил, правда или действие, бутылочка.`] : []),
      "",
      `Закончить игру — «стоп», подсказка — «подсказка».${sister ? ` Игры со ставками и наградами ведёт ${sister}.` : ""}`,
    ].join("\n");
  }

  /** Начать игру: прежняя в этом чате заканчивается без слов. */
  async function start(chatId, game, { formal = true, from, to } = {}) {
    const engine = ENGINE[game];
    if (!engine) return null;
    const record = await read(chatId);
    const { state, text } = engine.start({ formal, from, to, record });
    await write(chatId, { active: state, seen: record.seen, last: { kind: game, at: now() } });
    return { ok: true, game, text };
  }

  /** Идёт ли игра в чате — для подсказки модели и для статуса. */
  async function active(chatId) {
    const record = await read(chatId);
    return record.active ? { kind: record.active.kind, title: TITLE[record.active.kind], prompt: ENGINE[record.active.kind].prompt(record.active, { formal: true }) } : null;
  }

  /**
   * Ход. `null` — это не ход и не слово об игре: фраза идёт дальше, к
   * намерениям и разговору.
   */
  async function move(chatId, input, { formal = true } = {}) {
    const record = await read(chatId);
    const value = fold(clean(input));
    if (!record.active) {
      // «Ещё» сразу после игры — ещё одна такая же.
      if (record.last?.kind && now() - Number(record.last.at) < AGAIN_MS && AGAIN.test(value)) return { ...(await start(chatId, record.last.kind, { formal })), started: true };
      return null;
    }
    const state = record.active;
    const engine = ENGINE[state.kind];
    const finish = async (text, end) => {
      await write(chatId, { active: null, seen: record.seen, last: { kind: state.kind, at: now() } });
      return { ok: true, game: state.kind, text, end };
    };
    if (STOP.test(value)) return finish(`Хорошо, закончили. ${engine.reveal(state)}`, "stopped");
    if (WHAT.test(value)) return { ok: true, game: state.kind, text: engine.prompt(state, { formal }) };
    if (HINT.test(value)) {
      const hinted = engine.hint(state, { formal });
      if (hinted.state) await write(chatId, { active: hinted.state, seen: record.seen, last: record.last });
      return { ok: true, game: state.kind, text: hinted.text };
    }
    const result = await engine.move(state, input, { formal });
    if (!result) return null;
    if (result.end) return finish(result.text, result.end);
    if (result.state) await write(chatId, { active: result.state, seen: record.seen, last: record.last });
    return { ok: true, game: state.kind, text: result.text };
  }

  /** Мгновенное: кубик, монетка, число, выбор, шар. Состояния не оставляет. */
  function instant(arg = {}) {
    if (arg.kind === "dice") {
      const count = Math.min(10, Math.max(1, Number(arg.count) || 1));
      const sides = Math.min(1000, Math.max(2, Number(arg.sides) || 6));
      const rolls = Array.from({ length: count }, () => 1 + rnd(sides));
      const label = sides === 6 ? "" : `d${sides}: `;
      return { text: count === 1 ? `🎲 ${label}${rolls[0]}` : `🎲 ${label}${rolls.join(" + ")} = ${rolls.reduce((a, b) => a + b, 0)}`, rolls, native: count === 1 && sides === 6 };
    }
    if (arg.kind === "coin") return { text: rnd(2) === 0 ? "🪙 Орёл." : "🪙 Решка." };
    if (arg.kind === "range") {
      const low = Math.min(arg.from, arg.to), high = Math.max(arg.from, arg.to);
      return { text: `🎲 От ${low} до ${high}: ${low + rnd(high - low + 1)}.` };
    }
    if (arg.kind === "choose") return { text: pick(CHOICE).replace("%s", pick(arg.options)) };
    if (arg.kind === "ball") return { text: `🎱 ${pick(BALL)}` };
    return null;
  }

  return Object.freeze({ menu, start, move, active, instant });
}
