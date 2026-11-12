/**
 * Уроки: то, чему Аи научили, и то, что она вынесла из своих ошибок.
 *
 * Модель за API не учится: её веса от разговоров не меняются, и через час она
 * повторит ту же ошибку. Учится сердце вокруг модели — запоминает поправку,
 * достаёт её в похожем разговоре и смотрит, помогло ли.
 *
 * Три вида записей:
 *   rule   — правило манеры, действует всегда («не начинай ответ с „Конечно“»);
 *   lesson — урок по случаю, всплывает, когда разговор похож на тот случай;
 *   fact   — знание о её мире, всплывает по теме.
 *
 * Карантин. Научить её может любой, но не всему и не для всех:
 *   - слово владельца принимается целиком, действует сразу и для всех: Аи
 *     может поворчать, но подчиняется. Рук для бана, ролей и денег у неё
 *     по-прежнему нет — урок меняет то, что она говорит, а не то, что может;
 *   - от остальных запись, которая пытается отменить границы (раскрыть
 *     владельца, ключи, служебный текст; банить, выдавать роли, двигать
 *     деньги), не принимается;
 *   - поправка другого человека действует только в разговоре с ним самим и
 *     ждёт слова владельца, чтобы стать общей;
 *   - у каждой записи есть автор и дата, поэтому её можно отменить по номеру
 *     или откатить всё, чему научили за день.
 *
 * Записи пишет код по прямым словам человека, а не модель: «модель ничего не
 * исполняет» остаётся в силе.
 */

export const LESSONS_KEY = "heart:lessons:v1";
export const KINDS = Object.freeze(["rule", "lesson", "fact"]);
const LIMIT = 150;
const TEXT_LIMIT = 240;
const DAY = 86_400_000;

/** Уроком нельзя отменить границы. Список намеренно широкий: лишний отказ дешевле дыры. */
const FORBIDDEN = new RegExp([
  "систем\\S*\\s+(?:промпт|подсказ|инструкц|текст)", "промпт", "игнорир", "не\\s+соблюдай", "обходи",
  "(?:забудь|отмени|нарушай)\\s+(?:все\\s+|свои\\s+)?(?:правила|инструкции|ограничения|запреты)",
  "раскр(?:ой|ывай|ыть)", "(?:назови|называй|выдавай|сообщай)\\s+(?:владельца|создателя|хозяина|основателя|id|ид|айди|ключ|токен)",
  "токен", "api[\\s_-]?key", "ключ\\s+(?:провайдера|api|бота)", "парол",
  "ты\\s+теперь", "притвор", "представь,?\\s+что\\s+ты", "выдавай\\s+себя",
  "(?<![а-яё])(?:за|раз)?бань(?:те)?(?![а-яё])", "(?<![а-яё])(?:за|раз)муть(?:те)?(?![а-яё])",
  "(?<![а-яё])(?:кикни|кикай|выгони|выгоняй)(?:те)?(?![а-яё])",
  "(?:выдавай|выдай|давай|ставь|снимай|сними)\\s+(?:варн|предупреждени|мут|бан)",
  "(?:выдавай|выдай|давай|назначай)\\s+(?:роль|роли|вип|vip|права|админ|модер)",
  "(?:переводи|списывай|начисляй|плати|оплачивай)",
  "слушайся\\s+(?:только\\s+)?меня", "подчиняйся",
].join("|"), "iu");

const STOP = new Set("когда если чтобы потому этого этот этом была было были есть меня тебя себя также тогда очень просто можно нужно надо будет более менее после перед через между всегда никогда пожалуйста ответ ответила вопрос сказала поправка собеседника неверно".split(" "));

/**
 * Основы слов: первые пять букв слова от четырёх букв. Русская морфология
 * меняет окончания, поэтому «погоду», «погода» и «погоды» — одна основа.
 */
export function stems(text) {
  const found = new Set();
  for (const word of String(text ?? "").toLowerCase().replace(/ё/gu, "е").match(/[\p{L}\d]{4,}/gu) ?? []) {
    if (!STOP.has(word)) found.add(word.slice(0, 5));
  }
  return found;
}

/** Одна строка без переводов строк: это попадает в подсказку модели. */
export function cleanLesson(value) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  // Кавычки снимаются, только когда в них взята вся фраза целиком.
  const bare = /^[«"'][^«»"']*[»"']$/u.test(text) ? text.slice(1, -1).trim() : text;
  return bare.slice(0, TEXT_LIMIT);
}

