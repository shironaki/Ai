/**
 * Мир вокруг: то, что Аи узнаёт не из модели (счёт, погода, курс, вики), во
 * что играет с судьёй-кодом, что показывает картинкой — и как это уживается
 * с разговором.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  heart, message, group, hers, says, refuses, reset, sdk, request, chats, last, toOwner, toChat, reactions,
  source, sourced, calls, dice, withSister, KEY, OWNER, DAY,
} from "./fixtures/kit.mjs";

const { calculate } = await import("../tgcloud/lib/calc.js");
const { parseIntent } = await import("../tgcloud/lib/intents.js");
const { detectSource, knownCity, factQuery, currencyCode } = await import("../tgcloud/lib/sources.js");
const { parseGame, tail } = await import("../tgcloud/lib/games.js");
const { parsePicture } = await import("../tgcloud/lib/pictures.js");
const { parseReminder, nextOccurrence } = await import("../tgcloud/lib/reminders.js");
const { CITIES } = await import("../tgcloud/lib/data/cities.js");
const { FIVE_LETTER, LONG_WORDS } = await import("../tgcloud/lib/data/words.js");
const { RIDDLES, MOVIES } = await import("../tgcloud/lib/data/riddles.js");

const TZ = "Europe/Moscow";
/** 12 ноября 2026, 16:00 по Москве, четверг. */
const NOON = Date.UTC(2026, 10, 12, 13, 0);

// Ответы источников, как их отдают настоящие сервисы.
const kazan = { results: [{ name: "Казань", latitude: 55.79, longitude: 49.12, country: "Россия", admin1: "Татарстан", timezone: "Europe/Moscow", feature_code: "PPLA" }] };
const novosibirsk = { results: [{ name: "Новосибирск", latitude: 55.04, longitude: 82.93, country: "Россия", admin1: "Новосибирская область", timezone: "Asia/Novosibirsk", feature_code: "PPLA" }] };
const forecast = {
  current: { temperature_2m: 4.6, apparent_temperature: 1.2, weather_code: 61, wind_speed_10m: 5.2 },
  daily: { temperature_2m_max: [6.1, 3.4, 1.2], temperature_2m_min: [1.9, -0.6, -3.1], weather_code: [61, 3, 71], precipitation_probability_max: [80, 10, 55] },
};
const bank = { Date: "2026-11-12T11:30:00+03:00", Valute: {
  USD: { Nominal: 1, Value: 81.25, Previous: 80.75 }, EUR: { Nominal: 1, Value: 94.5, Previous: 94.5 },
  CNY: { Nominal: 1, Value: 11.42, Previous: 11.4 }, KZT: { Nominal: 100, Value: 15.6, Previous: 15.6 },
} };
const page = (title, extract, extra = {}) => ({ type: "standard", title, description: "", extract, content_urls: { desktop: { page: `https://ru.wikipedia.org/wiki/${title}` } }, ...extra });
const withWeather = () => {
  source("geocoding-api.open-meteo.com", (url) => (decodeURIComponent(url).includes("Новосибирск") ? novosibirsk : decodeURIComponent(url).includes("Казань") ? kazan : { generationtime_ms: 0.1 }));
  source("api.open-meteo.com/v1/forecast", forecast);
};

// ── счёт ─────────────────────────────────────────────────────────────────

test("счёт: считает код, а не модель — точно и на любых числах", async () => {
  assert.equal(calculate("2+2*2").text, "6");
  // Разряды разделены узким неразрывным пробелом: число не рвётся на переносе.
  assert.equal(calculate("сколько будет 123456789 * 987654321").value, "121 932 631 112 635 269".replace(/ /gu, "\u202f"));
  assert.equal(calculate("15% от 2300").text, "345");
  assert.equal(calculate("2300 + 15%").text, "2645");
  assert.equal(calculate("сколько будет 0,1 + 0,2").text, "0,3");
  assert.equal(calculate("корень из 144").text, "12");
  assert.equal(calculate("посчитай, пожалуйста, (15 + 7) * 3").line, "(15 + 7) × 3 = 66");
  assert.equal(calculate("сколько процентов составляет 30 от 120").text, "25%");
  assert.equal(calculate("вычисли 2 в степени 100").value, "1 267 650 600 228 229 401 496 703 205 376".replace(/ /gu, "\u202f"));
  assert.equal(calculate("сколько будет 1/0").code, "div_zero");
  // Телефон, время, дата, диапазон и разговор — не примеры.
  for (const not of ["+7 999 123-45-67", "8-800-555-35-35", "12:30", "12.11.2026", "10-12", "50%", "привет", "посчитай 5 яблок", "сколько будет стоить билет"]) {
    assert.equal(calculate(not), null, not);
  }

  reset();
  const h = heart();
  await h.onMessage(message("сколько будет 17 × 23?"), KEY);
  assert.equal(last(), "17 × 23 = 391");
  await h.onMessage(message("сколько будет 5/0"), KEY);
  assert.match(last(), /На ноль делить нельзя/);
  assert.equal(chats().length, 0, "модель не спрашивали");
  assert.equal((await h.status()).today.sourced, 2, "оба ответа — из источника");
});

// ── погода, курс, часы ───────────────────────────────────────────────────

test("погода: город в любом падеже, прогноз у метеослужбы, город запоминается", async () => {
  assert.equal(knownCity("нижнем новгороде"), "Нижний Новгород");
  assert.equal(knownCity("санкт-петербурге"), "Санкт-Петербург");
  assert.equal(knownCity("набережных челнах"), "Набережные Челны");
  assert.equal(knownCity("орле"), "Орёл");
  assert.equal(knownCity("отличная, правда"), null);
  assert.deepEqual(detectSource("погода в москве на завтра"), { kind: "weather", place: "москве", explicit: true, day: 1, asked: "погода" });

  reset();
  withWeather();
  const h = heart();
  await h.onMessage(message("Какая погода в Казани?"), KEY);
  assert.match(last(), /^Казань, сейчас \+5° \(ощущается как \+1°\), небольшой дождь, ветер 5 м\/с\.\nСегодня: от \+2° до \+6°, небольшой дождь, осадки — 80%\.\nЗавтра: от −1° до \+3°, пасмурно\./);
  assert.match(last(), /Город запомнила/);
  // Дальше хватит одного слова — и о городе больше не напоминает.
  await h.onMessage(message("погода"), KEY);
  assert.match(last(), /^Казань, сейчас \+5°/);
  assert.doesNotMatch(last(), /Город запомнила/);
  await h.onMessage(message("какая погода завтра"), KEY);
  assert.match(last(), /^Казань\.\nЗавтра: от −1° до \+3°, пасмурно\.\nПослезавтра: от −3° до \+1°, небольшой снег, осадки — 55%\./);
  assert.equal(chats().length, 0, "погоду не придумывает модель");

  // «Погода сегодня отличная, правда?» — разговор, а не просьба.
  sdk().fetchQueue.push(says("И правда хорошая."));
  await h.onMessage(message("погода сегодня отличная, правда?"), KEY);
  assert.equal(last(), "И правда хорошая.");
  assert.equal(chats().length, 1);

  // Рассказ о погоде — тоже разговор: после города идут ещё слова.
  sdk().fetchQueue.push(says("Рада за Москву."));
  await h.onMessage(message("погода в Москве нынче радует"), KEY);
  assert.equal(last(), "Рада за Москву.");

  // Города нет ни в её списке, ни в справочнике — так и говорит.
  await h.onMessage(message("погода в Зажопинске"), KEY);
  assert.match(last(), /Города «зажопинске» я не нашла/);
});

