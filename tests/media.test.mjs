/**
 * Поиск: картинки, аниме-арт, аниме, музыка, видео. Источники — стаб; модель
 * в поиске не участвует, и тесты это проверяют.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, reset, sdk, calls, source, sourced, last, chats, says, KEY } from "./fixtures/kit.mjs";

const { parseMedia } = await import("../tgcloud/lib/media.js");

const photos = () => calls("sendPhoto");
const sent = () => sdk().sent.at(-1);
const commons = (...files) => ({ query: { pages: Object.fromEntries(files.map(([title, mime = "image/jpeg"], index) => [String(100 + index), {
  index: index + 1, title: `File:${title}.jpg`,
  imageinfo: [{ mime, url: `https://upload.example/${index}/full.jpg`, thumburl: `https://upload.example/${index}/1280.jpg`, descriptionurl: `https://commons.example/wiki/File:${index}` }],
}])) } });

test("разбор поиска: что ищут и какими словами; разговор поиском не считается", () => {
  const kind = (text) => { const got = parseMedia(text); return got ? `${got.kind}:${got.category ?? got.query ?? (got.random ? "random" : "")}${got.loose ? ":loose" : ""}` : null; };
  assert.deepEqual([
    "покажи тянку", "скинь неко", "покажи кошкодевочку", "покажи кицунэ", "покажи аниме парня", "дай вайфу",
    "найди картинку закат над морем", "картинка: Рыжий кот", "покажи Наруто", "покажи мне капибару",
    "посоветуй аниме", "что посмотреть из аниме", "найди аниме Наруто", "аниме: Атака титанов",
    "найди песню Кино — Группа крови", "песня: Batushka", "поставь опенинг Наруто",
    "найди видео как варить борщ", "видео: котики", "покажи видео с котами", "нарисуй котика",
  ].map(kind), [
    "art:waifu", "art:neko", "art:neko", "art:kitsune", "art:husbando", "art:waifu",
    "image:закат над морем", "image:Рыжий кот", "image:Наруто:loose", "image:капибару:loose",
    "anime:random", "anime:random", "anime:Наруто", "anime:Атака титанов",
    "music:Кино — Группа крови", "music:Batushka", "music:Наруто",
    "video:как варить борщ", "video:котики", "video:котами", "draw:котика",
  ]);
  for (const text of ["покажи профиль", "покажи пример кода", "покажи как это работает", "покажи себя", "покажи id", "покажи мои напоминания", "покажи погоду",
    "что посмотреть", "аниме это искусство", "нарисуй смайликами котика", "скинь мем", "музыка это жизнь", "найди мне девушку"]) {
    assert.equal(parseMedia(text), null, text);
  }
});

test("аниме-арт: рисунок без подписи, автор — по вопросу «откуда это?»; коллекция молчит — честно", async () => {
  reset();
  const h = heart();
  source("nekos.best/api/v2/waifu", { results: [{ url: "https://nekos.example/waifu/1.png", artist_name: "Иной <художник>", source_url: "https://art.example/1?a=1&b=2" }] });
  await h.onMessage(message("покажи тянку"), KEY);
  assert.deepEqual(photos().at(-1), { chat_id: 5, photo: "https://nekos.example/waifu/1.png", parse_mode: "HTML" });
  // Подпись молчит об источнике, но автор не потерян: по прямому вопросу она его называет.
  await h.onMessage(message("откуда это?"), KEY);
  assert.equal(sent().text, 'Это не моя работа: «рисунок», автор — Иной &lt;художник&gt;. Лежит здесь: <a href="https://art.example/1?a=1&amp;b=2">nekos.best</a>.');
  await h.onMessage(message("скинь неко"), KEY);
  assert.equal(last(), "Коллекция рисунков сейчас не отвечает. Попробуйте чуть позже.");
  assert.equal(chats().length, 0);
});

test("картинка по словам: описание — из хранилища снимков, имя — из энциклопедии, запасной источник", async () => {
  reset();
  const h = heart();
  source("commons.wikimedia.org", (url) => (decodeURIComponent(url).includes("закат над морем") ? commons(["Схема", "image/svg+xml"], ["Sunset"]) : { batchcomplete: "" }));
  await h.onMessage(message("Найди картинку закат над морем"), KEY);
  assert.deepEqual(photos().at(-1), { chat_id: 5, photo: "https://upload.example/1/1280.jpg", caption: "Закат над морем", parse_mode: "HTML" });
  assert.match(sourced().find(url => url.includes("commons")), /gsrsearch=.*filetype%3Abitmap/u, "ищет снимки, а не схемы и звук");

  // В хранилище пусто — открытый каталог; подпись называет автора и лицензию.
  source("api.openverse.org", { results: [{ url: "https://img.example/cat.jpg", title: "Ginger", creator: "Ann", license: "by-sa", foreign_landing_url: "https://flickr.example/1" }, { url: "https://img.example/x.jpg", mature: true }] });
  await h.onMessage(message("картинка: рыжий кот на заборе"), KEY);
  assert.deepEqual(photos().at(-1), { chat_id: 5, photo: "https://img.example/cat.jpg", caption: "Рыжий кот на заборе", parse_mode: "HTML" });
  await h.onMessage(message("кто автор?"), KEY);
  assert.match(sent().text, /^Это не моя работа: «рыжий кот на заборе», автор — Ann, CC BY-SA\. Лежит здесь: <a href="https:\/\/flickr\.example\/1">Openverse<\/a>\.$/u);
  assert.match(sourced().find(url => url.includes("openverse")), /mature=false/u);

  // «Как выглядит …» без статьи в энциклопедии — тоже находит.
  source("commons.wikimedia.org", commons(["Any"]));
  const before = photos().length;
  await h.onMessage(message("как выглядит синхрофазотрон"), KEY);
  assert.equal(photos().length, before + 1);
  assert.equal(chats().length, 0);
});

test("«покажи …»: предмет находится — картинка; не находится — обычный разговор", async () => {
  reset();
  const h = heart();
  // Источники отвечают, но пусто: «не нашлось» — не то же, что «молчит».
  source("ru.wikipedia.org/w/api.php", { query: { search: [] } });
  source("commons.wikimedia.org", { batchcomplete: "" });
  source("api.openverse.org", { results: [] });
  source("page/summary/", (url) => (decodeURIComponent(url).includes("Байкал") ? { type: "standard", title: "Байкал", description: "озеро в Сибири", extract: "Байкал — озеро.", originalimage: { source: "https://upload.example/baikal.jpg" } } : { status: 404, ok: false, json: async () => ({}) }));
  await h.onMessage(message("Покажи Байкал"), KEY);
  assert.deepEqual(photos().at(-1), { chat_id: 5, photo: "https://upload.example/baikal.jpg", caption: "Байкал — озеро в Сибири" });
  assert.equal(chats().length, 0);
  sdk().fetchQueue.push(says("Что именно показать?"));
  await h.onMessage(message("покажи фокус-покус"), KEY);
  assert.equal(last(), "Что именно показать?", "не нашлось — отвечает как на обычную фразу");
  // Явная просьба о картинке без результата — честный отказ, не разговор.
  await h.onMessage(message("найди картинку абракадабра швабра"), KEY);
  assert.match(last(), /^Не нашла, как выглядит «абракадабра швабра»\. Попробуйте сказать короче или иначе\.$/u);
  assert.equal(chats().length, 1);
  // Все источники молчат — так и говорит.
  sdk().sourceReplies.length = 0;
  await h.onMessage(message("найди картинку тихий океан ночью"), KEY);
  assert.match(last(), /Картинки сейчас не достать: связь подводит/u);
});

test("аниме: карточка с постером по названию, случайное с высокой оценкой, честное «не нашла»", async () => {
  reset();
  const h = heart();
  const naruto = [{ name: "Naruto", russian: "Наруто", image: { original: "/system/animes/original/20.jpg" }, url: "/animes/20-naruto", kind: "tv", score: "8.01", status: "released", episodes: 220, aired_on: "2002-10-03" }];
  source("shikimori.one/api/animes?search=", (url) => (decodeURIComponent(url).includes("Наруто") ? naruto : []));
  await h.onMessage(message("найди аниме Наруто"), KEY);
  assert.deepEqual(photos().at(-1), {
    chat_id: 5, photo: "https://shikimori.one/system/animes/original/20.jpg", parse_mode: "HTML",
    caption: '<b>Наруто</b>\nNaruto\nсериал · 2002 · 220 серий · оценка 8,01',
  });
  assert.match(sourced().at(-1), /censored=true/u);

  source("shikimori.one/api/animes?order=random", [{ name: "Mushishi", russian: "", image: { original: "/assets/globals/missing_original.jpg" }, url: "/animes/457", kind: "tv", score: "8.65", status: "ongoing", episodes: 0, aired_on: "2005-10-23" }]);
  await h.onMessage(message("посоветуй аниме"), KEY);
  assert.equal(sent().text, 'Вот что выпало — оценка у зрителей высокая:\n<b>Mushishi</b>\nсериал · 2005 · выходит · оценка 8,65');
  assert.equal(sent().parse_mode, "HTML");
  assert.match(sourced().at(-1), /order=random&score=8&kind=tv/u);

  await h.onMessage(message("аниме: Такого Нет"), KEY);
  assert.match(last(), /Не нашла аниме «Такого Нет»/u);
  assert.equal(chats().length, 0, "название и оценку модель не сочиняет");
});

test("музыка: отрывок с подписью без ссылок; второй каталог — запасной; отрывок не ушёл — название", async () => {
  reset();
  const h = heart();
  source("itunes.apple.com/search", (url) => (decodeURIComponent(url).includes("Кино") ? { results: [
    { artistName: "Кино", trackName: "Группа крови", collectionName: "Группа крови", trackViewUrl: "https://music.example/t/1", previewUrl: "https://audio.example/1.m4a", trackTimeMillis: 285000 },
    { artistName: "Кино", trackName: "Звезда по имени Солнце", collectionName: "", trackViewUrl: "https://music.example/t/2", previewUrl: "https://audio.example/2.m4a", trackTimeMillis: 225000 },
  ] } : { results: [] }));
  await h.onMessage(message("найди песню Кино — Группа крови"), KEY);
  assert.deepEqual(calls("sendAudio").at(-1), {
    chat_id: 5, audio: "https://audio.example/1.m4a", performer: "Кино", title: "Группа крови", parse_mode: "HTML",
    caption: 'Кино — Группа крови (Группа крови) · 4:45\nЭто отрывок, 30 секунд.\n\nЕщё есть:\n• Кино — Звезда по имени Солнце · 3:45',
  });
  assert.match(sourced().at(-1), /media=music&entity=song&limit=3&country=RU/u);

  source("api.deezer.com/search", { data: [{ title: "Sonne", artist: { name: "Rammstein" }, album: { title: "Mutter" }, link: "https://deezer.example/3", preview: "https://audio.example/3.mp3", duration: 272 }] });
  sdk().failing.sendAudio = new Error("failed to get HTTP URL content");
  await h.onMessage(message("песня: Rammstein Sonne"), KEY);
  assert.equal(sent().text, '🎵 Rammstein — Sonne (Mutter) · 4:32\nОтрывка к ней у меня нет.');
  assert.deepEqual({ mode: sent().parse_mode, preview: sent().disable_web_page_preview }, { mode: "HTML", preview: true });

  source("api.deezer.com/search", { data: [] });
  sdk().sourceReplies.reverse();
  await h.onMessage(message("включи трек ъъъ ыыы"), KEY);
  assert.match(last(), /Не нашла «ъъъ ыыы»\. Попробуйте так: «найди песню исполнитель — название»/u);
  assert.equal(chats().length, 0);
});

test("видео: адрес спрятан под названием, взрослое отсеяно; запасной источник; «нарисуй» — честное «не умею»", async () => {
  reset();
  const h = heart();
  source("rutube.ru/api/search/video", (url) => (decodeURIComponent(url).includes("борщ") ? { results: [
    { title: "Борщ за час", video_url: "https://rutube.example/video/1/", author: { name: "Кухня" }, duration: 3725, is_adult: false, pg_rating: { age: 0 } },
    { title: "Не для всех", video_url: "https://rutube.example/video/2/", author: { name: "X" }, duration: 60, is_adult: true },
    { title: "Тоже 18+", video_url: "https://rutube.example/video/3/", author: { name: "X" }, duration: 60, pg_rating: { age: 18 } },
    { title: "Борщ <по-домашнему>", video_url: "https://rutube.example/video/4/", author: { name: "" }, duration: 0 },
  ] } : { results: [] }));
  await h.onMessage(message("найди видео как варить борщ"), KEY);
  assert.equal(sent().text, '🎬 «как варить борщ»:\n\n1. <a href="https://rutube.example/video/1/">Борщ за час</a> — Кухня, 1:02:05\n2. <a href="https://rutube.example/video/4/">Борщ &lt;по-домашнему&gt;</a>');
  assert.match(sourced().at(-1), /client=wdp/u, "без этого параметра поиск источника пуст");

  source("api.dailymotion.com/videos", { list: [{ title: "Cats", url: "https://dm.example/v/1", duration: 95, "owner.screenname": "Zoo" }] });
  await h.onMessage(message("видео: котики"), KEY);
  assert.equal(sent().text, '🎬 «котики»:\n\n1. <a href="https://dm.example/v/1">Cats</a> — Zoo, 1:35');
  assert.match(sourced().at(-1), /family_filter=true/u);

  await h.onMessage(message("нарисуй котика в шляпе"), KEY);
  assert.match(last(), /Рисовать я не умею.*«найди картинку котика в шляпе»/su);
  assert.equal(chats().length, 0);
  // Идёт игра — просьба о поиске ходом не считается.
  await h.onMessage(message("виселица"), KEY);
  await h.onMessage(message("видео: котики"), KEY);
  assert.match(sent().text, /^🎬 «[^»]+»:\n\n1\. <a href=/u);
  assert.doesNotMatch(sent().text, /Dailymotion|Rutube|нашла на/u, "источник не называется");
});
