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
const press = (h, data, { id = 5, chat = id, type = "private", name = "Тест", messageId = 900, extra = {} } = {}) => h.onCallback({
  id: `q${id}${data}`, from: { id, first_name: name }, data, message: { message_id: messageId, chat: { id: chat, type }, ...extra },
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

test("сама о манере не спрашивает: ни знакомого, ни хозяина, ни в группе", async () => {
  reset();
  let at = NOON;
  const h = heart(ON, { now: () => at, random: () => 0 });
  for (let day = 0; day < 4; day += 1) {
    await h.onMessage(message("привет"), KEY);
    await h.onMessage(message("привет", { id: OWNER }), KEY);
    await h.onMessage(group("Аи, привет", { id: 21 }), KEY);
    at += DAY;
  }
  for (const chat of [5, OWNER, -10]) {
    assert.ok(!toChat(chat).some(item => /Какой мне быть|какой мне быть/u.test(item.text) || item.reply_markup), `чат ${chat}: вопроса и кнопок нет`);
  }
  assert.equal(chats().length, 0);
});

test("вопрос хозяину: «сейчас я — всё сразу» сказано один раз", async () => {
  // Строка из словаря уже кончалась этими словами — и к ней добавлялись они же.
  for (const line of book.pool("+манера:вопрос", { formal: true, owner: true })) assert.doesNotMatch(line, /Сейчас я/u, line);
  for (let seed = 0; seed < 12; seed += 1) {
    reset();
    const h = heart(ON, { now: () => NOON, random: () => seed / 12 });
    await h.onMessage(message("какой ты можешь быть?", { id: OWNER }), KEY);
    const text = toChat(OWNER).at(-1).text;
    assert.equal(text.split("Сейчас я").length - 1, 1, text);
    assert.match(text, /\nСейчас я — всё сразу\.$/u);
  }
});

test("режим общения — в приветствии: /start называет его и предлагает сменить; «да», «какие?» — показывает выбор", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  await h.onMessage(message("/start"), KEY);
  assert.match(last(), /^Аи\. Я рядом\./u);
  assert.match(last(), /\n\nСейчас мой режим общения — обычная\. Не хотите ли его изменить\? Спросите «какие есть режимы» — покажу\.$/u);
  assert.equal(toChat(5).at(-1).reply_markup, undefined, "кнопок в приветствии нет: они — по просьбе");

  // Спросил, какие есть, — показывает выбор с кнопками.
  for (const said of ["какие есть режимы", "Какие режимы общения есть?", "какие у тебя режимы", "смени режим общения", "хочу другой режим", "режим общения"]) {
    const done = await h.onMessage(message(said), KEY);
    assert.equal(done.action, "manner_ask", said);
    assert.ok(toChat(5).at(-1).reply_markup.inline_keyboard.length > 3, said);
  }

  // Короткое «да», «хочу», «какие?» сразу после приветствия — тот же выбор; «нет» — остаётся как есть.
  // «Сразу» — буквально: следующим сообщением в личке (в Telegram его номер на единицу больше).
  const next = (text) => message(text, { extra: { message_id: sdk().sent.length + 1 } });
  for (const said of ["да", "хочу", "какие?", "Давай", "покажи", "а какие есть?"]) {
    reset();
    const fresh = heart(ON, { now: () => NOON, random: () => 0 });
    await fresh.onMessage(message("/start"), KEY);
    const done = await fresh.onMessage(next(said), KEY);
    assert.equal(done.action, "manner_ask", said);
    assert.match(toChat(5).at(-1).text, /Сейчас я — обычная\./u);
    // Предложение одно: второе «да» — уже не о режиме.
    sdk().fetchQueue.push(says("Что — да?"));
    await fresh.onMessage(next("да"), KEY);
    assert.equal(last(), "Что — да?", said);
  }
  reset();
  const calm = heart(ON, { now: () => NOON, random: () => 0 });
  await calm.onMessage(message("/start"), KEY);
  await calm.onMessage(next("нет"), KEY);
  assert.equal(last(), "Хорошо, остаюсь как есть. Передумаете — «какие есть режимы».");

  // Между приветствием и «да» было что-то ещё — «да» уже не о режиме: её могли спросить о другом.
  for (const said of ["да", "давай", "покажи", "хочу", "нет"]) {
    reset();
    const busy = heart(ON, { now: () => NOON, random: () => 0 });
    await busy.onMessage(message("/start"), KEY);
    sdk().fetchQueue.push(says("Могу рассказать сказку про дождь. Рассказать?"));
    await busy.onMessage(next("придумай две строчки про осенний дождь и фонари"), KEY);
    sdk().fetchQueue.push(says("Тогда слушайте."));
    const done = await busy.onMessage(next(said), KEY);
    assert.notEqual(done.action, "manner_ask", said);
    assert.equal(last(), "Тогда слушайте.", said);
  }
  // Чужие слова сразу после приветствия — не согласие: выбор не открывается.
  for (const said of ["привет", "ахаха", "спасибо", "не скажу", "а что ты умеешь?", "давай поговорим о погоде и о том, как прошёл день", "хочу узнать, как у тебя дела сегодня вечером",
    "какие у тебя планы на вечер, расскажи подробно", "покажи, пожалуйста, как выглядит северное сияние зимой"]) {
    reset();
    const other = heart(ON, { now: () => NOON, random: () => 0 });
    await other.onMessage(message("/start"), KEY);
    sdk().fetchQueue.push(says("Ответ модели."));
    const done = await other.onMessage(next(said), KEY);
    assert.notEqual(done?.action, "manner_ask", said);
    assert.ok(!toChat(5).at(-1)?.reply_markup, said);
  }

  // Предложение живёт недолго: «хочу» через час — обычные слова, а не выбор режима.
  reset();
  let at = NOON;
  const late = heart(ON, { now: () => at, random: () => 0 });
  await late.onMessage(message("/start"), KEY);
  at += 3_600_000;
  sdk().fetchQueue.push(says("Чего именно?"));
  await late.onMessage(next("хочу"), KEY);
  assert.equal(last(), "Чего именно?");

  // Хозяину — его режим; в группе приветствие то же, но «да» там — чужое слово.
  reset();
  const mine = heart(ON, { now: () => NOON, random: () => 0 });
  await mine.onMessage(message("/start", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Сейчас мой режим общения — всё сразу\./u);
  await mine.onMessage(group("/start", { id: 21 }), KEY);
  assert.match(last(-10), /Сейчас мой режим общения — обычная\./u);
  const before = toChat(-10).length;
  await mine.onMessage(group("да", { id: 21 }), KEY);
  assert.equal(toChat(-10).length, before, "в группе на «да» без обращения не отвечает");

  // Манеры выключены — в приветствии о режиме ни слова.
  reset();
  const off = heart({ PHRASES: true, MANNERS: false }, { now: () => NOON });
  await off.onMessage(message("/start"), KEY);
  assert.doesNotMatch(last(), /режим/u);
});

test("в группе выбор — одному: шёпотом, если Telegram позволяет; иначе кнопки видны всем, но слушаются спросившего", async () => {
  const eph = (item) => item.ephemeral_message_parameters;
  const keys = (item) => item.reply_markup.inline_keyboard.flat().map(button => button.callback_data);

  // 1. Она администратор чата: вопрос с кнопками видит только спросивший.
  reset();
  sdk().whispers = { admin: [-10] };
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  const asked = await h.onMessage(group("Аи, какие есть режимы", { id: 21, name: "Вася" }), KEY);
  assert.equal(asked.action, "manner_ask");
  assert.equal(asked.whispered, true);
  assert.equal(toChat(-10).length, 1);
  const whisper = toChat(-10)[0];
  assert.deepEqual(eph(whisper), { receiver_user_id: 21 });
  assert.equal(whisper.reply_parameters, undefined, "шёпот — без «ответа на сообщение»");
  assert.ok(keys(whisper).every(data => data.endsWith(":21")), "кнопки привязаны к спросившему");
  assert.deepEqual(keys(whisper).slice(0, 2), ["m:plain:21", "m:cat:21"]);

  // Нажал он — ответ остаётся шёпотом: правится то же сообщение, при всех ничего не говорится.
  const done = await press(h, "m:cat:21", { id: 21, chat: -10, type: "supergroup", name: "Вася", extra: { message_id: 0, ephemeral_message_id: 1 } });
  assert.equal(done.accent, "cat");
  assert.deepEqual(calls("editEphemeralMessageText").at(-1), { chat_id: -10, receiver_user_id: 21, ephemeral_message_id: 1, text: "Буду кошкой, мяу." });
  assert.equal(toChat(-10).length, 1, "в чат при всех ничего не ушло");
  assert.equal(calls("answerCallbackQuery").at(-1).text, "кошка");
  await h.onMessage(group("Аи, привет", { id: 21, name: "Вася" }), KEY);
  assert.match(last(-10), /мяу/u);

  // Шёпот не правится — ответ уходит шёпотом в ответ на нажатие, а не в общий чат.
  sdk().failing.editEphemeralMessageText = new Error("message to edit not found");
  await press(h, "m:fox:21", { id: 21, chat: -10, type: "supergroup", name: "Вася", extra: { message_id: 0, ephemeral_message_id: 1 } });
  assert.equal(eph(toChat(-10).at(-1)).callback_query_id, "q21m:fox:21");
  assert.equal(eph(toChat(-10).at(-1)).receiver_user_id, undefined);
  delete sdk().failing.editEphemeralMessageText;

  // 2. Не администратор: Telegram отказывает — кнопки при всех, но привязаны; отказ помнится, вторая просьба с ошибки не начинается.
  reset();
  sdk().whispers = { admin: [] };
  const plain = heart(ON, { now: () => NOON, random: () => 0 });
  const open = await plain.onMessage(group("Аи, какие есть режимы", { id: 21, name: "Вася" }), KEY);
  assert.equal(open.whispered, false);
  assert.equal(toChat(-10).length, 1);
  assert.equal(eph(toChat(-10)[0]), undefined);
  assert.ok(toChat(-10)[0].reply_parameters?.message_id, "при всех — ответом на его сообщение");
  assert.ok(keys(toChat(-10)[0]).every(data => data.endsWith(":21")));
  assert.equal(calls("sendMessage:refused").length, 1);
  await plain.onMessage(group("Аи, какие есть режимы", { id: 22, name: "Петя" }), KEY);
  assert.equal(calls("sendMessage:refused").length, 1, "отказ чата помнится — не пробует каждый раз");
  assert.ok(keys(toChat(-10)[1]).every(data => data.endsWith(":22")));

  // Чужое нажатие ничего не меняет: только подсказка нажавшему.
  const foreign = await press(plain, "m:cat:21", { id: 22, chat: -10, type: "supergroup", name: "Петя", messageId: 1 });
  assert.equal(foreign.ignored, true);
  assert.equal(foreign.reason, "foreign_button");
  assert.match(calls("answerCallbackQuery").at(-1).text, /Эти кнопки — не ваши\. Скажите мне «какие есть режимы»/u);
  assert.equal(calls("editMessageText").length, 0);
  await plain.onMessage(group("Аи, привет", { id: 22, name: "Петя" }), KEY);
  assert.doesNotMatch(last(-10), /мяу/u, "манера нажавшего чужую кнопку не изменилась");
  // Свой — выбирает: вопрос сменяется ответом, клавиатура уходит.
  const own = await press(plain, "m:cat:21", { id: 21, chat: -10, type: "supergroup", name: "Вася", messageId: 1 });
  assert.equal(own.accent, "cat");
  assert.deepEqual(calls("editMessageText").at(-1), { chat_id: -10, message_id: 1, text: "Вася: Буду кошкой, мяу." });
  // Через шесть часов — пробует снова: её могли сделать администратором.
  sdk().whispers = { admin: [-10] };
  let at = NOON;
  const later = heart(ON, { now: () => at, random: () => 0 });
  assert.equal((await later.onMessage(group("Аи, какие есть режимы", { id: 23, name: "Оля" }), KEY)).whispered, false);
  at += 6 * 3_600_000 + 1;
  assert.equal((await later.onMessage(group("Аи, какие есть режимы", { id: 23, name: "Оля" }), KEY)).whispered, true);

  // 3. Сервер такого параметра не знает: сообщение уходит всем — один раз, с привязанными кнопками.
  reset();
  const old = heart(ON, { now: () => NOON, random: () => 0 });
  const sent = await old.onMessage(group("Аи, какие есть режимы", { id: 21, name: "Вася" }), KEY);
  assert.equal(sent.whispered, false);
  assert.equal(toChat(-10).length, 1, "не дважды");
  assert.ok(keys(toChat(-10)[0]).every(data => data.endsWith(":21")));

  // 4. Выключено настройкой — шёпот не пробуется вовсе; в личке привязки нет.
  reset();
  sdk().whispers = { admin: [-10] };
  const off = heart({ ...ON, WHISPERS: false }, { now: () => NOON, random: () => 0 });
  await off.onMessage(group("Аи, какие есть режимы", { id: 21, name: "Вася" }), KEY);
  assert.equal(eph(toChat(-10)[0]), undefined);
  await off.onMessage(message("какие есть режимы"), KEY);
  assert.deepEqual(keys(toChat(5)[0]).slice(0, 2), ["m:plain", "m:cat"]);
  assert.equal(chats().length, 0);
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