test("погода: служба молчит — честно говорит, что не знает; без города — спрашивает", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("погода"), KEY);
  assert.match(last(), /В каком городе\? Скажите целиком: «погода в Казани»/);
  await h.onMessage(message("погода в Казани"), KEY);
  assert.match(last(), /Метеослужба сейчас не отвечает, а придумывать погоду я не стану/);
  assert.equal(chats().length, 0);
});

test("курс: таблица, пересчёт, слова о валютах; главный источник молчит — отвечает запасной", async () => {
  assert.equal(currencyCode("долларов"), "USD");
  assert.equal(currencyCode("рублях"), "RUB");
  assert.equal(currencyCode("сумка"), null);
  assert.equal(detectSource("сколько стоит айфон"), null);
  // Пересчёт — не перевод денег: «переведи ему 500 рублей» остаётся не её делом.
  assert.equal(parseIntent("переведи 5000 рублей в доллары"), null);
  assert.equal(parseIntent("переведи ему 500 рублей").intent, "not_mine");

  reset();
  source("cbr-xml-daily.ru", bank);
  const h = heart();
  await h.onMessage(message("курс доллара"), KEY);
  assert.equal(last(), "Курс на 12.11:\nдоллар — 81,25 ₽ (за день +0,50)");
  await h.onMessage(message("курс"), KEY);
  assert.match(last(), /доллар — 81,25 ₽ \(за день \+0,50\)\nевро — 94,50 ₽\nюань — 11,42 ₽ \(за день \+0,02\)/);
  await h.onMessage(message("100 евро в рублях"), KEY);
  assert.equal(last(), "100 евро — это 9\u202f450,00 ₽ по курсу на 12.11.");
  await h.onMessage(message("переведи 5000 рублей в доллары"), KEY);
  assert.equal(last(), "5\u202f000 рублей — это 61,54 $ по курсу на 12.11.");
  await h.onMessage(message("сколько стоит тенге"), KEY);
  assert.match(last(), /100 тенге — 15,60 ₽/);
  assert.equal(sourced().filter(url => url.includes("cbr")).length, 1, "таблица берётся один раз и лежит в запасе");
  assert.equal(chats().length, 0);

  reset();
  const down = heart();
  await down.onMessage(message("курс доллара"), KEY);
  assert.match(last(), /Курс сейчас узнать не у кого, а называть его по памяти я не стану/);

  // Главный источник молчит — отвечает запасной: рыночный курс, без «за день».
  reset();
  const spare = heart();
  source("cdn.jsdelivr.net/npm/@fawazahmed0/currency-api", { date: "2026-11-12", rub: { usd: 0.0125, eur: 0.01, btc: 1e-7, rub: 1 } });
  await spare.onMessage(message("курс доллара"), KEY);
  assert.equal(last(), "Курс на 12.11:\nдоллар — 80,00 ₽");
  await spare.onMessage(message("сколько будет 10 евро в рублях"), KEY);
  assert.equal(last(), "10 евро — это 1\u202f000,00 ₽ по курсу на 12.11.");

  // Молчат оба — третий: таблица к доллару.
  reset();
  const third = heart();
  source("open.er-api.com/v6/latest/USD", { time_last_update_unix: 1794528151, rates: { USD: 1, RUB: 80, EUR: 0.8 } });
  await third.onMessage(message("курс евро"), KEY);
  assert.equal(last(), "Курс на 13.11:\nевро — 100,00 ₽");
  const probe = await third.status({ chatId: 5, actorId: 77 }).catch(() => null);
  assert.ok(probe);
});

test("часы и календарь: время по своим часам и по городу человека, дни до даты", async () => {
  reset();
  withWeather();
  const h = heart({}, { now: () => NOON });
  await h.onMessage(message("который час?"), KEY);
  assert.equal(last(), "Сейчас 16:00, четверг, 12 ноября — по моим часам.");
  await h.onMessage(message("сколько дней до нового года"), KEY);
  assert.equal(last(), "До Нового года — 50 дней.");
  await h.onMessage(message("сколько осталось до 25.12"), KEY);
  assert.equal(last(), "До 25.12 — 43 дня.");

  // Город назван — часы человека теперь его: и «который час», и «напомни в 9».
  await h.onMessage(message("мой город — Новосибирск"), KEY);
  assert.match(last(), /Запомнила: ваш город — Новосибирск/);
  await h.onMessage(message("который час"), KEY);
  assert.equal(last(), "Сейчас 20:00, четверг, 12 ноября — Новосибирск.");
  await h.onMessage(message("напомни завтра в 9 позвонить"), KEY);
  assert.match(last(), /напомню завтра в 09:00 \(по времени: Новосибирск\): «позвонить»/);
  const [item] = await h.reminders.list(5);
  assert.equal(new Date(item.at).toISOString(), "2026-11-13T02:00:00.000Z", "девять утра по Новосибирску");
  assert.equal(chats().length, 0);
});

// ── энциклопедия ─────────────────────────────────────────────────────────

