/**
 * Секретарь: хозяин подключил Аи к своему аккаунту Telegram. Пока он не сказал
 * «отвечай за меня», она в его чатах молчит; сказал — каждому по одному разу
 * отвечает, что он не на связи, и помнит, кто писал.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, calls, chats, says, sdk, toChat, toOwner, OWNER, KEY, DAY } from "./fixtures/kit.mjs";

const { parseSecretary, parseSpan, langOf, excerptOf, canReply, SECRETARY_KEY, toldKey, ALIEN_PREFIX, NOTICES_PER_HOUR } = await import("../tgcloud/lib/secretary.js");
const { createPhrasebook } = await import("../tgcloud/lib/phrasebook.js");
const { SOUL_PREFIXES } = await import("../tgcloud/lib/soul.js");

const ON = { PHRASES: true };
const NOON = Date.parse("2026-11-18T09:00:00Z"); // 12:00 по Москве
const CONN = "conn-1";
const own = (text) => message(text, { id: OWNER });
const book = createPhrasebook();
const pool = (name, vars) => book.pool(name, { formal: true, vars });
let serial = 5000;
/** Подключение: событие `business_connection`. */
const connection = ({ id = CONN, user = OWNER, name = "Али", reply = true, enabled = true } = {}) => ({
  id, user: { id: user, first_name: name, is_bot: false }, user_chat_id: user, date: 1, is_enabled: enabled, ...(reply ? { rights: { can_reply: true } } : { rights: {} }),
});
/** Письмо из личного чата хозяина: событие `business_message`. */
const letter = (text, { id = 501, name = "Маша", user = "", conn = CONN, at = NOON, extra = {} } = {}) => ({
  message_id: ++serial, business_connection_id: conn, date: Math.floor(at / 1000), chat: { id, type: "private", first_name: name },
  from: { id, first_name: name, is_bot: false, ...(user ? { username: user } : {}) }, ...(text == null ? {} : { text }), ...extra,
});
/** Хозяин сам пишет в чьём-то чате. */
const mine = (chatId, text, at = NOON) => ({ message_id: ++serial, business_connection_id: CONN, date: Math.floor(at / 1000), chat: { id: chatId, type: "private" }, from: { id: OWNER, first_name: "Али", is_bot: false }, text });
const state = () => JSON.parse(sdk().kv.get(SECRETARY_KEY) ?? "null");
const business = (chatId) => toChat(chatId).filter(item => item.business_connection_id);

test("разбор: включить со сроком и словами, выключить, «я тут», «кто мне писал», статус; обычные слова — мимо", () => {
  const cases = {
    "отвечай за меня": { on: true }, "Отвечай за меня до 18:00": { on: true, span: { at: "18:00" } },
    "секретарь, отвечай за меня 2 часа": { on: true, span: { ms: 2 * 3_600_000 } }, "секретарь: отвечай за меня": { on: true },
    "меня нет до 15": { on: true, span: { at: "15:00" } }, "я не на связи полчаса": { on: true, span: { ms: 30 * 60_000 } },
    "прикрой меня на 40 минут": { on: true, span: { ms: 40 * 60_000 } }, "секретарь работай до 9 вечера": { on: true, span: { at: "21:00" } },
    "включи секретаря": { on: true }, "секретарь, работай": { on: true },
    "отвечай за меня: я на встрече, перезвоню вечером": { on: true, words: "я на встрече, перезвоню вечером" },
    "отвечай за меня до 18:00: Я на встрече, перезвоню.": { on: true, span: { at: "18:00" }, words: "Я на встрече, перезвоню." },
    "отвечай за меня — «сплю, отвечу утром»": { on: true, words: "сплю, отвечу утром" },
    "отвечай за меня, я за рулём": { on: true, words: "я за рулём" }, "отвечай за меня до 7 утра - сплю": { on: true, span: { at: "07:00" }, words: "сплю" },
    "не отвечай за меня": { off: true }, "выключи секретаря": { off: true }, "секретарь, отбой": { off: true },
    "я тут": { back: true }, "я вернулся": { back: true }, "Всё, я на связи!": { back: true }, "я свободна": { back: true },
    "кто мне писал?": { who: true }, "кто писал, пока меня не было?": { who: true }, "кто меня искал": { who: true },
    "секретарь": { status: true }, "как подключить секретаря?": { status: true }, "что с секретарём": { status: true },
  };
  for (const [said, want] of Object.entries(cases)) assert.deepEqual(parseSecretary(said), want, said);
  // Слова, похожие по виду: ни включить, ни выключить ими нельзя.
  for (const said of ["привет", "я занят", "я сплю", "я на работе до 18", "меня нет дома", "меня нет слов", "я не на связи с космосом", "отвечай быстрее", "ответь мне",
    "отвечай за свои слова", "отвечай за меня в игре", "отвечай за меня до вечера", "отвечай за меня на 100 часов", "отвечай за меня на вопросы по работе", "подмени лампочку",
    "секретарь директора звонил", "мой секретарь заболел", "включи музыку", "я тут подумал", "я здесь живу", "я вернулся из отпуска", "я свободен как птица", "я тут?",
    "кто писал войну и мир", "кто писал?", "кто писал эту песню", "кто меня искал вчера во дворе", "не отвечай так грубо", "секретарь это профессия", "ты секретарь или кто"]) {
    assert.equal(parseSecretary(said), null, said);
  }
  assert.deepEqual(parseSpan("до 18.30"), { at: "18:30" });
  assert.deepEqual(parseSpan("на 3 часа"), { ms: 3 * 3_600_000 });
  assert.equal(parseSpan("до 25"), null);
  assert.equal(parseSpan("на 2 минуты"), null, "меньше пяти минут — не отлучка");

  assert.equal(langOf({ text: "Привет" }), "ru");
  assert.equal(langOf({ text: "hi there" }), "en");
  assert.equal(langOf({ sticker: {}, from: { language_code: "nl" } }), "en");
  assert.equal(langOf({ photo: [], from: {} }), "ru");
  assert.equal(excerptOf({ text: "ты где?" }), "«ты где?»");
  assert.ok(excerptOf({ text: "я".repeat(400) }).length <= 123);
  assert.equal(excerptOf({ voice: {} }), "голосовое");
  assert.equal(canReply({ rights: { can_reply: true } }), true);
  assert.equal(canReply({ can_reply: true }), true, "старый вид поля");
  assert.equal(canReply({ rights: {} }), false);
  assert.ok(!SOUL_PREFIXES.some(prefix => SECRETARY_KEY.startsWith(prefix)), "подключение и чужие письма в копию души не идут");
});

