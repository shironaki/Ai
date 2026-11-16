/**
 * Карта дня, рассылка по расписанию, привычки и вопрос «запомнить?».
 * Всё без модели, кроме самого разговора, после которого она спрашивает.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, sdk, says, source, system, chats, toChat, last, reactions, KEY, DAY } from "./fixtures/kit.mjs";

const { CARDS, cardFor, cardText, parseCard, parseDaily } = await import("../tgcloud/lib/daily.js");
const { parseHabit, sameHabit, streakOf, HABITS_KEY } = await import("../tgcloud/lib/habits.js");
const { detectFact, offerText, OFFER_KEY } = await import("../tgcloud/lib/offers.js");

/** 12 ноября 2026, 16:00 по Москве, четверг. */
const NOON = Date.UTC(2026, 10, 12, 13, 0);
const HOUR = 3_600_000;
const admin = () => { sdk().apiReplies.getChatMember = { status: "administrator" }; };
const kazan = () => source("geocoding-api.open-meteo.com", { results: [{ name: "Казань", country: "Россия", admin1: "Татарстан", latitude: 55.79, longitude: 49.12, timezone: "Europe/Moscow", feature_code: "PPLA" }] });

test("карта дня: колода без обращений на «вы» и «ты», одна карта на человека и день", () => {
  assert.ok(CARDS.length >= 30);
  assert.equal(new Set(CARDS.map(card => card[1])).size, CARDS.length);
  for (const [emoji, name, hint] of CARDS) {
    assert.ok(emoji && name && hint.length >= 30 && hint.length <= 120, name);
    assert.doesNotMatch(hint, /(?:^|[\s«(])(?:вы|вам|вас|ваш\S*|ты|тебе|тебя|тво\S*)(?=$|[\s,.!?»)])/iu, name);
  }
  assert.deepEqual(cardFor(5, "2026-11-12"), cardFor(5, "2026-11-12"));
  const week = new Set(Array.from({ length: 14 }, (_, index) => cardFor(5, `2026-11-${String(index + 1).padStart(2, "0")}`)[1]));
  assert.ok(week.size >= 8, `за две недели — ${week.size} разных карт`);
  const people = new Set(Array.from({ length: 20 }, (_, index) => cardFor(100 + index, "2026-11-12")[1]));
  assert.ok(people.size >= 10, `у двадцати человек — ${people.size} разных карт`);
  assert.match(cardText(CARDS[0]), /^🃏 Карта дня — 🌅 «Рассвет»\n.+\n\nЭто не предсказание, а подсказка на день\.$/u);
  for (const yes of ["карта дня", "Вытяни карту", "моя карта дня", "вытяни мне карту дня", "какая у меня карта сегодня?"]) assert.equal(parseCard(yes), true, yes);
  for (const no of ["карта", "карта мира", "вытяни билет", "карта дня по утрам"]) assert.equal(parseCard(no), false, no);
});

test("разбор рассылки: что, когда и «не надо» — и только когда названо расписание", () => {
  assert.deepEqual(parseDaily("вопрос дня по утрам"), { what: "question", on: true, hour: 9, minute: 0 });
  assert.deepEqual(parseDaily("Присылай вопрос дня каждый день в 10:30"), { what: "question", on: true, hour: 10, minute: 30 });
  assert.deepEqual(parseDaily("карту дня каждое утро в 8"), { what: "card", on: true, hour: 8, minute: 0 });
  assert.deepEqual(parseDaily("каждый день в 7 вечера вопрос дня"), { what: "question", on: true, hour: 19, minute: 0 });
  assert.deepEqual(parseDaily("карта дня по вечерам"), { what: "card", on: true, hour: 20, minute: 0 });
  assert.deepEqual(parseDaily("не надо вопроса дня"), { what: "question", on: false });
  assert.deepEqual(parseDaily("отключи карту дня по утрам"), { what: "card", on: false });
  assert.deepEqual(parseDaily("хватит вопросов дня"), { what: "question", on: false });
  for (const no of ["вопрос дня", "карта дня", "вопрос дня каждый день в 25", "каждый день в 9", "вопрос по утрам"]) assert.equal(parseDaily(no), null, no);
});

test("карта дня словами: та же карта весь день, назавтра — своя", async () => {
  reset();
  let at = NOON;
  const h = heart({}, { now: () => at });
  await h.onMessage(message("карта дня"), KEY);
  const first = last();
  assert.equal(first, cardText(cardFor(5, "2026-11-12")));
  await h.onMessage(message("вытяни карту"), KEY);
  assert.equal(last(), first);
  at += DAY;
  await h.onMessage(message("карта дня"), KEY);
  assert.equal(last(), cardText(cardFor(5, "2026-11-13")));
  assert.equal(chats().length, 0);
});

