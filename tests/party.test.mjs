/**
 * Игры с кнопками: вход в игру — собственным нажатием, ходы — нажатиями,
 * судит код. Telegram и сети нет — записывающий стаб.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, sdk, calls, toChat, last, reactions, chats, KEY } from "./fixtures/kit.mjs";

const { parseParty, boardResult, boardMove, PARTY_KEY } = await import("../tgcloud/lib/party.js");
const { TRUTHS, DARES, BOTTLE_FRIENDLY, BOTTLE_WARM } = await import("../tgcloud/lib/data/games.js");
const { ACTIONS } = await import("../tgcloud/lib/rp.js");

let serial = 0;
/** Нажатие кнопки `data` человеком `id` под сообщением `messageId`. */
const press = (h, data, { id = 21, name = "Вася", chat = -10, messageId } = {}) => h.onCallback({
  id: `cb${++serial}`, from: { id, first_name: name, is_bot: false }, data: `p:${data}`,
  message: { message_id: messageId, chat: { id: chat, type: chat < 0 ? "supergroup" : "private" } },
}, KEY);
const answers = () => calls("answerCallbackQuery");
const edits = () => calls("editMessageText");
const table = () => toChat(-10).at(-1);
const labels = (markup) => markup.inline_keyboard.map(row => row.map(item => item.text).join(" ")).join(" / ");
const datas = (markup) => markup.inline_keyboard.flat().map(item => item.callback_data);

test("разбор: игра с кнопками называется словами; обычная «камень, ножницы, бумага» остаётся её игрой", () => {
  assert.deepEqual(["крестики-нолики", "сыграем в крестики нолики", "давай в крокодила", "крокодил", "правда или действие", "бутылочка", "крутим бутылочку", "кнб вдвоём", "камень ножницы бумага на двоих"].map(parseParty),
    ["ttt", "ttt", "croc", "croc", "tod", "bottle", "bottle", "rps", "rps"]);
  for (const text of ["камень ножницы бумага", "крокодил гена", "правда", "бутылка воды", "сыграем", "расскажи про крокодила"]) assert.equal(parseParty(text), null, text);
});

test("данные игр: колоды не пустые, без повторов; бутылочка знает только существующие действия", () => {
  assert.ok(TRUTHS.length >= 30 && DARES.length >= 30);
  assert.equal(new Set(TRUTHS).size, TRUTHS.length);
  assert.equal(new Set(DARES).size, DARES.length);
  const keys = new Set(ACTIONS.map(item => item.key));
  for (const key of [...BOTTLE_FRIENDLY, ...BOTTLE_WARM]) assert.ok(keys.has(key), key);
  const kind = Object.fromEntries(ACTIONS.map(item => [item.key, item.kind]));
  assert.ok(BOTTLE_FRIENDLY.every(key => kind[key] !== "romantic" && kind[key] !== "rough"), "дружеская колода — без романтики и грубости");
  assert.ok(!BOTTLE_WARM.includes("kiss") && !BOTTLE_WARM.includes("kabedon") && !BOTTLE_WARM.includes("flirt"), "ничего смелее щеки");
});

test("крестики-нолики: судья видит ряд и ничью; она берёт победу и закрывает угрозу", () => {
  assert.equal(boardResult(["x", "x", "x", "", "o", "o", "", "", ""]), "x");
  assert.equal(boardResult(["x", "o", "x", "x", "o", "o", "o", "x", "x"]), "draw");
  assert.equal(boardResult(["x", "", "", "", "o", "", "", "", ""]), null);
  assert.equal(boardMove(["o", "o", "", "x", "x", "", "", "", ""], "o", () => 0.99), 2, "победа важнее защиты");
  assert.equal(boardMove(["x", "x", "", "", "o", "", "", "", ""], "o", () => 0), 2, "угрозу закрывает даже в «рассеянный» ход");
  // Без ошибок она не проигрывает: любой порядок ходов человека — не поражение.
  const play = (board, turn) => {
    const result = boardResult(board);
    if (result) return result !== "x";
    if (turn === "o") { const next = [...board]; next[boardMove(next, "o", () => 0.99)] = "o"; return play(next, "x"); }
    return board.every((cell, index) => { if (cell) return true; const next = [...board]; next[index] = "x"; return play(next, "o"); });
  };
  assert.equal(play(Array(9).fill(""), "x"), true);
});

