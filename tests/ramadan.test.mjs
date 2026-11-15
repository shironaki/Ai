/**
 * Кибла и Рамадан (идеи 134 и 135; слово владельца 16.11.2026: «134 и 135 можешь делать»).
 * Кибла — геометрия шара, сверенная с известными значениями. Пост — дни по таблице Умм аль-Кура,
 * напоминания о конце сухура и об ифтаре; вне Рамадана она молчит; начало поправляет хозяин.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, chats, source, sdk, toOwner, toChat, OWNER, KEY } from "./fixtures/kit.mjs";

const { qiblaOf, compassWords, parseQibla, kmText } = await import("../tgcloud/lib/qibla.js");
const { parseFast, fastDay, ramadanOf, nextRamadan, nearestRamadan, FAST_KEY } = await import("../tgcloud/lib/ramadan.js");
const { prayersOn } = await import("../tgcloud/lib/fajr.js");
const { PRAYER_KEY } = await import("../tgcloud/lib/prayer.js");
const { localClock } = await import("../tgcloud/lib/time.js");

const MINUTE = 60_000, DAY = 86_400_000;
const at = (text) => Date.parse(text);
const own = (text) => message(text, { id: OWNER });
const SPOT = { latitude: 55.7558, longitude: 37.6173 };
const places = () => source("geocoding-api.open-meteo.com", (url) => {
  const name = decodeURIComponent(String(url).match(/[?&]name=([^&]+)/u)?.[1] ?? "").replace(/\+/gu, " ").toLowerCase();
  if (name.startsWith("казан")) return { results: [{ name: "Казань", country: "Россия", latitude: 55.79, longitude: 49.12, timezone: "Europe/Moscow", feature_code: "PPLA" }] };
  if (name.startsWith("моск")) return { results: [{ name: "Москва", country: "Россия", latitude: 55.7558, longitude: 37.6173, timezone: "Europe/Moscow", feature_code: "PPLC" }] };
  return { results: [] };
});
const msk = (ms) => localClock(ms, "Europe/Moscow");
const fasts = () => JSON.parse(sdk().kv.get(FAST_KEY) ?? "null")?.subs ?? {};
const prayers = () => JSON.parse(sdk().kv.get(PRAYER_KEY) ?? "null")?.subs ?? {};
const NOTE = "Дни считаю по календарю Умм аль-Кура; точный день объявляют по луне.";

test("кибла: азимут сверен с известными значениями; слова — по восьми сторонам; чужие фразы — мимо", () => {
  // Эталон — общеизвестные значения азимута на Каабу для этих городов (от истинного севера).
  const rows = { "Москва": [55.7558, 37.6173, 176.4], "Казань": [55.79, 49.12, 195.2], "Нью-Йорк": [40.71, -74.0, 58.5], "Джакарта": [-6.2, 106.85, 295.1], "Стамбул": [41.01, 28.98, 151.6], "Лондон": [51.5074, -0.1278, 119.0], "Каир": [30.04, 31.24, 136.1], "Лелистад": [52.52, 5.47, 126.4] };
  for (const [name, [lat, lon, want]] of Object.entries(rows)) assert.ok(Math.abs(qiblaOf(lat, lon).bearing - want) < 0.15, `${name}: ${qiblaOf(lat, lon).bearing.toFixed(2)} против ${want}`);
  assert.equal(Math.round(qiblaOf(55.7558, 37.6173).km / 10) * 10, 3820);
  assert.equal(qiblaOf(91, 0), null);
  assert.equal(qiblaOf("x", 0), null);
  assert.deepEqual([0, 3, 10, 30, 45, 126.4, 176.4, 195.2, 240, 270, 350, 357].map(compassWords), [
    "почти точно на север", "почти точно на север", "на север, чуть к востоку", "на северо-восток с уклоном к северу", "почти точно на северо-восток",
    "на юго-восток, чуть к востоку", "почти точно на юг", "на юг с уклоном к западу", "на юго-запад с уклоном к западу", "почти точно на запад", "на север, чуть к западу", "почти точно на север",
  ]);
  assert.deepEqual([kmText(3817), kmText(10312), kmText(84)], ["3 820 км", "10 310 км", "80 км"]);
  const cases = {
    "кибла": "", "Где кибла?": "", "в какой стороне кибла": "", "направление киблы": "", "направление на Мекку": "", "куда молиться?": "", "в какую сторону молиться": "",
    "где Мекка": "", "куда поворачиваться в намазе": "", "куда молиться в пути": "", "кибла из Казани": "казани", "где кибла в Москве": "москве",
    "направление на Мекку из Берлина": "берлина", "кибла для города Набережные Челны": "набережные челны",
  };
  for (const [said, city] of Object.entries(cases)) assert.deepEqual(parseQibla(said), { city }, said);
  for (const said of ["расскажи про Мекку", "что такое кибла", "куда пойти молиться", "привет", "мекка — город в Саудовской Аравии", "я был в Мекке", "как молиться", "куда поехать летом", "кибла — это слово арабское"]) assert.equal(parseQibla(said), null, said);
});

test("«где кибла?»: по городу человека или по названному; без города — просит город; модель не нужна", async () => {
  reset();
  places();
  const h = heart({ SOURCES: true, TIME_ZONE: "Europe/Moscow" }, { now: () => at("2026-11-16T09:00:00Z") });
  await h.onMessage(own("где кибла?"), KEY);
  assert.equal(last(OWNER), "Чтобы посчитать, мне нужен ваш город. Скажите: «я живу в Казани» — или сразу «кибла из Казани».");
  await h.onMessage(own("мой город — Москва"), KEY);
  await h.onMessage(own("где кибла?"), KEY);
  assert.equal(last(OWNER), [
    "Кибла (Москва): 176° от севера по часовой стрелке — почти точно на юг. До Каабы 3 820 км по прямой.",
    "Градусы — от истинного севера, как на карте. Стрелка компаса смотрит на магнитный север: поправка зависит от места, бывает больше десяти градусов, и я её не считаю — компас в телефоне обычно умеет показывать истинный север.",
  ].join("\n"));
  // Любой человек, в группе, для названного города — и на «ты»/«вы» по своим отношениям.
  await h.onMessage(group("Аи, кибла из Казани"), KEY);
  assert.match(toChat(-10).at(-1).text, /^Кибла \(Казань\): 195° от севера по часовой стрелке — на юг с уклоном к западу\. До Каабы 3 900 км по прямой\.\n/u);
  await h.onMessage(group("Аи, кибла из Тьмутаракани"), KEY);
  assert.match(toChat(-10).at(-1).text, /^Город «тьмутаракани» я не нашла\./u);
  assert.equal(chats().length, 0, "считает код, а не модель");
});

test("календарь поста: дни Рамадана по таблице, поправка начала и длины; разбор слов", () => {
  assert.deepEqual(ramadanOf(1448), { hy: 1448, first: { y: 2027, m: 2, d: 8 }, days: 29 });
  assert.deepEqual(ramadanOf(1447), { hy: 1447, first: { y: 2026, m: 2, d: 18 }, days: 30 });
  assert.equal(fastDay({ y: 2027, m: 2, d: 7 }), null);
  assert.deepEqual(fastDay({ y: 2027, m: 2, d: 8 }), { hy: 1448, day: 1, of: 29, last: false });
  assert.deepEqual(fastDay({ y: 2027, m: 3, d: 8 }), { hy: 1448, day: 29, of: 29, last: true });
  assert.equal(fastDay({ y: 2027, m: 3, d: 9 }), null, "1 шавваля — праздник, а не пост");
  assert.equal(fastDay({ y: 2026, m: 11, d: 16 }), null);
  // Объявили на день позже — весь месяц сдвинулся; поправка другого года не действует.
  const late = { ramadan: { hy: 1448, shift: 1 } };
  assert.equal(fastDay({ y: 2027, m: 2, d: 8 }, late), null);
  assert.deepEqual(fastDay({ y: 2027, m: 2, d: 9 }, late), { hy: 1448, day: 1, of: 29, last: false });
  assert.deepEqual(fastDay({ y: 2027, m: 3, d: 9 }, late), { hy: 1448, day: 29, of: 29, last: true });
  assert.deepEqual(fastDay({ y: 2027, m: 2, d: 8 }, { ramadan: { hy: 1449, shift: 1 } }), { hy: 1448, day: 1, of: 29, last: false });
  assert.deepEqual(fastDay({ y: 2027, m: 2, d: 8 }, { ramadan: { hy: 1448, shift: 9 } }), null, "поправка больше двух суток обрезается до двух");
  assert.deepEqual(fastDay({ y: 2027, m: 2, d: 10 }, { ramadan: { hy: 1448, shift: 9 } }), { hy: 1448, day: 1, of: 29, last: false });
  // В месяце оказалось 30 дней: тридцатый — пост.
  assert.deepEqual(fastDay({ y: 2027, m: 3, d: 9 }, { ramadan: { hy: 1448, shift: 0, days: 30 } }), { hy: 1448, day: 30, of: 30, last: true });
  assert.deepEqual(nextRamadan({ y: 2026, m: 11, d: 16 }), { hy: 1448, y: 2027, m: 2, d: 8, left: 84 });
  assert.deepEqual(nextRamadan({ y: 2027, m: 2, d: 20 }), { hy: 1449, y: 2028, m: 1, d: 28, left: 342 });
  assert.equal(nearestRamadan({ y: 2027, m: 3, d: 9 }).day, 30, "день после конца — ближайший Рамадан тот же, счёт — тридцатый");
  assert.equal(nearestRamadan({ y: 2027, m: 2, d: 6 }).day, -1);

  const cases = {
    "какой день поста": { day: true }, "Какой сегодня день Рамадана?": { day: true }, "сейчас рамадан?": { day: true }, "идёт ли рамадан": { day: true }, "рамадан начался?": { day: true },
    "сколько осталось до конца рамадана": { day: true }, "сколько дней поста осталось": { day: true }, "когда закончится рамадан": { day: true },
    "напоминай о сухуре и ифтаре": { remind: 30 }, "напоминай о посте": { remind: 30 }, "напоминай о посте за 40 минут": { remind: 40 }, "буди на сухур за 45 минут": { remind: 45 },
    "напоминай об ифтаре": { remind: 30 }, "включи напоминание о рамадане": { remind: 30 }, "напоминай о посте за 500 минут": { remind: 30, clamped: true },
    "не напоминай о посте": { remind: false }, "не буди на сухур": { remind: false }, "хватит напоминать о сухуре и ифтаре": { remind: false },
    "рамадан на день позже": { shift: 1 }, "Рамадан на день раньше": { shift: -1 }, "рамадан по расчёту": { shift: 0 },
    "рамадан начался сегодня": { start: "today" }, "рамадан начинается завтра": { start: "tomorrow" }, "сегодня первый день поста": { start: "today" },
    "рамадан закончился": { end: "today" }, "завтра ураза-байрам": { end: "tomorrow" }, "сегодня последний день поста": { end: "tomorrow" },
  };
  for (const [said, want] of Object.entries(cases)) assert.deepEqual(parseFast(said), want, said);
  // «Когда Рамадан», «когда ифтар» — у праздников и намазов; одно слово, рассказ и чужие «посты» — мимо.
  for (const said of ["когда рамадан", "когда ифтар", "сколько до сухура", "рамадан", "расскажи про рамадан", "я держу пост", "пост в инстаграме", "напоминай о намазе", "какой день недели", "новый пост в канале", "напоминай о посте в блоге каждый день"]) assert.equal(parseFast(said), null, said);
});

test("вне Рамадана она о посте молчит, но на вопрос отвечает; напоминание — в личке и по городу", async () => {
  reset();
  places();
  let now = at("2026-11-16T09:00:00Z");
  const h = heart({ SOURCES: true, TIME_ZONE: "Europe/Moscow" }, { now: () => now });
  await h.onMessage(message("какой день поста?"), KEY);
  assert.equal(last(), `Сейчас не Рамадан. По расчёту первый день поста — 8 февраля 2027 года: через 84 дня. ${NOTE}`);
  await h.onMessage(group("Аи, напоминай о сухуре и ифтаре"), KEY);
  assert.equal(toChat(-10).at(-1).text, "О посте напоминаю в личке: там — «напоминай о сухуре и ифтаре».");
  await h.onMessage(message("напоминай о сухуре и ифтаре"), KEY);
  assert.equal(last(), "Чтобы посчитать, мне нужен ваш город. Скажите: «я живу в Казани».");
  await h.onMessage(message("я живу в Москве"), KEY);
  await h.onMessage(message("напоминай о посте за 40 минут"), KEY);
  assert.equal(last(), "Хорошо: в Рамадан напомню о конце сухура за 40 минут и об ифтаре — в его время (Москва). Сейчас не Рамадан — до него молчу. По расчёту первый день поста — 8 февраля 2027 года: через 84 дня. Выключить — «не напоминай о посте».");
  assert.deepEqual(Object.keys(fasts()), ["5"]);
  // Обычный день: ни у фаджра, ни у магриба — ни слова.
  const day = prayersOn({ y: 2026, m: 11, d: 17, ...SPOT });
  const before = sdk().sent.length;
  for (const moment of [day.fajr - 30 * MINUTE, day.fajr - MINUTE, day.maghrib + MINUTE]) { now = moment; await h.tick({}); }
  assert.equal(sdk().sent.length, before, "вне Рамадана молчит");
  // Чужой день поста не поправит: это слово хозяина.
  await h.onMessage(message("рамадан на день позже"), KEY);
  assert.equal(last(), "Дни поста поправляет хозяин — и в личке.");
  await h.onMessage(message("не напоминай о посте"), KEY);
  assert.equal(last(), "Хорошо, о посте больше не напоминаю. Вернуть — «напоминай о сухуре и ифтаре».");
  assert.deepEqual(fasts(), {});
  await h.onMessage(message("не напоминай о посте"), KEY);
  assert.equal(last(), "Я и не напоминала. Включить — «напоминай о сухуре и ифтаре».");
  assert.equal(chats().length, 0);
});

test("в Рамадан: вечером накануне — «завтра пост», до фаджра — конец сухура, с магрибом — ифтар; каждый раз один раз", async () => {
  reset();
  places();
  let now = at("2026-11-16T09:00:00Z");
  const h = heart({ SOURCES: true, TIME_ZONE: "Europe/Moscow" }, { now: () => now });
  await h.onMessage(own("мой город — Москва"), KEY);
  await h.onMessage(own("напоминай о сухуре и ифтаре"), KEY);
  assert.match(last(OWNER), /^Хорошо, хозяин: в Рамадан напомню о конце сухура за 30 минут и об ифтаре — в его время \(Москва\)\. Сейчас не Рамадан — до него молчу\./u);
  const told = () => toOwner().map(item => item.text).filter(text => /сухур|ифтар|Рамадан/u.test(text) && !/^Хорошо|^Сегодня \d+-й день поста из|^Сейчас не/u.test(text));
  const start = told().length;
  const eve = prayersOn({ y: 2027, m: 2, d: 7, ...SPOT }), first = prayersOn({ y: 2027, m: 2, d: 8, ...SPOT });

  // 7 февраля до магриба — тихо; с магрибом — «завтра пост», один раз.
  now = eve.maghrib - 5 * MINUTE; await h.tick({});
  assert.equal(told().length, start);
  now = eve.maghrib + MINUTE; await h.tick({}); await h.tick({});
  assert.deepEqual(told().slice(start), [`Сегодня вечером начинается Рамадан: первый день поста — завтра, сухур до ${msk(first.fajr)}. День расчётный: точный объявляют по луне.`]);
  // 8 февраля: за 31 минуту до фаджра — рано; за 29 — «до конца сухура»; после фаджра не повторяет.
  now = first.fajr - 31 * MINUTE; await h.tick({});
  assert.equal(told().length, start + 1);
  now = first.fajr - 29 * MINUTE - 30_000; await h.tick({}); await h.tick({});
  assert.deepEqual(told().slice(start + 1), [`До конца сухура 30 мин: фаджр в ${msk(first.fajr)}. Сегодня 1-й день поста.`]);
  now = first.fajr + MINUTE; await h.tick({});
  assert.equal(told().length, start + 2);
  // Днём — вопрос: сухур уже был, ифтар впереди.
  now = first.dhuhr;
  await h.onMessage(own("какой день поста?"), KEY);
  assert.equal(last(OWNER), `Сегодня 1-й день поста из 29. Сухур был до ${msk(first.fajr)}, ифтар — в ${msk(first.maghrib)} (Москва). Впереди ещё 28 дней. ${NOTE}`);
  // Магриб: «время ифтара»; через одиннадцать минут опоздавшее пробуждение уже молчит.
  now = first.maghrib - MINUTE; await h.tick({});
  assert.equal(told().length, start + 2);
  now = first.maghrib + 2 * MINUTE; await h.tick({}); await h.tick({});
  assert.deepEqual(told().slice(start + 2), [`Время ифтара — ${msk(first.maghrib)}. 1-й день поста завершён.`]);
  const second = prayersOn({ y: 2027, m: 2, d: 9, ...SPOT });
  now = second.maghrib + 11 * MINUTE; await h.tick({});
  assert.equal(told().length, start + 3, "опоздала больше чем на десять минут — не говорит");
  // Последний день: об этом сказано; на следующий день (1 шавваля) — тишина.
  const lastDay = prayersOn({ y: 2027, m: 3, d: 8, ...SPOT }), feast = prayersOn({ y: 2027, m: 3, d: 9, ...SPOT });
  now = lastDay.maghrib + MINUTE; await h.tick({});
  assert.equal(told().at(-1), `Время ифтара — ${msk(lastDay.maghrib)}. 29-й день поста завершён. По расчёту это был последний: завтра Ураза-байрам, если не объявят иначе.`);
  const count = told().length;
  for (const moment of [feast.fajr - 20 * MINUTE, feast.maghrib + MINUTE]) { now = moment; await h.tick({}); }
  assert.equal(told().length, count, "после Рамадана снова молчит");
  assert.equal(chats().length, 0);
});

test("хозяин поправляет начало и длину месяца; у подписанного на намаз магриб и ифтар — одно сообщение, а не два", async () => {
  reset();
  places();
  let now = at("2027-02-08T09:00:00Z"); // по таблице — первый день
  const h = heart({ SOURCES: true, TIME_ZONE: "Europe/Moscow" }, { now: () => now });
  await h.onMessage(own("мой город — Москва"), KEY);
  await h.onMessage(own("напоминай о сухуре и ифтаре"), KEY);
  assert.match(last(OWNER), /Сегодня 1-й день поста\. Сухур был до \d\d:\d\d, ифтар — в \d\d:\d\d \(Москва\)\. Выключить/u);
  // Объявили, что пост — с завтра.
  await h.onMessage(own("Рамадан начинается завтра"), KEY);
  assert.equal(last(OWNER), "Хорошо, хозяин: Рамадан 1448 года по хиджре — с 9 февраля 2027 года, 29 дней поста; Ураза-байрам — 10 марта 2027 года. По таблице было: с 8 февраля 2027 года, 29 дней. Это для всех, кому я напоминаю о посте. Вернуть расчёт — «Рамадан по расчёту».");
  await h.onMessage(own("какой день поста?"), KEY);
  assert.equal(last(OWNER), `Сейчас не Рамадан. По расчёту первый день поста — 9 февраля 2027 года: завтра. ${NOTE}`);
  await h.onMessage(own("рамадан на день позже"), KEY);
  assert.match(last(OWNER), /с 10 февраля 2027 года, 29 дней поста/u);
  await h.onMessage(own("рамадан на день позже"), KEY);
  assert.equal(last(OWNER), "Больше чем на 2 дня от расчёта начало не сдвигаю: сейчас поправка +2. Вернуть расчёт — «Рамадан по расчёту».");
  await h.onMessage(own("рамадан по расчёту"), KEY);
  assert.equal(last(OWNER), "Хорошо, хозяин: Рамадан 1448 года по хиджре — с 8 февраля 2027 года, 29 дней поста; Ураза-байрам — 9 марта 2027 года. Это расчёт, без поправок.");
  // Посреди месяца «закончился» не принимается: в лунном месяце 29 или 30 дней.
  now = at("2027-02-20T09:00:00Z");
  await h.onMessage(own("рамадан закончился"), KEY);
  assert.equal(last(OWNER), "В лунном месяце 29 или 30 дней, а по моему счёту сегодня 13-й день Рамадана. Если счёт сбился с начала — сначала «Рамадан на день позже» или «Рамадан на день раньше».");
  // По таблице 29 дней, а луну не увидели: на 29-й день хозяин говорит, что завтра ещё пост, — месяц в 30 дней.
  now = at("2027-03-09T06:00:00Z"); // по таблице уже праздник
  await h.onMessage(own("какой день поста?"), KEY);
  assert.match(last(OWNER), /^Сейчас не Рамадан\./u);
  await h.onMessage(own("сегодня последний день поста"), KEY);
  assert.equal(last(OWNER), "Хорошо, хозяин: Рамадан 1448 года по хиджре — с 8 февраля 2027 года, 30 дней поста; Ураза-байрам — 10 марта 2027 года. По таблице было: с 8 февраля 2027 года, 29 дней. Это для всех, кому я напоминаю о посте. Вернуть расчёт — «Рамадан по расчёту».");
  await h.onMessage(own("какой день поста?"), KEY);
  assert.match(last(OWNER), /^Сегодня 30-й день поста из 30\..* Это последний день: завтра Ураза-байрам, если не объявят иначе\./u);

  // Намаз «вовремя» и пост: с магрибом — одно сообщение, об ифтаре.
  await h.onMessage(own("напоминай о намазах вовремя"), KEY);
  const day = prayersOn({ y: 2027, m: 3, d: 9, ...SPOT });
  const before = toOwner().length;
  now = day.maghrib + MINUTE; await h.tick({}); await h.tick({});
  assert.deepEqual(toOwner().slice(before).map(item => item.text), [`Время ифтара — ${msk(day.maghrib)}. 30-й день поста завершён. По расчёту это был последний: завтра Ураза-байрам, если не объявят иначе.`]);
  // Иша — обычное напоминание о намазе: пост его не глушит.
  now = day.isha + MINUTE; await h.tick({});
  assert.match(toOwner().at(-1).text, /иша/iu);

  // «Удали всё обо мне» снимает оба напоминания: в них город и координаты человека.
  await h.onMessage(message("я живу в Москве"), KEY);
  await h.onMessage(message("напоминай о посте"), KEY);
  await h.onMessage(message("напоминай о намазе"), KEY);
  assert.deepEqual([Object.keys(fasts()).sort(), Object.keys(prayers()).sort()], [["5", "7"], ["5", "7"]]);
  await h.onMessage(message("удали всё обо мне"), KEY);
  await h.onMessage(message("да, удали всё"), KEY);
  assert.match(last(), /^Готово: записей, переписки, имени и настроек больше нет\./u);
  assert.deepEqual([Object.keys(fasts()), Object.keys(prayers())], [["7"], ["7"]]);
  assert.equal(chats().length, 0, "всё это — без модели");
  await h.onMessage(own("статус"), KEY);
  assert.match(last(OWNER), /о намазе напоминаю 1 человеку, о посте — 1/u);
});
