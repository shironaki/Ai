/**
 * Поиск: картинки, аниме-арт, аниме, музыка, видео.
 *
 * Всё — из открытых источников без ключа. Модель в этом не участвует: она
 * придумала бы и название аниме, и ссылку. Найденное подписано источником;
 * не нашлось — так и сказано.
 *
 * Чего здесь нет и почему:
 *   • рисовать Аи не умеет — бесплатной генерации без ключа не осталось;
 *   • музыка — отрывок в тридцать секунд и ссылка: целые треки открыто не
 *     раздаёт никто, а пиратский источник сюда не подключается;
 *   • видео — ссылки, а не файлы.
 */
import { fold } from "./sources.js";

const FIND = "(?:найди|поищи|покажи|пришли|скинь|кинь|дай|отправь|включи|поставь|загугли)(?:те)?";
const ME = "(?:(?:мне|нам|сюда|пожалуйста|плиз)\\s+)*";
const ANY = "(?:(?:какую-нибудь|какое-нибудь|какой-нибудь|какую-то|случайную|случайного|случайное|милую|красивую|одну)\\s+)*";

/** Аниме-арт: слово человека → категория открытой коллекции. */
const ART = [
  ["neko", "нек[оу]|некочк[уа]|кошкодевочк[уа]|кошкодевку|неко[\\s-]?тян(?:ку|очку)?"],
  ["kitsune", "кицун[эе]|лисодевочк[уа]|кицунэ[\\s-]?тян"],
  ["husbando", "(?:аниме[\\s-]?)?(?:парня|куна|мальчика|мужчину)|кун|хасбандо|красавчика"],
  ["waifu", "(?:аниме[\\s-]?)?(?:тян(?:ку|очку|ок)?|девушку|девочку)|вайфу|аниме[\\s-]?арт|арт"],
];
const ART_WORD = Object.freeze({ neko: "неко", kitsune: "кицунэ", husbando: "аниме-парень", waifu: "аниме-девушка" });
const PLAIN = new Set(["девушку", "девочку", "парня", "мальчика", "мужчину", "красавчика"]);

const PICTURE = "(?:картинк[уи]|картиночку|фото|фотку|фотографи[юи]|изображени[ея]|пикчу|обои)";
const SONG = "(?:песн[юи]|песенку|трек|музыку|музычку|композицию|мелодию|саундтрек|опенинг|эндинг|ост)";
const SONG_NAME = "(?:песня|трек|музыка|мелодия|саундтрек|опенинг|эндинг|ост)";
const VIDEO = "(?:видео|видос|видосик|видеоролик|ролик|клип)";
const PERSONAL = /(?:^|\s)(?:я|ты|мы|вы|он|она|они|мне|меня|тебе|тебя|нас|вас|мой|моя|мое|мои|мою|твой|твоя|твое|твои|твою|себя|себе|свой|свою|свое|свои)(?=\s|$)/u;
/** После «покажи» эти слова — не предмет, а просьба о тексте или настройке. */
const NOT_A_THING = /^(?:как|что|где|когда|почему|зачем|кто|куда|откуда|сколько|чем|все|всё|это|этот|эту|еще|пример\S*|код|решение|ответ\S*|список|результат\S*|текст|перевод|формул\S*|таблиц\S*|расписание|правила|помощь|меню|команды|настройки|статус|ошибк\S*|лог\S*|истори\S*|память|уроки|заметки|напоминани\S*|профиль|карточк\S*|роль|уровень|инвентарь|награды|баланс|топ|рейтинг|варны|предупреждени\S*|vip|вип|id|ид|айди|приветствие|опрос|игры|возможности|умения|класс|фокус|мастер-класс|характер|дорогу|путь|выход|время|погоду|курс|новости)(?=\s|$)/u;