test("крестики-нолики в группе: второй входит кнопкой, ходят по очереди, чужой не вмешивается", async () => {
  reset();
  const h = heart();
  const started = await h.onMessage(group("Аи, крестики-нолики", { id: 21, name: "Вася" }), KEY);
  assert.equal(started.action, "party");
  const id = started.messageId;
  assert.match(table().text, /Вася ждёт соперника/u);
  assert.equal(labels(table().reply_markup), "Играть / Сыграть с Аи");
  assert.equal(chats().length, 0, "игра идёт без модели");

  await press(h, "join", { id: 21, messageId: id });
  assert.match(answers().at(-1).text, /Вы уже в игре/u, "сам себе не соперник");
  await press(h, "ai", { id: 22, name: "Маша", messageId: id });
  assert.match(answers().at(-1).text, /тот, кто начал игру/u);
  await press(h, "join", { id: 22, name: "Маша", messageId: id });
  assert.equal(edits().at(-1).text, "❌ Вася — ⭕ Маша\nХодит: Вася ❌");
  assert.equal(edits().at(-1).parse_mode, "HTML");

  await press(h, "m:4", { id: 22, name: "Маша", messageId: id });
  assert.equal(answers().at(-1).text, "Сейчас ходит Вася.");
  await press(h, "m:4", { id: 23, name: "Петя", messageId: id });
  assert.match(answers().at(-1).text, /играют двое/u);
  const before = edits().length;
  for (const [who, cell] of [[21, 0], [22, 4], [21, 1], [22, 8]]) await press(h, `m:${cell}`, { id: who, name: who === 21 ? "Вася" : "Маша", messageId: id });
  assert.equal(edits().length, before + 4);
  await press(h, "m:4", { id: 21, messageId: id });
  assert.equal(answers().at(-1).text, "Эта клетка занята.");
  await press(h, "m:2", { id: 21, messageId: id });
  assert.equal(edits().at(-1).text, "❌ Вася — ⭕ Маша\n🏆 Победа: Вася ❌");
  assert.equal(labels(edits().at(-1).reply_markup), "❌ ❌ ❌ / ⬜ ⭕ ⬜ / ⬜ ⬜ ⭕ / Ещё раз");
  assert.ok(datas(edits().at(-1).reply_markup).slice(0, 9).every(data => data === "p:noop"), "законченная доска не принимает ходы");

  await press(h, "again", { id: 23, name: "Петя", messageId: id });
  assert.match(answers().at(-1).text, /те, кто играл/u);
  await press(h, "again", { id: 22, name: "Маша", messageId: id });
  assert.equal(edits().at(-1).text, "❌ Маша — ⭕ Вася\nХодит: Маша ❌", "стороны меняются");
  assert.equal(answers().length, serial, "на каждое нажатие есть ответ — «часики» не крутятся");
});

test("крестики-нолики с ней самой: в личке без ожидания, отвечает ходом", async () => {
  reset();
  const h = heart({}, { random: () => 0.99 });
  const started = await h.onMessage(message("крестики-нолики", { id: 5, name: "Вася" }), KEY);
  assert.equal(sdk().sent.at(-1).text, "❌ Вася — ⭕ Аи\nХодит: Вася ❌");
  await press(h, "m:0", { id: 5, chat: 5, messageId: started.messageId });
  const board = edits().at(-1).reply_markup.inline_keyboard.flat().map(item => item.text);
  assert.equal(board.filter(cell => cell === "❌").length, 1);
  assert.equal(board.filter(cell => cell === "⭕").length, 1, "её ход сделан сразу");
  assert.equal(board[4], "⭕", "на угол она отвечает центром");
  // В группе с ней играет тот, кто начал.
  const inGroup = await h.onMessage(group("Аи, сыграем в крестики-нолики", { id: 21, name: "Вася" }), KEY);
  await press(h, "ai", { id: 21, messageId: inGroup.messageId });
  assert.equal(edits().at(-1).text, "❌ Вася — ⭕ Аи\nХодит: Вася ❌");
});

test("камень, ножницы, бумага вдвоём: выбор скрыт до второго игрока", async () => {
  reset();
  const h = heart();
  const { messageId: id } = await h.onMessage(group("Аи, кнб вдвоём", { id: 21, name: "Вася" }), KEY);
  assert.equal(labels(table().reply_markup), "✊ ✌️ ✋");
  await press(h, "c:r", { id: 21, messageId: id });
  assert.equal(answers().at(-1).text, "Вы выбрали: камень. Ждём второго.");
  assert.match(edits().at(-1).text, /Вася уже в игре\. Кто второй\?/u);
  assert.doesNotMatch(edits().at(-1).text, /камень\b(?!, ножницы)/iu, "выбор первого не показан");
  const shown = edits().length;
  await press(h, "c:s", { id: 21, messageId: id });
  assert.equal(answers().at(-1).text, "Выбор изменён: ножницы. Ждём второго.");
  assert.equal(edits().length, shown, "смена выбора ничего не выдаёт чату");
  await press(h, "c:p", { id: 22, name: "Маша", messageId: id });
  assert.equal(edits().at(-1).text, "Вася ✌️ — ✋ Маша\n🏆 Вася: ножницы режут бумагу.");
  await press(h, "again", { id: 23, name: "Петя", messageId: id });
  assert.match(edits().at(-1).text, /Нужны двое/u);
  await press(h, "c:p", { id: 23, name: "Петя", messageId: id });
  await press(h, "c:p", { id: 22, name: "Маша", messageId: id });
  assert.equal(edits().at(-1).text, "Петя ✋ — ✋ Маша\nНичья.");
  // В личке вдвоём не сыграть: она предлагает себя.
  await h.onMessage(message("кнб вдвоём", { id: 5 }), KEY);
  assert.match(last(), /Здесь сыграю сама/u);
});

