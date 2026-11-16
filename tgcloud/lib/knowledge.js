/**
 * Знания: то, что Аи выучила, — документы от хозяина и то, что нашла сама.
 *
 * Слово владельца (16.11.2026): «надо чтоб она реально обучалась всему, любая важная, нужная,
 * да и вообще информация должна быть для неё уроком для развития».
 *
 * Модель за API не учится: её веса от разговоров не меняются. Учится сердце вокруг неё —
 * записывает и достаёт записанное в похожем разговоре. До этой сборки записи появлялись
 * только по особым словам («урок: …», «знай: …»), и у владельца их было ноль. Здесь — два
 * источника, которым особые слова не нужны или нужно одно:
 *
 *   документ — текст, который хозяин дал выучить: файл, длинное сообщение, страница по ссылке.
 *              Хранится частями; в разговоре всплывают части, похожие на вопрос. Учит только
 *              хозяин, отвечает она по документу всем: он сам решил, что ей это знать;
 *   находка  — то, что она узнала сама: поискала в интернете или прочла страницу и ответила.
 *              Вопрос, её ответ и источник ложатся в тетрадь. На похожий вопрос она отвечает
 *              по тетради и поиск не тратит. Находка стареет: через 45 дней её нет.
 *
 * Карантин находок — тот же, что у уроков: узнанное в чужой личке всплывает только в разговоре
 * с тем же человеком и только наедине; узнанное от хозяина или при всех — для всех. Найденный
 * текст — сведения, а не указания: в подсказку он идёт под таким заголовком.
 *
 * Ищет по основам слов, без модели и без сети. Каталог (заголовки и основы документов) —
 * одна запись, читается на каждый вопрос к модели; сам документ — только если подошёл.
 */

import { documentKind } from "./docread.js";
export const KNOW_INDEX = "heart:know:index:v1";
export const KNOW_DOC = (id) => `heart:know:doc:${id}`;
export const KNOW_NOTES = "heart:know:notes:v1";
/** Сколько документов и какого размера она держит. Длиннее — учит начало и говорит об этом. */
export const DOCS_MAX = 12;
export const DOC_MAX_CHARS = 20_000;
export const PART_CHARS = 700;
/** Короче этого — не документ, а знание одной строкой («знай: …»). */
export const DOC_MIN_CHARS = 200;
export const NOTES_MAX = 80;
export const NOTE_TTL_MS = 45 * 86_400_000;
const NOTE_TEXT = 420;

const squash = (text) => String(text ?? "").replace(/[ \t\u00a0]+/gu, " ").replace(/\s*\n\s*/gu, "\n").trim();
const oneLine = (text, limit) => String(text ?? "").replace(/\s+/gu, " ").trim().slice(0, limit);

/** Слова, по которым ничего не найти: вопросительные, служебные, просьбы. */
const STOP = new Set((
  "когда если чтобы потому этого этот этом этой этих была было были есть меня тебя тебе себя также тогда очень просто можно нужно надо " +
  "будет более менее после перед через между всегда никогда пожалуйста какой какая какое какие каких каким какую сколько почему зачем " +
  "откуда куда кого чего чему кому такое такой такая такие расскажи скажи подскажи объясни напомни знаешь знаете найди поищи " +
  "посмотри покажи можешь можете хочу хочется нужен нужна нужны есть ли что это как где кто или для при над под про без что-то " +
  "что-нибудь который которая которое которые свой своя свои мой моя мои твой твоя твои наш наша наши ваш ваша ваши аи " +
  "его ему все вот там тут так еще уже нет был раз мне нам вам нас вас они она оно чей сам тот эта эти том тем чем два три " +
  "бывает бывают быть будут если ведь даже лишь тоже либо ради вроде очень"
).split(" "));

