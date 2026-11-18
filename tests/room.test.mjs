/**
 * Комната (0.37.0) — шаг 1 идей 41 и 112–114, без мини-приложения: зайти словами, спросить о Байте,
 * позаботиться (погладить, покормить, поиграть, чай, полить Колючку), вещи по дням знакомства и сценка
 * дня с двумя кнопками. Всё — без модели; забота двигает отношения не чаще раза в день.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, chats, says, sdk, toChat, toOwner, calls, OWNER, KEY, DAY } from "./fixtures/kit.mjs";

const { parseRoom, itemsFor, sceneFor, herKey, catState, plantState, createRoom, SCENES, ITEMS, ROOM_KEY, WATER_EVERY_MS, FRESH_MS, NEWS_AT_ONCE, CONTEXT_MS } = await import("../tgcloud/lib/room.js");
const { createPhrasebook } = await import("../tgcloud/lib/phrasebook.js");
const { FIRST_KEY } = await import("../tgcloud/lib/personal.js");

const ON = { PHRASES: true };
// 18.11.2026, 14:00 по Москве: день, она не спит, Байт не спит.
const NOON = Date.parse("2026-11-18T11:00:00Z");
const HOUR = 3_600_000;
const own = (text) => message(text, { id: OWNER });
const book = createPhrasebook({ random: () => 0 });
const VARS = { "цвет": "синий", "рисунок": "кот в шляпе" };
const pool = (name, ctx = {}) => book.pool(`+комната:${name}`, { formal: true, vars: VARS, ...ctx });
const roomOf = (id) => JSON.parse(sdk().kv.get(ROOM_KEY(id)) ?? "null");
const bondOf = (id) => JSON.parse(sdk().kv.get(`heart:bond:${id}`) ?? "null");
const relationOf = (id) => JSON.parse(sdk().kv.get(`ai:relationship:${id}`) ?? "null");
const press = (data, from = 5, { chat = from, type = "private", id = 900 } = {}) => ({ id: `q${data}${from}`, from: { id: from, first_name: "Тест" }, data, message: { message_id: id, chat: { id: chat, type } } });
const inPool = (name, text, ctx) => pool(name, ctx).some(line => text.includes(line));
/** Часы, которые можно переводить. */
const clock = (start = NOON) => { let at = start; return { now: () => at, add: (ms) => { at += ms; }, set: (value) => { at = value; } }; };

