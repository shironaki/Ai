/**
 * Забавы: ролевые действия, её реакция по близости, приветствие новичков,
 * опросы, «мой айди», настройки чата. Сети и Telegram нет — записывающий стаб.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, hers, reset, sdk, calls, source, toChat, last, reactions, chats, says, OWNER, KEY, DAY } from "./fixtures/kit.mjs";

const { parseAction, aboutOwnDay, accusative, reactionFor, willingness, ACTIONS } = await import("../tgcloud/lib/rp.js");
const { parsePoll } = await import("../tgcloud/lib/polls.js");
const { parseWhois, registeredAt, registeredText } = await import("../tgcloud/lib/whois.js");
const { parseChatSetting } = await import("../tgcloud/lib/fun.js");

const ACTION = Object.fromEntries(ACTIONS.map(item => [item.key, item]));
const masha = (text = "всем привет") => ({ message_id: 70, from: { id: 22, first_name: "Маша", is_bot: false }, text });
const gif = (category, url = `https://nekos.best/api/v2/${category}/001.gif`) => source(`nekos.best/api/v2/${category}`, { results: [{ url }] });
const gifs = () => calls("sendAnimation");
const feel = async (h, userId, score) => h.policy.setRelationship({ actorId: OWNER, userId, score });

test("разбор действия: формы, хвост, адресат; речь действием не считается", () => {
  const key = (text) => parseAction(text)?.action.key ?? null;
  assert.equal(key("обнять"), "hug");
  assert.equal(key("Обнял!"), "hug");
  assert.equal(key("*обнимает*"), "hug");
  assert.equal(key("чмок 😚"), "cheek");
  assert.equal(key("дать пять"), "highfive");
  assert.deepEqual({ ...parseAction("обняла @Masha_K крепко-крепко"), action: null }, { action: null, tail: "крепко-крепко", mention: "masha_k", asked: false, toMe: false, named: false });
  assert.deepEqual({ ...parseAction("поцелуй меня"), action: null }, { action: null, tail: "", mention: null, asked: true, toMe: true, named: false });
  assert.equal(parseAction("пни его").asked, true);
  // Речь, а не действие.
  for (const text of ["убил бы", "обнять не могу", "похвалить надо", "ударил по больному, да", "побить рекорд", "бью тревогу", "привет как дела", "обнять всех и каждого в этом чате прямо сейчас же"]) {
    assert.equal(parseAction(text), null, text);
  }
});

test("имя в винительном падеже склоняется только там, где нельзя ошибиться", () => {
  assert.deepEqual(["Маша", "Петя", "Иван", "Игорь", "Павел", "Никита", "Илья", "DarkLord", "Николь", "Аи", "Вася Пупкин"].map(accusative),
    ["Машу", "Петю", "Ивана", "Игоря", "Павла", "Никиту", "Илью", "DarkLord", "Николь", "Аи", "Вася Пупкин"]);
});

test("её реакция и готовность зависят от близости", () => {
  const felt = (action, score, extra = {}) => reactionFor(ACTION[action], { score, random: () => 0, formal: score < 25, ...extra });
  assert.deepEqual([-50, 0, 40, 90].map(score => felt("kiss", score).level), ["cold", "first", "warm", "close"]);
  assert.match(felt("kiss", -50).text, /Фу/u, "чужому и неприятному — отвращение");
  assert.match(felt("kiss", 0).text, /едва знакомы/u, "незнакомому — шок");
  assert.match(felt("kiss", 40).text, /красная/u, "тому, кто нравится, — смущение");
  assert.match(felt("kiss", 90).text, /не отпущу/u, "близкому — взаимность");
  assert.equal(felt("kiss", 40).deed, "caress");
  assert.equal(felt("kick", 0).deed, "shove");
  assert.equal(felt("kick", 90).deed, null, "от близкого пинок — игра");
  assert.match(felt("kiss", 100, { owner: true }).text, /[Хх]озяин|вами/u);
  assert.match(felt("kiss", 90, { adult: false }).text, /по-дружески|дружбу/u, "тому, кто назвал себя младше 18, — дружба");
  const will = (action, level, extra = {}) => willingness(ACTION[action], { level, ...extra }).ok;
  assert.deepEqual(["cold", "first", "warm", "close"].map(level => will("kiss", level)), [false, false, false, true]);
  assert.deepEqual(["cold", "first", "warm", "close"].map(level => will("cheek", level)), [false, false, true, true]);
  assert.deepEqual(["cold", "first", "warm", "close"].map(level => will("feed", level)), [false, true, true, true]);
  assert.equal(will("kiss", "first", { order: true, third: true }), true, "слово хозяина она выполняет");
  assert.equal(will("kiss", "close", { adult: false }), false);
  assert.equal(will("kiss", "close", { flirt: false }), false, "«без флирта» действует и здесь");
});

test("в группе: «обнять» ответом на чужое сообщение — строка с упоминанием и гифка, без модели", async () => {
  reset();
  const h = heart();
  gif("hug");
  const done = await h.onMessage(group("Обнять крепко", { id: 21, name: "Вася", reply: masha() }), KEY);
  assert.equal(done.action, "rp");
  assert.equal(gifs().length, 1);
  assert.equal(gifs()[0].caption, '🤗 Вася обнимает <a href="tg://user?id=22">Машу</a> крепко');
  assert.equal(gifs()[0].parse_mode, "HTML");
  assert.equal(gifs()[0].reply_parameters, undefined, "действие — отдельной строкой, не ответом");
  assert.equal(chats().length, 0, "модель не спрашивали");

  // Коллекция гифок молчит — остаются слова.
  reset();
  const quiet = heart();
  await quiet.onMessage(group("пнул", { id: 21, name: "Вася", reply: masha() }), KEY);
  assert.equal(gifs().length, 0);
  assert.equal(toChat(-10).at(-1).text, '🦵 Вася пинает <a href="tg://user?id=22">Машу</a>');
});

test("в группе: без адресата и повелительное — не действие; на себе — шутка; @упоминание", async () => {
  reset();
  const h = heart();
  assert.equal((await h.onMessage(group("обнять", { id: 21, name: "Вася" }), KEY)).ignored, true, "нет адресата");
  assert.equal((await h.onMessage(group("пни", { id: 21, name: "Вася", reply: masha() }), KEY)).ignored, true, "«пни» — просьба к человеку, а не действие");
  assert.equal((await h.onMessage(group("убил бы", { id: 21, name: "Вася", reply: masha() }), KEY)).ignored, true);
  assert.equal(toChat(-10).length, 0);

  await h.onMessage(group("погладить @masha_k", { id: 21, name: "Вася" }), KEY);
  assert.equal(toChat(-10).at(-1).text, "🫳 Вася гладит @masha_k по голове");
  await h.onMessage(group("укусить", { id: 22, name: "Маша", reply: masha() }), KEY);
  assert.match(toChat(-10).at(-1).text, /Маша пробует это на себе/u);
  // Упоминание без @имени: Telegram присылает человека отдельно.
  await h.onMessage(group("дать пять Пете", { id: 21, name: "Вася", extra: { entities: [{ type: "text_mention", offset: 10, length: 4, user: { id: 23, first_name: "Петя" } }] } }), KEY);
  assert.equal(toChat(-10).at(-1).text, '🙌 Вася и <a href="tg://user?id=23">Петя</a> дают друг другу пять');
});

test("поток действий: больше восьми строк в минуту на чат она не пишет", async () => {
  reset();
  let at = 1_800_000_000_000;
  const h = heart({}, { now: () => at });
  for (let i = 0; i < 8; i++) await h.onMessage(group("обнять", { id: 21, name: "Вася", reply: masha() }), KEY);
  assert.equal(toChat(-10).length, 8);
  assert.equal((await h.onMessage(group("обнять", { id: 21, name: "Вася", reply: masha() }), KEY)).reason, "rp_flood");
  assert.equal(toChat(-10).length, 8);
  at += 61_000;
  await h.onMessage(group("обнять", { id: 21, name: "Вася", reply: masha() }), KEY);
  assert.equal(toChat(-10).length, 9, "минута прошла — снова отвечает");
});

test("действие с ней самой: реакция на сообщение, слова по близости, шаг отношений раз в день", async () => {
  reset();
  let at = 1_800_000_000_000;
  const h = heart({}, { now: () => at, random: () => 0 });
  await h.onMessage(message("поцеловать", { id: 31 }), KEY);
  assert.match(last(31), /едва знакомы/u);
  assert.deepEqual(reactions(), ["😱"]);
  assert.equal(chats().length, 0);

  await feel(h, 31, 40);
  await h.onMessage(message("поцеловал", { id: 31 }), KEY);
  assert.match(last(31), /красная/u);
  assert.equal((await h.policy.state(31)).score, 41, "тому, кто нравится, ласка прибавляет тепла");
  await h.onMessage(message("обнять", { id: 31 }), KEY);
  assert.equal((await h.policy.state(31)).score, 41, "но не чаще раза в день");

  await feel(h, 32, -50);
  await h.onMessage(message("чмок", { id: 32 }), KEY);
  assert.match(last(32), /Фу|Даже не/u);
  await h.onMessage(message("пнуть", { id: 32 }), KEY);
  assert.equal((await h.policy.state(32)).score, -51, "чужой пинок она запоминает");

  // В группе — ответом на её сообщение или по имени.
  gif("blush");
  at += DAY;
  await h.onMessage(group("целую", { id: 31, name: "Вася", reply: hers() }), KEY);
  assert.equal(gifs().at(-1).caption, "…Предупреждать надо. Я вся красная.");
  await h.onMessage(group("обнял Аи", { id: 33, name: "Петя" }), KEY);
  assert.match(toChat(-10).at(-1).text, /Неожиданно|только познакомились/u);
});

test("хозяину — особая реакция; «мне 15 лет» закрывает романтику", async () => {
  reset();
  const h = heart({}, { random: () => 0 });
  await h.onMessage(message("поцеловать", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Хозяин… вы меня смущаете/u);
  await h.onMessage(message("пнуть", { id: OWNER }), KEY);
  assert.match(last(OWNER), /За что\?! …ладно, вам можно/u);

  await feel(h, 34, 90);
  await h.onMessage(message("Мне 15 лет, если что", { id: 34 }), KEY);
  assert.equal((await h.personal.settings(34)).minor, true);
  await h.onMessage(message("поцеловать", { id: 34 }), KEY);
  assert.match(last(34), /по-дружески|дружбу/u);
  await h.onMessage(message("поцелуй меня", { id: 34 }), KEY);
  assert.match(last(34), /Это — нет/u);
});

test("её просят: «поцелуй меня» — по близости; «пни его» — выполнит хозяину, чужому откажет", async () => {
  reset();
  const h = heart({}, { random: () => 0 });
  await h.onMessage(message("поцелуй меня", { id: 41, name: "Вася" }), KEY);
  assert.match(last(41), /едва знакомы/u);
  await h.onMessage(message("покорми меня", { id: 41, name: "Вася" }), KEY);
  assert.equal(last(41), '🍪 Аи кормит <a href="tg://user?id=41">Васю</a>');
  await feel(h, 41, 90);
  await h.onMessage(message("поцелуй меня", { id: 41, name: "Вася" }), KEY);
  assert.equal(last(41), '😘 Аи целует <a href="tg://user?id=41">Васю</a>');
  await h.onMessage(message("укуси меня за ушко", { id: 41, name: "Вася" }), KEY);
  assert.equal(last(41), '😬 Аи кусает <a href="tg://user?id=41">Васю</a> за ушко\nЖелание исполнено.');

  // Третье лицо.
  await h.onMessage(group("Аи, поцелуй его", { id: 41, name: "Вася", reply: masha() }), KEY);
  assert.match(toChat(-10).at(-1).text, /только с теми, кто мне близок/u);
  await h.onMessage(group("Аи, пни его", { id: OWNER, name: "Хозяин", reply: masha() }), KEY);
  assert.equal(toChat(-10).at(-1).text, '🦵 Аи пинает <a href="tg://user?id=22">Машу</a>\nРаз хозяин велел.');
  await feel(h, 42, -60);
  await h.onMessage(group("Аи, пни его", { id: 42, name: "Грубиян", reply: masha() }), KEY);
  assert.match(toChat(-10).at(-1).text, /Не командуйте мной/u);
  // Прежний жест не сломан: «обними» идёт старой дорогой.
  gif("hug");
  await h.onMessage(message("обними", { id: 41, name: "Вася" }), KEY);
  assert.equal(gifs().at(-1).caption, undefined);
});

test("настройки чата: выключить рп и гифки может админ; список действий — словами", async () => {
  reset();
  const h = heart();
  sdk().apiReplies.getChatMember = ({ user_id }) => ({ status: user_id === 51 ? "administrator" : "member" });
  await h.onMessage(group("Аи, выключи рп", { id: 52, name: "Гость" }), KEY);
  assert.match(toChat(-10).at(-1).text, /меняют его админы/u);
  await h.onMessage(group("Аи, рп без гифок", { id: 51, name: "Админ" }), KEY);
  gif("hug");
  await h.onMessage(group("обнять", { id: 21, name: "Вася", reply: masha() }), KEY);
  assert.equal(gifs().length, 0, "гифки выключены — остаются слова");
  assert.match(toChat(-10).at(-1).text, /Вася обнимает/u);

  await h.onMessage(group("Аи, выключи рп", { id: 51, name: "Админ" }), KEY);
  assert.match(toChat(-10).at(-1).text, /выключены/u);
  const before = toChat(-10).length;
  assert.equal((await h.onMessage(group("обнять", { id: 21, name: "Вася", reply: masha() }), KEY)).reason, "rp_off");
  assert.equal(toChat(-10).length, before);
  await h.onMessage(group("Аи, настройки чата", { id: 52, name: "Гость" }), KEY);
  assert.match(toChat(-10).at(-1).text, /ролевые действия — выключены;\n• гифки к действиям — нет;\n• приветствие новичков — моими словами/u);

  await h.onMessage(message("какие есть рп", { id: 53 }), KEY);
  assert.match(last(53), /по-доброму: обнять.*\n• с чувством: чмокнуть, поцеловать/su);
  assert.equal(parseChatSetting("выключи реакции"), null, "реакции — личная настройка, а не чата");
});

const joined = (members, extra = {}) => ({ message_id: 900, chat: { id: -10, type: "supergroup", title: "Уютный чат" }, from: { id: members[0].id, first_name: members[0].first_name, is_bot: false }, new_chat_members: members, ...extra });

test("новичка встречает она сама: имя ссылкой, пауза от наплыва, своё приветствие, выключатель", async () => {
  reset();
  let at = 1_800_000_000_000;
  const h = heart({}, { now: () => at, random: () => 0 });
  const done = await h.onMessage(joined([{ id: 61, first_name: "Маша" }, { id: 62, first_name: "Петя" }, { id: 63, first_name: "Бот", is_bot: true }]), KEY);
  assert.equal(done.action, "welcome");
  assert.equal(toChat(-10).at(-1).text, '<a href="tg://user?id=61">Маша</a>, <a href="tg://user?id=62">Петя</a>, добро пожаловать. Я Аи — если что, зовите по имени.');
  assert.equal(toChat(-10).at(-1).parse_mode, "HTML");
  assert.equal(chats().length, 0);

  assert.equal((await h.onMessage(joined([{ id: 64, first_name: "Оля" }]), KEY)).reason, "welcome_cooldown");
  for (let i = 0; i < 5; i++) { at += 20_000; await h.onMessage(joined([{ id: 70 + i, first_name: "Гость" }]), KEY); }
  at += 20_000;
  assert.equal((await h.onMessage(joined([{ id: 80, first_name: "Ещё" }]), KEY)).reason, "welcome_flood", "наплыв — молчит");
  assert.equal((await h.onMessage(joined([{ id: 81, first_name: "Робот", is_bot: true }]), KEY)).reason, "bots_only");

  at += 10 * 60_000;
  sdk().apiReplies.getChatMember = { status: "creator" };
  await h.onMessage(group("Аи, приветствие: Привет, {имя}! Это {чат}, правила в закрепе <3", { id: 51, name: "Админ" }), KEY);
  await h.onMessage(joined([{ id: 82, first_name: "Лена" }]), KEY);
  assert.equal(toChat(-10).at(-1).text, 'Привет, <a href="tg://user?id=82">Лена</a>! Это Уютный чат, правила в закрепе &lt;3');
  at += 60_000;
  await h.onMessage(group("Аи, выключи приветствие", { id: 51, name: "Админ" }), KEY);
  assert.equal((await h.onMessage(joined([{ id: 83, first_name: "Дима" }]), KEY)).reason, "welcome_off");
  // Её саму добавили в чат — представляется.
  const self = await h.onMessage(joined([{ id: 999, first_name: "Аи", is_bot: true }], { from: { id: 51, first_name: "Админ", is_bot: false } }), KEY);
  assert.equal(self.action, "introduced");
  assert.match(toChat(-10).at(-1).text, /Всем привет\. Я Аи/u);
  // Репетиция ничего не отправляет.
  const before = toChat(-10).length;
  await h.onMessage(joined([{ id: 84, first_name: "Тест" }]), { testRun: true });
  assert.equal(toChat(-10).length, before);
});

test("разбор опроса: вопрос, варианты, вид; «опросили» — не опрос", () => {
  assert.deepEqual(parsePoll("опрос: что смотрим? Наруто, Блич, Ван-Пис"), { question: "что смотрим?", options: ["Наруто", "Блич", "Ван-Пис"], quiz: false, correct: -1, anonymous: true, multiple: false });
  assert.deepEqual(parsePoll("создай открытый опрос с несколькими ответами: кто идёт? | я | не я"), { question: "кто идёт?", options: ["я", "не я"], quiz: false, correct: -1, anonymous: false, multiple: true });
  assert.deepEqual(parsePoll("Опрос\nКуда едем?\n1. Море\n2. Горы").options, ["Море", "Горы"]);
  assert.deepEqual(parsePoll("опрос: идём в кино?").options, ["Да", "Нет"]);
  assert.deepEqual(parsePoll("голосование: пицца, суши или бургер").options, ["Пицца", "Суши", "Бургер"]);
  assert.equal(parsePoll("викторина: столица Австралии? Сидней, *Канберра, Мельбурн").correct, 1);
  assert.match(parsePoll("викторина: столица? а, б").error, /звёздочкой/u);
  assert.match(parsePoll("опрос: цвет? " + Array.from({ length: 11 }, (_, i) => `цвет${i}`).join(", ")).error, /не больше десяти/u);
  assert.deepEqual(parsePoll("придумай опрос про аниме"), { compose: true, topic: "аниме", quiz: false });
  assert.deepEqual(parsePoll("закрой опрос"), { stop: true });
  assert.equal(parsePoll("опросили всех уже"), null);
  assert.equal(parsePoll("викторина"), null, "одно слово «викторина» — это игра, а не опрос");
});

test("опрос создаётся словами, закрывается ответом на него, придумывается моделью", async () => {
  reset();
  const h = heart();
  const done = await h.onMessage(group("Аи, опрос: что смотрим? Наруто, Блич", { id: 21 }), KEY);
  assert.equal(done.action, "poll");
  assert.deepEqual({ ...calls("sendPoll")[0], chat_id: null }, { chat_id: null, question: "что смотрим?", options: [{ text: "Наруто" }, { text: "Блич" }], is_anonymous: true, allows_multiple_answers: false });
  await h.onMessage(message("викторина: 2+2? 3, *4, 5", { id: 5 }), KEY);
  assert.deepEqual({ type: calls("sendPoll")[1].type, correct: calls("sendPoll")[1].correct_option_id }, { type: "quiz", correct: 1 });
  await h.onMessage(message("опрос", { id: 5 }), KEY);
  assert.match(last(), /Какой вопрос и какие варианты/u);

  sdk().apiReplies.stopPoll = { total_voter_count: 8, options: [{ text: "Наруто", voter_count: 3 }, { text: "Блич", voter_count: 5 }] };
  await h.onMessage(group("Аи, закрой опрос", { id: 21, reply: { message_id: 700, from: { id: 999, is_bot: true, username: "ai_heart_bot" }, poll: { id: "p" } } }), KEY);
  assert.equal(calls("stopPoll")[0].message_id, 700);
  assert.match(toChat(-10).at(-1).text, /Голосов: 8\.\n• Блич — 5\n• Наруто — 3\n\nПобедил вариант «Блич»/u);
  await h.onMessage(group("Аи, закрой опрос", { id: 21 }), KEY);
  assert.match(toChat(-10).at(-1).text, /Ответьте этой фразой на сообщение с опросом/u);

  sdk().fetchQueue.push(says("Какое аниме пересмотреть?\n1. Наруто\n2. Блич\n3. Ван-Пис"));
  await h.onMessage(message("придумай опрос про аниме", { id: 5 }), KEY);
  assert.deepEqual(calls("sendPoll").at(-1).options.map(item => item.text), ["Наруто", "Блич", "Ван-Пис"]);
  sdk().fetchQueue.push(says("Не знаю, что придумать."));
  await h.onMessage(message("придумай опрос про погоду", { id: 5 }), KEY);
  assert.match(last(), /Придумать не вышло/u);
  // Telegram отказал — честная причина, а не молчание.
  sdk().failing.sendPoll = Object.assign(new Error("x"), { description: "Bad Request: non-anonymous polls can't be sent to channel chats" });
  await h.onMessage(message("открытый опрос: да?", { id: 5 }), KEY);
  assert.match(last(), /только анонимным/u);
});

test("возраст аккаунта оценивается по номеру и не выдаётся за точный", () => {
  const NOW = Date.UTC(2026, 10, 12);
  const year = (id) => new Date(registeredAt(id, NOW).at).getUTCFullYear();
  assert.deepEqual([5_000_000, 123_456_789, 400_169_472, 805_158_066, 1_500_000_000].map(year), [2013, 2015, 2017, 2019, 2020]);
  assert.equal(registeredAt(123_456_789, NOW).rough, false);
  assert.equal(registeredAt(6_800_000_000, NOW).rough, true);
  assert.match(registeredText(6_800_000_000, NOW), /оценка грубая: плюс-минус полгода/u);
  assert.match(registeredText(1000, NOW), /один из первых/u);
  assert.ok(registeredAt(99_999_999_999, NOW).at <= NOW, "дата не уходит в будущее");
  assert.equal(registeredAt("abc"), null);
  assert.deepEqual(["мой айди", "какой у меня id", "когда я зарегистрировался", "дата регистрации", "его айди", "инфо", "айди чата", "когда я пришёл", "идея"].map(text => parseWhois(text)?.about ?? null),
    ["self", "self", "self", "self", "other", "other", "chat", null, null]);
});

test("«мой айди», «айди» ответом на человека, номер чата и пересланного канала", async () => {
  reset();
  const h = heart({}, { now: () => Date.UTC(2026, 10, 12) });
  await h.onMessage(message("мой айди", { id: 123456789, name: "Вася" }), KEY);
  assert.match(last(123456789), /🪪 Вася\nНомер \(ID\): 123456789\nВ Telegram: примерно в августе 2015 — аккаунту около 11 лет\.\n\nДата — оценка по номеру/u);
  assert.equal(chats().length, 0, "это не вопрос к модели и не к сестре");

  await h.onMessage(group("Аи, айди", { id: 21, name: "Вася", reply: { message_id: 70, from: { id: 805158066, first_name: "Маша", username: "masha_k", is_premium: true, is_bot: false }, text: "привет" } }), KEY);
  assert.match(toChat(-10).at(-1).text, /🪪 Маша · @masha_k\nНомер \(ID\): 805158066\nВ Telegram: примерно в июле 2019[^\n]*\nPremium: да\./u);
  await h.onMessage(group("Аи, айди", { id: 21, name: "Вася" }), KEY);
  assert.match(toChat(-10).at(-1).text, /Номер \(ID\): 21\n/u, "без адресата — о себе");
  await h.onMessage(group("Аи, когда он зарегистрировался @someone", { id: 21, name: "Вася" }), KEY);
  assert.match(toChat(-10).at(-1).text, /По одному @someone Telegram номер ботам не выдаёт/u);

  await h.onMessage(group("Аи, айди чата", { id: 21 }), KEY);
  assert.equal(toChat(-10).at(-1).text, "Номер этого чата: -10");
  await h.onMessage(message("айди", { id: OWNER, reply: { message_id: 5, from: { id: OWNER, first_name: "Хозяин" }, forward_origin: { type: "channel", chat: { id: -1001234, title: "Мост" } }, text: "⏰" } }), KEY);
  assert.equal(last(OWNER), "Это переслано из канала «Мост», его номер: -1001234");
});

test("0.35.0: «кормлю кота», «глажу рубашки», «лечу в Москву», «защитил диплом» — о своём дне, а не действие с ней", async () => {
  const own = (said) => aboutOwnDay(parseAction(said));
  for (const said of ["кормлю кота", "глажу рубашки", "лечу в Москву", "лечу зубы", "защитил диплом", "обнял жену", "поцеловал жену", "угощаю друзей", "погладил кота"]) assert.equal(own(said), true, said);
  // С ней самой: без предмета, с «тебя», с подробностью («по голове», «крепко», «печеньем»).
  for (const said of ["глажу", "глажу тебя", "глажу по голове", "обнял крепко", "кормлю печеньем", "кормлю тебя печеньем", "целую в щёчку", "лечу тебя", "угощаю чаем", "обними жену"]) assert.equal(own(said), false, said);

  reset();
  const h = heart({ PHRASES: true, AI_MODELS: [] }, { now: () => Date.parse("2026-11-18T09:00:00Z"), random: () => 0 });
  // Раньше на это звучало «Ням. Спасибо!» — будто кормят её.
  const fed = await h.onMessage(message("кормлю кота", { id: 5 }), KEY);
  assert.equal(fed.action, "phrase");
  assert.deepEqual(fed.topics, ["звери дома"]);
  const flight = await h.onMessage(message("лечу в командировку", { id: 5 }), KEY);
  assert.deepEqual(flight.topics, ["командировка"]);
  // А действие с ней осталось действием.
  assert.equal((await h.onMessage(message("глажу по голове", { id: 5 }), KEY)).action, "rp");
});