test("вопрос дня по утрам: включает админ, приходит сам в назначенный час с кнопкой, выключается словом", async () => {
  reset();
  let at = NOON;
  const h = heart({}, { now: () => at });
  await h.onMessage(group("Аи, вопрос дня по утрам", { id: 21 }), KEY);
  assert.equal(last(-10), "Рассылку в чате включают и выключают его админы.");
  admin();
  await h.onMessage(group("Аи, карта дня по утрам", { id: 22 }), KEY);
  assert.match(last(-10), /Карта дня у каждого своя/u);
  await h.onMessage(group("Аи, вопрос дня каждый день в 9", { id: 22 }), KEY);
  assert.match(last(-10), /^Хорошо: вопрос дня — каждый день в 09:00 в этом чате\. Отменить — «не надо вопроса дня»\./u);
  const [item] = await h.reminders.list(22);
  assert.deepEqual({ kind: item.kind, text: item.text, chatId: item.chatId, repeat: item.repeat }, { kind: "daily", text: "question", chatId: -10, repeat: { kind: "day", hh: 9, mm: 0 } });
  // Повторная просьба не плодит рассылки: в чате она одна.
  await h.onMessage(group("Аи, вопрос дня по утрам", { id: 22 }), KEY);
  assert.equal((await h.reminders.list(22)).length, 1);

  // Утро следующего дня: 09:00 по Москве — 06:00 UTC.
  const count = toChat(-10).length;
  at = Date.UTC(2026, 10, 13, 5, 59);
  await h.tick({ tick: true });
  assert.equal(toChat(-10).length, count, "раньше срока — тишина");
  at = Date.UTC(2026, 10, 13, 6, 1);
  await h.tick({ tick: true });
  const posted = toChat(-10).at(-1);
  assert.match(posted.text, /^💬 Вопрос дня:\n.+/u);
  assert.deepEqual(posted.reply_markup, { inline_keyboard: [[{ text: "Ещё вопрос", callback_data: "a:q" }]] });
  assert.equal(posted.reply_parameters, undefined, "рассылка — не ответ на давнюю просьбу");
  // Назавтра — снова, и вопрос другой.
  at = Date.UTC(2026, 10, 14, 6, 1);
  await h.tick({ tick: true });
  assert.notEqual(toChat(-10).at(-1).text, posted.text);
  // Проспала полдня — утренний вопрос вечером не шлёт, но расписание цело.
  at = Date.UTC(2026, 10, 15, 14, 0);
  const before = toChat(-10).length;
  await h.tick({ tick: true });
  assert.equal(toChat(-10).length, before);
  assert.equal((await h.reminders.list(22)).length, 1);

  await h.onMessage(group("Аи, мои напоминания", { id: 22 }), KEY);
  assert.match(last(-10), /\(каждый день\) — вопрос дня в чате/u);
  await h.onMessage(group("Аи, не надо вопроса дня", { id: 22 }), KEY);
  assert.match(last(-10), /вопрос дня сама больше не присылаю/u);
  assert.equal((await h.reminders.list(22)).length, 0);
  await h.onMessage(group("Аи, не надо вопроса дня", { id: 22 }), KEY);
  assert.match(last(-10), /Рассылки вопроса дня здесь и не было/u);
});

test("карта дня по утрам в личке: приходит сама, у человека — его карта", async () => {
  reset();
  let at = NOON;
  const h = heart({}, { now: () => at });
  await h.onMessage(message("карта дня каждое утро в 8"), KEY);
  assert.match(last(), /^Хорошо: карта дня — каждый день в 08:00\. Отменить — «не надо карты дня»\./u);
  at = Date.UTC(2026, 10, 13, 5, 0);
  await h.tick({ tick: true });
  assert.equal(last(), cardText(cardFor(5, "2026-11-13")));
  await h.onMessage(message("отключи карту дня"), KEY);
  assert.equal((await h.reminders.list(5)).length, 0);
});

