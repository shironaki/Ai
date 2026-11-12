/**
 * Игры с сюжетом на кнопках: квиз, «угадай животное» в обе стороны,
 * приключение; кнопка «Ещё» под обычным ответом. Судит код, модели нет.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, sdk, source, calls, toChat, last, reactions, chats, KEY } from "./fixtures/kit.mjs";

const { parseParty } = await import("../tgcloud/lib/party.js");
const { BEASTS, beastNamed, beastsLeft, bestTrait, MAX_ASK, HIDE_ASKS, QUIZ_ROUNDS } = await import("../tgcloud/lib/tables.js");
const { QUIZ } = await import("../tgcloud/lib/data/quiz.js");
const { TRAITS, ANIMALS } = await import("../tgcloud/lib/data/animals.js");
const { QUESTS } = await import("../tgcloud/lib/data/quest.js");

let serial = 0;
const press = (h, data, { id = 21, name = "Вася", chat = -10, messageId, prefix = "p:" } = {}) => h.onCallback({
  id: `cb${++serial}`, from: { id, first_name: name, is_bot: false }, data: `${prefix}${data}`,
  message: { message_id: messageId, chat: { id: chat, type: chat < 0 ? "supergroup" : "private" } },
}, KEY);
const answers = () => calls("answerCallbackQuery");
const edits = () => calls("editMessageText");
const buttons = (markup) => markup.inline_keyboard.flat();
const labels = (markup) => markup.inline_keyboard.map(row => row.map(item => item.text).join(" | ")).join(" / ");
const dataOf = (markup, text) => buttons(markup).find(item => item.text === text)?.callback_data.slice(2);
/** Вопрос, который сейчас на столе: строка из набора. */
const asked = (text) => QUIZ.find(row => text.includes(`<b>${row[0]}</b>`));

test("разбор: новые игры называются словами и не путаются со старыми", () => {
  const cases = {
    quiz: ["квиз", "давай квиз", "сыграем в квиз", "вопросы на эрудицию"],
    akin: ["угадай животное", "отгадай кого я загадал", "акинатор", "20 вопросов", "поиграем в данетки"],
    hide: ["загадай животное", "загадай мне животное", "я угадаю животное"],
    quest: ["приключение", "давай приключение", "текстовое приключение", "текстовый квест"],
  };
  for (const [kind, phrases] of Object.entries(cases)) for (const phrase of phrases) assert.equal(parseParty(phrase), kind, phrase);
  for (const phrase of ["квесты", "викторина", "загадай число", "загадай загадку", "угадай моё число", "расскажи про приключение", "животное"]) assert.equal(parseParty(phrase), null, phrase);
});

test("данные квиза: вопросов хватает, ответы различны, кнопки не слишком длинные", () => {
  assert.ok(QUIZ.length >= 80, `вопросов ${QUIZ.length}`);
  assert.equal(new Set(QUIZ.map(row => row[0])).size, QUIZ.length, "вопросы не повторяются");
  for (const row of QUIZ) {
    assert.equal(row.length, 5, row[0]);
    assert.equal(new Set(row.slice(1)).size, 4, `варианты различны: ${row[0]}`);
    assert.ok(row[0].endsWith("?") && row[0].length <= 90, row[0]);
    for (const option of row.slice(1)) assert.ok(option.length >= 1 && option.length <= 28, `${row[0]} → ${option}`);
  }
});