test("подключение: хозяину — слова один раз; чужому — честный отказ, и его чаты она не слушает", async () => {
  reset();
  const h = heart(ON, { now: () => NOON });
  // Не подключена: «секретарь» объясняет, как подключить; «отвечай за меня» — тоже.
  await h.onMessage(own("секретарь"), KEY);
  assert.match(last(OWNER), /^Секретарём я пока не работаю.*@BotFather включить мне Secretary Mode.*«Автоматизация чатов»/su);
  await h.onMessage(own("отвечай за меня"), KEY);
  assert.match(last(OWNER), /^Не могу: к вашему аккаунту я не подключена\./u);
  // «Я тут» и «кто мне писал?» без подключения — обычные слова.
  sdk().fetchQueue.push(says("Никто."));
  await h.onMessage(own("кто мне писал?"), KEY);
  assert.equal(last(OWNER), "Никто.");

  const before = toOwner().length;
  const done = await h.onBusinessConnection(connection(), KEY);
  assert.deepEqual({ action: done.action, reply: done.reply }, { action: "secretary_connected", reply: true });
  assert.equal(toOwner().length, before + 1);
  assert.match(toOwner().at(-1).text, /^Вижу подключение к вашему аккаунту.*Пока я в них молчу и ничего не записываю\. Скажете «отвечай за меня»/su);
  assert.match(toOwner().at(-1).text, /Что я при этом храню: имя человека, время и первые слова его последнего письма — только пока отвечаю за вас.*Модели эти письма не показываю и никуда не передаю\./su);
  assert.doesNotMatch(toOwner().at(-1).text, /Права отвечать вы мне не дали/u);
  assert.deepEqual({ id: state().conn.id, name: state().conn.name, reply: state().conn.reply }, { id: CONN, name: "Али", reply: true });
  // Telegram шлёт то же событие при правке: ничего не изменилось — она молчит.
  await h.onBusinessConnection(connection(), KEY);
  assert.equal(toOwner().length, before + 1);
  // Право отвечать забрали — говорит, и коротко: подключение то же, изменилось одно.
  await h.onBusinessConnection(connection({ reply: false }), KEY);
  assert.match(toOwner().at(-1).text, /^Права отвечать в ваших чатах у меня больше нет: пока вас нет, смогу только записывать, кто писал\./u);
  await h.onMessage(own("секретарь"), KEY);
  assert.match(last(OWNER), /подключена, но отвечать мне не разрешено/u);
  // Вернули — тоже говорит; сама отвечать не начинает.
  await h.onBusinessConnection(connection(), KEY);
  assert.match(toOwner().at(-1).text, /^Теперь мне разрешено отвечать в ваших чатах\. Сама не начну — только после слов «отвечай за меня»\.$/u);
  assert.equal(state().away.on, false);
  // Сняли другое подключение, не её: это не новость, своё она не теряет.
  const told = toOwner().length;
  await h.onBusinessConnection(connection({ id: "conn-old", enabled: false }), KEY);
  assert.equal(toOwner().length, told);
  assert.equal(state().conn.id, CONN);
  // Сняли её подключение.
  const off = await h.onBusinessConnection(connection({ enabled: false }), KEY);
  assert.equal(off.action, "secretary_disconnected");
  assert.match(toOwner().at(-1).text, /^Подключение к вашему аккаунту снято: ваших чатов я больше не вижу и за вас не отвечаю\.$/u);
  assert.equal(state().conn, null);
  // Сняли ещё раз — молчит.
  await h.onBusinessConnection(connection({ enabled: false }), KEY);
  assert.equal(toOwner().length, told + 1);

  // Чужой человек подключил её к себе: один раз — отказ; его письма не читаются и не хранятся.
  const stranger = await h.onBusinessConnection(connection({ id: "conn-x", user: 777, name: "Некто" }), KEY);
  assert.deepEqual(stranger, { ignored: true, reason: "not_owner" });
  assert.match(last(777), /^Я работаю секретарём только у одного человека\. Ваши чаты я не читаю/u);
  await h.onBusinessConnection(connection({ id: "conn-x", user: 777, name: "Некто" }), KEY);
  assert.equal(toChat(777).length, 1, "повторять не станет");
  const snapshot = sdk().kv.get(SECRETARY_KEY);
  const ignored = await h.onBusinessMessage(letter("секретное письмо не для неё", { id: 900, conn: "conn-x" }), KEY);
  assert.deepEqual(ignored, { ignored: true, reason: "not_owner" });
  assert.equal(sdk().kv.get(SECRETARY_KEY), snapshot, "ничего не записано");
  assert.ok(![...sdk().kv.values()].some(value => String(value).includes("секретное письмо")), "чужой текст нигде не лежит");
  assert.equal(calls("getBusinessConnection").length, 0, "чужое подключение уже известно — Telegram не спрашивается");
  assert.equal(toChat(900).length, 0);
  assert.equal(chats().length, 1, "модель — только на «кто мне писал?» без подключения");
});

