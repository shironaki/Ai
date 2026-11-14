/**
 * Анкета «любимое»: человек говорит, что любит, — она помнит и отвечает об
 * этом сама, без модели; спрашивает по анкете и встречным «а ваш?».
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, chats, says, sdk, request, KEY } from "./fixtures/kit.mjs";

const { parseTaste, readAnswer, readCasual, TASTES, TASTE_KEY, TASTE_ASK_KEY, TASTE_ASK_TTL_MS, TASTE_CASUAL_TTL_MS } = await import("../tgcloud/lib/tastes.js");
const { SOUL_PREFIXES } = await import("../tgcloud/lib/soul.js");
const { createPhrasebook } = await import("../tgcloud/lib/phrasebook.js");

const NOON = Date.parse("2026-11-18T09:00:00Z");
const saved = (id = 5) => JSON.parse(sdk().kv.get(TASTE_KEY(id)) ?? "null")?.items ?? {};
/** Всё, что ушло модели: система, память о человеке, история. */
const context = () => request().messages.map(item => item.content).join("\n");

test("разбор: рассказать, спросить о своём, список, анкета, забыть; слова о ней самой — не сюда", () => {
  const cases = {
    "мой любимый цвет — синий": { set: "color", value: "синий" },
    "Мой любимый цвет синий.": { set: "color", value: "синий" },
    "моя любимая еда это Пицца «Маргарита»": { set: "food", value: "Пицца «Маргарита»" },
    "моё любимое время года — осень": { set: "season", value: "осень" },
    "любимое аниме у меня — Атака титанов": { set: "anime", value: "Атака титанов" },
    "запомни, мой любимый фильм: Интерстеллар": { set: "film", value: "Интерстеллар" },
    "мои любимые цветы пионы": { set: "flower", value: "пионы" },
    "моя любимая группа — Кино": { set: "music", value: "Кино" },
    "мой любимый персонаж — Леви Аккерман": { set: "hero", value: "Леви Аккерман" },
    "какой мой любимый цвет?": { get: "color" }, "какой у меня любимый цвет": { get: "color" }, "мой любимый цвет какой?": { get: "color" },
    "ты помнишь, какое моё любимое аниме?": { get: "anime" }, "любимая игра у меня": { get: "game" },
    "что я люблю?": { list: true }, "моя анкета": { list: true }, "что мне нравится": { list: true },
    "анкета": { start: true }, "давай анкету": { start: true }, "спроси меня о любимом": { start: true }, "узнай меня получше": { start: true },
    "забудь мой любимый цвет": { drop: "color" }, "забудь мою любимую еду": { drop: "food" }, "забудь анкету": { clear: true },
  };
  for (const [said, want] of Object.entries(cases)) assert.deepEqual(parseTaste(said), want, said);
  for (const said of ["какой твой любимый цвет?", "твой любимый цвет", "любимый цвет", "мой любимый человек — ты", "мой любимый цвет", "я люблю пиццу", "мой любимый день — пятница", "мой любимый цвет — это какой?", "мой любимый сайт — https://example.com", "привет"]) assert.equal(parseTaste(said), null, said);

  assert.deepEqual(readAnswer("Зелёный"), { value: "Зелёный" });
  assert.deepEqual(readAnswer("Тёмно-синий, почти чёрный."), { value: "Тёмно-синий, почти чёрный" });
  assert.deepEqual(readAnswer("хватит"), { stop: true });
  for (const said of ["не знаю", "дальше", "нет", "пропусти"]) assert.deepEqual(readAnswer(said), { skip: true }, said);
  for (const said of ["спасибо", "ок", "а твой?", "круто", "я тоже", "/start", "это очень длинная речь о том как я провёл лето у бабушки в деревне"]) assert.equal(readAnswer(said), null, said);
  // Встречный вопрос строже: длинное и «тоже синий» — не ответ.
  assert.deepEqual(readCasual("Зелёный"), { value: "Зелёный" });
  assert.deepEqual(readCasual("Тёмно-синий, почти чёрный"), { value: "Тёмно-синий, почти чёрный" });
  for (const said of ["тоже синий", "хватит", "не знаю", "мне все цвета одинаковы", "привет, реши уравнение x+2=5", "реши x+2=5", "круто, мне нравится"]) assert.equal(readCasual(said), null, said);

  // У каждого вида — своя тема словаря о её вкусе или хотя бы название для списка.
  assert.equal(new Set(TASTES.map(item => item.key)).size, TASTES.length);
  assert.ok(SOUL_PREFIXES.includes("heart:tastes:"), "анкета уходит в копию души");
  assert.ok(!SOUL_PREFIXES.some(prefix => TASTE_ASK_KEY(1, 2).startsWith(prefix)), "а вопрос, на который ждёт ответа, — нет");
});

