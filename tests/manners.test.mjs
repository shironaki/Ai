/**
 * Манеры («акценты»): выбор словом и кнопкой, добавки к ответам, «всё сразу»
 * у хозяина, «не люблю аниме», вопрос «какой мне быть?».
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, hers, reset, last, calls, chats, says, sdk, system, source, toChat, dice, OWNER, KEY, DAY } from "./fixtures/kit.mjs";

const { parseAccent, garnish, accentOf, likesAnime, keyboard, randomAccent, ACCENTS } = await import("../tgcloud/lib/accents.js");
const { createPhrasebook } = await import("../tgcloud/lib/phrasebook.js");

const ON = { PHRASES: true, MANNERS: true };
const NOON = Date.parse("2026-11-18T09:00:00Z");
const book = createPhrasebook();
const pool = (name) => book.pool(name, { formal: true });
const press = (h, data, { id = 5, chat = id, type = "private", name = "Тест", messageId = 900 } = {}) => h.onCallback({
  id: `q${id}${data}`, from: { id, first_name: name }, data, message: { message_id: messageId, chat: { id: chat, type } },
}, KEY);
const gif = (category) => source(`nekos.best/api/v2/${category}`, { results: [{ url: `https://nekos.best/api/v2/${category}/001.gif` }] });

test("разбор: манера словом, выбор, случай, «не люблю аниме»; остальное — не манера", () => {
  const cases = {
    "будь кошкой": { set: "cat" }, "Стань лисой!": { set: "fox" }, "говори как цундере": { set: "tsundere" }, "будь собой": { set: "plain" }, "стань обычной": { set: "plain" },
    "будь строгой": { set: "strict" }, "побудь старшей сестрой": { set: "sister" }, "будь пираткой": { set: "pirate" }, "будь роботом": { set: "robot" }, "будь милашкой": { set: "cute" },
    "будь всем сразу": { set: "mix" }, "зови семпаем": null, "будь кохаем": { set: "senpai" },
    "смени манеру": { show: true }, "какой ты можешь быть?": { show: true }, "какие у тебя есть личности": { show: true }, "выбери образ": { show: true },
    "удиви меня": { random: true }, "будь случайной": { random: true }, "случайная манера": { random: true },
    "не люблю аниме": { anime: false }, "без аниме": { anime: false }, "не присылай аниме-гифки": { anime: false }, "я люблю аниме": { anime: true }, "можно аниме": { anime: true },
  };
  for (const [said, want] of Object.entries(cases)) assert.deepEqual(parseAccent(said), want, said);
  for (const said of ["будь серьёзнее", "будь моей девушкой", "будь добра, подскажи время", "стань лучше", "зови меня Вася", "кошка", "люблю аниме про спорт", "", "будь ".repeat(30)]) assert.equal(parseAccent(said), null, said);
});

test("добавки: хвост, обращение, начало и конец, смайлик на месте, списки не трогаются", () => {
  const low = () => 0; // всё срабатывает
  const text = "Привет. Как дела? 🙂\n• пункт списка\nВсё будет хорошо!";
  assert.equal(garnish(text, { accent: "cat", pool, random: low }), "Привет, мяу. Как дела, мяу? 🙂\n• пункт списка\nВсё будет хорошо, мяу!");
  assert.equal(garnish(text, { accent: "senpai", pool, random: low }), "Привет, семпай. Как дела? 🙂\n• пункт списка\nВсё будет хорошо!");
  assert.equal(garnish(text, { accent: "tsundere", pool, random: low }), "Хмф. Привет. Как дела? 🙂\n• пункт списка\nВсё будет хорошо! Не то чтобы я старалась ради вас.");
  assert.equal(garnish(text, { accent: "cute", pool, random: low }), "Привет. Как дела? 🙂\n• пункт списка\nВсё будет хорошо! (≧▽≦)");
  assert.equal(garnish(text, { accent: "strict", pool, random: low }), "Привет. Как дела?\n• пункт списка\nВсё будет хорошо!");
  assert.equal(garnish(text, { accent: "master", owner: true, pool, random: low }), "Привет, хозяин. Как дела? 🙂\n• пункт списка\nВсё будет хорошо!");
  assert.equal(garnish(text, { accent: "plain", pool, random: low }), text);
  // Смайлик в конце остаётся в конце; уже сказанное слово не повторяется.
  assert.equal(garnish("Пока 😊", { accent: "cat", pool, random: low }), "Пока, мяу 😊");
  assert.equal(garnish("Мяу. Я тут.", { accent: "cat", pool, random: low }), "Мяу. Я тут.");
  assert.equal(garnish("С возвращением, хозяин.", { accent: "master", owner: true, pool, random: low }), "С возвращением, хозяин.");
  assert.equal(garnish("Сегодня:\n1. чай\n2. сон", { accent: "cat", pool, random: low }), "Сегодня:\n1. чай\n2. сон", "служебный список — не речь");
  assert.equal(garnish("🙂", { accent: "strict", pool }), "🙂", "из одного смайлика пустоты не делает");
  // «Всё сразу»: в каждом ответе что-то есть, и это слова из разных манер.
  const seen = new Set();
  for (let seed = 0; seed < 40; seed += 1) {
    let step = seed;
    const made = garnish("Привет. Я рядом.", { accent: "mix", owner: true, pool, random: () => ((step = (step * 9301 + 49297) % 233280) / 233280) });
    assert.notEqual(made, "Привет. Я рядом.", "всё сразу — не «ничего»");
    for (const word of ["хозяин", "господин", "семпай", "мяу", "ня", "мур", "фыр", "тяф"]) if (made.includes(word)) seen.add(word);
  }
  assert.ok(seen.has("семпай") && (seen.has("хозяин") || seen.has("господин")) && (seen.has("мяу") || seen.has("ня") || seen.has("мур")), [...seen].join(","));
});

test("выбор: у хозяина без выбора — всё сразу, у остальных — обычная; «хозяина» другим не выбрать", () => {
  assert.equal(accentOf({}, { owner: true }), "mix");
  assert.equal(accentOf({}, {}), "plain");
  assert.equal(accentOf({ accent: "master" }, {}), "plain");
  assert.equal(accentOf({ accent: "master" }, { owner: true }), "master");
  assert.equal(likesAnime({ accent: "strict" }), false);
  assert.equal(likesAnime({ anime: false }), false);
  assert.equal(likesAnime({ accent: "cat" }), true);
  const flat = keyboard({ owner: false }).inline_keyboard.flat();
  assert.ok(!flat.some(item => item.callback_data === "m:master"));
  assert.ok(flat.some(item => item.callback_data === "m:random"));
  assert.ok(keyboard({ owner: true, current: "cat" }).inline_keyboard.flat().some(item => item.callback_data === "m:master"));
  assert.match(keyboard({ current: "cat" }).inline_keyboard.flat().find(item => item.callback_data === "m:cat").text, /^✓ /u);
  for (let index = 0; index < 20; index += 1) assert.ok(!["plain", "strict", "mix", "master"].includes(randomAccent({ random: () => index / 20 })));
  assert.ok(ACCENTS.length >= 12);
});

test("словом: «будь кошкой» — и словарь, и модель отвечают по-кошачьи; «будь собой» — как раньше", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  await h.onMessage(message("будь кошкой"), KEY);
  assert.equal(last(), "Буду кошкой, мяу.");
  await h.onMessage(message("привет"), KEY);
  assert.equal(last(), "Привет, мяу.");
  sdk().fetchQueue.push(says("Это столица Франции. Город на Сене."));
  await h.onMessage(message("расскажи, что за город Париж"), KEY);
  assert.equal(last(), "Это столица Франции, мяу. Город на Сене, мяу.");
  assert.match(system(), /Манера по выбору собеседника — кошачья/u, "модель знает о манере");
  await h.onMessage(message("будь собой"), KEY);
  assert.equal(last(), "Хорошо, остаюсь собой — без добавок.");
  await h.onMessage(message("доброе утро"), KEY);
  assert.doesNotMatch(last(), /мяу/u);
  // Служебные ответы манерой не украшаются.
  await h.onMessage(message("будь кошкой"), KEY);
  await h.onMessage(message("наши шутки"), KEY);
  assert.doesNotMatch(last(), /мяу/u);
});

test("кнопками: вопрос с выбором, нажатие сохраняет манеру нажавшему; случайная; «хозяин» — только хозяину", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  const asked = await h.onMessage(message("какой ты можешь быть?"), KEY);
  assert.equal(asked.action, "manner_ask");
  const sent = toChat(5).at(-1);
  assert.match(sent.text, /Какой мне быть в общении с вами\?\nСейчас я — обычная\./u);
  const buttons = sent.reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.map(item => item.callback_data), ["m:plain", "m:cat", "m:fox", "m:senpai", "m:tsundere", "m:cute", "m:sister", "m:pirate", "m:robot", "m:strict", "m:mix", "m:random"]);

  const done = await press(h, "m:tsundere");
  assert.equal(done.accent, "tsundere");
  assert.equal(calls("editMessageText").at(-1).text, "Ладно уж, буду цундере.");
  await h.onMessage(message("привет"), KEY);
  assert.match(last(), /^Хмф\. Привет\./u);

  const lucky = await press(h, "m:random");
  assert.notEqual(lucky.accent, "tsundere");
  assert.match(calls("editMessageText").at(-1).text, /^Выпало: /u);
  assert.equal((await press(h, "m:master")).ignored, true, "постороннему «хозяина» не выбрать");
  assert.equal((await press(h, "m:нет-такой")).ignored, true);

  // Хозяин: без выбора — всё сразу; может выбрать одну.
  await h.onMessage(message("смени манеру", { id: OWNER }), KEY);
  const mine = toChat(OWNER).at(-1);
  assert.match(mine.text, /Сейчас я — всё сразу\./u);
  assert.ok(mine.reply_markup.inline_keyboard.flat().some(item => item.callback_data === "m:master"));
  await h.onMessage(message("привет", { id: OWNER }), KEY);
  assert.match(last(OWNER), /хозяин|семпай|мяу|ня|мур|мрр|мяф|господин/iu);
  await press(h, "m:senpai", { id: OWNER });
  await h.onMessage(message("я вернулся", { id: OWNER }), KEY);
  assert.match(last(OWNER), /семпай|хозяин/u);

  // В группе выбирает каждый себе: кнопки остаются, ответ — отдельным сообщением.
  await press(h, "m:cat", { id: 21, chat: -10, type: "supergroup", name: "Вася" });
  assert.equal(toChat(-10).at(-1).text, "Вася: Буду кошкой, мяу.");
  await h.onMessage(group("Аи, привет", { id: 21, name: "Вася" }), KEY);
  assert.match(last(-10), /мяу/u);
  assert.equal(chats().length, 0);
});

test("сама спрашивает: один раз, в личке, знакомого человека — после ответа", async () => {
  reset();
  let at = NOON;
  const h = heart(ON, { now: () => at, random: () => 0 });
  await h.onMessage(message("привет"), KEY);
  assert.equal(toChat(5).length, 1, "при первом знакомстве не спрашивает");
  at += DAY;
  await h.onMessage(message("привет"), KEY);
  const asked = toChat(5).at(-1);
  assert.match(asked.text, /Какой мне быть/u);
  assert.ok(asked.reply_markup?.inline_keyboard?.length > 3);
  at += DAY;
  await h.onMessage(message("привет"), KEY);
  assert.doesNotMatch(toChat(5).at(-1).text, /Какой мне быть/u, "второй раз не спрашивает");
  // В группе — никогда.
  await h.onMessage(group("Аи, привет", { id: 21 }), KEY);
  at += DAY;
  await h.onMessage(group("Аи, привет", { id: 21 }), KEY);
  assert.ok(!toChat(-10).some(item => /Какой мне быть/u.test(item.text)));
});

test("«не люблю аниме» и «строгая»: действие остаётся, гифка — нет", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  gif("hug");
  const reply = { message_id: 70, from: { id: 22, first_name: "Маша", is_bot: false }, text: "всем привет" };
  await h.onMessage(group("обнял", { id: 21, name: "Вася", reply }), KEY);
  assert.equal(calls("sendAnimation").length, 1, "по умолчанию гифка есть");

  await h.onMessage(message("не люблю аниме", { id: 21 }), KEY);
  assert.match(last(21), /Аниме-гифок к вашим действиям не будет/u);
  await h.onMessage(group("обнял", { id: 21, name: "Вася", reply }), KEY);
  assert.equal(calls("sendAnimation").length, 1, "гифки больше нет");
  assert.match(toChat(-10).at(-1).text, /Вася<\/a> обнимает|Вася обнимает/u);

  await h.onMessage(message("можно аниме", { id: 21 }), KEY);
  await h.onMessage(group("обнял", { id: 21, name: "Вася", reply }), KEY);
  assert.equal(calls("sendAnimation").length, 2);

  await h.onMessage(message("будь строгой", { id: 23 }), KEY);
  assert.equal(last(23), "Хорошо. Без смайлов, без аниме, по делу.");
  await h.onMessage(group("обнял", { id: 23, name: "Пётр", reply }), KEY);
  assert.equal(calls("sendAnimation").length, 2, "строгая манера — тоже без гифок");
  // Её ответ на действие у «строгого» — тоже без гифки и без смайлов.
  await h.onMessage(message("погладить", { id: 23, reply: hers() }), KEY);
  assert.equal(calls("sendAnimation").length, 2);
});

test("выключено настройкой: манер нет, вопроса нет, хозяину ничего не добавляется", async () => {
  reset();
  let at = NOON;
  const h = heart({ PHRASES: true, MANNERS: false }, { now: () => at, random: dice(0.1, 0.9) });
  sdk().fetchQueue.push(says("Не поняла."));
  await h.onMessage(message("будь кошкой"), KEY);
  assert.equal(last(), "Не поняла.");
  at += DAY;
  await h.onMessage(message("привет", { id: OWNER }), KEY);
  at += DAY;
  await h.onMessage(message("привет", { id: OWNER }), KEY);
  assert.ok(!toChat(OWNER).some(item => /Какой мне быть|семпай|мяу/u.test(item.text)));
});

test("при всех «хозяин» не звучит: в группе хозяину — тепло, но без этого слова; в статусе — строка о словаре", async () => {
  reset();
  const h = heart(ON, { now: () => NOON });
  let mid = 500;
  const heard = new Set();
  for (let index = 0; index < 30; index += 1) {
    await h.onMessage(group("Аи, привет", { id: OWNER, name: "Сергей", extra: { message_id: (mid += 1) } }), KEY);
    assert.doesNotMatch(last(-10), /хозяин|господин/iu);
    heard.add(last(-10));
  }
  assert.ok([...heard].some(text => /семпай|мяу|ня|мур|мрр|мяф|фыр|тяф/u.test(text)), "остальная смесь в группе остаётся");
  let named = false;
  for (let index = 0; index < 30 && !named; index += 1) {
    await h.onMessage(message("привет", { id: OWNER }), KEY);
    named = /хозяин|господин/iu.test(last(OWNER));
  }
  assert.ok(named, "наедине — «хозяин»");
  assert.equal(chats().length, 0);
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Словарь: \d+ тем[аы]?, \d+ фраз[аы]? — на них модель не трачу · манеры — включены · память чата — выключена/u);
});
