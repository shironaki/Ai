/**
 * Тетрадь чата: счёт для настольной игры, цитатник и манера чата.
 * Всё по прямой просьбе и без модели.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, sdk, says, system, chats, toChat, last, KEY, OWNER } from "./fixtures/kit.mjs";

const { parseScore, parseQuote, nameMatch, SCORE_KEY, QUOTES_KEY } = await import("../tgcloud/lib/chatbook.js");
const { parseChatSetting } = await import("../tgcloud/lib/fun.js");

const admin = (yes = true) => { sdk().apiReplies.getChatMember = { status: yes ? "administrator" : "member" }; };
const theirs = (text, { id = 31, name = "Олег", mid = 70 } = {}) => ({ message_id: mid, from: { id, first_name: name, is_bot: false }, text });

test("разбор счёта: задать, прибавить, показать, обнулить; имя в другом падеже — тот же игрок", () => {
  assert.deepEqual(parseScore("счёт: Петя 5, Маша 3"), { op: "set", rows: [{ name: "Петя", n: 5 }, { name: "Маша", n: 3 }] });
  assert.deepEqual(parseScore("Счёт: Аня — 0 и Лев = 12"), { op: "set", rows: [{ name: "Аня", n: 0 }, { name: "Лев", n: 12 }] });
  assert.deepEqual(parseScore("Пете +2"), { op: "add", name: "Пете", by: 2, soft: true });
  assert.deepEqual(parseScore("счёт Маша -1"), { op: "add", name: "Маша", by: -1, soft: true });
  assert.deepEqual(parseScore("плюс 3 Пете"), { op: "add", name: "Пете", by: 3, soft: true });
  assert.deepEqual(parseScore("очко Маше"), { op: "add", name: "Маше", by: 1, soft: true });
  for (const show of ["счёт", "какой счёт?", "кто ведёт"]) assert.deepEqual(parseScore(show), { op: "show" }, show);
  assert.deepEqual(parseScore("сбрось счёт"), { op: "reset" });
  for (const no of ["счёт: что-то непонятное", "счёт в банке", "привет", "2 + 2"]) assert.equal(parseScore(no), null, no);
  assert.equal(nameMatch("Петя", "Петя"), 2);
  assert.equal(nameMatch("Петя", "Пете"), 1);
  assert.equal(nameMatch("Олег", "Олегу"), 1);
  assert.equal(nameMatch("Оля", "Оле"), 1);
  assert.equal(nameMatch("Олег", "Оле"), 0, "«Оле» — это Оля");
  assert.equal(nameMatch("Маша", "Миша"), 0);
  assert.equal(nameMatch("Лев", "Льву"), 0, "беглую гласную не угадывает — и не притворяется");
});

test("счёт: ведётся словами, сортируется по очкам; «температура +2» — не счёт", async () => {
  reset();
  const h = heart();
  await h.onMessage(group("Аи, счёт"), KEY);
  assert.match(last(-10), /^Счёта пока нет\. Начать: «счёт: Петя 0, Маша 0»/u);
  await h.onMessage(group("Аи, счёт: Петя 0, Маша 0, Оля 0, Олег 0"), KEY);
  assert.match(last(-10), /^Счёт:\n1\. Маша — 0\n2\. Олег — 0\n3\. Оля — 0\n4\. Петя — 0\n\nДальше — «Пете \+2»/u);
  await h.onMessage(group("Аи, Пете +5"), KEY);
  await h.onMessage(group("Аи, очко Маше"), KEY);
  await h.onMessage(group("Аи, Оле +3"), KEY);
  await h.onMessage(group("Аи, минус 1 Олегу"), KEY);
  assert.equal(last(-10), "Счёт:\n1. Петя — 5\n2. Оля — 3\n3. Маша — 1\n4. Олег — -1");
  // Названные получают новые числа, остальные остаются.
  await h.onMessage(group("Аи, счёт: Маша 10"), KEY);
  assert.match(last(-10), /^Счёт:\n1\. Маша — 10\n2\. Петя — 5\n3\. Оля — 3\n4\. Олег — -1/u);
  // Незнакомое имя с числом — разговор, а не счёт.
  sdk().fetchQueue.push(says("Прохладно."));
  await h.onMessage(group("Аи, температура +2"), KEY);
  assert.equal(last(-10), "Прохладно.");
  assert.equal(chats().length, 1);
  await h.onMessage(group("Аи, сбрось счёт"), KEY);
  assert.match(last(-10), /^Счёт обнулён\. Было:\n1\. Маша — 10/u);
  assert.equal(sdk().kv.has(SCORE_KEY(-10)), false);
  // У каждого чата свой счёт.
  await h.onMessage(message("счёт: я 1, она 2"), KEY);
  assert.match(last(), /^Счёт:\n1\. она — 2\n2\. я — 1/u);
  assert.equal(sdk().kv.has(SCORE_KEY(5)), true);
});

test("разбор цитатника: сохранить, показать, убрать", () => {
  for (const save of ["в цитатник", "Это в цитатник!", "запомни цитату", "сохрани эту цитату", "добавь в цитатник"]) assert.deepEqual(parseQuote(save), { op: "save" }, save);
  for (const random of ["цитата", "цитату", "случайная цитата", "дай цитату"]) assert.deepEqual(parseQuote(random), { op: "random" }, random);
  for (const list of ["цитатник", "покажи цитатник", "цитаты", "сколько цитат"]) assert.deepEqual(parseQuote(list), { op: "list" }, list);
  assert.deepEqual(parseQuote("удали цитату 3"), { op: "drop", index: 3 });
  assert.deepEqual(parseQuote("удали последнюю цитату"), { op: "drop", index: -1 });
  assert.deepEqual(parseQuote("удали мои цитаты"), { op: "mine" });
  for (const no of ["цитата из книги про войну", "привет", "в цитатник всё подряд записывай"]) assert.equal(parseQuote(no), null, no);
});

test("цитатник: только по просьбе и только текст; убрать может автор, сохранивший или админ", async () => {
  reset();
  const h = heart({}, { now: () => Date.UTC(2026, 10, 12, 13, 0), random: () => 0 });
  await h.onMessage(group("Аи, цитата"), KEY);
  assert.match(last(-10), /^Цитатник пуст/u);
  await h.onMessage(group("Аи, в цитатник"), KEY);
  assert.match(last(-10), /^Что сохранить\? Ответьте этими словами на сообщение/u);
  await h.onMessage(group("Аи, в цитатник", { id: 21, reply: { message_id: 71, from: { id: 31, first_name: "Олег" }, photo: [{ file_id: "p" }] } }), KEY);
  assert.match(last(-10), /только текст/u);
  await h.onMessage(group("Аи, в цитатник", { id: 21, reply: theirs("Кто рано встаёт, тот всех достаёт") }), KEY);
  assert.equal(last(-10), "Записала в цитатник — №1.");
  await h.onMessage(group("Аи, в цитатник", { id: 22, reply: theirs("Кто рано встаёт, тот всех достаёт") }), KEY);
  assert.equal(last(-10), "Эта цитата уже в цитатнике.");
  await h.onMessage(group("Аи, запомни цитату", { id: 22, reply: theirs("Чай — это суп из листьев", { id: 32, name: "Нина", mid: 72 }) }), KEY);
  assert.equal(last(-10), "Записала в цитатник — №2.");
  await h.onMessage(group("Аи, цитата"), KEY);
  assert.equal(last(-10), "❝ Кто рано встаёт, тот всех достаёт ❞\n— Олег, 12.11.2026");
  await h.onMessage(group("Аи, цитатник"), KEY);
  assert.equal(last(-10), "В цитатнике 2. Последние:\n\n1. «Кто рано встаёт, тот всех достаёт» — Олег\n2. «Чай — это суп из листьев» — Нина\n\nСлучайная — «цитата». Убрать — «удали цитату 3»; свои — «удали мои цитаты».");
  assert.equal(chats().length, 0);

  admin(false);
  await h.onMessage(group("Аи, удали цитату 2", { id: 40 }), KEY);
  assert.match(last(-10), /Убрать цитату может её автор, тот, кто её сохранил, или админ чата/u);
  await h.onMessage(group("Аи, удали цитату 9", { id: 22 }), KEY);
  assert.match(last(-10), /с таким номером нет: всего их 2/u);
  await h.onMessage(group("Аи, удали мои цитаты", { id: 31 }), KEY);
  assert.equal(last(-10), "Убрала ваши цитаты: 1.");
  await h.onMessage(group("Аи, удали мои цитаты", { id: 31 }), KEY);
  assert.equal(last(-10), "Ваших слов в цитатнике нет.");
  await h.onMessage(group("Аи, удали последнюю цитату", { id: 22 }), KEY);
  assert.equal(last(-10), "Убрала цитату №1.", "сохранивший может убрать");
  assert.deepEqual(JSON.parse(sdk().kv.get(QUOTES_KEY(-10))).items, []);
  await h.onMessage(group("Аи, в цитатник", { id: 21, reply: theirs("Третья", { mid: 73 }) }), KEY);
  admin(true);
  // Другой человек: права того, кто уже спрашивал, она помнит пять минут.
  await h.onMessage(group("Аи, удали цитату 1", { id: 41 }), KEY);
  assert.equal(last(-10), "Убрала цитату №1.", "админ может убрать");
});

test("манера чата: задаёт админ, доходит до подсказки; у остальных и в личке это просто просьба", async () => {
  assert.equal(parseChatSetting("будь серьёзнее").patch.tone, "serious");
  assert.equal(parseChatSetting("Будь тут повеселее!").patch.tone, "playful");
  assert.equal(parseChatSetting("говори в этом чате короче").patch.tone, "brief");
  assert.equal(parseChatSetting("будь как обычно").patch.tone, "");
  for (const no of ["будь здорова", "будь добра, подскажи", "говори"]) assert.equal(parseChatSetting(no), null, no);

  reset();
  const h = heart();
  admin(false);
  sdk().fetchQueue.push(says("Постараюсь."));
  await h.onMessage(group("Аи, будь серьёзнее", { id: 21 }), KEY);
  assert.equal(last(-10), "Постараюсь.", "не админ — это разговор, а не настройка");
  assert.doesNotMatch(system(), /Админы этого чата просили/u);
  admin(true);
  await h.onMessage(group("Аи, будь серьёзнее", { id: 22 }), KEY);
  assert.equal(last(-10), "Хорошо, в этом чате буду серьёзной: по делу и без шуток. Вернуть — «будь как обычно».");
  sdk().fetchQueue.push(says("По делу."));
  await h.onMessage(group("Аи, что думаешь о погоде на Марсе?", { id: 21 }), KEY);
  assert.match(system(), /Админы этого чата просили тебя быть здесь серьёзной: по делу, без шуток и заигрываний\./u);
  await h.onMessage(group("Аи, настройки чата", { id: 22 }), KEY);
  assert.match(last(-10), /• манера — серьёзной;/u);
  await h.onMessage(group("Аи, будь как обычно", { id: 22 }), KEY);
  assert.equal(last(-10), "Хорошо, в этом чате снова говорю как обычно.");
  sdk().fetchQueue.push(says("Как обычно."), says("Хорошо."));
  await h.onMessage(group("Аи, расскажи что-нибудь", { id: 21 }), KEY);
  assert.doesNotMatch(system(), /Админы этого чата просили/u);
  // В личке манеру чата не задают: там у человека свои настройки.
  await h.onMessage(message("будь серьёзнее", { id: OWNER }), KEY);
  assert.equal(last(OWNER), "Хорошо.");
});
