/**
 * Манеры («акценты»): какой ей быть в разговоре с этим человеком.
 *
 * Человек выбирает сам — кнопкой или словом («будь кошкой»). Манера не меняет
 * того, что она говорит, а добавляет к сказанному: «мяу» в конце фразы,
 * «семпай» в обращении, «хмф» в начале. Поэтому она одинаково ложится и на
 * ответ модели, и на фразу из словаря, и модель на неё почти не тратится.
 *
 * Хозяину по умолчанию достаётся всё сразу: в каждом ответе — случайная смесь.
 * Слова манер лежат в словаре (PHRASES.txt, запасы «+манера:…»).
 */

/** [ключ, название, кнопка, как сказать «буду …», подсказка модели, запасы] */
export const ACCENTS = Object.freeze([
  { key: "plain", title: "обычная", button: "🙂 Обычная", done: "Хорошо, остаюсь собой — без добавок.", hint: "" },
  { key: "cat", title: "кошка", button: "🐱 Кошка", done: "Буду кошкой.", hint: "Манера по выбору собеседника — кошачья: игривая, можно мурлыкнуть.", tail: "+манера:кошка" },
  { key: "fox", title: "лисица", button: "🦊 Лисица", done: "Буду лисицей.", hint: "Манера по выбору собеседника — лисья: хитрая и ласковая.", tail: "+манера:лисица" },
  { key: "senpai", title: "кохай", button: "🎀 Семпай", done: "Буду звать семпаем.", hint: "Манера по выбору собеседника — младшая подруга из аниме: зови его «семпай».", address: "+манера:семпай" },
  { key: "tsundere", title: "цундере", button: "💢 Цундере", done: "Ладно уж, буду цундере.", hint: "Манера по выбору собеседника — цундере: колкая снаружи, заботливая по сути. Помощь при этом настоящая.", head: "+манера:цундере:начало", end: "+манера:цундере:конец" },
  { key: "cute", title: "милашка", button: "🌸 Милашка", done: "Буду милашкой.", hint: "Манера по выбору собеседника — милая и восторженная.", mark: "+манера:милашка" },
  { key: "sister", title: "старшая сестра", button: "🌙 Старшая сестра", done: "Буду старшей сестрёнкой.", hint: "Манера по выбору собеседника — заботливая старшая сестра: мягко опекает и чуть поддразнивает.", head: "+манера:сестра:начало", end: "+манера:сестра:конец" },
  { key: "pirate", title: "пиратка", button: "🏴‍☠️ Пиратка", done: "Буду пираткой.", hint: "Манера по выбору собеседника — пиратка: морские словечки, собеседник — «капитан».", address: "+манера:капитан", head: "+манера:пиратка:начало", end: "+манера:пиратка:конец" },
  { key: "robot", title: "робот", button: "🤖 Робот", done: "Режим «робот» включён.", hint: "Манера по выбору собеседника — подчёркнуто механическая, с сухим юмором.", head: "+манера:робот:начало", end: "+манера:робот:конец" },
  { key: "strict", title: "строгая", button: "🧊 Строгая, без аниме", done: "Хорошо. Без смайлов, без аниме, по делу.", hint: "Манера по выбору собеседника — строгая и деловая: без смайлов и аниме-словечек, коротко и по сути.", strip: true, anime: false },
  { key: "master", title: "зову хозяином", button: "👑 Хозяин", done: "Буду звать вас хозяином.", hint: "", address: "+манера:хозяин", ownerOnly: true },
  { key: "mix", title: "всё сразу", button: "🎭 Всё сразу", done: "Буду всем сразу.", hint: "" },
]);
const BY_KEY = new Map(ACCENTS.map(item => [item.key, item]));
export const accentInfo = (key) => BY_KEY.get(key) ?? BY_KEY.get("plain");