test("отлучка: одному человеку — одно уведомление, по-русски или по-английски; где хозяин пишет сам — молчит", async () => {
  reset();
  let now = NOON;
  const h = heart(ON, { now: () => now, random: () => 0 });
  await h.onBusinessConnection(connection(), KEY);

  // Пока хозяин не сказал — в его чатах тишина: ни ответа, ни записи. Команды и её имя там — просто слова.
  const idle = sdk().kv.get(SECRETARY_KEY);
  for (const said of ["привет, ты тут?", "/start", "Аи, нарисуй кота", "Аи, какие есть режимы"]) {
    assert.deepEqual(await h.onBusinessMessage(letter(said), KEY), { ignored: true, reason: "not_away" });
  }
  assert.equal(toChat(501).length, 0);
  assert.equal(sdk().kv.get(SECRETARY_KEY), idle, "без отлучки письма не записываются");

  await h.onMessage(own("отвечай за меня до 18:00"), KEY);
  const lines = pool("+секретарь:нет на связи до", { "кто": "Али", "срок": "18:00" });
  const [head, quoted, tail] = last(OWNER).split("\n");
  assert.equal(head, "Хорошо, хозяин: до 18:00 отвечаю за вас. Каждому, кто напишет вам в личку, один раз скажу:");
  const notice = quoted.slice(1, -1);
  assert.ok(lines.includes(notice), quoted);
  assert.match(notice, /^Здравствуйте\. .*Аи, помощница\. Али .*до 18:00/u, "она не притворяется хозяином");
  assert.match(tail, /не по-русски, — то же по-английски.*«я тут»/u);

  // Маша пишет трижды: ответ — один, от имени хозяина, тем самым текстом.
  const first = await h.onBusinessMessage(letter("ты где?", { user: "masha" }), KEY);
  assert.equal(first.action, "secretary_notice");
  assert.deepEqual(business(501), [{ business_connection_id: CONN, chat_id: 501, text: notice }]);
  now += 60_000;
  assert.equal((await h.onBusinessMessage(letter("ау", { user: "masha", at: now }), KEY)).action, "secretary_noted");
  assert.equal((await h.onBusinessMessage(letter(null, { user: "masha", at: now, extra: { voice: { file_id: "v" } } }), KEY)).action, "secretary_noted");
  assert.equal(business(501).length, 1);

  // Пишут по-английски — ответ по-английски; стикер от человека с нерусским приложением — тоже.
  await h.onBusinessMessage(letter("hey, are you there?", { id: 502, name: "John", at: now }), KEY);
  assert.equal(business(502)[0].text, "Hello. This is Ai, an assistant. Али is away right now — until about 18:00. I'll pass on that you wrote.");
  await h.onBusinessMessage(letter(null, { id: 503, name: "Sven", at: now, extra: { sticker: { file_id: "s" }, from: { id: 503, first_name: "Sven", language_code: "nl" } } }), KEY);
  assert.match(business(503)[0].text, /^Hello\. This is Ai/u);

  // Хозяин сам пишет Пете — туда она не вмешивается; через двадцать минут тишины — ответит.
  assert.deepEqual(await h.onBusinessMessage(mine(504, "сейчас занят, потом", now), KEY), { ignored: true, reason: "owner_speaks" });
  assert.equal((await h.onBusinessMessage(letter("понял", { id: 504, name: "Петя", at: now }), KEY)).action, "secretary_noted");
  assert.equal(business(504).length, 0);
  now += 20 * 60_000;
  assert.equal((await h.onBusinessMessage(letter("а когда?", { id: 504, name: "Петя", at: now }), KEY)).action, "secretary_notice");
  assert.equal(business(504).length, 1);

  // Её собственное эхо, автоответ Telegram, бот и письмо с большим опозданием — не повод отвечать.
  assert.deepEqual(await h.onBusinessMessage({ ...mine(505, "эхо", now), sender_business_bot: { id: 999, is_bot: true } }, KEY), { ignored: true, reason: "echo" });
  assert.deepEqual(await h.onBusinessMessage({ ...mine(505, "автоответ", now), is_from_offline: true }, KEY), { ignored: true, reason: "echo" });
  assert.deepEqual(await h.onBusinessMessage(letter("бип", { id: 506, name: "Робот", at: now, extra: { from: { id: 506, first_name: "Робот", is_bot: true } } }), KEY), { ignored: true, reason: "bot" });
  assert.equal((await h.onBusinessMessage(letter("старое письмо", { id: 507, name: "Оля", at: now - 40 * 60_000 }), KEY)).action, "secretary_noted");
  assert.equal(business(505).length + business(506).length + business(507).length, 0);
  // Служебный чат Telegram с кодом входа: ни ответа, ни записи — код у неё не лежит.
  assert.deepEqual(await h.onBusinessMessage(letter("Login code: 54321. Do not give this code to anyone.", { id: 777000, name: "Telegram", at: now }), KEY), { ignored: true, reason: "service" });
  assert.equal(business(777000).length, 0);
  assert.ok(!sdk().kv.get(SECRETARY_KEY).includes("54321"));
  // Группа с тем же подключением (так не бывает, но вдруг) — мимо.
  assert.deepEqual(await h.onBusinessMessage({ ...letter("в группе", { id: -77 }), chat: { id: -77, type: "supergroup" } }, KEY), { ignored: true });

  // «Кто мне писал?» — список, отлучка продолжается.
  await h.onMessage(own("кто мне писал?"), KEY);
  assert.equal(last(OWNER), [
    "Пока вас не было (с 12:00), писали — 5 человек:",
    "• Оля — 1 сообщение, 12:21: «старое письмо»",
    "• Петя — 2 сообщения, последнее — 12:21: «а когда?»",
    "• Sven — 1 сообщение, 12:01: стикер",
    "• John — 1 сообщение, 12:01: «hey, are you there?»",
    "• Маша (@masha) — 3 сообщения, последнее — 12:01: голосовое",
    "Сказала, что вы не на связи, — 4 из 5. Остальным не стала: вы писали им сами, письмо дошло с опозданием или ответов за час было слишком много.",
  ].join("\n"));
  assert.equal(state().away.on, true);
  await h.onMessage(own("секретарь"), KEY);
  assert.match(last(OWNER), /Сейчас отвечаю за вас до 18:00: писали — 5 человек\..*Людям я говорю: «Здравствуйте/su);

  // «Управление ботом» в чате с Машей: Telegram открывает личку с ней ссылкой /start bizChat<номер>.
  await h.onMessage(own("/start bizChat501"), KEY);
  assert.match(last(OWNER), /^Секретарь: к вашему аккаунту я подключена\.\n.*\nВ том чате \(Маша\): за эту отлучку — 3 сообщения; я один раз ответила, что вы не на связи\.$/su);
  await h.onMessage(own("/start bizChat504"), KEY);
  assert.match(last(OWNER), /В том чате \(Петя\): за эту отлучку — 2 сообщения; я один раз ответила/u);
  await h.onMessage(own("/start bizChat999"), KEY);
  assert.match(last(OWNER), /В том чате за эту отлучку мне ничего не приходило — и я там ничего не писала\.$/u);
  // Чужому такая ссылка — обычное приветствие.
  await h.onMessage(message("/start bizChat501"), KEY);
  assert.match(last(), /^Аи\. Я рядом\./u);

  // «Я тут» — конец отлучки: список отдан и стёрт; дальше в чатах снова тишина.
  await h.onMessage(own("я тут"), KEY);
  assert.match(last(OWNER), /^С возвращением, хозяин\. За вас больше не отвечаю\.\n\nПока вас не было \(с 12:00\), писали — 5 человек:/u);
  assert.deepEqual({ on: state().away.on, people: state().people, own: state().own }, { on: false, people: [], own: {} });
  assert.ok(![...sdk().kv.values()].some(value => /ты где|старое письмо|are you there/u.test(String(value))), "чужие письма после возвращения нигде не лежат");
  assert.equal(sdk().kv.has(toldKey(NOON, 501)), false, "отметки «уже сказано» убраны");
  assert.deepEqual(await h.onBusinessMessage(letter("ну что?", { at: now }), KEY), { ignored: true, reason: "not_away" });
  assert.equal(business(501).length, 1);
  // «Я тут» без отлучки — обычные слова: на них отвечает словарь или модель, а не секретарь.
  sdk().fetchQueue.push(says("Вижу."));
  await h.onMessage(own("я тут"), KEY);
  assert.doesNotMatch(last(OWNER), /За вас больше не отвечаю|Я и так/u);
  await h.onMessage(own("не отвечай за меня"), KEY);
  assert.equal(last(OWNER), "Я и так за вас не отвечаю.");
  assert.ok(chats().length <= 1, "на чужие письма модель не тратится");
});

