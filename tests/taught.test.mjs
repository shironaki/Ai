/**
 * Словарь из разговора: хозяин учит фразам словами, она отвечает ими без
 * модели; короткое неузнанное считается и показывается хозяину.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, chats, says, sdk, toOwner, OWNER, KEY, DAY } from "./fixtures/kit.mjs";

const { parseTeach, createTaught, TAUGHT_KEY, UNHEARD_KEY } = await import("../tgcloud/lib/taught.js");
const { SOUL_PREFIXES } = await import("../tgcloud/lib/soul.js");

const ON = { PHRASES: true };
const NOON = Date.parse("2026-11-18T09:00:00Z"); // среда
const own = (text) => message(text, { id: OWNER });

test("разбор: учить, показать, забыть, «что ты не поняла»; похожее — не урок", () => {
  const cases = {
    "на «привет, медвед» отвечай «превед!»": { add: { when: "привет, медвед", say: "превед!" } },
    "На \"как жизнь\" говори: лучше всех": { add: { when: "как жизнь", say: "лучше всех" } },
    "когда говорят «кто тут главный», отвечай «хозяин, конечно»": { add: { when: "кто тут главный", say: "хозяин, конечно" } },
    "если скажут бу — отвечай «ой!»": { add: { when: "бу", say: "ой!" } },
    "выучи фразу: слава роботам = Слава! Но людям — тоже.": { add: { when: "слава роботам", say: "Слава! Но людям — тоже." } },
    "чему я тебя научил?": { list: true }, "мои фразы": { list: true }, "что ты выучила": { list: true },
    "забудь фразу 2": { drop: 2 }, "разучи фразу «привет медвед»": { drop: "привет медвед" },
    "что ты не поняла?": { unheard: true }, "чего не хватает в словаре": { unheard: true }, "непонятые фразы": { unheard: true },
    "забудь непонятое": { unheardClear: true },
  };
  for (const [said, want] of Object.entries(cases)) assert.deepEqual(parseTeach(said), want, said);
  for (const said of ["привет", "на что ты отвечаешь", "что ты не поняла в этой задаче", "забудь это", "отвечай быстрее", "когда придёт лето, скажи"]) assert.equal(parseTeach(said), null, said);
});

test("хозяин учит — она отвечает выученным всем и без модели; второй ответ чередуется; забыть — по номеру", async () => {
  reset();
  let roll = 0;
  const h = heart(ON, { now: () => NOON, random: () => roll });
  await h.onMessage(own("на «привет, медвед» отвечай «Превед, {имя}!»"), KEY);
  assert.match(last(OWNER), /Запомнила: на «привет медвед» отвечаю «Превед, \{имя\}!»\. Забыть — «забудь фразу 1»/u);
  // Любой человек, в личке и в группе по обращению. Знаки и регистр не важны.
  await h.onMessage(message("Привет, МЕДВЕД!!!"), KEY);
  assert.equal(last(), "Превед!", "имени нет — обращение пропадает");
  await h.onMessage(group("Аи, привет медвед"), KEY);
  assert.equal(last(-10), "Превед!");
  assert.equal(chats().length, 0, "модель не тратилась");
  // Выученное важнее словаря из файла.
  await h.onMessage(own("на «как дела» отвечай «лучше всех»"), KEY);
  await h.onMessage(message("как дела?"), KEY);
  assert.equal(last(), "лучше всех");
  // Второй ответ на ту же реплику — чередуются.
  await h.onMessage(own("на «привет, медвед» отвечай «Кросавчег»"), KEY);
  assert.match(last(OWNER), /ещё один ответ на «привет медвед» — теперь их 2/u);
  await h.onMessage(own("на «привет, медвед» отвечай «Кросавчег»"), KEY);
  assert.match(last(OWNER), /Это я уже знаю/u);
  roll = 0.99;
  await h.onMessage(message("привет, медвед"), KEY);
  assert.equal(last(), "Кросавчег");

  await h.onMessage(own("мои фразы"), KEY);
  assert.match(last(OWNER), /Чему вы меня научили \(2\):\n1\. «привет медвед» → «Превед, \{имя\}!» \/ «Кросавчег»\n2\. «как дела» → «лучше всех»/u);
  await h.onMessage(own("забудь фразу 2"), KEY);
  assert.match(last(OWNER), /Забыла: «как дела»\. Осталось выученного: 1/u);
  await h.onMessage(own("забудь фразу 7"), KEY);
  assert.match(last(OWNER), /Такой фразы среди выученных нет/u);
  await h.onMessage(message("как дела?"), KEY);
  assert.notEqual(last(), "лучше всех", "забытое больше не звучит — отвечает словарь из файла");
  await h.onMessage(own("статус"), KEY);
  assert.match(last(OWNER), /Словарь: [^\n]*выучено от хозяина: 1/u);
  assert.ok(SOUL_PREFIXES.includes("heart:taught:"), "выученное входит в резервную копию");
});

test("учит только хозяин и только в личке; слишком длинное и переполнение — честные слова", async () => {
  reset();
  const h = heart(ON, { now: () => NOON });
  await h.onMessage(message("на «привет» отвечай «уходи»"), KEY);
  assert.match(last(), /Новым фразам меня учит только хозяин/u);
  // В группе учат фразам самого чата (0.27.0): общий словарь, для всех чатов, там не пополняется.
  await h.onMessage(group("Аи, на «привет» отвечай «уходи»", { id: OWNER }), KEY);
  assert.match(last(-10), /^Запомнила: в этом чате на «привет» отвечаю «уходи»\. В других чатах этого не будет\.$/u);
  assert.equal(sdk().kv.has(TAUGHT_KEY), false, "общий словарь не тронут");
  await h.onMessage(own(`на «${"очень ".repeat(20)}длинно» отвечай «нет»`), KEY);
  assert.match(last(OWNER), /учу только короткое/u);

  const book = createTaught({ store: { available: true, get: async () => ({ items: Array.from({ length: 300 }, (_, index) => ({ w: `фраза ${index}`, a: ["да"] })) }), set: async () => true } });
  assert.equal((await book.add("ещё одна", "нет")).code, "too_many");
  const none = createTaught({ store: null });
  assert.equal((await none.add("!!!", "б")).code, "empty", "одни знаки — не реплика");
  assert.equal((await none.add("привет", "пока")).code, "storage_unavailable");
  assert.equal(await none.match("привет"), null);
});

test("неузнанное: короткое, что ушло к модели, считается без автора; выученное из списка уходит", async () => {
  reset();
  const h = heart(ON, { now: () => NOON });
  for (const said of ["кек чебурек", "кек чебурек", "ну ты и булка", "да", "почему", "позвони на 12345", "напиши мне длинное сочинение про то, как устроены океанские течения"]) {
    sdk().fetchQueue.push(says("Ответ модели."));
    await h.onMessage(message(said), KEY);
  }
  // Ответ на её сообщение — продолжение разговора, а не новая реплика.
  sdk().fetchQueue.push(says("Ответ модели."));
  await h.onMessage(message("вот это поворот", { reply: { message_id: 1, from: { id: 999, is_bot: true, username: "ai_heart_bot" }, text: "…" } }), KEY);
  // Словарь узнал — в список не попадает.
  await h.onMessage(message("привет"), KEY);
  const saved = JSON.parse(sdk().kv.get(UNHEARD_KEY));
  assert.deepEqual(Object.keys(saved.map).sort(), ["кек чебурек", "ну ты и булка"]);
  assert.equal(saved.map["кек чебурек"].n, 2);
  assert.doesNotMatch(JSON.stringify(saved), /"(?:user|from|id)"/u, "автора в записи нет");

  await h.onMessage(message("что ты не поняла?"), KEY);
  assert.doesNotMatch(last(), /кек чебурек/u, "постороннему список не показывается");
  sdk().fetchQueue.length = 0;
  await h.onMessage(own("что ты не поняла?"), KEY);
  assert.match(last(OWNER), /не узнала и отдала модели \(2\):\n1\. «кек чебурек» ×2\n2\. «ну ты и булка»/u);
  assert.match(last(OWNER), /на «фраза» отвечай «ответ»/u);
  // Научили — из неузнанного ушло.
  await h.onMessage(own("на «кек чебурек» отвечай «чебурек кек»"), KEY);
  await h.onMessage(own("что ты не поняла?"), KEY);
  assert.doesNotMatch(last(OWNER), /кек чебурек/u);
  await h.onMessage(own("забудь непонятое"), KEY);
  await h.onMessage(own("что ты не поняла?"), KEY);
  assert.match(last(OWNER), /Пока нечего показать/u);
});

test("по понедельникам сводка хозяину называет неузнанное за неделю", async () => {
  reset();
  let at = Date.parse("2026-11-13T09:00:00Z"); // пятница
  const h = heart({ ...ON, SELF_REPORTS: true }, { now: () => at });
  sdk().fetchQueue.push(says("Ответ."), says("Ответ."));
  await h.onMessage(message("кек чебурек"), KEY);
  await h.onMessage(message("кек чебурек"), KEY);
  at = Date.parse("2026-11-14T07:00:00Z"); // суббота, 10:00 по Москве
  await h.tick({});
  assert.ok(!toOwner().some(item => /За неделю не узнала/u.test(item.text)), "в субботу — без недельной строки");
  sdk().fetchQueue.push(says("Ответ."));
  at = Date.parse("2026-11-15T12:00:00Z");
  await h.onMessage(message("ну ты и булка"), KEY);
  at = Date.parse("2026-11-16T07:00:00Z"); // понедельник, 10:00 по Москве
  await h.tick({});
  const digest = toOwner().map(item => item.text).find(text => /За неделю не узнала/u.test(text));
  assert.ok(digest, "в понедельник строка есть");
  assert.match(digest, /За неделю не узнала из короткого: «кек чебурек» ×2, «ну ты и булка»\. Весь список — «что ты не поняла\?»/u);
});

test("128: «предложи ответы» — один вопрос к модели, хозяин выбирает; в словарь без его слова ничего не идёт", async () => {
  reset();
  const h = heart(ON, { now: () => NOON });
  // Предлагать не к чему — без модели.
  await h.onMessage(own("предложи ответы"), KEY);
  assert.equal(last(OWNER), "Предлагать не к чему: короткого, чего я не узнала бы, пока нет.");
  assert.equal(chats().length, 0);
  for (const said of ["кек чебурек", "кек чебурек", "ну ты и булка", "как оно ничего"]) {
    sdk().fetchQueue.push(says("Ответ модели."));
    await h.onMessage(message(said), KEY);
  }
  const before = chats().length;
  // Чужому — нет: слова уходят в разговор, списка он не видит.
  sdk().fetchQueue.push(says("Это не ко мне."));
  await h.onMessage(message("предложи ответы"), KEY);
  assert.equal(last(), "Это не ко мне.");
  sdk().fetchQueue.length = 0;

  // Модель отвечает по форме; «не знаю», разметка и лишние номера — мимо.
  sdk().fetchQueue.push(says("1. Чебурек кек — и точка.\n2. «Булка — это комплимент, я считаю.»\n3. Не знаю, что на это сказать.\n7. Лишний номер.\nИ ещё пара слов от себя."));
  await h.onMessage(own("предложи ответы"), KEY);
  assert.equal(last(OWNER), "Вот что я бы отвечала (2):\n1. «кек чебурек» → «Чебурек кек — и точка.»\n2. «ну ты и булка» → «Булка — это комплимент, я считаю.»\n\nВзять — одним сообщением: «беру 1 3» или «беру все». Не нравится ответ — научите своим: на «фраза» отвечай «ответ». В словарь без вашего слова ничего не кладу.");
  assert.equal(chats().length, before + 2, "один вопрос к модели на весь список (и один — чужому выше)");
  const sentToModel = JSON.parse(chats().at(-1).options.body).messages.at(-1).content;
  assert.match(sentToModel, /К каждой напиши один короткий ответ в своём характере — до 12 слов\./u);
  assert.match(sentToModel, /\n\n1\. кек чебурек\n2\. (?:ну ты и булка|как оно ничего)\n3\. (?:ну ты и булка|как оно ничего)$/u);
  // Пока не взято — в словаре пусто: на фразу отвечает модель.
  assert.equal(sdk().kv.get(TAUGHT_KEY) ?? null, null);

  // Чужое «беру все» — не команда. Хозяин берёт первый — предложение закрыто.
  sdk().fetchQueue.push(says("Берите."));
  await h.onMessage(message("беру все"), KEY);
  assert.equal(last(), "Берите.");
  await h.onMessage(own("беру 5"), KEY);
  assert.equal(last(OWNER), "Таких номеров в предложенном нет: там их 2.");
  await h.onMessage(own("беру 1"), KEY);
  assert.equal(last(OWNER), "Добавила в словарь: 1. Теперь на эту фразу отвечаю без модели. Список — «мои фразы», убрать — «забудь фразу 3».");
  const calls = chats().length;
  await h.onMessage(message("кек чебурек"), KEY);
  assert.equal(last(), "Чебурек кек — и точка.");
  assert.equal(chats().length, calls, "выученное — без модели");
  // Взятое ушло из неузнанного; второе «беру» без нового предложения — обычные слова.
  assert.deepEqual(Object.keys(JSON.parse(sdk().kv.get(UNHEARD_KEY)).map).sort(), ["как оно ничего", "ну ты и булка"]);
  sdk().fetchQueue.push(says("Что берёте?"));
  await h.onMessage(own("беру 2"), KEY);
  assert.equal(last(OWNER), "Что берёте?");

  // «Беру все»; модель не по форме или молчит — честно.
  sdk().fetchQueue.push(says("1. Булка так булка.\n2. Ничего — это уже что-то."));
  await h.onMessage(own("пополни словарь"), KEY);
  assert.match(last(OWNER), /^Вот что я бы отвечала \(2\):/u);
  await h.onMessage(own("беру всё"), KEY);
  assert.match(last(OWNER), /^Добавила в словарь: 2\. Теперь на эти фразы отвечаю без модели\./u);
  sdk().fetchQueue.push(says("Ответ модели."));
  await h.onMessage(message("опять двадцать пять"), KEY);
  sdk().fetchQueue.push(says("Вот вам мои мысли без номеров."));
  await h.onMessage(own("предложи ответы"), KEY);
  assert.equal(last(OWNER), "Модель ответила не по форме — предложить нечего. Попробуйте ещё раз чуть позже.");
  // «Что ты не поняла?» подсказывает новую просьбу.
  await h.onMessage(own("что ты не поняла?"), KEY);
  assert.match(last(OWNER), /Могу сама предложить ответы, а вы выберете — «предложи ответы»/u);
});