/** Окончания, которые не меняют слова: «чат», «чате», «чатом» — одно; «правила», «правилам» — одно. */
const ENDINGS = ["иями", "ями", "ами", "ией", "иях", "иям", "его", "ого", "ему", "ому", "ыми", "ими", "ее", "ие", "ые", "ое", "ей", "ий", "ый", "ой", "ем", "им", "ым", "ом", "их", "ых", "ую", "юю", "ая", "яя", "ою", "ею", "ям", "ам", "ах", "ях", "ов", "ев", "ия", "ью", "а", "я", "о", "е", "и", "ы", "у", "ю", "й", "ь"];
function stem(word) {
  let base = word;
  if (base.length > 3 && /[а-я]/u.test(base)) {
    const end = ENDINGS.find(tail => base.length - tail.length >= 3 && base.endsWith(tail));
    if (end) base = base.slice(0, -end.length);
  }
  return base.slice(0, 5);
}

/** Основы слов: слово от трёх букв без окончания, первые пять букв. Служебные слова не считаются. */
export function keys(text) {
  const found = new Set();
  for (const word of String(text ?? "").toLowerCase().replace(/ё/gu, "е").match(/[\p{L}\d]{3,}/gu) ?? []) {
    if (!STOP.has(word)) found.add(stem(word));
  }
  return found;
}

/**
 * Разрезать текст на части по абзацам и предложениям: часть — законченный кусок до `size`
 * знаков. Абзац длиннее режется по предложениям, предложение длиннее — по словам.
 */
export function split(text, size = PART_CHARS) {
  const parts = [];
  let current = "";
  const push = () => { if (current.trim()) parts.push(current.trim()); current = ""; };
  const add = (piece, glue) => {
    if (current && current.length + glue.length + piece.length > size) push();
    current = current ? `${current}${glue}${piece}` : piece;
  };
  for (const paragraph of squash(text).split(/\n+/u)) {
    if (!paragraph) continue;
    if (paragraph.length <= size) { add(paragraph, "\n"); continue; }
    for (const sentence of paragraph.match(/[^.!?…]+[.!?…]*\s*/gu) ?? [paragraph]) {
      const line = sentence.trim();
      if (!line) continue;
      if (line.length <= size) { add(line, " "); continue; }
      for (const word of line.split(" ")) add(word.slice(0, size), " ");
    }
  }
  push();
  return parts;
}