/** Какая манера действует: выбранная, а без выбора — хозяину всё сразу, остальным обычная. */
export function accentOf(settings = {}, { owner = false } = {}) {
  const chosen = BY_KEY.get(settings?.accent);
  if (chosen && (!chosen.ownerOnly || owner)) return chosen.key;
  return owner ? "mix" : "plain";
}
/** Можно ли этому человеку аниме-гифки: «строгая» и слова «не люблю аниме» их выключают. */
export const likesAnime = (settings = {}, { owner = false } = {}) => settings?.anime !== false && accentInfo(accentOf(settings, { owner })).anime !== false;

const fold = (text) => String(text ?? "").toLowerCase().replace(/ё/gu, "е").replace(/[.!?…]+$/u, "").replace(/\s+/gu, " ").trim();
const NAMES = [
  ["plain", "обычн(?:ой|ая)|собой|сама\\s+собой|как\\s+(?:обычно|раньше|всегда)|нормальн(?:ой|ая)|без\\s+(?:манер|акцента|образа)"],
  ["cat", "кошк(?:ой|а|у)|кошечк(?:ой|а|у)|кис(?:ой|а)|неко|нэко|котик(?:ом)?"],
  ["fox", "лис(?:ой|а|у)|лисиц(?:ей|а|у)|лисичк(?:ой|а|у)|кицун[эе]"],
  ["senpai", "кохаем|кохай|кохайкой"],
  ["tsundere", "цундере|цундеркой|цундэрэ"],
  ["cute", "милашк(?:ой|а|у)|няш(?:ей|а|кой)|кавайн(?:ой|ая)|мил(?:ой|ая)"],
  ["sister", "старш(?:ей|ая)\\s+сестр(?:ой|а|енкой)|сестренк(?:ой|а)|онээ[\\s-]?сан|онее[\\s-]?сан"],
  ["pirate", "пиратк(?:ой|а|у)|пират(?:ом)?"],
  ["robot", "робот(?:ом)?|машин(?:ой|а)"],
  ["strict", "строг(?:ой|ая)|серьезн(?:ой|ая)|делов(?:ой|ая)|сух(?:ой|ая)"],
  ["mix", "вс(?:ем|е)\\s+сразу|вс(?:еми|е)\\s+сразу|смесью|по[\\s-]разному"],
].map(([key, body]) => [key, new RegExp(`^(?:${body})$`, "u")]);
const SHOW = /^(?:какой\s+ты\s+(?:можешь|умеешь)\s+быть|какой\s+мне\s+быть|какие\s+(?:у\s+тебя\s+)?(?:есть\s+)?(?:манеры|образы|личности|акценты|характеры)|(?:твои\s+)?(?:манеры|образы|личности|акценты)|(?:смени|поменяй|выбери|измени|выбрать|сменить)(?:те)?\s+(?:свою\s+|себе\s+)?(?:манеру|образ|личность|акцент|характер|стиль\s+общения)|(?:выбор|список)\s+(?:манер|образов|личностей)|стань\s+другой|будь\s+другой|какая\s+(?:у\s+тебя|сейчас)\s+манера)$/u;
const RANDOM = /^(?:(?:будь|стань|выбери)\s+)?(?:случайн(?:ой|ая|ую|о)|рандомн(?:ой|ая|ую|о)|люб(?:ой|ая|ую))(?:\s+(?:манер[ауы]|образ|личность))?$|^(?:удиви\s+меня|выбери\s+(?:манеру\s+|образ\s+)?сама|на\s+твой\s+вкус)$/u;
const NO_ANIME = /^(?:я\s+)?(?:не\s+люблю|ненавижу|терпеть\s+не\s+могу)\s+аниме$|^(?:мне\s+)?не\s+нравится\s+аниме$|^(?:давай\s+|можно\s+)?без\s+аниме(?:\s+гиф(?:ок|ки)?)?$|^не\s+(?:присылай|отправляй|шли|надо|нужно)\s+(?:мне\s+)?аниме(?:[\s-]гиф(?:ок|ки)?)?$|^убери\s+аниме(?:[\s-]гифки)?$/u;
const YES_ANIME = /^(?:я\s+)?(?:люблю|обожаю)\s+аниме$|^(?:можно|давай|верни)\s+(?:с\s+)?аниме(?:[\s-]гифк(?:и|ами))?$|^аниме\s+можно$|^мне\s+нравится\s+аниме$/u;

