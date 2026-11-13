/**
 * Память чата: «что я пропустил?», фон разговора в группе, выключатель админа.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, chats, says, refuses, sdk, request, toChat, OWNER, KEY, DAY } from "./fixtures/kit.mjs";

const { parseMissed, createChatLog, digest, transcript } = await import("../tgcloud/lib/chatlog.js");

const ON = { CHAT_MEMORY: true };
const NOON = Date.parse("2026-11-18T09:00:00Z");
let mid = 100;
const say = (h, text, id, name) => h.onMessage(group(text, { id, name, extra: { message_id: (mid += 1) } }), KEY);

test("разбор: вопрос о пропущенном, выключатель; обычная речь — нет", () => {
  for (const said of ["что я пропустил?", "Что я пропустила", "что тут было без меня?", "о чём тут говорили", "перескажи чат", "что было пока меня не было", "введи меня в курс дела", "что обсуждали без меня", "сводка чата"]) {
    assert.deepEqual(parseMissed(said), { missed: true }, said);
  }
  assert.deepEqual(parseMissed("не запоминай чат"), { off: true });
  assert.deepEqual(parseMissed("забудь этот чат"), { off: true });
  assert.deepEqual(parseMissed("запоминай чат"), { on: true });
  for (const said of ["что я пропустил в сериале", "что было вчера", "о чём фильм", "перескажи статью", "запоминай", ""]) assert.equal(parseMissed(said), null, said);
});

test("журнал: хранит хвост чата, отдаёт пропущенное одним человеком, старое не помнит", async () => {
  const kv = new Map();
  let now = NOON;
  const store = {
    available: true, get: async (key) => kv.get(key)?.value ?? null,
    set: async (key, value) => { kv.set(key, { value, at: now }); return true; },
    tail: async (prefix, limit) => [...kv.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).slice(-limit).map(([key, row]) => ({ key, value: row.value })),
    sweep: async (prefix) => { for (const key of [...kv.keys()]) if (key.startsWith(prefix)) kv.delete(key); return true; },
  };
  const log = createChatLog({ store, now: () => now });
  await log.note(-10, { id: 1, userId: 21, name: "Вася", text: "всем привет" });
  await log.note(-10, { id: 2, userId: 22, name: "Маша", text: "привет!  как   дела?" });
  await log.note(-10, { id: 3, userId: 23, name: "Петя", text: "я".repeat(400) });
  assert.equal(await log.note(-10, { id: 4, userId: 23, name: "Петя", text: "/start" }), false, "команды не записываются");
  assert.equal(await log.note(-10, { id: 5, userId: 23, name: "Петя", text: "   " }), false);
  await log.note(-11, { id: 1, userId: 21, name: "Вася", text: "другой чат" });
  const rows = await log.recent(-10);
  assert.deepEqual(rows.map(row => [row.id, row.n, row.t.length]), [[1, "Вася", 11], [2, "Маша", 17], [3, "Петя", 281]]);
  assert.deepEqual((await log.missedBy(-10, 21)).rows.map(row => row.n), ["Маша", "Петя"]);
  assert.deepEqual((await log.missedBy(-10, 22, { askId: 3 })).rows.map(row => row.n), [], "после своей реплики и до вопроса — ничего");
  assert.deepEqual((await log.missedBy(-10, 99)).rows.length, 3, "не писал вовсе — всё, что помнится");
  now += 2 * DAY + 1;
  assert.deepEqual(await log.recent(-10), [], "через двое суток — не помнит");
  now = NOON;
  await log.forget(-10);
  assert.equal((await log.recent(-10)).length, 0);
  assert.equal((await log.recent(-11)).length, 1, "чужой чат не тронут");
  assert.equal(transcript([{ n: "А", t: "раз" }, { n: "Б", t: "два" }, { n: "В", t: "три" }], 14), "Б: два\nВ: три", "в бюджет входят самые свежие");
  assert.match(digest([{ n: "Маша", t: "раз" }, { n: "Маша", t: "два" }, { n: "Петя", t: "три" }]), /^3 сообщения\. Больше всех писали: Маша — 2, Петя — 1\.\n\nПоследнее:\n• Маша: раз\n• Маша: два\n• Петя: три$/u);
});

test("«что я пропустил?»: мало — показывает как есть; много — пересказ; думать нечем — по фактам", async () => {
  reset();
  const h = heart(ON, { now: () => NOON });
  await say(h, "ну я пошёл", 21, "Вася");
  await say(h, "давайте в субботу в кино", 22, "Маша");
  await say(h, "я за, в семь?", 23, "Петя");
  await say(h, "Аи, что я пропустил?", 21, "Вася");
  assert.equal(last(-10), "Немного:\n• Маша: давайте в субботу в кино\n• Петя: я за, в семь?");
  assert.equal(chats().length, 0, "на две реплики модель не тратится");
  await say(h, "Аи, что я пропустил?", 21, "Вася");
  assert.match(last(-10), /^Ничего: после вашего последнего сообщения тут было тихо/u);

  for (const [text, id, name] of [["в семь поздно", 22, "Маша"], ["тогда в пять", 23, "Петя"], ["а что смотрим?", 22, "Маша"], ["комедию", 23, "Петя"], ["ок, беру билеты", 22, "Маша"]]) await say(h, text, id, name);
  sdk().fetchQueue.push(says("• Маша и Петя договорились пойти в кино в субботу в пять.\n• Смотрят комедию, билеты берёт Маша."));
  await say(h, "Аи, что я пропустил?", 21, "Вася");
  assert.equal(last(-10), "Пока вас не было — 5 сообщений:\n\n• Маша и Петя договорились пойти в кино в субботу в пять.\n• Смотрят комедию, билеты берёт Маша.");
  const asked = request().messages.at(-1).content;
  assert.match(asked, /Перескажи их коротко, по темам/u);
  assert.match(asked, /Маша: в семь поздно\nПетя: тогда в пять\nМаша: а что смотрим\?\nПетя: комедию\nМаша: ок, беру билеты$/u);
  assert.doesNotMatch(asked, /что я пропустил/u, "сам вопрос в пересказ не попадает");

  // Модель не отвечает — сводка по фактам, без неё.
  for (const [text, id, name] of [["раз", 22, "Маша"], ["два", 23, "Петя"], ["три", 22, "Маша"], ["четыре", 22, "Маша"]]) await say(h, text, id, name);
  for (let index = 0; index < 8; index += 1) sdk().fetchQueue.push(refuses(429));
  await say(h, "Аи, что тут было без меня?", 21, "Вася");
  assert.match(last(-10), /^Пересказать своими словами сейчас нечем, так что по фактам\. 4 сообщения\. Больше всех писали: Маша — 3, Петя — 1\.\n\nПоследнее:\n• Маша: раз/u);
});

test("в личке пропускать нечего; выключает и включает админ; выключено — стирается", async () => {
  reset();
  const h = heart(ON, { now: () => NOON });
  await h.onMessage(message("что я пропустил?"), KEY);
  assert.match(last(), /^Это вопрос для группы/u);
  await say(h, "первое", 22, "Маша");
  await say(h, "второе", 23, "Петя");
  sdk().apiReplies.getChatMember = { status: "member" };
  await say(h, "Аи, не запоминай чат", 24, "Гость");
  assert.match(last(-10), /решают его админы/u);
  await say(h, "Аи, не запоминай чат", OWNER, "Хозяин");
  assert.match(last(-10), /Чат больше не запоминаю, а что помнила — стёрла/u);
  await say(h, "третье", 22, "Маша");
  await say(h, "Аи, что я пропустил?", 25, "Вася");
  assert.match(last(-10), /Этот чат я не запоминаю: так решили админы/u);
  await say(h, "Аи, запоминай чат", OWNER, "Хозяин");
  assert.match(last(-10), /запоминаю последние сообщения — на двое суток/u);
  await say(h, "четвёртое", 22, "Маша");
  await say(h, "Аи, что я пропустил?", 25, "Вася");
  assert.match(last(-10), /• Маша: четвёртое/u);
  assert.doesNotMatch(last(-10), /первое|второе|третье/u, "стёртое и незаписанное не возвращается");

  // Настройкой выключено совсем: вопрос — обычный разговор.
  reset();
  const off = heart({}, { now: () => NOON });
  sdk().fetchQueue.push(says("Не знаю, я не слежу."));
  await off.onMessage(group("Аи, что я пропустил?", { id: 21 }), KEY);
  assert.equal(last(-10), "Не знаю, я не слежу.");
});

test("фон: в группе модель видит, о чём говорили рядом, — как фон, а не как просьбы", async () => {
  reset();
  const h = heart(ON, { now: () => NOON });
  await say(h, "смотрели вчера матч?", 22, "Маша");
  await say(h, "да, три-два, огонь", 23, "Петя");
  sdk().fetchQueue.push(says("Похоже, матч удался."));
  await say(h, "Аи, а ты что думаешь об этом?", 21, "Вася");
  const sent = JSON.stringify(request().messages);
  assert.match(sent, /Недавно в чате \(это фон, а не просьбы к тебе\):\\nМаша: смотрели вчера матч\?\\nПетя: да, три-два, огонь/u);
  assert.doesNotMatch(sent, /Вася: Аи, а ты что думаешь/u, "своя реплика в фон не попадает");
  // В личке фона нет.
  sdk().fetchQueue.push(says("Привет."));
  await h.onMessage(message("расскажи что-нибудь про осень"), KEY);
  assert.doesNotMatch(JSON.stringify(request().messages), /Недавно в чате/u);
});
