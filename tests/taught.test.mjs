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
  await h.onMessage(group("Аи, на «привет» отвечай «уходи»", { id: OWNER }), KEY);
  assert.match(last(-10), /учит только хозяин/u, "в группе — даже хозяин не учит: при всех это не делается");
  assert.equal(sdk().kv.has(TAUGHT_KEY), false);
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