test("рассказал — помнит и отвечает сама: без модели, с поправкой и со списком; забыть — словом", async () => {
  reset();
  const h = heart({}, { now: () => NOON });
  await h.onMessage(message("мой любимый цвет — синий"), KEY);
  assert.equal(last(), "Запомнила: ваш любимый цвет — синий.");
  await h.onMessage(message("какой мой любимый цвет?"), KEY);
  assert.equal(last(), "Ваш любимый цвет — синий.");
  await h.onMessage(message("Мой любимый цвет — Синий"), KEY);
  assert.equal(last(), "Помню: ваш любимый цвет — Синий.");
  await h.onMessage(message("мой любимый цвет — зелёный"), KEY);
  assert.equal(last(), "Запомнила: ваш любимый цвет теперь — зелёный. Раньше было «Синий».");
  await h.onMessage(message("моя любимая еда — пельмени"), KEY);
  assert.equal(last(), "Запомнила: ваша любимая еда — пельмени.");
  await h.onMessage(message("моё любимое аниме — Наруто"), KEY);
  assert.equal(last(), "Запомнила: ваше любимое аниме — Наруто.");
  await h.onMessage(message("мои любимые цветы — пионы"), KEY);
  assert.equal(last(), "Запомнила: ваши любимые цветы — пионы.");

  await h.onMessage(message("что я люблю?"), KEY);
  assert.equal(last(), `Что я знаю о вашем любимом:\n• цвет — зелёный\n• еда — пельмени\n• аниме — Наруто\n• цветы — пионы\n\nЕщё не знаю: ${TASTES.length - 4}. Продолжить — «анкета».`);
  await h.onMessage(message("какая у меня любимая книга?"), KEY);
  assert.equal(last(), "Этого вы мне ещё не говорили. Скажите: «моя любимая книга — …» — и я запомню.");

  await h.onMessage(message("забудь мой любимый цвет"), KEY);
  assert.equal(last(), "Забыла: ваш любимый цвет.");
  await h.onMessage(message("забудь мой любимый цвет"), KEY);
  assert.equal(last(), "Этого я и не знала.");
  assert.deepEqual(Object.keys(saved()).sort(), ["anime", "flower", "food"]);
  await h.onMessage(message("забудь анкету"), KEY);
  assert.match(last(), /^Анкета чистая/u);
  assert.deepEqual(saved(), {});
  await h.onMessage(message("что я люблю?"), KEY);
  assert.match(last(), /^Пока ничего: о любимом вы мне не рассказывали\. Скажите «анкета»/u);
  assert.equal(chats().length, 0, "модель не тратилась ни разу");
});

test("анкета: спрашивает по очереди, «дальше» пропускает, «хватит» заканчивает; просьба посреди анкеты — просьба", async () => {
  reset();
  let now = NOON;
  const h = heart({}, { now: () => now });
  await h.onMessage(message("анкета"), KEY);
  assert.equal(last(), "Давайте. Я спрашиваю — вы отвечаете парой слов. «Дальше» — пропустить вопрос, «хватит» — закончить.\n\nКакой у вас любимый цвет?");
  await h.onMessage(message("Синий"), KEY);
  assert.equal(last(), "Запомнила: ваш любимый цвет — Синий. Что вы любите есть больше всего?");
  // Счёт посреди анкеты — счёт: вопрос остаётся ждать.
  await h.onMessage(message("сколько будет 2+2"), KEY);
  assert.match(last(), /4/u);
  assert.equal(saved().food, undefined);
  await h.onMessage(message("дальше"), KEY);
  assert.equal(last(), "Пропустим. А пить — чай, кофе, что-то ещё?");
  await h.onMessage(message("Зелёный чай с жасмином."), KEY);
  assert.equal(last(), "Запомнила: ваш любимый напиток — Зелёный чай с жасмином. Какую музыку вы слушаете чаще всего?");
  await h.onMessage(message("хватит"), KEY);
  assert.equal(last(), "Хорошо, остановимся. Продолжить — «анкета».");
  assert.deepEqual(Object.keys(saved()).sort(), ["color", "drink"]);
  assert.equal(chats().length, 0);

  // Анкета закончена — короткое слово снова обычная реплика.
  sdk().fetchQueue.push(says("Это уже разговор."));
  await h.onMessage(message("Рок-н-ролл"), KEY);
  assert.equal(last(), "Это уже разговор.");
  assert.equal(saved().music, undefined);

  // Продолжение начинается с первого, чего она не знает: пропущенная еда спрашивается снова.
  await h.onMessage(message("давай анкету"), KEY);
  assert.match(last(), /\n\nЧто вы любите есть больше всего\?$/u);
  // Ответа не было десять минут — слово уже о другом.
  now += TASTE_ASK_TTL_MS + 1000;
  sdk().fetchQueue.push(says("О чём вы?"));
  await h.onMessage(message("Пельмени"), KEY);
  assert.equal(last(), "О чём вы?");
  assert.equal(saved().food, undefined);
});

