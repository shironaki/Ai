/**
 * Её чаты: Telegram сообщает, что её добавили, сделали админом, сняли, убрали
 * (`my_chat_member`). Она ведёт список чатов, пробует «сообщения для одного»,
 * как только получает права, и стирает рабочее о чате, из которого её убрали.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, chats, sdk, toChat, toOwner, OWNER, KEY } from "./fixtures/kit.mjs";

const CLUB = { id: -20, type: "supergroup", title: "Клуб" };
const VASYA = { id: 21, first_name: "Вася", is_bot: false };
const moved = (from, to, { chat = CLUB, by = VASYA } = {}) => ({ chat, from: by, date: 1, old_chat_member: { status: from, user: { id: 999 } }, new_chat_member: { status: to, user: { id: 999 } } });
const told = () => toOwner().map(item => item.text).join("\n");
const kept = (key) => JSON.parse(sdk().kv.get(key) ?? "null");

test("добавили в чат, сделали админом: чат в списке, хозяину — весть, «сообщение для одного» пробуется сразу", async () => {
  reset();
  sdk().whispers = { admin: [] };
  const h = heart();
  assert.deepEqual(await h.onMyChatMember(moved("left", "member"), { testRun: true }), { ok: true, side_effects: "none" }, "репетиция ничего не делает");
  assert.equal(sdk().kv.has("heart:chats:v1"), false);

  assert.equal((await h.onMyChatMember(moved("left", "member"))).action, "joined");
  assert.match(told(), /Меня добавили в чат «Клуб» — Вася\./u);
  // Пока она не админ, чат в личных сообщениях отказывал — и это помнилось.
  sdk().kv.set("heart:whisper:-20", JSON.stringify({ no: true, at: Date.now() }));

  // Дали права: отказ забыт, и первое сообщение для одного уходит тому, кто их дал.
  sdk().whispers = { admin: [-20] };
  const promoted = await h.onMyChatMember(moved("member", "administrator"));
  assert.deepEqual([promoted.action, promoted.whispered], ["promoted", true]);
  const whisper = sdk().sent.at(-2);
  assert.deepEqual(whisper.ephemeral_message_parameters, { receiver_user_id: 21 });
  assert.match(whisper.text, /только (?:ты|вы)/u);
  assert.equal(sdk().kv.has("heart:whisper:-20"), false);
  assert.match(told(), /В чате «Клуб» меня сделали админом — Вася\. Сообщения для одного человека там работают\./u);

  // Хозяин спрашивает, где она; чужому список не показывается.
  await h.onMessage(message("в каких ты чатах?", { id: OWNER }), KEY);
  assert.equal(last(OWNER), "Я в 1 чате:\n1. Клуб — чат, я админ, личные сообщения работают");
  await h.onMessage(message("в каких ты чатах?"), KEY);
  assert.doesNotMatch(last(), /Клуб/u);
  await h.onMessage(group("Аи, в каких ты чатах?", { id: OWNER, chat: -20 }), KEY);
  assert.doesNotMatch(toChat(-20).at(-1).text, /Клуб — чат/u, "и при всех — тоже");

  // Права сняли: в личных сообщениях там снова отказ, без пробы.
  assert.equal((await h.onMyChatMember(moved("administrator", "member"))).action, "demoted");
  assert.equal(kept("heart:whisper:-20")?.no, true);
  delete sdk().whispers;
});

test("убрали из чата: настройки и память чата стёрты, отложенное отменено, хозяин знает; сам хозяин вестей не получает", async () => {
  reset();
  const at = Date.parse("2026-11-18T09:00:00Z");
  const h = heart({ CHAT_MEMORY: true }, { now: () => at });
  sdk().apiReplies.getChatMember = () => ({ status: "administrator" });
  await h.onMyChatMember(moved("left", "administrator"));
  await h.onMessage(group("Аи, выключи рп", { id: 21, name: "Вася", chat: -20 }), KEY);
  await h.onMessage(group("Аи, напомни через час про чай", { id: 21, name: "Вася", chat: -20 }), KEY);
  await h.onMessage(message("напомни через час про чай", { id: 21, name: "Вася" }), KEY);
  assert.equal(kept("heart:chat:-20")?.rp, false);
  assert.equal((await h.reminders.list(21)).length, 2);

  const before = toOwner().length;
  assert.equal((await h.onMyChatMember(moved("administrator", "kicked"))).action, "left");
  assert.equal(sdk().kv.has("heart:chat:-20"), false, "настройки чата стёрты");
  assert.equal(sdk().kv.has("heart:log:-20"), false, "и память чата — тоже");
  assert.deepEqual((await h.reminders.list(21)).map(item => item.chatId), [21], "напоминание в личку осталось");
  assert.deepEqual(kept("heart:chats:v1").items, []);
  assert.equal(toOwner().length, before + 1);
  assert.match(told(), /Меня убрали из чата «Клуб» — Вася\. Настройки и память этого чата я стёрла/u);

  // Хозяин добавил и убрал сам — ему об этом сообщать незачем.
  const quiet = toOwner().length;
  await h.onMyChatMember(moved("left", "member", { by: { id: OWNER, first_name: "Хозяин" } }));
  await h.onMyChatMember(moved("member", "left", { by: { id: OWNER, first_name: "Хозяин" } }));
  assert.equal(toOwner().length, quiet);
  // Канал: тоже в списке, без «сообщений для одного».
  const news = { id: -40, type: "channel", title: "Новости" };
  assert.equal((await h.onMyChatMember(moved("left", "administrator", { chat: news }))).action, "joined");
  await h.onMessage(message("список чатов", { id: OWNER }), KEY);
  assert.equal(last(OWNER), "Я в 1 чате:\n1. Новости — канал, я админ");
});

test("чат, где с ней говорят, попадает в список сам; блокировка в личке отменяет разовые напоминания", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("в каких ты чатах", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Пока не знаю ни одного/u);
  await h.onMessage({ ...group("Аи, привет", { id: 21, name: "Вася", chat: -30 }), chat: { id: -30, type: "supergroup", title: "Двор" } }, KEY);
  await h.onMessage(message("твои чаты", { id: OWNER }), KEY);
  assert.equal(last(OWNER), "Я в 1 чате:\n1. Двор — чат");

  await h.onMessage(message("напомни через час про чай", { id: 31 }), KEY);
  await h.onMessage(message("напоминай каждый день в 9:00 зарядка", { id: 31 }), KEY);
  assert.equal((await h.reminders.list(31)).length, 2);
  const person = { id: 31, type: "private" };
  const gone = await h.onMyChatMember(moved("member", "kicked", { chat: person, by: { id: 31, first_name: "Гость" } }));
  assert.deepEqual([gone.action, gone.dropped], ["blocked_by_user", 1]);
  assert.equal((await h.reminders.list(31)).length, 1, "повторяющееся ждёт, вдруг вернётся");
  assert.equal((await h.onMyChatMember(moved("kicked", "member", { chat: person, by: { id: 31, first_name: "Гость" } }))).action, "unblocked");
  assert.equal(toOwner().filter(item => /убрали|добавили/u.test(item.text)).length, 0, "о личках хозяину не сообщается");
  assert.equal(chats().length >= 1, true);

  // Точка входа платформы.
  const { default: handler } = await import("../tgcloud/handlers/my_chat_member.js");
  assert.deepEqual(await handler(moved("left", "member"), { testRun: true }), { ok: true, side_effects: "none" });
});