test("разбор: зайти, Байт, забота, чай, Колючка, «что нового» — и что комнатой не считается", () => {
  const yes = {
    enter: ["зайду к тебе", "Зайду к тебе в гости!", "можно в гости?", "можно к тебе", "я к тебе в гости", "в гости к тебе", "иду к тебе", "пусти к себе", "пойдём в твою комнату", "зайти в комнату", "зайди в комнату",
      "открой дверь", "впусти меня", "что сейчас происходит в комнате", "что там в комнате", "что творится у тебя в комнате", "как там в комнате", "комната", "загляну к тебе", "пошли к тебе",
      "ну зайду к тебе", "можно зайти к тебе в комнату", "иду к тебе в гости", "зайти в гости", "загляну в гости", "я зашёл", "я зашла к тебе", "я у тебя", "я у тебя в гостях",
      "я в твоей комнате"],
    cat: ["как там Байт", "как Байт?", "как поживает Байт", "как твой кот", "как поживает твой кот", "где Байт", "что делает Байт", "чем занят Байт", "чем занят твой кот", "Байт спит?",
      "твой кот сыт?", "байт", "покажи Байта", "как дела у Байта", "а как там Байт", "как там твой кот", "ты кормила Байта?", "ты покормила кота сегодня?", "Байт не голодный?"],
    call: ["Байт, иди сюда", "Байт, ко мне", "кис-кис, Байт", "Байт, кис-кис", "позови Байта", "позови кота", "разбуди Байта"],
    pet: ["погладь Байта", "погладить Байта", "глажу Байта", "поглажу твоего кота", "обними Байта", "поцелуй Байта", "чмокни Байта", "погладь кота за меня", "потискай кота", "беру Байта на руки", "можно взять Байта на руки?", "посажу Байта на колени", "почеши Байта за ухом", "чешу Байта за ушком", "можно погладить Байта?", "глажу твоего кота", "потискать Байта",
      "глажу Байта по спинке", "обнимаю Байта"],
    feed: ["покормить Байта", "покорми Байта", "кормлю Байта", "накормлю твоего кота", "покорми своего кота", "покорми кота", "накорми кота за меня", "я принёс Байту рыбку", "принесла Байту вкусняшку", "у меня для Байта вкусняшка", "у меня есть рыбка для Байта", "дай Байту вкусняшку", "насыпь Байту корм", "покормлю Байта рыбкой", "вкусняшка для Байта", "даю Байту рыбку",
      "угощаю Байта вкусняшкой"],
    play: ["поиграть с Байтом", "играю с Байтом", "поиграю с твоим котом", "кидаю Байту мячик", "брось Байту бантик", "поиграй с Байтом"],
    tea: ["налью тебе чаю", "наливаю тебе чай", "принёс тебе чай", "я принесла тебе чай", "держи чай", "вот тебе чай", "угощаю тебя чаем", "чай тебе", "заварю тебе чай", "налью чаю тебе",
      "я заварил тебе чай", "налить тебе чаю"],
    water: ["полить кактус", "полью Колючку", "поливаю кактус", "полей Колючку", "полью твой кактус", "можно полить кактус"],
    news: ["что нового в комнате", "что появилось в комнате", "что изменилось у тебя в комнате", "что нового у тебя в комнате", "покажи мои вещи в комнате", "что в комнате нового",
      "есть что-то новое в комнате?", "в комнате что-нибудь изменилось?"],
    plant: ["как Колючка", "как там Колючка?", "как твой кактус", "как поживает Колючка", "Колючка жива?", "твой кактус не засох?", "колючка"],
    hurt: ["пни Байта", "укуси Байта", "ударю Байта", "выгони Байта", "дёрни Байта за хвост", "наступлю Байту на хвост", "напугаю твоего кота", "съешь Байта"],
  };
  // 0.38.0: «открой комнату» — зайти и получить кнопку мини-приложения; кнопка в меню — слово хозяина.
  Object.assign(yes, {
    open: ["открой комнату", "покажи комнату", "покажи свою комнату", "Покажи мне комнату!", "запусти комнату", "открой мини-приложение", "открой приложение", "где кнопка комнаты",
      "кнопка комнаты", "хочу в комнату", "как открыть комнату", "можно посмотреть на твою комнату", "хочу увидеть твою комнату", "где мини-приложение", "а как открыть мини-приложение",
      "можно посмотреть комнату", "хочу посмотреть комнату", "покажи где ты живёшь", "покажи, как ты живёшь"],
    menuoff: ["убери комнату из меню", "убери кнопку комнаты из меню", "спрячь комнату из меню"],
    menuon: ["верни комнату в меню", "поставь кнопку комнаты в меню"],
  });
  for (const [op, list] of Object.entries(yes)) for (const said of list) assert.deepEqual(parseRoom(said), { op }, said);
  // Короткое — только когда человек в комнате (`near`): так отвечают на её подсказку, но так же говорят и о своём.
  const loose = {
    pet: ["погладить", "погладь", "поглажу", "погладить его", "глажу его", "поглажу кота", "почесать за ухом", "можно погладить?"],
    feed: ["покормить", "покорми", "покормлю", "покормить его", "кормлю кота", "накормлю кота", "дам ему вкусняшку", "насыплю коту корм"],
    play: ["поиграть с ним", "поиграю с котом", "играю с ним", "кину ему мячик"],
    tea: ["налить чаю", "налью чаю", "заварю чай", "можно налить чаю"],
    water: ["полить", "полью", "полить её", "полью её"],
    cat: ["как кот", "где кот", "кот сыт?", "кот спит", "что делает кот"],
    plant: ["как кактус", "как там кактус"],
    call: ["кис-кис", "кс-кс-кс"],
  };
  for (const [op, list] of Object.entries(loose)) for (const said of list) {
    if (parseRoom(said)) { assert.deepEqual(parseRoom(said), { op }, `«${said}» понятно и без комнаты`); continue; }
    assert.deepEqual(parseRoom(said, { near: true }), { op, loose: true }, said);
  }
  // Настоящее время без «его» — о своём даже в комнате; «поиграть», «чай», «налей чаю» — у них другие хозяева.
  for (const said of ["глажу", "кормлю", "играю", "поиграть", "поиграем", "чай", "чаю", "налей чаю", "как он", "он спит", "полить цветы", "глажу рубашки", "кормлю ребёнка"]) {
    assert.equal(parseRoom(said, { near: true }), null, said);
  }
  // Рассказ о комнате и о коте — дело словаря; своё о человеке, чужие «гости», байты и чай для себя — мимо.
  for (const said of ["привет", "какая у тебя комната", "опиши комнату", "где твоя комната", "посмотреть комнату", "покажи комнату мечты", "покажи где я живу", "нарисуй свою комнату", "открой окно",
    "как найти приложение", "где приложение", "покажи приложение для заметок", "убери комнату", "верни меню", "что у тебя в комнате", "что у тебя дома", "как у тебя дома", "твоя комната", "у тебя есть кот", "как зовут твоего кота",
    "твой кот", "у меня есть кот", "я покормил кота", "кормлю кота", "поглажу кота", "кот сыт", "как кот", "покорми меня", "погладь меня", "погладить", "покормить", "налить чаю", "я пью чай", "я заварил чай", "пойду попью чаю", "сделай мне чай", "налей мне чаю", "чай будешь",
    "хочу чаю", "полить цветы", "напомни полить кактус", "зайду позже", "зайду завтра", "я зайду в магазин", "пойдем гулять", "иду домой", "в гости к маме", "мы идём в гости", "иду в гости", "еду в гости",
    "я в гостях", "иду в комнату", "я зашёл в магазин", "я у мамы", "я уже дома", "позови маму", "разбуди меня", "возьми меня на руки", "я принёс коту рыбку", "пусти", "будешь чай", "хочешь чаю", "как кактус", "пни мяч", "укуси меня", "обними меня", "пни его", "ударь по мячу", "как кот в сапогах",
    "кот", "кошка", "поиграть", "давай поиграем", "что нового", "что нового у тебя", "комнатная температура", "уберись в комнате", "я в комнате", "как байт перевести в бит",
    "сколько байт в килобайте", "что такое байт", "на чай дают", "", "   "]) {
    assert.equal(parseRoom(said), null, said);
  }
});

