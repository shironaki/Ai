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
 * Отказ мастерской разбирается, а не принимается на веру. Раньше любой ответ
 * 400 со словами вроде «not allowed» считался её фильтром, и на «нарисуй кота»
 * человек слышал про фильтр, хотя причина могла быть в самом запросе. Теперь:
 * фильтр — это только слова о NSFW в ответе; всё остальное 400 — «запрос не
 * принят», и тогда пробуется тело попроще и запасные художники. Что ответила
 * мастерская, запоминается дословно: хозяин видит это в ответе и в статусе.
 */

export const DRAW_STATE_KEY = "heart:draw:v1";
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
 * запрос не принял. Запасные отдают картинку файлом, а не строкой base64, и
 * понимают только `prompt`: лишних полей им не посылается.
 */
export const PAINTERS = Object.freeze([
  { id: PAINTER, title: "FLUX schnell" },
  { id: "@cf/bytedance/stable-diffusion-xl-lightning", title: "SDXL Lightning" },
  { id: "@cf/lykon/dreamshaper-8-lcm", title: "DreamShaper" },
  { id: "@cf/stabilityai/stable-diffusion-xl-base-1.0", title: "SDXL" },
]);
/** Последняя неудача рисования: что ответила мастерская. Для статуса. */
export const DRAW_LAST_KEY = "heart:draw:last";
/** Слова мастерской о своём фильтре. Только они — «blocked»; остальное 400 — не фильтр. */
const FLAGGED = /nsfw|not\s+safe\s+for\s+work|safety\s+(?:checker|filter|system)|content\s+(?:policy|filter)|flagged\s+as/u;
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
/** Возраст цифрой: «15 лет», «16-летняя», «14 y.o.» — меньше восемнадцати. */
function underage(value) {
  for (const hit of value.matchAll(/(?<![\d.,])(\d{1,2})\s*(?:-\s*)?(?:лет(?![а-я])|год(?:а|ик|ика|иков|ов)?(?![а-я])|летн|летк|years?\s*old|y\.?\s?o\.?(?![a-z])|yrs?)/giu)) {
    if (Number(hit[1]) < 18) return true;
  }
  return false;
}
/**
 * Причина отказа или пустая строка: «adult», «minor», «gore», «hate».
 * `free` — просит хозяин, в личке: своих границ для него у неё нет, и «adult»,
 * «gore», «hate» не возвращаются. Не зависит от того, кто просит, одно: откровенное
 * с любым намёком на ребёнка и насилие в откровенном — «minor» для всех.
 */
export function refusal(text, { free = false } = {}) {
  const value = fold(text);
  if (MINOR.test(value) || FORCED.test(value)) return "minor";
  const adult = ADULT.test(value);
  if ((adult || LEWD.test(value)) && (YOUNG.test(value) || underage(value))) return "minor";
  if (free) return "";
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

export function createDraw({ fetchImpl = null, key = "", store = null, now = () => Date.now(), steps = 4 } = {}) {
  const parts = splitKey(key);
  const available = Boolean(parts && typeof fetchImpl === "function");
  const memory = { until: 0, why: "" };

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
  async function call(model, body) {
    let response;
    try {
      const signal = timeout(CALL_TIMEOUT_MS);
      response = await fetchImpl(`${API}/${parts.account}/ai/run/${model}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${parts.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  /** Русское описание → английское. Не вышло — остаётся как было: модель поймёт хуже, но поймёт. */
  async function english(text) {
    if (!/[а-яё]/iu.test(text)) return text;
    for (const [from, to] of [["ru", "en"], ["russian", "english"]]) {
      const got = await call(TRANSLATOR, { text, source_lang: from, target_lang: to });
      const out = String(got.data?.result?.translated_text ?? got.data?.translated_text ?? "").trim();
      if (got.ok && out) return out.slice(0, 1000);
      // Отказ по ключу или лимиту второй попыткой не лечится.
      if (got.status === 0 || got.status === 401 || got.status === 403 || got.status === 429) break;
    }
    return text;
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
   * пробуется ещё раз тем же художником с припиской «без откровенного»: решает
   * по-прежнему её фильтр. `asIs` — приписку не делать (хозяин наедине просит
   * откровенное). `free` — просит хозяин наедине: после фильтра его запрос идёт
   * запасным художникам как есть. Остальным фильтр мастерской — последнее слово.
   */
  async function paint(prompt, { translate = true, seed = null, free = false, asIs = false } = {}) {
    if (!available) return { ok: false, code: "off" };
    const idle = await state();
    if (idle.until > now()) return { ok: false, code: "resting", why: idle.why, until: idle.until };
    const started = now();
    const words = (translate ? await english(String(prompt)) : String(prompt)).slice(0, 2000);
    const full = { prompt: words, steps: Math.min(8, Math.max(1, Number(steps) || 4)) };
    if (Number.isFinite(Number(seed)) && seed != null) full.seed = Number(seed);
    const tries = [];
    let flagged = false, down = 0;
    const fail = async (code, more = {}) => {
      await keep({ at: now(), code, tries: tries.slice(-6) });
      return { ok: false, code, tries, prompt: words, ...more };
    };
    /** Одна попытка: картинка, окончательный отказ (`code`) или null — пробовать дальше. */
    const attempt = async (painter, body) => {
      const got = await call(painter.id, body);
      if (got.ok) {
        const packed = got.data?.result?.image ?? got.data?.image ?? "";
        const image = got.bytes ?? (packed ? fromBase64(packed) : new Uint8Array(0));
        if (image.length >= 100) {
          await wake();
          // Вышло не с первого раза: что этому мешало, остаётся в статусе.
          if (tries.length) await keep({ at: now(), code: "recovered", by: painter.title, tries: tries.slice(-6) });
          return { ok: true, bytes: image, prompt: body.prompt, by: painter.title };
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
      return null;
    };
    const settled = (got) => Boolean(got?.ok || got?.code);
    const main = PAINTERS[0];

    let got = await attempt(main, full);
    if (settled(got)) return got;
    // Не фильтр, а «запрос не принят»: то же самое без необязательных полей.
    if (!flagged && tries[0].status >= 400 && tries[0].status < 500) {
      got = await attempt(main, { prompt: words });
      if (settled(got)) return got;
    }
    if (flagged && !asIs) {
      got = await attempt(main, { prompt: `${words}, illustration, safe for work`.slice(0, 2000) });
      if (settled(got)) return got;
    }
    if (flagged && !free) return fail("blocked");
    for (const spare of PAINTERS.slice(1)) {
      if (now() - started > PAINT_BUDGET_MS) break;
      got = await attempt(spare, { prompt: words });
      if (settled(got)) return got;
      if (flagged && !free) return fail("blocked");
    }
    if (flagged) return fail("blocked");
    if (tries.every(item => item.said === "ответ без картинки")) return fail("bad", { status: tries[0].status });
    return fail(down === tries.length ? "network" : "refused", { status: tries.at(-1)?.status ?? 0 });
  }

  return Object.freeze({ available, paint, english, state, lastFailure });
}
