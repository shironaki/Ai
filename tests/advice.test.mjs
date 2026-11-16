/**
 * Советы из источников: фильмы, сериалы, книги, игры — Википедия; музыка — чарт
 * Deezer. «В этот день» и «интересный факт» — тоже Википедия. Без модели.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, chats, says, sdk, calls, source, sourced, KEY } from "./fixtures/kit.mjs";

const { parseAdvice, titleParts } = await import("../tgcloud/lib/advice.js");

const NOON = Date.parse("2026-11-18T09:00:00Z");
const photos = () => calls("sendPhoto");
const sent = () => sdk().sent.at(-1);
const found = (...titles) => ({ query: { search: titles.map(title => ({ title })) } });
const page = (title, description, extract, image = "") => ({
  title, description, extract, content_urls: { desktop: { page: `https://ru.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /gu, "_"))}` } },
  ...(image ? { thumbnail: { source: image } } : {}),
});
const asked = () => sourced().filter(url => url.includes("list=search")).map(url => decodeURIComponent(url.match(/srsearch=([^&]+)/u)[1]));

test("разбор: полка, жанр, «похожее на»; чужие слова — мимо", () => {
  const cases = {
    "что посмотреть": ["film"], "Что бы мне глянуть вечером?": ["film"], "посоветуй что посмотреть": ["film"], "хочу что-нибудь посмотреть": ["film"],
    "посоветуй мне хороший фильм на вечер": ["film"], "какой фильм посмотреть": ["film"], "посоветуй кино": ["film"],
    "посоветуй комедию": ["film", "comedy"], "посоветуй хороший ужастик": ["film", "horror"], "что посмотреть из комедий": ["film", "comedy"],
    "посоветуй фильм про космос": ["film", "scifi"], "посоветуй мелодраму": ["film", "romance"], "посоветуй драму": ["film", "drama"],
    "посоветуй сериал": ["series"], "что посмотреть из сериалов": ["series"], "посоветуй детективный сериал": ["series", "detective"],
    "что почитать": ["book"], "посоветуй книгу": ["book"], "какую книгу почитать": ["book"], "посоветуй детектив почитать": ["book", "detective"],
    "посоветуй игру": ["game"], "во что поиграть на пк": ["game"], "посоветуй во что поиграть": ["game"], "какую игру скачать": ["game"],
    "что послушать": ["music"], "посоветуй музыку": ["music"], "какую музыку послушать": ["music"],
  };
  for (const [said, [shelf, genre]] of Object.entries(cases)) {
    const got = parseAdvice(said);
    assert.deepEqual([got?.shelf, got?.genre?.key], [shelf, genre], said);
  }
  const like = {
    "фильм как Интерстеллар": ["film", "Интерстеллар"], "посоветуй фильм похожий на Начало": ["film", "Начало"], "сериал вроде Друзей": ["series", "Друзей"],
    "что посмотреть похожее на Матрицу": ["film", "Матрицу"], "что почитать вроде Дюны": ["book", "Дюны"], "книга как «Мастер и Маргарита»": ["book", "Мастер и Маргарита"],
    "игра как Skyrim": ["game", "Skyrim"],
  };
  for (const [said, [shelf, title]] of Object.entries(like)) assert.deepEqual(parseAdvice(said), { shelf, like: title }, said);
  // Город, аниме (у него свой каталог), её собственные игры, непонятный хвост — не сюда.
  for (const said of ["что посмотреть в Казани", "посоветуй аниме", "что посмотреть из аниме", "во что поиграть", "во что сыграем", "предложи игру", "дай игру",
    "посоветуй что делать", "посоветуй подарок маме", "посоветуй фильм про динозавров и роботов", "что почитать про квантовую физику", "найди фильм Аватар", "посоветуй врача", ""]) {
    assert.equal(parseAdvice(said), null, said);
  }
  assert.deepEqual(titleParts("Гладиатор (фильм, 2000)"), { name: "Гладиатор", note: "фильм, 2000" });
  assert.deepEqual(titleParts("Друзья"), { name: "Друзья", note: "" });
});

test("«что посмотреть»: статья Википедии с полки фильмов, без модели и без повторов; источник молчит — отвечает словарь", async () => {
  reset();
  source("list=search", (url) => (decodeURIComponent(url).includes("morelikethis") ? found("Довод (фильм)", "Начало (фильм, 2010)")
    : decodeURIComponent(url).includes("Интерстеллар") ? found("Интерстеллар") : decodeURIComponent(url).includes("deepcat") ? found("Бёрдмэн") : found("Гладиатор (фильм, 2000)", "Спасти рядового Райана")));
  source("page/summary/", (url) => {
    const title = decodeURIComponent(url.match(/summary\/([^?]+)/u)[1]).replace(/_/gu, " ");
    return page(title, title.startsWith("Гладиатор") ? "фильм Ридли Скотта 2000 года" : "", `${title} — статья о нём. Вторая фраза.`, title.startsWith("Гладиатор") ? "https://upload.wikimedia.org/g.jpg" : "");
  });
  const h = heart({ PHRASES: true }, { now: () => NOON, random: () => 0 });
  await h.onMessage(message("что посмотреть?"), KEY);
  assert.deepEqual(photos().at(-1), {
    chat_id: 5, photo: "https://upload.wikimedia.org/g.jpg", parse_mode: "HTML",
    caption: "<b>Гладиатор</b> — фильм Ридли Скотта 2000 года\nГладиатор (фильм, 2000) — статья о нём. Вторая фраза.\n\nПо Википедии. Ещё — «посоветуй фильм»; похожее — «фильм как Гладиатор».",
  });
  assert.deepEqual(asked(), ['hastemplate:"Фильм"']);
  assert.match(sourced()[0], /srsort=incoming_links_desc/u);
  // Второй раз — не то же самое: посоветованное запоминается на чат. Без картинки — строкой со ссылкой.
  await h.onMessage(message("посоветуй фильм"), KEY);
  assert.equal(sent().text, "<b>Спасти рядового Райана</b>\nСпасти рядового Райана — статья о нём. Вторая фраза.\n\nПо Википедии. Ещё — «посоветуй фильм»; похожее — «фильм как Спасти рядового Райана».\n<a href=\"https://ru.wikipedia.org/wiki/%D0%A1%D0%BF%D0%B0%D1%81%D1%82%D0%B8_%D1%80%D1%8F%D0%B4%D0%BE%D0%B2%D0%BE%D0%B3%D0%BE_%D0%A0%D0%B0%D0%B9%D0%B0%D0%BD%D0%B0\">Статья</a>");
  // Жанр — категорией; «похожее на» — поиском похожих статей.
  await h.onMessage(message("посоветуй комедию"), KEY);
  assert.equal(asked().at(-1), 'hastemplate:"Фильм" deepcat:"Кинокомедии"');
  assert.match(sent().text, /^<b>Бёрдмэн<\/b>/u);
  await h.onMessage(message("фильм как Интерстеллар"), KEY);
  assert.deepEqual(asked().slice(-2), ['hastemplate:"Фильм" Интерстеллар', 'hastemplate:"Фильм" morelikethis:"Интерстеллар"']);
  assert.match(sent().text, /^Похожее на «Интерстеллар»:\n<b>Довод<\/b> \(фильм\)\n/u);
  await h.onMessage(message("посоветуй сериал"), KEY);
  assert.equal(asked().at(-1), 'hastemplate:"Телесериал"');
  await h.onMessage(group("Аи, что почитать?", { id: 21 }), KEY);
  assert.equal(asked().at(-1), 'hastemplate:"Литературное произведение"');
  await h.onMessage(message("посоветуй игру"), KEY);
  assert.equal(asked().at(-1), 'hastemplate:"Компьютерная игра"');
  assert.equal(chats().length, 0, "советы — без модели");

  // Названного нет — так и говорит; источник молчит — совет даёт словарь, как раньше.
  reset();
  source("list=search", found());
  const empty = heart({ PHRASES: true }, { now: () => NOON, random: () => 0 });
  await empty.onMessage(message("фильм как Такого Нет"), KEY);
  assert.equal(last(), "Не нашла «Такого Нет» среди фильмов в Википедии. Проверьте название — или просто «посоветуй фильм».");
  reset();
  const silent = heart({ PHRASES: true }, { now: () => NOON, random: () => 0 });
  await silent.onMessage(message("что посмотреть"), KEY);
  assert.match(last(), /«|Для аниме/u, "ответ из словаря");
  assert.equal(chats().length, 0);
});

test("«что послушать» — из чарта; «в этот день» и «интересный факт» — из Википедии", async () => {
  reset();
  source("api.deezer.com/chart", { data: [
    { title: "Грубая песня", explicit_lyrics: true, artist: { name: "Кто-то" }, link: "https://deezer.com/track/1", preview: "https://cdn.deezer.com/1.mp3", duration: 200 },
    { title: "Blinding Lights", artist: { name: "The Weeknd" }, album: { title: "After Hours" }, link: "https://deezer.com/track/2", preview: "https://cdn.deezer.com/2.mp3", duration: 200 },
  ] });
  source("feed/onthisday/selected/11/18", { selected: [{ text: "компания Intel выпустила <b>первый</b> микропроцессор.", year: 1971 }, { text: "первый полёт «Бурана».", year: 1988 }] });
  source("feed/featured/2026/11/18", { news: [], dyk: [{ html: "<i>коала</i> спит до 22 часов в сутки", text: "коала спит до 22 часов в сутки" }] });
  const h = heart({}, { now: () => NOON, random: () => 0 });
  await h.onMessage(message("что послушать?"), KEY);
  const audio = calls("sendAudio").at(-1);
  assert.equal(audio.audio, "https://cdn.deezer.com/2.mp3", "грубое из чарта не советуется");
  assert.equal(audio.caption, "The Weeknd — Blinding Lights (After Hours) · 3:20\nИз того, что сейчас слушают чаще всего (чарт Deezer).\nЭто отрывок, 30 секунд. Ещё — «что послушать».");
  await h.onMessage(message("что было в этот день?"), KEY);
  assert.equal(last(), "В этот день, 18 ноября (по Википедии):\n• 1988 — первый полёт «Бурана».\n• 1971 — компания Intel выпустила первый микропроцессор.");
  await h.onMessage(message("расскажи интересный факт"), KEY);
  assert.equal(last(), "Знаете ли вы? Коала спит до 22 часов в сутки\n\nИз рубрики «Знаете ли вы» Википедии. Ещё — «интересный факт».");
  assert.equal(chats().length, 0);
  // Фактов нет — это обычный разговор.
  reset();
  const plain = heart({}, { now: () => NOON });
  sdk().fetchQueue.push(says("Факт: мёд не портится."));
  await plain.onMessage(message("интересный факт"), KEY);
  assert.equal(last(), "Факт: мёд не портится.");
});