test("правила: вещи по дням знакомства и заботе, сценки по кругу, чем занята она и что с Байтом", () => {
  assert.deepEqual(itemsFor({ days: 2 }), []);
  assert.deepEqual(itemsFor({ days: 3 }), ["кружка"]);
  assert.deepEqual(itemsFor({ days: 30 }), ["кружка", "тапочки", "подушка", "снимок"]);
  assert.deepEqual(itemsFor({ days: 400, care: 10, colour: "синий", drawing: "кот в шляпе", month: 12, day: 20 }), ITEMS.map(item => item.key), "все двенадцать");
  assert.deepEqual(itemsFor({ care: 9 }), []);
  assert.deepEqual(itemsFor({ care: 10 }), ["место"]);
  // Ёлка — с 15 декабря по 14 января.
  for (const [month, day, there] of [[12, 14, false], [12, 15, true], [12, 31, true], [1, 14, true], [1, 15, false], [7, 1, false]]) {
    assert.equal(itemsFor({ month, day }).includes("ёлка"), there, `${day}.${month}`);
  }
  // Десять дней подряд — десять разных сценок; у разных людей в один день — своя.
  const days = Array.from({ length: SCENES.length }, (_, index) => new Date(Date.UTC(2026, 10, 18 + index)).toISOString().slice(0, 10));
  assert.equal(new Set(days.map(day => sceneFor(5, day).key)).size, SCENES.length);
  assert.equal(sceneFor(5, "2026-11-18"), sceneFor(5, "2026-11-18"));
  assert.ok(Array.from({ length: 20 }, (_, id) => sceneFor(id + 1, "2026-11-18").key).some(key => key !== sceneFor(1, "2026-11-18").key));
  for (const scene of SCENES) {
    assert.match(scene.key, /^[a-z]+$/u);
    assert.ok(Buffer.byteLength(`h:${scene.key}:1`) <= 64, "кнопка Telegram — не больше 64 байт");
    assert.equal(scene.options.length, 2);
    for (const [label, outcome] of scene.options) { assert.ok(label.length <= 22, label); assert.ok(outcome.length > 20); }
    // Род собеседника в тексте не звучит: «остался», «пришёл», «сам» — нельзя.
    assert.doesNotMatch(`${scene.text} ${scene.options.map(option => option[1]).join(" ")}`, /\b(?:остался|пришел|пришёл|сделал|выбрал|решил)\b|\{[^}]*(?:сам|ся)\|/u);
  }
  // Чувство к человеку и усталость сильнее часа; ночью она дремлет; незнакомое настроение — «дело».
  assert.deepEqual([herKey("обиженное", 2), herKey("ревнивое", 14), herKey("уставшее", 3), herKey("деловое", 2), herKey("деловое", 14), herKey("игривое", 16), herKey("уютное", 20), herKey("сонное", 23), herKey("новое", 12)],
    ["обида", "ревность", "устала", "сон", "дело", "игра", "уют", "сон", "дело"]);
  // Байт: свежая забота видна три часа; ночью спит; некормленый — чаще голоден.
  assert.equal(catState({ hour: 14, last: "pet", lastAt: 1000, at: 2000 }), "ласка");
  assert.equal(catState({ hour: 14, last: "feed", lastAt: 1000, at: 1000 + FRESH_MS - 1 }), "сыт");
  assert.equal(catState({ hour: 14, last: "play", lastAt: 1000, at: 2000 }), "игра");
  assert.equal(catState({ hour: 14, last: "pet", lastAt: 1000, at: 1000 + FRESH_MS, seed: 0 }), "голоден", "через три часа — снова сам по себе");
  assert.equal(catState({ hour: 2, seed: 0 }), "спит");
  assert.deepEqual([0, 1, 2, 3].map(seed => catState({ hour: 14, seed })), ["голоден", "шалит", "голоден", "спит"]);
  assert.deepEqual([0, 1, 2].map(seed => catState({ hour: 14, fed: true, seed })), ["шалит", "сыт", "спит"]);
  assert.equal(catState({ hour: 14, last: "hurt", lastAt: 1000, at: 2000 }), "обижен");
  // Колючка: полита — пока с полива не прошло пяти дней.
  assert.deepEqual([plantState({ water: 0, at: 5 }), plantState({ water: 1000, at: 2000 }), plantState({ water: 1000, at: 1000 + WATER_EVERY_MS })], ["сухо", "полита", "сухо"]);
});