test("вики: прямой вопрос — статья своими словами, без ссылки; несколько значений — уточняет", async () => {
  reset();
  source("page/summary/%D0%B1%D0%B0%D0%B9%D0%BA%D0%B0%D0%BB", page("Байкал", "Байкал — озеро тектонического происхождения в южной части Восточной Сибири, самое глубокое озеро на планете.", { description: "озеро в России" }));
  source("page/summary/%D0%BA%D0%BB%D1%8E%D1%87", { type: "disambiguation", title: "Ключ" });
  source("list=search", { query: { search: [{ title: "Ключ" }, { title: "Ключ (инструмент)" }, { title: "Родник" }] } });
  const h = heart();
  await h.onMessage(message("вики Байкал"), KEY);
  assert.equal(last(), "Байкал — озеро в России\n\nБайкал — озеро тектонического происхождения в южной части Восточной Сибири, самое глубокое озеро на планете.");
  await h.onMessage(message("что пишет википедия про ключ"), KEY);
  assert.match(last(), /У «Ключ» несколько значений: Ключ \(инструмент\); Родник\. Уточните: «вики Ключ \(инструмент\)»/);
  await h.onMessage(message("вики Ыыыы"), KEY);
  assert.match(last(), /^Про «ыыыы» я ничего не знаю\.$/);
  assert.equal(chats().length, 0);
});

test("вики: «что такое …» — модель отвечает своим голосом по справке; думать нечем — отвечает статья", async () => {
  assert.equal(factQuery("Что такое фотосинтез?"), "фотосинтез");
  assert.equal(factQuery("кто ты такая"), null);
  assert.equal(factQuery("что такое моя жизнь"), null);

  reset();
  source("page/summary/", page("Фотосинтез", "Фотосинтез — сложный химический процесс преобразования энергии света в энергию химических связей органических веществ."));
  const h = heart();
  sdk().fetchQueue.push(says("Это когда растение ест свет."));
  await h.onMessage(message("Что такое фотосинтез?"), KEY);
  assert.equal(last(), "Это когда растение ест свет.");
  const prompt = JSON.stringify(request().messages);
  assert.match(prompt, /Справка из Википедии по вопросу \(«Фотосинтез»\): Фотосинтез — сложный химический процесс/);
  assert.match(prompt, /своим голосом и своими словами/);
  // «Почему ты так ответила» называет источник.
  await h.onMessage(message("на что ты опиралась"), KEY);
  assert.match(last(), /Википедия: «Фотосинтез»/);

  // Википедия молчит: справки нет, ответ есть — и второй раз её не ждут.
  reset();
  source("page/summary/", new Error("ETIMEDOUT"));
  const alone = heart();
  sdk().fetchQueue.push(says("Отвечу как помню."), says("И ещё раз."));
  await alone.onMessage(message("что такое квазар"), KEY);
  await alone.onMessage(message("что такое пульсар"), KEY);
  assert.equal(last(), "И ещё раз.");
  assert.equal(sourced().length, 1, "после отказа пять минут к источнику попутно не ходит");
  assert.doesNotMatch(JSON.stringify(request().messages), /Справка из Википедии/);

  reset();
  source("page/summary/", page("Фотосинтез", "Фотосинтез — сложный химический процесс преобразования энергии света в энергию химических связей органических веществ."));
  // Лимит вышел: вопрос не уходит в очередь — отвечает сама статья.
  sdk().fetchQueue.push(refuses(429, { code: "rate_limit_exceeded", headers: { "retry-after": "900" } }));
  await h.onMessage(message("что такое фотосинтез"), KEY);
  assert.match(last(), /^Своими словами сейчас не выйдет — думать нечем\. Коротко по сути:\n\nФотосинтез — сложный/);
  assert.equal(await h.queue.size(), 0);
});

// ── игры ─────────────────────────────────────────────────────────────────

test("игры: свои данные лежат рядом с кодом и годятся для игры", () => {
  assert.ok(CITIES.length >= 450, `городов ${CITIES.length}`);
  assert.equal(new Set(CITIES).size, CITIES.length, "города без повторов");
  assert.ok(FIVE_LETTER.length >= 200 && FIVE_LETTER.every(word => [...word].length === 5 && /^[а-яё]+$/u.test(word)));
  assert.ok(LONG_WORDS.length >= 80 && RIDDLES.length >= 40 && MOVIES.length >= 30);
  assert.ok(RIDDLES.every(item => item.length >= 2 && item.every(Boolean)));
  // На каждую частую последнюю букву у неё есть чем ответить.
  for (const letter of "акнорвлдтигсмея") assert.ok(CITIES.some(city => city.toLowerCase().startsWith(letter)), `нет города на «${letter}»`);
  assert.equal(tail("Казань"), "н");
  assert.equal(tail("Грозный"), "н");
  assert.equal(tail("Чебоксары"), "р");
});

test("игры: просьба об игре понимается словами, разговор об играх — нет", () => {
  const game = (text) => parseGame(text.toLowerCase().replace(/ё/gu, "е"), text);
  assert.equal(game("давай сыграем").intent, "play");
  assert.equal(game("давай сыграем").arg, null);
  assert.equal(game("во что можно поиграть").arg, null);
  for (const [said, kind] of [["сыграем в города", "cities"], ["города", "cities"], ["го в виселицу", "hangman"], ["5 букв", "five"], ["загадай загадку", "riddle"], ["анаграмма", "anagram"], ["фильм по эмодзи", "movie"], ["быки и коровы", "bulls"], ["угадай мое число", "guess"], ["камень, ножницы, бумага", "rps"], ["сыграем в слова", "words"]]) {
    assert.equal(game(said)?.arg?.game, kind, said);
  }
  assert.deepEqual(game("загадай число от 1 до 1000").arg, { game: "number", from: 1, to: 1000 });
  assert.deepEqual(game("2d6").arg, { kind: "dice", count: 2, sides: 6 });
  assert.deepEqual(game("выбери за меня: Пицца, Суши или Бургер").arg, { kind: "choose", options: ["Пицца", "Суши", "Бургер"] });
  assert.equal(game("дуэль").intent, "sister_play");
  assert.equal(game("викторина"), null, "викторина — её собственный квиз, а не игра сестры");
  for (const talk of ["слова", "расскажи про города россии", "мне нравится играть", "камень упал", "выбери мне подарок", "шар земной круглый"]) assert.equal(game(talk), null, talk);
});

