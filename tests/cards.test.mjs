/**
 * Слова с повторением (идея 71): «запомни слово …», «мои слова», «спроси слова».
 * Без модели; расписание — день, три, неделя, две, месяц, три месяца.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, chats, says, sdk, source, toOwner, OWNER, KEY, DAY } from "./fixtures/kit.mjs";

const { parseCards, rightAnswer, graded, dueCards, dueWords, STEPS_DAYS, CARDS_KEY } = await import("../tgcloud/lib/cards.js");

const NOON = Date.parse("2026-11-18T09:00:00Z");
const kept = (id = 5) => JSON.parse(sdk().kv.get(CARDS_KEY(id)) ?? "null");

test("разбор и счёт: пары, просьбы, верный ответ, расписание", () => {
  const cases = {
    "запомни слово apple — яблоко": { add: { front: "apple", back: "яблоко" } },
    "Запомни слово: ice-cream - мороженое": { add: { front: "ice-cream", back: "мороженое" } },
    "добавь слово кот = cat": { add: { front: "кот", back: "cat" } },
    "запомни слово: good morning: доброе утро": { add: { front: "good morning", back: "доброе утро" } },
    "запомни слово apple": { add: { front: "apple" } },
    "мои слова": { list: true }, "покажи мои слова": { list: true },
    "спроси слова": { ask: true }, "повторим слова": { ask: true }, "спроси меня все слова": { ask: true, all: true },
    "убери слово 3": { drop: 3 }, "убери слово apple": { drop: "apple" },
    "удали все слова": { clear: true }, "стоп": { stop: true }, "хватит": { stop: true },
  };
  for (const [said, want] of Object.entries(cases)) assert.deepEqual(parseCards(said), want, said);
  for (const said of ["запомни, что я люблю чай", "слова", "это мои слова!", "запомни слово", "спроси", "удали слова из песни", "убери слова"]) assert.equal(parseCards(said), null, said);
  assert.ok(rightAnswer("кажется, яблоко", "яблоко") && rightAnswer("Яблочко!", "яблоко, яблочко") && rightAnswer("to go", "go") && rightAnswer("ёж", "еж"));
  assert.ok(!rightAnswer("груша", "яблоко") && !rightAnswer("", "яблоко") && !rightAnswer("яблок", "яблоко"));
  // Верно шесть раз подряд — сроки 1, 3, 7, 14, 30, 90 дней; ошибка — снова с начала и спросить сразу.
  let card = { f: "apple", b: "яблоко", s: 0, due: NOON, n: 0, ok: 0 };
  const waits = [];
  for (let index = 0; index < 7; index += 1) { card = graded(card, true, NOON); waits.push((card.due - NOON) / DAY); }
  assert.deepEqual(waits, [...STEPS_DAYS, 90]);
  card = graded(card, false, NOON);
  assert.deepEqual([card.s, card.due, card.n, card.ok], [0, NOON, 8, 7]);
  assert.deepEqual(dueCards([{ f: "a", due: NOON + 1 }, { f: "b", due: NOON - 5 }, { f: "c", due: NOON - 9 }], NOON).map(item => item.f), ["c", "b"]);
  assert.deepEqual([dueWords(NOON, NOON), dueWords(NOON + DAY, NOON), dueWords(NOON + 5 * DAY, NOON)], ["сегодня", "завтра", "через 5 дней"]);
});

test("слова в личке: запомнить, спросить, ошибка возвращается, верное уходит на завтра; без модели", async () => {
  reset();
  let clock = NOON;
  const h = heart({}, { now: () => clock });
  await h.onMessage(message("спроси слова"), KEY);
  assert.equal(last(), "Спрашивать пока нечего. Добавить — «запомни слово apple — яблоко».");
  await h.onMessage(message("запомни слово apple — яблоко"), KEY);
  assert.equal(last(), "Запомнила: apple — яблоко. Слов: 1. Спросить — «спроси слова».");
  await h.onMessage(message("запомни слово cat — кот, кошка"), KEY);
  await h.onMessage(message("запомни слово dog — собака"), KEY);
  // Повтор слова — поправка, а не второе слово. Без переводчика слово без пары не берётся.
  await h.onMessage(message("запомни слово Apple — яблоко"), KEY);
  assert.match(last(), /^Поправила: Apple — яблоко\. Слов: 3\./u);
  await h.onMessage(message("запомни слово house"), KEY);
  assert.equal(last(), "Перевода к «house» я не нашла. Напишите с переводом: «запомни слово house — …».");
  await h.onMessage(message("мои слова"), KEY);
  assert.equal(last(), "Ваши слова (3), к повторению сейчас: 3.\n1. cat — кот, кошка · сегодня\n2. dog — собака · сегодня\n3. Apple — яблоко · сегодня\nСпросить — «спроси слова»; убрать — «убери слово 3».");

  await h.onMessage(message("спроси слова"), KEY);
  assert.equal(last(), "Слов к повторению: 3. Отвечайте переводом; «стоп» — закончить.\n\n1 из 3. Как переводится «cat»?");
  await h.onMessage(message("кошка"), KEY);
  assert.equal(last(), "Верно. Спрошу завтра.\n\n2 из 3. Как переводится «dog»?");
  // Просьба посреди опроса остаётся просьбой, опрос ждёт.
  await h.onMessage(message("мои слова"), KEY);
  assert.match(last(), /^Ваши слова \(3\), к повторению сейчас: 2\./u);
  await h.onMessage(message("волк"), KEY);
  assert.equal(last(), "Нет: dog — собака. Спрошу ещё раз в следующий заход.\n\n3 из 3. Как переводится «Apple»?");
  await h.onMessage(message("это яблоко"), KEY);
  assert.equal(last(), "Верно. Спрошу завтра.\n\nИтог: 2 из 3. Ошибки вернутся в следующий раз. Ещё — «спроси слова», список — «мои слова».");
  assert.deepEqual(kept().items.map(item => [item.f, item.s, (item.due - NOON) / DAY]), [["cat", 1, 1], ["dog", 0, 0], ["Apple", 1, 1]]);
  // Опрос кончился: следующее слово — уже разговор.
  sdk().fetchQueue.push(says("Собака — друг человека."));
  await h.onMessage(message("собака"), KEY);
  assert.equal(last(), "Собака — друг человека.");
  assert.equal(chats().length, 1, "сам опрос модель не тратил");

  // Сразу после — только ошибка; назавтра — всё; верное второй раз уходит на три дня.
  await h.onMessage(message("спроси слова"), KEY);
  assert.equal(last(), "Слов к повторению: 1. Отвечайте переводом; «стоп» — закончить.\n\n1 из 1. Как переводится «dog»?");
  await h.onMessage(message("стоп"), KEY);
  assert.equal(last(), "Хорошо, остановились: верно 0 из 0. Продолжить — «спроси слова».");
  clock += DAY + 60_000;
  await h.onMessage(message("спроси слова"), KEY);
  assert.match(last(), /^Слов к повторению: 3\./u);
  for (const said of ["собака", "кот", "яблоко"]) await h.onMessage(message(said), KEY);
  assert.match(last(), /^Верно\. Спрошу через 3 дня\.\n\nИтог: 3 из 3\. Всё верно\./u);
  await h.onMessage(message("спроси слова"), KEY);
  assert.match(last(), /^Сейчас повторять нечего: ближайшее слово — завтра\. Слов всего: 3\. Всё равно хочется — «спроси все слова»\.$/u);
  await h.onMessage(message("спроси все слова"), KEY);
  assert.match(last(), /^Слов к повторению: 3\./u);
  // Ожидание ответа не вечное: через четверть часа слово — снова разговор.
  clock += 16 * 60_000;
  sdk().fetchQueue.push(says("Кот — это кот."));
  await h.onMessage(message("кот"), KEY);
  assert.equal(last(), "Кот — это кот.");

  await h.onMessage(message("убери слово 2"), KEY);
  assert.match(last(), /^Убрала: dog — собака\. Осталось слов: 2\.$/u);
  await h.onMessage(message("убери слово zebra"), KEY);
  assert.equal(last(), "Такого слова в списке нет. Список — «мои слова».");
  // В группе — нет: список личный. «Удали всё обо мне» стирает и слова.
  await h.onMessage(group("Аи, мои слова"), KEY);
  assert.equal(last(-10), "Слова для повторения — личный список: это в личке.");
  await h.onMessage(message("мой любимый цвет — синий"), KEY);
  assert.equal(JSON.parse(sdk().kv.get("heart:tastes:5")).items.color.v, "синий");
  await h.onMessage(message("удали всё обо мне"), KEY);
  await h.onMessage(message("да, удали всё"), KEY);
  assert.equal(kept(), null);
  assert.deepEqual(JSON.parse(sdk().kv.get("heart:tastes:5")).items, {}, "анкета любимого стёрта вместе со всем");
});

test("слово без пары переводит переводчик; хозяину утром — сколько слов пора повторить", async () => {
  reset();
  source("m2m100", (url, options) => ({ success: true, result: { translated_text: { house: "дом", "кот": "cat" }[JSON.parse(options.body).text] ?? "" } }));
  let clock = NOON;
  const h = heart({ DRAW_KEY: "0123456789abcdef0123456789abcdef:cf-token_ABCDEFGH-1234567890xyz", DRAW_DIRECTOR: false, PHRASES: true, GREET: true }, { now: () => clock });
  await h.onMessage(message("запомни слово house", { id: OWNER }), KEY);
  assert.equal(last(OWNER), "Запомнила: house — дом. Перевод нашла сама — если не тот, скажите с переводом. Слов: 1. Спросить — «спроси слова».");
  await h.onMessage(message("запомни слово кот", { id: OWNER }), KEY);
  assert.match(last(OWNER), /^Запомнила: кот — cat\./u);
  assert.deepEqual(kept(OWNER).items.map(item => `${item.f}=${item.b}`), ["house=дом", "кот=cat"]);
  assert.equal(chats().length, 0);
  // Утренний привет хозяину: строка о словах есть, пока есть что повторять.
  clock = Date.parse("2026-11-19T03:05:00Z"); // 06:05 по Москве
  await h.tick({});
  const morning = toOwner().map(item => item.text).find(text => /Слов к повторению/u.test(text));
  assert.match(morning ?? "", /\nСлов к повторению: 2 — «спроси слова»\.(?:\n|$)/u);
});