test("словарь: у каждого запаса комнаты есть строка любому — хозяину и гостю, на «ты» и на «вы», в любой час и в любом её состоянии", () => {
  const names = ["зайти", "окно", "подсказка", ...["дело", "уют", "игра", "сон", "устала", "обида", "ревность"].map(key => `она:${key}`),
    ...["голоден", "сыт", "спит", "ласка", "игра", "шалит", "обижен", "защита", "зов"].map(key => `байт:${key}`), "колючка:полита", "колючка:сухо", "мириться",
    ...["погладить", "покормить", "поиграть", "чай"].flatMap(key => [key, `${key}:ещё`]), "полить", "полить:рано", ...ITEMS.map(item => `вещь:${item.key}`)];
  for (const name of names) {
    assert.ok(pool(name).length >= 1, `запаса «+комната:${name}» нет`);
    for (const part of ["утро", "день", "вечер", "ночь"]) for (const owner of [true, false]) for (const formal of [true, false]) for (const level of ["cold", "known", "warm", "close"]) {
      for (const state of [{}, { hurt: true }, { tired: true }, { jealous: true }, { glad: true }]) {
        const line = book.pick(`+комната:${name}`, { part, owner, formal: owner ? true : formal, level: owner ? "close" : level, isPrivate: true, vars: VARS, ...state });
        assert.ok(line && line.length > 5, `«+комната:${name}»: пусто для ${JSON.stringify({ part, owner, formal, level, state })}`);
        assert.doesNotMatch(line, /[{}]/u, `«+комната:${name}»: неподставленное в «${line}»`);
      }
    }
  }
  // Окно — по часу: на каждое время суток свои строки, и ни одной «на все времена».
  for (const part of ["утро", "день", "вечер", "ночь"]) {
    const seen = new Set();
    for (const roll of [0, 0.34, 0.67, 0.99]) seen.add(createPhrasebook({ random: () => roll }).pick("+комната:окно", { part, formal: true }));
    assert.ok(seen.size >= 3, `окно, ${part}: ${seen.size}`);
  }
  assert.match(book.pick("+комната:вещь:абажур", { formal: true, vars: { "цвет": "синий" } }), /Цвет — синий: ваш любимый/u);
  assert.match(book.pick("+комната:вещь:рисунок", { formal: false, vars: { "рисунок": "кот в шляпе" } }), /«кот в шляпе».*рисовала тебе/u);
});

test("гость в личке: зашёл — окно, она, Байт, подсказка и сценка дня с двумя кнопками; второй заход за день — без сценки", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  const result = await h.onMessage(message("Зайду к тебе в гости"), KEY);
  assert.equal(result.ok, true);
  assert.equal(chats().length, 0, "модель не спрошена");
  const [scene, offer] = toChat(5);
  assert.equal(toChat(5).length, 2, "комната и сценка дня");
  const lines = scene.text.split("\n");
  assert.equal(lines.length, 4, scene.text);
  assert.ok(inPool("зайти", lines[0]), lines[0]);
  assert.ok(pool("окно").filter(line => /^(?:День|За окном — город|Дневной)/u.test(line)).some(line => lines[1].startsWith(line)), `окно дневное: ${lines[1]}`);
  assert.ok(inPool("она:дело", lines[1]) || inPool("она:уют", lines[1]) || inPool("она:игра", lines[1]), lines[1]);
  assert.ok(["голоден", "шалит", "спит"].some(state => inPool(`байт:${state}`, lines[2])), lines[2]);
  assert.equal(lines[3], "Можно погладить Байта, покормить его, поиграть с ним, налить мне чаю или полить Колючку — просто скажите.");
  // Сценка — та, что положена этому человеку сегодня; кнопки — её два решения.
  const today = sceneFor(5, "2026-11-18");
  assert.equal(offer.text, `🐾 ${today.text.replace(/\{[^|}]*\|([^}]*)\}/gu, "$1")}`);
  assert.deepEqual(offer.reply_markup, { inline_keyboard: [[{ text: today.options[0][0], callback_data: `h:${today.key}:0` }, { text: today.options[1][0], callback_data: `h:${today.key}:1` }]] });
  assert.deepEqual([roomOf(5).n, roomOf(5).scene], [1, { day: "2026-11-18", key: today.key, pick: null }]);

  await h.onMessage(message("можно к тебе?"), KEY);
  assert.equal(toChat(5).length, 3, "сценка уже была: второй раз за день не предлагается");
  assert.equal(last().split("\n").length, 4, "подсказка звучит ещё и во второй заход");
  await h.onMessage(message("загляну к тебе"), KEY);
  assert.equal(last().split("\n").length, 3, "а в третий — уже нет");
  assert.equal(roomOf(5).n, 3);
  assert.equal(chats().length, 0);
});