test("игры: города — судит код, незнакомый город проверяется по справочнику", async () => {
  reset();
  source("geocoding-api.open-meteo.com", (url) => (/name=невьянск/iu.test(decodeURIComponent(url)) ? { results: [{ name: "Невьянск", latitude: 57.5, longitude: 60.2, country: "Россия", timezone: "Asia/Yekaterinburg", feature_code: "PPL" }] } : { generationtime_ms: 0.1 }));
  // Случайность по кругу: первый город — «Казань» (индекс по списку), дальше — первый подходящий.
  const first = CITIES.indexOf("Казань") / CITIES.length + 0.0001;
  const h = heart({}, { random: dice(first, 0, 0, 0, 0) });
  await h.onMessage(message("сыграем в города"), KEY);
  assert.match(last(), /^Играем в города: .*Начну: Казань\. Вам на «Н»\.$/);

  await h.onMessage(message("Москва"), KEY);
  assert.equal(last(), "Нужен город на «Н», а Москва — на «М».");
  await h.onMessage(message("Новосибирск"), KEY);
  assert.match(last(), /^[А-ЯЁ][а-яё-]+(?: [А-ЯЁа-яё-]+)*\. Вам на «[А-ЯЁ]»\.$/);
  const reply = last().split(".")[0];
  assert.equal(reply[0], "К", "ответила городом на последнюю букву");

  // Её город кончается на букву — берём её и называем уже сказанное.
  await h.onMessage(message("подсказка"), KEY);
  assert.match(last(), /^Подсказка: есть город на «/);
  await h.onMessage(message("какая буква"), KEY);
  const need = last().match(/нужен город на «(.)»/)[1];
  assert.ok(need);

  // Разговор посреди игры — не ход: модель знает, что идёт игра, и не судит.
  sdk().fetchQueue.push(says("Нормально. Ваш ход!"));
  await h.onMessage(message("как дела?"), KEY);
  assert.equal(last(), "Нормально. Ваш ход!");
  assert.match(JSON.stringify(request().messages), /идёт игра «города»: ходы судит код, а не ты/);

  await h.onMessage(message("сдаюсь"), KEY);
  assert.match(last(), /^Хорошо, закончили\. Сыграно ходов: 1\./);
  assert.equal(chats().length, 1, "модель звали только на разговор");
  assert.equal((await h.status()).today.games, 1);

  // Города из справочника, которого нет в её списке: проверен и принят.
  await h.onMessage(message("города"), KEY);
  await h.onMessage(message("Невьянск"), KEY);
  assert.match(last(), /Вам на «[А-ЯЁ]»\.$/);
  await h.onMessage(message("стоп"), KEY);
  // Выдуманный город на нужную букву — не засчитан.
  await h.onMessage(message("города"), KEY);
  await h.onMessage(message("Нянямск"), KEY);
  assert.match(last(), /^Города «Нянямск» я не знаю\. Назовите другой на «Н» — или «сдаюсь»\.$/);
});

test("игры: угадай число, быки и коровы, виселица, 5 букв — загаданное хранит база, а не модель", async () => {
  reset();
  // 0.41 → число 42 из 1..100.
  let h = heart({}, { random: dice(0.41) });
  await h.onMessage(message("загадай число"), KEY);
  assert.match(last(), /Загадала число от 1 до 100/);
  await h.onMessage(message("50"), KEY);
  assert.equal(last(), "Меньше, чем 50.");
  await h.onMessage(message("30"), KEY);
  assert.equal(last(), "Больше, чем 30.");
  await h.onMessage(message("подсказка"), KEY);
  assert.equal(last(), "Оно между 31 и 49 и чётное.");
  // Другой изолят (новое сердце) продолжает ту же игру: число лежит в базе.
  h = heart();
  await h.onMessage(message("42"), KEY);
  assert.equal(last(), "Да, это 42! Угадано с 3-й попытки.");
  // «Ещё» сразу после игры — ещё одна такая же.
  await h.onMessage(message("ещё"), KEY);
  assert.match(last(), /Загадала число от 1 до 100/);
  await h.onMessage(message("стоп"), KEY);
  assert.match(last(), /^Хорошо, закончили\. Это было \d+\.$/);

  // Быки и коровы: 0 → цифры по порядку, первая не ноль: 1023.
  h = heart({}, { random: dice(0) });
  await h.onMessage(message("быки и коровы"), KEY);
  await h.onMessage(message("1203"), KEY);
  assert.equal(last(), "1203: 2 быка, 2 коровы. Попытка 1 из 12.");
  await h.onMessage(message("1123"), KEY);
  assert.match(last(), /Цифры не должны повторяться/);
  await h.onMessage(message("1023"), KEY);
  assert.equal(last(), "Четыре быка — это 1023! Попыток: 2.");

  // Виселица: слово первое из списка.
  await h.onMessage(message("виселица"), KEY);
  const hidden = last().match(/слово из (\d+) букв/);
  assert.ok(hidden);
  assert.match(last(), /_ _ _/);
  await h.onMessage(message("ъ"), KEY);
  assert.match(last(), /^Буквы «ъ» нет\.\n\n.*\nОшибок: 1 из 7 \(ъ\)\.$/su);
  await h.onMessage(message("сдаюсь"), KEY);
  assert.match(last(), /^Хорошо, закончили\. Слово было «[а-яё]+»\.$/);

  // «5 букв»: поле с цветами, чужое слово проверяется, несуществующее не засчитывается.
  source("ru.wiktionary.org", (url) => ({ query: { pages: decodeURIComponent(url).includes("titles=кошка") ? { 5: { pageid: 5, title: "кошка" } } : { "-1": { title: "ыыыыы", missing: "" } } } }));
  await h.onMessage(message("5 букв"), KEY);
  await h.onMessage(message("кошка"), KEY);
  assert.match(last(), /^[🟩🟨⬜]{5} {2}КОШКА\n\nПопытка 1 из 6\.$/u);
  await h.onMessage(message("ыыыыы"), KEY);
  assert.equal(last(), "Слова «ыыыыы» я не знаю — попытка не засчитана.");
  assert.equal(chats().length, 0, "ни одного запроса к модели");
});

test("игры: загадка, фильм по эмодзи, анаграмма, камень-ножницы-бумага", async () => {
  reset();
  const h = heart({}, { random: dice(0) });
  await h.onMessage(message("загадай загадку"), KEY);
  assert.match(last(), /^Загадка:\nЗимой и летом одним цветом\./);
  await h.onMessage(message("берёза"), KEY);
  assert.equal(last(), "Нет, не «берёза».");
  await h.onMessage(message("не знаю"), KEY);
  assert.equal(last(), "Первая буква — «Е», букв — 4.");
  await h.onMessage(message("это ёлка!"), KEY);
  assert.equal(last(), "Верно — ёлка! Ещё загадку?");

  await h.onMessage(message("фильм по эмодзи"), KEY);
  assert.match(last(), /^Угадайте фильм или мультфильм:\n\n🦁👑$/u);
  await h.onMessage(message("Король лев"), KEY);
  assert.equal(last(), "Верно — «Король Лев»! Ещё фильм?");

  await h.onMessage(message("анаграмма"), KEY);
  const mixed = last().split("\n\n")[1].replace(/ /gu, "").toLowerCase();
  await h.onMessage(message("сдаюсь"), KEY);
  const word = last().match(/Это было «([а-яё]+)»/)[1];
  assert.equal([...mixed].sort().join(""), [...word].sort().join(""), "буквы те же");
  assert.notEqual(mixed, word, "но порядок другой");

  // Свой ход она делает и прячет до хода человека: 0 → камень.
  await h.onMessage(message("камень, ножницы, бумага"), KEY);
  assert.match(last(), /Свой ход я уже сделала и спрятала/);
  await h.onMessage(message("бумага"), KEY);
  assert.match(last(), /^У меня камень: бумага накрывает камень — раунд ваш\. Счёт 1:0 в вашу пользу\./);
  await h.onMessage(message("бумага"), KEY);
  await h.onMessage(message("бумага"), KEY);
  assert.match(last(), /Счёт 3:0 в вашу пользу\. Победа ваша\.$/);
  assert.equal(chats().length, 0);
});