test("свои слова для людей, срок по умолчанию и по часам; срок вышел — сама перестаёт и рассказывает", async () => {
  reset();
  let now = NOON;
  const h = heart(ON, { now: () => now, random: () => 0 });
  await h.onBusinessConnection(connection(), KEY);

  // Свои слова — дословно, в кавычках, от её имени.
  await h.onMessage(own("отвечай за меня: Я на встрече, перезвоню вечером."), KEY);
  const words = pool("+секретарь:слова", { "кто": "Али", "слова": "Я на встрече, перезвоню вечером." });
  const said = last(OWNER).split("\n")[1].slice(1, -1);
  assert.ok(words.includes(said), said);
  assert.match(last(OWNER), /^Хорошо, хозяин: до 19\.11, 00:00 отвечаю за вас\./u, "без срока — двенадцать часов");
  await h.onBusinessMessage(letter("привет"), KEY);
  assert.equal(business(501)[0].text, said);
  await h.onBusinessMessage(letter("hello", { id: 502, name: "John" }), KEY);
  assert.equal(business(502)[0].text, "Hello. This is Ai, an assistant. Али can't reply right now and left a message for you: \"Я на встрече, перезвоню вечером.\"");

  // Новый срок посреди отлучки: список и «уже сказано» остаются — второго ответа Маше нет.
  now += 10 * 60_000;
  await h.onMessage(own("отвечай за меня на 2 часа"), KEY);
  assert.match(last(OWNER), /^Хорошо, хозяин: до 14:10 отвечаю за вас\./u);
  assert.equal(state().away.since, NOON);
  assert.equal(state().people.length, 2);
  await h.onBusinessMessage(letter("ещё раз привет", { at: now }), KEY);
  assert.equal(business(501).length, 1);

  // Срок вышел: будильник — и она сама говорит хозяину, кто писал.
  now = NOON + 2 * 3_600_000 + 11 * 60_000;
  const before = toOwner().length;
  await h.tick({});
  assert.equal(toOwner().length, before + 1);
  assert.match(toOwner().at(-1).text, /^Срок вышел: за вас я больше не отвечаю\.\n\nПока вас не было \(с 12:00\), писали — 2 человека:\n• Маша — 2 сообщения, последнее — 12:10: «ещё раз привет»\n• John — 1 сообщение, 12:00: «hello»\nКаждому я один раз сказала, что вы не на связи\.$/u);
  assert.equal(state().away.on, false);
  await h.tick({});
  assert.equal(toOwner().length, before + 1, "второй раз не рассказывает");

  // Будильник молчал, а письмо пришло после срока: отлучка кончается на нём, ответа нет.
  await h.onMessage(own("меня нет до 15"), KEY);
  assert.match(last(OWNER), /^Хорошо, хозяин: до 15:00 отвечаю за вас\./u);
  now = Date.parse("2026-11-18T12:05:00Z"); // 15:05
  const count = toOwner().length;
  assert.deepEqual(await h.onBusinessMessage(letter("поздно", { id: 510, name: "Зоя", at: now }), KEY), { ignored: true, reason: "not_away" });
  assert.equal(business(510).length, 0);
  assert.match(toOwner().at(-1).text, /^Срок вышел: за вас я больше не отвечаю\.\n\nПока вас не было \(с 14:11\), в личку никто не писал\.$/u);
  assert.equal(toOwner().length, count + 1);

  // «До 9» сказано вечером — это завтрашние девять; дольше трёх суток не бывает.
  now = Date.parse("2026-11-18T19:00:00Z"); // 22:00
  await h.onMessage(own("отвечай за меня до 9"), KEY);
  assert.match(last(OWNER), /^Хорошо, хозяин: до 19\.11, 09:00 отвечаю за вас\./u);
  assert.equal(state().away.until, Date.parse("2026-11-19T06:00:00Z"));
  await h.onMessage(own("отвечай за меня на 72 часа"), KEY);
  assert.equal(state().away.until, now + 72 * 3_600_000);
  assert.equal(chats().length, 0);
});

