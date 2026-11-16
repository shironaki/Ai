/**
 * Своё у чата: действия, которые добавляет админ, свои гифки к действиям и
 * связи между участниками — пары, браки, названая семья, лучшие друзья.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, hers, reset, last, calls, chats, says, sdk, toChat, OWNER, KEY } from "./fixtures/kit.mjs";

const { parseOwn, parseBond, matchOwn, ownActionProblem, actionKeyOf, bondProblem, BONDS_KEY } = await import("../tgcloud/lib/chatown.js");
const { SOUL_PREFIXES } = await import("../tgcloud/lib/soul.js");
const { createPhrasebook } = await import("../tgcloud/lib/phrasebook.js");

const ON = { PHRASES: true };
const NOON = Date.parse("2026-11-18T09:00:00Z");
const ADMIN = 21, MASHA = 22, PETYA = 23;
const admin = (text, extra = {}) => group(text, { id: ADMIN, name: "Вася", ...extra });
const masha = (text, extra = {}) => group(text, { id: MASHA, name: "Маша", ...extra });
const petya = (text, extra = {}) => group(text, { id: PETYA, name: "Петя", ...extra });
/** Сообщение человека, на которое отвечают. */
const from = (id, name, more = {}) => ({ message_id: 700 + id, from: { id, first_name: name, is_bot: false }, text: "привет всем", ...more });
const gif = (id) => ({ message_id: 800, from: { id: MASHA, first_name: "Маша", is_bot: false }, animation: { file_id: id } });
const start = (options = {}) => {
  reset();
  sdk().apiReplies.getChatMember = (params) => ({ status: params.user_id === ADMIN ? "administrator" : "member" });
  return heart(ON, { now: () => NOON, random: () => 0, ...options });
};
const press = (h, data, { id, name = "Тест", messageId = 900 } = {}) => h.onCallback({
  id: `q${id}${data}`, from: { id, first_name: name }, data, message: { message_id: messageId, chat: { id: -10, type: "supergroup" } },
}, KEY);
const text = () => toChat(-10).at(-1).text;

test("разбор: своё действие, список, убрать, гифка к действию; обычные слова — мимо", () => {
  assert.deepEqual(parseOwn("новое действие: угостить печенькой — угощает печенькой 🍪"), { add: { say: ["угостить печенькой"], verb: "угощает печенькой", how: "acc", emoji: "🍪" } });
  assert.deepEqual(parseOwn("Добавь действие: дать печеньку/дал печеньку - даёт печеньку кому"), { add: { say: ["дать печеньку", "дал печеньку"], verb: "дает печеньку", how: "dat", emoji: "" } });
  assert.ok(parseOwn("новое действие: обнять").bad, "без «как сказать» — подсказка");
  assert.ok(parseOwn("новое действие: 12345 — делает").bad);
  assert.deepEqual(parseOwn("наши действия"), { list: true });
  assert.deepEqual(parseOwn("убери действие 2"), { drop: 2 });
  assert.deepEqual(parseOwn("убери действие дать печеньку"), { drop: "дать печеньку" });
  assert.deepEqual(parseOwn("это для обнять"), { gifFor: "обнять", loose: true });
  assert.deepEqual(parseOwn("гифка для обнять"), { gifFor: "обнять" });
  assert.deepEqual(parseOwn("убери гифки для обнять"), { gifDrop: "обнять" });
  assert.deepEqual(parseOwn("наши гифки"), { gifList: true });
  for (const said of ["привет", "новое действие в фильме — это всегда хорошо", "новое действие правительства", "наше действие было правильным", "убери гифки", "без гифок", "добавь действие в сценарий"]) {
    assert.equal(parseOwn(said), null, said);
  }
  // «Это для тебя» — слова: просьбой они становятся, только если после «для» — известное действие.
  for (const said of ["это для тебя", "это для меня важно", "это на память", "это к лучшему", "это к чаю"]) {
    const got = parseOwn(said);
    assert.ok(got === null || (got.loose && !actionKeyOf(got.gifFor)), said);
  }
  assert.deepEqual(actionKeyOf("обнять"), { key: "hug", title: "обнять" });
  assert.deepEqual(actionKeyOf("дать печеньку", [{ say: ["дать печеньку"], verb: "дает печеньку" }]), { key: "own:дать печеньку", title: "дать печеньку" });

  // Встроенное и откровенное своим действием не завести.
  assert.match(ownActionProblem({ say: ["обнять"], verb: "обнимает" }), /уже есть — это встроенное «обнять»/u);
  assert.equal(ownActionProblem({ say: ["раздеть"], verb: "раздевает" }), "Такое действие я вести не буду.");
  assert.equal(ownActionProblem({ say: ["дать печеньку"], verb: "дает печеньку" }), "");
  const acts = [{ say: ["дать печеньку", "дал печеньку"], verb: "дает печеньку", how: "dat", emoji: "🍪" }];
  assert.equal(matchOwn("дал печеньку с любовью", acts).tail, "с любовью");
  assert.equal(matchOwn("дал печеньку, а потом ушёл", acts), null, "запятая — признак речи");
  assert.equal(matchOwn("дал печенькун", acts), null);
});