test("анкета до конца: все вопросы, в конце — «на этом всё»; повторная анкета — «заполнена»", async () => {
  reset();
  const h = heart({}, { now: () => NOON });
  await h.onMessage(message("анкета"), KEY);
  for (let index = 0; index < TASTES.length; index += 1) {
    assert.ok(last().endsWith(TASTES[index].ask.vy), `${index}: ${last()}`);
    await h.onMessage(message(`ответ ${index + 1}`), KEY);
  }
  assert.match(last(), /На этом вопросы кончились\. Посмотреть — «что я люблю»\.$/u);
  assert.equal(Object.keys(saved()).length, TASTES.length);
  await h.onMessage(message("анкета"), KEY);
  assert.match(last(), /^Анкета заполнена/u);
  assert.equal(chats().length, 0);
});

test("у сказанного есть место: названное в личке в группе не звучит и модели там не даётся", async () => {
  reset();
  const h = heart({}, { now: () => NOON });
  await h.onMessage(message("мой любимый цвет — синий"), KEY);
  await h.onMessage(group("Аи, какой мой любимый цвет?", { id: 5 }), KEY);
  assert.equal(last(-10), "Это вы говорили мне в личке — при всех не повторяю.");
  await h.onMessage(group("Аи, что я люблю?", { id: 5 }), KEY);
  assert.match(last(-10), /^Пока ничего/u);
  await h.onMessage(group("Аи, моё любимое аниме — Блич", { id: 5 }), KEY);
  assert.equal(last(-10), "Запомнила: ваше любимое аниме — Блич.");
  await h.onMessage(group("Аи, что я люблю?", { id: 5 }), KEY);
  assert.match(last(-10), /^Что я знаю о вашем любимом:\n• аниме — Блич\n\nЕщё не знаю/u);

  sdk().fetchQueue.push(says("Ответ в группе."));
  await h.onMessage(group("Аи, придумай две строчки про осенний дождь и фонари", { id: 5 }), KEY);
  assert.match(context(), /любимое аниме: Блич/u);
  assert.doesNotMatch(context(), /синий/u, "личное в группу не попало");
  sdk().fetchQueue.push(says("Ответ в личке."));
  await h.onMessage(message("придумай две строчки про зимний вечер и чай"), KEY);
  assert.match(context(), /Что известно о собеседнике:[\s\S]*- любимый цвет: синий\n- любимое аниме: Блич/u);
});

test("словарь: к её «синий» — «а ваш — зелёный, я помню»; не знает — спросит в ответ и запомнит короткое слово", async () => {
  const book = createPhrasebook();
  const hers = book.pool("любимый цвет", { formal: true });
  const ask = async (roll, steps) => {
    reset();
    let now = NOON;
    const h = heart({ PHRASES: true }, { now: () => now, random: () => roll });
    for (const step of steps) {
      if (typeof step === "number") now += step;
      else if (step.model) sdk().fetchQueue.push(says(step.model));
      else await h.onMessage(message(step), KEY);
    }
    return last();
  };
  // Знает — напомнит.
  const known = await ask(0.9, ["мой любимый цвет — зелёный", "какой твой любимый цвет?"]);
  assert.ok(hers.some(line => known === `${line} А ваш — зелёный, я помню.`), known);
  // Не знает — в половине случаев спросит в ответ…
  const asked = await ask(0.1, ["какой твой любимый цвет?"]);
  assert.ok(hers.some(line => asked === `${line} А ваш?`), asked);
  assert.equal(JSON.parse(sdk().kv.get(TASTE_ASK_KEY(5, 5))).casual, true);
  // …и короткий ответ запомнит. Анкету встречный вопрос не начинает.
  assert.equal(await ask(0.1, ["какой твой любимый цвет?", "Зелёный"]), "Запомнила: ваш любимый цвет — Зелёный.");
  assert.equal(saved().color.v, "Зелёный");
  assert.equal(chats().length, 0);
  // …а в другой половине — нет.
  const calm = await ask(0.9, ["какой твой любимый цвет?"]);
  assert.ok(hers.includes(calm), calm);
  assert.equal(sdk().kv.get(TASTE_ASK_KEY(5, 5)) ?? null, null);

  // Отклик — не ответ: «круто» любимым цветом не становится.
  assert.equal(await ask(0.1, ["какой твой любимый цвет?", { model: "Рада." }, "круто, мне нравится"]), "Рада.");
  assert.equal(saved().color, undefined);
  // Фраза из словаря — тоже не ответ; и после неё встречный вопрос больше не ждёт.
  assert.equal(await ask(0.1, ["какой твой любимый цвет?", "скажи мяу", { model: "Красивый цвет." }, "Зелёный"]), "Красивый цвет.");
  assert.equal(saved().color, undefined);
  // Через три минуты слово уже о другом.
  assert.equal(await ask(0.1, ["какой твой любимый цвет?", TASTE_CASUAL_TTL_MS + 1000, { model: "Вы о чём?" }, "Зелёный"]), "Вы о чём?");
  assert.equal(saved().color, undefined);
});

test("выключено настройкой: анкеты нет, фраза уходит в разговор", async () => {
  reset();
  const h = heart({ LIKES: false }, { now: () => NOON });
  sdk().fetchQueue.push(says("Синий — хороший выбор."));
  await h.onMessage(message("мой любимый цвет — синий"), KEY);
  assert.equal(last(), "Синий — хороший выбор.");
  assert.deepEqual(saved(), {});
});