test("разбор привычек: завести с расписанием и без, отметить, убрать; «сделал …» — мягкая отметка", () => {
  assert.deepEqual(parseHabit("привычка: Зарядка каждый день в 8"), { op: "add", name: "Зарядка", schedule: "каждый день в 8" });
  assert.deepEqual(parseHabit("Привычка: читать перед сном"), { op: "add", name: "читать перед сном", schedule: "" });
  assert.deepEqual(parseHabit("новая привычка — пить воду по будням в 10:30"), { op: "add", name: "пить воду", schedule: "по будням в 10:30" });
  assert.deepEqual(parseHabit("привычка: медитация в 7"), { op: "add", name: "медитация", schedule: "каждый день в 7" });
  assert.deepEqual(parseHabit("мои привычки"), { op: "list" });
  assert.deepEqual(parseHabit("отметь привычку 2"), { op: "done", index: 2 });
  assert.deepEqual(parseHabit("отметь привычку зарядка"), { op: "done", name: "зарядка" });
  assert.deepEqual(parseHabit("отметь зарядку"), { op: "done", name: "зарядку", soft: true });
  assert.deepEqual(parseHabit("Сделала зарядку!"), { op: "done", name: "зарядку", soft: true });
  assert.deepEqual(parseHabit("зарядка сделана"), { op: "done", name: "зарядка", soft: true });
  assert.deepEqual(parseHabit("удали привычку 1"), { op: "drop", index: 1 });
  assert.deepEqual(parseHabit("убери привычку пить воду"), { op: "drop", name: "пить воду" });
  for (const no of ["привычка", "какая у тебя привычка?", "вредные привычки — это плохо", "привет"]) assert.equal(parseHabit(no), null, no);
  assert.equal(sameHabit("зарядка", "зарядку"), true);
  assert.equal(sameHabit("пить воду", "пить воду"), true);
  assert.equal(sameHabit("зарядка", "уроки"), false);
  assert.equal(sameHabit("читать", "читать перед сном вслух"), false, "длинная фраза — не название привычки");
  assert.equal(streakOf(["2026-11-10", "2026-11-11", "2026-11-12"], "2026-11-12"), 3);
  assert.equal(streakOf(["2026-11-10", "2026-11-11"], "2026-11-12"), 2, "сегодня ещё не отмечено — серия цела");
  assert.equal(streakOf(["2026-11-09", "2026-11-10"], "2026-11-12"), 0, "пропущен день — серии нет");
  assert.equal(streakOf(["2026-10-31", "2026-11-01"], "2026-11-01"), 2, "через границу месяца");
});

test("привычка: заводится с напоминанием, отмечается раз в день, серия растёт и обрывается пропуском", async () => {
  reset();
  let at = NOON;
  const h = heart({}, { now: () => at });
  await h.onMessage(message("привычка: зарядка каждый день в 8"), KEY);
  assert.equal(last(), "Завела привычку: зарядка. Напоминать буду каждый день в 08:00. Отметить — «отметь привычку 1»; считаю дни подряд.");
  assert.equal(reactions().at(-1), "✍");
  const [remind] = await h.reminders.list(5);
  assert.deepEqual({ kind: remind.kind, text: remind.text, repeat: remind.repeat.kind }, { kind: "habit", text: "зарядка", repeat: "day" });
  await h.onMessage(message("привычка: зарядка"), KEY);
  assert.match(last(), /Такая привычка уже есть/u);

  await h.onMessage(message("отметь зарядку"), KEY);
  assert.equal(last(), "Отмечено: зарядка. Серия — 1 день подряд, всего — 1.");
  await h.onMessage(message("сделал зарядку"), KEY);
  assert.equal(last(), "Сегодня уже отмечено: зарядка. Серия — 1 день.");
  // Утро следующего дня: напоминание называет серию; после отметки — молчит.
  at = Date.UTC(2026, 10, 13, 5, 1);
  await h.tick({ tick: true });
  assert.equal(last(), "🔁 Привычка: зарядка. Серия — 1 день. Сделано — «отметь привычку зарядка».");
  await h.onMessage(message("зарядка сделана"), KEY);
  assert.equal(last(), "Отмечено: зарядка. Серия — 2 дня подряд, всего — 2.");
  at = Date.UTC(2026, 10, 14, 4, 0);
  await h.onMessage(message("отметь привычку 1"), KEY);
  assert.match(last(), /Серия — 3 дня подряд, всего — 3\.$/u);
  const count = toChat(5).length;
  at = Date.UTC(2026, 10, 14, 5, 1);
  await h.tick({ tick: true });
  assert.equal(toChat(5).length, count, "сегодня уже отмечено — напоминать не о чем");
  // Пропущен день — серия начинается заново, а счёт всех дней остаётся.
  at = Date.UTC(2026, 10, 16, 15, 0);
  await h.onMessage(message("отметь зарядку"), KEY);
  assert.equal(last(), "Отмечено: зарядка. Серия — 1 день подряд, всего — 4.");
  await h.onMessage(message("мои привычки"), KEY);
  assert.equal(last(), "Привычки:\n\n1. зарядка — серия 1 день, всего 4 · напоминаю каждый день в 08:00 · сегодня ✓\n\nОтметить — «отметь привычку 1». Убрать — «удали привычку 1».");
  assert.equal(chats().length, 0, "всё без модели");

  await h.onMessage(message("удали привычку зарядка"), KEY);
  assert.equal(last(), "Убрала привычку: зарядка. Отмеченных дней было: 4.");
  assert.equal((await h.reminders.list(5)).length, 0, "напоминание уходит вместе с привычкой");
  await h.onMessage(message("мои привычки"), KEY);
  assert.match(last(), /Привычек у вас пока нет/u);
});