test("своё действие: добавляет админ, работает ответом на сообщение, как встроенные; убрать — словом", async () => {
  const h = start();
  // Не админ — нельзя; админ — можно.
  await h.onMessage(masha("Аи, новое действие: дать печеньку/дал печеньку — даёт печеньку кому 🍪"), KEY);
  assert.equal(text(), "Своё в этом чате настраивают админы.");
  await h.onMessage(admin("Аи, новое действие: дать печеньку/дал печеньку — даёт печеньку кому 🍪"), KEY);
  assert.match(text(), /^Запомнила действие «дать печеньку»\. Выглядеть будет так: 🍪 Вася дает печеньку Маше\n/u);
  await h.onMessage(admin("Аи, новое действие: обнять — обнимает"), KEY);
  assert.match(text(), /уже есть — это встроенное «обнять»/u);
  await h.onMessage(admin("Аи, новое действие: раздеть — раздевает"), KEY);
  assert.equal(text(), "Такое действие я вести не буду.");
  await h.onMessage(admin("Аи, новое действие: дать печеньку — даёт печеньку"), KEY);
  assert.match(text(), /в этом чате уже есть/u);
  await h.onMessage(masha("Аи, наши действия"), KEY);
  assert.match(text(), /^Свои действия этого чата:\n1\. дать печеньку \/ дал печеньку — «дает печеньку»/u);

  // Любой участник, без обращения к ней — ответом на чужое сообщение.
  const before = toChat(-10).length;
  const done = await h.onMessage(petya("дал печеньку с любовью", { reply: from(MASHA, "Маша") }), KEY);
  assert.equal(done.own, true);
  assert.equal(text(), "🍪 Петя дает печеньку <a href=\"tg://user?id=22\">Маше</a> с любовью");
  // Без адресата — это слова, а не действие; к ней самой — строка и её короткое слово.
  assert.deepEqual(await h.onMessage(petya("дал печеньку"), KEY), { ignored: true });
  assert.equal(toChat(-10).length, before + 1);
  await h.onMessage(petya("Аи, дать печеньку", { reply: hers() }), KEY);
  assert.match(text(), /^🍪 Петя дает печеньку Аи\n/u);
  // Её слово — из запаса «+реакция:своё» (имя запаса с «ё» должно находиться).
  const reactions = createPhrasebook().pool("+реакция:своё", { formal: true });
  assert.ok(reactions.length >= 3);
  assert.ok(reactions.includes(text().split("\n")[1]), text());
  // Сам себе.
  await h.onMessage(petya("дать печеньку", { reply: from(PETYA, "Петя") }), KEY);
  assert.match(text(), /Петя пробует это на себе/u);
  assert.equal(chats().length, 0, "модель не тратится");

  // «Без рп» выключает и свои; убрать действие — словом админа.
  await h.onMessage(admin("Аи, убери действие 1"), KEY);
  assert.equal(text(), "Убрала действие «дать печеньку».");
  const count = toChat(-10).length;
  await h.onMessage(petya("дал печеньку", { reply: from(MASHA, "Маша") }), KEY);
  assert.equal(toChat(-10).length, count, "убранное больше не срабатывает");
  await h.onMessage(masha("Аи, наши действия"), KEY);
  assert.match(text(), /Своих действий в этом чате пока нет/u);

  // В личке таких настроек нет; «это для тебя» там — обычные слова.
  await h.onMessage(message("новое действие: дать печеньку — даёт печеньку"), KEY);
  assert.match(last(), /заводятся в группе/u);
});

