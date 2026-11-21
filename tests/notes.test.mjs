/**
 * Списки, цели, дневник: строки человека возвращаются дословно, модель их
 * не пишет; «тишина» в группе и «вопрос дня».
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, hers, reset, sdk, toChat, last, reactions, chats, says, KEY, OWNER, DAY } from "./fixtures/kit.mjs";

const { parseNote, sameList, NOTES_KEY } = await import("../tgcloud/lib/notes.js");
const { parseQuiet, parseQuestion } = await import("../tgcloud/lib/fun.js");
const { QUESTIONS } = await import("../tgcloud/lib/data/games.js");

test("разбор списков: добавить, показать, вычеркнуть; слова человека сохраняются как написаны", () => {
  assert.deepEqual(parseNote("Список покупок: Молоко, хлеб и Сыр"), { op: "add", kind: "list", list: "покупок", items: ["Молоко", "хлеб", "Сыр"], explicit: true });
  assert.deepEqual(parseNote("добавь молоко и хлеб в список покупок").items, ["молоко", "хлеб"]);
  assert.deepEqual(parseNote("запиши в покупки: чай"), { op: "add", kind: "list", list: "покупки", items: ["чай"], explicit: false });
  assert.deepEqual(parseNote("вычеркни 2 из покупок"), { op: "strike", kind: "list", list: "покупок", item: "2", explicit: false });
  assert.equal(parseNote("что в списке покупок?").op, "show");
  assert.deepEqual(parseNote("Цель: выучить 100 кандзи."), { op: "add", kind: "goals", list: "цели", items: ["выучить 100 кандзи"] });
  assert.deepEqual(parseNote("цель 2 выполнена"), { op: "done", kind: "goals", list: "цели", item: "2" });
  assert.deepEqual(parseNote("Дневник: Сегодня был хороший день. Гулял!").items, ["Сегодня был хороший день. Гулял!"], "запись дневника — со знаками");
  assert.equal(parseNote("сотри дневник").sure, false);
  assert.equal(parseNote("сотри дневник навсегда").sure, true);
  for (const text of ["список", "покажи список", "запиши, что я люблю чай", "цель жизни в чём", "дневник это полезно"]) assert.equal(parseNote(text), null, text);
  assert.deepEqual([["покупки", "покупок"], ["дела", "дел"], ["фильмы", "фильмов"], ["книги на лето", "книг на лето"], ["задачи", "задания"], ["покупки", "подарки"]].map(pair => sameList(...pair)), [true, true, true, true, false, false]);
});

test("список покупок: запись, показ, отметка, вычёркивание; один список в личке и в группе", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("список покупок: Молоко, хлеб и Сыр", { id: 7 }), KEY);
  assert.equal(last(7), "Записала в список покупок: Молоко, хлеб, Сыр. Всего — 3.");
  await h.onMessage(message("запиши в покупки: чай", { id: 7 }), KEY);
  assert.equal(last(7), "Записала в список покупок: чай. Всего — 4.", "«покупки» и «покупок» — один список");
  await h.onMessage(message("отметь хлеб в списке покупок", { id: 7 }), KEY);
  assert.equal(last(7), "Отметила: ✅ хлеб. Осталось — 3.");
  await h.onMessage(group("Аи, покажи список покупок", { id: 7 }), KEY);
  assert.equal(toChat(-10).at(-1).text, "📝 Список покупок (4, готово 1):\n1. Молоко\n2. ✅ хлеб\n3. Сыр\n4. чай");
  await h.onMessage(message("вычеркни молоко из списка покупок", { id: 7 }), KEY);
  assert.equal(last(7), "Вычеркнула: Молоко. Осталось — 3.");
  await h.onMessage(message("вычеркни 9 из покупок", { id: 7 }), KEY);
  assert.match(last(7), /^Не нашла «9» в списке покупок\.\n\n📝 Список покупок \(3/u);
  await h.onMessage(message("мои списки", { id: 7 }), KEY);
  assert.match(last(7), /Что у вас записано:\n• Список покупок — 3 записи/u);
  // Чужой список не виден: у другого человека свой.
  await h.onMessage(message("покажи список покупок", { id: 8 }), KEY);
  assert.equal(last(8), "Списка «покупок» у вас нет. Завести — «список покупок: …».");
  await h.onMessage(message("удали список покупок", { id: 7 }), KEY);
  assert.equal(last(7), "Список покупок удалён.");
  assert.equal(await h.store.get(NOTES_KEY(7)), null);
  // Заведён словами «в дела» — так и зовётся, без кривого падежа.
  await h.onMessage(message("запиши в дела: позвонить маме", { id: 7 }), KEY);
  assert.equal(last(7), "Записала в «дела»: позвонить маме. Всего — 1.");
  await h.onMessage(message("покажи список дел", { id: 7 }), KEY);
  assert.equal(last(7), "📝 «дела» (1):\n1. позвонить маме");
  assert.equal(chats().length, 0, "списки ведёт код, а не модель");
});

test("списки не перехватывают чужое: «список уроков», «убери это из памяти», «добавь в память»", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("список уроков", { id: OWNER }), KEY);
  assert.doesNotMatch(last(OWNER), /Списка «уроков»/u);
  sdk().fetchQueue.push(says("Хорошо."), says("Ладно."));
  await h.onMessage(message("убери это из памяти", { id: 7 }), KEY);
  assert.doesNotMatch(last(7), /Списка|списке/u);
  await h.onMessage(message("добавь в память: я люблю чай", { id: 7 }), KEY);
  assert.equal(await h.store.get(NOTES_KEY(7)), null, "списка «память» не появилось");
  // Идёт игра — запись в список ходом не считается.
  await h.onMessage(message("города", { id: 7 }), KEY);
  await h.onMessage(message("список дел: позвонить маме", { id: 7 }), KEY);
  assert.equal(last(7), "Записала в список дел: позвонить маме. Всего — 1.");
});

test("цели и дневник: цель закрывается по номеру; дневник — только в личке и стирается вторым словом", async () => {
  reset();
  const at = Date.UTC(2026, 10, 12, 9);
  const h = heart({}, { now: () => at });
  await h.onMessage(message("цель: выучить 100 кандзи", { id: 7 }), KEY);
  assert.equal(last(7), "🎯 Цель записана — №1. Выполните — скажите «цель 1 выполнена».");
  await h.onMessage(message("Цель: пробежать 5 км.", { id: 7 }), KEY);
  await h.onMessage(message("цель 1 выполнена", { id: 7 }), KEY);
  assert.equal(last(7), "🎯 Выполнено: «выучить 100 кандзи». Впереди ещё 1.");
  await h.onMessage(message("мои цели", { id: 7 }), KEY);
  assert.equal(last(7), "🎯 Цели (2, готово 1):\n1. ✅ выучить 100 кандзи\n2. пробежать 5 км");
  await h.onMessage(message("цель 2 выполнена", { id: 7 }), KEY);
  assert.match(last(7), /все цели закрыты/u);
  await h.onMessage(message("мои цели", { id: 8 }), KEY);
  assert.equal(last(8), "Целей пока нет. Записать — «цель: …».");

  await h.onMessage(message("Дневник: Сегодня был хороший день. Гулял!", { id: 7 }), KEY);
  assert.equal(last(7), "Записала в дневник. Записей — 1.");
  await h.onMessage(message("покажи дневник", { id: 7 }), KEY);
  assert.equal(last(7), "📔 Дневник:\n\n12.11 — Сегодня был хороший день. Гулял!");
  await h.onMessage(group("Аи, покажи дневник", { id: 7 }), KEY);
  assert.equal(toChat(-10).at(-1).text, "Дневник — личное: веду и показываю его только в личке.");
  await h.onMessage(message("сотри дневник", { id: 7 }), KEY);
  assert.match(last(7), /В дневнике 1 запись, и вернуть их будет нельзя\. Чтобы стереть, скажите: «сотри дневник навсегда»/u);
  assert.equal((await h.store.get(NOTES_KEY(7))).lists.length, 2);
  await h.onMessage(message("сотри дневник навсегда", { id: 7 }), KEY);
  assert.equal(last(7), "Дневник стёрт: записей было 1.");
  assert.equal(chats().length, 0);
});

test("«удали всё обо мне» стирает и списки с дневником", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("список покупок: молоко", { id: 7 }), KEY);
  await h.onMessage(message("дневник: секрет", { id: 7 }), KEY);
  assert.ok(await h.store.get(NOTES_KEY(7)));
  await h.onMessage(message("удали всё обо мне", { id: 7 }), KEY);
  await h.onMessage(message("да, удали всё", { id: 7 }), KEY);
  assert.match(last(7), /Готово: записей, переписки, имени и настроек больше нет/u);
  assert.equal(await h.store.get(NOTES_KEY(7)), null);
});

test("тишина: «помолчи час» в группе просит админ; молчит на всё, кроме «можешь говорить»", async () => {
  assert.deepEqual(["помолчи", "помолчи час", "помолчи 2 часа", "тихо на 15 минут", "не пиши полчаса", "замолчи на сутки", "помолчи 99 часов"].map(text => parseQuiet(text).ms / 60_000), [60, 60, 120, 15, 30, 1440, 1440]);
  assert.deepEqual(parseQuiet("можешь говорить"), { speak: true });
  for (const text of ["помолчи со мной о главном", "тихо в лесу", "не пиши ночью"]) assert.equal(parseQuiet(text), null, text);

  reset();
  let at = 1_800_000_000_000;
  const h = heart({}, { now: () => at });
  sdk().apiReplies.getChatMember = ({ user_id }) => ({ status: user_id === 51 ? "administrator" : "member" });
  await h.onMessage(group("Аи, помолчи час", { id: 52, name: "Гость" }), KEY);
  assert.match(toChat(-10).at(-1).text, /просят админы чата/u);
  await h.onMessage(group("Аи, помолчи 2 часа", { id: 51, name: "Админ" }), KEY);
  assert.equal(toChat(-10).at(-1).text, "Молчу 2 ч. Раньше — «Аи, можешь говорить».");

  const before = toChat(-10).length;
  const asked = await h.onMessage(group("Аи, как дела?", { id: 52, name: "Гость" }), KEY);
  assert.equal(asked.reason, "quiet");
  assert.deepEqual(reactions(), ["🙊"], "молчание видно: это не поломка");
  assert.equal((await h.onMessage(group("обнять", { id: 52, name: "Гость", reply: { message_id: 70, from: { id: 22, first_name: "Маша", is_bot: false }, text: "привет" } }), KEY)).reason, "quiet");
  assert.equal((await h.onMessage({ message_id: 901, chat: { id: -10, type: "supergroup", title: "Чат" }, from: { id: 61, first_name: "Новый" }, new_chat_members: [{ id: 61, first_name: "Новый" }] }, KEY)).reason, "quiet");
  assert.equal((await h.onMessage(group("Аи, можешь говорить", { id: 52, name: "Гость" }), KEY)).reason, "quiet", "снять тишину может админ");
  assert.equal(toChat(-10).length, before);
  assert.equal(chats().length, 0);

  await h.onMessage(group("Аи, можешь говорить", { id: 51, name: "Админ" }), KEY);
  assert.equal(toChat(-10).at(-1).text, "Я снова здесь.");
  // Срок вышел сам — она снова отвечает.
  await h.onMessage(group("Аи, тихо на 15 минут", { id: 51, name: "Админ" }), KEY);
  assert.equal(toChat(-10).at(-1).text, "Молчу 15 мин. Раньше — «Аи, можешь говорить».");
  at += 16 * 60_000;
  await h.onMessage(group("Аи, настройки чата", { id: 52, name: "Гость" }), KEY);
  assert.match(toChat(-10).at(-1).text, /Настройки этого чата/u);
  // В личке она пишет в ответ — и редко первой (0.49.0): о том, как это выключить, и говорит (0.50.0).
  await h.onMessage(message("помолчи час", { id: 7 }), KEY);
  assert.match(last(7), /^В личке я пишу в ответ, а первой — редко и только о своём дне; не нужно и этого — «не пиши»\. Ночные вести отключает «не пиши ночью»/u);
});

test("тихий час: «помолчи до 8:00» — до часа на часах; хозяину она отвечает и в тишине, и при выключенных действиях", async () => {
  assert.deepEqual(parseQuiet("помолчи до 8:00"), { at: { hh: 8, mm: 0 } });
  assert.deepEqual(parseQuiet("тихий час до 7.30"), { at: { hh: 7, mm: 30 } });
  assert.deepEqual(parseQuiet("помолчи до 9 вечера"), { at: { hh: 21, mm: 0 } });
  assert.deepEqual(parseQuiet("тихо до утра"), { at: { hh: 8, mm: 0 } });
  assert.deepEqual(parseQuiet("тихий час"), { ms: 3_600_000 });
  assert.deepEqual(parseQuiet("тихий час на 2 часа"), { ms: 7_200_000 });
  for (const text of ["отмени тихий час", "тихий час окончен", "конец тихого часа"]) assert.deepEqual(parseQuiet(text), { speak: true }, text);
  for (const text of ["помолчи до пятницы", "молчи до 25:00", "тихий час у детей до 3", "доживём до 8:00", "до 8:00"]) assert.equal(parseQuiet(text), null, text);

  reset();
  let at = Date.parse("2026-11-18T19:00:00Z");
  const h = heart({ TIME_ZONE: "Europe/Moscow" }, { now: () => at });
  sdk().apiReplies.getChatMember = ({ user_id }) => ({ status: user_id === 51 ? "administrator" : "member" });
  await h.onMessage(group("Аи, помолчи до 8:00", { id: 52, name: "Гость" }), KEY);
  assert.match(toChat(-10).at(-1).text, /просят админы чата/u);
  await h.onMessage(group("Аи, помолчи до 8:00", { id: 51, name: "Админ" }), KEY);
  assert.equal(toChat(-10).at(-1).text, "Тихий час: молчу до 08:00. Раньше — «Аи, можешь говорить».");

  // Остальным — тишина; хозяину — ответ, как всегда: к нему нет ограничений.
  const before = toChat(-10).length;
  assert.equal((await h.onMessage(group("Аи, как дела?", { id: 52, name: "Гость" }), KEY)).reason, "quiet");
  assert.equal(toChat(-10).length, before);
  await h.onMessage(group("Аи, расскажи про дождь", { id: 7, name: "Хозяин" }), KEY);
  assert.equal(toChat(-10).length, before + 1, "хозяину она ответила и в тихий час");
  assert.equal(chats().length, 1);
  // Тишина для остальных от этого не кончилась.
  assert.equal((await h.onMessage(group("Аи, как дела?", { id: 52, name: "Гость" }), KEY)).reason, "quiet");

  // 22:00 по Москве → до 8:00 завтра: в 7:59 ещё тихо, в 8:01 — уже нет.
  at = Date.parse("2026-11-19T04:59:00Z");
  assert.equal((await h.onMessage(group("Аи, как дела?", { id: 52, name: "Гость" }), KEY)).reason, "quiet");
  at = Date.parse("2026-11-19T05:01:00Z");
  await h.onMessage(group("Аи, настройки чата", { id: 52, name: "Гость" }), KEY);
  assert.match(toChat(-10).at(-1).text, /Настройки этого чата/u);

  // Ролевые действия выключены настройкой чата — хозяину они остаются.
  await h.onMessage(group("Аи, выключи рп", { id: 51, name: "Админ" }), KEY);
  const masha = { message_id: 70, from: { id: 22, first_name: "Маша", is_bot: false }, text: "привет" };
  assert.equal((await h.onMessage(group("обнять", { id: 52, name: "Гость", reply: masha }), KEY)).reason, "rp_off");
  const count = toChat(-10).length;
  await h.onMessage(group("обнять", { id: 7, name: "Хозяин", reply: masha }), KEY);
  assert.equal(toChat(-10).length, count + 1);
  assert.match(toChat(-10).at(-1).text, /обнимает/u);
});

test("вопрос дня: один на день и чат, «ещё вопрос» — следующий; назавтра — новый", async () => {
  assert.deepEqual(["вопрос дня", "задай вопрос", "подкинь тему для разговора", "о чём поговорить?"].map(text => parseQuestion(text)?.more), [false, false, false, false]);
  assert.equal(parseQuestion("ещё вопрос").more, true);
  assert.equal(parseQuestion("у меня вопрос"), null);
  assert.equal(new Set(QUESTIONS).size, QUESTIONS.length);
  assert.ok(QUESTIONS.length >= 30);

  reset();
  let at = Date.UTC(2026, 10, 12, 9);
  const h = heart({}, { now: () => at });
  await h.onMessage(group("Аи, вопрос дня", { id: 21 }), KEY);
  const first = toChat(-10).at(-1).text;
  assert.match(first, /^💬 Вопрос дня:\n/u);
  assert.ok(QUESTIONS.includes(first.split("\n")[1]));
  await h.onMessage(group("Аи, вопрос дня", { id: 22 }), KEY);
  assert.equal(toChat(-10).at(-1).text, first, "в тот же день вопрос тот же");
  await h.onMessage(group("Аи, ещё вопрос", { id: 22 }), KEY);
  const second = toChat(-10).at(-1).text;
  assert.match(second, /^💬 Ещё вопрос:\n/u);
  assert.notEqual(second.split("\n")[1], first.split("\n")[1]);
  await h.onMessage(message("вопрос дня", { id: 7 }), KEY);
  assert.notEqual(last(7), first, "в другом чате вопрос другой");
  at += DAY;
  await h.onMessage(group("Аи, вопрос дня", { id: 21 }), KEY);
  assert.notEqual(toChat(-10).at(-1).text, first);
  assert.equal(chats().length, 0);
});
