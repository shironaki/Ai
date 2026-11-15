/**
 * Итоги дня в группе: сколько написали, кто активнее, самый оживлённый час.
 * Считается по памяти чата, без модели; сама она подводит их по слову админа.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, chats, sdk, toChat, OWNER, KEY } from "./fixtures/kit.mjs";

const { parseDaySum, daySummary } = await import("../tgcloud/lib/daysum.js");

const ON = { CHAT_MEMORY: true, TIME_ZONE: "Europe/Moscow" };
const HOUR = 3_600_000, MINUTE = 60_000;
let mid = 500;
const say = (h, text, id, name) => h.onMessage(group(text, { id, name, extra: { message_id: (mid += 1) } }), KEY);

test("разбор: включить на час, выключить, показать сейчас и за вчера; «подведи итоги» остаётся опросу", () => {
  const cases = {
    "подводи итоги дня": { on: true, hour: 22, minute: 0 }, "подводи итоги дня в 21:30": { on: true, hour: 21, minute: 30 },
    "итоги дня каждый вечер": { on: true, hour: 22, minute: 0 }, "итоги дня каждый день в 9 вечера": { on: true, hour: 21, minute: 0 },
    "включи итоги дня": { on: true, hour: 22, minute: 0 }, "присылай сводку дня": { on: true, hour: 22, minute: 0 },
    "не подводи итоги дня": { on: false }, "выключи итоги": { on: false }, "хватит итогов": { on: false },
    "итоги дня": { show: true, yesterday: false }, "подведи итоги дня": { show: true, yesterday: false }, "кто сегодня самый активный?": { show: true, yesterday: false },
    "сколько сегодня написали": { show: true, yesterday: false }, "статистика чата": { show: true, yesterday: false },
    "итоги за вчера": { show: true, yesterday: true }, "кто вчера был самым активным": { show: true, yesterday: true },
  };
  for (const [said, want] of Object.entries(cases)) assert.deepEqual(parseDaySum(said), want, said);
  for (const said of ["подведи итоги", "итоги", "итоги опроса", "какие итоги матча", "кто самый умный", "сколько сегодня градусов", "итоги года", "статистика",
    "кто сегодня дежурный", "не надо", "выключи свет", "итоги дня в 25", "активность чата упала, жаль", "привет"]) assert.equal(parseDaySum(said), null, said);
});

test("счёт: кто сколько написал, самый оживлённый час, сравнение с прошлым днём; пустой день — без текста", () => {
  const from = Date.parse("2026-11-18T00:00:00Z"), till = from + 24 * HOUR;
  const row = (u, n, hour, minute = 0, t = "текст") => ({ u: String(u), n, t, at: from + hour * HOUR + minute * MINUTE });
  const rows = [
    row(1, "Вася", -1), // вчерашнее — мимо
    row(1, "Вася", 8, 5), row(2, "Маша", 8, 30), row(1, "Вася", 9), row(1, "Вася", 20, 1), row(2, "Маша", 20, 2), row(3, "Петя", 20, 3),
    row(1, "Вася", 20, 10), row(1, "Вася", 20, 20), row(2, "Маша", 20, 40), row(1, "Васёк", 21, 15), row(4, "Оля", 21, 20),
  ];
  const tools = { from, till, hourOf: (at) => new Date(at).getUTCHours(), clock: (at) => new Date(at).toISOString().slice(11, 16), label: "Итоги дня, 18.11" };
  const sum = daySummary(rows, { ...tools, before: 8 });
  assert.deepEqual([sum.count, sum.people], [11, 4]);
  assert.equal(sum.text, [
    "📊 Итоги дня, 18.11",
    "Сообщений — 11; писали 4 человека.",
    "",
    "Самые активные:",
    "🥇 Васёк — 6", "🥈 Маша — 3", "🥉 Петя — 1", "• Оля — 1",
    "",
    "Самый оживлённый час — с 20:00 до 21:00: 6 сообщений.",
    "Первое сообщение — в 08:05 (Вася), последнее — в 21:20 (Оля).",
    "Днём раньше было 8: сегодня больше на 3.",
  ].join("\n"), "человек считается по номеру: сменил имя — остался одной строкой, с новым именем");
  assert.match(daySummary(rows, { ...tools, before: 20 }).text, /Днём раньше было 20: сегодня меньше на 9\./u);
  assert.match(daySummary(rows, { ...tools, before: 11 }).text, /Столько же, сколько днём раньше\./u);
  assert.doesNotMatch(daySummary(rows, tools).text, /Днём раньше/u);
  assert.match(daySummary(rows, { ...tools, capped: true, before: 5 }).text, /^📊 Итоги дня, 18\.11\nБольше тысячи сообщений — считаю по последней тысяче; писали 4 человека\./u);
  assert.doesNotMatch(daySummary(rows, { ...tools, capped: true, before: 5 }).text, /Днём раньше/u);
  // Один человек и мало реплик — без «самого оживлённого часа».
  assert.equal(daySummary([row(1, "Вася", 8), row(1, "Вася", 9)], tools).text, "📊 Итоги дня, 18.11\nСообщений — 2; писали 1 человек.\nВесь день здесь — Вася.\n\nПервое сообщение — в 08:00 (Вася), последнее — в 09:00 (Вася).");
  assert.deepEqual(daySummary([row(1, "Вася", -5)], tools), { count: 0, people: 0, text: "" });
  assert.deepEqual(daySummary(null, tools), { count: 0, people: 0, text: "" });
});

test("в чате: «итоги дня» — сразу и любому; включает их админ; вечером приходят сами и сравнивают с прошлым днём", async () => {
  reset();
  let at = Date.parse("2026-11-18T07:00:00Z"); // 10:00 в Москве
  const h = heart(ON, { now: () => at });
  sdk().apiReplies.getChatMember = ({ user_id }) => ({ status: user_id === 21 ? "administrator" : "member" });
  await say(h, "Аи, итоги дня", 22, "Маша");
  assert.match(last(-10), /^📊 Итоги дня, 18\.11\nСообщений — 1; писали 1 человек\.\nВесь день здесь — Маша\./u, "сам вопрос — тоже сообщение дня");
  for (const [text, id, name] of [["всем привет", 21, "Вася"], ["привет!", 22, "Маша"], ["как дела", 21, "Вася"], ["нормально", 23, "Петя"], ["а я опоздал", 21, "Вася"]]) { at += 5 * MINUTE; await say(h, text, id, name); }
  await say(h, "Аи, подводи итоги дня в 21:00", 22, "Маша");
  assert.equal(last(-10), "Итоги дня в чате включают и выключают его админы.");
  await say(h, "Аи, подводи итоги дня в 21:00", 21, "Вася");
  assert.match(last(-10), /^Хорошо: итоги дня — каждый день в 21:00, в этом чате: сколько написали и кто был активнее\. Считаю сообщения с текстом/u);
  const [item] = await h.reminders.list(21);
  assert.deepEqual([item.kind, item.text, item.zone, String(item.chatId)], ["daily", "summary", "Europe/Moscow", "-10"]);

  // 21:00 по Москве: итоги приходят сами.
  const before = toChat(-10).length;
  at = Date.parse("2026-11-18T18:00:30Z");
  await h.tick({ tick: true });
  assert.equal(toChat(-10).length, before + 1);
  assert.match(last(-10), /^📊 Итоги дня, 18\.11\nСообщений — 8; писали 3 человека\.\n\nСамые активные:\n🥇 Вася — 4\n🥈 Маша — 3\n🥉 Петя — 1\n/u);
  assert.doesNotMatch(last(-10), /Днём раньше/u, "в первый день сравнивать не с чем");

  // Назавтра: реплик меньше — и это сказано.
  at = Date.parse("2026-11-19T08:00:00Z");
  await say(h, "доброе утро", 22, "Маша");
  await say(h, "доброе", 23, "Петя");
  at = Date.parse("2026-11-19T18:00:30Z");
  await h.tick({ tick: true });
  assert.match(last(-10), /^📊 Итоги дня, 19\.11\nСообщений — 2; писали 2 человека\./u);
  assert.match(last(-10), /Днём раньше было 8: сегодня меньше на 6\.$/u);
  await say(h, "Аи, итоги за вчера", 23, "Петя");
  assert.match(last(-10), /^📊 Итоги дня, 18\.11\nСообщений — 8; писали 3 человека\./u);

  // Пустой день — молчит; чат перестали запоминать — тоже, и на просьбу отвечает почему.
  const quiet = toChat(-10).length;
  at = Date.parse("2026-11-20T18:00:30Z");
  await h.tick({ tick: true });
  assert.equal(toChat(-10).length, quiet, "за день никто не написал — итогов нет, и она молчит");
  at = Date.parse("2026-11-21T08:00:00Z");
  await say(h, "есть кто?", 22, "Маша");
  await say(h, "Аи, не запоминай чат", 21, "Вася");
  await say(h, "Аи, итоги дня", 22, "Маша");
  assert.equal(last(-10), "Этот чат я не запоминаю: так решили админы, и считать мне нечего. Включить — «Аи, запоминай чат».");
  const silent = toChat(-10).length;
  at = Date.parse("2026-11-21T18:00:30Z");
  await h.tick({ tick: true });
  assert.equal(toChat(-10).length, silent);
  await say(h, "Аи, подводи итоги дня", 21, "Вася");
  assert.equal(last(-10), "Итоги я считаю по памяти чата, а её здесь выключили. Сначала — «Аи, запоминай чат».");
  assert.equal((await h.reminders.list(21)).length, 0, "прежняя рассылка при этом снята");

  // Выключить — словом админа; в личке итогов нет; хозяин — админ везде.
  await say(h, "Аи, запоминай чат", 21, "Вася");
  await say(h, "Аи, включи итоги дня", OWNER, "Хозяин");
  assert.match(last(-10), /^Хорошо: итоги дня — каждый день в 22:00/u);
  await say(h, "Аи, не подводи итоги дня", 22, "Маша");
  assert.equal(last(-10), "Итоги дня в чате включают и выключают его админы.");
  await say(h, "Аи, не подводи итоги дня", 21, "Вася");
  assert.equal(last(-10), "Хорошо, сама итоги дня больше не подвожу. По просьбе — «Аи, итоги дня».");
  await say(h, "Аи, выключи итоги", 21, "Вася");
  assert.equal(last(-10), "Я их сама и не подводила. По просьбе — «Аи, итоги дня».");
  await h.onMessage(message("итоги дня"), KEY);
  assert.equal(last(), "Итоги дня — для группы: там я считаю, кто сколько написал. В личке считать нечего.");
  assert.equal(chats().length, 0, "модель для итогов не нужна");
});

test("уход из чата снимает и итоги: рассылка в чат, из которого её убрали, не остаётся", async () => {
  reset();
  let at = Date.parse("2026-11-18T07:00:00Z");
  const h = heart(ON, { now: () => at });
  sdk().apiReplies.getChatMember = () => ({ status: "administrator" });
  await say(h, "Аи, подводи итоги дня", 21, "Вася");
  assert.equal((await h.reminders.list(21)).length, 1);
  at += HOUR;
  await h.onMyChatMember({ chat: { id: -10, type: "supergroup", title: "Чат" }, from: { id: 21, first_name: "Вася" }, old_chat_member: { status: "member" }, new_chat_member: { status: "kicked" } });
  assert.equal((await h.reminders.list(21)).length, 0);
});