test("забота: первый раз за день — свои слова и шаг в отношениях, второй — «он уже ел»; Байт помнит три часа; на другой день считается снова", async () => {
  reset();
  const time = clock();
  const h = heart(ON, { now: time.now, random: () => 0 });
  await h.onMessage(message("покормлю Байта"), KEY);
  assert.ok(inPool("покормить", last()), last());
  assert.equal(relationOf(5).deeds.caress, NOON, "забота засчитана в отношения");
  assert.deepEqual([bondOf(5).c.caress, bondOf(5).last.caress >= NOON], [1, true], "и она этому рада");
  assert.deepEqual([roomOf(5).care, roomOf(5).cared, roomOf(5).done], [1, "2026-11-18", { feed: 1 }]);
  const sympathy = relationOf(5).sympathy;

  time.add(60_000);
  await h.onMessage(message("покорми Байта"), KEY);
  assert.ok(inPool("покормить:ещё", last()), last());
  await h.onMessage(message("как там Байт?"), KEY);
  assert.ok(inPool("байт:сыт", last()), last());
  await h.onMessage(message("глажу Байта за ухом"), KEY);
  assert.ok(inPool("погладить", last()), last());
  await h.onMessage(message("как Байт"), KEY);
  assert.ok(inPool("байт:ласка", last()), `последняя забота видна первой: ${last()}`);
  await h.onMessage(message("поиграю с Байтом"), KEY);
  assert.ok(inPool("поиграть", last()), last());
  await h.onMessage(message("налью тебе чаю"), KEY);
  assert.ok(inPool("чай", last()), last());
  await h.onMessage(message("держи чай"), KEY);
  assert.ok(inPool("чай:ещё", last()), last());
  assert.deepEqual([roomOf(5).care, relationOf(5).sympathy, relationOf(5).deeds.caress], [1, sympathy, NOON], "за день забота считается один раз, сколько бы её ни было");
  assert.deepEqual(roomOf(5).done, { feed: 2, pet: 1, play: 1, tea: 2 });

  // Через три часа Байт снова сам по себе: кормили — значит, не голоден.
  time.add(FRESH_MS + 60_000);
  await h.onMessage(message("что делает Байт"), KEY);
  assert.ok(["шалит", "сыт", "спит"].some(state => inPool(`байт:${state}`, last())), last());
  assert.equal(inPool("байт:голоден", last()), false);

  // Другой день: счётчики дня с нуля, забота считается снова.
  time.set(NOON + DAY + HOUR);
  await h.onMessage(message("покормлю Байта"), KEY);
  assert.ok(inPool("покормить", last()), last());
  assert.deepEqual([roomOf(5).care, roomOf(5).cared, roomOf(5).done], [2, "2026-11-19", { feed: 1 }]);
  assert.equal(relationOf(5).deeds.caress, NOON + DAY + HOUR);
  assert.equal(chats().length, 0, "модель не спрошена ни разу");
});

test("короткие слова: «покормить», «погладить его», «налить чаю» — о комнате полчаса после захода; без захода и позже — нет", async () => {
  reset();
  const time = clock();
  const h = heart(ON, { now: time.now, random: () => 0 });
  // Без захода короткое — не о Байте: «поиграть с ним» уходит модели, «покормить» — действие с ней самой (как и было),
  // «кормлю кота» — о своём коте, тема словаря.
  sdk().fetchQueue.push(says("С кем?"));
  await h.onMessage(message("поиграть с ним"), KEY);
  assert.equal(chats().length, 1);
  await h.onMessage(message("покормить"), KEY);
  assert.equal(inPool("покормить", last()), false, last());
  await h.onMessage(message("кормлю кота"), KEY);
  assert.equal(chats().length, 1, "словарь: «звери дома»");
  assert.equal(roomOf(5), null, "комната не тронута");

  // Спросил о Байте — и ответил на то, что увидел.
  await h.onMessage(message("как там Байт"), KEY);
  assert.ok(Number(roomOf(5).near) === NOON, "заглянул — час отмечен");
  time.add(60_000);
  await h.onMessage(message("покормить"), KEY);
  assert.ok(inPool("покормить", last()), last());
  await h.onMessage(message("погладить его"), KEY);
  assert.ok(inPool("погладить", last()), last());
  await h.onMessage(message("поиграть с ним"), KEY);
  assert.ok(inPool("поиграть", last()), last());
  await h.onMessage(message("налить чаю"), KEY);
  assert.ok(inPool("чай", last()), last());
  await h.onMessage(message("полить"), KEY);
  assert.ok(inPool("полить", last()), last());
  await h.onMessage(message("как кот?"), KEY);
  assert.ok(inPool("байт:игра", last()), last());
  assert.deepEqual(roomOf(5).done, { feed: 1, pet: 1, play: 1, tea: 1, water: 1 });
  assert.equal(chats().length, 1, "модель больше не спрошена");

  // Через полчаса после последнего слова о комнате короткое снова не о ней.
  time.add(CONTEXT_MS + 1000);
  sdk().fetchQueue.push(says("С кем?"));
  await h.onMessage(message("поиграть с ним"), KEY);
  assert.equal(chats().length, 2);
  assert.deepEqual(roomOf(5).done, { feed: 1, pet: 1, play: 1, tea: 1, water: 1 });
  // Репетиция в хранилище не ходит: короткое для неё — не о комнате, даже когда человек в ней.
  await h.onMessage(message("как там Байт"), KEY);
  const before = sdk().kv.get(ROOM_KEY(5));
  const sent = toChat(5).length;
  await h.onMessage(message("поиграть с ним"), { ...KEY, testRun: true });
  assert.equal(sdk().kv.get(ROOM_KEY(5)), before);
  assert.equal(toChat(5).length, sent);
});

