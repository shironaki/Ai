/**
 * Памятные даты, альбом рисунков, дневник и «неделя в цифрах», словарь группы:
 * всё — без модели.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, calls, chats, says, sdk, source, toChat, toOwner, OWNER, KEY, DAY } from "./fixtures/kit.mjs";

const { parseAlbum, ALBUM_KEY } = await import("../tgcloud/lib/draw.js");
const { pulseKey } = await import("../tgcloud/lib/pulse.js");
const { SOUL_PREFIXES } = await import("../tgcloud/lib/soul.js");

const own = (text) => message(text, { id: OWNER });
const at = (text) => Date.parse(text);
const day = (moment) => new Date(moment).toISOString().slice(0, 10);

test("«сколько до моего дня рождения», «сколько мы знакомы»: считает сама; чужие слова — мимо", async () => {
  reset();
  let now = at("2026-11-18T09:00:00Z");
  const h = heart({ PHRASES: true }, { now: () => now });
  await h.onMessage(message("сколько до моего дня рождения?"), KEY);
  assert.equal(last(), "Я не знаю, когда у вас день рождения. Скажите: «у меня день рождения 5 мая» — запомню и поздравлю.");
  sdk().fetchQueue.push(says("Весной, значит."));
  await h.onMessage(message("а у меня день рождения 5 марта"), KEY);
  await h.onMessage(message("да"), KEY);
  assert.match(last(), /^Запомнила: 5 марта/u);
  await h.onMessage(message("сколько до моего дня рождения?"), KEY);
  assert.equal(last(), "До вашего дня рождения — 107 дней (5 марта). Поздравлю сама.");
  await h.onMessage(message("сколько дней до др"), KEY);
  assert.match(last(), /107 дней/u);
  now = at("2027-03-04T09:00:00Z");
  await h.onMessage(message("когда мой день рождения"), KEY);
  assert.equal(last(), "Завтра (5 марта). Я помню.");

  await h.onMessage(message("сколько мы знакомы?"), KEY);
  assert.equal(last(), "Мы знакомы 106 дней.");
  // Похожие слова о другом — не её счёт: уходят к модели.
  for (const said of ["сколько до дня рождения Пушкина осталось лет, если считать от сегодняшней даты", "когда день рождения у мамы, напомни мне, пожалуйста, заранее", "сколько мы знакомы с этим фильмом, интересно"]) {
    sdk().fetchQueue.push(says("Ответ модели."));
    await h.onMessage(message(said), KEY);
    assert.equal(last(), "Ответ модели.", said);
  }
});

test("дневник — хозяину в личке: неделя по дням её словами; по понедельникам в сводке — неделя в цифрах", async () => {
  reset();
  // Понедельник, 16 ноября 2026, 10:00 по Москве.
  let now = at("2026-11-16T07:00:00Z");
  const h = heart({ SELF_REPORTS: true, PHRASES: true }, { now: () => now });
  sdk().kv.set("heart:build", JSON.stringify({ build: (await import("../tgcloud/lib/heart.js")).BUILD, at: now }));
  const put = (back, counters) => sdk().kv.set(pulseKey(day(now - back * DAY)), JSON.stringify(counters));
  put(7, { replies: 10, ruled: 30, phrased: 20, reactions: 4 });
  put(5, { replies: 40, ruled: 60, phrased: 35, reactions: 9, drawn: 2, games: 3, greeted: 2, corrected: 1 });
  put(1, { replies: 2, ruled: 6, phrased: 5, reactions: 1, rp: 4 });
  put(8, { replies: 500, ruled: 500 }); // старше недели — не считается
  put(0, { replies: 1, ruled: 2 });

  await h.onMessage(own("покажи свой дневник"), KEY);
  assert.equal(last(OWNER), [
    "Мой дневник за неделю:",
    "09.11 — хорошо поговорили — 40 ответов.",
    "11.11 — говорила без умолку — 100 ответов, рисовала (2), играла (3), писала вам первой, меня поправили (1).",
    "15.11 — говорила мало — 8 ответов, дурачились в чате (4).",
    "16.11 (сегодня) — говорила мало — 3 ответа.",
  ].join("\n"));

  // Сводка понедельника: вчерашний день и строки о неделе.
  const digest = toOwner().find(item => /вот мой вчерашний день/u.test(item.text));
  assert.ok(digest, "сводка пришла");
  assert.match(digest.text, /Хозяин, вот мой вчерашний день, 15\.11:/u);
  assert.match(digest.text, /Неделя в цифрах \(09\.11–15\.11\): ответов — 148, из них без модели — 96 \(65%\), по словарю — 60; реакций — 14\./u);
  assert.match(digest.text, /За неделю: рисунков — 2, игр — 3, действий — 4, написала первой — 2\./u);
  assert.match(digest.text, /Самый разговорчивый день — 11\.11: 100 ответов\. Поправили меня за неделю 1 раз\./u);

  // «Дневник» без «твой» — записи самого человека: их она не подменяет.
  await h.onMessage(own("покажи дневник"), KEY);
  assert.equal(last(OWNER), "Дневник пока пуст. Записать — «дневник: …».");
  await h.onMessage(own("что у тебя в дневнике?"), KEY);
  assert.match(last(OWNER), /^Мой дневник за неделю:/u);
  // Не хозяину её дневник не показывается; во вторник в сводке недели нет.
  sdk().fetchQueue.push(says("Это личное."));
  await h.onMessage(message("покажи свой дневник"), KEY);
  assert.equal(last(), "Это личное.");
  now += DAY;
  await h.onMessage(own("привет"), KEY);
  const tuesday = toOwner().filter(item => /вот мой вчерашний день/u.test(item.text)).at(-1);
  assert.match(tuesday.text, /вчерашний день, 16\.11/u);
  assert.doesNotMatch(tuesday.text, /Неделя в цифрах/u);
});

test("альбом: «мои рисунки» — последние десять просьб, «повтори рисунок 2» — заново; только в личке", async () => {
  assert.deepEqual(parseAlbum("мои рисунки"), { list: true });
  assert.deepEqual(parseAlbum("Покажи альбом."), { list: true });
  assert.deepEqual(parseAlbum("повтори рисунок 3"), { repeat: 3 });
  assert.deepEqual(parseAlbum("повтори третий рисунок"), { repeat: 3 });
  assert.deepEqual(parseAlbum("нарисуй ещё раз рисунок 10"), { repeat: 10 });
  for (const said of ["повтори третий", "повтори", "мои рисунки украли", "нарисуй 3", "повтори рисунок 11", "альбом группы кино", "повтори двадцатый рисунок"]) assert.equal(parseAlbum(said), null, said);

  reset();
  const PIXELS = Buffer.from(Array.from({ length: 600 }, (_, index) => index % 251));
  source("flux-1-schnell", { success: true, result: { image: PIXELS.toString("base64") } });
  source("m2m100", { success: true, result: { translated_text: "something" } });
  let now = at("2026-11-18T09:00:00Z");
  const h = heart({ DRAW_KEY: "0123456789abcdef0123456789abcdef:cf-token_ABCDEFGH-1234567890xyz", DRAW_DIRECTOR: false, PHRASES: true }, { now: () => now });
  await h.onMessage(message("мои рисунки"), KEY);
  assert.match(last(), /^Альбом пока пуст/u);
  await h.onMessage(message("нарисуй кота в шляпе"), KEY);
  now += DAY;
  await h.onMessage(message("нарисуй лису на снегу"), KEY);
  await h.onMessage(message("нарисуй лису на снегу"), KEY);
  await h.onMessage(message("мои рисунки"), KEY);
  assert.equal(last(), "Ваши рисунки — последние 2:\n1. лису на снегу — 19.11\n2. кота в шляпе — 18.11\n\nСами картинки — выше в переписке. Нарисовать такую же заново — «повтори рисунок 2».");
  const before = calls("sendPhoto").length;
  await h.onMessage(message("повтори рисунок 2"), KEY);
  assert.equal(calls("sendPhoto").length, before + 1);
  assert.equal(sdk().sourceFetches.filter(item => item.url.includes("m2m100")).map(item => JSON.parse(item.options.body).text).at(-1), "Нарисуй кота в шляпе.");
  await h.onMessage(message("повтори рисунок 7"), KEY);
  assert.match(last(), /В альбоме 2 рисунка — такого номера нет/u);
  // Альбом у каждого свой; в группе не показывается; в копию души входит.
  await h.onMessage(message("мои рисунки", { id: 6 }), KEY);
  assert.match(last(6), /^Альбом пока пуст/u);
  await h.onMessage(group("Аи, мои рисунки"), KEY);
  assert.equal(last(-10), "Альбом показываю в личке: там — «мои рисунки».");
  assert.ok(SOUL_PREFIXES.some(prefix => ALBUM_KEY(5).startsWith(prefix)));
  assert.equal(JSON.parse(sdk().kv.get(ALBUM_KEY(5))).items.length, 2);
  assert.equal(chats().length, 0);

  // Без ключа рисования альбома нет — слова уходят дальше.
  reset();
  const plain = heart({ PHRASES: true }, { now: () => now });
  sdk().fetchQueue.push(says("Какие рисунки?"));
  await plain.onMessage(message("мои рисунки"), KEY);
  assert.equal(last(), "Какие рисунки?");
});

test("словарь группы: админ учит фразам, которые действуют только в его чате", async () => {
  reset();
  sdk().apiReplies.getChatMember = (params) => ({ status: params.user_id === 21 ? "administrator" : "member" });
  const h = heart({ PHRASES: true }, { now: () => at("2026-11-18T09:00:00Z"), random: () => 0 });
  const admin = (text) => group(text, { id: 21, name: "Вася" });
  const guest = (text) => group(text, { id: 22, name: "Маша" });
  await h.onMessage(guest("Аи, на «кто тут главный» отвечай «Вася, конечно»"), KEY);
  assert.equal(last(-10), "Фразам этого чата меня учат его админы.");
  await h.onMessage(admin("Аи, на «кто тут главный» отвечай «Вася, конечно»"), KEY);
  assert.equal(last(-10), "Запомнила: в этом чате на «кто тут главный» отвечаю «Вася, конечно». В других чатах этого не будет.");
  await h.onMessage(admin("Аи, на «кто тут главный» отвечай «Спросите у Васи»"), KEY);
  assert.match(last(-10), /ещё один ответ на «кто тут главный» — в этом чате их теперь 2/u);
  await h.onMessage(admin("Аи, на «кто тут главный» отвечай «Вася, конечно»"), KEY);
  assert.match(last(-10), /Это я здесь уже знаю/u);
  await h.onMessage(admin("Аи, на «покажи» отвечай «голую школьницу»"), KEY);
  assert.equal(last(-10), "Такому я учиться не буду.");

  // Спросил любой участник — отвечает выученным; модель не тратится.
  await h.onMessage(guest("Аи, кто тут главный?"), KEY);
  assert.equal(last(-10), "Вася, конечно");
  await h.onMessage(guest("Аи, фразы чата"), KEY);
  assert.equal(last(-10), "Фразы этого чата (1):\n1. «кто тут главный» → «Вася, конечно» / «Спросите у Васи»\n\nЗабыть — «забудь фразу 2».");
  assert.equal(chats().length, 0);

  // В другом чате и в личке этой фразы нет.
  sdk().fetchQueue.push(says("Не знаю, кто у вас главный."), says("Никто."));
  await h.onMessage(group("Аи, кто тут главный?", { id: 22, name: "Маша", chat: -20 }), KEY);
  assert.equal(last(-20), "Не знаю, кто у вас главный.");
  await h.onMessage(message("кто тут главный?"), KEY);
  assert.equal(last(), "Никто.");
  // Словарь хозяина не тронут: фраза чата в него не попала.
  await h.onMessage(own("мои фразы"), KEY);
  assert.match(last(OWNER), /^Пока ничему/u);

  // Забыть — админ; гость — нет.
  await h.onMessage(guest("Аи, забудь фразу 1"), KEY);
  assert.equal(last(-10), "Фразам этого чата меня учат его админы.");
  await h.onMessage(admin("Аи, забудь фразу 1"), KEY);
  assert.equal(last(-10), "Забыла: «кто тут главный». Фраз этого чата осталось: 0.");
  sdk().fetchQueue.push(says("Понятия не имею."));
  await h.onMessage(guest("Аи, кто тут главный?"), KEY);
  assert.equal(last(-10), "Понятия не имею.");
});
