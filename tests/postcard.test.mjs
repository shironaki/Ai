/**
 * Открытки: по просьбе («нарисуй открытку Маше на день рождения») и сама — в
 * день рождения человека и в праздники хозяина. Описание для художника —
 * готовое, слова — подписью; нет красок — поздравление уходит словами.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, reset, last, calls, chats, says, sdk, source, sourced, toChat, toOwner, OWNER, KEY } from "./fixtures/kit.mjs";

const { parsePostcard, postcardPrompt, parseHoliday, holidaysOf, OCCASIONS, HOLIDAYS_KEY } = await import("../tgcloud/lib/postcard.js");
const { createPhrasebook } = await import("../tgcloud/lib/phrasebook.js");

const CF = "0123456789abcdef0123456789abcdef:cf-token_ABCDEFGH-1234567890xyz";
const ON = { DRAW_KEY: CF, PHRASES: true };
const PIXELS = Buffer.from(Array.from({ length: 600 }, (_, index) => index % 251));
const image = () => ({ success: true, result: { image: PIXELS.toString("base64") } });
const prompts = () => sdk().sourceFetches.filter(item => item.url.includes("flux-1-schnell")).map(item => JSON.parse(item.options.body).prompt);
const photos = () => calls("sendPhoto");
const own = (text) => message(text, { id: OWNER });
const book = createPhrasebook();
const pool = (name) => book.pool(name, { formal: true });
const lower = (line) => `${line[0].toLowerCase()}${line.slice(1)}`;

test("разбор открытки: случай, кому, название праздника; не открытка — мимо", () => {
  const cases = {
    "открытку Маше на день рождения": { occasion: "birthday", to: "Маше", title: "" },
    "открытку": { occasion: "holiday", to: "", title: "" },
    "открытку маме на 8 марта": { occasion: "march8", to: "маме", title: "" },
    "открытку к новому году": { occasion: "newyear", to: "", title: "" },
    "открытку для Али с днём рождения": { occasion: "birthday", to: "Али", title: "" },
    "открытку к празднику Ураза-байрам": { occasion: "faith", to: "", title: "Ураза-байрам" },
    "открытку на Курбан-байрам брату": { occasion: "faith", to: "брату", title: "Курбан-байрам" },
    "открытку папе на 23 февраля": { occasion: "feb23", to: "папе", title: "" },
    "открытку с любовью жене": { occasion: "love", to: "жене", title: "" },
    "открытку другу выздоравливай": { occasion: "getwell", to: "другу", title: "" },
    "поздравительную открытку Тимуру на юбилей": { occasion: "birthday", to: "Тимуру", title: "" },
    "открытку коллегам с праздником Навруз": { occasion: "holiday", to: "коллегам", title: "Навруз" },
    "открытку бабушке": { occasion: "holiday", to: "бабушке", title: "" },
  };
  for (const [said, want] of Object.entries(cases)) assert.deepEqual(parsePostcard(said), want, said);
  for (const said of ["кота", "кота в шляпе", "открытку 123", "открытый космос", "себя", "ещё"]) assert.equal(parsePostcard(said), null, said);
  // Описания — готовые, английские, без надписей; у праздников веры — без людей.
  for (const item of Object.values(OCCASIONS)) assert.match(item.prompt, /^[\x20-\x7e]+$/u);
  for (const item of Object.values(OCCASIONS)) assert.match(item.prompt, /no text, no letters/u);
  assert.match(postcardPrompt("faith"), /crescent moon.*no people/u);
  assert.equal(postcardPrompt("holiday", "Ураза-байрам"), postcardPrompt("faith"));
  assert.equal(postcardPrompt("чужое"), OCCASIONS.holiday.prompt);
  // Каждому случаю — свой запас слов в словаре.
  for (const [key, item] of Object.entries(OCCASIONS)) assert.ok(pool(item.pool).length >= 2, `${key}: ${item.pool}`);
});

test("открытка по просьбе: описание без перевода, подпись — поздравление, «Маше — с днём рождения»", async () => {
  reset();
  source("flux-1-schnell", image());
  const h = heart(ON, { now: () => Date.parse("2026-11-18T09:00:00Z") });
  const result = await h.onMessage(message("нарисуй открытку Маше на день рождения"), KEY);
  assert.equal(result.kind, "draw");
  assert.deepEqual(prompts(), [OCCASIONS.birthday.prompt]);
  assert.equal(sourced().filter(url => url.includes("m2m100")).length, 0, "перевод не нужен: описание своё");
  assert.equal(photos().length, 1);
  assert.ok(pool("+открытка:день рождения").map(line => `Маше — ${lower(line)}`).includes(photos()[0].caption), photos()[0].caption);

  await h.onMessage(message("нарисуй открытку к празднику Ураза-байрам"), KEY);
  assert.equal(prompts().at(-1), OCCASIONS.faith.prompt);
  assert.ok(pool("+открытка:праздник").map(line => `Ураза-байрам. ${line}`).includes(photos().at(-1).caption), photos().at(-1).caption);
  await h.onMessage(message("нарисуй открытку"), KEY);
  assert.ok(pool("+открытка:праздник").includes(photos().at(-1).caption));
  // «Ещё» — та же открытка заново; в альбоме — просьба словами.
  await h.onMessage(message("нарисуй ещё"), KEY);
  assert.equal(prompts().at(-1), OCCASIONS.holiday.prompt);
  assert.equal(photos().length, 4);
  await h.onMessage(message("мои рисунки"), KEY);
  assert.match(last(), /открытку Маше на день рождения/u);
  assert.equal(chats().length, 0);
});

test("день рождения: к поздравлению — открытка; красок нет или мастерская отказала — слова остаются", async () => {
  reset();
  source("flux-1-schnell", image());
  let at = Date.parse("2026-11-18T09:00:00Z");
  const h = heart({ DRAW_KEY: CF }, { now: () => at });
  sdk().fetchQueue.push(says("Весной, значит."));
  await h.onMessage(message("а у меня день рождения 5 марта"), KEY);
  await h.onMessage(message("да"), KEY);
  assert.match(last(), /Запомнила: 5 марта/u);
  at = Date.UTC(2027, 2, 5, 9, 1);
  await h.tick({ tick: true });
  assert.deepEqual(prompts(), [OCCASIONS.birthday.prompt]);
  assert.equal(photos().length, 1);
  assert.match(photos()[0].caption, /^🎂 С днём рождения.*Пусть этот год будет добрым — а я буду рядом\.$/u);
  assert.equal(String(photos()[0].chat_id), "5");
  assert.doesNotMatch(last(), /С днём рождения/u, "вторым сообщением слова не повторяются");
  // Открытка — из дневной нормы рисунков человека: в этот день ему осталось четыре, не пять.
  const drawn = [...sdk().kv.entries()].filter(([key]) => /^heart:drawn:.*:5$/u.test(key)).map(([, value]) => JSON.parse(value).n);
  assert.deepEqual(drawn, [1]);

  // Через год мастерская не отвечает: поздравление — словами.
  sdk().sourceReplies.length = 0;
  source("flux-1-schnell", { ok: false, status: 500, text: async () => "upstream" });
  at = Date.UTC(2028, 2, 5, 9, 1);
  await h.tick({ tick: true });
  assert.equal(photos().length, 1);
  assert.match(last(), /^🎂 С днём рождения/u);

  // Telegram не принял файл — слова уходят всё равно.
  sdk().sourceReplies.length = 0;
  source("flux-1-schnell", image());
  sdk().failing.sendPhoto = new Error("Bad Request: PHOTO_INVALID_DIMENSIONS");
  at = Date.UTC(2029, 2, 5, 9, 1);
  const before = toChat(5).length;
  await h.tick({ tick: true });
  delete sdk().failing.sendPhoto;
  assert.equal(toChat(5).length, before + 1);
  assert.match(last(), /^🎂 С днём рождения/u);

  // Без ключа для рисования — как раньше.
  reset();
  at = Date.parse("2026-11-18T09:00:00Z");
  const plain = heart({}, { now: () => at });
  sdk().fetchQueue.push(says("Весной, значит."));
  await plain.onMessage(message("а у меня день рождения 5 марта"), KEY);
  await plain.onMessage(message("да"), KEY);
  at = Date.UTC(2027, 2, 5, 9, 1);
  await plain.tick({ tick: true });
  assert.match(last(), /^🎂 С днём рождения/u);
  assert.equal(photos().length, 0);
});

test("праздники хозяина: список словами; в сам день после девяти — открытка, один раз; выключается словом", async () => {
  assert.deepEqual(parseHoliday("праздники"), { list: true });
  assert.deepEqual(parseHoliday("добавь праздник Ураза-байрам 20 марта 2027"), { add: { d: 20, m: 3, y: 2027, title: "Ураза-байрам" } });
  assert.deepEqual(parseHoliday("добавь праздник: День рождения мамы — 5.06"), { add: { d: 5, m: 6, title: "День рождения мамы" } });
  assert.deepEqual(parseHoliday("добавь праздник без даты"), { add: null });
  assert.deepEqual(parseHoliday("добавь праздник Чудо 35 марта"), { add: null });
  assert.deepEqual([parseHoliday("убери праздник 2"), parseHoliday("убери праздник Навруз")], [{ drop: 2 }, { drop: "навруз" }]);
  assert.deepEqual([parseHoliday("не присылай открытки"), parseHoliday("присылай открытки")], [{ cards: false }, { cards: true }]);
  for (const said of ["скоро праздники", "люблю праздники", "с праздником", "какой сегодня праздник", "добавь соли", "убери за собой"]) assert.equal(parseHoliday(said), null, said);
  assert.deepEqual(holidaysOf(null), [], "сама она праздников не назначает");

  reset();
  source("flux-1-schnell", image());
  let at = Date.parse("2026-11-18T09:00:00Z");
  const h = heart({ ...ON, GREET: true, TIME_ZONE: "Europe/Moscow" }, { now: () => at });
  await h.onMessage(own("праздники"), KEY);
  assert.match(last(OWNER), /^Праздников в моём списке нет: какие дни для вас праздник, знаете только вы, и сама я их не назначаю\./u);
  // Пустой список — в Новый год она сама ничего не шлёт.
  at = Date.parse("2026-01-01T07:00:00Z");
  await h.tick({});
  assert.equal(photos().length, 0);
  at = Date.parse("2026-11-18T09:00:00Z");
  await h.onMessage(own("добавь праздник Новый год 1 января"), KEY);
  assert.equal(last(OWNER), "Запомнила, хозяин: Новый год — 1 января, каждый год. В этот день пришлю открытку.");
  await h.onMessage(own("добавь праздник Ураза-байрам 20 марта 2027"), KEY);
  assert.equal(last(OWNER), "Запомнила, хозяин: Ураза-байрам — 20 марта 2027, один раз. В этот день пришлю открытку.");
  await h.onMessage(own("добавь праздник Навруз 21 марта"), KEY);
  await h.onMessage(own("праздники"), KEY);
  assert.match(last(OWNER), /1\. Новый год — 1 января, каждый год\n2\. Ураза-байрам — 20 марта 2027 \(один раз\)\n3\. Навруз — 21 марта, каждый год\n/u);
  await h.onMessage(message("добавь праздник Навруз 21 марта"), KEY);
  assert.equal(last(), "Праздники я отмечаю для хозяина, и список их ведёт он — в личке.");

  // Новый год: в восемь утра по Москве — рано; после девяти — открытка, один раз.
  const cards = () => photos().filter(item => String(item.chat_id) === String(OWNER));
  at = Date.parse("2027-01-01T05:00:00Z");
  await h.tick({});
  assert.equal(cards().length, 0);
  at = Date.parse("2027-01-01T06:05:00Z");
  await h.tick({});
  assert.equal(cards().length, 1);
  assert.equal(prompts().at(-1), OCCASIONS.newyear.prompt);
  assert.ok(pool("+открытка:новый год").includes(cards()[0].caption), cards()[0].caption);
  await h.tick({});
  await heart({ ...ON, GREET: true, TIME_ZONE: "Europe/Moscow" }, { now: () => at }).tick({});
  at = Date.parse("2027-01-01T12:00:00Z");
  await h.tick({});
  assert.equal(cards().length, 1, "второй раз в тот же день не поздравляет");

  // Праздник веры — без людей на картинке, с названием в подписи; с годом — только в тот год.
  at = Date.parse("2027-03-20T07:00:00Z");
  await h.tick({});
  assert.equal(cards().length, 2);
  assert.equal(prompts().at(-1), OCCASIONS.faith.prompt);
  assert.ok(pool("+открытка:праздник").map(line => `Ураза-байрам. ${line}`).includes(cards()[1].caption), cards()[1].caption);
  at = Date.parse("2028-03-20T07:00:00Z");
  await h.tick({});
  assert.equal(cards().length, 2, "праздник с годом через год не повторяется");
  at = Date.parse("2028-03-21T07:00:00Z");
  await h.tick({});
  assert.equal(cards().length, 3, "а без года — каждый год");

  // Мастерская молчит — поздравление словами; «не присылай открытки» — тишина.
  sdk().sourceReplies.length = 0;
  source("flux-1-schnell", { ok: false, status: 500, text: async () => "upstream" });
  at = Date.parse("2029-01-01T07:00:00Z");
  await h.tick({});
  assert.equal(cards().length, 3);
  assert.ok(pool("+открытка:новый год").includes(last(OWNER)), last(OWNER));
  await h.onMessage(own("не присылай открытки"), KEY);
  assert.match(last(OWNER), /сама открыток к праздникам не присылаю/u);
  const told = toOwner().length;
  at = Date.parse("2029-03-21T07:00:00Z");
  await h.tick({});
  assert.equal(toOwner().length, told);
  await h.onMessage(own("убери праздник Навруз"), KEY);
  assert.equal(last(OWNER), "Убрала: Навруз (21 марта).");
  await h.onMessage(own("убери праздник 9"), KEY);
  assert.match(last(OWNER), /^Такого праздника в списке нет\./u);
  assert.equal(JSON.parse(sdk().kv.get(HOLIDAYS_KEY)).cards, false);
  assert.equal(chats().length, 0);
});

test("круглый день знакомства: хозяину — открытка со строкой о дне, один раз; обычный день — ничего", async () => {
  reset();
  source("flux-1-schnell", image());
  let at = Date.parse("2026-08-06T09:00:00Z");
  const h = heart({ ...ON, GREET: true, TIME_ZONE: "Europe/Moscow" }, { now: () => at });
  await h.onMessage(own("привет"), KEY);
  const cards = () => photos().filter(item => String(item.chat_id) === String(OWNER));
  at = Date.parse("2026-11-13T09:00:00Z"); // 99-й день
  await h.tick({});
  assert.equal(cards().length, 0);
  at = Date.parse("2026-11-14T09:00:00Z"); // сотый
  await h.tick({});
  assert.equal(cards().length, 1);
  assert.equal(prompts().at(-1), OCCASIONS.known.prompt);
  assert.ok(pool("+открытка:знакомство").map(line => `Сегодня 100-й день, как мы знакомы. ${line}`).includes(cards()[0].caption), cards()[0].caption);
  at += 3 * 3_600_000;
  await h.tick({});
  assert.equal(cards().length, 1, "в тот же день — один раз");
  at = Date.parse("2027-08-06T09:00:00Z"); // ровно год
  await h.tick({});
  assert.equal(cards().length, 2);
  assert.match(cards()[1].caption, /^Сегодня ровно год, как мы знакомы\. /u);
  assert.equal(chats().length, 0, "модель не тратится");
});