test("данные животных: у каждого свой набор признаков, имя узнаётся, а «летучая мышь» — не «мышь»", () => {
  const keys = new Set(TRAITS.map(item => item[0]));
  assert.equal(keys.size, TRAITS.length);
  assert.ok(ANIMALS.length >= 45);
  const seen = new Map();
  for (const [emoji, name, traits] of ANIMALS) {
    assert.ok(emoji && name, name);
    for (const trait of traits.split(" ")) assert.ok(keys.has(trait), `${name}: ${trait}`);
    const signature = [...traits.split(" ")].sort().join(" ");
    assert.equal(seen.get(signature), undefined, `${name} не отличить от ${seen.get(signature)}`);
    seen.set(signature, name);
  }
  BEASTS.forEach((beast, index) => {
    assert.equal(beastNamed(`это ${beast.name}!`), index, beast.name);
    for (const form of beast.forms) assert.equal(beastNamed(`может, ${form}?`), index, form);
  });
  assert.equal(BEASTS[beastNamed("Летучая мышь")].name, "летучая мышь");
  assert.equal(BEASTS[beastNamed("мышь")].name, "мышь");
  assert.equal(BEASTS[beastNamed("Это ОРЁЛ")].name, "орёл");
  assert.equal(beastNamed("не знаю"), null);
  assert.equal(beastNamed("котлета"), null, "слово целиком, а не его начало");
});

test("угадывание: на честные ответы она называет любое животное с первой попытки и укладывается в вопросы", () => {
  let worst = 0;
  BEASTS.forEach((beast, index) => {
    const answered = [];
    for (;;) {
      const pool = beastsLeft(answered);
      const trait = pool.length > 1 && answered.length < MAX_ASK ? bestTrait(pool, answered) : -1;
      if (trait < 0) { assert.deepEqual(pool, [index], `${beast.name}: осталось ${pool.map(item => BEASTS[item].name)}`); break; }
      answered.push([trait, beast.has.has(TRAITS[trait][0]) ? "y" : "n"]);
    }
    worst = Math.max(worst, answered.length);
  });
  assert.ok(worst <= 9, `самая долгая игра — ${worst} вопросов`);
  // Одна ошибка в ответах не убирает загаданное из числа возможных.
  const cat = BEASTS.findIndex(beast => beast.name === "кошка");
  const wrong = TRAITS.map((trait, index) => [index, BEASTS[cat].has.has(trait[0]) ? "y" : "n"]);
  wrong[0][1] = wrong[0][1] === "y" ? "n" : "y";
  assert.ok(beastsLeft(wrong).includes(cat));
  // «Не знаю» ничего не отсекает; названные — больше не кандидаты.
  assert.equal(beastsLeft([[0, "u"]]).length, BEASTS.length);
  assert.ok(!beastsLeft([], [cat]).includes(cat));
});

test("приключение: из любого положения есть кнопка и путь к концовке; обе победы достижимы", () => {
  for (const [key, story] of Object.entries(QUESTS)) {
    const nodes = story.nodes;
    assert.ok(nodes[story.start], key);
    for (const [id, node] of Object.entries(nodes)) {
      assert.ok(node.text.length <= 700, `${id}: текст ${node.text.length}`);
      if (node.end) { assert.ok(["win", "lose"].includes(node.end) && !node.to, id); continue; }
      for (const [label, target, rule = {}] of node.to) {
        assert.ok(label.length <= 32, `${id}: «${label}»`);
        assert.ok(nodes[target], `${id} → ${target}`);
        for (const item of [rule.need, rule.lack, rule.give].filter(Boolean)) assert.ok(story.items[item], `${id}: предмет ${item}`);
      }
    }
    const visible = (node, bag) => node.to.filter(([, , rule = {}]) => (!rule.need || bag.includes(rule.need)) && (!rule.lack || !bag.includes(rule.lack)));
    const state = (id, bag) => `${id}|${[...bag].sort().join(",")}`;
    const next = new Map();
    const queue = [[story.start, []]];
    const seen = new Set([state(story.start, [])]);
    while (queue.length) {
      const [id, bag] = queue.shift();
      const node = nodes[id];
      if (node.end) continue;
      const moves = visible(node, bag);
      assert.ok(moves.length >= 1, `${state(id, bag)}: нет кнопок`);
      const reached = moves.map(([, target, rule = {}]) => [target, rule.give && !bag.includes(rule.give) ? [...bag, rule.give] : bag]);
      next.set(state(id, bag), reached.map(([target, bagNext]) => state(target, bagNext)));
      for (const [target, bagNext] of reached) if (!seen.has(state(target, bagNext))) { seen.add(state(target, bagNext)); queue.push([target, bagNext]); }
    }
    // От концовок назад: положения, из которых до конца не дойти, — тупики.
    const ends = new Set([...seen].filter(item => nodes[item.split("|")[0]].end));
    const alive = new Set(ends);
    for (let grew = true; grew;) {
      grew = false;
      for (const [from, targets] of next) if (!alive.has(from) && targets.some(item => alive.has(item))) { alive.add(from); grew = true; }
    }
    assert.deepEqual([...seen].filter(item => !alive.has(item)), [], "тупики");
    assert.deepEqual([...new Set([...ends].map(item => item.split("|")[0]))].sort(), Object.keys(nodes).filter(id => nodes[id].end).sort(), "все концовки достижимы");
    assert.deepEqual([...new Set([...seen].map(item => item.split("|")[0]))].sort(), Object.keys(nodes).sort(), "все узлы достижимы");
  }
});

