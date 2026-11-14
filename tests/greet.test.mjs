/**
 * Она пишет хозяину первой (утро и перед сном) и меняет поведение по
 * настроению: ворчливая и сонная — короче, игривая — поддразнит.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, chats, says, sdk, source, system, toOwner, toChat, OWNER, KEY, DAY } from "./fixtures/kit.mjs";

const { parseGreet, greetSettings, GREET_KEY } = await import("../tgcloud/lib/greet.js");
const { fajrOn, parseFajr, FAJR_METHODS } = await import("../tgcloud/lib/fajr.js");
const { moodOf, behaviourOf } = await import("../tgcloud/lib/mood.js");
const { createPhrasebook } = await import("../tgcloud/lib/phrasebook.js");

const ON = { PHRASES: true, GREET: true };
const at = (text) => Date.parse(text);
const own = (text) => message(text, { id: OWNER });
const book = createPhrasebook();
const MORNING = book.pool("+утро хозяину", { formal: true, vars: { "настроение": "X", "причина": "Y" } });
const NIGHT = book.pool("+ночь хозяину", { formal: true });
const HOUR = 3_600_000;

test("разбор: время утра и ночи, выключить, включить, спросить; обычное «доброе утро» — не настройка", () => {
  const cases = {
    "пиши мне доброе утро в 7:30": { set: "morning", time: "07:30" }, "желай доброго утра в 8": { set: "morning", time: "08:00" },
    "Желай спокойной ночи в 23 30.": { set: "night", time: "23:30" }, "пиши спокойной ночи в 11 вечера": { set: "night", time: "23:00" },
    "желай доброй ночи в 0:30": { set: "night", time: "00:30" },
    "не пиши мне первой": { off: "all" }, "не желай спокойной ночи": { off: "night" }, "не пиши по утрам": { off: "morning" },
    "пиши первой": { on: "all" }, "желай доброго утра": { on: "morning" }, "желай спокойной ночи": { on: "night" },
    "когда ты пишешь первой?": { show: true },
    "желай доброго утра на фаджр": { set: "morning", by: "fajr" }, "Пиши мне доброе утро по фаджру.": { set: "morning", by: "fajr" },
    "желай доброго утра с рассветом": { set: "morning", by: "fajr" }, "пиши мне к фаджру": { set: "morning", by: "fajr" },
  };
  for (const [said, want] of Object.entries(cases)) assert.deepEqual(parseGreet(said), want, said);
  for (const said of ["доброе утро", "спокойной ночи", "пиши мне", "желай удачи", "пиши доброе утро в 25", "не пиши ночью"]) assert.equal(parseGreet(said), null, said);
  assert.deepEqual(greetSettings(null), { byFajr: true, angle: null, morning: "06:00", night: "23:00", morningOff: false, nightOff: false, m: "", n: "" });
  // Час, названный до появления фаджра, остаётся часом; «на фаджр» — возвращает расчёт.
  assert.equal(greetSettings({ morning: "07:30" }).byFajr, false);
  assert.equal(greetSettings({ morning: "07:30" }).morning, "07:30");
  assert.equal(greetSettings({ morning: "07:30", by: "fajr" }).byFajr, true);
  assert.equal(greetSettings({ angle: 16 }).angle, 16);
  assert.equal(greetSettings({ angle: 90 }).angle, null);
});

test("утром и перед сном — по разу, в свой час, словами из словаря; опоздала на два часа — молчит", async () => {
  reset();
  // Города хозяина она не знает — фаджр не посчитать, утро в запасные шесть.
  let now = at("2026-11-18T02:30:00Z"); // 05:30 по Москве
  const h = heart(ON, { now: () => now });
  await h.tick({});
  assert.equal(toOwner().length, 0, "раньше времени не пишет");
  now = at("2026-11-18T03:05:00Z"); // 06:05
  await h.tick({});
  assert.equal(toOwner().length, 1);
  assert.ok(MORNING.some(line => toOwner()[0].text.startsWith(line.split("X")[0].slice(0, 12))), `утренняя строка из словаря: ${toOwner()[0].text}`);
  assert.match(toOwner()[0].text, /хозяин/iu);
  assert.doesNotMatch(toOwner()[0].text, /[{}]/u, "переменные подставлены");
  await h.tick({});
  now += 30 * 60_000;
  await h.tick({});
  assert.equal(toOwner().length, 1, "второй раз за утро не пишет");
  assert.equal(chats().length, 0, "модель не тратится");

  now = at("2026-11-18T20:10:00Z"); // 23:10
  await h.tick({});
  assert.equal(toOwner().length, 2);
  assert.ok(NIGHT.includes(toOwner()[1].text), `вечерняя строка из словаря: ${toOwner()[1].text}`);
  now = at("2026-11-18T21:30:00Z"); // 00:30 следующего дня — та же ночь
  await h.tick({});
  assert.equal(toOwner().length, 2, "ночь одна — и слова одни");

  // Будильник молчал до половины одиннадцатого: утро пропущено, вечером — снова пишет.
  now = at("2026-11-19T07:35:00Z");
  await h.tick({});
  assert.equal(toOwner().length, 2);
  // Через полночь: в 23:00 будильник молчал, в 00:40 — ещё уместно.
  now = at("2026-11-19T21:40:00Z");
  await h.tick({});
  assert.equal(toOwner().length, 3);
  assert.ok(NIGHT.includes(toOwner()[2].text));

  // Сказанное остаётся в переписке: ответ хозяина модель поймёт.
  sdk().fetchQueue.push(says("И вам, хозяин."));
  now += 60_000;
  await h.onMessage(own("а ты сама-то отдыхаешь хоть иногда, расскажи подробно"), KEY);
  const history = JSON.parse(chats().at(-1).options.body).messages.map(item => item.content).join("\n");
  assert.ok(history.includes(toOwner()[2].text), "её вечерние слова есть в истории");
});

test("не повторяет сказанное: с утра уже говорили, «спокойной ночи» он сказал сам", async () => {
  reset();
  let now = at("2026-11-18T02:20:00Z"); // 05:20 — хозяин уже пишет
  const h = heart(ON, { now: () => now });
  await h.onMessage(own("привет"), KEY);
  const before = toOwner().length;
  now = at("2026-11-18T03:10:00Z"); // 06:10
  await h.tick({});
  assert.equal(toOwner().length, before, "уже разговаривали утром — «доброе утро» вдогонку не шлёт");

  now = at("2026-11-18T19:50:00Z"); // 22:50
  await h.onMessage(own("спокойной ночи"), KEY);
  const after = toOwner().length;
  now = at("2026-11-18T20:15:00Z");
  await h.tick({});
  assert.equal(toOwner().length, after, "он уже попрощался на ночь");
});

test("время и выключатель — словами хозяина; другим она первой не пишет и настройку от них не берёт", async () => {
  reset();
  let now = at("2026-11-18T09:00:00Z");
  const h = heart(ON, { now: () => now });
  await h.onMessage(own("желай доброго утра в 6:30"), KEY);
  assert.match(last(OWNER), /Хорошо, хозяин: доброе утро — в 06:30; спокойной ночи — в 23:00\./u);
  await h.onMessage(own("желай спокойной ночи в 0:30"), KEY);
  await h.onMessage(own("когда ты пишешь первой?"), KEY);
  assert.match(last(OWNER), /доброе утро — в 06:30; спокойной ночи — в 00:30/u);
  const count = toOwner().length;
  now = at("2026-11-19T03:40:00Z"); // 06:40
  await h.tick({});
  assert.equal(toOwner().length, count + 1, "в новый час — пишет");
  now = at("2026-11-19T05:10:00Z"); // 08:10 — второго утра за день нет
  await h.tick({});
  assert.equal(toOwner().length, count + 1);

  await h.onMessage(own("не пиши по утрам"), KEY);
  assert.match(last(OWNER), /по утрам не пишу; спокойной ночи — в 00:30/u);
  await h.onMessage(own("не пиши первой"), KEY);
  assert.match(last(OWNER), /первой писать не буду/u);
  const quiet = toOwner().length;
  for (const moment of ["2026-11-20T03:40:00Z", "2026-11-20T21:40:00Z"]) { now = at(moment); await h.tick({}); }
  assert.equal(toOwner().length, quiet, "выключено — молчит");
  await h.onMessage(own("пиши первой"), KEY);
  assert.match(last(OWNER), /доброе утро — в 06:30; спокойной ночи — в 00:30/u);

  // Посторонний: настройка не его, и первой ему никто не пишет.
  sdk().fetchQueue.push(says("Ответ модели."));
  await h.onMessage(message("не пиши первой"), KEY);
  assert.equal(last(), "Ответ модели.");
  assert.equal(JSON.parse(sdk().kv.get(GREET_KEY)).morningOff, false);

  // Выключено настройкой сборки или нет словаря — не пишет вовсе.
  for (const config of [{ PHRASES: true, GREET: false }, { PHRASES: false, GREET: true }]) {
    reset();
    now = at("2026-11-18T03:05:00Z");
    const off = heart(config, { now: () => now });
    await off.tick({});
    assert.equal(toOwner().length, 0);
  }
});

// ── утро на фаджр ────────────────────────────────────────────────────────
const utc = (text) => new Date(text).toISOString().slice(0, 16);
const moscow = () => source("geocoding-api.open-meteo.com", { results: [{ name: "Москва", country: "Россия", admin1: "Москва", latitude: 55.7558, longitude: 37.6173, timezone: "Europe/Moscow", feature_code: "PPLC" }] });

test("фаджр по солнцу: сверено с открытой библиотекой расчёта намаза — расхождение меньше двух минут", () => {
  // Эталон — пакет adhan 4.4.6 (правило высоких широт «угол сумерек», без округления): место, дата, угол → фаджр и восход, UTC.
  const rows = [
    ["Мекка", 21.4225, 39.8262, 2026, 3, 1, 18.5, "2026-03-01T02:25Z", "2026-03-01T03:41Z", false],
    ["Москва", 55.7558, 37.6173, 2026, 11, 14, 18, "2026-11-14T02:52Z", "2026-11-14T05:02Z", false],
    ["Москва", 55.7558, 37.6173, 2026, 11, 14, 16, "2026-11-14T03:06Z", "2026-11-14T05:02Z", false],
    ["Казань", 55.7887, 49.1221, 2026, 1, 15, 16, "2026-01-15T03:02Z", "2026-01-15T05:03Z", false],
    ["Амстердам", 52.3676, 4.9041, 2026, 11, 14, 18, "2026-11-14T05:00Z", "2026-11-14T06:59Z", false],
    ["Амстердам", 52.3676, 4.9041, 2026, 6, 21, 18, "2026-06-21T01:08Z", "2026-06-21T03:18Z", true],
    ["Джакарта", -6.2088, 106.8456, 2026, 7, 7, 18, "2026-07-06T21:49Z", "2026-07-06T23:04Z", false],
    ["Нью-Йорк", 40.7128, -74.006, 2026, 12, 25, 15, "2026-12-25T10:56Z", "2026-12-25T12:18Z", false],
    ["Владивосток", 43.1155, 131.8855, 2026, 4, 10, 18, "2026-04-09T18:59Z", "2026-04-09T20:39Z", false],
    ["Гонолулу", 21.3069, -157.8583, 2026, 9, 9, 18, "2026-09-09T15:02Z", "2026-09-09T16:17Z", false],
    ["Санкт-Петербург", 59.9311, 30.3609, 2026, 6, 1, 16, "2026-05-31T23:17Z", "2026-06-01T00:48Z", true],
    ["Кейптаун", -33.9249, 18.4241, 2027, 2, 2, 18, "2027-02-02T02:34Z", "2027-02-02T04:08Z", false],
  ];
  for (const [name, latitude, longitude, y, m, d, angle, fajr, sunrise, adjusted] of rows) {
    const got = fajrOn({ y, m, d, latitude, longitude, angle });
    assert.ok(got, name);
    assert.ok(Math.abs(got.fajr - Date.parse(fajr.replace("Z", ":00Z"))) < 120_000, `${name}: фаджр ${utc(got.fajr)} против ${fajr}`);
    assert.ok(Math.abs(got.sunrise - Date.parse(sunrise.replace("Z", ":00Z"))) < 120_000, `${name}: восход ${utc(got.sunrise)} против ${sunrise}`);
    assert.equal(got.adjusted, adjusted, `${name}: белые ночи — долей ночи`);
  }
  // За полярным кругом в солнцестояние восхода нет — и расчёта нет; негодные числа — тоже.
  assert.equal(fajrOn({ y: 2026, m: 6, d: 21, latitude: 69.6, longitude: 18.9 }), null);
  assert.equal(fajrOn({ y: 2026, m: 12, d: 21, latitude: 69.6, longitude: 18.9 }), null);
  assert.equal(fajrOn({ y: 2026, m: 6, d: 21, latitude: 91, longitude: 0 }), null);
  assert.equal(fajrOn({ y: 2026, m: 6, d: 21, latitude: 50, longitude: 10, angle: 40 }), null);
  assert.equal(fajrOn({ y: 2026, m: 6, d: 21, latitude: "x", longitude: 10 }), null);
  // Фаджр всегда раньше восхода, в любой день года и на любой широте, где восход есть.
  for (const latitude of [-60, -35, 0, 25, 45, 56, 64]) for (let day = 1; day <= 365; day += 9) {
    const date = new Date(Date.UTC(2026, 0, day));
    const got = fajrOn({ y: 2026, m: date.getUTCMonth() + 1, d: date.getUTCDate(), latitude, longitude: 30 });
    assert.ok(got && got.fajr < got.sunrise && got.sunrise - got.fajr < 5 * HOUR, `${latitude}° день ${day}`);
  }
});

test("слова о фаджре: спросить время, сменить угол или общину; чужие фразы — мимо", () => {
  const cases = {
    "когда фаджр": { show: true, tomorrow: false }, "Во сколько сегодня фаджр?": { show: true, tomorrow: false },
    "во сколько завтра фаджр": { show: true, tomorrow: true }, "когда фаджр завтра": { show: true, tomorrow: true },
    "время фаджра": { show: true, tomorrow: false }, "когда начинается утренний намаз": { show: true, tomorrow: false },
    "фаджр": { show: true, tomorrow: false }, "а когда у нас фаджр": { show: true, tomorrow: false },
    "угол фаджра 16": { angle: 16 }, "фаджр по 16 градусам": { angle: 16 }, "считай фаджр по углу 19,5": { angle: 19.5 },
    "считай фаджр по ДУМ": { method: "russia", angle: 16 }, "фаджр по Турции": { method: "turkey", angle: 18 },
    "считай фаджр как в Египте": { method: "egypt", angle: 19.5 }, "фаджр по исна": { method: "isna", angle: 15 },
    "как ты считаешь фаджр?": { methods: true },
  };
  for (const [said, want] of Object.entries(cases)) assert.deepEqual(parseFajr(said), want, said);
  for (const said of ["привет", "доброе утро", "я проспал фаджр", "фаджр по 90 градусам", "расскажи про фаджр подробно, что это за намаз",
    "утренний намаз я уже прочитал", "считай фаджр по настроению", "когда рассвет", "фаджр по 3"]) assert.equal(parseFajr(said), null, said);
  assert.ok(FAJR_METHODS.every(item => item.angle >= 15 && item.angle <= 19.5));
});

test("утро на фаджр: город хозяина известен — пишет с началом рассвета, а не в шесть", async () => {
  reset();
  moscow();
  let now = at("2026-11-13T09:00:00Z");
  const h = heart({ ...ON, SOURCES: true }, { now: () => now });
  await h.onMessage(own("мой город — Москва"), KEY);
  assert.match(last(OWNER), /Запомнила: ваш город — Москва/u);
  await h.onMessage(own("когда ты пишешь первой?"), KEY);
  // 13 ноября в Москве фаджр (18°) — около 05:50.
  assert.match(last(OWNER), /доброе утро — на фаджр \(сегодня он в 05:5\d, Москва\); спокойной ночи — в 23:00/u);
  const count = toOwner().length;

  // 14 ноября фаджр в Москве — 05:52 (02:52 UTC). В 05:45 — рано; в шесть по часам уже не ждёт.
  now = at("2026-11-14T02:45:00Z");
  await h.tick({});
  assert.equal(toOwner().length, count, "до фаджра молчит");
  now = at("2026-11-14T02:54:00Z"); // 05:54
  await h.tick({});
  assert.equal(toOwner().length, count + 1, "с началом фаджра — пишет");
  assert.ok(MORNING.some(line => toOwner().at(-1).text.startsWith(line.split("X")[0].slice(0, 12))), toOwner().at(-1).text);
  assert.doesNotMatch(toOwner().at(-1).text, /фаджр|намаз/iu, "о времени молитвы она не объявляет: это приветствие");
  now = at("2026-11-14T03:10:00Z"); // 06:10
  await h.tick({});
  assert.equal(toOwner().length, count + 1, "второй раз за утро не пишет");
  assert.equal(chats().length, 0);
  // Координаты лежат рядом с настройкой: будильник в справочник больше не ходит.
  assert.equal(JSON.parse(sdk().kv.get(GREET_KEY)).spot.city, "Москва");
  const lookups = sdk().sourceFetches.filter(item => item.url.includes("geocoding")).length;
  now = at("2026-11-15T02:56:00Z");
  await h.tick({});
  assert.equal(sdk().sourceFetches.filter(item => item.url.includes("geocoding")).length, lookups);
  assert.equal(toOwner().length, count + 2, "и на следующий день — по фаджру");

  // Назвал час — пишет по часам; «на фаджр» — возвращает расчёт.
  await h.onMessage(own("желай доброго утра в 7:30"), KEY);
  assert.match(last(OWNER), /доброе утро — в 07:30; спокойной ночи — в 23:00/u);
  const fixed = toOwner().length;
  now = at("2026-11-16T02:58:00Z"); // 05:58 — фаджр уже был, но час назначен другой
  await h.tick({});
  assert.equal(toOwner().length, fixed);
  await h.onMessage(own("желай доброго утра на фаджр"), KEY);
  assert.match(last(OWNER), /доброе утро — на фаджр \(сегодня он в 05:5\d, Москва\)/u);
});

test("«когда фаджр?»: время для города человека, с оговоркой; без города — просит город; угол меняет только хозяин", async () => {
  reset();
  moscow();
  const now = at("2026-11-14T09:00:00Z");
  const h = heart({ ...ON, SOURCES: true }, { now: () => now });
  await h.onMessage(message("когда фаджр?"), KEY);
  assert.match(last(), /мне нужен ваш город\. Скажите: «я живу в Казани»/u);
  await h.onMessage(message("мой город — Москва"), KEY);
  await h.onMessage(message("когда фаджр?"), KEY);
  assert.match(last(), /^Фаджр сегодня — в 05:52, восход — в 08:02 \(Москва, угол 18°\)\. Это мой расчёт по солнцу, а не расписание мечети/u);
  await h.onMessage(message("во сколько завтра фаджр"), KEY);
  assert.match(last(), /^Фаджр завтра — в 05:5\d/u);
  await h.onMessage(message("угол фаджра 16"), KEY);
  assert.equal(last(), "Угол для расчёта выбирает хозяин — и в личке.");

  await h.onMessage(own("мой город — Москва"), KEY);
  await h.onMessage(own("считай фаджр по ДУМ"), KEY);
  assert.match(last(OWNER), /^Хорошо, хозяин: фаджр считаю по углу 16° \(ДУМ России\)\. Фаджр сегодня — в 06:06/u);
  await h.onMessage(message("когда фаджр"), KEY);
  assert.match(last(), /в 06:06.*угол 16°/u, "угол хозяина — для всех");
  await h.onMessage(own("как ты считаешь фаджр?"), KEY);
  assert.match(last(OWNER), /на 16° \(ДУМ России\) ниже горизонта.*Всемирная исламская лига — 18°.*Сменить — «считай фаджр по ДУМ»/u);
  assert.equal(chats().length, 0, "модель не тратится");
});

// ── настроение меняет поведение ──────────────────────────────────────────
/** Человек, у которого в этот час нужное настроение: зерно зависит от его номера. */
const someone = (moment, mood, extra = {}) => {
  for (let id = 100; id < 400; id += 1) if (moodOf({ now: moment, timeZone: "Europe/Moscow", userId: id, ...extra }).mood === mood) return id;
  throw new Error(`не нашлось человека с настроением «${mood}»`);
};
/** Случайность с зерном: одна и та же последовательность для сравнения. */
const seeded = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