test("Байта не обидеть: «пни Байта» — её отказ, а не «Аи пинает … байта»; он прячется, ласка мирит; в отношения это не идёт", async () => {
  reset();
  const time = clock();
  const h = heart(ON, { now: time.now, random: () => 0 });
  for (const said of ["пни Байта", "укуси Байта", "дёрни Байта за хвост"]) {
    await h.onMessage(message(said), KEY);
    assert.ok(inPool("байт:защита", last()), `${said}: ${last()}`);
    assert.doesNotMatch(last(), /пинает|кусает|Желание исполнено/u, last());
  }
  assert.equal(calls("sendAnimation").length, 0, "гифки с действием нет");
  assert.deepEqual([roomOf(5).last, roomOf(5).care, relationOf(5)?.deeds?.rude ?? null], ["hurt", 0, null], "это игра: ни заботы, ни грубости");
  await h.onMessage(message("как там Байт"), KEY);
  assert.ok(inPool("байт:обижен", last()), last());
  // Пришли с лаской — он мирится: особая строка, а забота засчитана как обычно.
  time.add(60_000);
  await h.onMessage(message("погладить Байта"), KEY);
  assert.ok(inPool("мириться", last()), last());
  assert.deepEqual([roomOf(5).last, roomOf(5).care, roomOf(5).done], ["pet", 1, { pet: 1 }]);
  await h.onMessage(message("как Байт"), KEY);
  assert.ok(inPool("байт:ласка", last()), last());
  // Позвать — придёт или нет, решает он; «разбуди Байта» — не действие с человеком.
  for (const said of ["Байт, иди сюда", "разбуди Байта", "позови кота"]) {
    await h.onMessage(message(said), KEY);
    assert.ok(inPool("байт:зов", last()), `${said}: ${last()}`);
  }
  // В группе — то же: её кот, её отказ.
  await h.onMessage(group("Аи, пни Байта", { id: 6 }), KEY);
  assert.ok(inPool("байт:защита", toChat(-10).at(-1).text), toChat(-10).at(-1).text);
  assert.equal(chats().length, 0);
});

test("Колючка: поливают не чаще раза в пять дней — раньше «ей пока хватит», и в заботу это не идёт", async () => {
  reset();
  const time = clock();
  const h = heart(ON, { now: time.now, random: () => 0 });
  await h.onMessage(message("как Колючка?"), KEY);
  assert.ok(inPool("колючка:сухо", last()), last());
  await h.onMessage(message("полью Колючку"), KEY);
  assert.ok(inPool("полить", last()), last());
  assert.equal(roomOf(5).water, NOON);
  await h.onMessage(message("как Колючка?"), KEY);
  assert.ok(inPool("колючка:полита", last()), last());
  time.add(2 * DAY);
  await h.onMessage(message("полить кактус"), KEY);
  assert.ok(inPool("полить:рано", last()), last());
  assert.deepEqual([roomOf(5).water, roomOf(5).care, roomOf(5).cared], [NOON, 1, "2026-11-18"], "ранний полив ничего не меняет");
  time.set(NOON + WATER_EVERY_MS);
  await h.onMessage(message("поливаю кактус"), KEY);
  assert.ok(inPool("полить", last()) && !inPool("полить:рано", last()), last());
  assert.deepEqual([roomOf(5).water, roomOf(5).care], [NOON + WATER_EVERY_MS, 2]);
});

test("сценка дня: нажатие — исход и забота, кнопки убраны; второй раз — «уже сыграна»; чужая кнопка не срабатывает", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  await h.onMessage(message("зайду к тебе"), KEY);
  const today = sceneFor(5, "2026-11-18");
  const before = toChat(5).length;
  // Чужой человек жмёт кнопку этой сценки: у него такой нет.
  assert.deepEqual(await h.onCallback(press(`h:${today.key}:1`, 6), KEY), { ignored: true, reason: "gone" });
  assert.equal(calls("answerCallbackQuery").at(-1).text, "Это не ваша сценка — или её день прошёл.");
  assert.equal(toChat(6).length, 0);

  const pressed = await h.onCallback(press(`h:${today.key}:1`), KEY);
  assert.deepEqual(pressed, { ok: true, action: "room_scene", scene: today.key, pick: 1 });
  assert.equal(toChat(5).length, before + 1);
  assert.equal(last(), `«${today.options[1][0]}». ${today.options[1][1].replace(/\{[^|}]*\|([^}]*)\}/gu, "$1")}`);
  assert.deepEqual(calls("editMessageReplyMarkup").at(-1), { chat_id: 5, message_id: 900, reply_markup: { inline_keyboard: [] } });
  assert.deepEqual([roomOf(5).scene.pick, roomOf(5).care, roomOf(5).cared], [1, 1, "2026-11-18"]);
  assert.equal(relationOf(5).deeds.caress, NOON, "выбор в сценке — тоже забота");

  assert.deepEqual(await h.onCallback(press(`h:${today.key}:0`), KEY), { ignored: true, reason: "played" });
  assert.equal(calls("answerCallbackQuery").at(-1).text, "Эта сценка уже сыграна.");
  assert.equal(toChat(5).length, before + 1, "второго исхода нет");
  // Мусор в кнопке и репетиция платформы — тихо.
  assert.deepEqual(await h.onCallback(press("h:нет:5"), KEY), { ignored: true });
  assert.deepEqual(await h.onCallback(press(`h:${today.key}:0`), { ...KEY, testRun: true }), { ok: true, route: "room", side_effects: "none" });
  assert.equal(chats().length, 0);
});