test("без права отвечать — только записывает; отказ Telegram — весть хозяину; слишком много писем — пауза", async () => {
  reset();
  let now = NOON;
  const h = heart(ON, { now: () => now, random: () => 0 });
  await h.onBusinessConnection(connection({ reply: false }), KEY);
  await h.onMessage(own("отвечай за меня"), KEY);
  assert.match(last(OWNER), /^Отвечать за вас мне не разрешено: до 19\.11, 00:00 буду только записывать, кто писал\./u);
  assert.equal((await h.onBusinessMessage(letter("привет"), KEY)).action, "secretary_noted");
  assert.equal(business(501).length, 0);
  await h.onMessage(own("я вернулся"), KEY);
  assert.match(last(OWNER), /• Маша — 1 сообщение, 12:00: «привет»\nОтвечать за вас мне не разрешено — я только записывала\.$/u);

  // Право есть, но Telegram отказал: в списке — «не отвечала», хозяину — весть о сбое.
  await h.onBusinessConnection(connection(), KEY);
  await h.onMessage(own("отвечай за меня"), KEY);
  sdk().failing.sendMessage = Object.assign(new Error("Bad Request: BUSINESS_PEER_USAGE_MISSING"), { description: "Bad Request: BUSINESS_PEER_USAGE_MISSING" });
  assert.equal((await h.onBusinessMessage(letter("ау", { id: 520, name: "Рома" }), KEY)).action, "secretary_failed");
  delete sdk().failing.sendMessage;
  now += 2 * 60_000; // вести уходят не чаще раза в минуту
  await h.onMessage(own("привет"), KEY);
  assert.ok(toOwner().some(item => /Где: Секретарь\nЧто: ответить за вас не вышло: Bad Request: BUSINESS_PEER_USAGE_MISSING\nЧто делать: Проверьте в Telegram, что в подключении мне разрешено отвечать\./u.test(item.text)), "о сбое хозяин узнаёт");
  await h.onMessage(own("кто мне писал?"), KEY);
  assert.match(last(OWNER), /• Рома — 1 сообщение, 12:00: «ау»\nНикому не отвечала\. Не вышло ответить — 1: Telegram отказал, проверьте права подключения\.$/u);
  // Второе письмо того же человека — второй попытки нет: не долбить Telegram.
  assert.equal((await h.onBusinessMessage(letter("ау?", { id: 520, name: "Рома", at: now }), KEY)).action, "secretary_noted");
  assert.equal(business(520).length, 0, "Telegram уже принимает, а второго ответа всё равно нет");
  await h.onMessage(own("я тут"), KEY);

  // Тридцать ответов за час — и пауза: похоже на рассылку или на двух секретарей друг против друга.
  now = NOON + 3_600_000; // новый час: счёт ответов — с нуля
  await h.onMessage(own("отвечай за меня"), KEY);
  for (let index = 0; index < NOTICES_PER_HOUR + 3; index += 1) await h.onBusinessMessage(letter("привет", { id: 1000 + index, name: `Гость ${index}`, at: now }), KEY);
  const sent = sdk().sent.filter(item => item.business_connection_id && item.chat_id >= 1000).length;
  assert.equal(sent, NOTICES_PER_HOUR);
  now += 3_600_000;
  await h.onBusinessMessage(letter("привет", { id: 2000, name: "Поздний", at: now }), KEY);
  assert.equal(business(2000).length, 1, "в следующем часу — снова отвечает");
  await h.onMessage(own("привет"), KEY);
  assert.ok(toOwner().some(item => /за час я ответила за вас 30 раз и остановилась/u.test(item.text)));
  // В списке — не больше сорока человек: старые уходят.
  assert.ok(state().people.length <= 40);
});

test("три письма разом от одного человека — ответ один; сводка дня знает, что она отвечала за хозяина", async () => {
  reset();
  let now = NOON;
  const h = heart({ ...ON, SELF_REPORTS: true }, { now: () => now, random: () => 0 });
  sdk().kv.set("heart:build", JSON.stringify({ build: (await import("../tgcloud/lib/heart.js")).BUILD, at: now }));
  await h.onBusinessConnection(connection(), KEY);
  await h.onMessage(own("отвечай за меня"), KEY);
  // Люди пишут короткими строчками подряд: письма приходят одновременно, разным «изолятам».
  const done = await Promise.all(["привет", "ты тут?", "ау"].map(text => h.onBusinessMessage(letter(text), KEY)));
  assert.equal(business(501).length, 1, "ответ — один");
  assert.equal(done.filter(item => item.action === "secretary_notice").length, 1);
  // Следующее письмо того же человека — тоже без ответа, и в списке он отмечен как получивший ответ.
  await h.onBusinessMessage(letter("ну ладно"), KEY);
  assert.equal(business(501).length, 1);
  await h.onMessage(own("я тут"), KEY);
  assert.match(last(OWNER), /Каждому я один раз сказала, что вы не на связи\.$/u);

  // Наутро в сводке — строка о секретаре.
  now += DAY;
  await h.onMessage(own("доброе утро"), KEY);
  const digest = toOwner().find(item => /вот мой вчерашний день/u.test(item.text));
  assert.match(digest.text, /ответила за вас в личке: 1/u);
});

