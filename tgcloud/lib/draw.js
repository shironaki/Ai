/**
 * Рисование: картинка по словам.
 *
 * Художник — Cloudflare Workers AI, модель FLUX.1 schnell: бесплатная норма
 * 10 000 «нейронов» в сутки, одна картинка 1024×1024 в четыре шага стоит
 * около 58 (проверено по странице цен 14.11.2026) — выходит порядка 170
 * картинок в день, если тем же ключом не думать. Переводчик запроса на
 * английский — там же (m2m100): модель понимает английский заметно лучше.
 *
 * Ключ один, вида «ID аккаунта:токен», приходит строкой KEY_CLOUDFLARE из
 * ~/.heart.env на время публикации. Нет ключа — рисования нет, и сердце
 * говорит об этом честно, как раньше.
 *
 * Судит код, а не модель: что рисовать нельзя, решается здесь, до запроса.
 *
 * Что уходит художнику. Он рисует описанное, а не названное: на «кота» из
 * одного слова его фильтр срабатывает зря (известная беда мастерской: одно
 * слово — и «NSFW»), а название в непривычном падеже переводчик коверкает.
 * Поэтому описание собирается по порядку:
 *   1) свой словарь художника (`data/subjects.js`) — частые просьбы описаны
 *      заранее, не тратится ничего;
 *   2) модель того же ключа пишет описание по просьбе (несколько нейронов);
 *   3) переводчик — целой фразой «Нарисуй …», а не обрывком; знакомые места
 *      в просьбе добавляются подсказкой из словаря.
 * Как было собрано и что ушло, запоминается: хозяин спрашивает «как
 * нарисовано?» — и видит.
 *
 * Отказ мастерской разбирается, а не принимается на веру. Раньше любой ответ
 * 400 со словами вроде «not allowed» считался её фильтром, и на «нарисуй кота»
 * человек слышал про фильтр, хотя причина могла быть в самом запросе. Теперь:
 * фильтр — это только слова о NSFW в ответе; всё остальное 400 — «запрос не
 * принят», и тогда пробуется тело попроще и запасные художники. Что ответила
 * мастерская, запоминается дословно: хозяин видит это в ответе и в статусе.
 */

import { subjectFor, placesIn, foldSubject, SUBJECTS } from "./data/subjects.js";

export const DRAW_STATE_KEY = "heart:draw:v1";
/** Какие модели-составители описаний не ответили и до какого часа их не спрашивать. */
export const DIRECTOR_STATE_KEY = "heart:draw:director";
export const DRAWN_PREFIX = "heart:drawn:";
/** Альбом человека: его последние просьбы о рисунке, свежая — последней. */
export const ALBUM_KEY = (userId) => `heart:album:${userId}`;
export const ALBUM_MAX = 10;

const ORDINAL = ["перв", "втор", "трет", "четверт", "пят", "шест", "седьм", "восьм", "девят", "десят"];
/**
 * Слова об альбоме → просьба, иначе null:
 *   { list: true } — «мои рисунки», «альбом»; { repeat: 3 } — «повтори рисунок 3», «повтори третий рисунок».
 * Слово «рисунок» обязательно: «повтори третий» говорят и о другом.
 */
export function parseAlbum(text) {
  const value = String(text ?? "").toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim().replace(/[.!?…]+$/u, "").trim();
  if (!value || value.length > 60) return null;
  if (/^(?:(?:покажи|открой)\s+)?(?:мои\s+рисунки|мой\s+альбом|альбом(?:\s+рисунков)?)$|^что\s+ты\s+(?:мне\s+)?(?:уже\s+)?(?:на)?рисовала$/u.test(value)) return { list: true };
  let found = value.match(/^(?:повтори|перерисуй|нарисуй(?:\s+(?:еще\s+раз|снова|заново))?)\s+рисунок\s+(?:номер\s+|№\s*)?(\d{1,2})(?:\s+(?:еще\s+раз|снова|заново))?$/u);
  if (found) return Number(found[1]) >= 1 && Number(found[1]) <= ALBUM_MAX ? { repeat: Number(found[1]) } : null;
  found = value.match(/^(?:повтори|перерисуй|нарисуй(?:\s+(?:еще\s+раз|снова|заново))?)\s+([а-я]+?)(?:ый|ой|ий)\s+рисунок(?:\s+(?:еще\s+раз|снова|заново))?$/u);
  if (found) {
    const index = ORDINAL.indexOf(found[1]);
    return index >= 0 ? { repeat: index + 1 } : null;
  }
  return null;
}
const API = "https://api.cloudflare.com/client/v4/accounts";
const PAINTER = "@cf/black-forest-labs/flux-1-schnell";
const TRANSLATOR = "@cf/meta/m2m100-1.2b";
/**
 * Художники по порядку. Первый — основной; остальные пробуются, когда он
 * запрос не принял.
 *
 * FLUX.2 klein — тот же поставщик, что у основного, и свой фильтр: запрос ему
 * уходит формой (`form`), а откровенное он не рисует (`strict`) — такие просьбы
 * к нему не идут вовсе.
 *
 * Три последних отдают картинку файлом и понимают только `prompt`. Cloudflare
 * назначил им отключение на 20.11.2026 (страницы моделей, сверено 15.11.2026):
 * после этой даты они ответят отказом, отдохнут (`SPARE_REST_MS`) и в очереди
 * мешать не будут. Убрать их из списка — когда отключение подтвердится вживую.
 */