test("игры: кубик бросает Telegram, остальное — код; список игр — её, викторина — тоже, дуэль — сестры", async () => {
  reset();
  const h = heart({}, { random: dice(0.5, 0.9) });
  await h.onMessage(message("кинь кубик"), KEY);
  assert.equal(calls("sendDice").length, 1);
  assert.equal(calls("sendDice")[0].emoji, "🎲");
  await h.onMessage(message("2d6"), KEY);
  assert.equal(last(), "🎲 6 + 4 = 10");
  await h.onMessage(message("d20"), KEY);
  assert.equal(last(), "🎲 d20: 19");
  await h.onMessage(message("подбрось монетку"), KEY);
  assert.match(last(), /^🪙 (?:Орёл|Решка)\.$/);
  await h.onMessage(message("Выбери: чай или кофе"), KEY);
  assert.match(last(), /(?:чай|кофе)/);
  await h.onMessage(message("шар судьбы, стоит ли идти?"), KEY);
  assert.match(last(), /^🎱 /u);
  await h.onMessage(message("выбери за меня"), KEY);
  assert.match(last(), /Из чего выбирать\?/);

  await h.onMessage(message("давай сыграем"), KEY);
  assert.match(last(), /^Во что сыграем\? Судья — я/);
  assert.match(last(), /• города — «сыграем в города»;/);
  assert.doesNotMatch(last(), /Юи/, "мост закрыт — сестру не обещает");
  // Игры сестры остаются её: без моста — честно говорит, что их ведёт она.
  await h.onMessage(message("дуэль"), KEY);
  assert.match(last(), /Юи/);
  // «Викторина» — её квиз по своей таблице: ни сестры, ни модели.
  await h.onMessage(message("викторина"), KEY);
  assert.match(last(), /Квиз<\/b> · вопрос 1 из 7/u);
  assert.doesNotMatch(last(), /Юи/u);
  assert.equal(chats().length, 0);

  // Живой кубик не бросился — число называет сама.
  sdk().failing.sendDice = new Error("no dice");
  await h.onMessage(message("кубик"), KEY);
  assert.match(last(), /^🎲 [1-6]$/u);
});

test("игры: в группе ходят ответом или по имени; чужая болтовня — не ход", async () => {
  reset();
  const first = CITIES.indexOf("Казань") / CITIES.length + 0.0001;
  const h = heart({}, { random: dice(first, 0) });
  await h.onMessage(group("Аи, города", { id: 21 }), KEY);
  assert.match(toChat(-10).at(-1).text, /В группе ходят ответом на моё сообщение или по имени\.$/);
  const before = toChat(-10).length;
  // Просто слово в чате — не ей.
  await h.onMessage(group("Новосибирск", { id: 22 }), KEY);
  assert.equal(toChat(-10).length, before);
  // Ответом на её сообщение — ход, и ходить может любой.
  await h.onMessage(group("Новосибирск", { id: 22, reply: hers("Казань. Вам на «Н».") }), KEY);
  assert.match(toChat(-10).at(-1).text, /Вам на «[А-ЯЁ]»\.$/);
  await h.onMessage(group("Аи, стоп", { id: 21 }), KEY);
  assert.match(toChat(-10).at(-1).text, /^Хорошо, закончили/);
});

test("игры: идёт игра — просьбы и источники работают как обычно", async () => {
  reset();
  source("cbr-xml-daily.ru", bank);
  const h = heart({}, { random: dice(0.41) });
  await h.onMessage(message("загадай число"), KEY);
  await h.onMessage(message("запомни, я люблю чай"), KEY);
  assert.match(last(), /^Запомнила: «я люблю чай»/);
  await h.onMessage(message("курс доллара"), KEY);
  assert.match(last(), /доллар — 81,25/);
  await h.onMessage(message("сколько будет 2+2"), KEY);
  assert.equal(last(), "2 + 2 = 4");
  // А число — всё ещё ход.
  await h.onMessage(message("42"), KEY);
  assert.match(last(), /^Да, это 42!/);

  // Просьба важнее хода: слово-просьба посреди виселицы — не попытка угадать.
  await h.onMessage(message("виселица"), KEY);
  await h.onMessage(message("версия"), KEY);
  assert.match(last(), /^Сердце: \d+\.\d+\.\d+\.$/);
  await h.onMessage(message("во что играем"), KEY);
  assert.match(last(), /^Виселица\.\n\n.*\nОшибок: 0 из 7\.$/su);
});

// ── картинки, жесты, стикеры ─────────────────────────────────────────────

test("картинки: котик из коллекции, вид предмета из Википедии, честный отказ без источника", async () => {
  assert.deepEqual(parsePicture("покажи котика"), { kind: "animal", animal: "cat", word: "котик" });
  assert.equal(parsePicture("покажи профиль"), null);
  assert.equal(parsePicture("как выглядит моя собака"), null);
  assert.deepEqual(parsePicture("как выглядит капибара?"), { kind: "look", topic: "капибара" });

  reset();
  source("thecatapi.com", [{ url: "https://cdn.example/cat.jpg" }]);
  source("page/summary/", page("Капибара", "Капибара — полуводное травоядное млекопитающее.", { description: "вид грызунов", originalimage: { source: "https://upload.example/capybara.jpg" }, thumbnail: { source: "https://upload.example/capybara-320.jpg" } }));
  const h = heart();
  await h.onMessage(message("покажи котика"), KEY);
  assert.deepEqual(calls("sendPhoto").at(-1), { chat_id: 5, photo: "https://cdn.example/cat.jpg", reply_markup: { inline_keyboard: [[{ text: "Ещё", callback_data: "a:an:cat" }]] } });
  await h.onMessage(message("Как выглядит капибара?"), KEY);
  assert.deepEqual(calls("sendPhoto").at(-1), { chat_id: 5, photo: "https://upload.example/capybara.jpg", caption: "Капибара — вид грызунов" });
  // Оригинал слишком велик — уходит уменьшенный.
  sdk().apiReplies.sendPhoto = (params) => { if (params.photo.endsWith("capybara.jpg")) throw new Error("too big"); return true; };
  await h.onMessage(message("покажи фото капибара"), KEY);
  assert.equal(calls("sendPhoto").at(-1).photo, "https://upload.example/capybara-320.jpg");
  // Собак коллекция не отдала — словами и без выдумки.
  await h.onMessage(message("покажи собаку"), KEY);
  assert.match(last(), /пёс не нашёлся — коллекция картинок сейчас не отвечает/);
  assert.equal(chats().length, 0);
});

