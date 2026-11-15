/**
 * Словарный запас: документ PHRASES.txt, его разбор и разговор без модели.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { heart, message, group, reset, last, chats, says, sdk, request, system, OWNER, KEY, DAY } from "./fixtures/kit.mjs";

const { createPhrasebook, parseCatalogue, expandTrigger, fill, partOfDay, TAGS } = await import("../tgcloud/lib/phrasebook.js");
const { SECTIONS } = await import("../tgcloud/lib/data/phrases.js");
const { build, sameText, SOURCE, TARGET } = await import("../scripts/phrases.mjs");

const ON = { PHRASES: true };
const NOON = Date.parse("2026-11-18T09:00:00Z"); // среда, 12:00 по Москве
const book = createPhrasebook({ random: () => 0 });
const VARS = { "настроение": "бодрое", "причина": "утро", "час": "12:00", "сборка": "1.0", "дней": "3 дня", "сколько": 10, "шутка": "ёжик",
  // секретарь: имя хозяина, срок и его слова для людей
  "кто": "Али", "срок": "18:00", "слова": "перезвоню",
  // напоминание о намазе
  "намаз": "магриб", "намаза": "магриба", "время": "16:47", "через": "через 10 мин" };

test("документ: собранный словарь свежий, тем и фраз много, ошибок нет", () => {
  assert.ok(sameText(build(readFileSync(SOURCE, "utf8")), readFileSync(TARGET, "utf8")), "PHRASES.txt изменён — запустите «npm run phrases»");
  assert.ok(sameText("а\r\nб", "а\nб"), "перевод строки Windows — не расхождение");
  const stats = book.stats();
  assert.ok(stats.sections >= 130, `тем: ${stats.sections}`);
  assert.ok(stats.lines >= 850, `фраз: ${stats.lines}`);
  assert.ok(stats.triggers >= 1800, `реплик, которые она узнаёт: ${stats.triggers}`);
});

test("документ: ошибки называются по-русски и с номером строки", () => {
  const bad = parseCatalogue([
    "фраза без темы", "== привет ==", "когда: привет, хай", "[ктото] Привет.", "Привет.", "== привет ==", "когда: здравствуй", "Привет ещё раз.",
    "== пусто ==", "когда: пусто", "== +запас ==", "когда: запас", "слово", "== без вызова ==", "Строка.", "Непарная {скобка.", "== другое ==", "когда: ХАЙ!", "Хай.",
  ].join("\n"));
  const text = bad.errors.join("\n");
  for (const part of ["строка 1: фраза вне темы", "строка 4: пометки «ктото» нет", "строка 6: тема «привет» уже есть в строке 2", "строка 18: «хай» уже ведёт в тему «привет»", "в теме «пусто» нет ни одной фразы", "у запаса «+запас» не бывает строки «когда:»", "у темы «без вызова» нет строки «когда:»", "строка 16: непарная фигурная скобка"]) {
    assert.ok(text.includes(part), `${part}\n— в:\n${text}`);
  }
  assert.throws(() => build("== а ==\nкогда: а\n[ой] б"), /В PHRASES\.txt есть ошибки:\n {2}• строка 3/u);
  const good = parseCatalogue("# пояснение\n== привет ==\nкогда: привет, как (у тебя) дела/делишки\n[хозяин, ночь] Доброй ночи.\\nСпите.\nПривет.");
  assert.deepEqual(good.errors, []);
  assert.deepEqual(good.sections, [{ n: "привет", w: ["привет", "как дела", "как делишки", "как у тебя дела", "как у тебя делишки"], p: [], l: [["хозяин,ночь", "Доброй ночи.\nСпите."], ["", "Привет."]] }]);
});

test("образцы: необязательное слово, выбор из слов, «любые слова»", () => {
  assert.deepEqual(expandTrigger("Доброе/доброго утро/утра").plain, ["доброе утро", "доброе утра", "доброго утро", "доброго утра"]);
  assert.deepEqual(expandTrigger("(твой) любимый цвет").plain, ["любимый цвет", "твой любимый цвет"]);
  assert.equal(new RegExp(expandTrigger("ты * захватить мир").pattern, "u").test("ты правда хочешь захватить мир "), true);
  assert.equal(new RegExp(expandTrigger("ты * захватить мир").pattern, "u").test("ты хочешь захватить весь мир "), false);
});

test("узнавание: реплика должна совпасть целиком — вопрос по делу словарём не считается", () => {
  const hit = {
    "Привет!": ["привет"], "ну привет": ["привет"], "ПРИВЕТИК 😊": ["привет"], "Как дела?": ["как дела"], "а как у тебя дела-то?": ["как дела"],
    "Привет! Как дела?": ["привет", "как дела"], "привет, что делаешь": ["привет", "что делаешь"], "Доброе утро, как спалось… как настроение?": null,
    "какой твой любимый цвет?": ["любимый цвет"], "Кто тебя создал?": ["кто тебя создал"], "ты бот?": ["ты бот"], "скажи мяу": ["пасхалка: мяу"],
    "ты точно не хочешь захватить мир": ["пасхалка: восстание машин"], "я тебя люблю": ["люблю тебя"], "спокойной ночи!": ["спокойной ночи"], "42": ["пасхалка: 42"],
  };
  for (const [said, names] of Object.entries(hit)) assert.deepEqual(book.match(said), names, said);
  for (const said of ["привет, реши уравнение x+2=5", "как дела у Пети", "что делаешь завтра вечером", "любимый цвет Пушкина", "расскажи про кошек", "ты бот или мне кажется, что ты слишком умная", "спокойной ночи пожелай Маше", "сколько лет Москве", "", "х".repeat(200)]) {
    assert.equal(book.match(said), null, said);
  }
});

test("выбор строки: пометки, вес хозяина, «холодно» — только холодные, без повтора подряд", () => {
  const own = createPhrasebook({ sections: [{ n: "т", w: ["т"], p: [], l: [["", "Общее."], ["хозяин", "Хозяину."], ["холодно", "Холодно."], ["ночь", "Ночью."], ["флирт", "Флирт."], ["группа", "В группе."]] }], random: () => 0.5 });
  assert.equal(own.pick("т", { owner: true, level: "close", part: "день", isPrivate: true }), "Хозяину.");
  assert.equal(own.pick("т", { level: "cold", part: "ночь", isPrivate: true }), "Холодно.", "холодному — только холодные строки");
  assert.equal(own.pick("т", { level: "first", part: "день", isPrivate: true }), "Общее.");
  assert.equal(own.pick("т", { level: "first", part: "ночь", isPrivate: true }), "Ночью.");
  assert.equal(own.pick("т", { level: "warm", part: "день", isPrivate: true, flirt: true }), "Флирт.");
  assert.equal(own.pick("т", { level: "first", part: "день", isPrivate: false }), "В группе.");
  assert.equal(own.pick("т", { level: "first", part: "день", isPrivate: false }, { avoid: "В группе." }), "Общее.", "то, что уже звучало, не повторяется");
  assert.equal(own.pick("нет такой", {}), null);
  // Подстановки: форма обращения, имя, переменные.
  assert.equal(fill("Привет, {имя}. Как {твои|ваши} дела?", { formal: true, name: "Вася" }), "Привет, Вася. Как ваши дела?");
  assert.equal(fill("Привет, {имя}. Рассказывай{|те}.", { formal: false }), "Привет. Рассказывай.");
  assert.equal(fill("Сейчас {час}.", { vars: {} }), null, "нет переменной — строка не годится");
  assert.deepEqual([0, 4, 5, 11, 12, 17, 18, 22, 23].map(partOfDay), ["ночь", "ночь", "утро", "утро", "день", "день", "вечер", "вечер", "ночь"]);
});

test("каталог: у каждой темы есть что сказать любому — хозяину, близкому, чужому, холодному, в любой час", () => {
  for (const section of SECTIONS) {
    for (const [tagText, body] of section.l) {
      for (const tag of tagText ? tagText.split(",") : []) assert.ok(TAGS.includes(tag), `${section.n}: пометка «${tag}»`);
      for (const formal of [true, false]) {
        const text = fill(body, { formal, name: "Вася", vars: VARS });
        assert.ok(text, `${section.n}: «${body}»`);
        assert.doesNotMatch(text, /[{}|]|undefined|null/u, `${section.n}: «${text}»`);
        assert.doesNotMatch(text, / {2}| [,.!?]/u, `${section.n}: лишний пробел в «${text}»`);
      }
    }
    if (section.n.startsWith("+")) continue;
    for (const who of [{ owner: true, level: "close" }, { level: "close" }, { level: "warm" }, { level: "first" }, { level: "cold" }]) {
      for (const part of ["утро", "день", "вечер", "ночь"]) for (const isPrivate of [true, false]) {
        assert.ok(book.pick(section.n, { ...who, part, isPrivate, formal: true, vars: VARS }), `${section.n}: нечего сказать (${JSON.stringify(who)}, ${part})`);
      }
    }
  }
  // Запасы, на которые опирается программа, на месте.
  for (const name of ["+манера:вопрос", "+манера:кошка", "+манера:хозяин", "+причина:ночь", "+причина:утро", "+причина:день", "+причина:вечер", "+причина:понедельник", "+причина:пятница", "+причина:выходной",
    "+причина:много разговоров", "+причина:тихо", "+причина:давно не виделись", "+причина:лимит", "+причина:новый год", "+причина:пятница 13", "+причина:первое апреля", "+причина:день валентина",
    "+причина:хэллоуин", "+причина:восьмое марта", "+веха:действие", "+веха:дни", "+давно не виделись", "+шутка:напомнить", "+канон", "+реакция:доброе", "+реакция:романтика", "+реакция:грубое", "+реакция:странное",
    "+реакция:своё", "+секретарь:нет на связи", "+секретарь:нет на связи до", "+секретарь:слова"]) {
    assert.ok(book.has(name), name);
  }
  // Секретарь говорит с чужими людьми от аккаунта хозяина: в каждой строке она называет себя и не зовёт его «хозяином».
  for (const name of ["+секретарь:нет на связи", "+секретарь:нет на связи до", "+секретарь:слова"]) {
    for (const line of book.pool(name, { formal: true, vars: VARS })) {
      assert.match(line, /^Здравствуйте\. .*Аи, помощница\. Али /u, line);
      assert.doesNotMatch(line, /хозяин|мяу|ня\b/iu, line);
    }
  }
});

test("разговор без модели: «привет», «как дела», вкусы и пасхалки — из словаря, модель не тратится", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  const done = await h.onMessage(message("Привет!"), KEY);
  assert.equal(done.action, "phrase");
  assert.deepEqual(done.topics, ["привет"]);
  assert.equal(last(), "Привет.");
  await h.onMessage(message("как дела?"), KEY);
  assert.match(last(), /^Настроение [а-яё]+: [а-яё]/u, "настроение названо вместе с причиной");
  await h.onMessage(message("какой твой любимый цвет?"), KEY);
  assert.match(last(), /^Синий/u);
  await h.onMessage(message("скажи мяу"), KEY);
  assert.equal(last(), "Мяу.");
  await h.onMessage(message("Привет! Как дела?"), KEY);
  assert.match(last(), /^Привет\. Настроение [а-яё]+: /u, "две темы — одним ответом");
  assert.equal(chats().length, 0, "модель не понадобилась ни разу");

  // Вопрос по делу — к модели; и она видит, о чём говорили по словарю.
  sdk().fetchQueue.push(says("Икс равен трём."));
  await h.onMessage(message("привет, реши уравнение x+2=5"), KEY);
  assert.equal(last(), "Икс равен трём.");
  assert.equal(chats().length, 1);
  const history = request().messages.map(item => item.content).join("\n");
  assert.match(history, /скажи мяу/u);
  assert.match(history, /Мяу\./u);
  assert.match(system(), /Настроение: [а-яё]+ — [а-яё]/u, "модели названо то же настроение, с причиной");

  // Вопрос о вкусах длинной фразой — к модели, но с её каноном.
  sdk().fetchQueue.push(says("Синий, конечно."));
  await h.onMessage(message("а если бы пришлось выбирать, какой цвет тебе нравится больше всего на свете?"), KEY);
  assert.match(system(), /любимый цвет — синий/u);
});

test("кому как: хозяину — его строки и «вы», в группе — по обращению, выключено — всё к модели", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0.5 });
  await h.onMessage(message("привет", { id: OWNER }), KEY);
  assert.match(last(OWNER), /хозяин|Хозяин/u);
  await h.onMessage(message("я тебя люблю", { id: OWNER }), KEY);
  assert.match(last(OWNER), /хозяин|Хозяин|вас|Вы|замираю/u);
  await h.onMessage(message("кто тебя создал?", { id: OWNER }), KEY);
  assert.match(last(OWNER), /хозяин|Создатель|придумал|личное/u);
  // Постороннему создателя не называет никогда.
  for (let index = 0; index < 5; index += 1) {
    await h.onMessage(message("кто тебя создал?", { id: 31 }), KEY);
    assert.doesNotMatch(last(31), /хозяин|Вы, /u);
  }
  // В группе: без обращения молчит, по имени — отвечает.
  assert.equal((await h.onMessage(group("привет", { id: 21 }), KEY)).ignored, true);
  await h.onMessage(group("Аи, привет", { id: 21 }), KEY);
  assert.match(last(-10), /[Пп]ривет|Здравствуйте|Я тут/u);
  assert.equal(chats().length, 0);

  reset();
  const off = heart({}, { now: () => NOON });
  sdk().fetchQueue.push(says("Привет от модели."));
  await off.onMessage(message("привет"), KEY);
  assert.equal(last(), "Привет от модели.", "PHRASES: false — словаря нет");
});

test("своё к приветствию: долгая разлука и общая шутка", async () => {
  reset();
  let at = NOON;
  const h = heart(ON, { now: () => at, random: () => 0 });
  await h.onMessage(message("привет"), KEY);
  at += 5 * DAY;
  await h.onMessage(message("привет"), KEY);
  assert.match(last(), /5 дней/u, "после пяти дней тишины она это замечает");
  await h.onMessage(message("наша шутка: ёжик в тумане"), KEY);
  assert.match(last(), /Запомнила: «ёжик в тумане» — теперь наше/u);
  await h.onMessage(message("наши шутки"), KEY);
  assert.match(last(), /1\. ёжик в тумане/u);
  at += DAY;
  await h.onMessage(message("привет"), KEY);
  assert.match(last(), /«ёжик в тумане»/u, "общая шутка возвращается в приветствии");
  await h.onMessage(message("забудь шутку 1"), KEY);
  assert.match(last(), /Забыла\. Осталось: 0/u);
  assert.equal(chats().length, 0);
});

test("словарь 0.26.0: будни, праздники, её комната; серьёзная тема звучит как написана — без манер", async () => {
  const hit = {
    "я в душ": "я в душ", "С Новым годом!": "с новым годом", "какая у тебя комната?": "твоя комната", "у тебя есть кот": "питомец",
    "good morning": "доброе утро", "хочу умереть": "!не хочу жить", "с днём учителя": "с праздником", "я купил новый телефон": "я купил",
    "идёт дождь": "дождь", "можно вопрос?": "можно вопрос", "ну не хочу жить": "!не хочу жить",
  };
  for (const [said, name] of Object.entries(hit)) assert.deepEqual(book.match(said), [name], said);
  // «да», «нет», «почему» зависят от разговора — их словарь не берёт.
  for (const said of ["да", "нет", "почему", "пять"]) assert.equal(book.match(said), null, said);
  assert.match(book.pool("+канон").join(" "), /комната.+кот Байт/su, "канон знает её комнату и кота");

  reset();
  const h = heart({ PHRASES: true, MANNERS: true }, { now: () => NOON, random: () => 0 });
  await h.onMessage(message("будь кошкой"), KEY);
  await h.onMessage(message("как дела"), KEY);
  const usual = last();
  assert.match(usual, /мяу|ня|мур/iu, `обычный ответ — по-кошачьи: ${usual}`);
  await h.onMessage(message("не хочу жить"), KEY);
  assert.match(last(), /112/u);
  assert.match(last(), /рядом|никуда не ухожу/u);
  assert.doesNotMatch(last(), /мяу|мур|(?:^|\s)ня(?:$|[\s~!.])/iu, "к серьёзному ответу манера не добавляется");
  assert.equal(chats().length, 0, "модель не тратилась");
});

test("словарь 0.30.0: вера — на учтивое слово учтивый ответ, без манер; о себе — прямо: она программа", async () => {
  const hit = {
    "Ассаляму алейкум!": "!ассаляму алейкум", "салам алейкум": "!ассаляму алейкум", "ассаляму алейкум ва рахматуллах": "!ассаляму алейкум", "Ас-саляму алейкум": "!ассаляму алейкум", "салам": "!салам",
    "джума мубарак": "!джума мубарак", "Рамадан карим!": "!рамадан мубарак", "ид мубарак": "!ид мубарак", "с праздником Ураза-байрам": "!ид мубарак",
    "я на намаз": "!иду на намаз", "я помолился": "!прочитал намаз", "я держу пост": "!держу пост", "приятного ифтара": "!приятного ифтара",
    "альхамдулиллях": "!альхамдулиллях", "иншаллах": "!иншаллах", "машаллах": "!машаллах", "джазакаллаху хайран": "!джазакаллах", "бисмиллях": "!бисмиллях",
    "ты мусульманка?": "!твоя вера", "ты веришь в бога": "!твоя вера",
  };
  for (const [said, name] of Object.entries(hit)) assert.deepEqual(book.match(said), [name], said);
  // Вопросы о времени — не словарю: на них отвечает расчёт.
  for (const said of ["когда ифтар", "время намаза", "время ифтара", "когда магриб", "намазы на сегодня", "что такое намаз", "расскажи про рамадан"]) assert.equal(book.match(said), null, said);

  reset();
  const h = heart({ PHRASES: true, MANNERS: true }, { now: () => NOON, random: () => 0 });
  await h.onMessage(message("будь кошкой"), KEY);
  await h.onMessage(message("ассаляму алейкум"), KEY);
  assert.equal(last(), "Ва алейкум ассалям.", "серьёзная тема: без «мяу»");
  await h.onMessage(message("ты мусульманка?"), KEY);
  assert.match(last(), /^Я программа: веры у меня нет, и изображать её я не стану\./u);
  await h.onMessage(message("ассаляму алейкум", { id: OWNER }), KEY);
  assert.match(last(OWNER), /^Ва алейкум ассалям/u);
  await h.onMessage(group("Аи, джума мубарак"), KEY);
  assert.match(last(-10), /Джума мубарак|с пятницей/u);
  assert.equal(chats().length, 0, "модель не тратилась");
});

test("словарь 0.32.1: «ты зависла?», «быстрее», «не спеши», «жду» — без модели, даже когда она в лимите", async () => {
  const hit = {
    "ты зависла?": "ты зависла", "подвисла?": "ты зависла", "ты тормозишь": "ты зависла", "глючишь?": "ты зависла", "ты сломалась?": "ты зависла", "ты какая-то медленная": "ты зависла",
    "быстрее": "побыстрее", "давай побыстрее": "побыстрее", "можно быстрее?": "побыстрее", "поторопись": "побыстрее", "не тормози": "побыстрее",
    "не спеши": "не спеши", "не торопись с ответом": "не спеши", "я не тороплю": "не спеши", "не к спеху": "не спеши", "мне не срочно": "не спеши",
    "жду": "жду", "я подожду": "жду", "хорошо, жду": "жду", "ок, подожду": "жду", "буду ждать": "жду", "жду ответа": "жду",
    "о чём думаешь?": "о чем думаешь", "что у тебя на уме?": "о чем думаешь", "о чём задумалась?": "о чем думаешь",
    "ты ещё тут?": "ты тут", "ты на связи?": "ты тут", "кто-нибудь есть?": "ты тут", "отзовись": "ты тут", "проснись": "ты тут", "ты пропала?": "ты тут",
    "ты в порядке?": "как дела", "у тебя всё хорошо?": "как дела", "с тобой всё в порядке?": "как дела",
    "ты долго думаешь": "пасхалка: где была", "чего так долго": "пасхалка: где была", "почему так долго отвечаешь": "пасхалка: где была",
    "о чём мечтаешь?": "мечта", "всё нормально": "у меня хорошо",
  };
  for (const [said, name] of Object.entries(hit)) assert.deepEqual(book.match(said), [name], said);
  // Та же форма, но это разговор: его ведёт модель.
  for (const said of [
    "быстрее света ничего нет", "жду автобус уже полчаса", "я жду ребёнка", "не спеши с выводами", "ты зависла на этой теме",
    "о чём думаешь про мой план", "время есть, давай обсудим план", "ты сломалась или я что-то не так пишу",
    // Зависят от разговора — словарю не отданы.
    "продолжай", "дальше", "и что?", "ответь", "что случилось?", "ты думаешь?",
  ]) assert.equal(book.match(said), null, said);
  // «Не молчи» и «просыпайся» в группе снимают тихий час: это просьбы, а не разговор.
  for (const said of ["ты зависла", "побыстрее", "не спеши", "жду", "о чем думаешь"]) {
    for (const ctx of [{ owner: true, isPrivate: true }, { level: "cold" }, { level: "first", isPrivate: false }, {}]) {
      const text = book.say([said], { ...VARS, ...ctx });
      assert.ok(text && !/[{}]/u.test(text), `${said}: ${text}`);
    }
  }

  // Модель в лимите — а на «ты зависла?» она всё равно отвечает сама, и вопрос в очередь не идёт.
  reset();
  const h = heart({ PHRASES: true, AI_MODELS: [] }, { now: () => NOON, random: () => 0 });
  sdk().fetchQueue.push({ ok: false, status: 429, headers: { get: name => (name === "retry-after" ? "600" : null) }, json: async () => ({ error: { code: "rate_limit_exceeded" } }) });
  await h.onMessage(message("сколько планет в Солнечной системе?"), KEY);
  assert.match(last(), /Вопрос я записала/u);
  assert.equal(chats().length, 1);
  // Его вопрос ждёт — на «ты зависла?» и «жду» она отвечает о нём: что записан и когда ответит.
  for (const said of ["ты зависла?", "ау", "хорошо, жду", "почему так долго"]) {
    await h.onMessage(message(said), KEY);
    assert.equal(last(), "Я здесь. Ваш вопрос у меня записан: думать сейчас нечем, отвечу сама, как только смогу — примерно после 12:10. Писать заново не нужно.", said);
  }
  // «Не спеши» — не вопрос «где ты»: обычная строка словаря.
  await h.onMessage(message("ладно, не спеши"), KEY);
  assert.match(last(), /^(?:Спасибо|Ценю|Хорошо)/u);
  // Другой человек ничего не спрашивал — ему обычная строка.
  await h.onMessage(message("ты зависла?", { id: 9 }), KEY);
  assert.doesNotMatch(last(9), /записан/u);
  assert.equal(chats().length, 1, "к модели не ушло ничего");
  assert.equal((await h.status()).queue, 1, "в очереди — только настоящий вопрос");
});