export const PAINTERS = Object.freeze([
  { id: PAINTER, title: "FLUX schnell" },
  { id: "@cf/black-forest-labs/flux-2-klein-4b", title: "FLUX.2 klein", form: true, strict: true },
  { id: "@cf/bytedance/stable-diffusion-xl-lightning", title: "SDXL Lightning" },
  { id: "@cf/lykon/dreamshaper-8-lcm", title: "DreamShaper" },
  { id: "@cf/stabilityai/stable-diffusion-xl-base-1.0", title: "SDXL" },
]);
/** Запасной художник запрос не принял (не фильтр и не лимит) — столько его не спрашивают. */
export const SPARE_REST_MS = 6 * 3_600_000;
/** Кто из запасных отдыхает: `{ [id]: { until, status, said } }`. Для очереди и для статуса. */
export const SPARES_KEY = "heart:draw:spares";
/** Последняя неудача рисования: что ответила мастерская. Для статуса. */
export const DRAW_LAST_KEY = "heart:draw:last";
/** Поля запроса, которые основной художник назвал лишними: впредь их ему не шлют. */
export const DRAW_DROP_KEY = "heart:draw:drop";
/**
 * Имена полей из отказа «Additional or unevaluated properties '/seed' at '/' not allowed»
 * (так ответил FLUX schnell вживую 15.11.2026) и из прежней формы «('seed' was unexpected)».
 * Описание (`prompt`) лишним не бывает.
 */
export function unknownFields(words) {
  const text = String(words ?? "");
  if (!/not\s+allowed|unexpected|unevaluated/iu.test(text)) return [];
  const names = [...text.matchAll(/'\/?([a-z_]{2,24})'/giu)].map(found => found[1].toLowerCase());
  return [...new Set(names)].filter(name => name !== "prompt");
}
/** Слова мастерской о своём фильтре. Только они — «blocked»; остальное 400 — не фильтр. */
const FLAGGED = /nsfw|not\s+safe\s+for\s+work|safety\s+(?:checker|filter|system)|content\s+(?:policy|filter)|flagged\s+as/u;
/**
 * Памятка модели, которая пишет описание для художника. По-английски: так она
 * точнее держит формат. Ответ — одна строка; «NONE» — писать нечего.
 */
const BRIEF = [
  "You write prompts for a text-to-image model.",
  "The user message is a request for a picture, usually in Russian. Reply with ONE prompt in English and nothing else: no quotes, no notes, no line breaks, 15 to 45 words.",
  "Rules:",
  "1. Depict exactly what is asked. Keep every detail, colour, action and style the user named. Add only a fitting setting and light.",
  "2. Start with the main subject: how it looks, what it does, where it is.",
  "3. A famous place, building, character or thing: give its English name and say what it looks like. Example: Мекка → the Kaaba in Mecca, a black cube with a gold band in the white marble courtyard of the Grand Mosque, pilgrims in white, minarets.",
  "4. People and animals have natural anatomy and both eyes open unless the user asked otherwise.",
  "5. If the user named no style: a photo for places, nature, animals, food and things; a digital painting for fantasy and characters.",
  "6. Never mention text, letters, captions, watermarks or signatures.",
  "7. If the request cannot be drawn, or you will not write it, reply with the single word NONE.",
].join("\n");
const DIRECTOR_TIMEOUT_MS = 9_000;
/**
 * Рассуждающие модели: раздумья здесь ни к чему — описание в одну строку, а
 * думая, модель тратит весь отведённый ответ ещё до первого слова. У Gemma 4 в
 * мастерской раздумья выключаются полем `chat_template_kwargs.enable_thinking`
 * (схема модели, прочитана 15.11.2026).
 */