test("жесты: обнимает близких, остальным машет; гифка не ушла — скажет словами", async () => {
  reset();
  source("nekos.best/api/v2/hug", { results: [{ url: "https://nekos.example/hug.gif" }] });
  source("nekos.best/api/v2/wave", { results: [{ url: "https://nekos.example/wave.gif" }] });
  const h = heart();
  await h.onMessage(message("обними меня"), KEY);
  assert.deepEqual(calls("sendAnimation").at(-1), { chat_id: 5, animation: "https://nekos.example/wave.gif", caption: "Обнимаю я тех, с кем мы ближе. Пока — так." });
  await h.onMessage(message("обними", { id: OWNER }), KEY);
  assert.deepEqual(calls("sendAnimation").at(-1), { chat_id: OWNER, animation: "https://nekos.example/hug.gif" });
  await h.onMessage(message("дай пять", { id: OWNER }), KEY);
  assert.equal(last(OWNER), "Даю пять!");
});

test("стикеры: на стикер отвечает стикером из того же набора; сердечко — только близким", async () => {
  reset();
  sdk().apiReplies.getStickerSet = { stickers: [
    { file_id: "S-JOY", emoji: "😊" }, { file_id: "S-LOVE", emoji: "❤️" }, { file_id: "S-LAUGH", emoji: "😂" }, { file_id: "S-ROCK", emoji: "🗿" },
  ] };
  const h = heart({}, { random: dice(0) });
  const sticker = (emoji, id = 5) => message(null, { id, extra: { sticker: { file_id: "IN", emoji, set_name: "CatsPack" } } });
  await h.onMessage(sticker("❤️"), KEY);
  assert.deepEqual(calls("sendSticker").at(-1), { chat_id: 5, sticker: "S-JOY" }, "незнакомому — улыбка, а не сердце");
  await h.onMessage(sticker("😂"), KEY);
  assert.equal(calls("sendSticker").at(-1).sticker, "S-LAUGH");
  assert.equal(calls("getStickerSet").length, 1, "набор читается один раз");
  await h.onMessage(sticker("❤️", OWNER), KEY);
  assert.equal(calls("sendSticker").at(-1).sticker, "S-LOVE", "хозяину — сердце");

  // Набор без подходящего — остаётся реакция, как раньше.
  sdk().apiReplies.getStickerSet = { stickers: [{ file_id: "X", emoji: "🗿" }] };
  await h.onMessage(message(null, { id: 9, extra: { sticker: { file_id: "IN", emoji: "😴", set_name: "Stones" } } }), KEY);
  assert.equal(calls("sendSticker").at(-1).chat_id, 9, "…но у неё есть полка из наборов хозяина");
  // «Не реагируй» запрещает и стикеры.
  await h.onMessage(message("не реагируй", { id: 9 }), KEY);
  const sent = calls("sendSticker").length;
  await h.onMessage(message(null, { id: 9, extra: { sticker: { file_id: "IN", emoji: "😊", set_name: "CatsPack" } } }), KEY);
  assert.equal(calls("sendSticker").length, sent);
});

// ── напоминания: повтор, побудка, капсула ────────────────────────────────

test("напоминания: повтор разбирает код — день, будни, неделя, месяц, год", () => {
  const at = (text) => parseReminder(text, { now: NOON, timeZone: TZ });
  const local = (ms) => new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(ms);
  assert.deepEqual(at("напоминай каждый день в 9 пить воду").repeat, { kind: "day", hh: 9, mm: 0 });
  assert.equal(local(at("напоминай по будням в 8:30 про планёрку").at), "пт, 13.11, 08:30");
  assert.equal(local(at("напомни каждую пятницу в 18 вынести мусор").at), "пт, 13.11, 18:00");
  assert.equal(local(at("напоминай по понедельникам в 10 отчёт").at), "пн, 16.11, 10:00");
  assert.deepEqual(at("напомни каждый месяц 5 числа в 12 оплатить интернет").repeat, { kind: "month", hh: 12, mm: 0, day: 5 });
  assert.deepEqual(at("напоминай каждый год 5 марта про день рождения мамы").repeat, { kind: "year", hh: 9, mm: 0, month: 3, day: 5 });
  assert.equal(at("буди меня в 7").kind, "morning");
  assert.equal(at("буди меня в 7").repeat.kind, "day");
  assert.equal(at("разбуди меня завтра в 6").repeat, undefined);
  assert.equal(at("капсула времени на год: выучить японский").kind, "capsule");
  assert.equal(at("капсула времени на год: выучить японский").at, NOON + 365 * DAY);
  // Будни перешагивают выходные; 31-е число в коротком месяце — последний день.
  const friday = at("напоминай по будням в 8:30 про планёрку");
  assert.equal(local(nextOccurrence({ at: friday.at, repeat: friday.repeat, zone: TZ })), "пн, 16.11, 08:30");
  assert.equal(local(nextOccurrence({ at: Date.UTC(2027, 0, 31, 9), repeat: { kind: "month", day: 31, hh: 12, mm: 0 }, zone: TZ })), "вс, 28.02, 12:00");
});

test("напоминания: повторяющееся звонит и переносится; пропущенные дни пачкой не приходят", async () => {
  reset();
  let at = NOON;
  const h = heart({}, { now: () => at });
  await h.onMessage(message("напоминай каждый день в 9 пить воду"), KEY);
  assert.match(last(), /^Хорошо, напомню каждый день, начиная завтра в 09:00: «пить воду»/);
  await h.onMessage(message("мои напоминания"), KEY);
  assert.match(last(), /1\. завтра в 09:00 \(каждый день\) — пить воду/);

  // Её не будили трое суток: приходит одно напоминание, а срок — уже следующий.
  at += 3 * DAY;
  await h.onMessage(message("привет", { id: 9 }), KEY);
  const rung = toChat(5).filter(item => item.text.startsWith("⏰"));
  assert.equal(rung.length, 1);
  assert.match(rung[0].text, /^⏰ Напоминаю с опозданием на .*: пить воду$/);
  const [item] = await h.reminders.list(5);
  assert.equal(new Date(item.at).toISOString(), "2026-11-16T06:00:00.000Z", "завтра в девять");
  await h.onMessage(message("отмени напоминание 1"), KEY);
  assert.equal(await h.reminders.size(), 0);
});