test("свои гифки: «это для обнять» ответом на гифку — и к действию идёт она, а не аниме", async () => {
  const h = start();
  await h.onMessage(masha("Аи, это для обнять", { reply: gif("GIF1") }), KEY);
  assert.equal(text(), "Своё в этом чате настраивают админы.");
  await h.onMessage(admin("Аи, это для обнять"), KEY);
  assert.equal(text(), "Ответьте этими словами на саму гифку — её и запомню.");
  await h.onMessage(admin("Аи, это для обнять", { reply: gif("GIF1") }), KEY);
  assert.match(text(), /^Запомнила: к «обнять» в этом чате теперь идёт эта гифка\. Убрать — «убери гифки для обнять»\.$/u);

  await h.onMessage(petya("обнять", { reply: from(MASHA, "Маша") }), KEY);
  assert.deepEqual(calls("sendAnimation").at(-1), { chat_id: -10, animation: "GIF1", caption: "🤗 Петя обнимает <a href=\"tg://user?id=22\">Машу</a>", parse_mode: "HTML" });
  // Тому, кто не любит аниме, своя гифка чата всё равно идёт: она не аниме.
  await h.onMessage(masha("Аи, я не люблю аниме"), KEY);
  const sent = calls("sendAnimation").length;
  await h.onMessage(masha("обнять", { reply: from(PETYA, "Петя") }), KEY);
  assert.equal(calls("sendAnimation").length, sent + 1);
  assert.equal(calls("sendAnimation").at(-1).animation, "GIF1");

  // Вторая гифка к тому же действию — выбирается случайная; больше пяти не хранится.
  await h.onMessage(admin("Аи, гифка для обнять", { reply: gif("GIF2") }), KEY);
  assert.match(text(), /своих к нему — 2, выбираю случайную/u);
  await h.onMessage(masha("Аи, наши гифки"), KEY);
  assert.match(text(), /^Свои гифки этого чата:\n• обнять — 2/u);
  for (const id of ["GIF3", "GIF4", "GIF5", "GIF6"]) await h.onMessage(admin("Аи, гифка для обнять", { reply: gif(id) }), KEY);
  assert.deepEqual(JSON.parse(sdk().kv.get("heart:chat:-10")).ownGifs.hug, ["GIF2", "GIF3", "GIF4", "GIF5", "GIF6"]);

  // Неизвестное действие; обычные слова «это для тебя» — не просьба, даже ответом на гифку.
  await h.onMessage(admin("Аи, гифка для полетать", { reply: gif("GIF9") }), KEY);
  assert.match(text(), /Такого действия я не знаю/u);
  sdk().fetchQueue.push(says("Спасибо, приятно."));
  await h.onMessage(admin("Аи, это для тебя", { reply: gif("GIF9") }), KEY);
  assert.equal(text(), "Спасибо, приятно.");

  // Убрать — и к действию снова идёт прежнее.
  await h.onMessage(admin("Аи, убери гифки для обнять"), KEY);
  assert.match(text(), /^Убрала свои гифки для «обнять»/u);
  assert.equal(JSON.parse(sdk().kv.get("heart:chat:-10")).ownGifs.hug, undefined);
  await h.onMessage(admin("Аи, убери гифки для обнять"), KEY);
  assert.match(text(), /здесь и не было/u);

  // Гифка к своему действию; с действием уходит и она.
  await h.onMessage(admin("Аи, новое действие: дать печеньку — даёт печеньку кому"), KEY);
  await h.onMessage(admin("Аи, это для дать печеньку", { reply: gif("COOKIE") }), KEY);
  await h.onMessage(petya("дать печеньку", { reply: from(MASHA, "Маша") }), KEY);
  assert.equal(calls("sendAnimation").at(-1).animation, "COOKIE");
  await h.onMessage(admin("Аи, убери действие дать печеньку"), KEY);
  assert.equal(JSON.parse(sdk().kv.get("heart:chat:-10")).ownGifs["own:дать печеньку"], undefined);
});