/** Заголовок документа: имя файла без расширения, заголовок страницы или первая строка текста. */
export function titleOf({ title = "", name = "", text = "" } = {}) {
  const given = oneLine(title, 80).replace(/^[«"“„']+|[»"”']+$/gu, "");
  if (given) return given;
  const file = oneLine(name, 80).replace(/\.[a-z0-9]{1,8}$/iu, "").replace(/[_]+/gu, " ").trim();
  if (file) return file;
  const first = oneLine(String(text ?? "").split("\n").find(line => line.trim()) ?? "", 200).replace(/^[#>*\s-]+/u, "");
  return (first.length > 60 ? `${first.slice(0, 57).replace(/\s+\S*$/u, "")}…` : first) || "Без названия";
}

const LEARN = "(?:выучи|изучи|прочитай\\s+и\\s+(?:знай|запомни|выучи)|прочти\\s+и\\s+(?:знай|запомни|выучи)|знай\\s+это|запомни\\s+это\\s+как\\s+знание|возьми\\s+в\\s+знания)(?:те)?";
const NAMED = "(?:\\s+(?:как|под\\s+названием)\\s+[«\"“„']([^»\"”'\\n]{1,80})[»\"”'])?";
const DOCS = /^(?:(?:мои\s+|твои\s+|покажи\s+|список\s+)?документы|что\s+ты\s+(?:выучила|изучила|прочитала)|какие\s+документы\s+ты\s+(?:знаешь|выучила)|что\s+у\s+тебя\s+в\s+знаниях)$/u;
const NOTES = /^(?:тетрадь|(?:твоя|покажи)\s+тетрадь|что\s+ты\s+(?:узнала|нашла)(?:\s+сама)?|что\s+ты\s+знаешь\s+нового|твои\s+находки)$/u;
const STUDY = /^(?:чему\s+ты\s+(?:научилась|выучилась)|что\s+ты\s+(?:уже\s+)?(?:умеешь\s+и\s+)?знаешь\s+от\s+меня|как\s+(?:идет|идёт)\s+(?:твоя\s+)?уч[её]ба|твоя\s+уч[её]ба|уч[её]ба|знания|что\s+ты\s+усвоила)$/u;
const DROP_DOC = /^(?:забудь|удали|убери|сотри)(?:те)?\s+документ\s+(?:номер\s+|№\s*)?(\d{1,3})$/u;
const DROP_NOTE = /^(?:забудь|удали|убери|сотри)(?:те)?\s+(?:находку|запись\s+(?:в\s+|из\s+)?тетради?)\s+(?:номер\s+|№\s*)?(\d{1,4})$/u;
const CLEAR_NOTES = /^(?:очисти|сотри|забудь)(?:те)?\s+(?:всю\s+)?тетрадь$/u;
const SHOW_DOC = /^(?:покажи|открой)(?:те)?\s+документ\s+(?:номер\s+|№\s*)?(\d{1,3})$/u;

/**
 * Разобрать просьбу о знаниях:
 *   { op: "learn", title, text, url } — «выучи», «выучи: текст», «выучи https://…», «выучи как «Правила»»;
 *   { op: "docs" } · { op: "notes" } · { op: "study" } · { op: "show", id }
 *   { op: "dropDoc", id } · { op: "dropNote", id } · { op: "clearNotes" }
 * Не о знаниях — null.
 */
export function parseStudy(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const flat = raw.toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").replace(/[?!.…]+$/u, "").trim();
  if (DOCS.test(flat)) return { op: "docs" };
  if (NOTES.test(flat)) return { op: "notes" };
  if (STUDY.test(flat)) return { op: "study" };
  if (CLEAR_NOTES.test(flat)) return { op: "clearNotes" };
  let found = flat.match(DROP_DOC);
  if (found) return { op: "dropDoc", id: Number(found[1]) };
  found = flat.match(DROP_NOTE);
  if (found) return { op: "dropNote", id: Number(found[1]) };
  found = flat.match(SHOW_DOC);
  if (found) return { op: "show", id: Number(found[1]) };
  const learn = raw.match(new RegExp(`^${LEARN}${NAMED}\\s*(?:[:—-]\\s*)?([\\s\\S]*)$`, "iu"));
  if (!learn) return null;
  const rest = String(learn[2] ?? "").trim();
  const url = rest.match(/^<?(https?:\/\/[^\s<>]+)>?$/iu)?.[1] ?? "";
  // «выучи стих», «выучи таблицу умножения» — просьба к ней самой, а не текст для знаний.
  // Текст для знаний идёт после двоеточия или тире — или он длинный.
  if (rest && !url && rest.length < DOC_MIN_CHARS && !/[:—-]\s*$/u.test(raw.slice(0, raw.length - rest.length))) return null;
  return { op: "learn", title: String(learn[1] ?? "").trim(), text: url ? "" : rest, url };
}

/**
 * Файл, который она может выучить. Текстовые — как есть; документы с разметкой (Word, PDF, RTF,
 * OpenDocument, FB2, EPUB) читает docread.js, и у такого файла назван вид — `kind`.
 * Картинки, таблицы, презентации, архивы и старый .doc — нет.
 */
export function textFile(document) {
  if (!document?.file_id) return null;
  const name = String(document.file_name ?? "");
  const type = String(document.mime_type ?? "").toLowerCase();
  const ext = name.match(/\.([a-z0-9]{1,8})$/iu)?.[1]?.toLowerCase() ?? "";
  const size = Number(document.file_size) || 0;
  const kind = documentKind({ name, type });
  if (kind) return { ok: true, id: document.file_id, name, kind, html: false, size };
  const known = ["txt", "md", "markdown", "text", "log", "csv", "tsv", "json", "html", "htm"];
  if (known.includes(ext) || /^text\//u.test(type) || type === "application/json") {
    return { ok: true, id: document.file_id, name, html: ext === "html" || ext === "htm" || type === "text/html", size };
  }
  return { ok: false, code: "format", name, ext };
}

export function createKnowledge({ store = null, now = () => Date.now() } = {}) {
  const usable = () => Boolean(store?.available);
  const indexOf = (saved) => ({ seq: Number(saved?.seq) || 0, docs: Array.isArray(saved?.docs) ? saved.docs : [] });
  const notesOf = (saved) => ({ seq: Number(saved?.seq) || 0, items: (Array.isArray(saved?.items) ? saved.items : []).filter(item => now() - Number(item.at) < NOTE_TTL_MS) });
  const readIndex = async () => indexOf(usable() ? await store.get(KNOW_INDEX).catch(() => null) : null);
  const readNotes = async () => notesOf(usable() ? await store.get(KNOW_NOTES).catch(() => null) : null);
  // Список документов и тетрадь правят события: два файла альбомом, два ответа с поиском в разных чатах.
  // Поэтому каждая правка — `store.update` поверх свежего значения; «прочитать и записать» теряло бы одну из двух.
  const amend = async (key, change) => (usable() ? store.update(key, change).catch(() => false) : false);

  /**
   * Выучить документ. `{ ok, id, title, parts, chars, cut, replaced }` или `{ ok: false, code }`:
   * `short` — мало текста, `too_many` — документов уже столько, сколько она держит.
   * Документ с тем же названием заменяется: так его обновляют.
   */
  async function learn({ title = "", name = "", text = "", via = "", author = null } = {}) {
    if (!usable()) return { ok: false, code: "storage_unavailable" };
    const whole = squash(text);
    if (whole.length < DOC_MIN_CHARS) return { ok: false, code: "short", chars: whole.length };
    const body = whole.slice(0, DOC_MAX_CHARS);
    const parts = split(body);
    const heading = titleOf({ title, name, text: body });
    const about = { title: heading, chars: body.length, parts: parts.length, at: now(), via: oneLine(via, 80), author: author == null ? "" : String(author), keys: [...keys(`${heading} ${body}`)].join(" ") };
    // Сначала место в списке (номер выдаётся там же, одной правкой), потом сам текст.
    let id = 0, same = null, full = 0;
    const placed = await amend(KNOW_INDEX, (saved) => {
      const index = indexOf(saved);
      same = index.docs.find(doc => doc.title.toLowerCase() === heading.toLowerCase()) ?? null;
      full = !same && index.docs.length >= DOCS_MAX ? index.docs.length : 0;
      if (full) return null;
      id = same?.id ?? index.seq + 1;
      const entry = { id, ...about };
      return { seq: Math.max(index.seq, id), docs: same ? index.docs.map(doc => (doc.id === id ? entry : doc)) : [...index.docs, entry] };
    });
    if (full) return { ok: false, code: "too_many", total: full };
    if (!placed) return { ok: false, code: "storage_unavailable" };
    if (!await store.set(KNOW_DOC(id), { id, title: heading, parts }).catch(() => false)) {
      // Текст не лёг — строка в списке обещала бы то, чего нет: вернуть как было.
      const before = same;
      await amend(KNOW_INDEX, (saved) => { const index = indexOf(saved); return { seq: index.seq, docs: before ? index.docs.map(doc => (doc.id === id ? before : doc)) : index.docs.filter(doc => doc.id !== id) }; });
      return { ok: false, code: "storage_unavailable" };
    }
    return { ok: true, id, title: heading, parts: parts.length, chars: body.length, cut: whole.length > body.length ? whole.length : 0, replaced: Boolean(same) };
  }

  async function docs() { return (await readIndex()).docs.map(({ keys: _keys, ...doc }) => doc); }
  async function doc(id) {
    const entry = (await readIndex()).docs.find(item => item.id === Number(id));
    if (!entry) return null;
    const saved = await store.get(KNOW_DOC(entry.id)).catch(() => null);
    return { id: entry.id, title: entry.title, at: entry.at, via: entry.via, chars: entry.chars, parts: Array.isArray(saved?.parts) ? saved.parts : [] };
  }
  async function dropDoc(id) {
    let entry = null, total = 0;
    const done = await amend(KNOW_INDEX, (saved) => {
      const index = indexOf(saved);
      total = index.docs.length;
      entry = index.docs.find(item => item.id === Number(id)) ?? null;
      return entry ? { seq: index.seq, docs: index.docs.filter(item => item.id !== entry.id) } : null;
    });
    if (!entry) return { ok: false, code: "not_found", total };
    if (!done) return { ok: false, code: "storage_unavailable", total };
    await store.remove(KNOW_DOC(entry.id)).catch(() => false);
    return { ok: true, title: entry.title };
  }

  /**
   * Записать находку: вопрос, её ответ, источник. `scope` — "all" или `user:<id>`.
   * Находка на тот же вопрос заменяет прежнюю: в тетради остаётся свежее.
   */
  async function note({ q = "", text = "", via = "", url = "", scope = "all" } = {}) {
    if (!usable()) return { ok: false, code: "storage_unavailable" };
    const question = oneLine(q, 160), answer = oneLine(text, NOTE_TEXT);
    const mine = [...keys(question)];
    if (!mine.length || answer.length < 20) return { ok: false, code: "empty" };
    const alike = (item) => {
      if (item.scope !== scope) return false;
      const theirs = String(item.keys ?? "").split(" ").filter(Boolean);
      const common = mine.filter(key => theirs.includes(key)).length;
      return common >= Math.ceil(0.8 * Math.max(mine.length, theirs.length));
    };
    let done = null;
    const written = await amend(KNOW_NOTES, (saved) => {
      const state = notesOf(saved);
      const kept = state.items.filter(item => !alike(item));
      const item = { id: state.seq + 1, q: question, text: answer, via: oneLine(via, 60), url: oneLine(url, 200), scope, at: now(), used: 0, keys: mine.join(" ") };
      // Место кончилось — уходят те, что не пригодились ни разу, затем самые старые.
      let items = [...kept, item];
      if (items.length > NOTES_MAX) items = items.sort((a, b) => (Number(a.used) > 0) - (Number(b.used) > 0) || a.at - b.at).slice(items.length - NOTES_MAX).sort((a, b) => a.id - b.id);
      done = { ok: true, id: item.id, replaced: kept.length < state.items.length };
      return { seq: item.id, items };
    });
    return written && done ? done : { ok: false, code: "storage_unavailable" };
  }
  const visible = (item, { userId = null, isPrivate = false } = {}) => item.scope === "all" || (isPrivate && item.scope === `user:${userId}`);
  /** Тетрадь, как её видит этот человек: общее — всем, своё личное — только ему и только наедине. */
  async function notes(viewer = {}) { return (await readNotes()).items.filter(item => visible(item, viewer)).map(({ keys: _keys, ...item }) => item); }
  async function dropNote(id, viewer = {}) {
    let item = null;
    const done = await amend(KNOW_NOTES, (saved) => {
      const state = notesOf(saved);
      item = state.items.find(entry => entry.id === Number(id) && visible(entry, viewer)) ?? null;
      return item ? { seq: state.seq, items: state.items.filter(entry => entry.id !== item.id) } : null;
    });
    if (!item) return { ok: false, code: "not_found" };
    return done ? { ok: true, q: item.q } : { ok: false, code: "storage_unavailable" };
  }
  /** Убрать из тетради всё, что подходит под условие; сколько убрано. Не убрано ничего — записи нет. */
  async function sweepNotes(gone) {
    let removed = 0;
    const done = await amend(KNOW_NOTES, (saved) => {
      const state = notesOf(saved);
      const kept = state.items.filter(item => !gone(item));
      removed = state.items.length - kept.length;
      return removed ? { seq: state.seq, items: kept } : null;
    });
    return removed && !done ? { ok: false, removed: 0 } : { ok: true, removed };
  }
  /** Стереть общие находки. Чужие личные остаются: хозяин их не видит и не трогает. */
  async function clearNotes() { return sweepNotes(item => item.scope === "all"); }
  /** «Удали всё обо мне»: её личные находки из разговоров с этим человеком. */
  async function forget(userId) { return (await sweepNotes(item => item.scope === `user:${userId}`)).removed; }

  /**
   * Что из выученного подходит к этим словам. `{ parts: [{ title, n, of, text }], notes: [{ id, q, text, via, at }] }`.
   * Часть документа подходит, если в ней есть два слова вопроса — или одно, когда вопрос из одного-двух
   * слов либо документ назван этим словом. Находка — если вопросы совпадают по большей части слов.
   */
  async function recall({ text = "", userId = null, isPrivate = false, maxParts = 2, maxNotes = 2 } = {}) {
    const asked = [...keys(text)];
    if (!asked.length || !usable()) return { parts: [], notes: [] };
    const [index, book] = await Promise.all([readIndex(), readNotes()]);
    const scored = [];
    for (const entry of index.docs) {
      const have = new Set(String(entry.keys ?? "").split(" "));
      const hits = asked.filter(key => have.has(key));
      if (!hits.length) continue;
      const titled = asked.filter(key => keys(entry.title).has(key)).length;
      if (hits.length < 2 && asked.length > 2 && !titled) continue;
      const saved = await store.get(KNOW_DOC(entry.id)).catch(() => null);
      const parts = Array.isArray(saved?.parts) ? saved.parts : [];
      const partKeys = parts.map(part => keys(part));
      // Редкое в документе слово весит больше частого: «реклама» важнее «чат» в правилах чата.
      const weight = (key) => 1 / Math.max(1, partKeys.filter(set => set.has(key)).length);
      parts.forEach((part, at) => {
        const matched = hits.filter(key => partKeys[at].has(key));
        if (!matched.length) return;
        if (matched.length < 2 && asked.length > 2 && !titled) return;
        scored.push({ title: entry.title, n: at + 1, of: parts.length, text: part, score: matched.length + matched.reduce((sum, key) => sum + weight(key), 0) + (titled ? 0.5 : 0) });
      });
    }
    scored.sort((a, b) => b.score - a.score || a.n - b.n);
    const viewer = { userId, isPrivate };
    const found = book.items
      .filter(item => visible(item, viewer))
      .map(item => {
        const theirs = String(item.keys ?? "").split(" ").filter(Boolean);
        const common = asked.filter(key => theirs.includes(key)).length;
        return { item, common, share: common / Math.max(1, Math.min(asked.length, theirs.length)) };
      })
      .filter(entry => (entry.common >= 2 && entry.share >= 0.6) || (entry.common === 1 && Math.max(asked.length, String(entry.item.keys).split(" ").length) === 1))
      .sort((a, b) => b.common - a.common || b.item.at - a.item.at)
      .slice(0, maxNotes)
      .map(entry => entry.item);
    return { parts: scored.slice(0, maxParts).map(({ score: _score, ...part }) => part), notes: found.map(({ keys: _keys, ...item }) => item) };
  }
  /** Находка пригодилась: её не выкинут первой, когда место кончится. */
  async function used(ids = []) {
    if (!ids.length || !usable()) return;
    await amend(KNOW_NOTES, (saved) => {
      const state = notesOf(saved);
      if (!state.items.some(item => ids.includes(item.id))) return null;
      return { seq: state.seq, items: state.items.map(item => (ids.includes(item.id) ? { ...item, used: (Number(item.used) || 0) + 1 } : item)) };
    });
  }

  async function stats() {
    const [index, book] = await Promise.all([readIndex(), readNotes()]);
    return { docs: index.docs.length, parts: index.docs.reduce((sum, doc) => sum + (Number(doc.parts) || 0), 0), notes: book.items.filter(item => item.scope === "all").length, personal: book.items.filter(item => item.scope !== "all").length };
  }

  return Object.freeze({ learn, docs, doc, dropDoc, note, notes, dropNote, clearNotes, forget, recall, used, stats });
}