test("напоминания: побудка — утро целиком; капсула времени — письмо себе", async () => {
  reset();
  withWeather();
  let at = NOON;
  const h = heart({}, { now: () => at });
  await h.onMessage(message("мой город — Казань"), KEY);
  await h.onMessage(message("зови меня Лис"), KEY);
  await h.onMessage(message("буди меня в 7"), KEY);
  assert.match(last(), /^Хорошо, разбужу каждый день — первый раз завтра в 07:00: с погодой \(Казань\) и делами на день/);
  await h.onMessage(message("напомни завтра в 14 созвон с Аней"), KEY);

  at = Date.UTC(2026, 10, 13, 4, 1);   // 07:01 по Москве
  await h.onMessage(message("тик", { id: 9 }), KEY);
  const morning = toChat(5).at(-1).text;
  assert.match(morning, /^☀️ Доброе утро, Лис! Сегодня пятница, 13 ноября\.\n\nКазань, сейчас \+5°/u);
  assert.match(morning, /\n\nСегодня напомню:\n• 14:00 — созвон с Аней$/);
  assert.equal((await h.reminders.list(5)).length, 2, "побудка осталась — на завтра");

  // Капсула: пустую не закапывает; открывает в срок и называет день, когда писали.
  await h.onMessage(message("капсула времени"), KEY);
  assert.match(last(), /Что положить в капсулу\?/);
  await h.onMessage(message("капсула времени на год: выучить японский"), KEY);
  assert.match(last(), /^Запечатала\. Открою 13\.11\.2027/);
  at += 366 * DAY;
  await h.onMessage(message("тик", { id: 9 }), KEY);
  assert.ok(toChat(5).some(item => item.text === "📦 Капсула времени. 13.11.2026 вы написали себе:\n\n«выучить японский»"));
  assert.equal(chats().length, 2, "модель звали только на «тик»");
});

test("будильник: редкий, из Actions, — тоже будильник; она честно говорит, на сколько может опоздать", async () => {
  reset();
  let at = NOON;
  const h = heart({}, { now: () => at });
  await h.tick({});
  at += 3 * 3_600_000;
  await h.tick({});
  await h.onMessage(message("напомни через 10 минут выключить чайник"), KEY);
  assert.match(last(), /Будят меня сейчас раз в 3 ч, так что могу опоздать — но не забуду\.$/);
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Будильник: будят раз в 3 ч — напоминания могут опоздать на столько же/);
  // Удар без единого сообщения: напоминание уходит само.
  at += 3 * 3_600_000;
  const result = await h.tick({});
  assert.equal(result.ok, true);
  assert.match(toChat(5).at(-1).text, /^⏰ Напоминаю с опозданием на 3 ч/);
});

// ── разговор: длина, предел, слово хозяину ───────────────────────────────

test("длинный ответ уходит частями, а не теряется", async () => {
  reset();
  const h = heart();
  const long = Array.from({ length: 60 }, (_, i) => `Абзац ${i + 1}. ${"Слова и ещё слова. ".repeat(4)}`).join("\n\n");
  sdk().fetchQueue.push(says(long));
  await h.onMessage(group("Аи, расскажи подробно", { id: 21, extra: { message_thread_id: 7, is_topic_message: true } }), KEY);
  const parts = toChat(-10);
  assert.equal(parts.length, 2);
  assert.ok(parts.every(item => item.text.length <= 4096));
  // Разрез — по границе абзаца: ни один не разорван и ни один не потерян.
  const paragraphs = parts.flatMap(item => item.text.split("\n\n"));
  assert.equal(paragraphs.length, 60);
  assert.ok(paragraphs.every((text, i) => text.startsWith(`Абзац ${i + 1}. `) && text.trimEnd().endsWith("слова.")));
  assert.ok(parts[0].reply_parameters, "первая часть — ответом");
  assert.equal(parts[1].reply_parameters, undefined, "продолжение — без цитаты");
  assert.equal(parts[1].message_thread_id, 7, "но в той же теме");
});

test("дневной предел: один собеседник не съедает мысли всех; хозяина и игры он не касается", async () => {
  reset();
  const h = heart({ AI_DAILY_PER_PERSON: 2 });
  for (const text of ["раз", "два"]) { sdk().fetchQueue.push(says(`ответ на ${text}`)); await h.onMessage(message(`расскажи про ${text}`), KEY); }
  assert.equal(last(), "ответ на два");
  await h.onMessage(message("расскажи про три"), KEY);
  assert.match(last(), /^На сегодня мы с вами наговорились/);
  const sent = toChat(5).length;
  await h.onMessage(message("расскажи про четыре"), KEY);
  assert.equal(toChat(5).length, sent, "второй раз не повторяет — ставит «видела»");
  assert.ok(reactions().includes("👀"));
  assert.equal(chats().length, 2);
  // Всё, что не тратит модель, работает.
  await h.onMessage(message("сколько будет 2+2"), KEY);
  assert.equal(last(), "2 + 2 = 4");
  await h.onMessage(message("почему ты молчала"), KEY);
  assert.match(last(), /дневной предел разговора/);
  // Хозяину предела нет.
  for (let i = 0; i < 3; i++) { sdk().fetchQueue.push(says(`хозяину ${i}`)); await h.onMessage(message(`вопрос ${i} о важном`, { id: OWNER }), KEY); }
  assert.equal(last(OWNER), "хозяину 2");
});

test("лимит на исходе: владелец узнаёт заранее", async () => {
  reset();
  const h = heart();
  sdk().fetchQueue.push(says("ответ", { headers: { "x-ratelimit-remaining-requests": "40", "x-ratelimit-limit-requests": "1000" } }));
  await h.onMessage(message("расскажи что-нибудь"), KEY);
  assert.equal(last(), "ответ\n\nЯ сегодня утомилась: дальше отвечу короче.");
  assert.equal(toOwner().length, 1);
  assert.match(toOwner()[0].text, /лимит модели gpt-oss-20b на исходе: осталось 40 из 1000 запросов/);
});