test("квиз в группе: отвечает каждый по разу, первый верный закрывает вопрос, в конце — счёт стола без наград", async () => {
  reset();
  const h = heart();
  const started = await h.onMessage(group("Аи, квиз", { id: 21, name: "Вася" }), KEY);
  assert.equal(started.kind, "quiz");
  const id = started.messageId;
  let table = toChat(-10).at(-1);
  assert.match(table.text, /^🧠 <b>Квиз<\/b> · вопрос 1 из 7\n<b>.+\?<\/b>\n\nОтвечает каждый, по одному разу/u);
  assert.equal(table.reply_markup.inline_keyboard.length, 5);
  assert.equal(labels({ inline_keyboard: table.reply_markup.inline_keyboard.slice(4) }), "Пропустить | Закончить");
  // Верный ответ по данным кнопки не вычислить: в них место на столе, а не номер варианта.
  assert.deepEqual(buttons(table.reply_markup).slice(0, 4).map(item => item.callback_data), ["p:a:0", "p:a:1", "p:a:2", "p:a:3"]);
  assert.equal(chats().length, 0);

  let row = asked(table.text);
  const wrong = dataOf(table.reply_markup, row[2]);
  await press(h, wrong, { id: 22, name: "Маша", messageId: id });
  assert.match(answers().at(-1).text, /Мимо\. Второй попытки/u);
  const quietEdits = edits().length;
  await press(h, dataOf(table.reply_markup, row[1]), { id: 22, name: "Маша", messageId: id });
  assert.equal(answers().at(-1).text, "На этот вопрос вы уже ответили.");
  assert.equal(edits().length, quietEdits, "промах стол не перерисовывает");
  await press(h, "next", { id: 22, name: "Маша", messageId: id });
  assert.match(answers().at(-1).text, /Пропустить вопрос может Вася/u);
  await press(h, dataOf(table.reply_markup, row[1]), { id: 23, name: "Петя", messageId: id });
  assert.equal(answers().at(-1).text, "Верно!");
  assert.match(edits().at(-1).text, new RegExp(`✅ ${row[1].replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\nПервый верный ответ: Петя\\.$`, "u"));
  assert.equal(labels(edits().at(-1).reply_markup), "Дальше");
  await press(h, wrong, { id: 21, messageId: id });
  assert.equal(answers().at(-1).text, "Вопрос уже закрыт.");

  // Остальные шесть: Вася отвечает верно на все; один вопрос пропускает ведущий.
  for (let round = 2; round <= QUIZ_ROUNDS; round++) {
    await press(h, "next", { id: 22, name: "Маша", messageId: id });
    table = edits().at(-1);
    assert.match(table.text, new RegExp(`вопрос ${round} из 7`, "u"));
    row = asked(table.text);
    if (round === 3) { await press(h, "next", { id: 21, messageId: id }); assert.match(edits().at(-1).text, /Верного ответа никто не дал\.$/u); continue; }
    await press(h, dataOf(table.reply_markup, row[1]), { id: 21, messageId: id });
  }
  assert.equal(labels(edits().at(-1).reply_markup), "Итоги");
  await press(h, "next", { id: 23, name: "Петя", messageId: id });
  assert.equal(edits().at(-1).text, "🧠 <b>Квиз окончен</b>\n1. Вася — 5\n2. Петя — 1\n\nОчки — только за этим столом: наград и рейтинга здесь нет.");
  await press(h, "again", { id: 23, name: "Петя", messageId: id });
  assert.match(edits().at(-1).text, /вопрос 1 из 7/u);
  await press(h, "stop", { id: 23, name: "Петя", messageId: id });
  assert.match(answers().at(-1).text, /Закончить может Вася/u);
  await press(h, "stop", { id: 21, messageId: id });
  assert.match(edits().at(-1).text, /Очков никто не набрал/u);
});