test("вещи: появляются по дням знакомства — не больше двух за заход; «что нового в комнате» — весь список; любимый цвет и её рисунок — на месте", async () => {
  reset();
  // Знакомы тридцать пять дней: положены кружка, тапочки, подушка и снимок.
  sdk().kv.set(FIRST_KEY(5), JSON.stringify({ at: NOON - 35 * DAY }));
  const time = clock();
  const h = heart(ON, { now: time.now, random: () => 0 });
  await h.onMessage(message("зайду к тебе"), KEY);
  const first = toChat(5)[0].text;
  assert.equal((first.match(/Новое в комнате\./gu) ?? []).length, NEWS_AT_ONCE, first);
  assert.match(first, /Новое в комнате\. На полке появилась вторая кружка\. Ваша\.\nНовое в комнате\. У двери — тапочки для гостя\. Размер я угадала\./u);
  assert.deepEqual(roomOf(5).seen, ["кружка", "тапочки"]);
  await h.onMessage(message("зайду к тебе"), KEY);
  assert.match(last(), /Новое в комнате\. На подоконнике — вторая подушка: смотреть на дождь вдвоём\.\nНовое в комнате\. На полке — рамка: наш первый разговор\./u);
  await h.onMessage(message("зайду к тебе"), KEY);
  assert.doesNotMatch(last(), /Новое в комнате/u, "всё показано — повторов нет");

  await h.onMessage(message("что нового в комнате?"), KEY);
  assert.equal(last(), "Из-за вас в комнате появилось: вторая кружка — для гостя; тапочки у двери; вторая подушка на подоконнике; рамка с нашим первым разговором. Следующая появится через 25 дней.");

  // Назвал любимый цвет — на лампе новый абажур; она рисовала ему — рисунок на стене.
  await h.onMessage(message("мой любимый цвет — синий"), KEY);
  sdk().kv.set("heart:album:5", JSON.stringify({ items: [{ q: "кот в шляпе", at: NOON }], at: NOON }));
  await h.onMessage(message("зайду к тебе"), KEY);
  assert.match(last(), /Новое в комнате\. На лампе — новый абажур\. Цвет — синий: ваш любимый\.\nНовое в комнате\. На стене — мой рисунок: «кот в шляпе»\. Тот самый, что я рисовала вам\./u);

  // Новый знакомый: вещей ещё нет — и сказано, когда появится первая.
  reset();
  const fresh = heart(ON, { now: () => NOON, random: () => 0 });
  await fresh.onMessage(message("что нового в комнате"), KEY);
  assert.equal(last(), "Пока всё как было: окно, дождь, лампа, плед и Байт. Вещи появляются сами — чем дольше мы знакомы и чем чаще вы заходите. Следующая появится через 3 дня.");
  assert.equal(chats().length, 0);
});