test("разбор связей: просьбы к ней как к регистратору; «давай встречаться» — слова ей самой", () => {
  const cases = {
    "пара": { propose: "pair" }, "предложи пару": { propose: "pair" }, "запиши нас парой": { propose: "pair" },
    "брак": { propose: "marriage" }, "пожени нас": { propose: "marriage" }, "предлагаю руку и сердце": { propose: "marriage" }, "выйти замуж за @masha": { propose: "marriage" },
    "семья": { propose: "kin" }, "в семью": { propose: "kin" }, "лучшие друзья": { propose: "friends" }, "подружиться": { propose: "friends" },
    "расстаться": { leave: "pair" }, "развод": { leave: "marriage" }, "выйти из семьи": { leave: "kin" }, "больше не друзья": { leave: "friends" },
    "пары чата": { list: true }, "кто с кем?": { list: true }, "моя пара": { mine: true }, "моя семья": { mine: true },
  };
  for (const [said, want] of Object.entries(cases)) assert.deepEqual(parseBond(said), want, said);
  for (const said of ["давай встречаться", "давай дружить", "давай поженимся", "выходи за меня", "будь моей девушкой", "будем друзьями", "хочу с тобой дружить", "я хочу семью",
    "пара слов о погоде", "брак по расчету это плохо", "свадьба у друга завтра", "семья это главное", "развод мостов в питере", "мои друзья идиоты", "пары отменили", "с кем я говорю",
    "привет", "да", "нет"]) assert.equal(parseBond(said), null, said);

  const bonds = [{ kind: "pair", a: 1, an: "Вася", b: 2, bn: "Маша" }];
  assert.equal(bondProblem(bonds, "pair", { id: 3, name: "Петя" }, { id: 4, name: "Оля" }), "");
  assert.match(bondProblem(bonds, "pair", { id: 1, name: "Вася" }, { id: 2, name: "Маша" }), /уже пара/u);
  assert.match(bondProblem(bonds, "marriage", { id: 1, name: "Вася" }, { id: 4, name: "Оля" }), /У вас уже есть пара: Маша/u);
  assert.match(bondProblem(bonds, "pair", { id: 3, name: "Петя" }, { id: 2, name: "Маша" }), /Маша: пара уже есть — Вася/u);
  assert.equal(bondProblem(bonds, "marriage", { id: 1, name: "Вася" }, { id: 2, name: "Маша" }), "", "пара может пожениться");
  assert.equal(bondProblem(bonds, "friends", { id: 1, name: "Вася" }, { id: 4, name: "Оля" }), "", "дружба паре не мешает");
  assert.match(bondProblem(bonds, "pair", { id: 3, name: "Петя" }, { id: 3, name: "Петя" }), /С собой/u);
});