test("квиз в личке: один игрок, промах закрывает вопрос и показывает верный ответ", async () => {
  reset();
  const h = heart();
  const started = await h.onMessage(message("давай квиз"), KEY);
  const id = started.messageId;
  let table = toChat(5).at(-1);
  assert.equal(table.reply_markup.inline_keyboard.length, 4, "в личке некого ждать и некому пропускать");
  let row = asked(table.text);
  await press(h, dataOf(table.reply_markup, row[3]), { id: 5, chat: 5, messageId: id });
  assert.match(edits().at(-1).text, new RegExp(`✅ ${row[1].replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\nМимо\\.$`, "u"));
  for (let round = 2; round <= QUIZ_ROUNDS; round++) {
    await press(h, "next", { id: 5, chat: 5, messageId: id });
    table = edits().at(-1);
    row = asked(table.text);
    await press(h, dataOf(table.reply_markup, row[1]), { id: 5, chat: 5, messageId: id });
    assert.match(edits().at(-1).text, /\nВерно!$/u);
  }
  await press(h, "next", { id: 5, chat: 5, messageId: id });
  assert.match(edits().at(-1).text, /Верных ответов: 6 из 7\./u);
});

test("она угадывает животное: спрашивает кнопками, отвечает только загадавший, называет верно", async () => {
  reset();
  const h = heart();
  const started = await h.onMessage(group("Аи, угадай животное", { id: 21, name: "Вася" }), KEY);
  assert.equal(started.kind, "akin");
  const id = started.messageId;
  let table = toChat(-10).at(-1);
  assert.match(table.text, /Вася загадывает животное, я спрашиваю/u);
  assert.equal(labels(table.reply_markup), "Да | Нет / Не знаю");
  await press(h, "y", { id: 22, name: "Маша", messageId: id });
  assert.match(answers().at(-1).text, /Отвечает Вася — кто начал игру/u);

  const penguin = BEASTS.find(beast => beast.name === "пингвин");
  let turns = 0;
  for (; turns < 20; turns++) {
    const found = TRAITS.find(trait => table.text.includes(`<b>${trait[1]}</b>`));
    if (!found) break;
    await press(h, penguin.has.has(found[0]) ? "y" : "n", { id: 21, messageId: id });
    table = edits().at(-1);
  }
  assert.ok(turns >= 3 && turns <= MAX_ASK, `вопросов: ${turns}`);
  assert.match(table.text, /Это <b>🐧 пингвин<\/b>\?$/u);
  assert.equal(labels(table.reply_markup), "Да, угадала | Нет");
  await press(h, "y", { id: 21, messageId: id });
  assert.match(edits().at(-1).text, /🐧 Это пингвин! Угадала за \d+ вопрос/u);
  assert.equal(chats().length, 0, "без модели");

  // «Нет» на каждое имя — она пробует трижды и сдаётся.
  await press(h, "again", { id: 21, messageId: id });
  table = edits().at(-1);
  for (let step = 0; step < 60 && !/Сдаюсь/u.test(table.text); step++) {
    await press(h, /Это <b>/u.test(table.text) ? "n" : "u", { id: 21, messageId: id });
    table = edits().at(-1);
  }
  assert.match(table.text, /Сдаюсь: такого животного я не знаю — или мы где-то запутались в ответах\. Победа за Вася\./u);
});