test("настроение → поведение: виды и подсказки модели", () => {
  assert.equal(behaviourOf("ворчливое").kind, "short");
  assert.equal(behaviourOf("сонное").kind, "short");
  assert.equal(behaviourOf("игривое").kind, "playful");
  assert.equal(behaviourOf("мечтательное").kind, "soft");
  assert.equal(behaviourOf("разговорчивое").kind, "chatty");
  assert.deepEqual(behaviourOf("деловое"), { kind: "plain", hint: "" });
  assert.match(behaviourOf("уставшее").hint, /короче обычного/u);
  assert.match(behaviourOf("хулиганское").hint, /шутить и поддразнивать/u);
});

test("сонная и ворчливая отвечают короче; модели говорится то же", async () => {
  const night = at("2026-11-17T23:30:00Z"); // 02:30 по Москве
  const noon = at("2026-11-18T09:00:00Z");
  const sleepy = someone(night, "сонное");
  const plain = someone(noon, "деловое");
  const total = async (moment, id) => {
    let sum = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      reset();
      const h = heart({ PHRASES: true }, { now: () => moment, random: seeded(seed) });
      await h.onMessage(message("что делаешь", { id }), KEY);
      sum += last(id).length;
    }
    return sum;
  };
  const [short, usual] = [await total(night, sleepy), await total(noon, plain)];
  assert.ok(short < usual, `сонная в сумме короче: ${short} против ${usual}`);

  reset();
  const h = heart({ PHRASES: true }, { now: () => night });
  sdk().fetchQueue.push(says("Мм."));
  await h.onMessage(message("объясни в двух словах, почему ночью тихо", { id: sleepy }), KEY);
  assert.match(system(), /Настроение: сонное/u);
  assert.match(system(), /Сейчас отвечай короче обычного и чуть суше/u);
  sdk().fetchQueue.push(says("Да."));
  const calm = heart({ PHRASES: true }, { now: () => noon });
  await calm.onMessage(message("объясни в двух словах, почему днём шумно", { id: plain }), KEY);
  assert.doesNotMatch(system(), /Сейчас отвечай короче|Сейчас можно шутить/u, "обычное настроение — без добавки");
});

test("игривая поддразнит вдогонку — не всегда, не на прощание и не к серьёзному", async () => {
  const friday = at("2026-11-20T13:30:00Z"); // пятница, 16:30
  const id = someone(friday, "игривое");
  const tails = book.pool("+настроение:игривое", { formal: true });
  const ask = async (text, roll) => {
    reset();
    const h = heart({ PHRASES: true }, { now: () => friday, random: () => roll });
    await h.onMessage(message(text, { id }), KEY);
    return last(id);
  };
  const teased = await ask("где ты живешь", 0.1);
  assert.ok(tails.some(tail => teased.endsWith(` ${tail}`)), `в ответ добавлена игривая строка: ${teased}`);
  const calm = await ask("где ты живешь", 0.9);
  assert.ok(!tails.some(tail => calm.endsWith(` ${tail}`)), "чаще — без добавки");
  const bye = await ask("пока", 0.1);
  assert.ok(!tails.some(tail => bye.endsWith(` ${tail}`)), "на прощание не дразнит");
  const grave = await ask("не хочу жить", 0.1);
  assert.match(grave, /112/u);
  assert.ok(!tails.some(tail => grave.endsWith(` ${tail}`)), "к серьёзному — ничего вдогонку");
});
