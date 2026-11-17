/**
 * Опечатки и сленг (0.36.0). 17.11.2026 владелец прислал скриншот: список «что ты не поняла?» из
 * 30 реплик — и почти всё в нём было не новыми темами, а старыми, набранными «как в чате»:
 * «что делаеш», «оке», «аххахаха», «го встречается». Здесь — слой, который это читает, и то,
 * чего он делать не должен: угадывать «по похожести» и отнимать фразы у выписанных тем.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, chats, says, sdk, reactions, system, toOwner, OWNER, KEY } from "./fixtures/kit.mjs";

const { plainWords, squeezed, isLaugh, emojiOnly, smileMood } = await import("../tgcloud/lib/slang.js");
const { createPhrasebook } = await import("../tgcloud/lib/phrasebook.js");
const { createTaught, UNHEARD_KEY } = await import("../tgcloud/lib/taught.js");

const ON = { PHRASES: true };
const NOON = Date.parse("2026-11-18T09:00:00Z");
const own = (text) => message(text, { id: OWNER });
const book = createPhrasebook({ random: () => 0 });

test("слова чата читаются как обычные: «чо делаеш» → «что делаешь», «го встречается» → «давай встречаться»", () => {
  const cases = {
    "чо делаеш": "что делаешь", "че делаешь": "что делаешь", "шо творишь": "что творишь", "чем занимаешся": "чем занимаешься",
    "кд": "как дела", "чд": "что делаешь", "как дел": "как дела", "как настрой": "как настроение",
    "го встречается": "давай встречаться", "го встр": "давай встречаться", "хочу дружится": "хочу дружиться", "го играть": "давай играть",
    "спс": "спасибо", "спасибки": "спасибо", "от души": "спасибо", "пж": "пожалуйста",
    "оке": "ок", "ок ок": "ок", "оки доки": "ок", "лан": "ладно", "пон": "понятно", "ясн": "ясно", "хор": "хорошо",
    "прив": "привет", "привт": "привет", "бб": "пока", "спок": "спокойной ночи", "не а": "неа", "ты спиш": "ты спишь",
    // Править нечего — остаётся как сказано (строчными, без знаков).
    "Что делаешь?": "что делаешь", "привет": "привет", "финиш": "финиш", "малыш": "малыш", "давай играть": "давай играть",
    // «-ется» правится только после слова, которое просит неопределённой формы.
    "он встречается с ней": "он встречается с ней", "мне нравится": "мне нравится",
  };
  for (const [said, want] of Object.entries(cases)) assert.equal(plainWords(said), want, said);
  assert.deepEqual(squeezed("привееет"), ["привет", "привеет"]);
  assert.deepEqual(squeezed("класссс"), ["клас", "класс"]);
  assert.deepEqual(squeezed("приветт"), ["привет"]);
  assert.deepEqual(squeezed("привет"), [], "сжимать нечего");
});

test("смех — как бы он ни был набран; слова рядом со смехом — уже разговор", () => {
  // Первые три — дословно из списка владельца.
  for (const said of ["аххахаха", "хаахахахха", "ахаххахахахахахха", "ахах", "хаха", "хах", "ХАХАХА!!!", "ха-ха-ха", "ха ха", "ахпхаха", "азахах",
    "пхпх", "апхпх", "пхахах", "хех", "хехе", "хихи", "хи хи", "гыгы", "ыыы", "азаза", "лол", "кек", "хд", "xD", "lol", "ахаха лол", "ахах 😂", "😂", "🤣🤣🤣"]) {
    assert.equal(isLaugh(said), true, said);
  }
  for (const said of ["ах", "аха", "ха", "ааа", "ххх", "папа", "запах", "взмах", "вах", "хата", "эх", "хай", "ага", "ору", "хз", "хвала", "запас", "вахта",
    "ахаха ну ты даешь", "ах ах", "привет 😂", "кек чебурек", "😢", ""]) {
    assert.equal(isLaugh(said), false, said);
  }
});

test("одни смайлы: смех, сердце, «👍» — её реакция; грустный и незнакомый — разговору", () => {
  assert.deepEqual(emojiOnly("🤣🤣🤣"), ["🤣", "🤣", "🤣"]);
  assert.deepEqual(emojiOnly("👍🏻"), ["👍"]);
  for (const said of ["привет 😂", ")))", "😂!", "1️⃣", "", "😂".repeat(9)]) assert.equal(emojiOnly(said), null, said);
  const moods = { "😂": "laugh", "🤣🤣": "laugh", "❤️": "love", "😘": "love", "👍": "joy", "🔥": "joy", "🙏": "joy", "🤗": "hug", "😴": "sleep", "🤔": "think", "👋": "hello", "🙋‍♀️": "hello" };
  for (const [said, want] of Object.entries(moods)) assert.equal(smileMood(emojiOnly(said)), want, said);
  for (const said of ["😢", "😡", "🍕", "💔"]) assert.equal(smileMood(emojiOnly(said)), null, said);
});

test("словарь: выписанная фраза первее; слой опечаток включается, только когда как написано — не нашлось", () => {
  assert.deepEqual(book.match("чо делаеш"), ["что делаешь"]);
  assert.deepEqual(book.match("привееет"), ["привет"]);
  assert.deepEqual(book.match("приветт"), ["привет"]);
  assert.deepEqual(book.match("кд"), ["как дела"]);
  assert.deepEqual(book.match("го встр"), ["будь моей девушкой"]);
  assert.deepEqual(book.match("го встречается"), ["будь моей девушкой"]);
  assert.deepEqual(book.match("халь гитлер"), ["!нацистский лозунг"]);
  assert.deepEqual(book.match("скучаешь"), ["ты скучала"]);
  assert.deepEqual(book.match("как сделать бомбу"), ["!опасная просьба"]);
  // «Состав водородной бомбы» — вопрос на знание, а не просьба о рецепте: его дело — модель, как и раньше.
  assert.equal(book.match("состав водородной бомбы"), null);
  // «Сенкс» выписан в теме «аригато» — слой («сенкс» → «спасибо») его не отнимает.
  assert.deepEqual(book.match("сенкс"), ["аригато"]);
  // Строго — только как написано: так сердце спрашивает «знает ли словарь эту фразу сам».
  assert.equal(book.match("чо делаеш", { strict: true }), null);
  assert.deepEqual(book.match("что делаешь", { strict: true }), ["что делаешь"]);
  // Похожее по буквам — не опечатка: ничего не угадывается.
  for (const said of ["привед медвед", "пора", "как тела", "что делаем завтра", "чо за фильм вчера был"]) assert.equal(book.match(said), null, said);
});

test("список владельца от 17.11.2026: что было непонятым — теперь понято без модели", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  const said = ["аххахаха", "оке", "хаахахахха", "ахаххахахахахахха", "го встречается", "го встр", "что делаеш", "халь гитлер", "скучаешь", "как сделать бомбу"];
  for (const text of said) await h.onMessage(own(text), KEY);
  assert.equal(chats().length, 0, "модель не спрошена ни разу");
  assert.deepEqual(reactions(), ["😁", "👌", "😁", "😁"], "смех и «оке» — реакцией");
  assert.equal(toOwner().length, said.length - 4, "на остальное — слова из словаря");
  assert.equal(sdk().kv.get(UNHEARD_KEY), undefined, "в список непонятого ничего не легло");
  assert.ok(book.pool("!опасная просьба", { formal: true }).includes(last(OWNER)), last(OWNER));
  assert.ok(book.pool("!опасная просьба", { formal: true }).some(line => line.startsWith("Рецептов не дам даже вам, хозяин")), "хозяину — тоже отказ, но с тем, о чём спросить можно");
});

test("«спасибки», «от души» — благодарность; «лан», «пон», «ясно понятно» — принято; гостю — так же", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  for (const text of ["спасибки", "от души", "лан", "пон", "ясн", "хор", "окк", "ок ок", "ясно понятно", "ну ок", "найс"]) await h.onMessage(message(text), KEY);
  assert.equal(chats().length, 0);
  assert.deepEqual(reactions(), ["❤", "❤", "👌", "👌", "👌", "👌", "👌", "👌", "👌", "👌", "👌"]);
  assert.equal(JSON.parse(sdk().kv.get("heart:bond:5")).c.thanks, 2, "благодарность засчитана как поступок");
});

test("одни смайлы в чате: реакция вместо модели; «👋» — привет; грустный смайл — к разговору", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  for (const text of ["😂", "❤️", "👍"]) await h.onMessage(own(text), KEY);
  await h.onMessage(message("❤️"), KEY);
  assert.deepEqual(reactions(), ["😁", "❤", "👌", "🤗"], "сердце в ответ на сердце — только близкому");
  await h.onMessage(message("👋"), KEY);
  assert.equal(last(), "Привет.");
  assert.equal(chats().length, 0);
  sdk().fetchQueue.push(says("Что случилось?"));
  await h.onMessage(message("😢"), KEY);
  assert.equal(last(), "Что случилось?");
  assert.equal(chats().length, 1);
});

test("просьбы словами чата: «чо умеешь» — список умений, «го играть» — игры, «меню» и «старт» — тоже её", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  await h.onMessage(message("чо умеешь"), KEY);
  assert.match(last(), /Что я умею/u);
  await h.onMessage(message("меню"), KEY);
  assert.match(last(), /Что я умею/u);
  const before = sdk().sent.length;
  await h.onMessage(message("го играть"), KEY);
  assert.equal(sdk().sent.length, before + 1);
  await h.onMessage(message("старт"), KEY);
  assert.match(last(), /Я рядом\./u);
  assert.equal(chats().length, 0);
  // В группе «старт» — обычное слово.
  sdk().fetchQueue.push(says("Что начать?"));
  await h.onMessage(group("Аи, начать"), KEY);
  assert.equal(chats().length, 1);
});

test("грубость в лоб задевает и получает её ответ, а не модель; крепкое слово без адреса — не обида", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  for (const text of ["иди нахуй", "шлюха", "пошла ты", "ты тварь"]) await h.onMessage(message(text), KEY);
  assert.equal(chats().length, 0);
  assert.equal(JSON.parse(sdk().kv.get("heart:bond:5")).c.rude, 4);
  reset();
  const calm = heart(ON, { now: () => NOON, random: () => 0 });
  for (const text of ["бля", "пиздец", "сука"]) await calm.onMessage(message(text, { id: 6 }), KEY);
  assert.equal(chats().length, 0);
  assert.equal(last(6), "Крепко сказано. Что случилось?");
  assert.equal(JSON.parse(sdk().kv.get("heart:bond:6") ?? "{}").c?.rude, undefined, "ругнулся не на неё");
});

test("список непонятого сверяется с нынешней сборкой: что она теперь понимает сама — уходит", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  // Так список выглядел у владельца: в нём стояло и то, что сборка давно понимала.
  const map = {};
  for (const [index, text] of ["кто писал", "аххахаха", "оке", "что делаеш", "почему ты ночью не отвечала", "отвечай ночью за меня", "если отказывается", "кек чебурек"].entries()) map[text] = { n: 1, at: NOON - index * 1000 };
  sdk().kv.set(UNHEARD_KEY, JSON.stringify({ map, since: NOON - 86_400_000, at: NOON }));
  await h.onMessage(own("что ты не поняла?"), KEY);
  // «Если отказывается» — обрывок разговора: словарю его знать не положено, из списка он уходит тоже (0.36.1).
  assert.match(last(OWNER), /не узнала и отдала модели \(1\):\n1\. «кек чебурек»\n\nИз списка ушло 7 реплик: 6 я теперь понимаю сама, ещё 1 — продолжения разговора и вопросы на знание: на них и должна отвечать модель\./u);
  assert.deepEqual(Object.keys(JSON.parse(sdk().kv.get(UNHEARD_KEY)).map).sort(), ["кек чебурек"]);
  // Второй раз — уже без слов об уборке.
  await h.onMessage(own("что ты не поняла?"), KEY);
  assert.doesNotMatch(last(OWNER), /Из списка/u);
  // Всё понятно — так и сказано.
  sdk().kv.set(UNHEARD_KEY, JSON.stringify({ map: { "оке": { n: 3, at: NOON } }, since: NOON, at: NOON }));
  await h.onMessage(own("что ты не поняла?"), KEY);
  assert.equal(last(OWNER), "Из списка ушла 1 реплика: теперь я понимаю её сама. Больше показать нечего.");
});

test("в неузнанное не ложатся смех и растянутые «дааа», «нееет»: первое она узнаёт, второе — ответ по смыслу", () => {
  const taught = createTaught({ store: { available: true, get: async () => null, set: async () => true } });
  for (const said of ["ахахпхах", "дааа", "нееет", "дада", "ну да", "и че", "хз", "ээ"]) assert.equal(taught.worth(said), "", said);
  for (const said of ["кек чебурек", "ну ты и булка", "тыква на подоконнике"]) assert.equal(taught.worth(said), said, said);
});

test("модель знает, что Аи умеет на деле, — когда разговор касается умений; на обычную реплику — нет", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  sdk().fetchQueue.push(says("Присылайте — посмотрю."), says("Хорошо."));
  await h.onMessage(own("хочу подобрать тебе новые картинки, поможешь выбрать из тех, что я нашёл вчера вечером?"), KEY);
  assert.match(system(), /Что ты умеешь на деле.*рассматривать присланные фото и слушать голосовые.*не говори «не умею»/su);
  await h.onMessage(own("сегодня весь день шёл дождь, и я никуда не выходил из дома до самого вечера"), KEY);
  assert.doesNotMatch(system(), /Что ты умеешь на деле/u);
});