test("она загадала животное: вопросы — кнопками, отгадка — ответом на стол; чужое слово — не отгадка", async () => {
  reset();
  // Случайность по нулям: загадана первая в списке — кошка.
  const h = heart({}, { random: () => 0 });
  const started = await h.onMessage(message("загадай животное"), KEY);
  assert.equal(started.kind, "hide");
  const id = started.messageId;
  const table = toChat(5).at(-1);
  assert.match(table.text, /Я загадала животное\. Спрашивайте кнопками — отвечу «да» или «нет»; вопросов осталось: 8\.\nОтгадка — ответом на это сообщение\.$/u);
  assert.equal(buttons(table.reply_markup).length, TRAITS.length + 1);
  await press(h, "q:0", { id: 5, chat: 5, messageId: id });
  assert.equal(answers().at(-1).text, "Да.");
  await press(h, "q:1", { id: 5, chat: 5, messageId: id });
  assert.equal(answers().at(-1).text, "Нет.");
  assert.match(edits().at(-1).text, /вопросов осталось: 6\.[\s\S]*— Млекопитающее\? Да\.\n— Птица\? Нет\.$/u);
  assert.equal(buttons(edits().at(-1).reply_markup).length, TRAITS.length - 2 + 1, "заданный вопрос с кнопок уходит");

  const tableMessage = { message_id: id, from: { id: 999, is_bot: true, username: "ai_heart_bot" }, text: "стол" };
  await h.onMessage(message("а подсказку?", { reply: tableMessage }), KEY);
  assert.equal(reactions().at(-1), "🤔");
  await h.onMessage(message("это собака?", { reply: tableMessage }), KEY);
  assert.equal(reactions().at(-1), "🤔");
  assert.match(edits().at(-1).text, /— Это собака\? Нет\.$/u);
  const won = await h.onMessage(message("Кошка!", { reply: tableMessage }), KEY);
  assert.equal(won.won, true);
  assert.match(edits().at(-1).text, /Верно, Тест: это 🐱 кошка!$/u);
  assert.equal(chats().length, 0);

  // Вопросы кончаются; три промаха — и она открывает загаданное.
  await press(h, "again", { id: 5, chat: 5, messageId: id });
  for (let trait = 0; trait < HIDE_ASKS; trait++) await press(h, `q:${trait}`, { id: 5, chat: 5, messageId: id });
  assert.match(edits().at(-1).text, /Вопросы кончились — пора называть\./u);
  assert.equal(labels(edits().at(-1).reply_markup), "Сдаюсь");
  for (const guess of ["волк", "лиса", "тигр"]) await h.onMessage(message(guess, { reply: tableMessage }), KEY);
  assert.match(edits().at(-1).text, /Это было: 🐱 кошка\.$/u);
});