test("крокодил: слово видит только ведущий, отгадка — ответом на стол, новый ведущий — кто нажал", async () => {
  reset();
  const h = heart({}, { random: () => 0 });
  const { messageId: id } = await h.onMessage(group("Аи, крокодил", { id: 21, name: "Вася" }), KEY);
  assert.match(table().text, /Ведущий: Вася/u);
  const word = (await h.store.get(PARTY_KEY(-10, id))).word;
  assert.ok(word.length >= 5);
  assert.doesNotMatch(table().text, new RegExp(word, "u"), "слова в сообщении нет");

  await press(h, "word", { id: 22, name: "Маша", messageId: id });
  assert.match(answers().at(-1).text, /Слово видит только ведущий/u);
  await press(h, "word", { id: 21, messageId: id });
  assert.deepEqual({ text: answers().at(-1).text, alert: answers().at(-1).show_alert }, { text: `Ваше слово: ${word}`, alert: true });
  await press(h, "skip", { id: 22, name: "Маша", messageId: id });
  assert.match(answers().at(-1).text, /только ведущий/u);

  const stand = { message_id: id, from: { id: 999, is_bot: true, username: "ai_heart_bot" }, text: "стол" };
  const miss = await h.onMessage(group("может, табуретка?", { id: 22, name: "Маша", reply: stand }), KEY);
  assert.equal(miss.miss, true);
  assert.deepEqual(reactions(), ["🤔"]);
  const hint = await h.onMessage(group(`это не ${word}, честно`, { id: 21, name: "Вася", reply: stand }), KEY);
  assert.equal(hint.host, true, "ведущий отгадать не может");
  const before = toChat(-10).length;
  const won = await h.onMessage(group(`Это ${word.toUpperCase()}!`, { id: 22, name: "Маша", reply: stand }), KEY);
  assert.equal(won.won, true);
  assert.equal(edits().at(-1).text, `🐊 Маша угадывает: это «${word}».\n\nКто ведущий дальше? Нажавший и объясняет.`);
  assert.equal(toChat(-10).length, before, "стол правится на месте, без новых сообщений");
  assert.equal(chats().length, 0, "отгадки не уходят модели");

  await press(h, "host", { id: 23, name: "Петя", messageId: id });
  assert.match(edits().at(-1).text, /Ведущий: Петя/u);
  assert.match(answers().at(-1).text, /^Ваше слово: /u);
  assert.notEqual((await h.store.get(PARTY_KEY(-10, id))).word, word, "слово новое");
  await press(h, "stop", { id: 23, name: "Петя", messageId: id });
  assert.match(edits().at(-1).text, /Игра закончена\. Слово было «/u);
  assert.equal(await h.store.get(PARTY_KEY(-10, id)), null);
  await press(h, "word", { id: 23, name: "Петя", messageId: id });
  assert.match(answers().at(-1).text, /уже закончилась/u);
});

test("правда или действие: в игре только нажавшие; выбирает тот, чья очередь", async () => {
  reset();
  const h = heart({}, { random: () => 0 });
  const { messageId: id } = await h.onMessage(group("Аи, правда или действие", { id: 21, name: "Вася" }), KEY);
  assert.match(table().text, /В игре \(1\): Вася/u);
  await press(h, "go", { id: 21, messageId: id });
  assert.match(answers().at(-1).text, /хотя бы двое/u);
  await press(h, "go", { id: 22, name: "Маша", messageId: id });
  assert.match(answers().at(-1).text, /Сначала войдите в игру/u);
  await press(h, "join", { id: 22, name: "Маша", messageId: id });
  await press(h, "join", { id: 22, name: "Маша", messageId: id });
  assert.equal(answers().at(-1).text, "Вы уже в игре.");
  await press(h, "join", { id: 23, name: "<b>Петя</b>", messageId: id });
  assert.match(edits().at(-1).text, /В игре \(3\): Вася, Маша, b Петя b/u, "имя — данные: разметка в нём не работает");

  await press(h, "go", { id: 21, messageId: id });
  assert.match(edits().at(-1).text, /^🎭 Вася, правда или действие\?/u);
  await press(h, "t", { id: 22, name: "Маша", messageId: id });
  assert.equal(answers().at(-1).text, "Выбирает тот, чья очередь.");
  await press(h, "t", { id: 21, messageId: id });
  assert.equal(edits().at(-1).text.split("\n").slice(0, 2).join("\n"), `🎭 Вася — правда:\n<b>${TRUTHS[0]}</b>`);
  await press(h, "go", { id: 22, name: "Маша", messageId: id });
  assert.match(edits().at(-1).text, /^🎭 Маша, правда или действие\?/u, "дважды подряд одному не выпадает");
  await press(h, "d", { id: 22, name: "Маша", messageId: id });
  assert.match(edits().at(-1).text, new RegExp(`Маша — действие:\\n<b>${DARES[0].slice(0, 20)}`, "u"));

  // Вышел тот, чья очередь, — круг собирается заново; закончить может начавший.
  await press(h, "go", { id: 21, messageId: id });
  await press(h, "leave", { id: 21, messageId: id });
  assert.match(edits().at(-1).text, /В игре \(2\): Маша, b Петя b/u);
  await press(h, "stop", { id: 23, name: "Петя", messageId: id });
  assert.match(answers().at(-1).text, /Закончить может Маша/u, "ушёл начавший — стол ведёт следующий");
  await press(h, "stop", { id: 22, name: "Маша", messageId: id });
  assert.equal(edits().at(-1).text, "Игра закончена. Спасибо всем.");
  assert.deepEqual(edits().at(-1).reply_markup, { inline_keyboard: [] });
});