const clean = (value) => String(value ?? "").replace(/^[«"'“\s:—–-]+|[»"'”\s]+$/gu, "").replace(/\s+/gu, " ").trim();
const topic = (value, words = 8) => {
  const text = clean(value).replace(/^(?:про|о|об|на\s+тему|по\s+запросу|с|со)\s+/iu, "");
  return text.length >= 2 && text.length <= 80 && text.split(" ").length <= words ? text : "";
};

/**
 * Что ищут. `value` — фраза как есть. Возвращает
 *   { kind: "art", category } · { kind: "image", query, loose? } · { kind: "anime", query | random }
 *   { kind: "music", query } · { kind: "video", query } · { kind: "draw", query }
 * или null.
 */
/** Манера, в которой можно перерисовать прошлый рисунок: «маслом», «из лего», «в стиле Ван Гога». */
export const RESTYLE = "(?:маслом|акварелью|карандашом|углем|пастелью|гуашью|тушью|мелками|чернилами|из\\s+лего|из\\s+пластилина|из\\s+бумаги|из\\s+глины|пикселями|в\\s+пикселях|в\\s+(?:стиле|манере|духе|виде)\\s+.{2,60}|как\\s+(?:аниме|комикс|мультик|мультфильм|фото|фотографию|гравюру|витраж|мозаику|набросок|эскиз|картину))";

export function parseMedia(value) {
  const raw = String(value ?? "").replace(/\s+/gu, " ").trim().replace(/[?!.…]+$/u, "").trim();
  const text = fold(raw);
  if (!text || text.length > 140) return null;
  let match;
  // Запрос — словами человека, с его заглавными: он попадёт в подпись.
  const said = (found) => (text.length === raw.length ? raw.slice(raw.length - found[1].length) : found[1]);

  // «Нарисуй …» — честное «не умею» с тем, что умеет.
  // «Сделай его из лего», «сделай картинку маслом», «перерисуй акварелью» — прошлый рисунок чата в другой манере.
  match = text.match(new RegExp(`^(?:(?:сделай|нарисуй|перерисуй|переделай)(?:те)?\\s+(?:(?:мне|его|ее|это|эту|этот|ту|тот|то\\s+же(?:\\s+самое)?|такое\\s+же|такую\\s+же|картинку|рисунок|изображение|арт|фото|фотографию|фотку)\\s+){0,3})(${RESTYLE})$`, "u"));
  if (match) return { kind: "draw", query: `ещё: ${clean(said(match))}` };
  match = text.match(/^(?:нарисуй(?:те)?|(?:сгенерируй|создай|сделай)(?:те)?\s+(?:мне\s+)?(?:картинку|изображение|арт|рисунок|фото|фотографию|фотку))\s+(.{2,100})$/u);
  // «Нарисуй смайликами» — это текст, его напишет модель.
  if (match && !/^(?:опрос|викторин)/u.test(match[1]) && !/смайл|эмодзи|символ|текст|слов|ascii|аски|псевдограф|схем|таблиц|план/u.test(match[1])) return { kind: "draw", query: clean(said(match)) };
  if (match) return null;

  // Аниме-арт: «покажи тянку», «скинь неко».
  match = text.match(new RegExp(`^${FIND}\\s+${ME}${ANY}(.{2,30})$`, "u"));
  if (match) {
    const word = match[1].trim();
    const hit = ART.find(([, body]) => new RegExp(`^(?:${body})$`, "u").test(word));
    // «Покажи девушку» без «аниме» — не к коллекции рисунков.
    if (hit && !PLAIN.has(word)) return { kind: "art", category: hit[0], word: ART_WORD[hit[0]] };
  }

  // Аниме, похожее на названное: «посоветуй аниме, похожее на Наруто», «что похоже на Наруто», «аниме как Наруто».
  match = text.match(/^(?:(?:посоветуй|порекомендуй|подскажи|предложи|найди|дай)(?:те)?\s+)?(?:мне\s+|нам\s+)?(?:аниме|что-нибудь|что-то|что)?,?\s*(?:похоже[ег]?о?|вроде|типа|в\s+духе)\s+(?:на\s+)?(?:аниме\s+)?(.{2,80})$/u)
    ?? text.match(/^(?:(?:посоветуй|порекомендуй|найди)(?:те)?\s+)?(?:мне\s+)?аниме\s+как\s+(.{2,80})$/u);
  // Только со словом «аниме»: «что похоже на грозу» и «посоветуй что-нибудь вроде Гарри Поттера» — не к каталогу аниме.
  if (match && topic(match[1]) && /аниме/u.test(text) && !/^(?:на\s+)?(?:меня|тебя|него|нее|нас|вас|них|это|правду|то)$/u.test(match[1].trim())) return { kind: "anime", like: topic(said(match)) };

  // Аниме: случайное по просьбе совета и поиск по названию.
  if (/^(?:посоветуй|порекомендуй|подскажи|предложи|выбери|дай)(?:те)?\s+(?:мне\s+|нам\s+)?(?:(?:какое-нибудь|какое-то|хорошее|случайное|годное|интересное|новое)\s+)*аниме(?:шку)?(?:\s+(?:на\s+вечер|посмотреть|на\s+выходные|глянуть))*$/u.test(text)
    || /^(?:что|какое\s+аниме)\s+(?:мне\s+|нам\s+)?(?:по)?(?:смотреть|глянуть)(?:\s+из\s+аниме)?$/u.test(text) && /аниме/u.test(text)
    || /^случайное\s+аниме$/u.test(text)) return { kind: "anime", random: true };
  match = text.match(new RegExp(`^(?:${FIND}|расскажи(?:те)?\\s+про|что\\s+за|инфо(?:рмация)?\\s+(?:про|об?))\\s+${ME}аниме\\s+(.{2,80})$`, "u")) ?? text.match(/^аниме\s*[:—–-]\s*(.{2,80})$/u);
  if (match && topic(match[1])) return { kind: "anime", query: topic(said(match)) };

  // Музыка: «найди песню …», «песня: …».
  match = text.match(new RegExp(`^${FIND}\\s+${ME}${SONG}\\s+(.{2,100})$`, "u")) ?? text.match(new RegExp(`^${SONG_NAME}\\s*[:—–-]\\s*(.{2,100})$`, "u"));
  if (match && topic(match[1], 10)) return { kind: "music", query: topic(said(match), 10) };

  // Видео: «найди видео …», «видео: …».
  match = text.match(new RegExp(`^${FIND}\\s+${ME}${VIDEO}\\s+(.{2,100})$`, "u")) ?? text.match(new RegExp(`^${VIDEO}\\s*[:—–-]\\s*(.{2,100})$`, "u"));
  if (match && topic(match[1], 10)) return { kind: "video", query: topic(said(match), 10) };

  // Картинка по словам: «найди картинку …», «картинка: …».
  match = text.match(new RegExp(`^${FIND}\\s+${ME}${ANY}${PICTURE}\\s+(.{2,80})$`, "u")) ?? text.match(/^(?:картинка|фото|изображение|обои)\s*[:—–-]\s*(.{2,80})$/u);
  if (match) {
    const query = topic(match[1], 6);
    return query && !PERSONAL.test(query) ? { kind: "image", query: topic(said(match), 6) } : null;
  }
  // «Покажи закат»: предмет в одно-три слова. Всё остальное — разговор.
  match = text.match(/^покажи(?:те)?\s+(?:мне\s+|нам\s+)?(.{2,40})$/u);
  if (match) {
    const query = topic(match[1], 3);
    if (query && !PERSONAL.test(query) && !NOT_A_THING.test(query) && /^[\p{L}\p{N}\s-]+$/u.test(query)) return { kind: "image", query: topic(said(match), 3), loose: true };
  }
  return null;
}

const clock = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (!total) return "";
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};
const ANIME_KIND = Object.freeze({ tv: "сериал", movie: "фильм", ova: "OVA", ona: "ONA", special: "спешл", tv_special: "спешл", music: "клип", pv: "проморолик", cm: "реклама" });
const episodesWord = (n) => { const d = n % 10, h = n % 100; return d === 1 && h !== 11 ? "серия" : d >= 2 && d <= 4 && (h < 12 || h > 14) ? "серии" : "серий"; };

export function createMedia({ sources = null } = {}) {
  const get = (url, timeout = 5000) => (sources?.fetchJson ? sources.fetchJson(url, { timeout }) : Promise.resolve({ ok: false, code: "unavailable" }));
  const q = encodeURIComponent;
  /** «не нашлось» отличается от «источник молчит»: человеку говорят разное. */
  const outcome = (items, replies) => (items.length ? { ok: true, items } : { ok: false, code: replies.some(item => item.ok) ? "not_found" : "network", items: [] });

  /** Картинки по словам: Викисклад, затем Openverse. */
  async function images(query, limit = 4) {
    const commons = await get(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${q(`${query} filetype:bitmap`)}&gsrlimit=${limit + 2}&prop=imageinfo&iiprop=url%7Cmime%7Csize&iiurlwidth=1280&format=json&origin=*`);
    const pages = Object.values(commons.ok ? commons.data?.query?.pages ?? {} : {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const found = pages.map(page => {
      const info = page.imageinfo?.[0] ?? {};
      if (!/^image\/(?:jpeg|png|webp)$/u.test(String(info.mime ?? ""))) return null;
      return { url: info.thumburl || info.url, full: info.url, page: info.descriptionurl ?? "", source: "Викисклад", title: String(page.title ?? "").replace(/^File:/u, "").replace(/\.[a-z]{3,4}$/iu, "") };
    }).filter(item => item?.url).slice(0, limit);
    if (found.length) return { ok: true, items: found };
    const open = await get(`https://api.openverse.org/v1/images/?q=${q(query)}&page_size=${limit}&mature=false`);
    const items = (open.ok ? open.data?.results ?? [] : []).filter(item => item?.url && item.mature !== true).slice(0, limit).map(item => ({
      url: item.url, full: item.url, page: item.foreign_landing_url ?? "", source: "Openverse",
      title: String(item.title ?? ""), credit: [item.creator, item.license ? `CC ${String(item.license).toUpperCase()}` : ""].filter(Boolean).join(", "),
    }));
    return outcome(items, [commons, open]);
  }

  /** Аниме-арт из открытой коллекции: рисунок и автор. */
  async function art(category) {
    if (!ART_WORD[category]) return { ok: false, code: "not_found", items: [] };
    const got = await get(`https://nekos.best/api/v2/${category}`, 4000);
    const item = got.ok ? got.data?.results?.[0] : null;
    return item?.url ? { ok: true, items: [{ url: item.url, page: item.source_url ?? "", credit: item.artist_name ?? "", source: "nekos.best" }] } : outcome([], [got]);
  }

  const shaped = (item, origin) => {
    const poster = String(item.image?.original ?? "");
    return {
      id: Number(item.id) || 0, title: String(item.russian || item.name), original: String(item.name), kind: ANIME_KIND[item.kind] ?? "",
      year: String(item.aired_on ?? "").slice(0, 4), episodes: Number(item.episodes) || 0, score: Number(item.score) || 0,
      ongoing: item.status === "ongoing",
      url: poster && !poster.includes("missing_") ? `${origin}${poster}` : "", page: item.url ? `${origin}${item.url}` : "", source: "Shikimori",
    };
  };
  /**
   * Похожее на названное аниме — по данным каталога, без модели. Три запроса:
   * само аниме, его «похожие», и те же номера через фильтр «без взрослого»:
   * список похожих его не знает. `seed` — что нашлось по названию.
   */
  async function similar(query, limit = 12) {
    const base = "https://shikimori.one";
    const found = await get(`${base}/api/animes?search=${q(query)}&limit=1&censored=true`);
    const first = found.ok && Array.isArray(found.data) ? found.data[0] : null;
    if (!first?.id) return { ...outcome([], [found]), seed: null };
    const origin = String(found.url ?? "").match(/^https?:\/\/[^/]+/u)?.[0] ?? base;
    const seed = shaped(first, origin);
    const near = await get(`${origin}/api/animes/${first.id}/similar`);
    const ids = (near.ok && Array.isArray(near.data) ? near.data : []).map(item => Number(item?.id)).filter(id => id > 0 && id !== seed.id).slice(0, 30);
    if (!ids.length) return { ok: false, code: near.ok ? "not_found" : "network", items: [], seed };
    const clean = await get(`${origin}/api/animes?ids=${ids.join(",")}&limit=${Math.min(50, ids.length)}&censored=true&order=ranked`);
    const items = (clean.ok && Array.isArray(clean.data) ? clean.data : []).filter(item => item?.name && ids.includes(Number(item.id)) && Number(item.score) >= 7).slice(0, limit).map(item => shaped(item, origin));
    return items.length ? { ok: true, items, seed } : { ok: false, code: clean.ok ? "not_found" : "network", items: [], seed };
  }

  /** Аниме по названию или случайное с высокой оценкой. */
  async function anime({ query = "", random = false } = {}) {
    const base = "https://shikimori.one";
    const got = await get(random
      ? `${base}/api/animes?order=random&score=8&kind=tv&limit=1&censored=true`
      : `${base}/api/animes?search=${q(query)}&limit=1&censored=true`);
    const item = got.ok && Array.isArray(got.data) ? got.data[0] : null;
    if (!item?.name) return outcome([], [got]);
    // Адреса у источника относительные; сайт мог переехать — берётся тот, что ответил.
    const origin = String(got.url ?? "").match(/^https?:\/\/[^/]+/u)?.[0] ?? base;
    const poster = String(item.image?.original ?? "");
    return { ok: true, items: [{
      title: String(item.russian || item.name), original: String(item.name), kind: ANIME_KIND[item.kind] ?? "",
      year: String(item.aired_on ?? "").slice(0, 4), episodes: Number(item.episodes) || 0, score: Number(item.score) || 0,
      ongoing: item.status === "ongoing",
      url: poster && !poster.includes("missing_") ? `${origin}${poster}` : "", page: item.url ? `${origin}${item.url}` : "", source: "Shikimori",
    }] };
  }

  /** Музыка: iTunes, затем Deezer. Отрывок и ссылка. */
  async function music(query, limit = 3) {
    const apple = await get(`https://itunes.apple.com/search?term=${q(query)}&media=music&entity=song&limit=${limit}&country=RU`);
    let items = (apple.ok ? apple.data?.results ?? [] : []).filter(item => item?.trackName).map(item => ({
      artist: String(item.artistName ?? ""), title: String(item.trackName), album: String(item.collectionName ?? ""),
      page: String(item.trackViewUrl ?? ""), preview: String(item.previewUrl ?? ""), seconds: Math.round((Number(item.trackTimeMillis) || 0) / 1000), source: "Apple Music",
    }));
    if (items.length) return { ok: true, items };
    const deezer = await get(`https://api.deezer.com/search?q=${q(query)}&limit=${limit}`);
    items = (deezer.ok ? deezer.data?.data ?? [] : []).filter(item => item?.title).map(item => ({
      artist: String(item.artist?.name ?? ""), title: String(item.title), album: String(item.album?.title ?? ""),
      page: String(item.link ?? ""), preview: String(item.preview ?? ""), seconds: Number(item.duration) || 0, source: "Deezer",
    }));
    return outcome(items, [apple, deezer]);
  }

  /** Что слушают сейчас: чарт Deezer (без ключа). Песни в том же виде, что у поиска музыки. */
  async function chart(limit = 50) {
    const got = await get(`https://api.deezer.com/chart/0/tracks?limit=${limit}`);
    const items = (got.ok ? got.data?.data ?? [] : []).filter(item => item?.title && item.explicit_lyrics !== true).map(item => ({
      artist: String(item.artist?.name ?? ""), title: String(item.title), album: String(item.album?.title ?? ""),
      page: String(item.link ?? ""), preview: String(item.preview ?? ""), seconds: Number(item.duration) || 0, source: "Deezer",
    }));
    return outcome(items, [got]);
  }

  /** Видео: Rutube, затем Dailymotion. Только ссылки; взрослое отсеивается. */
  async function video(query, limit = 3) {
    const rutube = await get(`https://rutube.ru/api/search/video/?query=${q(query)}&client=wdp`);
    let items = (rutube.ok ? rutube.data?.results ?? [] : [])
      .filter(item => item?.video_url && item.is_adult !== true && !(Number(item.pg_rating?.age) >= 18))
      .slice(0, limit).map(item => ({ title: String(item.title ?? "Без названия"), url: String(item.video_url), author: String(item.author?.name ?? ""), seconds: Number(item.duration) || 0, source: "Rutube" }));
    if (items.length) return { ok: true, items };
    const daily = await get(`https://api.dailymotion.com/videos?search=${q(query)}&limit=${limit}&family_filter=true&fields=${q("id,title,url,duration,owner.screenname")}`);
    items = (daily.ok ? daily.data?.list ?? [] : []).filter(item => item?.url).slice(0, limit)
      .map(item => ({ title: String(item.title ?? "Без названия"), url: String(item.url), author: String(item["owner.screenname"] ?? ""), seconds: Number(item.duration) || 0, source: "Dailymotion" }));
    return outcome(items, [rutube, daily]);
  }

  return Object.freeze({ images, art, anime, similar, music, chart, video });
}

const esc = (value) => String(value ?? "").replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
const link = (url, label) => (/^https?:\/\//u.test(String(url)) ? `<a href="${esc(url)}">${esc(label)}</a>` : esc(label));

/** С прописной: подпись — её слова, а не строка поиска. */
const capital = (text) => { const value = String(text ?? "").trim(); return value ? value[0].toUpperCase() + value.slice(1) : ""; };

/**
 * Подписи: одна строка о том, что это. Откуда — не пишется: ответ выглядит её
 * работой, а не выдачей поиска. Автор и страница не пропадают: их хранит
 * сердце и называет по вопросу «откуда это?». Разметка — HTML.
 */
export const captions = Object.freeze({
  image: (item, query) => esc(capital(query)),
  art: () => "",
  anime(item) {
    const facts = [item.kind, item.year, item.episodes ? `${item.episodes} ${episodesWord(item.episodes)}` : item.ongoing ? "выходит" : "", item.score ? `оценка ${String(item.score).replace(".", ",")}` : ""].filter(Boolean).join(" · ");
    return `<b>${esc(item.title)}</b>${item.original && item.original !== item.title ? `\n${esc(item.original)}` : ""}${facts ? `\n${esc(facts)}` : ""}`;
  },
  song: (item) => `${esc(item.artist)} — ${esc(item.title)}${item.album ? ` (${esc(item.album)})` : ""}${item.seconds ? ` · ${clock(item.seconds)}` : ""}`,
  // Видео — это всегда адрес: он спрятан под названием, иначе его не открыть.
  video: (item) => `${link(item.url, item.title)}${[item.author, clock(item.seconds)].filter(Boolean).length ? ` — ${esc([item.author, clock(item.seconds)].filter(Boolean).join(", "))}` : ""}`,
});

/** Откуда вещь на самом деле: для вопроса «откуда это?». */
export const creditOf = (item, title = "") => ({
  title: String(title || item?.title || "").slice(0, 120), source: String(item?.source ?? ""), page: String(item?.page || item?.url || ""), author: String(item?.credit ?? item?.author ?? ""),
});