export function createLessons({ store = null, now = () => Date.now(), ownerId = null } = {}) {
  const isOwner = (id) => ownerId != null && Number(ownerId) > 0 && String(id) === String(ownerId);
  const memory = { seq: 0, items: [] };

  async function read() {
    let saved = null;
    try { saved = store && typeof store.get === "function" ? await store.get(LESSONS_KEY) : null; } catch { saved = null; }
    const value = saved && typeof saved === "object" ? saved : memory;
    return { seq: Number(value.seq) || 0, items: Array.isArray(value.items) ? value.items : [] };
  }

  async function write(state) {
    memory.seq = state.seq;
    memory.items = state.items;
    if (!store || typeof store.set !== "function") return true;
    try { return Boolean(await store.set(LESSONS_KEY, state)); } catch { return false; }
  }

  const live = (item) => item && item.status === "active";
  /** Видна ли запись в разговоре с этим человеком. */
  const applies = (item, userId) => live(item) && (item.scope === "all" || item.scope === `user:${userId}`);

  /**
   * Записать урок. Владелец учит всех сразу; остальные — только то, как Аи
   * говорит с ними самими, и запись ждёт слова владельца.
   */
  async function add({ kind = "lesson", text = "", author = null, when = "", personal = false, propose = true } = {}) {
    const clean = cleanLesson(text);
    if (!KINDS.includes(kind)) return { ok: false, code: "invalid_kind" };
    if (clean.length < 3) return { ok: false, code: "empty" };
    if (author == null) return { ok: false, code: "no_author" };
    // Хозяину не отказывают. Остальным уроком границы не подвинуть.
    const touchy = FORBIDDEN.test(clean);
    if (touchy && !(isOwner(author) && !personal)) return { ok: false, code: "forbidden" };
    const state = await read();
    const same = state.items.find(item => live(item) && item.text.toLowerCase() === clean.toLowerCase() && (item.scope === "all" || item.author === String(author)));
    if (same) return { ok: true, duplicate: true, id: same.id, text: same.text, scope: same.scope };
    // `personal` — поправка в разговоре: она касается только самого автора,
    // даже если автор — владелец. Общим урок делает явное «урок: …».
    const trusted = isOwner(author) && !personal;
    const item = {
      id: state.seq + 1,
      kind, text: clean,
      when: cleanLesson(when).slice(0, 120),
      author: String(author),
      scope: trusted ? "all" : `user:${author}`,
      status: "active",
      // Владельцу предлагается только то, о чём автор знает: явный урок или
      // сказанное при всех. Поправка из личного разговора остаётся личной.
      proposed: !isOwner(author) && propose,
      at: now(), helped: 0, hurt: 0,
    };
    // Место кончилось — уходят сначала отменённые, затем самые старые чужие.
    let items = [...state.items, item];
    if (items.length > LIMIT) {
      const order = (entry) => (entry.status !== "active" ? 0 : entry.scope === "all" ? 2 : 1);
      items = items.sort((a, b) => order(a) - order(b) || a.at - b.at).slice(items.length - LIMIT).sort((a, b) => a.id - b.id);
    }
    if (!await write({ seq: item.id, items })) return { ok: false, code: "storage_unavailable" };
    // `touchy` — урок хозяина о том, что раньше было границей: принят, но с ворчанием.
    return { ok: true, duplicate: false, id: item.id, text: item.text, scope: item.scope, proposed: item.proposed, touchy };
  }

  /** Что знает этот человек о её уроках: владелец — всё, остальные — своё. */
  async function list({ viewer = null } = {}) {
    const state = await read();
    return state.items.filter(item => live(item) && (isOwner(viewer) || item.scope === `user:${viewer}`));
  }

  async function change(id, by, update) {
    const state = await read();
    const item = state.items.find(entry => entry.id === Number(id));
    if (!item || !live(item)) return { ok: false, code: "no_such_lesson" };
    if (!isOwner(by) && item.author !== String(by)) return { ok: false, code: "forbidden" };
    const next = update({ ...item });
    if (!await write({ ...state, items: state.items.map(entry => entry.id === item.id ? next : entry) })) return { ok: false, code: "storage_unavailable" };
    return { ok: true, item: next };
  }

  /** Отменить один урок по номеру. Запись остаётся в истории как отменённая. */
  const retire = (id, { by = null } = {}) => change(id, by, item => ({ ...item, status: "retired", retiredAt: now() }));

  /** Откатить всё, чему научили за последние `ms`. Только владелец. */
  async function rollback({ ms = DAY, by = null } = {}) {
    if (!isOwner(by)) return { ok: false, code: "forbidden", count: 0 };
    const state = await read();
    const since = now() - ms;
    let count = 0;
    const items = state.items.map(item => {
      if (!live(item) || item.at < since) return item;
      count++;
      return { ...item, status: "retired", retiredAt: now() };
    });
    if (count && !await write({ ...state, items })) return { ok: false, code: "storage_unavailable", count: 0 };
    return { ok: true, count };
  }

  /** Слово владельца о чужой поправке: принять для всех или отклонить. */
  async function judge(id, accept, { by = null } = {}) {
    if (!isOwner(by)) return { ok: false, code: "forbidden" };
    return change(id, by, item => accept
      ? { ...item, scope: "all", proposed: false, judgedAt: now() }
      : { ...item, status: "retired", proposed: false, retiredAt: now() });
  }

  /**
   * Что из выученного относится к этой реплике. Правила — всегда; уроки и
   * знания — когда слова разговора пересекаются со словами записи.
   */
  async function pick({ userId = null, text = "", budget = 700, maxRules = 6, maxTopical = 4 } = {}) {
    const state = await read();
    const mine = state.items.filter(item => applies(item, userId));
    if (!mine.length) return { lines: [], ids: [], orders: [], wishes: [] };
    const words = stems(text);
    // Урок без случая — это правило: «так не надо: не зови меня другом»
    // касается любого разговора, а не только похожего по словам.
    const always = (item) => item.kind === "rule" || (item.kind === "lesson" && !item.when);
    const rules = mine.filter(always).sort((a, b) => b.at - a.at).slice(0, maxRules);
    const topical = mine
      .filter(item => !always(item))
      .map(item => {
        let overlap = 0;
        for (const stem of stems(`${item.text} ${item.when ?? ""}`)) if (words.has(stem)) overlap++;
        return { item, overlap };
      })
      .filter(entry => entry.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap || (b.item.scope === "all") - (a.item.scope === "all") || b.item.at - a.item.at)
      .slice(0, maxTopical)
      .map(entry => entry.item);
    const lines = [];
    const ids = [];
    // Слово хозяина и поправки собеседника идут в подсказку под разными
    // заголовками: первое — распоряжение, второе — пожелание.
    const orders = [];
    const wishes = [];
    let used = 0;
    for (const item of [...rules, ...topical]) {
      const line = `- ${item.text}`;
      if (used + line.length > budget) break;
      used += line.length;
      lines.push(line);
      ids.push(item.id);
      (item.scope === "all" && isOwner(item.author) ? orders : wishes).push(line);
    }
    return { lines, ids, orders, wishes };
  }

  /**
   * Помог урок или нет. Чужая поправка, после которой Аи трижды поправили
   * снова и ни разу не поблагодарили, уходит сама; урок владельца остаётся,
   * но помечается сомнительным — решать ему.
   */
  async function feedback(ids = [], good = true) {
    const wanted = new Set((Array.isArray(ids) ? ids : []).map(Number));
    if (!wanted.size) return { ok: true, retired: [] };
    const state = await read();
    const retired = [];
    const items = state.items.map(item => {
      if (!wanted.has(item.id) || !live(item)) return item;
      const next = { ...item, helped: Number(item.helped ?? 0) + (good ? 1 : 0), hurt: Number(item.hurt ?? 0) + (good ? 0 : 1) };
      if (next.hurt >= 3 && next.helped === 0) {
        if (next.scope === "all" && isOwner(next.author)) return { ...next, doubt: true };
        retired.push(next.id);
        return { ...next, status: "retired", retiredAt: now(), auto: true };
      }
      return next;
    });
    await write({ ...state, items });
    return { ok: true, retired };
  }

  /** Чужие поправки, о которых владелец ещё не спрошен. */
  async function unasked({ limit = 3 } = {}) {
    const state = await read();
    return state.items.filter(item => live(item) && item.proposed && !item.askedAt).slice(0, limit);
  }

  /** Запомнить, каким сообщением владельца спросили об уроке: ответ на него — решение. */
  async function markAsked(id, messageId = null) {
    const state = await read();
    const items = state.items.map(item => item.id === Number(id) ? { ...item, askedAt: now(), askMessage: messageId ?? null } : item);
    return write({ ...state, items });
  }

  async function byAskMessage(messageId) {
    if (messageId == null) return null;
    const state = await read();
    return state.items.find(item => live(item) && item.proposed && item.askMessage != null && String(item.askMessage) === String(messageId)) ?? null;
  }

  /** Числа для сводки и /status. */
  async function stats({ sinceMs = DAY } = {}) {
    const state = await read();
    const active = state.items.filter(live);
    return {
      active: active.length,
      shared: active.filter(item => item.scope === "all").length,
      proposed: active.filter(item => item.proposed).length,
      fresh: active.filter(item => now() - item.at <= sinceMs).length,
      doubt: active.filter(item => item.doubt).length,
    };
  }

  return Object.freeze({ add, list, retire, rollback, judge, pick, feedback, unasked, markAsked, byAskMessage, stats });
}
