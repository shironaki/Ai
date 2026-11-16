/**
 * Секретарь у близких (0.35.0): человек, которому хозяин разрешил, получает того же секретаря —
 * со своим состоянием, своими вестями и своим списком «кто писал». Хозяин чужой переписки не видит.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, reset, last, chats, sdk, toChat, toOwner, OWNER, KEY } from "./fixtures/kit.mjs";

const { parseSecretary, sameNameAny, SECRETARY_KEY, DESKS_KEY, ALIEN_PREFIX, deskKey, desksOf } = await import("../tgcloud/lib/secretary.js");

const ON = { PHRASES: true };
const NOON = Date.parse("2026-11-18T09:00:00Z"); // 12:00 по Москве
const WIFE = 777;
let serial = 9000;
const own = (text) => message(text, { id: OWNER });
const hers = (text) => message(text, { id: WIFE, name: "Айдина" });
const connection = ({ id, user, name, reply = true, enabled = true }) => ({ id, user: { id: user, first_name: name, is_bot: false }, user_chat_id: user, date: 1, is_enabled: enabled, rights: reply ? { can_reply: true } : {} });
const letter = (text, { id = 901, name = "Маша", conn, at = NOON, from = id } = {}) => ({
  message_id: ++serial, business_connection_id: conn, date: Math.floor(at / 1000), chat: { id, type: "private", first_name: name }, from: { id: from, first_name: name, is_bot: false }, text,
});
const press = (data, from = OWNER) => ({ id: `q${++serial}`, from: { id: from }, data, message: { message_id: 77, chat: { id: from } } });
const state = (key = SECRETARY_KEY) => JSON.parse(sdk().kv.get(key) ?? "null");
const desks = () => desksOf(JSON.parse(sdk().kv.get(DESKS_KEY) ?? "null"));
const business = (chatId, conn) => toChat(chatId).filter(item => item.business_connection_id === conn);
/** Хозяин подключён; близкий человек подключился и получил разрешение кнопкой. */
async function family(h) {
  await h.onBusinessConnection(connection({ id: "conn-1", user: OWNER, name: "Али" }), KEY);
  await h.onBusinessConnection(connection({ id: "conn-w", user: WIFE, name: "Айдина" }), KEY);
  await h.onCallback(press(`s:y:${WIFE}`), KEY);
}

test("разбор: слова хозяина о столах близких; обычные слова — мимо; имя узнаётся в родительном и дательном", () => {
  const cases = {
    "у кого ты секретарь?": { desks: true }, "чей ты секретарь": { desks: true }, "А у кого ты ещё секретарь?": { desks: true }, "кто просит секретаря?": { desks: true },
    "разреши секретаря": { allow: "" }, "разреши секретаря жене": { allow: "" }, "да, разреши секретаря Айдине": { allow: "айдине" },
    "будь секретарём и у Айдины": { allow: "айдины" }, "разрешаю секретаря ей тоже": { allow: "" },
    "не разрешай секретаря": { deny: "" }, "откажи в секретаре @aidina": { deny: "@aidina" }, "нет, не разрешай секретаря Соседу": { deny: "соседу" },
    "забери секретаря у Айдины": { revoke: "айдины" }, "не будь секретарём у жены": { revoke: "" },
  };
  for (const [said, want] of Object.entries(cases)) assert.deepEqual(parseSecretary(said), want, said);
  for (const said of ["разреши вопрос", "забери секретаря", "убери секретаря", "секретарь директора звонил", "у кого ключи", "откажи ему", "чей ты", "разреши ей погулять", "будь секретарём"]) {
    assert.equal(parseSecretary(said), null, said);
  }
  for (const [said, name] of [["Айдины", "Айдина"], ["айдине", "Айдина"], ["Сергея", "Сергей"], ["Петра", "Пётр"], ["павла", "Павел"], ["Марии", "Мария"], ["Игоря", "Игорь"], ["Айдина", "Айдина"]]) {
    assert.equal(sameNameAny(said, name), true, said);
  }
  assert.equal(sameNameAny("Марины", "Айдина"), false);
  assert.equal(sameNameAny("", "Айдина"), false);
});