/**
 * Просьба о манере — или null.
 *   { show: true }       — показать выбор кнопками;
 *   { set: "cat" }       — выбрана словом: «будь кошкой», «говори как цундере»;
 *   { random: true }     — «случайная», «удиви меня»;
 *   { anime: false }     — «не люблю аниме»: гифки к действиям не слать.
 */
export function parseAccent(text) {
  const value = fold(text);
  if (!value || value.length > 60) return null;
  if (SHOW.test(value)) return { show: true };
  if (RANDOM.test(value)) return { random: true };
  if (NO_ANIME.test(value)) return { anime: false };
  if (YES_ANIME.test(value)) return { anime: true };
  const asked = value.match(/^(?:а\s+)?(?:будь|стань|побудь|говори\s+как|общайся\s+как|разговаривай\s+как|веди\s+себя\s+как|давай\s+ты\s+будешь|ты\s+теперь|включи\s+(?:режим|манеру|образ))\s+(?:со\s+мной\s+)?(?:моей\s+|мне\s+|просто\s+)?(.+?)(?:\s+со\s+мной)?$/u);
  if (!asked) return null;
  const name = asked[1].replace(/^(?:режим|манера|образ)\s+/u, "").trim();
  if (/^(?:зови|зов[ие]те)\b/u.test(name)) return null;
  if (/^(?:зв(?:ать|и)\s+(?:меня\s+)?)?семпа(?:й|ем)$/u.test(name)) return { set: "senpai" };
  for (const [key, pattern] of NAMES) if (pattern.test(name)) return { set: key };
  return null;
}

/** Случайная манера: любая, кроме обычной, строгой и «всего сразу». */
export function randomAccent({ owner = false, random = Math.random, except = "" } = {}) {
  const pool = ACCENTS.filter(item => !["plain", "strict", "mix"].includes(item.key) && (!item.ownerOnly || owner) && item.key !== except);
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))].key;
}

/** Кнопки выбора. Нажатие — «m:ключ». */
export function keyboard({ owner = false, current = "" } = {}) {
  const items = ACCENTS.filter(item => !item.ownerOnly || owner).map(item => ({ text: `${item.key === current ? "✓ " : ""}${item.button}`, callback_data: `m:${item.key}` }));
  items.push({ text: "🎲 Случайная", callback_data: "m:random" });
  const rows = [];
  for (let index = 0; index < items.length; index += 2) rows.push(items.slice(index, index + 2));
  return { inline_keyboard: rows };
}

// ── добавки к сказанному ──────────────────────────────────────────────────
const END = /[.!?…]+$/u;
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]+/gu;
/** Строка — речь, а не список, счёт или адрес: только к речи можно что-то добавить. */
const prose = (line) => line.trim().length > 0 && !/^\s*(?:[•\-–—*]|\d+[.)])\s/u.test(line) && !/[:;]$/u.test(line.trim()) && !/https?:\/\/|<[a-z/]/iu.test(line) && !/^[🎤🔮🎲🪙🎱🎵🎬]/u.test(line.trim());
const pickOf = (list, random) => (list.length ? list[Math.min(list.length - 1, Math.floor(random() * list.length))] : "");

