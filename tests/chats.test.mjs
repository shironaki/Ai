/**
 * Её чаты: Telegram сообщает, что её добавили, сделали админом, сняли, убрали
 * (`my_chat_member`). Она ведёт список чатов, пробует «сообщения для одного»,
 * как только получает права, и стирает рабочее о чате, из которого её убрали.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, calls, chats, says, sdk, toChat, toOwner, OWNER, KEY } from "./fixtures/kit.mjs";

const CLUB = { id: -20, type: "supergroup", title: "Клуб" };
const VASYA = { id: 21, first_name: "Вася", is_bot: false };
const moved = (from, to, { chat = CLUB, by = VASYA } = {}) => ({ chat, from: by, date: 1, old_chat_member: { status: from, user: { id: 999 } }, new_chat_member: { status: to, user: { id: 999 } } });
const told = () => toOwner().map(item => item.text).join("\n");
const kept = (key) => JSON.parse(sdk().kv.get(key) ?? "null");

test("добавили в чат, сделали админом: чат в списке, хозяину — весть, «сообщение для одного» пробуется сразу", async () => {
  reset();
  sdk().whispers = { admin: [] };
  const h = heart({ ADMIN_NOTICE: true });
  assert.deepEqual(await h.onMyChatMember(moved("left", "member"), { testRun: true }), { ok: true, side_effects: "none" }, "репетиция ничего не делает");
  assert.equal(sdk().kv.has("heart:chats:v1"), false);

  assert.equal((await h.onMyChatMember(moved("left", "member"))).action, "joined");
  assert.match(told(), /Меня добавили в чат «Клуб» — Вася, без прав админа: я сказала там об этом — один раз\./u);
  assert.equal(toChat(-20).length, 1, "в самом чате — одно слово о правах");
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
  // Вася — админ групп; она сама (её номер в Telegram — 999) в соседнем чате — простой участник.
  sdk().apiReplies.getChatMember = ({ user_id }) => ({ status: user_id === 999 ? "member" : "administrator" });
  await h.onMyChatMember(moved("left", "administrator"));
  await h.onMessage(group("Аи, выключи рп", { id: 21, name: "Вася", chat: -20 }), KEY);
  await h.onMessage(group("Аи, напомни через час про чай", { id: 21, name: "Вася", chat: -20 }), KEY);
  await h.onMessage(message("напомни через час про чай", { id: 21, name: "Вася" }), KEY);
  assert.equal(kept("heart:chat:-20")?.rp, false);
  assert.equal((await h.reminders.list(21)).length, 2);
  // Соседний чат с похожим номером: его память и настройки уход из -20 задеть не должен.
  await h.onMessage(group("Аи, выключи рп", { id: 21, name: "Вася", chat: -200 }), KEY);
  await h.onMessage(group("просто разговор", { id: 22, name: "Маша", chat: -200 }), KEY);
  const logged = (chat) => [...sdk().kv.keys()].filter(key => key.startsWith(`heart:log:${chat}:`)).length;
  assert.ok(logged(-20) >= 2, "память чата записана — по ключу на сообщение");
  assert.ok(logged(-200) >= 2);

  const before = toOwner().length;
  assert.equal((await h.onMyChatMember(moved("administrator", "kicked"))).action, "left");
  assert.equal(sdk().kv.has("heart:chat:-20"), false, "настройки чата стёрты");
  assert.equal(logged(-20), 0, "и память чата — тоже: все её записи");
  assert.equal([...sdk().kv.keys()].filter(key => /^heart:[a-z]+:-20(?::|$)/u.test(key)).length, 0, "под номером чата не осталось ничего");
  assert.ok(logged(-200) >= 2, "соседний чат не тронут");
  assert.equal(kept("heart:chat:-200")?.rp, false);
  assert.deepEqual((await h.reminders.list(21)).map(item => item.chatId), [21], "напоминание в личку осталось");
  assert.deepEqual(kept("heart:chats:v1").items.map(item => item.id), [-200], "из списка ушёл только этот чат");
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
  assert.equal(last(OWNER), "Я в 2 чатах:\n1. без названия — чат\n2. Новости — канал, я админ");
});

test("чат, где с ней говорят, попадает в список сам; блокировка в личке отменяет разовые напоминания", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("в каких ты чатах", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Пока не знаю ни одного/u);
  await h.onMessage({ ...group("Аи, привет", { id: 21, name: "Вася", chat: -30 }), chat: { id: -30, type: "supergroup", title: "Двор" } }, KEY);
  await h.onMessage(message("твои чаты", { id: OWNER }), KEY);
  assert.equal(last(OWNER), "Я в 1 чате:\n1. Двор — чат");
  // Чат, где она только слышит разговор (к ней не обращались), — тоже в списке: статус владельца
  // 16.11.2026 показывал «список чатов пока пуст» при живых чатах.
  const before = chats().length;
  await h.onMessage({ ...group("кто сегодня дежурит?", { id: 22, name: "Петя", chat: -31 }), chat: { id: -31, type: "supergroup", title: "Подъезд" } }, KEY);
  assert.equal(chats().length, before, "ей не писали — она молчит");
  await h.onMessage(message("твои чаты", { id: OWNER }), KEY);
  assert.match(last(OWNER), /^Я в 2 чатах:\n/u);
  for (const title of ["Двор — чат", "Подъезд — чат"]) assert.ok(last(OWNER).includes(title), title);

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

test("без прав админа: один раз говорит об этом в самом чате; дали права и сняли — ещё раз, тоже один", async () => {
  const NOTICE = /права? админа/iu;
  const notices = (chat) => toChat(chat).filter(item => NOTICE.test(item.text));
  const self = () => calls("getChatMember").filter(item => item.user_id === 999);

  // 1. Событие Telegram: добавили простым участником — слово сразу, в чат; хозяину — в вести.
  reset();
  let now = Date.parse("2026-11-18T09:00:00Z");
  let h = heart({ ADMIN_NOTICE: true }, { now: () => now });
  await h.onMyChatMember(moved("left", "member"));
  assert.equal(notices(-20).length, 1);
  assert.match(notices(-20)[0].text, /^Я здесь без прав админа, и поэтому мне доступно не всё: .*не подвожу итоги дня.*дайте мне права админа\. Говорю об этом один раз\.$/u);
  // Дальше с ней разговаривают — второй раз она не напоминает, и Telegram о себе не спрашивает.
  for (let index = 0; index < 3; index += 1) { sdk().fetchQueue.push(says("Привет.")); await h.onMessage(group("Аи, привет", { id: 21, name: "Вася", chat: -20 }), KEY); }
  await heart({ ADMIN_NOTICE: true }, { now: () => now }).onMessage(group("Аи, привет", { id: 21, name: "Вася", chat: -20 }), KEY);
  assert.equal(notices(-20).length, 1, "один раз — и из другого пробуждения тоже");
  assert.equal(self().length, 0, "роль известна по событию");
  // Дали права — спасибо, без напоминаний; сняли — одно слово о том, что перестало работать.
  sdk().whispers = { admin: [-20] };
  await h.onMyChatMember(moved("member", "administrator"));
  assert.equal(notices(-20).length, 1);
  const demoted = await h.onMyChatMember(moved("administrator", "member"));
  assert.deepEqual([demoted.action, demoted.asked], ["demoted", true]);
  assert.equal(notices(-20).length, 2);
  assert.match(notices(-20)[1].text, /^Прав админа у меня здесь больше нет\. Поэтому мне снова доступно не всё/u);
  sdk().fetchQueue.push(says("Привет."));
  await h.onMessage(group("Аи, привет", { id: 21, name: "Вася", chat: -20 }), KEY);
  assert.equal(notices(-20).length, 2);
  delete sdk().whispers;

  // 2. События не было (чат старый): с ней заговорили — она спрашивает Telegram о себе и говорит после ответа, один раз.
  reset();
  sdk().apiReplies.getChatMember = ({ user_id }) => ({ status: user_id === 999 ? "member" : "administrator" });
  h = heart({ ADMIN_NOTICE: true }, { now: () => now });
  sdk().fetchQueue.push(says("Привет, Вася."));
  await h.onMessage(group("Аи, привет", { id: 21, name: "Вася", chat: -30, extra: { message_thread_id: 7, is_topic_message: true } }), KEY);
  assert.deepEqual(toChat(-30).map(item => NOTICE.test(item.text)), [false, true], "сначала ответ, потом слово о правах");
  assert.equal(toChat(-30)[1].message_thread_id, 7, "в ту же тему");
  sdk().fetchQueue.push(says("Да."));
  await h.onMessage(group("Аи, ты тут?", { id: 21, name: "Вася", chat: -30 }), KEY);
  assert.equal(notices(-30).length, 1);
  assert.equal(self().length, 1, "о себе спросила один раз");
  await h.onMessage(message("в каких ты чатах", { id: OWNER }), KEY);
  assert.equal(last(OWNER), "Я в 1 чате:\n1. без названия — чат");
  // Без обращения к ней — молчит: чужой разговор не повод.
  await h.onMessage(group("просто разговор", { id: 22, name: "Маша", chat: -31 }), KEY);
  assert.equal(toChat(-31).length, 0);

  // 3. Она админ — ни слова; роль записана.
  reset();
  sdk().apiReplies.getChatMember = () => ({ status: "administrator" });
  h = heart({ ADMIN_NOTICE: true }, { now: () => now });
  sdk().fetchQueue.push(says("Привет."));
  await h.onMessage(group("Аи, привет", { id: 21, name: "Вася", chat: -30 }), KEY);
  assert.equal(notices(-30).length, 0);
  assert.equal(kept("heart:chats:v1").items[0].role, "admin");

  // 4. Проверить нечем (Telegram о ней не ответил) — молчит: наугад «я не админ» не говорит. Спросит снова через сутки.
  reset();
  h = heart({ ADMIN_NOTICE: true }, { now: () => now });
  for (let index = 0; index < 2; index += 1) { sdk().fetchQueue.push(says("Привет.")); await h.onMessage(group("Аи, привет", { id: 21, name: "Вася", chat: -30 }), KEY); }
  assert.equal(notices(-30).length, 0);
  assert.equal(self().length, 1, "второй раз в тот же день не спрашивает");
  now += 25 * 3_600_000;
  sdk().apiReplies.getChatMember = () => ({ status: "member" });
  sdk().fetchQueue.push(says("Привет."));
  await h.onMessage(group("Аи, привет", { id: 21, name: "Вася", chat: -30 }), KEY);
  assert.equal(notices(-30).length, 1, "через сутки узнала — сказала");

  // 5. Личка и канал — не про права; выключено настройкой — тишина.
  reset();
  sdk().apiReplies.getChatMember = () => ({ status: "member" });
  h = heart({ ADMIN_NOTICE: true }, { now: () => now });
  sdk().fetchQueue.push(says("Привет."));
  await h.onMessage(message("привет"), KEY);
  assert.equal(notices(5).length, 0);
  await h.onMyChatMember(moved("left", "member", { chat: { id: -40, type: "channel", title: "Новости" } }));
  assert.equal(notices(-40).length, 0);
  const off = heart({ ADMIN_NOTICE: false }, { now: () => now });
  await off.onMyChatMember(moved("left", "member"));
  sdk().fetchQueue.push(says("Привет."));
  await off.onMessage(group("Аи, привет", { id: 21, name: "Вася", chat: -20 }), KEY);
  assert.equal(notices(-20).length, 0);
});