test("хозяин и группа: хозяину — его строки; «погладь Байта» — о коте, а не ролевое действие; при всех — без сценки и без новостей о вещах", async () => {
  reset();
  sdk().kv.set(FIRST_KEY(OWNER), JSON.stringify({ at: NOON - 10 * DAY }));
  // Зерно у края: из подходящих строк берётся последняя — у хозяина это его строка.
  const h = heart(ON, { now: () => NOON, random: () => 0.999999 });
  await h.onMessage(own("погладь Байта"), KEY);
  assert.match(last(OWNER), /хозяин/u);
  assert.ok(inPool("погладить", last(OWNER)), last(OWNER));
  assert.doesNotMatch(last(OWNER), /гладит/u, "не «Аи гладит … байта»");
  assert.equal(relationOf(OWNER), null, "у хозяина отношения и так на пределе — запись не заводится");
  assert.equal(bondOf(OWNER).c.caress, 1, "а рада она и ему");
  await h.onMessage(own("зайду к тебе"), KEY);
  assert.match(toOwner().at(-2).text, /^(?:Заходите, хозяин\. Ваше кресло у окна|Хозяин! Проходите, я как раз о вас думала|С возвращением, хозяин\. Чайник уже греется)\./u);
  assert.match(toOwner().at(-2).text, /Новое в комнате\. На полке появилась вторая кружка\. Ваша\./u);
  assert.match(toOwner().at(-1).text, /^🐾 /u);

  // В группе: зайти и спросить о Байте можно, но вещи и сценка — личное.
  const before = toChat(-10).length;
  await h.onMessage(group("Аи, зайду к тебе", { id: OWNER }), KEY);
  assert.equal(toChat(-10).length, before + 1, "без сценки дня");
  assert.doesNotMatch(toChat(-10).at(-1).text, /Новое в комнате|хозяин/u, "при всех — ни вещей, ни «хозяина»");
  assert.deepEqual(roomOf(OWNER).seen, ["кружка", "тапочки"], "показанное в личке при всех не сбрасывается");
  // Тот, кто в личке ещё не был: при всех ему ни вещей, ни сценки — они дождутся лички.
  sdk().kv.set(FIRST_KEY(6), JSON.stringify({ at: NOON - 10 * DAY }));
  const sentBefore = toChat(-10).length;
  await h.onMessage(group("Аи, можно к тебе?", { id: 6 }), KEY);
  assert.equal(toChat(-10).length, sentBefore + 1, "одно сообщение: без сценки");
  assert.doesNotMatch(toChat(-10).at(-1).text, /Новое в комнате|🐾/u);
  assert.deepEqual([roomOf(6).seen, roomOf(6).scene, roomOf(6).n], [[], null, 1]);
  await h.onMessage(message("зайду к тебе", { id: 6 }), KEY);
  assert.match(toChat(6).at(-2).text, /Новое в комнате\. На полке появилась вторая кружка\./u, "в личке — и вещи");
  assert.match(toChat(6).at(-1).text, /^🐾 /u, "и сценка дня");
  await h.onMessage(group("Аи, как там Байт?", { id: 6 }), KEY);
  assert.ok(["голоден", "шалит", "спит", "ласка"].some(state => inPool(`байт:${state}`, toChat(-10).at(-1).text, { formal: true })), toChat(-10).at(-1).text);
  assert.equal(chats().length, 0);
});

test("выключатели и репетиция: без словаря и с ROOM: false слова о комнате идут модели; репетиция ничего не пишет", async () => {
  for (const settings of [{ PHRASES: true, ROOM: false }, { PHRASES: false }]) {
    reset();
    const h = heart(settings, { now: () => NOON });
    sdk().fetchQueue.push(says("Байт спит."));
    await h.onMessage(message("как там Байт"), KEY);
    assert.equal(chats().length, 1, JSON.stringify(settings));
    assert.equal(roomOf(5), null);
  }
  reset();
  const h = heart(ON, { now: () => NOON });
  for (const said of ["зайду к тебе", "покормлю Байта", "как там Байт", "налью тебе чаю"]) {
    const dry = await h.onMessage(message(said), { ...KEY, testRun: true });
    assert.equal(dry.ok, true, said);
  }
  assert.equal(toChat(5).length, 0);
  assert.equal(roomOf(5), null, "репетиция в хранилище не пишет");
  assert.equal(chats().length, 0);
});

test("запись: хранилище молчит — комната всё равно отвечает, забота просто не считается", async () => {
  const room = createRoom({ store: { available: false }, now: () => NOON });
  assert.deepEqual((await room.read(5)).done, {});
  const visit = await room.visit(5, { day: "2026-11-18", keys: ["кружка"], scenes: true });
  assert.deepEqual([visit.first, visit.fresh, visit.scene, visit.saved], [true, ["кружка"], null, false], "сценку без записи не предлагаем: её нельзя будет сыграть");
  const care = await room.care(5, "pet", { day: "2026-11-18" });
  assert.deepEqual([care.ok, care.again, care.first], [true, false, false]);
  assert.deepEqual(await room.choose(5, "cactus", 0, { day: "2026-11-18" }), { ok: false, code: "gone" });
  assert.deepEqual(await room.care(5, "dance"), { ok: false, code: "unknown" });
});

test("«удали всё обо мне» стирает и комнату; сказанное о комнате остаётся в переписке — модель знает, о чём речь", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  await h.onMessage(message("как там Байт"), KEY);
  const seen = last();
  // Следом — вопрос, на который у словаря ответа нет: модель получает и вопрос о Байте, и её ответ.
  sdk().fetchQueue.push(says("Потому что он кот."));
  await h.onMessage(message("а почему он так себя ведёт, как ты думаешь, расскажи подробно"), KEY);
  const asked = JSON.parse(sdk().fetches.at(-1).options.body).messages.map(item => item.content).join("\n");
  assert.ok(asked.includes("как там Байт") && asked.includes(seen), "переписка о комнате дошла до модели");

  await h.onMessage(message("покормлю Байта"), KEY);
  assert.ok(roomOf(5), "запись о комнате есть");
  await h.onMessage(message("удали всё обо мне"), KEY);
  await h.onMessage(message("да, удали всё"), KEY);
  assert.equal(roomOf(5), null, "и её больше нет");
});