/** «Привет.» + «мяу» → «Привет, мяу.» Знак в конце остаётся знаком. */
function withTail(sentence, word) {
  const body = sentence.replace(END, "");
  const punct = sentence.slice(body.length);
  if (!body.trim() || /[,:;—–(«"]$/u.test(body.trim()) || /[)»"*~♪]$/u.test(body.trim())) return sentence;
  return `${body}, ${word}${punct || "."}`;
}

/**
 * Наложить манеру на готовый ответ.
 * `pool(name)` — строки запаса из словаря; `random` — случай (в тестах — заданный).
 */
export function garnish(text, { accent = "plain", owner = false, pool = () => [], random = Math.random } = {}) {
  const source = String(text ?? "");
  const info = accentInfo(accent);
  if (!source.trim() || info.key === "plain") return source;
  if (info.strip) {
    const bare = source.replace(EMOJI, "").replace(/[ \t]+([.,!?])/gu, "$1").replace(/[ \t]{2,}/gu, " ").replace(/^[ \t]+|[ \t]+$/gmu, "");
    return bare.trim() ? bare : source;
  }
  if (source.length > 1500) return source;

  // «Всё сразу»: обращение и хвост берутся у разных манер, по случаю.
  let { address, tail, head, end, mark } = info;
  if (info.key === "mix") {
    address = random() < 0.7 ? (owner && random() < 0.65 ? "+манера:хозяин" : "+манера:семпай") : "";
    tail = random() < 0.6 ? (random() < 0.7 ? "+манера:кошка" : "+манера:лисица") : "";
    mark = random() < 0.25 ? "+манера:милашка" : "";
    if (!address && !tail && !mark) tail = "+манера:кошка";
    head = ""; end = "";
  }

  const lines = source.split("\n");
  const spoken = lines.map((line, index) => (prose(line) ? index : -1)).filter(index => index >= 0);
  if (!spoken.length) return source;
  const lower = source.toLowerCase();
  const sentencesOf = (line) => line.split(/(?<=[.!?…])\s+/u);
  const edit = (index, change) => { lines[index] = change(lines[index]); };

  if (address) {
    const word = pickOf(pool(address), random);
    // Уже сказано «хозяин» или «семпай» — второй раз не нужно.
    if (word && !pool(address).some(item => lower.includes(item.toLowerCase())) && !(owner && lower.includes("хозяин"))) {
      const first = spoken[0];
      const parts = sentencesOf(lines[first]);
      const at = parts[0].length <= 80 ? 0 : parts.length - 1;
      parts[at] = withTail(parts[at], word);
      edit(first, () => parts.join(" "));
    }
  }
  if (tail) {
    const words = pool(tail);
    if (words.length && !words.some(item => new RegExp(`(?:^|[^а-яё])${item}(?:$|[^а-яё])`, "iu").test(lower))) {
      const last = spoken.at(-1);
      let extra = 0;
      for (const index of spoken) {
        const parts = sentencesOf(lines[index]);
        for (let at = 0; at < parts.length; at += 1) {
          const final = index === last && at === parts.length - 1;
          if (final || (extra < 2 && random() < 0.3)) { parts[at] = withTail(parts[at], pickOf(words, random)); if (!final) extra += 1; }
        }
        edit(index, () => parts.join(" "));
      }
    }
  }
  if (head || end) {
    const starts = head ? pool(head) : [], ends = end ? pool(end) : [];
    const already = [...starts, ...ends].some(item => lower.includes(item.toLowerCase().replace(END, "")));
    if (!already) {
      const front = starts.length > 0 && random() < 0.5;
      const back = ends.length > 0 && (!front || random() < 0.4);
      if (front) edit(spoken[0], (line) => `${pickOf(starts, random)} ${line}`);
      if (back || (!front && ends.length)) edit(spoken.at(-1), (line) => `${line} ${pickOf(ends, random)}`);
    }
  }
  if (mark) {
    const marks = pool(mark);
    if (marks.length && !marks.some(item => source.includes(item))) edit(spoken.at(-1), (line) => `${line} ${pickOf(marks, random)}`);
  }
  return lines.join("\n");
}