test("привычки: неделя подряд отмечена словом; «сделал …» без привычки — разговор; в группе — только отметка; «удали всё» стирает", async () => {
  reset();
  let at = NOON;
  const h = heart({}, { now: () => at });
  sdk().fetchQueue.push(says("Молодец!"));
  await h.onMessage(message("сделал уроки"), KEY);
  assert.equal(last(), "Молодец!", "привычки «уроки» нет — это разговор");
  await h.onMessage(message("привычка: читать"), KEY);
  assert.match(last(), /^Завела привычку: читать\. Отметить/u);
  for (let day = 0; day < 7; day++) { at = NOON + day * DAY; await h.onMessage(message("отметь привычку читать"), KEY); }
  assert.equal(last(), "Отмечено: читать. Серия — 7 дней подряд, всего — 7. Неделя подряд — это уже привычка, а не попытка.");
  await h.onMessage(message("привычка: читать по пятницам вечером иногда"), KEY);
  assert.match(last(), /^(?:Завела привычку|Не поняла расписание)/u);
  await h.onMessage(group("Аи, привычка: бег"), KEY);
  assert.equal(last(-10), "Привычки — дело личное: заведём и посмотрим их в личке.");
  at += DAY;
  await h.onMessage(group("Аи, отметь привычку читать"), KEY);
  assert.match(last(-10), /Серия — 8 дней подряд/u);
  for (let index = 0; index < 12; index++) await h.onMessage(message(`привычка: дело номер ${index}`), KEY);
  assert.match(last(), /Привычек уже десять — это мой предел/u);
  assert.ok(sdk().kv.has(HABITS_KEY(5)));
  await h.onMessage(message("удали всё обо мне"), KEY);
  await h.onMessage(message("да, удали всё"), KEY);
  assert.equal(sdk().kv.has(HABITS_KEY(5)), false);
});

test("разбор фактов: имя, город и день рождения — только сказанное о себе и прямо", () => {
  assert.deepEqual(detectFact("Привет! Меня зовут Оля, а тебя?"), { kind: "name", value: "Оля" });
  assert.deepEqual(detectFact("меня зовут петя"), { kind: "name", value: "Петя" });
  assert.deepEqual(detectFact("кстати, моё имя — Анна-Мария."), { kind: "name", value: "Анна-Мария" });
  assert.deepEqual(detectFact("я из Казани, тут уже снег"), { kind: "city", value: "Казань" });
  assert.deepEqual(detectFact("вообще я живу в Новосибирске"), { kind: "city", value: "Новосибирск" });
  assert.deepEqual(detectFact("у меня день рождения 5 марта"), { kind: "birthday", day: 5, month: 3, year: null, value: "5 марта" });
  assert.deepEqual(detectFact("Я родилась 31.12.1999, под ёлкой"), { kind: "birthday", day: 31, month: 12, year: 1999, value: "31 декабря" });
  for (const no of ["меня зовут на свадьбу", "меня зовут гулять", "его зовут Петя", "я из дома вышел", "я из тех, кто не сдаётся", "у него день рождения 5 марта",
    "у меня день рождения 31 февраля", "я живу в общежитии", "привет"]) assert.equal(detectFact(no), null, no);
  assert.match(offerText({ kind: "name", value: "Оля" }), /^Запомнить, что вас зовут Оля\?/u);
  assert.match(offerText({ kind: "city", value: "Казань" }, false), /^Запомнить твой город — Казань\?/u);
});

