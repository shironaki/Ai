/**
 * Праздники, которые Аи находит сама: исламские — по лунному календарю
 * Умм аль-Кура (таблица в проекте), государственные — из открытого справочника
 * Nager.Date для страны хозяина. Свои он по-прежнему называет словами; что из
 * найденного ему не нужно — убирает, и оно не возвращается.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { heart, message, reset, last, calls, chats, sdk, source, sourced, toOwner, OWNER, KEY } from "./fixtures/kit.mjs";

const { hijriOf, gregorianOf, hijriText, islamicDays, publicDays, publicTitle, feastsFor, feastLine, parseFeast, countryCodeOf, ISLAMIC } = await import("../tgcloud/lib/feasts.js");
const { HIJRI_FIRST, HIJRI_STARTS } = await import("../tgcloud/lib/data/hijri.js");
const { OCCASIONS, HOLIDAYS_KEY } = await import("../tgcloud/lib/postcard.js");
const hijriScript = await import("../scripts/hijri.mjs");
const { createPhrasebook } = await import("../tgcloud/lib/phrasebook.js");

// Ответы справочника — как он отдал их 15.11.2026 (https://nagerholidays.com/api/v4/Holidays/NL/2027 и RU/2027).
const row = (date, name, types = ["Public"]) => ({ date, name, countryCode: "", nationalHoliday: true, subdivisionCodes: null, holidayTypes: types });
const NL = (year) => [
  row(`${year}-01-01`, "New Year's Day"), row(`${year}-03-26`, "Good Friday", ["School", "Authorities", "Observance"]), row(`${year}-03-28`, "Easter Sunday"), row(`${year}-03-29`, "Easter Monday"),
  row(`${year}-04-27`, "King's Day"), row(`${year}-05-05`, "Liberation Day", ["School", "Authorities"]), row(`${year}-05-06`, "Ascension Day"), row(`${year}-05-16`, "Pentecost"), row(`${year}-05-17`, "Whit Monday"),
  row(`${year}-12-25`, "Christmas Day"), row(`${year}-12-26`, "St. Stephen's Day"),
];
const RU = (year) => [
  row(`${year}-01-01`, "New Year's Day"), row(`${year}-01-02`, "New Year holiday"), row(`${year}-01-03`, "New Year holiday"), row(`${year}-01-04`, "New Year holiday"), row(`${year}-01-05`, "New Year holiday"),
  row(`${year}-01-06`, "New Year holiday"), row(`${year}-01-07`, "Christmas Day (Orthodox)"), row(`${year}-02-23`, "Defender of the Fatherland Day"), row(`${year}-03-08`, "International Women's Day"),
  row(`${year}-05-01`, "Labour Day"), row(`${year}-05-09`, "Victory Day"), row(`${year}-06-12`, "Russia Day"), row(`${year}-11-04`, "Unity Day"),
];
const TR = (year) => [row(`${year}-03-10`, "Eid al-Fitr First Day (Tentative Date)"), row(`${year}-03-11`, "Eid al-Fitr Second Day (Tentative Date)"), row(`${year}-03-12`, "Eid al-Fitr Third Day (Tentative Date)"), row(`${year}-10-29`, "Republic Day"), row(`${year}-07-15`, "Democracy and National Unity Day")];
const yearOf = (url) => Number(String(url).match(/\/(\d{4})$/u)?.[1]);
const nager = () => {
  source("nagerholidays.com/api/v4/Holidays/NL/", (url) => NL(yearOf(url)));
  source("nagerholidays.com/api/v4/Holidays/RU/", (url) => RU(yearOf(url)));
  source("nagerholidays.com/api/v4/Holidays/TR/", (url) => TR(yearOf(url)));
};
const lelystad = (extra = { country_code: "NL" }) => source("geocoding-api.open-meteo.com", { results: [{ name: "Лелистад", country: "Нидерланды", admin1: "Флеволанд", latitude: 52.5083, longitude: 5.475, timezone: "Europe/Amsterdam", feature_code: "PPLA", ...extra }] });

const CF = "0123456789abcdef0123456789abcdef:cf-token_ABCDEFGH-1234567890xyz";
const PIXELS = Buffer.from(Array.from({ length: 600 }, (_, index) => index % 251));
const image = () => ({ success: true, result: { image: PIXELS.toString("base64") } });
const ON = { DRAW_KEY: CF, DRAW_DIRECTOR: false, PHRASES: true, GREET: true, SOURCES: true, TIME_ZONE: "Europe/Amsterdam" };
const own = (text) => message(text, { id: OWNER });
const cards = () => calls("sendPhoto").filter(item => String(item.chat_id) === String(OWNER));
const prompts = () => sdk().sourceFetches.filter(item => item.url.includes("flux-1-schnell")).map(item => JSON.parse(item.options.body).prompt);
const asked = (part) => sourced().filter(url => url.includes(part));
const pool = (name) => createPhrasebook().pool(name, { formal: true });
const at = (iso) => Date.parse(iso);

test("лунный календарь: таблица собрана из календаря Умм аль-Кура и сходится с известными датами", () => {
  // Известные дни (сверено с открытыми календарями 15.11.2026): Ураза-байрам 20.03.2026 и 09.03.2027,
  // Курбан-байрам 27.05.2026 и 16.05.2027, начало Рамадана 08.02.2027, Новый год 1449 — 06.06.2027.
  assert.deepEqual(gregorianOf(1447, 10, 1), { y: 2026, m: 3, d: 20 });
  assert.deepEqual(gregorianOf(1447, 12, 10), { y: 2026, m: 5, d: 27 });
  assert.deepEqual(gregorianOf(1448, 9, 1), { y: 2027, m: 2, d: 8 });
  assert.deepEqual(gregorianOf(1448, 10, 1), { y: 2027, m: 3, d: 9 });
  assert.deepEqual(gregorianOf(1448, 12, 10), { y: 2027, m: 5, d: 16 });
  assert.deepEqual(gregorianOf(1449, 1, 1), { y: 2027, m: 6, d: 6 });
  assert.deepEqual(hijriOf(2026, 11, 15), { hy: 1448, hm: 6, hd: 5 });
  assert.equal(hijriText(hijriOf(2026, 11, 15)), "5 джумада ас-сани 1448 года по хиджре");
  // Месяц — 29 или 30 дней: тридцатого числа в коротком месяце нет.
  assert.equal(gregorianOf(1448, 9, 30), null);
  assert.deepEqual(gregorianOf(1448, 9, 29), { y: 2027, m: 3, d: 8 });
  // Вне таблицы — честное «не знаю», а не выдумка.
  assert.equal(hijriOf(2025, 6, 25), null);
  assert.equal(hijriOf(2045, 1, 1), null);
  assert.equal(gregorianOf(1470, 1, 1), null);
  // Туда и обратно — каждый день таблицы.
  let checked = 0;
  for (let stamp = Date.UTC(2025, 5, 26); stamp < Date.UTC(2040, 11, 1); stamp += 86_400_000) {
    const date = new Date(stamp);
    const day = { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
    const lunar = hijriOf(day.y, day.m, day.d);
    assert.ok(lunar && lunar.hd >= 1 && lunar.hd <= 30, date.toISOString());
    assert.deepEqual(gregorianOf(lunar.hy, lunar.hm, lunar.hd), day);
    checked += 1;
  }
  assert.ok(checked > 5600);
  assert.equal(HIJRI_STARTS.length, 16);
  assert.equal(HIJRI_FIRST, 1447);
  // Собранный файл — тот же, что даёт календарь ICU этого Node (если он его знает).
  if (hijriScript.supported()) assert.equal(readFileSync(hijriScript.TARGET, "utf8").replace(/\r\n/gu, "\n"), hijriScript.build(), "таблица устарела: node scripts/hijri.mjs");
});

test("исламские дни и государственные праздники: один список; поздравляет не со всем, что знает", () => {
  const days = islamicDays({ y: 2026, m: 11, d: 15 }, 366);
  assert.deepEqual(days.map(item => `${item.title} ${item.y}-${item.m}-${item.d}${item.card ? " card" : ""}${item.night ? " night" : ""}${item.some ? " some" : ""}`), [
    "Ночь Исра и Мирадж 2027-1-5 night some", "Ночь Бараат 2027-1-23 night some", "Начало Рамадана 2027-2-8 card", "Ляйлят аль-Кадр 2027-3-6 night",
    "Ураза-байрам 2027-3-9 card", "День Арафа 2027-5-15", "Курбан-байрам 2027-5-16 card", "Новый год по хиджре 2027-6-6", "День Ашура 2027-6-15", "Мавлид ан-Наби 2027-8-14 some",
  ]);
  assert.equal(new Set(ISLAMIC.map(item => item.id)).size, ISLAMIC.length);

  // Названия — по-русски; незнакомое остаётся как есть.
  assert.deepEqual(publicTitle("Christmas Day (Orthodox)"), { title: "Рождество Христово", known: true });
  assert.deepEqual(publicTitle("Eid al-Fitr First Day (Tentative Date)"), { title: "Ураза-байрам", known: true });
  assert.deepEqual(publicTitle("Day of the Restoration of Something"), { title: "Day of the Restoration of Something", known: false });
  const nl = publicDays(NL(2027), "nl");
  assert.deepEqual(nl.map(item => `${item.title}|${item.kind}|${item.off ? "off" : "day"}`), [
    "Новый год|public|off", "Страстная пятница|other|day", "Пасха|other|off", "Пасхальный понедельник|other|off", "День короля|public|off", "День освобождения|public|day",
    "Вознесение|other|off", "Пятидесятница|other|off", "Духов день|other|off", "Рождество|other|off", "Второй день Рождества|other|off",
  ]);
  const ru = publicDays(RU(2027), "RU");
  assert.deepEqual(ru.map(item => `${item.title}|${item.kind}${item.till ? `|до ${item.till.d}` : ""}`), [
    "Новый год|public", "Новогодние каникулы|break|до 6", "Рождество Христово|other", "День защитника Отечества|public", "Международный женский день|women",
    "День труда|public", "День Победы|public", "День России|public", "День народного единства|public",
  ]);
  // Чужой ответ справочника не роняет: мусор отсеивается.
  assert.deepEqual(publicDays([null, { date: "x" }, { date: "2027-01-01" }, { date: "2027-02-30", name: "" }, "строка"], "RU"), []);
  assert.deepEqual(publicDays({ error: "boom" }, "RU"), []);

  const from = { y: 2026, m: 11, d: 15 };
  const all = feastsFor({ own: [{ d: 21, m: 3, title: "Навруз" }], publics: nl, from });
  const lines = all.map(item => feastLine(item));
  // Открытка — к своим, к двум байрамам и началу Рамадана, к светским выходным. Праздник другой веры — знает, но не поздравляет.
  assert.ok(lines.includes("Новый год — 1 января · выходной в Нидерландах · открытка"));
  assert.ok(lines.includes("Пасха — 28 марта · выходной в Нидерландах"));
  assert.ok(lines.includes("День освобождения — 5 мая · памятный день в Нидерландах"));
  assert.ok(lines.includes("День короля — 27 апреля · выходной в Нидерландах · открытка"));
  assert.ok(lines.includes("Ураза-байрам — 9 марта · по расчёту · открытка"));
  assert.ok(lines.includes("Ночь Бараат — в ночь на 23 января · по расчёту · отмечают не все"));
  assert.ok(lines.includes("Навруз — 21 марта · ваш, каждый год · открытка"));
  assert.deepEqual(all.map(item => item.m * 100 + item.d + (item.y - 2026) * 10000), [...all.map(item => item.m * 100 + item.d + (item.y - 2026) * 10000)].sort((a, b) => a - b), "по порядку дней");
  assert.ok(feastsFor({ publics: ru, from }).map(item => feastLine(item)).includes("Новогодние каникулы — 2–6 января · выходной в России"));
  assert.ok(feastsFor({ publics: ru, from }).map(item => feastLine(item)).includes("Международный женский день — 8 марта · выходной в России"), "8 Марта хозяину не адресуют");

  // Убранное не возвращается; свой день с тем же названием заменяет расчётный.
  const cut = feastsFor({ publics: nl, from, removed: ["islam:mawlid", "pub:NL:пасха"] });
  assert.ok(!cut.some(item => item.title === "Мавлид ан-Наби" || item.title === "Пасха"));
  const fixed = feastsFor({ own: [{ d: 10, m: 3, y: 2027, title: "Ураза-байрам" }], from });
  assert.deepEqual(fixed.filter(item => item.title === "Ураза-байрам").map(item => `${item.kind} ${item.d}.${item.m}`), ["own 10.3"]);
  // Назвал иначе — «Ураза байрам» без дефиса, «Рамадан» — это тот же праздник: расчётный уступает.
  for (const [title, d, m, gone] of [["Ураза байрам", 10, 3, "Ураза-байрам"], ["Рамадан", 9, 2, "Начало Рамадана"], ["Курбан айт", 17, 5, "Курбан-байрам"]]) {
    const list = feastsFor({ own: [{ d, m, y: 2027, title }], from });
    assert.ok(!list.some(item => item.title === gone), `${title} заменяет «${gone}»`);
    assert.ok(list.some(item => item.title === title && item.kind === "own"));
  }
  // Исламский праздник из справочника страны и расчётный — одна строка, с пометкой о выходном.
  const tr = feastsFor({ publics: publicDays(TR(2027), "TR"), from });
  assert.deepEqual(tr.filter(item => item.title === "Ураза-байрам").map(item => feastLine(item)), ["Ураза-байрам — 9 марта · по расчёту · выходной в Турции · открытка"]);
  // Исламские выключены — остаются свои и государственные.
  assert.ok(!feastsFor({ islam: false, publics: nl, from }).some(item => item.kind === "islam"));
  // 29 февраля в невисокосный год не выдумывается.
  assert.deepEqual(feastsFor({ own: [{ d: 29, m: 2, title: "Редкий день" }], islam: false, from: { y: 2026, m: 1, d: 1 } }), []);
});

test("слова о праздниках: вопросы — всем, настройки — хозяину; чужие фразы — мимо", () => {
  const cases = {
    "какой сегодня праздник?": { today: true }, "Сегодня какой-то праздник?": { today: true }, "что сегодня отмечают": { today: true }, "какой завтра праздник": { tomorrow: true },
    "когда Ураза-байрам?": { when: "fitr" }, "когда ураза байрам в этом году": { when: "fitr" }, "какого числа курбан-байрам": { when: "adha" }, "когда курбан": { when: "adha" },
    "когда Рамадан": { when: "ramadan" }, "когда начнётся рамадан?": { when: "ramadan" }, "сколько до рамадана": { when: "ramadan" }, "сколько дней осталось до Рамадана?": { when: "ramadan" },
    "когда ураза": { when: "ramadan" }, "когда день Арафа": { when: "arafah" }, "когда ашура": { when: "ashura" }, "когда мавлид": { when: "mawlid" }, "когда ночь бараат": { when: "baraat" },
    "когда ляйлят аль-кадр": { when: "qadr" }, "когда ночь предопределения": { when: "qadr" }, "когда новый год по хиджре": { when: "newyear" }, "когда исламский новый год": { when: "newyear" },
    "какое сегодня число по хиджре?": { hijri: true }, "какой сейчас год по хиджре": { hijri: true }, "дата по хиджре": { hijri: true }, "какой сейчас исламский месяц": { hijri: true },
    "праздники России": { country: "RU", mode: "set" }, "праздники в Турции": { country: "TR", mode: "set" }, "добавь праздники Казахстана": { country: "KZ", mode: "add" },
    "убери праздники Нидерландов": { country: "NL", mode: "drop" }, "праздники страны Беларусь": { country: "BY", mode: "set" },
    "не ищи праздники сама": { auto: false }, "ищи праздники сама": { auto: true }, "не отмечай исламские праздники": { islam: false }, "отмечай исламские праздники": { islam: true },
    "обнови праздники": { refresh: true }, "откуда ты знаешь праздники?": { countries: true }, "праздники какой страны": { countries: true },
  };
  for (const [said, want] of Object.entries(cases)) assert.deepEqual(parseFeast(said), want, said);
  // Не её дело: намазы, обычные даты, разговор.
  for (const said of ["когда фаджр", "когда ифтар", "когда новый год", "когда у тебя день рождения", "когда зарплата", "какой сегодня день", "что сегодня за день", "праздники", "праздники Марса",
    "добавь праздник Навруз 21 марта", "люблю праздники", "когда рамадан кадыров стал главой", "сколько до лета", "праздники это хорошо", "я из России", "какое сегодня число"]) assert.equal(parseFeast(said), null, said);
  assert.deepEqual([countryCodeOf("России"), countryCodeOf("нидерланды"), countryCodeOf("Голландии"), countryCodeOf("NL"), countryCodeOf("Марса")], ["RU", "NL", "NL", "NL", ""]);
});

test("без города: исламские дни — сама, по календарю; «когда Ураза-байрам», «число по хиджре», «какой сегодня праздник»", async () => {
  reset();
  let now = at("2026-11-15T10:00:00Z");
  const h = heart(ON, { now: () => now });
  await h.onMessage(own("праздники"), KEY);
  const list = last(OWNER);
  assert.match(list, /^Праздники на год вперёд\. Где стоит «открытка» — поздравлю сама, после девяти утра; об остальных скажу в «добром утре»\.\n1\. Ночь Исра и Мирадж — в ночь на 5 января 2027 · по расчёту · отмечают не все\n2\. Ночь Бараат — в ночь на 23 января 2027 · по расчёту · отмечают не все\n3\. Начало Рамадана — 8 февраля 2027 · по расчёту · открытка\n4\. Ляйлят аль-Кадр — в ночь на 6 марта 2027 · по расчёту\n5\. Ураза-байрам — 9 марта 2027 · по расчёту · открытка\n/u);
  assert.match(list, /Исламские дни считаю сама, по лунному календарю Умм аль-Кура: это расчёт, а точный день объявляют по луне/u);
  assert.match(list, /Государственных нет: я не знаю, где вы живёте\. Назовите город \(«мой город Казань»\) или страну — «праздники России»\./u);
  assert.equal(asked("nagerholidays").length, 0, "без страны в справочник она не ходит");

  await h.onMessage(own("когда Ураза-байрам?"), KEY);
  assert.equal(last(OWNER), "Ураза-байрам — 9 марта 2027 года, во вторник: через 114 дней. Это расчёт по календарю Умм аль-Кура; точный день объявляют по луне, и он бывает на сутки позже.");
  await h.onMessage(own("когда рамадан"), KEY);
  assert.match(last(OWNER), /^Начало Рамадана — 8 февраля 2027 года, в понедельник: через 85 дней\. Первый день поста — 8 февраля; первый таравих — накануне вечером\. Это расчёт/u);
  await h.onMessage(own("когда ночь бараат"), KEY);
  assert.match(last(OWNER), /^Ночь Бараат — в ночь на 23 января 2027 года, в субботу: через 69 дней\. Это ночь: она начинается накануне вечером, 22 января\..* Отмечают этот день не все общины\.$/u);
  await h.onMessage(own("какое сегодня число по хиджре?"), KEY);
  assert.match(last(OWNER), /^Сегодня 5 джумада ас-сани 1448 года по хиджре — по расчётному календарю Умм аль-Кура\./u);
  await h.onMessage(own("какой сегодня праздник?"), KEY);
  assert.equal(last(OWNER), "Сегодня, 15 ноября, праздников в моём списке нет. Ближайший — Начало Рамадана, 8 февраля (через 85 дней). По хиджре — 5 джумада ас-сани 1448.");
  // Не хозяину — те же расчётные дни; настройки — не ему.
  await h.onMessage(message("когда курбан-байрам?"), KEY);
  assert.match(last(), /^Курбан-байрам — 16 мая 2027 года, в воскресенье: через 182 дня\./u);
  await h.onMessage(message("праздники России"), KEY);
  assert.equal(last(), "Праздники я ищу для хозяина, и настраивает их он — в личке.");

  // В сам день — «какой сегодня праздник»; накануне ночи — о ней.
  now = at("2027-03-09T10:00:00Z");
  await h.onMessage(own("какой сегодня праздник"), KEY);
  assert.match(last(OWNER), /^Сегодня, 9 марта: Ураза-байрам \(по расчёту\)\. Ближайший — Курбан-байрам, 16 мая \(через 68 дней\)\. По хиджре — 1 шавваля 1448\.$/u);
  now = at("2027-01-22T10:00:00Z");
  await h.onMessage(own("что сегодня отмечают?"), KEY);
  assert.match(last(OWNER), /^Сегодня, 22 января: вечером начинается ночь Бараат \(отмечают не все\) \(по расчёту\)\./u);
  assert.equal(chats().length, 0, "модель не тратится");
});

test("город хозяина → страна → её праздники из справочника; открытка — в свой день, один раз; за два дня до байрама — слово", async () => {
  reset();
  lelystad();
  nager();
  source("flux-1-schnell", image());
  let now = at("2026-11-15T10:00:00Z");
  const h = heart(ON, { now: () => now });
  await h.onMessage(own("мой город — Лелистад"), KEY);
  assert.match(last(OWNER), /ваш город — Лелистад/u);
  await h.onMessage(own("праздники"), KEY);
  const list = last(OWNER);
  for (const line of [
    "1. Рождество — 25 декабря · выходной в Нидерландах", "2. Второй день Рождества — 26 декабря · выходной в Нидерландах", "3. Новый год — 1 января 2027 · выходной в Нидерландах · открытка",
    "Ураза-байрам — 9 марта 2027 · по расчёту · открытка", "Пасха — 28 марта 2027 · выходной в Нидерландах\n", "День короля — 27 апреля 2027 · выходной в Нидерландах · открытка",
    "День освобождения — 5 мая 2027 · памятный день в Нидерландах", "Курбан-байрам — 16 мая 2027 · по расчёту · открытка\n",
  ]) assert.ok(list.includes(line), line);
  assert.match(list, /Государственные — Нидерландов, из открытого справочника Nager\.Date \(страна — по вашему городу, Лелистад\)\. Другая страна — «праздники России»/u);
  assert.deepEqual(asked("nagerholidays").map(url => url.split("/Holidays/")[1]).sort(), ["NL/2026", "NL/2027"], "два года — два запроса");
  // Второй раз в справочник не идёт: ответ лежит в запасе.
  await h.onMessage(own("праздники"), KEY);
  assert.equal(asked("nagerholidays").length, 2);


  const before = toOwner().length;
  // Рождество: выходной, но не её повод — ни открытки, ни слова.
  now = at("2026-12-25T10:00:00Z");
  await h.tick({});
  assert.equal(cards().length, 0);
  assert.equal(toOwner().length, before);
  // Новый год: рано — тишина; после девяти по Амстердаму — открытка, один раз.
  now = at("2027-01-01T07:30:00Z");
  await h.tick({});
  assert.equal(cards().length, 0);
  now = at("2027-01-01T08:05:00Z");
  await h.tick({});
  await h.tick({});
  assert.equal(cards().length, 1);
  assert.equal(prompts().at(-1), OCCASIONS.newyear.prompt);
  assert.ok(pool("+открытка:новый год").includes(cards()[0].caption), cards()[0].caption);

  // За два дня до расчётного байрама — одно слово: день объявляют по луне.
  now = at("2027-03-07T10:00:00Z");
  await h.tick({});
  await h.tick({});
  assert.equal(toOwner().at(-1).text, "Хозяин, послезавтра, 9 марта, по расчёту — Ураза-байрам. Точный день объявляют по луне, и он бывает на сутки позже. Если у вас назовут другой — скажите мне: «добавь праздник Ураза-байрам 10 марта 2027», и поздравлю в тот день.");
  assert.equal(toOwner().filter(item => /послезавтра, 9 марта/u.test(item.text)).length, 1, "один раз");
  // В сам день — открытка: мечеть и полумесяц, слова — «Ид мубарак».
  now = at("2027-03-09T09:00:00Z");
  await h.tick({});
  assert.equal(cards().length, 2);
  assert.equal(prompts().at(-1), OCCASIONS.eid.prompt);
  assert.ok(pool("+открытка:ид").map(line => `Ураза-байрам. ${line}`).includes(cards()[1].caption), cards()[1].caption);
  // Начало Рамадана — свой рисунок и свои слова; о нём тоже предупреждала.
  assert.equal(toOwner().filter(item => /послезавтра, 8 февраля, по расчёту — Начало Рамадана/u.test(item.text)).length, 0, "6 февраля будильник в этом тесте не звонил");
  now = at("2028-01-28T09:00:00Z"); // 1 рамадана 1449
  await h.tick({});
  assert.equal(prompts().at(-1), OCCASIONS.ramadan.prompt);
  assert.ok(pool("+открытка:рамадан").includes(cards().at(-1).caption), cards().at(-1).caption);
  assert.equal(chats().length, 0, "модель не тратится");
  // В «статусе» — строка о праздниках: по ней видно, чьи она ищет.
  await h.onMessage(own("статус"), KEY);
  assert.match(last(OWNER), /\nПраздники: ищу сама · исламские — по лунному календарю · государственные — Нидерланды \(по городу\)\n/u);
});

test("хозяин поправляет: свой день вместо расчётного, «убери праздник N» — навсегда, «верни праздники», другая страна", async () => {
  reset();
  lelystad();
  nager();
  source("flux-1-schnell", image());
  let now = at("2026-11-15T10:00:00Z");
  const h = heart(ON, { now: () => now });
  await h.onMessage(own("мой город — Лелистад"), KEY);

  // В его общине байрам на день позже расчётного: он называет день — расчётный уступает.
  await h.onMessage(own("добавь праздник Ураза-байрам 10 марта 2027"), KEY);
  assert.equal(last(OWNER), "Запомнила, хозяин: Ураза-байрам — 10 марта 2027, один раз. В этот день пришлю открытку. Расчётный день этого праздника я убрала: ваш вернее.");
  await h.onMessage(own("когда ураза-байрам"), KEY);
  assert.equal(last(OWNER), "Ураза-байрам — 10 марта 2027 года, в среду: через 115 дней. Этот день назвали вы сами.");
  now = at("2027-03-09T09:00:00Z");
  await h.tick({});
  assert.equal(cards().length, 0, "в расчётный день — тишина");
  assert.equal(toOwner().filter(item => /послезавтра/u.test(item.text)).length, 0, "и заранее не спрашивала: день назван");
  now = at("2027-03-10T09:00:00Z");
  await h.tick({});
  assert.equal(cards().length, 1);
  assert.equal(prompts().at(-1), OCCASIONS.eid.prompt, "свой байрам — та же открытка");
  // Через год его разовая поправка не действует — снова расчёт.
  now = at("2028-02-26T09:00:00Z"); // 1 шавваля 1449
  await h.tick({});
  assert.equal(cards().length, 2);

  // «Убери праздник N» — по номеру из показанного списка; найденный праздник убирается на все годы.
  now = at("2026-11-15T10:00:00Z");
  await h.onMessage(own("праздники"), KEY);
  const number = Number(last(OWNER).match(/\n(\d+)\. День короля — 27 апреля 2027/u)[1]);
  await h.onMessage(own(`убери праздник ${number}`), KEY);
  assert.equal(last(OWNER), "Убрала: День короля (27 апреля). Этот праздник я больше не покажу и с ним не поздравлю — ни в этом году, ни в следующих. Вернуть убранное — «верни праздники».");
  await h.onMessage(own("убери праздник Мавлид ан-Наби"), KEY);
  assert.match(last(OWNER), /^Убрала: Мавлид ан-Наби \(14 августа\)\./u);
  await h.onMessage(own("праздники"), KEY);
  assert.doesNotMatch(last(OWNER), /День короля|Мавлид/u);
  assert.match(last(OWNER), /Убрано вами: 2\. Вернуть всё — «верни праздники»\./u);
  now = at("2027-04-27T09:00:00Z");
  await h.tick({});
  now = at("2028-04-27T09:00:00Z");
  await h.tick({});
  assert.equal(cards().length, 2, "убранный праздник не возвращается и через год");
  now = at("2026-11-15T10:00:00Z");
  await h.onMessage(own("верни праздники"), KEY);
  assert.equal(last(OWNER), "Вернула: 2 праздника снова в списке.");
  await h.onMessage(own("праздники"), KEY);
  assert.match(last(OWNER), /День короля — 27 апреля 2027/u);

  // Другая страна словом; ещё одна — «добавь»; лишняя — «убери».
  await h.onMessage(own("праздники России"), KEY);
  assert.equal(last(OWNER), "Хорошо, хозяин: теперь ищу праздники России — в этом году их 9. Список — «праздники».");
  await h.onMessage(own("праздники"), KEY);
  assert.match(last(OWNER), /\d+\. Новый год — 1 января 2027 · выходной в России · открытка\n\d+\. Новогодние каникулы — 2–6 января 2027 · выходной в России\n(?:.*\n)*\d+\. Рождество Христово — 7 января 2027 · выходной в России\n/u);
  assert.match(last(OWNER), /День защитника Отечества — 23 февраля 2027 · выходной в России · открытка/u);
  assert.match(last(OWNER), /Международный женский день — 8 марта 2027 · выходной в России\n/u);
  assert.doesNotMatch(last(OWNER), /Нидерланд|Пасха/u);
  await h.onMessage(own("добавь праздники Нидерландов"), KEY);
  assert.match(last(OWNER), /^Хорошо, хозяин: добавила праздники Нидерландов — в этом году их 11\. Всего стран: Россия, Нидерланды\./u);
  await h.onMessage(own("убери праздники России"), KEY);
  assert.equal(last(OWNER), "Убрала праздники России. Вернуть — «праздники России».");
  await h.onMessage(own("откуда ты знаешь праздники?"), KEY);
  assert.match(last(OWNER), /Государственные — Нидерландов, из открытого справочника Nager\.Date\. Другая страна/u);

  // 23 февраля — открытка; 8 Марта — не ему: без открытки.
  await h.onMessage(own("праздники России"), KEY);
  now = at("2027-02-23T09:00:00Z");
  await h.tick({});
  // (В этот же день — сотый день знакомства: открыток две, и одна из них — к 23 февраля.)
  assert.ok(prompts().includes(OCCASIONS.feb23.prompt));
  const count = cards().length;
  now = at("2027-03-08T09:00:00Z");
  await h.tick({});
  assert.equal(cards().length, count);
  assert.ok(!prompts().includes(OCCASIONS.march8.prompt));

  // Выключить совсем — остаются только свои; исламские — отдельно.
  now = at("2026-11-15T10:00:00Z");
  await h.onMessage(own("не отмечай исламские праздники"), KEY);
  await h.onMessage(own("праздники"), KEY);
  assert.doesNotMatch(last(OWNER), /по расчёту/u);
  assert.match(last(OWNER), /Исламские праздники не показываю — вы так просили\. Вернуть — «отмечай исламские праздники»\./u);
  await h.onMessage(own("не ищи праздники сама"), KEY);
  await h.onMessage(own("праздники"), KEY);
  assert.match(last(OWNER), /^Праздники на год вперёд\.[^\n]*\n1\. Ураза-байрам — 10 марта 2027 · ваш, один раз · открытка\n\nСама я праздники сейчас не ищу/u);
  await h.onMessage(own("ищи праздники сама"), KEY);
  await h.onMessage(own("отмечай исламские праздники"), KEY);
  assert.match(last(OWNER), /исламские праздники снова в списке/u);
  assert.equal(chats().length, 0);
});

test("справочник молчит или не знает страну — честные слова; старая запись о городе без кода страны — спросит ещё раз", async () => {
  // Страны справочник не знает: 404 запоминается, и каждый час он не спрашивается.
  reset();
  nager();
  let now = at("2026-11-15T10:00:00Z");
  let h = heart(ON, { now: () => now });
  await h.onMessage(own("праздники Узбекистана"), KEY);
  assert.equal(last(OWNER), "Страны «Узбекистан» справочник праздников не знает. Её праздники можно назвать самому: «добавь праздник Навруз 21 марта».");
  await h.onMessage(own("праздники Узбекистана"), KEY);
  assert.equal(asked("Holidays/UZ").length, 1, "«не знает» запомнено");

  // Справочник не отвечает: исламские дни остаются, о стране — честно; будильник не стучится каждую минуту.
  reset();
  lelystad();
  source("nagerholidays.com", new Error("network down"));
  h = heart(ON, { now: () => now });
  await h.onMessage(own("мой город — Лелистад"), KEY);
  await h.onMessage(own("праздники"), KEY);
  assert.match(last(OWNER), /Ураза-байрам — 9 марта 2027 · по расчёту · открытка/u);
  assert.match(last(OWNER), /Справочник сейчас не ответил по стране: Нидерланды\. Спрошу ещё раз позже\./u);
  await h.onMessage(own("праздники России"), KEY);
  assert.equal(last(OWNER), "Справочник праздников сейчас не отвечает. Попробуйте чуть позже.");
  const tries = asked("nagerholidays").length;
  for (let minute = 0; minute < 30; minute += 1) { now += 60_000; await h.tick({}); }
  assert.ok(asked("nagerholidays").length - tries <= 2, "полчаса будильника — один заход в справочник (за два года), а не тридцать");

  // Запись о городе легла в запас до того, как понадобился код страны: справочник городов спрашивается ещё раз.
  reset();
  nager();
  lelystad({});
  now = at("2026-11-15T10:00:00Z");
  h = heart(ON, { now: () => now });
  await h.onMessage(own("мой город — Лелистад"), KEY);
  sdk().sourceReplies.length = 0;
  nager();
  lelystad();
  await h.onMessage(own("праздники"), KEY);
  assert.match(last(OWNER), /Новый год — 1 января 2027 · выходной в Нидерландах · открытка/u);
  // Кода нет и во втором ответе — страна узнаётся по её русскому имени.
  reset();
  nager();
  lelystad({});
  h = heart(ON, { now: () => now });
  await h.onMessage(own("мой город — Лелистад"), KEY);
  await h.onMessage(own("праздники"), KEY);
  assert.match(last(OWNER), /Новый год — 1 января 2027 · выходной в Нидерландах · открытка/u);

  // Выключено настройкой — как раньше: только свои, вопросы о праздниках идут мимо.
  reset();
  h = heart({ ...ON, FEASTS: false }, { now: () => now });
  await h.onMessage(own("праздники"), KEY);
  assert.match(last(OWNER), /^Праздников в моём списке нет\.\n\nСама я праздники сейчас не ищу/u);
  await h.onMessage(own("когда ураза-байрам"), KEY);
  assert.doesNotMatch(last(OWNER), /9 марта 2027 года/u, "вопрос ушёл в разговор, а не к календарю");
  assert.deepEqual(JSON.parse(sdk().kv.get(HOLIDAYS_KEY) ?? "{}").day?.due ?? [], []);
});

test("в «добром утре» — строка о дне, с которым открытки не будет: выходной, памятный день, ночь", async () => {
  const { fajrOn } = await import("../tgcloud/lib/fajr.js");
  const dawn = (y, m, d) => fajrOn({ y, m, d, latitude: 52.5083, longitude: 5.475 }).fajr + 2 * 60_000;
  reset();
  lelystad();
  nager();
  source("flux-1-schnell", image());
  let now = at("2026-11-15T10:00:00Z");
  const h = heart(ON, { now: () => now });
  await h.onMessage(own("мой город — Лелистад"), KEY);
  const morning = async (y, m, d) => { now = dawn(y, m, d); const before = toOwner().length; await h.tick({}); return toOwner().slice(before).map(item => item.text).join("\n").split("\n").slice(1); };
  // Пасхальный понедельник: в стране выходной — она скажет, но не поздравит.
  assert.deepEqual(await morning(2027, 3, 29), ["Сегодня в Нидерландах выходной: Пасхальный понедельник."]);
  // День Арафа — расчётный памятный день.
  assert.deepEqual(await morning(2027, 5, 15), ["Сегодня — День Арафа."]);
  // Ночь Бараат начинается вечером накануне её числа.
  assert.deepEqual(await morning(2027, 1, 22), ["Сегодня вечером начинается ночь Бараат (её отмечают не все)."]);
  // День открытки — строки нет: поздравление придёт после девяти.
  assert.deepEqual(await morning(2027, 4, 27), []);
  // Обычный день — без строки.
  assert.deepEqual(await morning(2027, 4, 14), []);
  // Открытки выключены — о празднике скажет строкой.
  await h.onMessage(own("не присылай открытки"), KEY);
  assert.deepEqual(await morning(2027, 5, 16), ["Сегодня — Курбан-байрам. С праздником!", "Сегодня в Нидерландах выходной: Пятидесятница."]);
  assert.equal(chats().length, 0, "модель не тратится");
});