test("близкий человек: подключился — хозяину вопрос с кнопками; разрешил — свой секретарь, а хозяин чужой переписки не видит", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  await h.onBusinessConnection(connection({ id: "conn-1", user: OWNER, name: "Али" }), KEY);
  const asked = await h.onBusinessConnection(connection({ id: "conn-w", user: WIFE, name: "Айдина" }), KEY);
  assert.deepEqual(asked, { ok: true, action: "secretary_asked" });
  assert.match(last(WIFE), /^Секретарём я работаю у хозяина и у тех, кому он разрешил\. Я спросила его о вас/u);
  const question = toOwner().at(-1);
  assert.match(question.text, /^Айдина просит меня в секретари.*что там пишут, вам не показываю/su);
  assert.deepEqual(question.reply_markup.inline_keyboard[0].map(item => item.callback_data), [`s:y:${WIFE}`, `s:n:${WIFE}`]);
  assert.deepEqual(desks().asks.map(item => [item.id, item.name, item.conn]), [[WIFE, "Айдина", "conn-w"]]);

  // Пока хозяин молчит: её чаты не читаются; её «отвечай за меня» — отказ словами, без модели.
  assert.deepEqual(await h.onBusinessMessage(letter("привет", { conn: "conn-w" }), KEY), { ignored: true, reason: "not_owner" });
  await h.onMessage(hers("отвечай за меня"), KEY);
  assert.match(last(WIFE), /^Секретарём я работаю у хозяина и у тех, кому он разрешил\. Хотите так же/u);
  // Чужое нажатие ничего не решает.
  assert.deepEqual(await h.onCallback(press(`s:y:${WIFE}`, 5), KEY), { ignored: true, reason: "not_owner" });
  assert.equal(desks().list.length, 0);

  // Хозяин разрешил кнопкой: ей — что и как; ему — что её переписку он не увидит.
  const yes = await h.onCallback(press(`s:y:${WIFE}`), KEY);
  assert.equal(yes.action, "secretary_allowed");
  assert.match(toOwner().at(-1).text, /^Хорошо, хозяин: Айдина — теперь я секретарь и там\..*что там пишут, вам не показываю/su);
  assert.match(last(WIFE), /^Хозяин разрешил: теперь я и ваш секретарь\..*Скажете мне здесь «отвечай за меня».*и хозяину тоже\.$/su);
  assert.deepEqual(desks().list.map(item => [item.id, item.conn]), [[WIFE, "conn-w"]]);
  assert.equal(desks().asks.length, 0);
  assert.equal(state(deskKey(WIFE)).conn.id, "conn-w");
  assert.equal(sdk().kv.has(`${ALIEN_PREFIX}conn-w`), false, "подключение больше не чужое");
  // Второе нажатие той же кнопки — просьбы уже нет.
  await h.onCallback(press(`s:y:${WIFE}`), KEY);
  assert.match(toOwner().at(-1).text, /^Этой просьбы у меня уже нет/u);

  // Её слова работают с её столом; «хозяин» ей не говорится.
  const from = toChat(WIFE).length;
  await h.onMessage(hers("секретарь"), KEY);
  assert.match(last(WIFE), /^Секретарь: к вашему аккаунту я подключена\.\nСейчас в ваших чатах я молчу/u);
  await h.onMessage(hers("отвечай за меня до 18:00"), KEY);
  assert.match(last(WIFE), /^Хорошо: до 18:00 отвечаю за вас\. Каждому, кто напишет вам в личку, один раз скажу:\n«.*Айдина не на связи примерно до 18:00/su);
  assert.equal(state(deskKey(WIFE)).away.on, true);
  assert.equal(state().away.on, false, "стол хозяина не тронут");

  // Письмо в её чат: ответ уходит от её подключения; хозяин об этом ничего не узнаёт.
  const quiet = toOwner().length;
  assert.equal((await h.onBusinessMessage(letter("ты где?", { conn: "conn-w" }), KEY)).action, "secretary_notice");
  assert.equal(business(901, "conn-w").length, 1);
  assert.match(business(901, "conn-w")[0].text, /Айдина не на связи примерно до 18:00/u);
  // Срочное — ей, а не хозяину.
  await h.onBusinessMessage(letter("срочно перезвони", { conn: "conn-w", id: 902, name: "Мама" }), KEY);
  assert.match(last(WIFE), /^❗ Срочное\. Мама пишет вам:\n«срочно перезвони»/u);
  assert.equal(toOwner().length, quiet, "хозяину о чужих письмах — ни слова");
  assert.equal(state().people.length, 0);
  // Хозяин спрашивает о своём — чужого списка не видит.
  await h.onMessage(own("кто мне писал?"), KEY);
  assert.doesNotMatch(last(OWNER), /Маша|Мама/u);
  // Она сама пишет в своём чате — туда секретарь не вмешивается.
  assert.deepEqual(await h.onBusinessMessage(letter("мам, я тут", { conn: "conn-w", id: 902, name: "Айдина", from: WIFE }), KEY), { ignored: true, reason: "owner_speaks" });
  // «Кто мне писал?» и «я тут»: список — ей, и после него он стёрт.
  await h.onMessage(hers("кто мне писал?"), KEY);
  assert.match(last(WIFE), /^Пока вас не было \(с 12:00\), писали — 2 человека:/u);
  await h.onMessage(hers("я тут"), KEY);
  assert.match(last(WIFE), /^С возвращением\. За вас больше не отвечаю\.\n\nПока вас не было \(с 12:00\), писали — 2 человека:\n❗ Мама.*срочное\n• Маша/su);
  assert.deepEqual({ on: state(deskKey(WIFE)).away.on, people: state(deskKey(WIFE)).people }, { on: false, people: [] });
  assert.ok(![...sdk().kv.values()].some(value => String(value).includes("срочно перезвони")), "выдержки из писем нигде не осталось");
  assert.doesNotMatch(toChat(WIFE).slice(from).map(item => item.text).join("\n"), /хозяин/iu, "близкому «хозяин» не говорится");
  assert.equal(chats().length, 0, "модель не спрашивали ни разу");
});