test("приключение: путь через сарай и пещеру ведёт к лучшей концовке; ведёт историю тот, кто её начал", async () => {
  reset();
  const h = heart();
  const started = await h.onMessage(group("Аи, приключение", { id: 21, name: "Вася" }), KEY);
  assert.equal(started.kind, "quest");
  const id = started.messageId;
  let table = toChat(-10).at(-1);
  assert.match(table.text, /^📖 <b>Маяк<\/b>\n\nКатер высаживает вас/u);
  assert.equal(labels(table.reply_markup), "К маяку / Заглянуть в сарай / Ждать катер у причала");
  await press(h, "g:0", { id: 22, name: "Маша", messageId: id });
  assert.match(answers().at(-1).text, /Историю ведёт Вася/u);
  const go = async (label) => {
    const data = dataOf(table.reply_markup, label);
    assert.ok(data, `нет кнопки «${label}»: ${labels(table.reply_markup)}`);
    await press(h, data, { id: 21, messageId: id });
    table = edits().at(-1);
  };
  await go("Заглянуть в сарай");
  await go("Снять с гвоздя фонарь");
  assert.match(table.text, /Фонарь у вас\. Масла в нём хватит на всю ночь\.\n\nВ сарае пахнет солью[\s\S]*\n\n🎒 фонарь$/u);
  assert.equal(labels(table.reply_markup), "Заглянуть под ящик / К маяку", "взятое второй раз не предлагается");
  await go("Заглянуть под ящик");
  assert.match(table.text, /🎒 фонарь, ключ$/u);
  await go("К маяку");
  await go("Обойти башню по тропинке");
  assert.equal(labels(table.reply_markup), "В лаз — с фонарём / Вернуться к двери");
  await go("В лаз — с фонарём");
  await go("Погладить кота");
  await go("Подняться по ступеням");
  await go("Наверх");
  await go("Подняться по лестнице");
  assert.equal(labels(table.reply_markup), "Открыть дверь ключом / Разбить стекло табуретом");
  await go("Открыть дверь ключом");
  await go("Чинить вместе");
  await go("Дождаться рассвета");
  assert.match(table.text, /🏆 Лучший конец: маяк зажжён, и Боцман вас одобрил\.$/u);
  assert.equal(labels(table.reply_markup), "Сначала");
  // Старая кнопка под концовкой ничего не ломает; «Сначала» возвращает к причалу.
  await press(h, "g:0", { id: 21, messageId: id });
  await go("Сначала");
  assert.match(table.text, /Катер высаживает вас/u);
  await go("К маяку");
  await go("Обойти башню по тропинке");
  await go("В лаз — на ощупь");
  assert.match(table.text, /🌙 Конец: без света в скалу лучше не соваться\.$/u);
  assert.equal(chats().length, 0);
});

test("кнопка «Ещё»: под вопросом дня и под картинкой зверя — то же самое ещё раз, без слов и не слишком часто", async () => {
  reset();
  let at = Date.UTC(2026, 10, 13, 9, 0);
  const h = heart({}, { now: () => at });
  await h.onMessage(group("Аи, вопрос дня"), KEY);
  const first = toChat(-10).at(-1);
  assert.match(first.text, /^💬 Вопрос дня:\n/u);
  assert.deepEqual(first.reply_markup, { inline_keyboard: [[{ text: "Ещё вопрос", callback_data: "a:q" }]] });
  await press(h, "q", { messageId: 1, prefix: "a:" });
  const second = toChat(-10).at(-1);
  assert.match(second.text, /^💬 Ещё вопрос:\n/u);
  assert.notEqual(second.text.split("\n")[1], first.text.split("\n")[1]);
  assert.deepEqual(second.reply_markup, first.reply_markup);
  assert.equal(answers().at(-1).text, undefined);
  // Сразу следом — не так быстро.
  const count = toChat(-10).length;
  await press(h, "q", { messageId: 1, prefix: "a:" });
  assert.equal(answers().at(-1).text, "Не так быстро.");
  assert.equal(toChat(-10).length, count);

  at += 5000;
  source("thecatapi.com", [{ url: "https://cdn.example/cat2.jpg" }]);
  await press(h, "an:cat", { messageId: 1, prefix: "a:" });
  assert.deepEqual(calls("sendPhoto").at(-1), { chat_id: -10, photo: "https://cdn.example/cat2.jpg", reply_markup: { inline_keyboard: [[{ text: "Ещё", callback_data: "a:an:cat" }]] } });
  at += 5000;
  await press(h, "an:dragon", { messageId: 1, prefix: "a:" });
  assert.equal(calls("sendPhoto").length, 1, "незнакомая кнопка ничего не шлёт");

  // Её попросили помолчать — кнопка молчит тоже.
  sdk().apiReplies.getChatMember = { status: "administrator" };
  await h.onMessage(group("Аи, помолчи час"), KEY);
  at += 5000;
  await press(h, "q", { messageId: 1, prefix: "a:" });
  assert.equal(answers().at(-1).text, "Меня попросили помолчать.");
  // Репетиция ничего не трогает.
  assert.deepEqual(await h.onCallback({ id: "x", from: { id: 1 }, data: "a:q" }, { testRun: true }), { ok: true, route: "again", side_effects: "none" });
});