test("пара: предложение — ответом на сообщение, согласие — только нажатием того, кого спросили; наград нет", async () => {
  const h = start();
  // Без адресата — подсказка; ей самой — отказ; боту — нельзя.
  await h.onMessage(admin("Аи, пара"), KEY);
  assert.equal(text(), "Кому? Ответьте этими словами на сообщение человека — и я спрошу его.");
  await h.onMessage(admin("Аи, пара", { reply: hers() }), KEY);
  assert.match(text(), /Со мной так не выйдет/u);
  await h.onMessage(admin("Аи, пара", { reply: { message_id: 1, from: { id: 77, first_name: "Робот", is_bot: true }, text: "бип" } }), KEY);
  assert.equal(text(), "С ботом связь не оформить.");
  await h.onMessage(masha("Аи, пары чата"), KEY);
  assert.match(text(), /пока никто ни с кем/u);

  const asked = await h.onMessage(admin("Аи, пара", { reply: from(MASHA, "Маша") }), KEY);
  assert.equal(asked.action, "bond_ask");
  assert.equal(text(), "💞 Вася предлагает <a href=\"tg://user?id=22\">Маше</a> стать парой.\nМаша, слово за вами — ответить можете только вы. Десять минут.");
  const keys = toChat(-10).at(-1).reply_markup.inline_keyboard[0].map(button => button.callback_data);
  assert.deepEqual(keys, [`r:y:${asked.id}`, `r:n:${asked.id}`]);
  // Пока нет ответа — связи нет.
  assert.deepEqual(JSON.parse(sdk().kv.get(BONDS_KEY(-10))).bonds, []);

  // Чужое нажатие ничего не решает; «Да» самого предложившего — тоже.
  const foreign = await press(h, keys[0], { id: PETYA, name: "Петя" });
  assert.equal(foreign.reason, "foreign_button");
  assert.equal(calls("answerCallbackQuery").at(-1).text, "Спрашивают не вас. Ответить может только тот, кому предложили: Маша.");
  assert.equal((await press(h, keys[0], { id: ADMIN, name: "Вася" })).reason, "foreign_button");
  assert.deepEqual(JSON.parse(sdk().kv.get(BONDS_KEY(-10))).bonds, []);

  const yes = await press(h, keys[0], { id: MASHA, name: "Маша" });
  assert.equal(yes.action, "bond");
  assert.deepEqual(calls("editMessageText").at(-1), { chat_id: -10, message_id: 900, text: "💞 Вася и Маша — теперь пара. Поздравляю.", parse_mode: "HTML" });
  // Второе нажатие — предложение уже не действует.
  assert.equal((await press(h, keys[0], { id: MASHA, name: "Маша" })).reason, "expired");

  await h.onMessage(petya("Аи, кто с кем?"), KEY);
  assert.equal(text(), "Кто с кем в этом чате:\n💞 Вася и Маша — пара");
  await h.onMessage(masha("Аи, моя пара"), KEY);
  assert.equal(text(), "Ваши связи в этом чате:\n💞 пара — Вася");
  // Третий к занятому не подойдёт; пара может пожениться и завести друзей.
  await h.onMessage(petya("Аи, пара", { reply: from(MASHA, "Маша") }), KEY);
  assert.equal(text(), "Не выйдет. Маша: пара уже есть — Вася.");
  await h.onMessage(admin("Аи, пара", { reply: from(MASHA, "Маша") }), KEY);
  assert.equal(text(), "Вы и Маша — уже пара.");
  const friends = await h.onMessage(petya("Аи, лучшие друзья", { reply: from(MASHA, "Маша") }), KEY);
  assert.equal(friends.action, "bond_ask");
  await press(h, `r:y:${friends.id}`, { id: MASHA, name: "Маша" });
  await h.onMessage(masha("Аи, моя пара"), KEY);
  assert.equal(text(), "Ваши связи в этом чате:\n💞 пара — Вася\n🤝 лучшие друзья — Петя");

  // Расстаться может любой из двоих, один, без согласия второго.
  const end = await h.onMessage(masha("Аи, расстаться"), KEY);
  assert.equal(end.action, "bond_end");
  assert.equal(text(), "💔 Маша и Вася — больше не пара.");
  await h.onMessage(masha("Аи, расстаться"), KEY);
  assert.equal(text(), "Такой связи у вас здесь нет.");
  assert.equal(chats().length, 0, "модель не тратится");
  // Ни очков, ни наград: в отношениях с ней и в её памяти о людях ничего не меняется.
  assert.ok(![...sdk().kv.keys()].some(key => /reward|score|rating|coins/iu.test(key)));
  assert.ok(SOUL_PREFIXES.some(prefix => BONDS_KEY(-10).startsWith(prefix)), "связи чата входят в копию души");
});