test("два стола разом: одному человеку отвечает каждый стол от своего подключения; срок, расписание и почта — у каждого свои", async () => {
  reset();
  let clock = NOON;
  const h = heart(ON, { now: () => clock, random: () => 0 });
  await family(h);
  await h.onMessage(own("отвечай за меня"), KEY);
  await h.onMessage(hers("отвечай за меня на 2 часа"), KEY);
  // Брат пишет обоим: каждому столу — своё уведомление, от своего подключения и со своим именем.
  await h.onBusinessMessage(letter("привет", { conn: "conn-1", id: 950, name: "Брат" }), KEY);
  await h.onBusinessMessage(letter("привет", { conn: "conn-w", id: 950, name: "Брат" }), KEY);
  assert.match(business(950, "conn-1")[0].text, /Али сейчас не на связи/u);
  assert.match(business(950, "conn-w")[0].text, /Айдина не на связи примерно до 14:00/u);
  assert.equal(business(950, "conn-1").length + business(950, "conn-w").length, 2);
  assert.deepEqual([state().people.length, state(deskKey(WIFE)).people.length], [1, 1]);
  // Её срок вышел — список уходит ей; хозяин по-прежнему в отлучке.
  clock = NOON + 2 * 3_600_000 + 60_000;
  await h.tick(KEY);
  assert.match(last(WIFE), /^Срок вышел: за вас я больше не отвечаю\.\n\nПока вас не было \(с 12:00\), писали — 1 человек:\n• Брат/u);
  assert.deepEqual([state().away.on, state(deskKey(WIFE)).away.on], [true, false]);
  await h.onMessage(own("я тут"), KEY);
  assert.match(last(OWNER), /^С возвращением, хозяин\. За вас больше не отвечаю\.\n\nПока вас не было \(с 12:00\), писали — 1 человек:\n• Брат/u);

  // Расписание — её собственное: ночью начинает её стол, а стол хозяина — нет.
  await h.onMessage(hers("ночью отвечай сама"), KEY);
  assert.match(last(WIFE), /^Хорошо: каждый день с 23:00 до 07:00 отвечаю за вас сама\./u);
  clock = Date.parse("2026-11-18T20:30:00Z"); // 23:30 по Москве
  await h.tick(KEY);
  assert.deepEqual([state().away.on, state(deskKey(WIFE)).away.on], [false, true]);

  // Весть ей не ушла (Telegram отказал) — ложится в почту стола и уходит со следующим ударом.
  sdk().failing.sendMessage = new Error("down");
  await h.onBusinessMessage(letter("срочно ответь", { conn: "conn-w", id: 960, name: "Соседка", at: clock }), KEY);
  assert.ok(state(deskKey(WIFE)).mail.some(item => /^❗ Срочное\. Соседка пишет вам/u.test(item.text)), "срочное ждёт в почте стола");
  delete sdk().failing.sendMessage;
  clock += 60_000;
  await h.tick(KEY);
  assert.ok(toChat(WIFE).some(item => /^❗ Срочное\. Соседка пишет вам/u.test(item.text)), "и дошло со следующим ударом");
  assert.equal(state(deskKey(WIFE)).mail, undefined, "почта пуста");
  assert.equal(chats().length, 0);
});

