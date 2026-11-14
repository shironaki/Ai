/**
 * Характер без модели: настроение с причиной, своё с каждым (счёт и шутки),
 * новые ролевые действия и эмоции, реакции из словаря, флирт двух уровней.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, hers, reset, last, calls, chats, says, sdk, system, source, toChat, reactions, OWNER, KEY, DAY } from "./fixtures/kit.mjs";

const { moodOf, localParts } = await import("../tgcloud/lib/mood.js");
const { parseJoke, createBond, MILESTONES } = await import("../tgcloud/lib/bond.js");
const { parseAction, parseEmote, lineFor, emoteLine, dative, reactionFor, ACTIONS, EMOTES, listText } = await import("../tgcloud/lib/rp.js");
const { parseIntent } = await import("../tgcloud/lib/intents.js");
const { buildCharacterProfile } = await import("../tgcloud/lib/ai-character.js");

const ON = { PHRASES: true };
const NOON = Date.parse("2026-11-18T09:00:00Z");
const ACTION = Object.fromEntries(ACTIONS.map(item => [item.key, item]));
const masha = { message_id: 70, from: { id: 22, first_name: "Маша", is_bot: false }, text: "всем привет" };
const feel = async (h, userId, score) => h.policy.setRelationship({ actorId: OWNER, userId, score });
const at = (iso) => Date.parse(iso);

test("настроение: у него есть причина, и причина — правда о часе, дне и человеке", () => {
  const mood = (iso, extra = {}) => { const got = moodOf({ now: at(iso), timeZone: "Europe/Moscow", userId: 7, ...extra }); return `${got.mood}/${got.reason}`; };
  assert.equal(mood("2026-11-13T19:00:00Z"), "суеверное/пятница 13");
  assert.match(mood("2026-11-14T01:30:00Z"), /^(?:сонное|мечтательное)\/ночь$/u);
  assert.equal(mood("2026-12-31T12:00:00Z"), "праздничное/новый год");
  assert.equal(mood("2026-04-01T09:00:00Z"), "хулиганское/первое апреля");
  assert.equal(mood("2026-11-18T12:00:00Z", { gapDays: 5 }), "радостное/давно не виделись");
  assert.equal(mood("2026-11-18T12:00:00Z", { limited: true }), "уставшее/лимит");
  assert.match(mood("2026-11-18T05:00:00Z", { talks: 5 }), /\/утро$/u);
  assert.match(mood("2026-11-18T16:00:00Z", { talks: 5 }), /\/вечер$/u);
  // Одно и то же в пределах трёх часов; в понедельник утром бывает ворчливым, в выходной — ленивым.
  assert.equal(mood("2026-11-18T09:05:00Z", { talks: 5 }), mood("2026-11-18T10:55:00Z", { talks: 5 }));
  const week = new Set();
  for (let user = 0; user < 30; user += 1) {
    week.add(moodOf({ now: at("2026-11-16T06:00:00Z"), timeZone: "Europe/Moscow", userId: user, talks: 5 }).reason);
    week.add(moodOf({ now: at("2026-11-21T10:00:00Z"), timeZone: "Europe/Moscow", userId: user, talks: 5 }).reason);
    week.add(moodOf({ now: at("2026-11-20T15:00:00Z"), timeZone: "Europe/Moscow", userId: user, talks: 50 }).reason);
  }
  for (const reason of ["понедельник", "выходной", "пятница", "много разговоров", "утро", "день", "вечер"]) assert.ok(week.has(reason), reason);
  assert.deepEqual(localParts(at("2026-11-13T21:30:00Z"), "Europe/Moscow"), { hour: 0, minute: 30, weekday: 6, month: 11, day: 14, clock: "00:30" });
  assert.equal(localParts(at("2026-11-13T21:30:00Z"), "Нет/Такого").clock, "21:30", "неизвестный пояс — по Гринвичу, а не падение");
});

test("своё с каждым: счёт с круглыми числами и общие шутки", async () => {
  assert.deepEqual(parseJoke("наша шутка: ёжик в тумане"), { add: "ёжик в тумане" });
  assert.deepEqual(parseJoke("Запомни шутку — «пингвины не летают»."), { add: "пингвины не летают" });
  assert.deepEqual(parseJoke("наши шутки"), { list: true });
  assert.deepEqual(parseJoke("забудь шутку 2"), { drop: 2 });
  assert.deepEqual(parseJoke("забудь все шутки"), { drop: "all" });
  for (const said of ["расскажи шутку", "шутка", "наша шутка", "это шутка: да?", ""]) assert.equal(parseJoke(said), said === "это шутка: да?" ? null : null, said);
  const kv = new Map();
  const store = { available: true, get: async (key) => kv.get(key) ?? null, set: async (key, value) => { kv.set(key, value); return true; } };
  const bond = createBond({ store });
  const seen = [];
  for (let index = 1; index <= 26; index += 1) { const got = await bond.count(5, "hug"); if (got.milestone) seen.push(got.n); }
  assert.deepEqual(seen, [10, 25]);
  assert.deepEqual(MILESTONES.slice(0, 4), [10, 25, 50, 100]);
  assert.equal((await bond.addJoke(5, "раз")).total, 1);
  assert.equal((await bond.addJoke(5, "РАЗ")).duplicate, true);
  for (let index = 0; index < 11; index += 1) await bond.addJoke(5, `шутка ${index}`);
  assert.equal((await bond.addJoke(5, "лишняя")).code, "too_many");
  assert.equal((await bond.dropJoke(5, 99)).code, "not_found");
  assert.equal((await bond.dropJoke(5, 1)).total, 11);
  assert.equal((await bond.counts(5)).hug, 26, "шутки счёт не стирают");
});

test("новые действия: формы, падежи и хвосты; речь действием по-прежнему не считается", () => {
  assert.ok(ACTIONS.length >= 75, `действий: ${ACTIONS.length}`);
  assert.equal(new Set(ACTIONS.map(item => item.key)).size, ACTIONS.length, "ключи не повторяются");
  const show = (text) => { const got = parseAction(text); return got ? `${got.action.key}${got.asked ? "!" : ""}${got.toMe ? ">me" : ""}${got.tail ? `[${got.tail}]` : ""}` : null; };
  const cases = {
    "помахал": "wave", "подарил цветы": "gift[цветы]", "угостить пиццей": "tea[пиццей]", "потанцуй со мной": "dance!>me", "прижмись ко мне": "nuzzle!>me", "сядь на колени ко мне": "sit!>me",
    "подмигни ему": "wink!", "буп": "boop", "щелбан": "flick", "пожелал спокойной ночи": "goodnight", "кинул тапком в": "slipper", "почесала за ушком": "scratch", "спас": "rescue",
    "воздушный поцелуй": "blowkiss", "поставил в угол": "corner", "арестовать": "arrest", "ущипнула": "pinch", "сфоткал": "photo", "закружил": "spin",
  };
  for (const [said, want] of Object.entries(cases)) assert.equal(show(said), want, said);
  for (const said of ["спасибо", "поздравляю", "благодарю", "подарил бы, да нечего", "спасти не удалось", "лайк", "дарю, но не тебе, а ему"]) assert.equal(show(said), null, said);
  const line = (key, name, tail = "") => lineFor(ACTION[key], "Аня", name, { tail, bName: name });
  assert.equal(line("wave", "Маша"), "👋 Аня машет Маше");
  assert.equal(line("gift", "Иван", "цветы"), "🎁 Аня дарит Ивану цветы");
  assert.equal(line("gift", "Иван"), "🎁 Аня дарит Ивану подарок");
  assert.equal(line("dance", "Катя"), "💃 Аня приглашает Катю на танец");
  assert.equal(line("goodnight", "Мария"), "🌙 Аня желает Марии спокойной ночи");
  assert.equal(line("sit", "Игорь"), "🪑 Аня садится на колени к Игорю");
  assert.equal(line("scratch", "Вася"), "🐾 Аня чешет Васю за ушком");
  assert.equal(line("boop", "DarkLord"), "👆 Аня бупает DarkLord в нос");
  assert.deepEqual(["Маша", "Катя", "Мария", "Иван", "Андрей", "Игорь", "Пётр", "Лев", "DarkLord", "Саша", "Никита"].map(dative), ["Маше", "Кате", "Марии", "Ивану", "Андрею", "Игорю", "Петру", "Льву", "DarkLord", "Саше", "Никите"]);
  assert.match(listText(), /Без адресата, одним словом: танцевать, плакать, /u);
});

test("эмоции без адресата: словом в неопределённой форме или в звёздочках; «плачу» и «думаю» — речь", () => {
  assert.ok(EMOTES.length >= 30);
  const key = (text) => parseEmote(text)?.key ?? null;
  const cases = { "танцевать": "dance", "*танцую*": "dance", "_зеваю_": "yawn", "*плачу*": "cry", "Рукалицо": "facepalm", "пить чай": "tea", "*пью чай*": "tea", "перевернуть стол!": "tableflip", "*ору*": "scream", "спать": "sleep" };
  for (const [said, want] of Object.entries(cases)) assert.equal(key(said), want, said);
  for (const said of ["танцую", "плачу", "думаю", "ржу", "сплю", "я танцевать не умею", "*танцую с тобой*", ""]) assert.equal(key(said), null, said);
  assert.equal(emoteLine(EMOTES.find(item => item.key === "dance"), "Вася"), "💃 Вася танцует");
});

test("в группе: новое действие между людьми — с падежом; эмоция — строкой о человеке; с ней в личке эмоции нет", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  const done = await h.onMessage(group("подарил цветы", { id: 21, name: "Вася", reply: masha }), KEY);
  assert.equal(done.kind, "gift");
  assert.equal(toChat(-10).at(-1).text, '🎁 Вася дарит <a href="tg://user?id=22">Маше</a> цветы');
  const emote = await h.onMessage(group("танцевать", { id: 21, name: "Вася" }), KEY);
  assert.equal(emote.emote, true);
  assert.equal(toChat(-10).at(-1).text, "💃 Вася танцует");
  assert.equal((await h.onMessage(group("*зеваю*", { id: 21, name: "Вася" }), KEY)).kind, "yawn");
  assert.equal((await h.onMessage(group("танцую", { id: 21, name: "Вася" }), KEY)).ignored, true, "без звёздочек — обычная речь");
  assert.equal((await h.onMessage(group("спать", { id: 21, name: "Вася", reply: masha }), KEY)).ignored, true, "в ответ человеку — это слова ему, а не эмоция");
  // Действия выключены админом — и эмоций нет.
  await h.onMessage(group("Аи, выключи рп", { id: OWNER }), KEY);
  assert.equal((await h.onMessage(group("танцевать", { id: 21, name: "Вася" }), KEY)).reason, "rp_off");
  assert.equal(chats().length, 0);
});

test("её реакция — из словаря: по близости, у действия свои слова, на круглом числе — счёт", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  // Чужой обнимает — растерянность; близкий — тепло; хозяин — своё.
  await h.onMessage(message("обнять", { id: 31, reply: hers() }), KEY);
  assert.match(last(31), /Эм… ладно\. Неожиданно\.|Ой\. Мы вроде только познакомились|Э-э\. Принято/u);
  await feel(h, 32, 80);
  await h.onMessage(message("обнять", { id: 32, reply: hers() }), KEY);
  assert.match(last(32), /Обнимаю в ответ|обнимает крепко/u);
  await h.onMessage(message("поцеловать", { id: OWNER, reply: hers() }), KEY);
  assert.match(last(OWNER), /[Хх]озяин|ждала/u);
  // Холодному — только холодные слова.
  await feel(h, 33, -60);
  await h.onMessage(message("обнять", { id: 33, reply: hers() }), KEY);
  assert.match(last(33), /^(?:Руки\. Мы не настолько знакомы\.|Не надо\. Я не люблю, когда меня трогают без спроса\.)$/u);
  // Десятое объятие — она считала.
  for (let index = 0; index < 8; index += 1) await h.onMessage(message("обнять", { id: 32, reply: hers() }), KEY);
  assert.doesNotMatch(last(32), /10-й/u);
  await h.onMessage(message("обнять", { id: 32, reply: hers() }), KEY);
  assert.match(last(32), /\n(?:Между прочим, это уже 10-й раз\. Я считаю\.|10-й раз\. У меня всё записано\.|Юбилей: 10\. Отметим\?)$/u);
  // Тому, кто назвал себя младше восемнадцати, романтика — дружбой, не словарём.
  await h.onMessage(message("мне 15 лет", { id: 34 }), KEY).catch(() => null);
  await feel(h, 34, 80);
  sdk().fetchQueue.length = 0;
  await h.onMessage(message("поцеловать", { id: 34, reply: hers() }), KEY);
  assert.match(last(34), /по-дружески|Я за дружбу/u);
  // Без словаря слова берутся прежние.
  const plain = reactionFor(ACTION.hug, { score: 80, random: () => 0, formal: false });
  assert.equal(plain.text, "Иди сюда. Обнимаю в ответ.");
  assert.equal(reactionFor(ACTION.hug, { score: 80, phrase: () => "Из словаря." }).text, "Из словаря.");
});

test("флирт: хозяину наедине — смело и всегда; остальным — только по просьбе, взрослым и не чужим", async () => {
  assert.equal(parseIntent("можно флиртовать")?.intent, "yes_flirt");
  assert.equal(parseIntent("флиртуй со мной")?.intent, "yes_flirt");
  assert.equal(parseIntent("без флирта")?.intent, "no_flirt");
  const profile = (character, extra = {}) => buildCharacterProfile({ character, isPrivate: true, relationship: { score: 80 }, now: NOON, ...extra });
  assert.equal(profile({ adult: true, flirt: "bold" }, { relationship: { score: 0 } }).flirt, true, "хозяину — независимо от счёта");
  assert.match(profile({ adult: true, flirt: "bold" }).core, /С ним можно флиртовать смело.*Откровенных сцен не описывай/su);
  assert.match(profile({ adult: true, flirt: "bold" }).instruction, /флирт разрешён и желанен.*намёк сильнее подробности/su);
  assert.equal(profile({ adult: true, flirt: "bold" }, { isPrivate: false }).flirt, false, "в группе — нет");
  assert.equal(profile({ adult: true, flirt: "bold" }, { userText: "мне 16 лет" }).flirt, false);
  assert.equal(profile({ adult: true, flirt: "light" }, { relationship: { score: 10 } }).flirt, false, "лёгкий — только при близости");
  assert.equal(profile({}).flirt, false);
  assert.match(profile({}).core, /Флирт не разрешён/u);
  assert.match(profile({}, { mood: "сонное — ночь" }).core, /Настроение: сонное — ночь\./u);

  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  // Не назвал возраст — сначала возраст.
  await h.onMessage(message("можно флиртовать", { id: 41 }), KEY);
  assert.match(last(41), /Сначала скажите, сколько вам лет/u);
  sdk().fetchQueue.push(says("Хорошо, запомнила."));
  await h.onMessage(message("мне 25 лет", { id: 41 }), KEY);
  await h.onMessage(message("можно флиртовать", { id: 41 }), KEY);
  assert.match(last(41), /флиртую я только в личке и только с теми, кто мне нравится/u);
  // Младше восемнадцати — нет, что бы ни сказал потом.
  sdk().fetchQueue.push(says("Понятно."));
  await h.onMessage(message("мне 16 лет", { id: 42 }), KEY);
  await h.onMessage(message("флиртуй со мной", { id: 42 }), KEY);
  assert.match(last(42), /кому нет восемнадцати, я не флиртую/u);
  // Согласие и возраст есть, но отношения прохладные — строки «для флирта» не звучат; тёплые — звучат.
  for (let index = 0; index < 6; index += 1) { await h.onMessage(message("ты красивая", { id: 41 }), KEY); assert.doesNotMatch(last(41), /привыкаю|что ещё умеете/u); }
  await feel(h, 41, 60);
  const heard = new Set();
  const lucky = heart(ON, { now: () => NOON });
  for (let index = 0; index < 60; index += 1) { await lucky.onMessage(message("ты красивая", { id: 41 }), KEY); heard.add(last(41)); }
  assert.ok([...heard].some(text => /привыкаю|что ещё умеете/u.test(text)), "тёплому и согласному — строки с пометкой «флирт»");
  // Хозяину: подсказка модели — смелая; постороннему — закрытая.
  sdk().fetchQueue.push(says("Да, хозяин."), says("Да."));
  await h.onMessage(message("придумай две строчки про осенний дождь и фонари", { id: OWNER }), KEY);
  assert.match(system(), /С ним можно флиртовать смело/u);
  await h.onMessage(message("придумай две строчки про осенний дождь и фонари", { id: 43 }), KEY);
  assert.match(system(), /Флирт не разрешён/u);
  await h.onMessage(message("можно флиртовать", { id: OWNER }), KEY);
  assert.match(last(OWNER), /С вами, хозяин, я и так не сдерживаюсь/u);
});
