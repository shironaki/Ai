/**
 * Анкета «любимое»: человек говорит, что любит, — она помнит и отвечает об
 * этом сама, без модели; спрашивает по анкете и встречным «а ваш?».
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, chats, says, sdk, request, toChat, KEY } from "./fixtures/kit.mjs";

const { parseTaste, readAnswer, readCasual, TASTES, TASTE_KEY, TASTE_ASK_KEY, TASTE_ASK_TTL_MS, TASTE_CASUAL_TTL_MS } = await import("../tgcloud/lib/tastes.js");
const { SOUL_PREFIXES } = await import("../tgcloud/lib/soul.js");
const { createPhrasebook } = await import("../tgcloud/lib/phrasebook.js");

const NOON = Date.parse("2026-11-18T09:00:00Z");
const saved = (id = 5) => JSON.parse(sdk().kv.get(TASTE_KEY(id)) ?? "null")?.items ?? {};
/** Вопрос о любимом, на который она сейчас ждёт ответа: вид или null. */
const pending = (chat = 5, id = 5) => JSON.parse(sdk().kv.get(TASTE_ASK_KEY(chat, id)) ?? "null")?.kind || null;
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

  // Ответ на вопрос анкеты: значение без вступления, «хватит», «дальше»; смех, «спасибо» и просьба — не ответ.
  const answers = {
    "Зелёный": { value: "Зелёный" }, "Тёмно-синий, почти чёрный.": { value: "Тёмно-синий, почти чёрный" },
    "у меня зелёный": { value: "зелёный" }, "Мой — Зелёный": { value: "Зелёный" }, "я люблю пельмени": { value: "пельмени" },
    "мне нравится рок": { value: "рок" }, "наверное, осень": { value: "осень" }, "у меня тоже синий": { value: "синий" },
    "«Наруто»": { value: "Наруто" }, "Твоё имя": { value: "Твоё имя" }, "Как приручить дракона": { value: "Как приручить дракона" }, "Мы": { value: "Мы" },
    "хватит": { stop: true }, "стоп": { stop: true }, "Всё, хватит": { stop: true }, "всё": { stop: true }, "не хочу": { stop: true },
    "не знаю": { skip: true }, "дальше": { skip: true }, "нет": { skip: true }, "пропусти": { skip: true }, "все": { skip: true }, "любой": { skip: true },
    "не скажу": { skip: true }, "секрет": { skip: true }, "не помню": { skip: true }, "какая разница": { skip: true }, "у меня нет любимого": { skip: true },
    "не люблю сладкое": { skip: true }, "не смотрю аниме": { skip: true },
  };
  for (const [said, want] of Object.entries(answers)) assert.deepEqual(readAnswer(said), want, said);
  for (const said of ["спасибо", "ок", "а твой?", "круто", "я тоже", "мой тоже", "и мой", "такой же", "ахаха", "хаха", "хихи", "эээ", "ммм", "лол", "ой", "/start",
    "расскажи сказку", "давай играть", "хочу спать", "покажи себя", "это очень длинная речь о том как я провёл лето у бабушки в деревне"]) assert.equal(readAnswer(said), null, said);

  // Встречный вопрос строже: слово должно быть похоже на ответ именно на этот вопрос.
  const casual = {
    color: { "Зелёный": "Зелёный", "тоже синий": "синий", "Мой — зелёный": "зелёный", "люблю синий": "синий", "Тёмно-синий, почти чёрный": "Тёмно-синий, почти чёрный", "цвет морской волны": "цвет морской волны", "хаки": "хаки" },
    season: { "лето": "лето", "осень, конечно": "осень, конечно" }, drink: { "зелёный чай": "зелёный чай", "кофе с молоком": "кофе с молоком" },
    animal: { "коты": "коты", "лиса": "лиса" }, holiday: { "Новый год": "Новый год", "8 марта": "8 марта" }, flower: { "пионы": "пионы" }, subject: { "физра": "физра" },
  };
  for (const [kind, cases] of Object.entries(casual)) for (const [said, value] of Object.entries(cases)) assert.deepEqual(readCasual(said, kind), { value }, `${kind}: ${said}`);
  const stray = {
    color: ["уважаю", "скучно", "о, классика", "красиво", "у меня вопрос", "мои фразы", "мой зелёный", "у меня зелёный", "синий — красивый цвет", "не синий", "расскажи про синий", "сериал", "белка", "синица",
      "хватит", "не знаю", "секрет", "ахаха", "Наруто", "ты милая", "что это", "привет, реши уравнение x+2=5", "круто, мне нравится", "мне все цвета одинаковы"],
    season: ["летать", "все"], drink: ["чайка", "сокол", "колбаса", "водка"], animal: ["котлеты", "который"], holiday: ["пятница"], flower: ["макароны", "розетка"], subject: ["трудно сказать"],
    // Где ответ не узнать, встречного вопроса нет — и ответа на него тоже.
    anime: ["Наруто"], food: ["пицца"], film: ["Матрица"],
  };
  for (const [kind, list] of Object.entries(stray)) for (const said of list) assert.equal(readCasual(said, kind), null, `${kind}: ${said}`);
  assert.deepEqual(TASTES.filter(item => item.casual).map(item => item.key), ["color", "drink", "animal", "season", "holiday", "flower", "subject"]);

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
  // Просьба, для которой есть своё слово, — тоже: список показан, вопрос ждёт.
  await h.onMessage(message("мои списки"), KEY);
  assert.doesNotMatch(last(), /Запомнила/u);
  // Смех — не ответ: на него она отзывается реакцией, как всегда.
  const before = toChat(5).length;
  await h.onMessage(message("ахаха"), KEY);
  assert.equal(toChat(5).length, before, "текста в ответ на смех нет");
  // Просьба к модели — не ответ: уходит в разговор, вопрос ждёт.
  sdk().fetchQueue.push(says("Это уже разговор."));
  await h.onMessage(message("сочини стих про кота"), KEY);
  assert.equal(last(), "Это уже разговор.");
  assert.equal(saved().food, undefined);
  await h.onMessage(message("дальше"), KEY);
  assert.equal(last(), "Пропустим. А пить — чай, кофе, что-то ещё?");
  await h.onMessage(message("у меня — Зелёный чай с жасмином."), KEY);
  assert.equal(last(), "Запомнила: ваш любимый напиток — Зелёный чай с жасмином. Какую музыку вы слушаете чаще всего?");
  await h.onMessage(message("не скажу"), KEY);
  assert.equal(last(), "Пропустим. Какое аниме у вас любимое?");
  await h.onMessage(message("не смотрю аниме"), KEY);
  assert.equal(last(), "Пропустим. Какой фильм или сериал вы готовы пересматривать?");
  await h.onMessage(message("Твоё имя"), KEY);
  assert.equal(last(), "Запомнила: ваш любимый фильм — Твоё имя. Какая книга у вас любимая?");
  await h.onMessage(message("хватит"), KEY);
  assert.equal(last(), "Хорошо, остановимся. Продолжить — «анкета».");
  assert.deepEqual(Object.keys(saved()).sort(), ["color", "drink", "film"]);
  assert.equal(chats().length, 1, "модель понадобилась только на стих");

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
  assert.equal(pending(), "color");
  // …и короткий ответ запомнит. Анкету встречный вопрос не начинает.
  assert.equal(await ask(0.1, ["какой твой любимый цвет?", "Зелёный"]), "Запомнила: ваш любимый цвет — Зелёный.");
  assert.equal(saved().color.v, "Зелёный");
  assert.equal(chats().length, 0);
  // …а в другой половине — нет.
  const calm = await ask(0.9, ["какой твой любимый цвет?"]);
  assert.ok(hers.includes(calm), calm);
  assert.equal(pending(), null);

  // Отклик — не ответ: ни «круто», ни «уважаю» любимым цветом не становятся.
  for (const said of ["круто, мне нравится", "уважаю", "о, классика", "сочини стих про кота"]) {
    assert.equal(await ask(0.1, ["какой твой любимый цвет?", { model: "Рада." }, said]), "Рада.", said);
    assert.equal(saved().color, undefined, said);
  }
  // То же, когда следом — тема словаря: отвечает словарь, в анкету ничего не пишется.
  for (const said of ["скучно", "у меня вопрос", "расскажи сказку"]) {
    assert.doesNotMatch(await ask(0.1, ["какой твой любимый цвет?", said]), /Запомнила/u, said);
    assert.equal(saved().color, undefined, said);
  }
  // Встречный вопрос ждёт одну реплику: фраза из словаря или просьба — и он снят.
  for (const between of ["скажи мяу", "что нового", "мои списки"]) {
    assert.equal(await ask(0.1, ["какой твой любимый цвет?", between, { model: "Красивый цвет." }, "Зелёный"]), "Красивый цвет.", between);
    assert.equal(saved().color, undefined, between);
    assert.equal(pending(), null, between);
  }
  // Через три минуты слово уже о другом.
  assert.equal(await ask(0.1, ["какой твой любимый цвет?", TASTE_CASUAL_TTL_MS + 1000, { model: "Вы о чём?" }, "Зелёный"]), "Вы о чём?");
  assert.equal(saved().color, undefined);

  // Где ответ не узнать по слову (аниме, еда, музыка), она в ответ не спрашивает.
  const anime = book.pool("любимое аниме", { formal: true });
  const plain = await ask(0.1, ["какое твоё любимое аниме?"]);
  assert.ok(anime.includes(plain), plain);
  assert.equal(pending(), null);
  // А знает — напомнит и там.
  const reminded = await ask(0.1, ["моё любимое аниме — Блич", "какое твоё любимое аниме?"]);
  assert.ok(anime.some(line => reminded === `${line} А ваше — Блич, я помню.`), reminded);
});

test("выключено настройкой: анкеты нет, фраза уходит в разговор", async () => {
  reset();
  const h = heart({ LIKES: false }, { now: () => NOON });
  sdk().fetchQueue.push(says("Синий — хороший выбор."));
  await h.onMessage(message("мой любимый цвет — синий"), KEY);
  assert.equal(last(), "Синий — хороший выбор.");
  assert.deepEqual(saved(), {});
});