test("слова хозяина о столах: «у кого ты секретарь?», отказ, разрешение по слову, «забери секретаря у …» — и те чаты больше не читаются", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  await h.onBusinessConnection(connection({ id: "conn-1", user: OWNER, name: "Али" }), KEY);
  await h.onMessage(own("у кого ты секретарь?"), KEY);
  assert.match(last(OWNER), /^Секретарём я работаю только у вас\. Близкому человеку достаточно подключить меня у себя/u);
  await h.onMessage(own("разреши секретаря"), KEY);
  assert.match(last(OWNER), /^Просьб у меня сейчас нет\./u);

  // Просят двое: без имени — переспросит; одному отказано, другая разрешена словом «жене».
  await h.onBusinessConnection(connection({ id: "conn-w", user: WIFE, name: "Айдина" }), KEY);
  await h.onBusinessConnection(connection({ id: "conn-s", user: 888, name: "Сосед" }), KEY);
  await h.onMessage(own("разреши секретаря"), KEY);
  assert.match(last(OWNER), /^Просят несколько человек\. Ждут вашего слова: Айдина, Сосед\./u);
  await h.onMessage(own("не разрешай секретаря Соседу"), KEY);
  assert.match(last(OWNER), /^Хорошо, хозяин: отказано — Сосед\. Те чаты я не читаю\.$/u);
  assert.match(last(888), /^Хозяин не разрешил: секретарём у вас я не работаю\./u);
  await h.onMessage(own("разреши секретаря жене"), KEY);
  assert.match(last(OWNER), /^Хорошо, хозяин: Айдина — теперь я секретарь и там\./u);
  await h.onMessage(own("у кого ты секретарь?"), KEY);
  assert.match(last(OWNER), /^Секретарём я работаю у вас — и, по вашему слову, ещё у 1: Айдина\.\nЧто пишут им, вам не показываю/u);
  // Отказанному — те чаты по-прежнему чужие.
  assert.deepEqual(await h.onBusinessMessage(letter("письмо соседу", { conn: "conn-s" }), KEY), { ignored: true, reason: "not_owner" });

  // Близкому слова о чужих столах не принадлежат: это обычный разговор, решает модель.
  sdk().fetchQueue.push({ status: 200, body: { choices: [{ message: { content: "Спросите хозяина." }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } });
  await h.onMessage(hers("у кого ты секретарь?"), KEY);
  assert.equal(chats().length, 1);
  assert.equal(desks().list.length, 1);

  // Забрать: что было записано — ей, и стёрто; дальше её чаты не читаются, а слова — отказ.
  await h.onMessage(hers("отвечай за меня"), KEY);
  await h.onBusinessMessage(letter("привет", { conn: "conn-w" }), KEY);
  await h.onMessage(own("забери секретаря у Айдины"), KEY);
  assert.match(last(OWNER), /^Хорошо, хозяин: Айдина — секретарём там больше не работаю и тех чатов не читаю\./u);
  assert.match(last(WIFE), /^Хозяин забрал у меня работу вашего секретаря.*Пока вас не было \(с 12:00\), писали — 1 человек:\n• Маша/su);
  assert.equal(sdk().kv.has(deskKey(WIFE)), false);
  assert.equal(desks().list.length, 0);
  assert.deepEqual(await h.onBusinessMessage(letter("ещё письмо", { conn: "conn-w" }), KEY), { ignored: true, reason: "not_owner" });
  assert.ok(![...sdk().kv.values()].some(value => String(value).includes("ещё письмо")));
  await h.onMessage(hers("отвечай за меня"), KEY);
  assert.match(last(WIFE), /^Секретарём я работаю у хозяина и у тех, кому он разрешил/u);
  await h.onMessage(own("забери секретаря у Айдины"), KEY);
  assert.equal(last(OWNER), "Кроме вас, я ни у кого секретарём не работаю.");
});