test("связи: «нет», отзыв, срок, несовершеннолетним — только дружба; в личке и чужой чат — мимо", async () => {
  let now = NOON;
  const h = start({ now: () => now });
  const first = await h.onMessage(admin("Аи, брак", { reply: from(MASHA, "Маша") }), KEY);
  assert.match(text(), /^💍 Вася предлагает .*Маше.* пожениться\./u);
  const no = await press(h, `r:n:${first.id}`, { id: MASHA, name: "Маша" });
  assert.equal(no.action, "bond_no");
  assert.equal(calls("editMessageText").at(-1).text, "💍 Маша говорит «нет». Вася, не в этот раз.");
  assert.deepEqual(JSON.parse(sdk().kv.get(BONDS_KEY(-10))).bonds, []);

  // Передумал сам — своим «Нет».
  const second = await h.onMessage(admin("Аи, семья", { reply: from(MASHA, "Маша") }), KEY);
  assert.equal((await press(h, `r:n:${second.id}`, { id: ADMIN, name: "Вася" })).action, "bond_withdrawn");
  assert.match(calls("editMessageText").at(-1).text, /Вася передумывает\. Предложение снято\./u);

  // Через десять минут предложение не действует.
  const third = await h.onMessage(admin("Аи, пара", { reply: from(MASHA, "Маша") }), KEY);
  now += 10 * 60_000 + 1;
  const late = await press(h, `r:y:${third.id}`, { id: MASHA, name: "Маша" });
  assert.equal(late.reason, "expired");
  assert.equal(calls("answerCallbackQuery").at(-1).text, "Это предложение уже не действует.");
  assert.deepEqual(JSON.parse(sdk().kv.get(BONDS_KEY(-10))).bonds, []);

  // Пока ждали ответа, человек успел стать парой с другим: согласие уже не проходит.
  const a = await h.onMessage(admin("Аи, пара", { reply: from(MASHA, "Маша") }), KEY);
  const b = await h.onMessage(petya("Аи, пара", { reply: from(MASHA, "Маша") }), KEY);
  await press(h, `r:y:${b.id}`, { id: MASHA, name: "Маша" });
  const stale = await press(h, `r:y:${a.id}`, { id: MASHA, name: "Маша" });
  assert.equal(stale.reason, "stale");
  assert.equal(JSON.parse(sdk().kv.get(BONDS_KEY(-10))).bonds.length, 1);

  // Тот, кто назвал возраст до восемнадцати: пары и браки — нет, дружба — да.
  await h.onMessage(message("мне 15 лет", { id: 31, name: "Оля" }), KEY);
  await h.onMessage(group("Аи, пара", { id: 31, name: "Оля", reply: from(40, "Игорь") }), KEY);
  assert.match(text(), /Пары и браки — для взрослых/u);
  await h.onMessage(group("Аи, брак", { id: 40, name: "Игорь", reply: from(31, "Оля") }), KEY);
  assert.match(text(), /Пары и браки — для взрослых/u);
  assert.equal((await h.onMessage(group("Аи, лучшие друзья", { id: 31, name: "Оля", reply: from(40, "Игорь") }), KEY)).action, "bond_ask");

  // В личке «пара» — обычное слово; слова ей самой уходят в словарь.
  sdk().fetchQueue.push(says("Пара чего?"));
  await h.onMessage(message("пара"), KEY);
  assert.equal(last(), "Пара чего?");
  const before = toChat(-10).length;
  await h.onMessage(admin("Аи, давай встречаться"), KEY);
  assert.ok(!toChat(-10).at(-1).reply_markup, "«давай встречаться» — не предложение соседу");
  assert.equal(toChat(-10).length, before + 1);
});