test("незнакомое подключение: чьё оно — говорит Telegram; хозяина — принимает, чужое — запоминает как чужое", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  // Событие о подключении потерялось: первое же письмо — и она спрашивает Telegram.
  sdk().apiReplies.getBusinessConnection = (params) => (params.business_connection_id === "conn-9"
    ? { id: "conn-9", user: { id: OWNER, first_name: "Али" }, user_chat_id: OWNER, is_enabled: true, rights: { can_reply: true } }
    : { id: params.business_connection_id, user: { id: 777, first_name: "Некто" }, user_chat_id: 777, is_enabled: true, rights: { can_reply: true } });
  assert.deepEqual(await h.onBusinessMessage(letter("привет", { conn: "conn-9" }), KEY), { ignored: true, reason: "not_away" });
  assert.equal(state().conn.id, "conn-9");
  assert.equal(calls("getBusinessConnection").length, 1);
  await h.onBusinessMessage(letter("ещё", { conn: "conn-9" }), KEY);
  assert.equal(calls("getBusinessConnection").length, 1, "своё подключение второй раз не спрашивается");

  assert.deepEqual(await h.onBusinessMessage(letter("чужое письмо", { conn: "conn-z", id: 900 }), KEY), { ignored: true, reason: "not_owner" });
  assert.equal(sdk().kv.has(`${ALIEN_PREFIX}conn-z`), true);
  await h.onBusinessMessage(letter("ещё чужое", { conn: "conn-z", id: 900 }), KEY);
  assert.equal(calls("getBusinessConnection").length, 2, "чужое — тоже один раз");
  assert.equal(state().conn.id, "conn-9", "чужое подключение хозяйского не вытесняет");
  assert.ok(![...sdk().kv.values()].some(value => String(value).includes("чужое письмо")));

  // Telegram не ответил — письмо пропускается, но подключение чужим не объявляется.
  sdk().failing.getBusinessConnection = new Error("timeout");
  assert.deepEqual(await h.onBusinessMessage(letter("кто я", { conn: "conn-q" }), KEY), { ignored: true, reason: "not_owner" });
  assert.equal(sdk().kv.has(`${ALIEN_PREFIX}conn-q`), false);
});

test("секретарь — только хозяину и только в личке; выключатель; письмо из чата хозяина — не разговор с ней", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  await h.onBusinessConnection(connection(), KEY);
  // Чужие слова «отвечай за меня» — обычный разговор; в группе хозяин секретаря не включает.
  sdk().fetchQueue.push(says("За вас — не могу."));
  await h.onMessage(message("отвечай за меня"), KEY);
  assert.equal(last(), "За вас — не могу.");
  sdk().fetchQueue.push(says("Не при всех."));
  await h.onMessage(group("Аи, отвечай за меня", { id: OWNER }), KEY);
  assert.equal(last(-10), "Не при всех.");
  assert.equal(state().away.on, false);

  // Письмо с пометкой подключения, попавшее в обычный вход, — не разговор с ней.
  assert.deepEqual(await h.onMessage({ ...message("привет"), business_connection_id: CONN }, KEY), { ignored: true, reason: "business" });
  // Репетиция перед публикацией ничего не трогает.
  assert.deepEqual(await h.onBusinessMessage(letter("привет"), { testRun: true }), { ok: true, route: "business_message", side_effects: "none" });
  assert.deepEqual(await h.onBusinessConnection(connection(), { testRun: true }), { ok: true, route: "business_connection", side_effects: "none" });

  // Обработчики платформы существуют и ведут в сердце.
  const { default: onConnection } = await import("../tgcloud/handlers/business_connection.js");
  const { default: onLetter } = await import("../tgcloud/handlers/business_message.js");
  assert.deepEqual(await onLetter(letter("привет"), { testRun: true }), { ok: true, route: "business_message", side_effects: "none" });
  assert.deepEqual(await onConnection(connection(), { testRun: true }), { ok: true, route: "business_connection", side_effects: "none" });

  // Выключено настройкой: подключение и письма — мимо, слова — обычные.
  reset();
  const off = heart({ ...ON, SECRETARY: false }, { now: () => NOON });
  assert.deepEqual(await off.onBusinessConnection(connection(), KEY), { ignored: true });
  assert.deepEqual(await off.onBusinessMessage(letter("привет"), KEY), { ignored: true });
  sdk().fetchQueue.push(says("Секретаря у меня нет."));
  await off.onMessage(own("отвечай за меня"), KEY);
  assert.equal(last(OWNER), "Секретаря у меня нет.");
  assert.equal(sdk().kv.has(SECRETARY_KEY), false);

  // Выключили настройкой посреди отлучки: чужие письма лежать не остаются — список хозяину, и стёрто.
  reset();
  const on = heart(ON, { now: () => NOON });
  await on.onBusinessConnection(connection(), KEY);
  await on.onMessage(own("отвечай за меня"), KEY);
  await on.onBusinessMessage(letter("напиши, когда освободишься", { id: 530, name: "Брат" }), KEY);
  assert.equal(state().people.length, 1);
  const later = heart({ ...ON, SECRETARY: false }, { now: () => NOON + 60_000 });
  await later.tick({ ...KEY, now: NOON + 60_000 });
  assert.match(toOwner().at(-1).text, /^Секретарь выключен в настройках: за вас я больше не отвечаю\.\n\nПока вас не было \(с 12:00\), писали — 1 человек:\n• Брат — 1 сообщение, 12:00: «напиши, когда освободишься»/u);
  assert.deepEqual({ on: state().away.on, people: state().people }, { on: false, people: [] });
  assert.ok(![...sdk().kv.values()].some(value => String(value).includes("освободишься")), "выдержка из чужого письма нигде не осталась");
  // Второй удар будильника — тишина.
  const told = toOwner().length;
  await later.tick({ ...KEY, now: NOON + 120_000 });
  assert.equal(toOwner().length, told);
});