test("слово хозяину: передаётся только то, о чём попросили, — и ответ возвращается", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("Передай хозяину: Бот классный, добавьте шахматы", { id: 31, name: "Вика" }), KEY);
  assert.match(last(31), /^Передала — слово в слово/);
  const letter = toOwner().at(-1);
  assert.equal(letter.text, "✉️ Хозяин, вам пишет Вика:\n\nБот классный, добавьте шахматы\n\nОтветить — ответом на это сообщение: передам слово в слово.");
  assert.doesNotMatch(letter.text, /31/, "числового ID в письме нет");

  // Хозяин отвечает ответом на письмо — слова уходят автору.
  const id = sdk().sent.indexOf(letter) + 1;
  await h.onMessage(message("Спасибо, подумаю!", { id: OWNER, reply: { message_id: id, from: { id: 999, is_bot: true } } }), KEY);
  assert.equal(toChat(31).at(-1).text, "✉️ Хозяин отвечает:\n\nСпасибо, подумаю!");
  assert.equal(last(OWNER), "Передала: Вика.");

  // Три письма в день — предел; хозяину самому себе писать некому.
  await h.onMessage(message("передай хозяину: второе", { id: 31 }), KEY);
  await h.onMessage(message("передай хозяину: третье", { id: 31 }), KEY);
  await h.onMessage(message("передай хозяину: четвёртое", { id: 31 }), KEY);
  assert.match(last(31), /уже передала три ваших сообщения/);
  await h.onMessage(message("передай хозяину: привет", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Хозяин — это вы/);
  await h.onMessage(message("передай хозяину", { id: 32 }), KEY);
  assert.match(last(32), /Что передать\?/);
  assert.equal(chats().length, 0);
});

// ── мозги и самопроверка ─────────────────────────────────────────────────

test("проверь мозги: живой запрос каждой запасной модели; закрытая для ключа — сутки не трогается", async () => {
  reset();
  const h = heart({ AI_MODELS: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"] });
  sdk().fetchQueue.push(says("pong"), says("pong"), refuses(403, { code: "model_permission_denied" }));
  await h.onMessage(message("проверь мозги", { id: OWNER }), KEY);
  const text = last(OWNER);
  assert.match(text, /• основной \(gpt-oss-20b\) — отвечает/);
  assert.match(text, /• основной \(gpt-oss-120b\) — отвечает/);
  assert.match(text, /• основной \(llama-3\.3-70b-versatile\) — HTTP 403 .*Модель: llama-3\.3-70b-versatile\. Сутки её не трогаю; имя стоит заменить в настройках$/);
  assert.equal(chats().length, 3);
  const resting = (await h.status()).brains.find(item => item.model === "llama-3.3-70b-versatile");
  assert.equal(resting.ok, false);
});

test("запасная модель закрыта для ключа — это не «ключ отозван»: цепочка идёт дальше", async () => {
  reset();
  const h = heart({ AI_MODELS: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"] });
  sdk().fetchQueue.push(
    refuses(429, { code: "rate_limit_exceeded", headers: { "retry-after": "600" } }),
    refuses(403, { code: "model_permission_denied" }),
    says("думаю третьей"),
  );
  await h.onMessage(message("расскажи что-нибудь"), KEY);
  assert.equal(last(), "думаю третьей");
  assert.equal(request().model, "openai/gpt-oss-120b");
});

test("статус: источники проверяются живым запросом", async () => {
  reset();
  source("page/summary/", page("Москва", "Москва — столица России."));
  source("cbr-xml-daily.ru", bank);
  const h = heart();
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Источники: Википедия — отвечает · погода — нет связи · курс — отвечает/);
  assert.match(last(OWNER), /словом понимаю 36 намерений/);
});

// ── публикация ───────────────────────────────────────────────────────────

test("публикация: секреты вписываются одним скриптом и не печатаются", () => {
  const dir = mkdtempSync(join(tmpdir(), "heart-secrets-"));
  const file = join(dir, "secrets.js");
  copyFileSync(new URL("../tgcloud/lib/secrets.js", import.meta.url), file);
  const script = new URL("../scripts/inject-secrets.mjs", import.meta.url).pathname;
  const run = (env, args = []) => execFileSync(process.execPath, [script, `--file=${file}`, ...args], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });

  const out = run({ AI_PROVIDER_KEY: "gsk_secret$&value", OWNER_TG_ID: " 4242 ", AI_EXTRA_KEYS: JSON.stringify({ gigachat: "basic==", empty: "" }) }, ["--require-key"]);
  assert.doesNotMatch(out, /gsk_secret|basic==|4242/, "значения не попадают в журнал");
  assert.match(out, /provider key yes, owner yes, spare providers 1/);
  const filled = readFileSync(file, "utf8");
  assert.match(filled, /export const AI_API_KEY = "gsk_secret\$&value";/, "ключ со знаками подстановки остался собой");
  assert.match(filled, /export const OWNER_TG_ID = "4242";/);
  assert.match(filled, /export const AI_EXTRA_KEYS = \{"gigachat":"basic=="\};/);

  // Публикация без ключа останавливается; будильник — только предупреждает.
  assert.throws(() => run({}, ["--require-key"]));
  assert.match(run({ AI_EXTRA_KEYS: "{не json" }), /AI_PROVIDER_KEY is empty[\s\S]*AI_EXTRA_KEYS is not valid JSON/);
  // Файл, изменённый руками, не публикуется наугад.
  writeFileSync(file, "export const AI_API_KEY = \"\";\n");
  assert.throws(() => run({ AI_PROVIDER_KEY: "k" }));
  rmSync(dir, { recursive: true, force: true });

  const workflow = readFileSync(new URL("../.github/workflows/heart.yml", import.meta.url), "utf8");
  // Владелец решил: без Actions. Файл — запасная кнопка и сам ничего не запускает.
  assert.match(workflow, /\non:\n  workflow_dispatch:\n/, "только по кнопке");
  assert.doesNotMatch(workflow, /\n  push:|\n  schedule:|cron:/, "ни на коммит, ни по расписанию минуты Actions не тратятся");
  assert.match(workflow, /needs: tests\n[\s\S]*Rehearse in the cloud before publishing[\s\S]*name: Publish\n/, "публикации предшествуют тесты и репетиция в облаке");
  assert.match(workflow, /--ctx '\{ tick: true, deployed: true \}'/, "после публикации сердце будят");
  assert.equal((workflow.match(/node scripts\/inject-secrets\.mjs/g) ?? []).length, 2, "секреты вписывает один скрипт — и для публикации, и для будильника");
  assert.equal((workflow.match(/git checkout -- tgcloud\/lib\/secrets\.js/g) ?? []).length, 2, "и оба раза слоты возвращаются пустыми");
});
