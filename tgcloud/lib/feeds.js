/**
 * Новости из лент (идея 54): хозяин называет RSS- или Atom-ленты, она по слову
 * «новости» показывает свежие заголовки со ссылками. Без модели: заголовки —
 * как их написал источник, от себя она ничего не добавляет.
 *
 * Своих лент у неё нет: какие источники считать новостями — решает хозяин.
 * Здесь разбор слов и разбор самой ленты; сеть и хранение — в сердце.
 */
export const FEEDS_KEY = "heart:feeds:v1";
export const NEWS_CACHE_KEY = "heart:news:cache";
export const FEEDS_MAX = 5;
export const NEWS_SHOWN = 5;
export const NEWS_FRESH_MS = 15 * 60_000;
const TITLE_MAX = 160;

const fold = (text) => String(text ?? "").toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();

const SHOW = /^(?:(?:покажи|расскажи|дай|прочитай)\s+(?:мне\s+)?)?(?:(?:свежие|последние|главные|сегодняшние)\s+)?новости(?:\s+(?:дня|мира|в\s+мире|сегодня|на\s+сегодня))?(?:\s+(?:про|о|об|по\s+теме|на\s+тему)\s+(.{2,40}))?$|^что\s+(?:нового|происходит|случилось|творится)\s+в\s+мире$/u;
const ADD = /^(?:добавь|подключи|запомни)(?:те)?\s+(?:новостную\s+)?(?:ленту|rss|источник\s+новостей)\s*:?\s*(https?:\/\/\S+)$/iu;
const DROP = /^(?:убери|удали|отключи)(?:те)?\s+(?:новостную\s+)?ленту\s+(?:(?:номер\s+|№\s*)?(\d)|(https?:\/\/\S+))$/iu;
const LIST = /^(?:мои\s+ленты|ленты(?:\s+новостей)?|список\s+лент|откуда\s+(?:ты\s+берешь\s+|у\s+тебя\s+)?новости|источники\s+новостей)$/u;

/**
 * Слова → просьба, иначе null:
 *   { show: true, about? } — «новости», «новости про космос», «что нового в мире»;
 *   { add: url } · { drop: 2 | url } · { list: true } — слова хозяина о лентах.
 * «Какие новости?» — не сюда: это вопрос о ней самой.
 */
export function parseNews(text) {
  const raw = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!raw || raw.length > 300) return null;
  const value = fold(raw).replace(/[.!?…]+$/u, "").trim();
  if (LIST.test(value)) return { list: true };
  let found = raw.replace(/[.!…]+$/u, "").match(ADD);
  if (found) return { add: found[1] };
  found = raw.replace(/[.!…]+$/u, "").match(DROP);
  if (found) return { drop: found[1] ? Number(found[1]) : found[2] };
  found = value.match(SHOW);
  if (found) return { show: true, ...(found[1] ? { about: found[1].trim() } : {}) };
  return null;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", laquo: "«", raquo: "»", mdash: "—", ndash: "–", hellip: "…" };
/** Текст из куска XML: без CDATA-обёртки, без тегов, с раскрытыми сущностями. */
export function plainText(source) {
  const decode = (text) => text
    .replace(/&#x([0-9a-f]{1,6});/giu, (all, hex) => { try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return " "; } })
    .replace(/&#(\d{1,7});/gu, (all, code) => { try { return String.fromCodePoint(Number(code)); } catch { return " "; } })
    .replace(/&([a-z]{2,6});/giu, (all, name) => ENTITIES[name.toLowerCase()] ?? all);
  const bare = (text) => text.replace(/<[^>]*>/gu, " ");
  // Заголовки в лентах часто закодированы дважды («&amp;quot;», «&lt;b&gt;»): два прохода.
  return decode(bare(decode(bare(String(source ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1"))))).replace(/\s+/gu, " ").trim();
}
const inner = (block, tag) => block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "iu"))?.[1] ?? "";

/**
 * Лента → `{ title, items: [{ title, link, at }] }`. RSS (`<item>`) и Atom (`<entry>`).
 * `safe(url)` — проверка адреса: ссылки, которые её не прошли, в список не идут.
 */
export function parseFeed(xml, { safe = (url) => url, limit = 30 } = {}) {
  const source = String(xml ?? "");
  const blocks = [...source.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/giu)].slice(0, limit * 2);
  const head = blocks.length ? source.slice(0, blocks[0].index) : source.slice(0, 4000);
  const items = [];
  for (const [, , block] of blocks) {
    const title = plainText(inner(block, "title")).slice(0, TITLE_MAX);
    // RSS: <link>адрес</link>; Atom: <link href="адрес"/> — «alternate» или без rel.
    let link = plainText(inner(block, "link"));
    if (!link) {
      const links = [...block.matchAll(/<link\b([^>]*)\/?>/giu)].map(found => found[1]);
      const pick = links.find(attrs => /rel\s*=\s*["']alternate["']/iu.test(attrs)) ?? links.find(attrs => !/rel\s*=/iu.test(attrs)) ?? links[0] ?? "";
      link = plainText(pick.match(/href\s*=\s*["']([^"']+)["']/iu)?.[1] ?? "");
    }
    link = safe(link);
    if (!title || !link) continue;
    const date = plainText(inner(block, "pubDate") || inner(block, "updated") || inner(block, "published") || inner(block, "dc:date"));
    const at = Date.parse(date);
    items.push({ title, link, at: Number.isFinite(at) ? at : 0 });
    if (items.length >= limit) break;
  }
  return { title: plainText(inner(head, "title")).slice(0, 60), items };
}

/** Свежее из нескольких лент: по времени, без повторов. Записи без даты — после датированных, в порядке ленты. */
export function mergeNews(feeds, limit = 40) {
  const all = [];
  for (const feed of Array.isArray(feeds) ? feeds : []) for (const item of feed.items ?? []) all.push({ t: item.title, l: item.link, at: item.at, f: feed.title });
  const seen = new Set();
  return all
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => (b.at - a.at) || (a.index - b.index))
    .filter(item => { const key = fold(item.t); if (seen.has(key) || seen.has(item.l)) return false; seen.add(key); seen.add(item.l); return true; })
    .slice(0, limit)
    .map(({ index, ...item }) => item);
}

/** Записи «про что-то»: слово ищется в заголовке без окончания («космос» найдёт «космоса»). */
export function newsAbout(items, about) {
  const words = fold(about).split(" ").filter(word => word.length >= 2).map(word => (word.length > 4 ? word.slice(0, -2) : word.length > 3 ? word.slice(0, -1) : word));
  if (!words.length) return items;
  return items.filter(item => words.every(word => fold(item.t).includes(word)));
}
