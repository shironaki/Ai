/**
 * Новости из лент (идея 54): хозяин называет RSS/Atom-ленты, «новости» —
 * свежие заголовки со ссылками. Без модели.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, chats, says, sdk, source, sourced, OWNER, KEY } from "./fixtures/kit.mjs";

const { parseNews, parseFeed, mergeNews, newsAbout, plainText, FEEDS_KEY } = await import("../tgcloud/lib/feeds.js");

const NOON = Date.parse("2026-11-18T09:00:00Z");
const own = (text) => message(text, { id: OWNER });
const sent = () => sdk().sent.at(-1);
const xml = (body, { type = "application/rss+xml; charset=utf-8", status = 200, url = "" } = {}) => ({
  ok: status >= 200 && status < 300, status, url,
  headers: { get: (name) => ({ "content-type": type })[String(name).toLowerCase()] ?? null },
  text: async () => body,
});
const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Наука &amp; жизнь</title><link>https://example.org/</link>
<item><title><![CDATA[Телескоп снял <b>новую</b> комету &laquo;C/2026&raquo;]]></title><link>https://example.org/n/1?a=1&amp;b=2</link><pubDate>Wed, 18 Nov 2026 08:30:00 GMT</pubDate></item>
<item><title>Учёные &amp;quot;пересчитали&amp;quot; океан</title><link>https://example.org/n/2</link><pubDate>Wed, 18 Nov 2026 06:00:00 GMT</pubDate></item>
<item><title>Запись со ссылкой внутрь</title><link>http://127.0.0.1/admin</link><pubDate>Wed, 18 Nov 2026 08:59:00 GMT</pubDate></item>
<item><title></title><link>https://example.org/n/empty</link></item>
</channel></rss>`;
const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Космос сегодня</title>
<entry><title type="html">Запуск к Луне перенесли</title><link rel="self" href="https://example.org/self"/><link rel="alternate" href="https://example.org/a/1"/><updated>2026-11-18T07:00:00Z</updated></entry>
<entry><title>Телескоп снял новую комету «C/2026»</title><link href="https://example.org/a/dup"/><updated>2026-11-18T05:00:00Z</updated></entry>
<entry><title>Заметка без даты</title><link href="https://example.org/a/2"/></entry></feed>`;

test("разбор слов и самой ленты: RSS и Atom, сущности, CDATA, небезопасные ссылки — мимо", () => {
  const cases = {
    "новости": { show: true }, "Покажи новости": { show: true }, "свежие новости": { show: true }, "новости дня": { show: true }, "что нового в мире?": { show: true },
    "новости про космос": { show: true, about: "космос" }, "последние новости о науке": { show: true, about: "науке" },
    "добавь ленту https://example.org/rss.": { add: "https://example.org/rss" }, "подключи rss: https://example.org/feed.xml": { add: "https://example.org/feed.xml" },
    "убери ленту 2": { drop: 2 }, "убери ленту https://example.org/rss": { drop: "https://example.org/rss" },
    "мои ленты": { list: true }, "откуда новости": { list: true }, "ленты новостей": { list: true },
  };
  for (const [said, want] of Object.entries(cases)) assert.deepEqual(parseNews(said), want, said);
  // «Какие новости?» — вопрос о ней самой; «новости Юи» — о сестре.
  for (const said of ["какие новости", "что нового", "новости юи", "это новости", "добавь ленту", "убери ленту", "хорошие новости!"]) assert.equal(parseNews(said), null, said);

  assert.equal(plainText("<![CDATA[Раз <i>два</i>]]> &amp;quot;три&amp;quot; &#8212; &#x41;"), "Раз два \"три\" — A");
  const safe = (url) => (/127\.0\.0\.1/u.test(url) ? "" : url);
  const rss = parseFeed(RSS, { safe });
  assert.equal(rss.title, "Наука & жизнь");
  assert.deepEqual(rss.items.map(item => [item.title, item.link]), [
    ["Телескоп снял новую комету «C/2026»", "https://example.org/n/1?a=1&b=2"],
    ["Учёные \"пересчитали\" океан", "https://example.org/n/2"],
  ]);
  assert.equal(rss.items[0].at, Date.parse("2026-11-18T08:30:00Z"));
  const atom = parseFeed(ATOM);
  assert.equal(atom.title, "Космос сегодня");
  assert.deepEqual(atom.items.map(item => item.link), ["https://example.org/a/1", "https://example.org/a/dup", "https://example.org/a/2"]);
  assert.deepEqual(parseFeed("<html><body>не лента</body></html>").items, []);
  // Слияние: по времени, без повторов заголовка; без даты — в конце. Поиск — по слову без окончания.
  const merged = mergeNews([{ title: "А", items: rss.items }, { title: "Б", items: atom.items }]);
  assert.deepEqual(merged.map(item => item.l), ["https://example.org/n/1?a=1&b=2", "https://example.org/a/1", "https://example.org/n/2", "https://example.org/a/2"]);
  assert.deepEqual(newsAbout(merged, "кометы").map(item => item.f), ["А"]);
  assert.deepEqual(newsAbout(merged, "футбол"), []);
});

test("ленты называет хозяин; «новости» — всем: свежие заголовки со ссылками, без модели", async () => {
  reset();
  let at = NOON;
  const h = heart({}, { now: () => at });
  // Лент нет: хозяину — как добавить; остальным — коротко и без слова «хозяин».
  await h.onMessage(own("новости"), KEY);
  assert.equal(last(OWNER), "Лент новостей у меня пока нет — читать неоткуда. Добавьте: «добавь ленту https://…» (RSS или Atom, до пяти штук).");
  await h.onMessage(group("Аи, новости"), KEY);
  assert.equal(last(-10), "Новостных лент мне пока не дали — читать неоткуда.");
  // Чужое «добавь ленту» — не команда: уходит в разговор.
  sdk().fetchQueue.push(says("Ленты называет не каждый."));
  await h.onMessage(message("добавь ленту https://example.org/rss"), KEY);
  assert.equal(last(), "Ленты называет не каждый.");
  assert.equal(sdk().kv.get(FEEDS_KEY) ?? null, null);

  // Не лента, ошибка сайта, внутренний адрес — честно.
  source("example.org/page", xml("<html><body>страница</body></html>", { type: "text/html" }));
  source("example.org/gone", xml("", { status: 404 }));
  await h.onMessage(own("добавь ленту https://example.org/page"), KEY);
  assert.match(last(OWNER), /^Это не похоже на ленту новостей: записей в ней не нашлось\./u);
  await h.onMessage(own("добавь ленту https://example.org/gone"), KEY);
  assert.equal(last(OWNER), "Лента не открылась: сайт ответил ошибкой 404.");
  await h.onMessage(own("добавь ленту http://127.0.0.1/rss"), KEY);
  assert.match(last(OWNER), /^Такой адрес я не открываю\./u);

  source("example.org/rss", xml(RSS));
  source("example.org/atom", xml(ATOM, { type: "application/atom+xml" }));
  await h.onMessage(own("добавь ленту https://example.org/rss"), KEY);
  assert.equal(last(OWNER), "Подключила ленту «Наука & жизнь»: в ней сейчас 2 записи. Свежее — «новости»; список лент — «мои ленты».");
  await h.onMessage(own("добавь ленту https://example.org/rss"), KEY);
  assert.equal(last(OWNER), "Эта лента у меня уже есть. Список — «мои ленты».");
  await h.onMessage(own("добавь ленту https://example.org/atom"), KEY);
  await h.onMessage(own("мои ленты"), KEY);
  assert.equal(last(OWNER), "Ленты новостей (2):\n1. Наука & жизнь — https://example.org/rss\n2. Космос сегодня — https://example.org/atom\nУбрать — «убери ленту 2». Свежее — «новости».");

  // «Новости» — всем, и в группе: по времени, без повторов, ссылкой; источник назван, когда лент несколько.
  const before = sourced().length;
  await h.onMessage(group("Аи, новости", { id: 21 }), KEY);
  assert.equal(sent().text, [
    "Свежее из лент:",
    "• <a href=\"https://example.org/n/1?a=1&amp;b=2\">Телескоп снял новую комету «C/2026»</a> — Наука &amp; жизнь",
    "• <a href=\"https://example.org/a/1\">Запуск к Луне перенесли</a> — Космос сегодня",
    "• <a href=\"https://example.org/n/2\">Учёные \"пересчитали\" океан</a> — Наука &amp; жизнь",
    "• <a href=\"https://example.org/a/2\">Заметка без даты</a> — Космос сегодня",
  ].join("\n"));
  assert.equal(sent().parse_mode, "HTML");
  assert.equal(sent().disable_web_page_preview, true);
  assert.equal(sourced().length, before + 2, "обе ленты спрошены по разу");
  // Четверть часа — из памяти; «про …» — по слову.
  await h.onMessage(message("новости про кометы"), KEY);
  assert.equal(sent().text, "Свежее из лент про «кометы»:\n• <a href=\"https://example.org/n/1?a=1&amp;b=2\">Телескоп снял новую комету «C/2026»</a> — Наука &amp; жизнь");
  await h.onMessage(message("новости про футбол"), KEY);
  assert.equal(last(), "Про «футбол» в свежих записях лент ничего нет.");
  assert.equal(sourced().length, before + 2, "второй раз в сеть не ходила");
  // Ленты замолчали — показывает то, что помнит, и говорит, на какой час.
  at += 20 * 60_000;
  sdk().sourceReplies.length = 0;
  await h.onMessage(message("новости"), KEY);
  assert.match(sent().text, /^Свежее из лент \(ленты не ответили — это записи на \d\d:\d\d\):\n• /u);

  // Убрала ленту — память новостей сброшена; лент нет и память пуста — честно.
  await h.onMessage(own("убери ленту 1"), KEY);
  assert.equal(last(OWNER), "Убрала ленту «Наука & жизнь». Осталось лент: 1.");
  await h.onMessage(message("новости"), KEY);
  assert.equal(last(), "Ленты сейчас не отвечают. Попробуйте чуть позже.");
  assert.equal(chats().length, 1, "к модели ушло только чужое «добавь ленту»");
});
