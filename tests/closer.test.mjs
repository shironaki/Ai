/**
 * Старые идеи, доделанные в 0.30.0, — всё без модели:
 *   60  «узнаю и вернусь»: хозяин отвечает на вопрос — она возвращается к человеку;
 *   119 «что у нас общего»: сравнение двух анкет, только названное при всех;
 *   127 «вопрос вечера»: один вопрос анкеты в день — тем, кто попросил;
 *   34  «что между нами было»: что осталось от знакомства.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, hers, reset, last, chats, says, sdk, toChat, toOwner, OWNER, KEY } from "./fixtures/kit.mjs";

const { parseEvening, parseCommon, commonOf, TASTES, TASTE_KEY } = await import("../tgcloud/lib/tastes.js");
const { parseAsked } = await import("../tgcloud/lib/asked.js");

const ZONE = { TIME_ZONE: "Europe/Moscow" };
const HOUR = 3_600_000, MINUTE = 60_000, DAY = 24 * HOUR;
const own = (text) => message(text, { id: OWNER });
const kept = (key) => JSON.parse(sdk().kv.get(key) ?? "null");

test("разбор: вопрос вечера, «что у нас общего», вопросы без ответа; чужие фразы — мимо", () => {
  assert.deepEqual(parseEvening("задавай мне вопрос вечера"), { on: true, hour: 20, minute: 0 });
  assert.deepEqual(parseEvening("Задавай вопрос вечера в 21:30."), { on: true, hour: 21, minute: 30 });
  assert.deepEqual(parseEvening("вопрос вечера каждый вечер в 9"), { on: true, hour: 21, minute: 0 }, "час до полудня — вечерний");
  assert.deepEqual(parseEvening("спрашивай меня по вечерам"), { on: true, hour: 20, minute: 0 });
  assert.deepEqual([parseEvening("не задавай вопрос вечера"), parseEvening("хватит вопросов вечера")], [{ on: false }, { on: false }]);
  for (const said of ["вопрос вечера", "вопрос дня каждый вечер", "задавай вопросы", "добрый вечер", "вечером спрошу"]) assert.equal(parseEvening(said), null, said);

  for (const said of ["что у нас общего?", "а что у нас с ней общего", "что общего у меня с ним", "сравни нас", "сравни наши анкеты", "у нас есть что-то общее"]) assert.deepEqual(parseCommon(said), { common: true }, said);
  for (const said of ["что общего у кошки и собаки", "сравни цены", "что у нас на ужин", "общего мало"]) assert.equal(parseCommon(said), null, said);
  const a = [{ key: "color", title: "любимый цвет", value: "Синий" }, { key: "food", title: "любимая еда", value: "плов" }, { key: "book", title: "любимая книга", value: "Дюна" }];
  const b = [{ key: "color", title: "любимый цвет", value: "синий" }, { key: "food", title: "любимая еда", value: "пицца" }, { key: "game", title: "любимая игра", value: "шахматы" }];
  assert.deepEqual(commonOf(a, b), { same: [{ key: "color", title: "цвет", value: "Синий" }], both: [{ key: "food", title: "еда", a: "плов", b: "пицца" }] });
  assert.deepEqual(commonOf(a, []), { same: [], both: [] });

  assert.deepEqual(parseAsked("чего ты не знала?"), { list: true });
  assert.deepEqual(parseAsked("вопросы без ответа"), { list: true });
  assert.deepEqual(parseAsked("ответ 2: столица — Канберра"), { answer: { index: 2, text: "столица — Канберра" } });
  assert.deepEqual(parseAsked("Ответ на вопрос 3 — Спросите позже"), { answer: { index: 3, text: "Спросите позже" } });
  assert.deepEqual([parseAsked("забудь вопрос 1"), parseAsked("забудь все вопросы")], [{ drop: 1 }, { clear: true }]);
  for (const said of ["ответ: да", "что ты не поняла", "ответь мне", "забудь вопрос", "ответ 2:", "вопросы есть?"]) assert.equal(parseAsked(said), null, said);
});

test("60: вопрос при всех записан с местом; хозяин отвечает словом — она возвращается к человеку в тот же чат", async () => {
  reset();
  const at = Date.parse("2026-11-18T09:00:00Z");
  const h = heart(ZONE, { now: () => at });
  sdk().fetchQueue.push(says("Не знаю, честно: тут я могу ошибиться."));
  const asked = group("Аи, какая столица у Австралии сейчас?", { id: 21, name: "Вася" });
  await h.onMessage(asked, KEY);
  const [item] = kept("heart:unknown:v1").items;
  assert.deepEqual([item.chat, item.mid, item.uid, item.who], [-10, asked.message_id, 21, "Вася"]);
  assert.match(item.q, /столица у Австралии/u);

  // Чужой не видит списка и не отвечает за хозяина: его слова идут обычным путём.
  sdk().fetchQueue.push(says("О чём вы?"));
  await h.onMessage(message("ответ 1: Сидней"), KEY);
  assert.equal(kept("heart:unknown:v1").items.length, 1);
  assert.equal(toChat(-10).some(sent => /Сидней/u.test(sent.text ?? "")), false);

  await h.onMessage(own("чего ты не знала?"), KEY);
  assert.match(last(OWNER), /^Вопросы, на которые я не знала ответа:\n1\. «какая столица у Австралии сейчас\?» — Вася, 18\.11\n\nОтветить человеку — «ответ 1: …»/u);
  await h.onMessage(own("ответ 5: мимо"), KEY);
  assert.equal(last(OWNER), "Под номером 5 вопроса нет: их 1. Список — «чего ты не знала?».");

  const before = chats().length;
  await h.onMessage(own("ответ 1: Канберра. Сидней — самый большой город, но не столица."), KEY);
  const back = toChat(-10).at(-1);
  assert.equal(back.text, "Вася, раньше я не знала, что ответить на «какая столица у Австралии сейчас?». Теперь знаю: Канберра. Сидней — самый большой город, но не столица.");
  assert.deepEqual(back.reply_parameters, { message_id: asked.message_id, allow_sending_without_reply: true });
  assert.match(last(OWNER), /^Передала: Вася — ответом на то сообщение\./u);
  assert.deepEqual(kept("heart:unknown:v1").items, []);
  assert.equal(chats().length, before, "модель на это не тратится");
  await h.onMessage(own("чего ты не знала?"), KEY);
  assert.equal(last(OWNER), "Вопросов без ответа у меня нет.");

  // Вопрос самого хозяина: передавать некому. Чужой личный вопрос в список не попадает вовсе.
  sdk().fetchQueue.push(says("Не знаю: таких данных у меня нет."));
  await h.onMessage(own("сколько весит варп-двигатель третьей серии?"), KEY);
  sdk().fetchQueue.push(says("Не знаю, увы."));
  await h.onMessage(message("а сколько стоит билет до Марса в один конец?"), KEY);
  assert.equal(kept("heart:unknown:v1").items.length, 1);
  await h.onMessage(own("ответ 1: около тонны"), KEY);
  assert.match(last(OWNER), /^Этот вопрос задавали вы сами — передавать некому\. Убрала его из списка\./u);
  assert.deepEqual(kept("heart:unknown:v1").items, []);
});

test("119: «что у нас общего» — ответом на сообщение человека; сравнивается только названное при всех", async () => {
  reset();
  const at = Date.parse("2026-11-18T09:00:00Z");
  const h = heart(ZONE, { now: () => at });
  const say = (text, id, name, extra = {}) => h.onMessage(group(text, { id, name, ...extra }), KEY);
  await say("Аи, мой любимый цвет — синий", 21, "Вася");
  await say("Аи, мой любимый напиток — чай", 21, "Вася");
  await say("Аи, моя любимая еда — плов", 21, "Вася");
  await say("Аи, мой любимый цвет — Синий", 22, "Маша");
  await say("Аи, моя любимая еда — пицца", 22, "Маша");
  // В личке Маша назвала напиток — тот же, что у Васи: при всех это не звучит.
  await h.onMessage(message("мой любимый напиток — чай", { id: 22, name: "Маша" }), KEY);
  const hersMessage = { message_id: 700, from: { id: 22, first_name: "Маша", is_bot: false }, text: "всем привет" };

  await say("Аи, что у нас общего?", 21, "Вася", { reply: hersMessage });
  assert.equal(last(-10), "Общее — Вася и Маша, из названного при всех:\n• цвет — синий\nОба назвали, но разное: еда (плов / пицца).");
  assert.doesNotMatch(last(-10), /чай/u);

  await say("Аи, что у нас общего?", 21, "Вася");
  assert.match(last(-10), /^Сравнить могу двоих: ответь(?:те)? этими словами на сообщение человека/u);
  await say("Аи, сравни нас", 21, "Вася", { reply: { message_id: 701, from: { id: 23, first_name: "Петя", is_bot: false }, text: "да" } });
  assert.match(last(-10), /^Петя при всех о любимом мне ещё ничего не говорил\(а\) — сравнивать не с чем\./u);
  await say("Аи, сравни нас", 21, "Вася", { reply: { message_id: 702, from: { id: 555, first_name: "Бот", is_bot: true }, text: "бип" } });
  assert.equal(last(-10), "С ботами анкеты не сравниваю: у них любимого нет.");
  await say("Аи, сравни нас", 21, "Вася", { reply: { message_id: 703, from: { id: 21, first_name: "Вася", is_bot: false }, text: "я" } });
  assert.match(last(-10), /^Это (?:ваше|твоё) же сообщение\./u);
  assert.equal(chats().length, 0, "без модели");

  // Ответом на её сообщение и в личке — это вопрос к ней самой: разговор.
  sdk().fetchQueue.push(says("Любопытство, пожалуй."));
  await say("что у нас общего?", 21, "Вася", { reply: hers() });
  sdk().fetchQueue.push(says("Мы оба любим тишину."));
  await h.onMessage(message("что у нас общего?", { id: 21, name: "Вася" }), KEY);
  assert.equal(chats().length, 2);
});

test("127: вопрос вечера — по просьбе, раз в день, один; позже десяти минут — строже; «не знаю» и «хватит»", async () => {
  reset();
  let at = Date.parse("2026-11-18T09:00:00Z"); // 12:00 в Москве
  const h = heart(ZONE, { now: () => at });
  const me = (text) => h.onMessage(message(text), KEY);
  await h.onMessage(group("Аи, задавай мне вопрос вечера", { id: 21, name: "Вася" }), KEY);
  assert.equal(last(-10), "Вопрос вечера — личное: я спрашиваю о любимом и пишу первой. Включается в личке.");
  await me("не задавай вопрос вечера");
  assert.equal(last(), "Я его и не задавала. Включить — «задавай мне вопрос вечера».");
  await me("задавай мне вопрос вечера");
  assert.match(last(), /^Хорошо: каждый вечер в 20:00 — один вопрос о любимом, из того, чего я о (?:вас|тебе) ещё не знаю\./u);
  const [mailing] = await h.reminders.list(5);
  assert.deepEqual([mailing.kind, mailing.text, mailing.zone], ["daily", "evening", "Europe/Moscow"]);

  // Вечер первый: вопрос о цвете. Час спустя «устал» — не ответ; «синий» — ответ.
  at = Date.parse("2026-11-18T17:00:30Z");
  await h.tick({ tick: true });
  assert.match(last(), /^🌙 Вопрос вечера: Какой у (?:вас|тебя) любимый цвет\?\nОтветить можно парой слов/u);
  at += HOUR;
  sdk().fetchQueue.push(says("Отдохните."));
  await me("устал");
  assert.equal(kept(TASTE_KEY(5)), null, "«устал» любимым цветом не записан");
  await me("синий");
  assert.match(last(), /^Запомнила: (?:ваш|твой) любимый цвет — синий\. Завтра спрошу ещё о чём-нибудь\.$/u);
  assert.equal(kept(TASTE_KEY(5)).items.color.v, "синий");
  const count = toChat(5).length;
  await h.tick({ tick: true });
  assert.equal(toChat(5).length, count, "второго вопроса в тот же вечер нет");

  // Вечер второй: еда — «не знаю»; третий: уже не еда, а напиток — «хватит».
  at = Date.parse("2026-11-19T17:00:30Z");
  await h.tick({ tick: true });
  assert.match(last(), /^🌙 Вопрос вечера: Что (?:вы любите|ты любишь) есть больше всего\?/u);
  at += 2 * MINUTE;
  await me("не знаю");
  assert.equal(last(), "Пропустим. Завтра спрошу о другом.");
  at = Date.parse("2026-11-20T17:00:30Z");
  await h.tick({ tick: true });
  const drink = last();
  assert.equal(drink, "🌙 Вопрос вечера: А пить — чай, кофе, что-то ещё?\nОтветить можно парой слов, позже — ответом на это сообщение. «Не знаю» — пропущу, «хватит» — больше не спрошу.");
  // Наутро ожидание истекло: слово само по себе — уже разговор…
  at = Date.parse("2026-11-21T06:00:00Z");
  sdk().fetchQueue.push(says("Доброе утро."));
  await me("тархун со льдом");
  assert.equal(kept(TASTE_KEY(5)).items.drink, undefined, "через тринадцать часов слово — не ответ");
  // …а ответ на само сообщение с вопросом — ответ, сколько бы ни прошло.
  await h.onMessage(message("тархун со льдом", { reply: hers(drink, 901) }), KEY);
  assert.match(last(), /^Запомнила: (?:ваш|твой) любимый напиток — тархун со льдом\. Завтра спрошу ещё о чём-нибудь\.$/u);
  assert.equal(kept(TASTE_KEY(5)).items.drink.v, "тархун со льдом");
  // Ответ на чужое её сообщение — не ответ на вопрос вечера.
  sdk().fetchQueue.push(says("Хорошо."));
  await h.onMessage(message("зелёный чай со льдом", { reply: hers("Доброе утро.", 902) }), KEY);
  assert.equal(kept(TASTE_KEY(5)).items.drink.v, "тархун со льдом");

  // Вечер четвёртый: музыка — «хватит».
  at = Date.parse("2026-11-21T17:00:30Z");
  await h.tick({ tick: true });
  assert.match(last(), /^🌙 Вопрос вечера: Какую музыку (?:вы слушаете|ты слушаешь) чаще всего\?/u);
  at += MINUTE;
  await me("хватит");
  assert.equal(last(), "Хорошо, вопрос вечера больше не задаю. Вернуть — «задавай мне вопрос вечера».");
  assert.equal((await h.reminders.list(5)).length, 0);
  // Рассылки уже нет, а на старый вопрос ответить можно: «завтра спрошу ещё» она при этом не обещает.
  await h.onMessage(message("квас", { reply: hers(drink, 901) }), KEY);
  assert.match(last(), /^Запомнила: (?:ваш|твой) любимый напиток — квас\.$/u);

  // Спрашивать не о чем — рассылка снимает себя сама; заполненной анкете её не включить.
  await me("задавай мне вопрос вечера в 9");
  assert.match(last(), /каждый вечер в 21:00/u);
  sdk().kv.set(TASTE_KEY(5), JSON.stringify({ items: Object.fromEntries(TASTES.map(item => [item.key, { v: "что-то" }])), at }));
  at = Date.parse("2026-11-21T18:00:30Z"); // 21:00 того же вечера
  await h.tick({ tick: true });
  assert.match(last(), /^🌙 Вопросы вечера кончились/u);
  assert.equal((await h.reminders.list(5)).length, 0);
  await me("задавай мне вопрос вечера");
  assert.match(last(), /^Спрашивать мне уже не о чем: анкета заполнена\./u);
  assert.equal(chats().length, 3, "модель понадобилась трижды — на слова, которые ответом не были");
});

test("34: «что между нами было» — с какого дня знакомы и что она помнит; при всех — только число дней", async () => {
  reset();
  let at = Date.parse("2026-11-18T09:00:00Z");
  const h = heart(ZONE, { now: () => at });
  await h.onMessage(message("наша история"), KEY);
  assert.match(last(), /^Мы знакомы с сегодняшнего дня\. Пока у меня от этого времени только число/u);
  await h.onMessage(message("запомни, я работаю по ночам"), KEY);
  await h.onMessage(message("зови меня Лис"), KEY);
  // День рождения, сказанный к слову: она переспрашивает «запомнить?» — и ждёт «да».
  sdk().fetchQueue.push(says("Весной, значит."));
  await h.onMessage(message("мой день рождения 5 марта"), KEY);
  assert.match(last(), /Запомнить (?:ваш|твой) день рождения — 5 марта\?/u);
  await h.onMessage(message("да"), KEY);
  await h.onMessage(message("мой любимый цвет — синий"), KEY);
  await h.onMessage(message("напомни через 30 дней про отпуск"), KEY);
  at += 10 * DAY;
  await h.onMessage(message("что между нами было?"), KEY);
  assert.match(last(), /^Мы знакомы 10 дней — с 18 ноября 2026\.\nЧто у меня от этого времени осталось:\n/u);
  assert.match(last(), /\n• как (?:вас|тебя) звать — «Лис»;\n• день рождения — 5 марта: поздравлю сама;\n• о (?:вас|тебе) — 1 запись \(«что ты обо мне помнишь»\);\n• из любимого — 1 из 16 \(«что я люблю»\);\n• напоминаний впереди — 1 \(«мои напоминания»\)\.\n\nСаму переписку я долго не храню/u, "день рождения — не «напоминание впереди»: о нём своя строка");
  await h.onMessage(group("Аи, что между нами было?", { id: 5, name: "Тест" }), KEY);
  assert.equal(last(-10), "Мы знакомы 10 дней — с 18 ноября 2026. Остальное расскажу в личке: там это только между нами.");
  assert.equal(chats().length, 1, "модель — только на реплику о дне рождения; сам рассказ — по записям");
  assert.equal(toOwner().length, 0);
});

test("92: «насколько я знаю?» — игра для двоих по анкете, названной при всех; ответы — ответом на её вопрос; без модели", async () => {
  reset();
  const at = Date.parse("2026-11-18T09:00:00Z");
  // Номер её сообщения в стабе — порядковый: вопрос, заданный последним, носит номер «сколько отправлено».
  const asked = () => sdk().sent.length;
  const h = heart(ZONE, { now: () => at, random: () => 0 });
  const say = (text, id, name, extra = {}) => h.onMessage(group(text, { id, name, ...extra }), KEY);
  const from = (id, name) => ({ message_id: 700 + id, from: { id, first_name: name, is_bot: false }, text: "всем привет" });
  const hersAt = (id) => ({ message_id: id, from: { id: 999, is_bot: true, username: "ai_heart_bot" }, text: "Вопрос" });
  await say("Аи, мой любимый цвет — синий", 22, "Маша");
  await say("Аи, моя любимая еда — пицца", 22, "Маша");
  // Двух ответов мало; сказанное в личке при всех не спрашивается.
  await h.onMessage(message("мой любимый напиток — зелёный чай", { id: 22, name: "Маша" }), KEY);
  await say("Аи, насколько я её знаю?", 21, "Вася", { reply: from(22, "Маша") });
  assert.match(last(-10), /^Спросить пока не о чем: Маша называет мне при всех слишком мало любимого — нужно хотя бы три ответа\./u);
  await say("Аи, мой любимый напиток — зелёный чай", 22, "Маша");
  // Без ответа на сообщение, себе и боту — подсказка.
  await say("Аи, насколько мы знаем друг друга?", 21, "Вася");
  assert.match(last(-10), /^Это игра для двоих: ответьте этими словами на сообщение человека/u);
  await say("Аи, насколько я его знаю", 21, "Вася", { reply: from(21, "Вася") });
  assert.match(last(-10), /^Себя вы знаете и без меня\./u);

  await say("Аи, насколько мы знаем друг друга?", 21, "Вася", { reply: from(22, "Маша") });
  assert.equal(last(-10), "Вопрос 1 из 3. Любимый цвет — что называет Маша? Ответ — ответом на это сообщение.");
  const first = asked();
  // Чужой ответ — не в счёт; свой — словом внутри фразы.
  await say("синий", 23, "Петя", { reply: hersAt(first) });
  assert.match(last(-10), /^Этот вопрос — не вам: отвечает Вася\./u);
  await say("кажется, синий!", 21, "Вася", { reply: hersAt(first) });
  assert.equal(last(-10), "Верно.\n\nВопрос 2 из 3. Любимая еда — что называет Маша? Ответ — ответом на это сообщение.");
  await say("плов", 21, "Вася", { reply: hersAt(asked()) });
  assert.equal(last(-10), "Нет: пицца.\n\nВопрос 3 из 3. Любимый напиток — что называет Маша? Ответ — ответом на это сообщение.");
  await say("чай", 21, "Вася", { reply: hersAt(asked()) });
  assert.equal(last(-10), "Верно.\n\nИтог: 2 из 3. Неплохо.\nМаша, теперь очередь за вами: «Аи, насколько я знаю?» — ответом на сообщение собеседника.");
  // Отвеченный вопрос закрыт: второй раз он не игра.
  assert.equal(chats().length, 0, "игра модель не тратит");
  sdk().fetchQueue.push(says("Это вы о чём?"));
  await say("синий", 21, "Вася", { reply: hersAt(first) });
  assert.equal(last(-10), "Это вы о чём?", "отвеченный вопрос — уже не игра");
  // Ответ на её собственное сообщение — вопрос о ней самой, это разговор, а не игра.
  sdk().fetchQueue.push(says("Спросите меня о чём-нибудь — проверим."));
  await say("насколько я тебя знаю?", 21, "Вася", { reply: hersAt(5) });
  assert.equal(last(-10), "Спросите меня о чём-нибудь — проверим.");
});