test("«запомнить?»: спрашивает после ответа, «да» — записано, одно и то же дважды не спрашивает", async () => {
  reset();
  let at = NOON;
  const h = heart({}, { now: () => at });
  sdk().fetchQueue.push(says("Приятно познакомиться!"));
  await h.onMessage(message("Привет! Меня зовут Оля, а тебя?"), KEY);
  assert.deepEqual(toChat(5).slice(-2).map(item => item.text), ["Приятно познакомиться!", "Запомнить, что вас зовут Оля? «Да» — так и буду обращаться."]);
  await h.onMessage(message("да"), KEY);
  assert.equal(last(), "Запомнила: Оля. Передумаете — «зови меня …».");
  assert.equal((await h.personal.settings(5)).address, "Оля");
  assert.equal(chats().length, 1, "«да» до модели не дошло");
  // То же имя ещё раз — уже известно; «да» без вопроса — обычное слово.
  sdk().fetchQueue.push(says("Помню."), says("Что «да»?"));
  await h.onMessage(message("напоминаю: меня зовут Оля"), KEY);
  assert.equal(last(), "Помню.");
  await h.onMessage(message("да"), KEY);
  assert.equal(last(), "Что «да»?");

  // Город: «нет» — не записан и больше не спрашивается.
  sdk().fetchQueue.push(says("Красивый город."), says("Да, красивый."));
  await h.onMessage(message("я из Казани, тут уже снег"), KEY);
  assert.equal(last(), "Запомнить ваш город — Казань? «Да» — и погоду с часами буду считать по нему.");
  await h.onMessage(message("нет"), KEY);
  assert.equal(last(), "Хорошо, не записываю — и больше об этом не спрошу.");
  assert.equal((await h.personal.settings(5)).city, undefined);
  await h.onMessage(message("я из Казани, тут уже снег"), KEY);
  assert.equal(last(), "Да, красивый.");

  // День рождения: записан, поздравление — каждый год в девять утра.
  sdk().fetchQueue.push(says("Весной, значит."));
  await h.onMessage(message("а у меня день рождения 5 марта"), KEY);
  assert.equal(last(), "Запомнить ваш день рождения — 5 марта? «Да» — и поздравлю каждый год.");
  await h.onMessage(message("да"), KEY);
  assert.equal(last(), "Запомнила: 5 марта. Поздравлю — в девять утра, каждый год.");
  const [wish] = await h.reminders.list(5);
  assert.deepEqual({ kind: wish.kind, repeat: wish.repeat }, { kind: "birthday", repeat: { kind: "year", month: 3, day: 5, hh: 9, mm: 0 } });
  at = Date.UTC(2027, 2, 5, 6, 1);
  await h.tick({ tick: true });
  assert.equal(last(), "🎂 С днём рождения, Оля! Пусть этот год будет добрым — а я буду рядом.");
  assert.equal((await h.reminders.list(5)).length, 1, "через год поздравит снова");
});

test("«запомнить?»: город записывается с часовым поясом; вопрос устаревает; в группе не спрашивает", async () => {
  reset();
  let at = NOON;
  const h = heart({}, { now: () => at });
  kazan();
  sdk().fetchQueue.push(says("Здорово."));
  await h.onMessage(message("я сейчас живу в Казани и мне нравится"), KEY);
  await h.onMessage(message("ок"), KEY);
  assert.equal(last(), "Запомнила: Казань. «Погода» и «который час» теперь считаю по нему.");
  assert.deepEqual((({ city, tz }) => ({ city, tz }))(await h.personal.settings(5)), { city: "Казань", tz: "Europe/Moscow" });

  sdk().fetchQueue.push(says("Привет, Лев."), says("Да?"));
  // Имя сказано к слову — вопрос «запомнить?»; сказано одним сообщением («меня зовут Лев») — запоминается сразу.
  await h.onMessage(message("меня зовут Лев, будем знакомы", { id: 6 }), KEY);
  assert.match(last(6), /^Запомнить, что вас зовут Лев\?/u);
  at += 11 * 60_000;
  await h.onMessage(message("да", { id: 6 }), KEY);
  assert.equal(last(6), "Да?", "через одиннадцать минут «да» — уже о другом");
  assert.equal((await h.personal.settings(6)).address, undefined);

  sdk().fetchQueue.push(says("Привет, Нина."));
  await h.onMessage(group("Аи, меня зовут Нина", { id: 31 }), KEY);
  assert.equal(last(-10), "Привет, Нина.");
  assert.equal(sdk().kv.has(OFFER_KEY(31)), false);
});