test("бутылочка: крутит и попадает только на тех, кто вошёл сам; младшим — только дружеское", async () => {
  reset();
  const h = heart({}, { random: () => 0.999 });
  const { messageId: id } = await h.onMessage(group("Аи, бутылочка", { id: 21, name: "Вася" }), KEY);
  await press(h, "spin", { id: 21, messageId: id });
  assert.match(answers().at(-1).text, /хотя бы двое/u);
  await press(h, "spin", { id: 24, name: "Чужой", messageId: id });
  assert.match(answers().at(-1).text, /Сначала войдите/u);
  await press(h, "join", { id: 22, name: "Маша", messageId: id });
  await press(h, "spin", { id: 21, messageId: id });
  // random → конец колоды: самое «тёплое» действие — свидание, не поцелуй.
  assert.match(edits().at(-1).text, /^🍾 Бутылочка крутится… и показывает на Машу!\n🌹 Вася зовёт на свидание Машу\n\nВ игре \(2\): Вася, Маша/u);

  // Маша говорит, что ей 15: тёплые действия из колоды уходят.
  await h.onMessage(message("мне 15 лет", { id: 22, name: "Маша" }), KEY);
  const warm = new Set(["чмокает", "берёт за руку", "зовёт на свидание"]);
  for (let i = 0; i < 12; i++) {
    await press(h, "spin", { id: 21, messageId: id });
    const line = edits().at(-1).text.split("\n")[1];
    assert.ok(![...warm].some(verb => line.includes(verb)), line);
  }
  await press(h, "leave", { id: 22, name: "Маша", messageId: id });
  assert.match(edits().at(-1).text, /^🍾 <b>Бутылочка<\/b>/u, "вышедший исчезает и со стола");
  await press(h, "leave", { id: 21, messageId: id });
  assert.equal(edits().at(-1).text, "Игра закончена: все вышли.");
});

test("кнопки: репетиция без побочных эффектов, чужие данные — молчаливый ответ, в личке — игра для компании", async () => {
  reset();
  const h = heart();
  assert.deepEqual(await h.onCallback({ id: "1", from: { id: 1 }, data: "noop" }, { testRun: true }), { ok: true, route: "none", side_effects: "none" });
  assert.equal(sdk().calls.length, 0);
  assert.equal((await h.onCallback({ id: "2", from: { id: 1 }, data: "что-то чужое" }, KEY)).ignored, true);
  assert.equal(answers().length, 1, "на незнакомую кнопку тоже отвечает");
  assert.equal((await h.onCallback({ id: "3", from: { id: 1 }, data: "p:join" }, KEY)).ignored, true, "нажатие без сообщения");
  await h.onMessage(message("крокодил", { id: 5 }), KEY);
  assert.match(last(), /игра для компании\. Позовите меня в группу/u);
  await h.onMessage(message("давай сыграем", { id: 5 }), KEY);
  assert.match(last(), /С кнопками: крестики-нолики, квиз, «угадай животное» \(угадываю я\), «загадай животное» \(угадываете вы\), приключение «Маяк»\. В группе их больше/u);
  await h.onMessage(group("Аи, давай сыграем", { id: 21 }), KEY);
  assert.match(table().text, /С кнопками, вдвоём и компанией: крестики-нолики, камень-ножницы-бумага вдвоём, крокодил, правда или действие, бутылочка, квиз, .*приключение «Маяк»\. Играет тот, кто сам нажал кнопку\./u);
});
