/**
 * Намазы: все времена дня по солнцу для города человека и напоминание заранее.
 * Расчёт сверен с открытой библиотекой; слова — без модели; напоминание
 * считается заново при каждом пробуждении и не повторяется.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, chats, source, sdk, toChat, toOwner, OWNER, KEY } from "./fixtures/kit.mjs";

const { prayersOn, ishaRule, methodExtras, FAJR_METHODS } = await import("../tgcloud/lib/fajr.js");
const { parsePrayer, inWords, PRAYER_KEY } = await import("../tgcloud/lib/prayer.js");
const { localClock } = await import("../tgcloud/lib/time.js");

const MINUTE = 60_000;
const at = (text) => Date.parse(text);
const own = (text) => message(text, { id: OWNER });
const moscow = () => source("geocoding-api.open-meteo.com", { results: [{ name: "Москва", country: "Россия", admin1: "Москва", latitude: 55.7558, longitude: 37.6173, timezone: "Europe/Moscow", feature_code: "PPLC" }] });
const SPOT = { latitude: 55.7558, longitude: 37.6173 };
const msk = (ms) => localClock(ms, "Europe/Moscow");
const subs = () => JSON.parse(sdk().kv.get(PRAYER_KEY) ?? "null")?.subs ?? {};

test("времена намаза по солнцу: сверено с открытой библиотекой расчёта — расхождение меньше двух минут", () => {
  // Эталон — пакет adhan 4.4.6 (правило высоких широт «угол сумерек», без поправок метода и без округления).
  const rows = [
    ["Лелистад, ноябрь, Лига", 52.52, 5.47, 2026, 11, 15, 1, { angle: 18, isha: 17 }, "2026-11-15T04:59:48Z", "2026-11-15T06:59:47Z", "2026-11-15T11:22:42Z", "2026-11-15T13:21:12Z", "2026-11-15T15:45:01Z", "2026-11-15T17:38:14Z"],
    ["Москва, ноябрь, Лига", 55.7558, 37.6173, 2026, 11, 14, 1, { angle: 18, isha: 17 }, "2026-11-14T02:52:04Z", "2026-11-14T05:02:32Z", "2026-11-14T09:13:56Z", "2026-11-14T11:00:20Z", "2026-11-14T13:24:40Z", "2026-11-14T15:27:48Z"],
    ["Казань, март, Лига, ханафи", 55.79, 49.12, 2026, 3, 20, 2, { angle: 18, isha: 17 }, "2026-03-20T00:39:21Z", "2026-03-20T02:46:18Z", "2026-03-20T08:51:00Z", "2026-03-20T12:53:17Z", "2026-03-20T14:56:53Z", "2026-03-20T16:56:35Z"],
    ["Мекка, январь, Умм аль-Кура", 21.42, 39.83, 2026, 1, 10, 1, { angle: 18.5, ishaMinutes: 90 }, "2026-01-10T02:39:43Z", "2026-01-10T04:00:34Z", "2026-01-10T09:28:09Z", "2026-01-10T12:34:42Z", "2026-01-10T14:55:52Z", "2026-01-10T16:25:52Z"],
    ["Каир, июль, Египет", 30.04, 31.24, 2026, 7, 1, 1, { angle: 19.5, isha: 17.5 }, "2026-07-01T01:11:47Z", "2026-07-01T02:57:23Z", "2026-07-01T09:58:56Z", "2026-07-01T13:34:32Z", "2026-07-01T17:00:21Z", "2026-07-01T18:33:22Z"],
    ["Нью-Йорк, сентябрь, ИСНА, ханафи", 40.71, -74, 2026, 9, 23, 2, { angle: 15, isha: 15 }, "2026-09-23T09:29:06Z", "2026-09-23T10:44:34Z", "2026-09-23T16:48:17Z", "2026-09-23T21:03:36Z", "2026-09-23T22:51:19Z", "2026-09-24T00:06:33Z"],
    ["Джакарта, май, Карачи", -6.2, 106.85, 2026, 5, 5, 1, { angle: 18, isha: 18 }, "2026-05-04T21:41:24Z", "2026-05-04T22:53:05Z", "2026-05-05T04:49:19Z", "2026-05-05T08:10:53Z", "2026-05-05T10:45:30Z", "2026-05-05T11:57:13Z"],
    ["Амстердам, июнь, Лига (доля ночи)", 52.37, 4.9, 2026, 6, 21, 1, { angle: 18, isha: 17 }, "2026-06-21T01:08:27Z", "2026-06-21T03:18:00Z", "2026-06-21T11:42:13Z", "2026-06-21T16:06:55Z", "2026-06-21T20:06:26Z", "2026-06-21T22:08:46Z"],
  ];
  for (const [name, latitude, longitude, y, m, d, asr, rules, ...theirs] of rows) {
    const got = prayersOn({ y, m, d, latitude, longitude, asr, ...rules });
    for (const [index, key] of ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"].entries()) {
      assert.ok(Math.abs(got[key] - Date.parse(theirs[index])) < 2 * MINUTE, `${name}: ${key} ${new Date(got[key]).toISOString()} против ${theirs[index]}`);
    }
  }
  assert.deepEqual(prayersOn({ y: 2026, m: 6, d: 21, latitude: 52.37, longitude: 4.9 }).adjusted, { fajr: true, isha: true }, "летом в Амстердаме — долей ночи");
  assert.deepEqual(prayersOn({ y: 2026, m: 11, d: 15, latitude: 52.52, longitude: 5.47 }).adjusted, { fajr: false, isha: false });
  // Порядок времён — в любой день и на любой широте, где есть восход и закат; ханафитский аср — позже.
  for (const latitude of [-45, -20, 0, 21, 41, 52, 56, 60]) for (let day = 1; day <= 365; day += 13) {
    const date = new Date(Date.UTC(2026, 0, day));
    const base = { y: 2026, m: date.getUTCMonth() + 1, d: date.getUTCDate(), latitude, longitude: 30 };
    const got = prayersOn(base);
    assert.ok(got.fajr < got.sunrise && got.sunrise < got.dhuhr && got.dhuhr < got.asr && got.asr < got.maghrib && got.maghrib < got.isha, `${latitude}° день ${day}`);
    assert.ok(prayersOn({ ...base, asr: 2 }).asr > got.asr, `${latitude}° день ${day}: ханафи позже`);
  }
  assert.equal(prayersOn({ y: 2026, m: 6, d: 21, latitude: 80, longitude: 10 }), null, "за полярным кругом летом заката нет");
  // Иша: по методу; только угол фаджра — по первому методу с таким углом; иначе — на градус меньше.
  assert.deepEqual(ishaRule({ method: "russia", angle: 16 }), { isha: 15 });
  assert.deepEqual(ishaRule({ method: "makkah", angle: 18.5 }), { ishaMinutes: 90 });
  assert.deepEqual(ishaRule({ angle: 19.5 }), { isha: 17.5 });
  assert.deepEqual(ishaRule({ angle: 17 }), { isha: 16 });
  assert.ok(FAJR_METHODS.every(item => (item.isha >= 14 && item.isha <= 18) || item.ishaMinutes === 90));
});

test("слова о намазе: расписание, один намаз, следующий, напоминание, школа асра; чужие фразы — мимо", () => {
  const cases = {
    "намазы на сегодня": { list: true, tomorrow: false }, "Намазы": { list: true, tomorrow: false }, "расписание намазов на завтра": { list: true, tomorrow: true },
    "время намаза": { list: true, tomorrow: false }, "когда намаз?": { list: true, tomorrow: false }, "покажи время намазов": { list: true, tomorrow: false },
    "когда магриб": { one: "maghrib", tomorrow: false }, "во сколько завтра иша": { one: "isha", tomorrow: true }, "когда зухр": { one: "dhuhr", tomorrow: false },
    "когда аср?": { one: "asr", tomorrow: false }, "когда ифтар": { one: "maghrib", tomorrow: false }, "когда ахшам": { one: "maghrib", tomorrow: false },
    "когда вечерний намаз": { one: "maghrib", tomorrow: false }, "когда икенде": { one: "asr", tomorrow: false }, "магриб завтра": { one: "maghrib", tomorrow: true },
    "когда шурук": { one: "sunrise", tomorrow: false }, "сколько до магриба": { one: "maghrib", left: true }, "сколько осталось до ифтара": { one: "maghrib", left: true },
    "следующий намаз": { next: true }, "сколько до намаза": { next: true }, "какой сейчас намаз": { next: true }, "когда следующий намаз?": { next: true },
    "напоминай о намазе": { remind: 10 }, "напоминай о намазе за 10 минут": { remind: 10 }, "напоминай за 15 минут до намаза": { remind: 15 },
    "напоминай о намазах вовремя": { remind: 0 }, "включи напоминание о намазе за 5 минут": { remind: 5 }, "напоминай перед каждым намазом за 20 минут": { remind: 20 },
    "не напоминай о намазе": { remind: false }, "выключи напоминания о намазах": { remind: false }, "хватит напоминать о намазе": { remind: false },
    "аср по ханафи": { asr: 2 }, "считай аср по шафии": { asr: 1 }, "как ты считаешь намазы?": { how: true },
  };
  for (const [said, want] of Object.entries(cases)) assert.deepEqual(parsePrayer(said), want, said);
  for (const said of ["привет", "напомни через час про намаз", "я читаю намаз", "намаз — это важно", "расскажи про намаз", "иша", "аср", "магриб", "вечерний намаз",
    "когда миша придёт", "напоминай о намазе за 99 минут", "сколько до зарплаты", "напомни про намаз завтра в 5", "как читать намаз", "научи намазу",
    "сколько ракаатов в магрибе", "намаз сделал", "когда аспирин пить", "не напоминай", "напоминай о зарядке за 10 минут", "когда рассвет", "что такое аср",
    "я пропустил зухр", "магрибский шёлк красивый", "напоминай о намазе каждый час с криком"]) assert.equal(parsePrayer(said), null, said);
  assert.deepEqual([inWords(30_000), inWords(7 * MINUTE), inWords(72 * MINUTE), inWords(120 * MINUTE)], ["через минуту", "через 7 мин", "через 1 ч 12 мин", "через 2 ч"]);
});

test("намазы словами: расписание на день, один намаз, следующий; без города — просит город; правила меняет хозяин", async () => {
  reset();
  moscow();
  let now = at("2026-11-14T09:00:00Z"); // 12:00 в Москве
  const h = heart({ SOURCES: true, TIME_ZONE: "Europe/Moscow" }, { now: () => now });
  await h.onMessage(own("намазы на сегодня"), KEY);
  assert.match(last(OWNER), /мне нужен ваш город/u);
  await h.onMessage(own("мой город — Москва"), KEY);
  const day = prayersOn({ y: 2026, m: 11, d: 14, ...SPOT });
  await h.onMessage(own("намазы на сегодня"), KEY);
  assert.equal(last(OWNER), [
    "Намазы на сегодня (Москва):",
    `Фаджр — ${msk(day.fajr)}`, `Восход — ${msk(day.sunrise)}`, `Зухр — ${msk(day.dhuhr)}`, `Аср — ${msk(day.asr)}`, `Магриб — ${msk(day.maghrib)}`, `Иша — ${msk(day.isha)}`,
    "",
    "Расчёт: фаджр — 18°, иша — 17°, аср — одна тень. Это мой расчёт по солнцу, а не расписание мечети: расхождение в несколько минут — обычное дело, и в сомнении верить надо ей.",
  ].join("\n"));
  assert.match(last(OWNER), /Фаджр — 05:52\nВосход — 08:02\nЗухр — 12:1[34]\nАср — 14:0[01]\nМагриб — 16:2[45]\nИша — 18:2[78]/u, "те же минуты, что у эталона");

  await h.onMessage(own("когда магриб?"), KEY);
  assert.equal(last(OWNER), `Магриб сегодня — в ${msk(day.maghrib)} (Москва): ${inWords(day.maghrib - now)}.`);
  await h.onMessage(own("когда фаджр"), KEY);
  assert.match(last(OWNER), /^Фаджр сегодня — в 05:52, восход — в 08:02/u, "о фаджре — прежний подробный ответ");
  await h.onMessage(own("когда зухр"), KEY);
  assert.equal(last(OWNER), `Зухр сегодня — в ${msk(day.dhuhr)} (Москва): ${inWords(day.dhuhr - now)}.`);
  await h.onMessage(own("следующий намаз"), KEY);
  assert.equal(last(OWNER), `Следующий намаз — зухр, в ${msk(day.dhuhr)}: ${inWords(day.dhuhr - now)}. Сейчас — время фаджра: с ${msk(day.fajr)}.`);
  await h.onMessage(own("сколько до ифтара"), KEY);
  assert.equal(last(OWNER), `До магриба — ${inWords(day.maghrib - now).replace("через ", "")}: сегодня в ${msk(day.maghrib)} (Москва).`);

  // Вечером: прошедший намаз — «был», и время на завтра; следующий — завтрашний фаджр.
  now = at("2026-11-14T17:00:00Z"); // 20:00
  const next = prayersOn({ y: 2026, m: 11, d: 15, ...SPOT });
  await h.onMessage(own("когда магриб"), KEY);
  assert.equal(last(OWNER), `Магриб сегодня был в ${msk(day.maghrib)}; завтра — в ${msk(next.maghrib)} (Москва).`);
  await h.onMessage(own("следующий намаз"), KEY);
  assert.match(last(OWNER), new RegExp(`^Следующий намаз — фаджр, в ${msk(next.fajr)}: через 9 ч \\d+ мин\\. Сейчас — время иша: с ${msk(day.isha)}\\.$`, "u"));
  await h.onMessage(own("расписание намазов на завтра"), KEY);
  assert.match(last(OWNER), new RegExp(`^Намазы на завтра \\(Москва\\):\\nФаджр — ${msk(next.fajr)}\\n`, "u"));

  // Правила: школу асра и метод выбирает хозяин; от метода зависит иша.
  await h.onMessage(message("аср по ханафи"), KEY);
  assert.equal(last(), "Школу для расчёта асра выбирает хозяин — и в личке.");
  await h.onMessage(own("аср по ханафи"), KEY);
  assert.match(last(OWNER), /аср считаю по ханафитской школе/u);
  await h.onMessage(own("считай фаджр по ДУМ"), KEY);
  await h.onMessage(own("намазы на завтра"), KEY);
  const strict = prayersOn({ y: 2026, m: 11, d: 15, ...SPOT, angle: 16, isha: 15, asr: 2 });
  assert.match(last(OWNER), new RegExp(`Фаджр — ${msk(strict.fajr)}\\n.*\\nАср — ${msk(strict.asr)}\\nМагриб — ${msk(strict.maghrib)}\\nИша — ${msk(strict.isha)}\\n\\nРасчёт: фаджр — 16°, иша — 15°, аср — две тени \\(ханафитская школа\\)\\.`, "su"));
  assert.ok(strict.asr > next.asr && strict.isha < next.isha);
  await h.onMessage(own("как ты считаешь намазы?"), KEY);
  assert.match(last(OWNER), /по солнцу, для вашего города: фаджр — 16°, иша — 15°, аср — две тени/u);

  // Другому человеку — те же слова; без города она просит город.
  await h.onMessage(message("когда магриб"), KEY);
  assert.match(last(), /мне нужен (?:твой|ваш) город/u);
  assert.equal(chats().length, 0, "модель для этого не нужна");
});

test("метод целиком — как у библиотеки: минуты Диянета, угол магриба Тегерана, минута зухра; поправки хозяина — словом", async () => {
  // Эталон — пакет adhan 4.4.6 с собственными минутами метода, время округлено до минуты.
  const rows = [
    ["Стамбул, ноябрь, Диянет", 41.01, 28.98, 2026, 11, 15, 1, "turkey", "2026-11-15T03:16Z", "2026-11-15T04:44Z", "2026-11-15T09:54Z", "2026-11-15T12:28Z", "2026-11-15T14:53Z", "2026-11-15T16:15Z"],
    ["Лелистад, июнь, Диянет, ханафи", 52.52, 5.47, 2026, 6, 10, 2, "turkey", "2026-06-10T01:05Z", "2026-06-10T03:09Z", "2026-06-10T11:43Z", "2026-06-10T17:20Z", "2026-06-10T20:07Z", "2026-06-10T22:03Z"],
    ["Тегеран, март, Тегеран", 35.69, 51.39, 2026, 3, 20, 1, "tehran", "2026-03-20T01:15Z", "2026-03-20T02:38Z", "2026-03-20T08:42Z", "2026-03-20T12:09Z", "2026-03-20T15:04Z", "2026-03-20T15:51Z"],
    ["Москва, ноябрь, Лига", 55.7558, 37.6173, 2026, 11, 14, 1, "mwl", "2026-11-14T02:52Z", "2026-11-14T05:03Z", "2026-11-14T09:15Z", "2026-11-14T11:00Z", "2026-11-14T13:25Z", "2026-11-14T15:28Z"],
  ];
  for (const [name, latitude, longitude, y, m, d, asr, key, ...theirs] of rows) {
    const method = FAJR_METHODS.find(item => item.key === key);
    const got = prayersOn({ y, m, d, latitude, longitude, asr, angle: method.angle, ...ishaRule({ method: key, angle: method.angle }), ...methodExtras(key) });
    for (const [index, time] of ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"].entries()) {
      assert.ok(Math.abs(got[time] - Date.parse(theirs[index])) < 2 * MINUTE, `${name}: ${time} ${new Date(got[time]).toISOString()} против ${theirs[index]}`);
    }
  }
  // Метод не назван — чистый расчёт; минуты метода — отдельно от углов.
  assert.deepEqual(methodExtras(""), { shift: {} });
  assert.deepEqual(methodExtras("russia"), { shift: {} });
  assert.deepEqual(methodExtras("turkey"), { shift: { sunrise: -7, dhuhr: 5, asr: 4, maghrib: 7 } });
  assert.deepEqual(methodExtras("tehran"), { shift: {}, maghribAngle: 4.5 });
  const pure = prayersOn({ y: 2026, m: 3, d: 20, latitude: 35.69, longitude: 51.39 });
  const late = prayersOn({ y: 2026, m: 3, d: 20, latitude: 35.69, longitude: 51.39, maghribAngle: 4.5 });
  assert.ok(late.maghrib - pure.maghrib > 10 * MINUTE && late.maghrib - pure.maghrib < 30 * MINUTE && late.maghrib < late.isha, "магриб по углу — позже заката, раньше иша");
  const moved = prayersOn({ y: 2026, m: 3, d: 20, latitude: 35.69, longitude: 51.39, shift: { maghrib: 3, fajr: -2, isha: 90 } });
  assert.deepEqual([moved.maghrib - pure.maghrib, moved.fajr - pure.fajr, moved.isha - pure.isha, moved.dhuhr - pure.dhuhr], [3 * MINUTE, -2 * MINUTE, 30 * MINUTE, 0], "поправка — в минутах, не больше получаса");

  assert.deepEqual(parsePrayer("поправка магриба +3"), { shift: { key: "maghrib", minutes: 3 } });
  assert.deepEqual(parsePrayer("Поправка для фаджра минус 2 минуты."), { shift: { key: "fajr", minutes: -2 } });
  assert.deepEqual(parsePrayer("поправка восхода −7"), { shift: { key: "sunrise", minutes: -7 } });
  assert.deepEqual(parsePrayer("поправка зухра 5"), { shift: { key: "dhuhr", minutes: 5 } });
  assert.deepEqual(parsePrayer("убери поправку магриба"), { shift: { key: "maghrib", minutes: 0 } });
  assert.deepEqual(parsePrayer("поправка магриба +45"), { shift: { key: "maghrib", tooBig: true } });
  assert.deepEqual([parsePrayer("убери поправки намазов"), parsePrayer("намазы без поправок")], [{ shift: { clear: true } }, { shift: { clear: true } }]);
  assert.deepEqual(parsePrayer("поправки намазов"), { how: true });
  for (const said of ["поправки", "убери поправки", "поправка магриба", "поправка к уроку 3", "поправь магриб", "поправка на ветер 5"]) assert.equal(parsePrayer(said), null, said);
  // Метод целиком — словами о намазах, а не только о фаджре; мазхаб вместо метода — это школа асра.
  assert.deepEqual(parsePrayer("считай намазы по Турции"), { method: "turkey" });
  assert.deepEqual(parsePrayer("Считай намазы по ДУМ."), { method: "russia" });
  assert.deepEqual(parsePrayer("намазы по Диянету"), { method: "turkey" });
  assert.deepEqual(parsePrayer("метод намазов — Египет"), { method: "egypt" });
  assert.deepEqual(parsePrayer("считай время намаза по Умм аль-Кура"), { method: "makkah" });
  assert.deepEqual([parsePrayer("намазы по ханафи"), parsePrayer("считай намазы по ханафитскому мазхабу"), parsePrayer("намазы по шафиитскому мазхабу")], [{ asr: 2 }, { asr: 2 }, { asr: 1 }]);
  assert.deepEqual(parsePrayer("считай намазы по Марсу"), { method: "" }, "просьба о методе с неизвестным названием — не разговор");
  assert.deepEqual(parsePrayer("считай намазы по какому методу"), { how: true });
  for (const said of ["намазы по пятницам", "намазы по расписанию", "намазы по часам", "считай по Турции", "когда намаз по Москве"]) assert.equal(parsePrayer(said), null, said);

  reset();
  moscow();
  const now = at("2026-11-14T09:00:00Z");
  const h = heart({ SOURCES: true, TIME_ZONE: "Europe/Moscow" }, { now: () => now });
  await h.onMessage(own("мой город — Москва"), KEY);
  const base = prayersOn({ y: 2026, m: 11, d: 14, ...SPOT });
  await h.onMessage(message("поправка магриба +3"), KEY);
  assert.equal(last(), "Поправки к расчёту задаёт хозяин — и в личке.");
  await h.onMessage(own("поправка магриба +45"), KEY);
  assert.match(last(OWNER), /^Поправка — не больше 30 минут в любую сторону/u);
  await h.onMessage(own("убери поправки намазов"), KEY);
  assert.equal(last(OWNER), "Своих поправок у вас и нет: считаю как есть.");

  await h.onMessage(own("поправка магриба +3"), KEY);
  assert.equal(last(OWNER), "Хорошо, хозяин: магриб — на 3 мин позже расчёта. Это для всех, кому я называю время и напоминаю. Расчёт теперь: фаджр — 18°, иша — 17°, аср — одна тень; поправки хозяина: магриб +3 мин. Посмотреть — «намазы на сегодня».");
  await h.onMessage(own("поправка фаджра -2"), KEY);
  await h.onMessage(own("намазы на сегодня"), KEY);
  assert.match(last(OWNER), new RegExp(`^Намазы на сегодня \\(Москва\\):\\nФаджр — ${msk(base.fajr - 2 * MINUTE)}\\nВосход — ${msk(base.sunrise)}\\nЗухр — ${msk(base.dhuhr)}\\nАср — ${msk(base.asr)}\\nМагриб — ${msk(base.maghrib + 3 * MINUTE)}\\nИша — ${msk(base.isha)}\\n\\nРасчёт: фаджр — 18°, иша — 17°, аср — одна тень; поправки хозяина: фаджр −2, магриб \\+3 мин\\.`, "u"));
  await h.onMessage(own("когда магриб"), KEY);
  assert.equal(last(OWNER), `Магриб сегодня — в ${msk(base.maghrib + 3 * MINUTE)} (Москва): ${inWords(base.maghrib + 3 * MINUTE - now)}.`);
  // «Когда фаджр» — свой ответ, но минуты те же: иначе два ответа разошлись бы.
  await h.onMessage(own("когда фаджр"), KEY);
  assert.match(last(OWNER), new RegExp(`^Фаджр сегодня — в ${msk(base.fajr - 2 * MINUTE)}, восход — в ${msk(base.sunrise)} \\(Москва, угол 18°; с поправкой: фаджр −2 мин\\)\\.`, "u"));
  // Другому человеку в том же городе — те же минуты: правила общие.
  await h.onMessage(message("мой город — Москва"), KEY);
  await h.onMessage(message("когда магриб"), KEY);
  assert.equal(last(), `Магриб сегодня — в ${msk(base.maghrib + 3 * MINUTE)} (Москва): ${inWords(base.maghrib + 3 * MINUTE - now)}.`);

  // Метод Диянета приносит свои минуты; поправка хозяина складывается с ними.
  await h.onMessage(message("считай намазы по Турции"), KEY);
  assert.equal(last(), "Метод расчёта выбирает хозяин — и в личке.");
  await h.onMessage(own("считай намазы по расписанию мечети"), KEY);
  assert.match(last(OWNER), /^Такого метода я не знаю, а расписания мечети у меня нет: считаю по солнцу\. Знаю методы: Всемирная исламская лига; ДУМ России; Диянет, Турция; /u);
  await h.onMessage(own("считай намазы по Турции"), KEY);
  assert.equal(last(OWNER), "Хорошо, хозяин: намазы считаю по методу «Диянет, Турция»: фаджр — 18°, иша — 17°, аср — одна тень; минуты метода: восход −7, зухр +5, аср +4, магриб +7; поправки хозяина: фаджр −2, магриб +3 мин. Посмотреть — «намазы на сегодня»; подогнать под расписание мечети — «поправка магриба +3».");
  await h.onMessage(own("поправка фаджра 0"), KEY);
  assert.match(last(OWNER), /^Хорошо, хозяин: фаджр — без вашей поправки\. Расчёт теперь: фаджр — 18°, иша — 17°, аср — одна тень; минуты метода: восход −7, зухр \+5, аср \+4, магриб \+7; поправки хозяина: магриб \+3 мин\./u);
  await h.onMessage(own("намазы на сегодня"), KEY);
  assert.match(last(OWNER), new RegExp(`Фаджр — ${msk(base.fajr)}\\nВосход — ${msk(base.sunrise - 7 * MINUTE)}\\nЗухр — ${msk(base.dhuhr + 5 * MINUTE)}\\nАср — ${msk(base.asr + 4 * MINUTE)}\\nМагриб — ${msk(base.maghrib + 10 * MINUTE)}\\nИша — ${msk(base.isha)}\\n`, "u"));
  await h.onMessage(own("намазы без поправок"), KEY);
  assert.match(last(OWNER), /^Хорошо, хозяин: ваши поправки сняла\. Расчёт теперь: фаджр — 18°, иша — 17°, аср — одна тень; минуты метода: восход −7, зухр \+5, аср \+4, магриб \+7\./u);
  await h.onMessage(own("как ты считаешь намазы"), KEY);
  assert.match(last(OWNER), /Зухр — истинный полдень, магриб — закат; минуты прибавляются к этому\..*«поправка магриба \+3» — чтобы совпало с расписанием его мечети\.$/u);
  // Прежние слова о фаджре называют метод так же — и говорят, что он теперь для всех намазов.
  await h.onMessage(own("считай фаджр по Тегерану"), KEY);
  assert.match(last(OWNER), /^Хорошо, хозяин: фаджр считаю по углу 17,7° \(Тегеран\)\..* Остальные намазы — по тому же методу: фаджр — 17,7°, иша — 14°, аср — одна тень, магриб — солнце на 4,5° ниже горизонта\.$/u);
  await h.onMessage(own("когда магриб"), KEY);
  const tehran = prayersOn({ y: 2026, m: 11, d: 14, ...SPOT, angle: 17.7, isha: 14, maghribAngle: 4.5 });
  assert.equal(last(OWNER), `Магриб сегодня — в ${msk(tehran.maghrib)} (Москва): ${inWords(tehran.maghrib - now)}.`);
  assert.ok(tehran.maghrib - base.maghrib > 15 * MINUTE, "в Москве в ноябре это больше четверти часа после заката");
  assert.equal(chats().length, 0);
});

test("напоминание о намазе: за столько минут, сколько просили; один раз; каждый день; выключается словом", async () => {
  reset();
  moscow();
  let now = at("2026-11-14T09:00:00Z");
  const h = heart({ SOURCES: true, TIME_ZONE: "Europe/Moscow", PHRASES: true }, { now: () => now });
  await h.onMessage(own("мой город — Москва"), KEY);
  const day = prayersOn({ y: 2026, m: 11, d: 14, ...SPOT });
  await h.onMessage(group("Аи, напоминай о намазе", { id: OWNER }), KEY);
  assert.equal(toChat(-10).at(-1).text, "О намазе напоминаю в личке: там — «напоминай о намазе за 10 минут».");
  await h.onMessage(own("напоминай о намазе за 10 минут"), KEY);
  assert.equal(last(OWNER), `Хорошо, хозяин: о каждом намазе напомню за 10 минут (Москва). Ближайший — зухр, в ${msk(day.dhuhr)}. Выключить — «не напоминай о намазе».`);
  assert.deepEqual(Object.keys(subs()), [String(OWNER)]);
  const count = () => toOwner().filter(item => /зухр|аср|магриб|иша|фаджр/u.test(item.text) && !/Хорошо|Намазы|Расчёт/u.test(item.text)).length;
  const before = count();

  now = day.dhuhr - 11 * MINUTE;
  await h.tick({});
  assert.equal(count(), before, "за одиннадцать минут — рано");
  now = day.dhuhr - 9 * MINUTE - 20_000;
  await h.tick({});
  assert.equal(count(), before + 1);
  assert.match(toOwner().at(-1).text, new RegExp(`зухр.*${msk(day.dhuhr)}|${msk(day.dhuhr)}.*зухр`, "iu"));
  assert.match(toOwner().at(-1).text, /через 10 мин/u);
  // Второе пробуждение и второй изолят в ту же минуту — молчат.
  await h.tick({});
  await heart({ SOURCES: true, TIME_ZONE: "Europe/Moscow", PHRASES: true }, { now: () => now }).tick({});
  now = day.dhuhr + 2 * MINUTE;
  await h.tick({});
  assert.equal(count(), before + 1, "об одном намазе — один раз");

  // Будильник проспал начало: скажет, что время наступило, но не позже десяти минут.
  now = day.asr + 3 * MINUTE;
  await h.tick({});
  assert.equal(count(), before + 2);
  assert.match(toOwner().at(-1).text, new RegExp(`врем. асра.*${msk(day.asr)}|${msk(day.asr)}.*врем. асра`, "iu"));
  now = day.maghrib + 11 * MINUTE;
  await h.tick({});
  assert.equal(count(), before + 2, "через одиннадцать минут после начала — уже молчит");

  // На следующий день — снова, по новым временам; «вовремя» — в само время.
  const next = prayersOn({ y: 2026, m: 11, d: 15, ...SPOT });
  now = next.fajr - 5 * MINUTE;
  await h.tick({});
  assert.equal(count(), before + 3);
  assert.match(toOwner().at(-1).text, /фаджр/iu);
  await h.onMessage(own("напоминай о намазах вовремя"), KEY);
  assert.match(last(OWNER), /о каждом намазе напомню в его время \(Москва\)/u);
  now = next.dhuhr - 5 * MINUTE;
  await h.tick({});
  assert.equal(count(), before + 3, "заранее больше не говорит");
  now = next.dhuhr + 20_000;
  await h.tick({});
  assert.equal(count(), before + 4);
  assert.match(toOwner().at(-1).text, /врем. зухра/iu);

  await h.onMessage(own("не напоминай о намазе"), KEY);
  assert.equal(last(OWNER), "Хорошо, о намазах больше не напоминаю. Вернуть — «напоминай о намазе».");
  assert.deepEqual(subs(), {});
  now = next.asr - 2 * MINUTE;
  await h.tick({});
  assert.equal(count(), before + 4);
  await h.onMessage(own("не напоминай о намазе"), KEY);
  assert.match(last(OWNER), /Я и не напоминала/u);
  assert.equal(chats().length, 0);
});

test("напоминание о намазе — каждому, кто попросил в личке; закрытая личка снимает его сама", async () => {
  reset();
  moscow();
  let now = at("2026-11-14T09:00:00Z");
  const h = heart({ SOURCES: true, TIME_ZONE: "Europe/Moscow" }, { now: () => now });
  await h.onMessage(message("мой город — Москва", { id: 31 }), KEY);
  await h.onMessage(message("напоминай о намазе за 5 минут", { id: 31 }), KEY);
  assert.match(last(31), /^Хорошо: о каждом намазе напомню за 5 минут \(Москва\)/u);
  const day = prayersOn({ y: 2026, m: 11, d: 14, ...SPOT });
  now = day.dhuhr - 4 * MINUTE;
  await h.tick({});
  assert.equal(last(31), `Через 4 мин — зухр, в ${msk(day.dhuhr)}.`);
  assert.equal(toOwner().filter(item => /зухр/u.test(item.text)).length, 0, "хозяину чужое напоминание не приходит");

  // Трижды подряд не дошло — напоминание снято.
  sdk().failing.sendMessage = Object.assign(new Error("Forbidden: bot was blocked by the user"), { code: 403 });
  for (const time of [day.asr, day.maghrib]) { now = time - MINUTE; await h.tick({}); }
  assert.equal(subs()["31"].fails, 2);
  now = day.isha - MINUTE;
  await h.tick({});
  assert.deepEqual(subs(), {});
  delete sdk().failing.sendMessage;
});