test("разные люди пишут разом — в списке все, каждому один ответ; срок, увиденный тремя письмами, кончается один раз", async () => {
  reset();
  let clock = NOON;
  const h = heart(ON, { now: () => clock });
  await h.onBusinessConnection(connection(), KEY);
  await h.onMessage(own("отвечай за меня на 2 часа"), KEY);
  // Восемь человек в одну и ту же секунду: каждое письмо читает одно и то же состояние.
  const ids = [601, 602, 603, 604, 605, 606, 607, 608];
  const results = await Promise.all(ids.map((id, index) => h.onBusinessMessage(letter(`письмо номер ${index + 1}`, { id, name: `Гость${index + 1}` }), KEY)));
  assert.deepEqual(results.map(item => item.action), ids.map(() => "secretary_notice"));
  assert.deepEqual(state().people.map(item => item.id).sort(), ids, "ни одно письмо не затёрто соседним");
  assert.ok(state().people.every(item => item.n === 1 && item.told === true && item.failed === false));
  assert.equal(state().sent.n, ids.length, "счёт ответов за час тоже не потерян");
  for (const id of ids) assert.equal(business(id).length, 1, `гостю ${id} — один ответ`);
  // И вперемешку: трое пишут по два письма разом — у каждого счёт 2, ответ один.
  await Promise.all([611, 612, 613, 611, 612, 613].map(id => h.onBusinessMessage(letter("ещё письмо", { id, name: `Друг${id}` }), KEY)));
  for (const id of [611, 612, 613]) {
    assert.equal(state().people.find(item => item.id === id).n, 2);
    assert.equal(business(id).length, 1);
  }
  assert.equal(state().people.length, 11);
  await h.onMessage(own("кто мне писал?"), KEY);
  assert.match(last(OWNER), /писали — 11 человек:/u);
  assert.match(last(OWNER), /Каждому я один раз сказала, что вы не на связи\.$/u);

  // Срок вышел, будильник ещё не звонил — и три письма приходят разом. «Срок вышел» — одно.
  clock = NOON + 2 * 3_600_000 + 5_000;
  const before = toOwner().length;
  const late = await Promise.all([621, 622, 623].map(id => h.onBusinessMessage(letter("вы тут?", { id, at: clock }), KEY)));
  assert.deepEqual(late, [621, 622, 623].map(() => ({ ignored: true, reason: "not_away" })));
  const ended = toOwner().slice(before);
  assert.equal(ended.length, 1, "хозяину — одно письмо о конце срока, а не три");
  assert.match(ended[0].text, /^Срок вышел: за вас я больше не отвечаю\.\n\nПока вас не было \(с 12:00\), писали — 11 человек:/u);
  assert.equal(state().away.on, false);
  assert.deepEqual(state().people, []);
  for (const id of [621, 622, 623]) assert.equal(business(id).length, 0);
  // И будильник следом молчит.
  await h.tick({ ...KEY, now: clock + 60_000 });
  assert.equal(toOwner().filter(item => /Срок вышел/u.test(item.text)).length, 1);
});

test("посреди отлучки: сняли подключение — список не пропадает; хозяин вернулся посреди ответа — человек в списке есть", async () => {
  reset();
  let clock = NOON;
  const h = heart(ON, { now: () => clock });
  await h.onBusinessConnection(connection(), KEY);
  await h.onMessage(own("отвечай за меня"), KEY);
  await h.onBusinessMessage(letter("перезвони, как сможешь", { id: 701, name: "Отец" }), KEY);
  assert.equal(business(701).length, 1);
  const since = state().away.since;
  assert.ok(sdk().kv.has(toldKey(since, 701)));
  // Подключение снято в настройках Telegram, пока она отвечала: кто писал — хозяин узнаёт тут же.
  await h.onBusinessConnection(connection({ enabled: false }), KEY);
  assert.match(toOwner().at(-1).text, /^Подключение к вашему аккаунту снято: ваших чатов я больше не вижу и за вас не отвечаю\.\n\nПока вас не было \(с 12:00\), писали — 1 человек:\n• Отец — 1 сообщение, 12:00: «перезвони, как сможешь»/u);
  assert.deepEqual({ conn: state().conn, on: state().away.on, people: state().people }, { conn: null, on: false, people: [] });
  assert.ok(!sdk().kv.has(toldKey(since, 701)), "отметка «уже сказано» убрана");
  assert.ok(![...sdk().kv.values()].some(value => String(value).includes("перезвони")), "чужое письмо нигде не осталось");

  // Снова подключена, снова отлучка. Письмо пришло, ответ уходит — и в эту секунду хозяин пишет «я тут».
  clock = NOON + 3_600_000;
  await h.onBusinessConnection(connection(), KEY);
  await h.onMessage(own("отвечай за меня"), KEY);
  let back = null;
  sdk().duringSend = async (params) => {
    if (!params.business_connection_id || back) return;
    back = h.onMessage(own("я тут"), KEY);
    await back;
  };
  const done = await h.onBusinessMessage(letter("ты где?", { id: 702, name: "Сестра", at: clock }), KEY);
  delete sdk().duringSend;
  assert.equal(done.action, "secretary_notice");
  const welcome = toOwner().find(item => /^С возвращением, хозяин/u.test(item.text) && /Сестра/u.test(item.text));
  assert.ok(welcome, "человек, которому она как раз отвечала, в списке у хозяина есть");
  assert.match(welcome.text, /писали — 1 человек:\n• Сестра — 1 сообщение, 13:00: «ты где\?»/u);
  assert.equal(state().away.on, false);
  assert.deepEqual(state().people, [], "после возвращения список не воскресает");

  // Хозяин вернулся раньше, чем письмо успело записаться, — она не отвечает вовсе.
  clock = NOON + 2 * 3_600_000;
  await h.onMessage(own("отвечай за меня"), KEY);
  await h.onMessage(own("я тут"), KEY);
  const quiet = await h.onBusinessMessage(letter("и ещё вопрос", { id: 703, at: clock }), KEY);
  assert.deepEqual(quiet, { ignored: true, reason: "not_away" });
  assert.equal(business(703).length, 0);
});