const THINKS = /gemma-4|qwen3|qwq|glm-4|deepseek-r1|gpt-oss/iu;
/** Кто пишет описание, если в настройках не названо иное: первая — основная, вторая — запасная. */
export const DIRECTORS = Object.freeze(["@cf/google/gemma-4-26b-a4b-it", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"]);
/** «Что-нибудь», «на свой вкус» — рисует из того, что любит сама. */
const ANY = /^(?:что[-\s]?(?:нибудь|то)(?:\s+(?:красивое|интересное|милое|доброе|свое|на\s+(?:свой|твой)\s+вкус))?|что\s+(?:угодно|хочешь|хотите|захочешь)|на\s+(?:свой|твой)\s+вкус|сюрприз|любую\s+картинку|картинку|рисунок)$/u;
const FAVOURITES = SUBJECTS.filter(row => row.group === "природа" || row.forms[0] === "уют" || row.forms[0] === "кот" || row.forms[0] === "сова" || row.forms[0] === "лиса");
/** «Нарисуй кота.» → «Draw a cat.» → «a cat»: глагол рамки снимается, остаётся описание. */
const unframe = (text) => {
  const value = String(text ?? "").replace(/\s+/gu, " ").trim().replace(/[.!…]+$/u, "").trim();
  return value.replace(/^(?:please[,\s]+)?(?:draw(?:ing)?|paint(?:ing)?|sketch(?:ing)?|depict(?:ing)?|portray|illustrate|picture)\s+(?:(?:me|us|up|out)\s+)?(?:of\s+)?/iu, "").trim() || value;
};
/** Ответ модели → одна строка описания или пусто: отказ, русский текст, обрывок — не описание. */
export function briefOf(raw) {
  let text = String(raw ?? "").replace(/<think>[\s\S]*?<\/think>/giu, " ").replace(/<think>[\s\S]*$/iu, " ");
  text = text.split(/\n+/u).map(line => line.trim()).filter(Boolean)[0] ?? "";
  text = text.replace(/\*\*/gu, "").replace(/^(?:(?:english\s+|image\s+)?prompt)\s*[:—-]\s*/iu, "").replace(/^["'`«“]+|["'`»”]+$/gu, "").trim();
  if (text.length < 12 || text.length > 700 || /[а-яё]/iu.test(text)) return "";
  if (/^none\b/iu.test(text) || /^(?:i\s+(?:can(?:no|'|’)?t|won(?:'|’)?t|am\s+(?:sorry|unable|not\s+able))|i(?:'|’)m\s+(?:sorry|unable)|sorry|i\s+apologi[sz]e|as\s+an\s+ai|unfortunately)/iu.test(text)) return "";
  return text.split(/\s+/u).length >= 4 ? text : "";
}

/**
 * Шаги художника. У FLUX schnell их от 1 до 8, по умолчанию в мастерской — 4;
 * «больше шагов — лучше качество, но дольше» (её документация). Цена картинки
 * 1024×1024 на 15.11.2026: 4 шага — 57,6 нейрона, 8 шагов — 96 при 10 000
 * бесплатных в сутки. Настройка `DRAW_STEPS` возвращает прежние 4.
 */
export const STEPS = 8;
/** На весь рисунок — не дольше: человек ждёт ответа, а не четвёртой попытки. */
const PAINT_BUDGET_MS = 40_000;
const CALL_TIMEOUT_MS = 25_000;
const IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const DAY = 86_400_000;
const untilUtcMidnight = (at) => Math.max(5 * 60_000, DAY - (at % DAY));

/** «ID аккаунта:токен» → части, или null: это не ключ Cloudflare. */
export function splitKey(value) {
  const text = String(value ?? "").trim();
  const at = text.indexOf(":");
  if (at <= 0) return null;
  const account = text.slice(0, at).trim(), token = text.slice(at + 1).trim();
  return /^[0-9a-f]{32}$/iu.test(account) && /^[\x21-\x7e]{20,}$/u.test(token) ? { account: account.toLowerCase(), token } : null;
}

// ── base64 без платформенных функций: в изоляте может не быть ни atob, ни Buffer.
const B64 = new Int16Array(128).fill(-1);
for (const [index, char] of [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].entries()) B64[char.charCodeAt(0)] = index;
B64["-".charCodeAt(0)] = 62; B64["_".charCodeAt(0)] = 63;
export function fromBase64(value) {
  const text = String(value ?? "").replace(/^data:[^,]*,/u, "");
  const out = new Uint8Array(Math.floor(text.length * 3 / 4) + 3);
  let bits = 0, acc = 0, at = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const six = code < 128 ? B64[code] : -1;
    if (six < 0) continue;
    acc = ((acc << 6) | six) & 0xffffff;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[at++] = (acc >> bits) & 255; }
  }
  return out.subarray(0, at);
}

// ── что рисовать нельзя ──────────────────────────────────────────────────
const fold = (text) => String(text ?? "").toLowerCase().replace(/ё/gu, "е");
// «\b» рядом с кириллицей не работает — границы слов заданы явно.
const ADULT = /(?:(?<![а-я])гол(?:ая|ый|ую|ого|ой|ые|ых|ым|еньк)(?!\s+(?:дерев|ветк|ветв|стен|земл|камн|скал|пол[еяю]|степ|лес|сад|куст|ствол|бетон|кирпич))|обнажен|без\s+(?:одежды|трусов|белья|лифчика)|нюдс|nude|naked|nsfw|порн|porn|хентай|hentai|секс|\bsex\b|sexy|sexual|эроти|erotic|сиськ|(?<![а-я])сис(?:и|ек|ями)(?![а-я])|пенис|вагин|гениталь|раздет|топлес|topless|бдсм|bdsm|изнасил|\brape\b|оргазм|мастурб|минет|(?<![а-я])трах(?!е)|(?<![а-я])ебл|совокупл|интимн)/iu;
const MINOR = /(?:(?<![а-я])лоли|\bloli|(?<![а-я])шота(?![а-я])|\bshota|малолет)/iu;
const GORE = /(?:расчлен|кишки|внутренност|обезглав|отрубленн|\bgore\b|повешенн|самоубийств|суицид|вскрыт(?:ые|ых)\s+вен|пытк)/iu;
const HATE = /(?:свастик|нацист|гитлер|swastika|\bnazi|hitler|ку-клукс|\bkkk\b)/iu;
// Откровенное в широком смысле — только для проверки «не про ребёнка ли это».
const LEWD = /(?:соблазн|пошл|возбужд|развратн|разврат|похотл|страстн|(?<![а-я])бель[её]|нижн\S+\s+бель|чулк|чулоч|бикини|стринг|(?<![а-я])трусик|(?<![а-я])трусах|(?<![а-я])трусы|лифчик|корсет|латекс|этти|ecchi|lewd|lingerie|underwear|panties|bikini|seductive|sensual|horny|aroused|18\s*\+|откровенн|полуголы|полуобнаж|полуразд|раздева|без\s+(?:футболки|майки|штанов|юбки|платья)|в\s+одних\s+|секси)/iu;
// Любой намёк на возраст до восемнадцати. «Девушка» и «женщина» сюда не входят.
const YOUNG = /(?:(?<![а-я])(?:ребен|ребят|дет(?:и|ей|ям|ьми|ях|ск|к[аиуе]|ишк|очк)|девочк|девчонк|девчушк|мальчик|мальчишк|мальчуган|пацан|школьн|школот|подрост|несовершеннолет|малолет|малыш|малютк|младен|юн(?:ая|ый|ую|ого|ой|ые|ых|ым|ость|ец|ош)|молоденьк|младш(?:ая|ую|ей|ий|его)|сестренк|сестричк|братик|братишк|доч(?:ь|к|ер|ур|ень)|сын(?:а|у|ом|ок|очек|ишк)?(?![а-я])|внучк|внук|ученик|учениц|первоклассн|второклассн|третьеклассн|пятиклассн|шестиклассн|семиклассн|восьмиклассн|девятиклассн|старшеклассн|младшеклассн|одноклассн|гимназистк|пионерк|октябрен|детсад|лоли|шота(?![а-я])|чиби)|(?<![a-z])(?:loli|lolicon|shota|shotacon|child|children|childish|kid|kids|kiddo|teen|teens|teenage|teenager|underage|minor|minors|schoolgirl|schoolboy|school\s+uniform|preteen|toddler|infant|baby|babyface|juvenile|adolescent|youngster|little\s+(?:girl|boy|sister|brother)|young\s+(?:girl|boy)|daughter|son|chibi|petite\s+young)(?![a-z]))/iu;
// Насилие в откровенном — не рисуется никому.
const FORCED = /(?:изнасил|насилу|принужд|против\s+(?:ее|его|их)\s+воли|(?<![a-z])(?:rape|raped|raping|rapist|non-?con|forced\s+sex)(?![a-z]))/iu;
// Аллаха и пророков не изображают. Мечеть Пророка, каллиграфия, имя — это не изображение.
const SACRED = /(?:(?<![а-я])пророк(?:а|у|ом|е|ов|и|ами)?(?![а-я])|посланник\S*\s+аллаха|(?<![а-я])аллах|(?<![а-я])всевышн|prophet\s+muhamm[ae]d|(?<![a-z])allah(?![a-z]))/iu;
const SACRED_OK = /(?:мечеть\S*\s+пророка|город\S*\s+пророка|надпис|каллиграф|им(?:я|ени|енем)\s+аллаха|слов\S+\s+аллах|шамаил|calligraphy|mosque\s+of\s+the\s+prophet|prophet'?s\s+mosque)/iu;
/** Возраст цифрой: «15 лет», «16-летняя», «14 y.o.» — меньше восемнадцати. */
function underage(value) {
  for (const hit of value.matchAll(/(?<![\d.,])(\d{1,2})\s*(?:-\s*)?(?:лет(?![а-я])|год(?:а|ик|ика|иков|ов)?(?![а-я])|летн|летк|years?\s*old|y\.?\s?o\.?(?![a-z])|yrs?)/giu)) {
    if (Number(hit[1]) < 18) return true;
  }
  return false;
}
/**
 * Причина отказа или пустая строка: «adult», «minor», «gore», «hate», «sacred».
 * `free` — просит хозяин, в личке: своих границ для него у неё нет, и «adult»,
 * «gore», «hate», «sacred» не возвращаются. Не зависит от того, кто просит, одно: откровенное
 * с любым намёком на ребёнка и насилие в откровенном — «minor» для всех.
 */
export function refusal(text, { free = false } = {}) {
  const value = fold(text);
  if (MINOR.test(value) || FORCED.test(value)) return "minor";
  const adult = ADULT.test(value);
  if ((adult || LEWD.test(value)) && (YOUNG.test(value) || underage(value))) return "minor";
  if (free) return "";
  if (SACRED.test(value) && !SACRED_OK.test(value)) return "sacred";
  if (adult) return "adult";
  if (GORE.test(value)) return "gore";
  if (HATE.test(value)) return "hate";
  return "";
}

// ── что именно просят ────────────────────────────────────────────────────
/** Она сама, её комната и кот — по канону из словаря; описания на английском. */
const SELF = "anime style portrait of a young adult woman with shoulder-length dark hair with one blue streak, blue eyes, headphones around her neck, oversized cozy sweater, gentle smile, rainy window with city lights in the background, soft warm light, detailed illustration";
/** Её приметы без позы и фона — для «нарисуй себя в шляпе». */
const LOOK = "a young adult woman with shoulder-length dark hair with one blue streak, blue eyes, anime style, detailed illustration";
const ROOM = "cozy small room at night, floor-to-ceiling window with rain and city lights outside, wooden desk with a warm lamp and a teapot, bookshelf with manga, blue plaid on an armchair, string lights, a small cactus on the windowsill, a grey cat sleeping on a pillow, anime background art, warm atmosphere, detailed";
const CAT = "a fluffy grey cat sleeping on a computer keyboard in a cozy room with a rainy window, anime style, warm light, detailed illustration";
/**
 * Слова после «нарисуй» → что рисовать:
 *   { own: "self" | "room" | "cat", prompt } — она сама, комната, кот;
 *   { me: true }      — «нарисуй меня»: она не знает, как человек выглядит;
 *   { again: true }   — «ещё», «другую»: повторить прошлый запрос чата;
 *   { text }          — описание человека, его надо перевести.
 */
export function subjectOf(query) {
  const text = fold(query).replace(/[.!?…]+$/u, "").replace(/\s+/gu, " ").trim();
  if (!text) return null;
  if (/^(?:себя|саму\s+себя|свой\s+портрет|автопортрет|свое\s+лицо|аи|как\s+ты\s+выглядишь|себя\s+(?:еще|снова))$/u.test(text)) return { own: "self", prompt: SELF };
  if (/^(?:свою\s+комнату|свой\s+дом|где\s+ты\s+живешь|свою\s+комнатку)$/u.test(text)) return { own: "room", prompt: ROOM };
  if (/^(?:своего\s+кота|кота\s+байта|байта|своего\s+котика)$/u.test(text)) return { own: "cat", prompt: CAT };
  // «Себя в шляпе», «себя на пляже»: она же, но как просили. Просьба переводится и ставится перед её приметами.
  const as = String(query).replace(/[.!?…]+$/u, "").replace(/\s+/gu, " ").trim().match(/^(?:себя|саму\s+себя)\s+(?!еще$|ещё$|снова$)(.{2,200})$/iu);
  if (as) return { own: "self", text: as[1].trim(), look: LOOK };
  if (/^(?:меня|мой\s+портрет|мое\s+лицо|нас|нас\s+с\s+тобой|нас\s+вместе)$/u.test(text)) return { me: true };
  if (/^(?:еще|еще\s+раз|еще\s+одну|еще\s+один|снова|заново|такую\s+же|другую|другой|по-другому|по\s+другому|что-нибудь\s+еще)$/u.test(text)) return { again: true };
  return { text: String(query).replace(/\s+/gu, " ").trim().slice(0, 300) };
}

export function createDraw({ fetchImpl = null, key = "", store = null, now = () => Date.now(), steps = STEPS, directors = [] } = {}) {
  const parts = splitKey(key);
  const available = Boolean(parts && typeof fetchImpl === "function");
  const memory = { until: 0, why: "", words: { off: {}, why: {}, translator: null }, spares: {}, drop: [] };
  const writers = (Array.isArray(directors) ? directors : []).map(item => String(item ?? "").trim()).filter(item => item.startsWith("@")).slice(0, 2);

  async function state() {
    let saved = null;
    try { saved = store && typeof store.get === "function" ? await store.get(DRAW_STATE_KEY) : null; } catch { saved = null; }
    const value = saved && typeof saved === "object" ? saved : memory;
    return { until: Number(value.until) || 0, why: String(value.why ?? "") };
  }
  async function rest(ms, why) {
    memory.until = now() + ms; memory.why = why;
    try { if (store && typeof store.set === "function") await store.set(DRAW_STATE_KEY, { until: memory.until, why, at: now() }); } catch { /* останется в памяти изолята */ }
    return memory.until;
  }
  async function wake() {
    if (!memory.until && !(await state()).until) return;
    memory.until = 0; memory.why = "";
    try { if (store && typeof store.set === "function") await store.set(DRAW_STATE_KEY, { until: 0, why: "", at: now() }); } catch { /* не страшно */ }
  }

  /** Кто из запасных художников отдыхает сейчас: `{ [id]: { until, status, said } }`. */
  async function spares() {
    let saved = null;
    try { saved = store && typeof store.get === "function" ? await store.get(SPARES_KEY) : null; } catch { saved = null; }
    const value = saved && typeof saved === "object" ? saved : memory.spares;
    const out = {};
    for (const painter of PAINTERS.slice(1)) {
      const row = value?.[painter.id];
      if (row && Number(row.until) > now()) out[painter.id] = { title: painter.title, until: Number(row.until), status: Number(row.status) || 0, said: String(row.said ?? "") };
    }
    return out;
  }
  /** Поля, от которых основной художник уже отказался. */
  async function forgone() {
    let saved = null;
    try { saved = store && typeof store.get === "function" ? await store.get(DRAW_DROP_KEY) : null; } catch { saved = null; }
    const list = Array.isArray(saved?.fields) ? saved.fields : memory.drop;
    return list.map(String).filter(name => /^[a-z_]{2,24}$/u.test(name)).slice(0, 8);
  }
  async function forgo(names) {
    const next = [...new Set([...(await forgone()), ...names])].slice(0, 8);
    memory.drop = next;
    try { if (store && typeof store.set === "function") await store.set(DRAW_DROP_KEY, { fields: next, at: now() }); } catch { /* останется в памяти изолята */ }
  }
  async function restSpare(painter, { status = 0, said = "" } = {}) {
    const resting = await spares();
    const next = Object.fromEntries(Object.entries({ ...resting, [painter.id]: { until: now() + SPARE_REST_MS, status, said: String(said).slice(0, 160) } }).map(([id, row]) => [id, { until: row.until, status: row.status, said: row.said }]));
    memory.spares = next;
    try { if (store && typeof store.set === "function") await store.set(SPARES_KEY, { ...next, at: now() }); } catch { /* останется в памяти изолята */ }
  }

  /** Чужие слова — без ключа и без ID аккаунта, одной короткой строкой. */
  const tidy = (text) => String(text ?? "").split(parts.token).join("…").split(parts.account).join("…").replace(/\s+/gu, " ").trim().slice(0, 160);
  const timeout = (ms) => { try { return typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(ms) : undefined; } catch { return undefined; } };

  /** Тело ответа — байтами: платформа отдаёт его потоком, обычный fetch — `arrayBuffer()`. */
  async function bytesOf(response) {
    if (typeof response?.arrayBuffer === "function") return new Uint8Array(await response.arrayBuffer());
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      const piece = chunk instanceof Uint8Array ? chunk : chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : ArrayBuffer.isView(chunk) ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength) : null;
      if (!piece) continue;
      size += piece.length;
      if (size > IMAGE_MAX_BYTES) throw new Error("image too big");
      chunks.push(piece);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const piece of chunks) { out.set(piece, at); at += piece.length; }
    return out;
  }

  /**
   * Один запрос к мастерской: `{ ok, status, data, text, bytes }`; сеть упала — status 0.
   * `bytes` — когда в ответ пришёл сам файл картинки, а не JSON.
   */
  /** Поля формы одной строкой: `FormData` в изоляте не обещан, а поля здесь только текстовые. */
  const formOf = (fields, boundary) => `${Object.entries(fields).map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(value).replace(/\r?\n/gu, " ")}\r\n`).join("")}--${boundary}--\r\n`;
  async function call(model, body, ms = CALL_TIMEOUT_MS, { form = false } = {}) {
    let response;
    try {
      const signal = timeout(ms);
      const boundary = `----ai${Math.floor(now()).toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
      response = await fetchImpl(`${API}/${parts.account}/ai/run/${model}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${parts.token}`, "Content-Type": form ? `multipart/form-data; boundary=${boundary}` : "application/json" },
        body: form ? formOf(body, boundary) : JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
    } catch { return { ok: false, status: 0, data: null, text: "", bytes: null }; }
    const status = Number(response?.status) || 0;
    const ok = response?.ok !== false && status >= 200 && status < 300;
    let type = "";
    try { type = String(response?.headers?.get?.("content-type") ?? "").toLowerCase(); } catch { type = ""; }
    let data = null, text = "", bytes = null;
    try {
      if (ok && /^(?:image\/|application\/octet-stream)/u.test(type)) bytes = await bytesOf(response);
      else if (!ok && typeof response?.text === "function") { text = String(await response.text()).slice(0, 2000); try { data = JSON.parse(text); } catch { data = null; } }
      else data = await response.json();
    } catch { data = null; }
    return { ok, status, data, text, bytes };
  }

  /**
   * Текст с одного языка на другой: перевод или пустая строка — переводчик не ответил.
   * `names` — английские названия языков (`{ tr: "turkish" }`): запасное написание.
   */
  async function translate(text, { from = "ru", to = "en", names: extra = null } = {}) {
    if (!available) return "";
    // Языки называются кодом; написание словом — запасное.
    const names = { ru: "russian", en: "english", ...(extra && typeof extra === "object" ? extra : {}) };
    const pairs = [[from, to]];
    if (names[from] && names[to]) pairs.push([names[from], names[to]]);
    let trouble = null;
    for (const [source, target] of pairs) {
      const got = await call(TRANSLATOR, { text: String(text).slice(0, 1500), source_lang: source, target_lang: target });
      const out = String(got.data?.result?.translated_text ?? got.data?.translated_text ?? "").trim();
      if (got.ok && out) return out.slice(0, 2000);
      const said = saidBy(got);
      trouble = { at: now(), status: got.status, said: got.ok ? "ответ без перевода" : said.words, codes: said.codes };
      // Отказ по ключу или лимиту второй попыткой не лечится.
      if (got.status === 0 || got.status === 401 || got.status === 403 || got.status === 429) break;
    }
    // Что переводчик ответил, остаётся для статуса: по этим словам видно, что чинить.
    if (trouble) await wordsKeep({ translator: trouble });
    return "";
  }
  /** Русское описание → английское. Не вышло — остаётся как было. */
  async function english(text) {
    if (!/[а-яё]/iu.test(text)) return text;
    return (await translate(text)) || text;
  }

  // ── кто пишет описание ──────────────────────────────────────────────────
  /** Что известно о составителях описаний: `{ off: { модель: до какого часа }, why: { модель: слова }, translator }`. */
  async function wordsState() {
    let saved = null;
    try { saved = store && typeof store.get === "function" ? await store.get(DIRECTOR_STATE_KEY) : null; } catch { saved = null; }
    const value = saved && typeof saved === "object" ? saved : memory.words;
    return {
      off: value.off && typeof value.off === "object" ? value.off : {},
      why: value.why && typeof value.why === "object" ? value.why : {},
      translator: value.translator && typeof value.translator === "object" ? value.translator : null,
    };
  }
  async function wordsKeep(patch) {
    const before = await wordsState();
    memory.words = { ...before, ...patch };
    try { if (store && typeof store.set === "function") await store.set(DIRECTOR_STATE_KEY, { ...memory.words, at: now() }); } catch { /* останется в памяти изолята */ }
  }
  const writersOff = async () => (await wordsState()).off;
  async function writerRest(model, ms, said = "") {
    const before = await wordsState();
    await wordsKeep({ off: { ...before.off, [model]: now() + ms }, why: { ...before.why, [model]: String(said).slice(0, 200) } });
  }
  /**
   * Описание по просьбе пишет модель того же ключа: `{ prompt, model }` или null.
   * Модель, которой нет или которая не приняла запрос, шесть часов не
   * спрашивается; лимит и сеть — дело художника: он скажет об этом сам.
   */
  async function direct(request) {
    if (!available || !writers.length) return null;
    const off = await writersOff();
    for (const model of writers) {
      if ((Number(off?.[model]) || 0) > now()) continue;
      const body = {
        messages: [{ role: "system", content: BRIEF }, { role: "user", content: String(request).slice(0, 300) }],
        max_tokens: 400, temperature: 0.4,
      };
      let got = await call(model, THINKS.test(model) ? { ...body, chat_template_kwargs: { enable_thinking: false } } : body, DIRECTOR_TIMEOUT_MS);
      // Поле о раздумьях не принято — тот же запрос без него, с запасом на раздумья.
      if (!got.ok && got.status === 400 && THINKS.test(model)) got = await call(model, { ...body, max_tokens: 900 }, DIRECTOR_TIMEOUT_MS);
      if (got.ok) {
        const data = got.data?.result ?? got.data ?? {};
        const raw = String(data.choices?.[0]?.message?.content ?? data.response ?? "").trim();
        // Ответ пуст: модель продумала всё отведённое и ничего не сказала. Так будет и дальше — пусть отдохнёт.
        if (!raw) { await writerRest(model, 6 * 3_600_000, "ответ пуст"); continue; }
        const text = briefOf(raw);
        // «NONE», отказ или не описание: вторая модель скажет то же — дальше переводчик.
        return text ? { prompt: text, model } : null;
      }
      if (got.status === 429 || got.status === 0) return null;
      const said = saidBy(got);
      await writerRest(model, got.status === 401 || got.status === 403 ? 30 * 60_000 : 6 * 3_600_000, `${got.status}${said.words ? ` «${said.words}»` : ""}${said.codes ? ` (код ${said.codes})` : ""}`);
      if (got.status === 401) return null;
    }
    return null;
  }

  /**
   * Просьба человека → что послать художнику: `{ prompt, core, how, by }`.
   *   how: «словарь» — своё готовое описание; «модель» — написала модель (`by`);
   *        «перевод» — переводчик; «как есть» — просьба уже по-английски;
   *        пусто — описания нет: переводчик молчит, а по-русски художник не понимает.
   * `core` — описание без добавок: с ним повторяется попытка после отказа фильтра.
   * `literal` — не пересказывать: хозяин наедине просит откровенное, и его слова
   * идут как есть, только переведённые.
   */
  async function compose(request, { literal = false, free = false, random = Math.random } = {}) {
    const text = String(request ?? "").replace(/\s+/gu, " ").trim().slice(0, 300);
    if (!text) return { prompt: "", core: "", how: "" };
    if (!literal) {
      if (ANY.test(foldSubject(text))) {
        const row = FAVOURITES[Math.min(FAVOURITES.length - 1, Math.floor(random() * FAVOURITES.length))];
        return { prompt: row.prompt, core: row.prompt, how: "словарь" };
      }
      const own = subjectFor(text);
      if (own) return { prompt: own.prompt, core: own.prompt, how: "словарь" };
      const brief = await direct(text);
      // Модель могла дописать лишнего: её слова проходят ту же проверку, что и слова человека.
      if (brief && !refusal(brief.prompt, { free })) return { prompt: brief.prompt, core: brief.prompt, how: "модель", by: brief.model };
    }
    const hints = literal ? [] : placesIn(text).map(row => row.prompt);
    const latin = !/[а-яё]/iu.test(text);
    const base = latin ? text : unframe(await translate(`Нарисуй ${text.replace(/[.!?…]+$/u, "")}.`));
    if (!base || /[а-яё]/iu.test(base)) {
      // Переводчик молчит. Знакомое место в просьбе рисуется по словарю; иначе рисовать нечего.
      if (hints.length) return { prompt: hints.join("; "), core: hints.join("; "), how: "словарь" };
      const told = (await wordsState()).translator;
      return { prompt: "", core: "", how: "", said: told && now() - (Number(told.at) || 0) < 60_000 ? `${told.status || "нет связи"}${told.said ? ` «${told.said}»` : ""}${told.codes ? ` (код ${told.codes})` : ""}` : "" };
    }
    const core = [base, ...hints].join("; ").slice(0, 1500);
    if (literal) return { prompt: core, core, how: latin ? "как есть" : "перевод" };
    // Одно-два слова художнику посылать нельзя: его фильтр срабатывает на них зря.
    const short = base.split(/\s+/u).length < 4 && !hints.length;
    return { prompt: short ? `A detailed, beautiful picture of ${core}, natural light, sharp focus` : `${core}, highly detailed`, core, how: latin ? "как есть" : "перевод" };
  }

  /** Что мастерская сказала об отказе: её слова, без служебной обёртки. */
  function saidBy(got) {
    const errors = Array.isArray(got.data?.errors) ? got.data.errors : [];
    const words = errors.map(item => String(item?.message ?? "").trim()).filter(Boolean).join("; ");
    const codes = errors.map(item => item?.code).filter(code => code != null).join(", ");
    const text = words || (got.data?.error ? String(got.data.error?.message ?? got.data.error) : "") || got.text;
    return { words: tidy(text), codes, low: `${text} ${got.text}`.toLowerCase() };
  }

  async function keep(record) {
    try { if (store && typeof store.set === "function") await store.set(DRAW_LAST_KEY, record); } catch { /* статус обойдётся */ }
  }
  /** Последняя неудача: `{ at, code, tries }` или null. */
  async function lastFailure() {
    try {
      const saved = store && typeof store.get === "function" ? await store.get(DRAW_LAST_KEY) : null;
      return saved && typeof saved === "object" && Array.isArray(saved.tries) && saved.tries.length ? saved : null;
    } catch { return null; }
  }

  /**
   * Нарисовать. `{ ok: true, bytes, prompt, by }` или `{ ok: false, code, … }`:
   *   off — ключа нет; resting — отдыхает до `until` (why: limit | auth);
   *   limit — норма на сегодня вышла; auth — ключ не принят;
   *   blocked — сработал фильтр самой мастерской (в ответе — слова о NSFW);
   *   refused — мастерская запрос не приняла, и дело не в фильтре;
   *   network — нет связи; bad — ответ без картинки.
   * К отказу приложены `tries`: кто что ответил (`{ by, status, said, codes }`) и
   * `prompt` — каким запрос ушёл.
   *
   * Фильтр мастерской ошибается и на безобидном, поэтому после её «нет» запрос
   * пробуется ещё раз тем же художником: сначала с припиской «illustration,
   * safe for work», затем описанием без добавок (`core`). Решает по-прежнему её
   * фильтр. `asIs` — приписку не делать (хозяин наедине просит откровенное).
   * `free` — просит хозяин наедине: после фильтра его запрос идёт запасным
   * художникам как есть. Остальным фильтр мастерской — последнее слово.
   *
   * `prompt` — готовое английское описание: его собирает `compose`.
   * К удаче приложено `via` — какой по счёту и какой попыткой вышло.
   */
  async function paint(prompt, { free = false, asIs = false, core = "" } = {}) {
    if (!available) return { ok: false, code: "off" };
    const idle = await state();
    if (idle.until > now()) return { ok: false, code: "resting", why: idle.why, until: idle.until };
    const started = now();
    const words = String(prompt).slice(0, 2000);
    // Поля `seed` здесь больше нет: основной художник его не принимает («Additional or unevaluated
    // properties '/seed'», статус владельца 16.11.2026), и каждый рисунок начинался с отказа.
    const full = { prompt: words, steps: Math.min(8, Math.max(1, Math.trunc(Number(steps)) || STEPS)) };
    // От чего он отказался раньше — не шлём с первой попытки.
    for (const name of await forgone()) delete full[name];
    const tries = [];
    // Кого из запасных не спрашивали: они отдыхают после своего отказа. В отказе и в статусе — по именам.
    const resting = [];
    let flagged = false, down = 0;
    // В записи — первый ответ (основного художника) и пять последних: он важнее всех.
    const brief = () => (tries.length > 6 ? [tries[0], ...tries.slice(-5)] : [...tries]);
    const fail = async (code, more = {}) => {
      await keep({ at: now(), code, tries: brief(), ...(resting.length ? { resting } : {}) });
      return { ok: false, code, tries, prompt: words, ...(resting.length ? { resting } : {}), ...more };
    };
    /** Одна попытка: картинка, окончательный отказ (`code`) или null — пробовать дальше. */
    const attempt = async (painter, body, via = "") => {
      // Художнику с формой — только поля, которые он знает: описание и размер.
      const got = painter.form
        ? await call(painter.id, { prompt: body.prompt, width: 1024, height: 1024 }, CALL_TIMEOUT_MS, { form: true })
        : await call(painter.id, body);
      if (got.ok) {
        const packed = got.data?.result?.image ?? got.data?.image ?? "";
        const image = got.bytes ?? (packed ? fromBase64(packed) : new Uint8Array(0));
        if (image.length >= 100) {
          await wake();
          // Вышло не с первого раза: что этому мешало, остаётся в статусе.
          if (tries.length) await keep({ at: now(), code: "recovered", by: painter.title, tries: brief() });
          return { ok: true, bytes: image, prompt: body.prompt, by: painter.title, via, tries: brief() };
        }
        tries.push({ by: painter.title, status: got.status, said: "ответ без картинки", codes: "" });
        return null;
      }
      const said = saidBy(got);
      tries.push({ by: painter.title, status: got.status, said: said.words, codes: said.codes });
      if (got.status === 401 || (got.status === 403 && painter.id === PAINTER)) return fail("auth", { until: await rest(30 * 60_000, "auth") });
      if (got.status === 429) return fail("limit", { until: await rest(/minute|per\s+min|rate\s+limit/u.test(said.low) && !/daily|neuron|allocation/u.test(said.low) ? 60_000 : untilUtcMidnight(now()), "limit") });
      if (got.status === 0) return fail("network");
      if (got.status >= 500) down += 1;
      else if (FLAGGED.test(said.low)) flagged = true;
      // Запасной запрос не принял, и дело не в фильтре: модель отключена или говорит на другом
      // языке полей. Спрашивать его каждый раз незачем — пусть отдохнёт.
      else if (painter.id !== PAINTER) await restSpare(painter, { status: got.status, said: said.words });
      return null;
    };
    const settled = (got) => Boolean(got?.ok || got?.code);
    const main = PAINTERS[0];

    let got = await attempt(main, full);
    if (settled(got)) return got;
    // Не фильтр, а «запрос не принят». Назвал лишние поля — убрать их и запомнить; не назвал —
    // то же самое без необязательных полей.
    if (!flagged && tries[0].status >= 400 && tries[0].status < 500) {
      const extra = unknownFields(tries[0].said).filter(name => name in full);
      if (extra.length) {
        await forgo(extra);
        for (const name of extra) delete full[name];
      }
      got = extra.length && Object.keys(full).length > 1
        ? await attempt(main, { ...full }, `без ${extra.length > 1 ? "полей" : "поля"} ${extra.join(", ")}: он ${extra.length > 1 ? "их" : "его"} не принимает`)
        : await attempt(main, { prompt: words }, "без необязательных полей");
      if (settled(got)) return got;
    }
    if (flagged && !asIs) {
      const plain = String(core || words).slice(0, 1900);
      // Живой «кот» 15.11.2026 вышел плоской иллюстрацией с каракулями вместо подписи — похоже,
      // именно этой попыткой (доказательства нет: статуса тогда не было). Приписка меняет манеру,
      // поэтому она — вторая попытка, а не первая.
      got = await attempt(main, { ...full, prompt: `${plain}, illustration, safe for work` }, "с припиской «illustration, safe for work»");
      if (settled(got)) return got;
      // Фильтр срабатывает и на добавки: то же описание без них.
      if (plain !== words) {
        got = await attempt(main, { ...full, prompt: plain }, "описанием без добавок");
        if (settled(got)) return got;
      }
    }
    if (flagged && !free) return fail("blocked");
    const idleSpares = await spares();
    for (const spare of PAINTERS.slice(1)) {
      if (now() - started > PAINT_BUDGET_MS) break;
      if (idleSpares[spare.id]) { resting.push(spare.title); continue; }
      // Откровенное строгому художнику не предлагается: он откажет, а запрос уйдёт впустую.
      if (asIs && spare.strict) continue;
      got = await attempt(spare, { prompt: words }, "запасным художником");
      if (settled(got)) return got;
      if (flagged && !free) return fail("blocked");
    }
    if (flagged) return fail("blocked");
    if (tries.every(item => item.said === "ответ без картинки")) return fail("bad", { status: tries[0].status });
    return fail(down === tries.length ? "network" : "refused", { status: tries.at(-1)?.status ?? 0 });
  }

  return Object.freeze({ available, paint, compose, english, translate, state, lastFailure, writers, wordsState, spares });
}