test("срок продлён в ту же секунду, когда он вышел: отлучка не обрывается, письмо — обычное", async () => {
  reset();
  let clock = NOON;
  const h = heart(ON, { now: () => clock });
  await h.onBusinessConnection(connection(), KEY);
  await h.onMessage(own("отвечай за меня на 1 час"), KEY);
  clock = NOON + 3_600_000 + 1_000;
  // Будильник читает состояние с вышедшим сроком — и ровно в этот миг хозяин срок продлевает.
  // Кончать отлучку по прочитанному раньше нельзя: решает то, что лежит в базе сейчас.
  const { db } = await import("./fixtures/sdk-stub.mjs");
  const read = db.get;
  let reads = 0;
  db.get = async (query, params = {}) => {
    const row = await read(query, params);
    if (params[":key"] === SECRETARY_KEY && (reads += 1) === 1) await h.onMessage(own("отвечай за меня на 2 часа"), KEY);
    return row;
  };
  const before = toOwner().length;
  try { await h.tick({ ...KEY, now: clock }); } finally { db.get = read; }
  assert.ok(reads >= 2, "будильник дошёл до секретаря");
  const said = toOwner().slice(before).map(item => item.text);
  assert.equal(said.filter(text => /Срок вышел/u.test(text)).length, 0, "продлённую отлучку будильник не обрывает");
  assert.equal(said.filter(text => /^Хорошо, хозяин: до 15:00 отвечаю за вас/u.test(text)).length, 1);
  assert.equal(state().away.on, true);
  assert.equal(state().away.until, clock + 2 * 3_600_000);

  // То же с письмом: оно видит вышедший срок, а хозяин его как раз продлил, — письмо обычное.
  clock = NOON + 3 * 3_600_000 + 2_000;
  reads = 0;
  db.get = async (query, params = {}) => {
    const row = await read(query, params);
    if (params[":key"] === SECRETARY_KEY && (reads += 1) === 1) await h.onMessage(own("отвечай за меня на 30 минут"), KEY);
    return row;
  };
  let done = null;
  try { done = await h.onBusinessMessage(letter("можно вопрос?", { id: 801, at: clock }), KEY); } finally { db.get = read; }
  assert.equal(done.action, "secretary_notice");
  assert.equal(business(801).length, 1);
  assert.equal(toOwner().filter(item => /Срок вышел/u.test(item.text)).length, 0);
  assert.equal(state().people.length, 1);
});

test("письма валом после простоя: сорок пять разом — помнит сорок и число остальных; длинный список уходит частями и целиком", async () => {
  reset();
  let clock = NOON;
  const h = heart(ON, { now: () => clock });
  await h.onBusinessConnection(connection(), KEY);
  await h.onMessage(own("отвечай за меня на 1 час"), KEY);
  // Платформа простояла полчаса, и Telegram отдаёт накопившееся разом. Письма старые — на них она не отвечает.
  clock = NOON + 30 * 60_000;
  const ids = Array.from({ length: 45 }, (_, index) => 900 + index);
  const nameOf = (id) => `Собеседник с длинным именем номер ${id}`;
  const long = "очень длинное письмо ".repeat(12);
  const results = await Promise.all(ids.map(id => h.onBusinessMessage(letter(`${long}${id}`, { id, name: nameOf(id), at: NOON + 60_000 }), KEY)));
  assert.ok(results.every(item => item.action === "secretary_noted"), "каждое письмо записано");
  assert.equal(state().people.length, 40, "список — на сорок человек");
  assert.equal(state().more, 5, "о вытесненных помнит число");
  for (const id of ids) assert.equal(business(id).length, 0);
  // «Кто мне писал?» — все сорок, частями: одним сообщением столько не уходит.
  let before = toOwner().length;
  await h.onMessage(own("кто мне писал?"), KEY);
  const asked = toOwner().slice(before).map(item => item.text);
  assert.ok(asked.length > 1 && asked.every(text => text.length <= 4096));
  assert.match(asked[0], /^Пока вас не было \(с 12:00\), писали — 45 человек:/u);
  assert.equal(ids.filter(id => asked.join("\n").includes(`• ${nameOf(id)} — 1 сообщение`)).length, 40);
  assert.match(asked.join("\n"), /Ещё 5 человек писали до них: список у меня на 40 человек, тех я уже не помню — смотрите в самих чатах\.\nНикому не отвечала\. Остальным не стала:/u);

  // Срок вышел, а Telegram в эту минуту не принимает: список не теряется — уходит с очередью вестей, тоже целиком.
  clock = NOON + 3_600_000 + 1_000;
  before = toOwner().length;
  sdk().failing.sendMessage = Object.assign(new Error("Bad Gateway"), { code: 502 });
  await h.tick({ ...KEY, now: clock });
  assert.equal(toOwner().length, before);
  assert.equal(state().away.on, false);
  assert.deepEqual(state().people, [], "у неё список стёрт");
  delete sdk().failing.sendMessage;
  for (let minute = 2; minute <= 12 && !toOwner().slice(before).some(item => /Ещё 5 человек писали до них/u.test(item.text)); minute += 2) {
    clock += 2 * 60_000;
    await h.tick({ ...KEY, now: clock });
  }
  const late = toOwner().slice(before).map(item => item.text).join("\n");
  assert.match(late, /Срок вышел: за вас я больше не отвечаю\.\n\nПока вас не было \(с 12:00\), писали — 45 человек:/u);
  assert.equal(ids.filter(id => late.includes(`• ${nameOf(id)} — 1 сообщение`)).length, 40, "ни одна строка списка не пропала");
  assert.match(late, /Ещё 5 человек писали до них/u);
});
