/**
 * Тетрадь чата: счёт для настольной игры и цитатник.
 *
 * Счёт — просто числа, которые чат ведёт сам: «счёт: Петя 5, Маша 3»,
 * «Пете +2». Это не рейтинг и не награды (они у сестры): запись живёт, пока
 * её не обнулят, и ничего не даёт, кроме самой себя.
 *
 * Цитатник — только то, что люди сами попросили сохранить, ответив на
 * сообщение словами «в цитатник». Всё подряд она не записывает. Автор может
 * убрать свои цитаты одной фразой.
 */
import { fold } from "./sources.js";
import { safeName } from "./address.js";

export const SCORE_KEY = (chatId) => `heart:score:${chatId}`;
export const QUOTES_KEY = (chatId) => `heart:quotes:${chatId}`;
const MAX_PLAYERS = 30, MAX_QUOTES = 200, QUOTE_LIMIT = 500;

const NAME = "([\\p{L}][\\p{L}\\p{N}-]{0,20})";
const SIGN = { "+": 1, "-": -1, "−": -1, "–": -1 };

/**
 * Разбор счёта:
 *   { op: "set", rows } · { op: "add", name, by, soft } · { op: "show" } · { op: "reset" }
 * `soft` — «Пете +2»: это счёт, только если такой игрок в таблице есть.
 */
export function parseScore(value) {
  const flat = String(value ?? "").replace(/\s+/gu, " ").trim().replace(/[?!.…]+$/u, "").trim();
  const text = fold(flat);
  if (!text || text.length > 300) return null;
  let match;
  if ((match = text.match(/^(?:счет|очки)\s*[:—–]\s*(.{1,280})$/u))) {
    const body = text.length === flat.length ? flat.slice(flat.length - match[1].length) : match[1];
    const rows = [];
    for (const piece of body.split(/\s*[,;]\s*|\s+и\s+/u)) {
      const pair = piece.trim().match(new RegExp(`^${NAME}\\s*[:=—–]?\\s*(-?\\d{1,6})$`, "u"));
      if (!pair) return null;
      rows.push({ name: pair[1], n: Number(pair[2]) });
    }
    return rows.length ? { op: "set", rows: rows.slice(0, MAX_PLAYERS) } : null;
  }
  if (/^(?:(?:какой|покажи|наш|текущий)\s+)?счет$|^таблица\s+(?:счета|очков)$|^кто\s+(?:ведет|лидирует|впереди)$/u.test(text)) return { op: "show" };
  if (/^(?:сбрось|обнули|очисти|удали|сотри)\s+счет$|^новый\s+счет$/u.test(text)) return { op: "reset" };
  const said = (index) => (text.length === flat.length ? flat.slice(match.index + match[0].indexOf(match[index]), match.index + match[0].indexOf(match[index]) + match[index].length) : match[index]);
  if ((match = text.match(new RegExp(`^(?:счет\\s+)?${NAME}\\s*([+\\-−–])\\s*(\\d{1,5})$`, "u")))) return { op: "add", name: said(1), by: SIGN[match[2]] * Number(match[3]), soft: true };
  if ((match = text.match(new RegExp(`^(плюс|минус)\\s+(\\d{1,5})\\s+${NAME}$`, "u")))) return { op: "add", name: said(3), by: (match[1] === "плюс" ? 1 : -1) * Number(match[2]), soft: true };
  if ((match = text.match(new RegExp(`^(?:очко|балл)\\s+${NAME}$`, "u")))) return { op: "add", name: said(1), by: 1, soft: true };
  return null;
}

/**
 * Насколько сказанное похоже на имя игрока: 2 — оно самое, 1 — то же имя в
 * другом падеже («Пете» — Петя, «Олегу» — Олег), 0 — другое имя. «Оле» — это
 * Оля, а не Олег: у имени на согласную падеж только прибавляет буквы.
 */
export function nameMatch(name, said) {
  const mine = fold(name), theirs = fold(said);
  if (mine === theirs) return 2;
  const base = /[аяйь]$/u.test(mine) ? mine.slice(0, -1) : mine;
  return base.length >= 2 && theirs.startsWith(base) && theirs.length - base.length <= 2 ? 1 : 0;
}

const SAVE_QUOTE = /^(?:(?:это\s+)?в\s+цитатник|(?:запомни|сохрани|запиши)\s+(?:эту\s+)?цитату|(?:добавь|запиши|сохрани)\s+(?:это\s+)?в\s+цитатник|цитируй)$/u;
const RANDOM_QUOTE = /^(?:(?:дай|покажи|скажи)\s+)?(?:(?:случайн(?:ая|ую)|люб(?:ая|ую))\s+)?цитат[ау](?:\s+дня)?$/u;
const LIST_QUOTES = /^(?:(?:покажи|открой)\s+)?цитатник$|^(?:все\s+|последние\s+)?цитаты$|^сколько\s+(?:у\s+нас\s+)?цитат$/u;

/** Разбор цитатника: { op: "save" | "random" | "list" | "drop" | "mine", index }. */
export function parseQuote(value) {
  const text = fold(value).replace(/[?!.…]+$/u, "").trim();
  if (!text || text.length > 60) return null;
  if (SAVE_QUOTE.test(text)) return { op: "save" };
  if (RANDOM_QUOTE.test(text)) return { op: "random" };
  if (LIST_QUOTES.test(text)) return { op: "list" };
  if (/^(?:удали|убери|сотри)\s+(?:все\s+)?мои\s+цитаты$/u.test(text)) return { op: "mine" };
  const drop = text.match(/^(?:удали|убери|сотри)\s+(?:(последнюю)\s+цитату|цитату\s+(?:номер\s+|№\s*)?(\d{1,3}))$/u);
  if (drop) return { op: "drop", index: drop[1] ? -1 : Number(drop[2]) };
  return null;
}

export function createChatbook({
  store = null, now = () => Date.now(), random = Math.random, dayOf = (at) => new Date(at).toISOString().slice(0, 10),
  say = async () => ({ ok: false }), canManage = async () => false,
} = {}) {
  const date = (at) => { const day = dayOf(at); return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`; };
  const table = (rows) => [...rows].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "ru")).map((row, index) => `${index + 1}. ${row.name} — ${row.n}`).join("\n");

  /** Счёт. `null` — речь не о нём. */
  async function score(turn, prompt) {
    const asked = parseScore(prompt);
    if (!asked) return null;
    const saved = store?.available ? await store.get(SCORE_KEY(turn.chatId)).catch(() => null) : null;
    const rows = Array.isArray(saved?.rows) ? saved.rows : [];
    if (asked.op === "add") {
      const ranked = rows.map(row => ({ row, fit: nameMatch(row.name, asked.name) })).filter(item => item.fit > 0).sort((a, b) => b.fit - a.fit);
      // «Температура +2» — не счёт: такого игрока нет, и это разговор.
      if (!ranked.length) return null;
      if (turn.dry) return say(turn, "Разобрала бы это как очки в счёт — репетиция, ничего не пишу.");
      if (ranked.length > 1 && ranked[0].fit === ranked[1].fit) return say(turn, `Кому из них: ${ranked.filter(item => item.fit === ranked[0].fit).map(item => item.row.name).join(" или ")}? Назовите имя как в таблице.`);
      const next = rows.map(row => (row === ranked[0].row ? { ...row, n: row.n + asked.by } : row));
      if (!await store.set(SCORE_KEY(turn.chatId), { rows: next, at: now() })) return say(turn, "Счёт не записался: хранилище не отвечает.");
      return say(turn, `Счёт:\n${table(next)}`);
    }
    if (turn.dry) return say(turn, "Разобрала бы это как счёт — репетиция, ничего не пишу.");
    if (asked.op === "show") return say(turn, rows.length ? `Счёт:\n${table(rows)}` : "Счёта пока нет. Начать: «счёт: Петя 0, Маша 0», дальше — «Пете +2».");
    if (!store?.available) return say(turn, "Счёт вести не могу: хранилище не отвечает.");
    if (asked.op === "reset") {
      if (!rows.length) return say(turn, "Счёта и не было.");
      await store.remove(SCORE_KEY(turn.chatId)).catch(() => false);
      return say(turn, `Счёт обнулён. Было:\n${table(rows)}`);
    }
    // «Счёт: Петя 5, Маша 3» — названные получают эти числа, остальные остаются.
    const next = [...rows];
    for (const row of asked.rows) {
      const at = next.findIndex(other => fold(other.name) === fold(row.name));
      if (at >= 0) next[at] = { ...next[at], n: row.n }; else next.push(row);
    }
    if (next.length > MAX_PLAYERS) return say(turn, `В таблице уже ${MAX_PLAYERS} имён — больше не помещается. «Сбрось счёт» начнёт заново.`);
    if (!await store.set(SCORE_KEY(turn.chatId), { rows: next, at: now() })) return say(turn, "Счёт не записался: хранилище не отвечает.");
    return say(turn, `Счёт:\n${table(next)}\n\nДальше — «Пете +2», «Маше -1»; показать — «счёт»; обнулить — «сбрось счёт».`);
  }

  /** Цитатник. `null` — речь не о нём. */
  async function quotes(turn, prompt) {
    const asked = parseQuote(prompt);
    if (!asked) return null;
    if (turn.dry) return say(turn, "Разобрала бы это как цитатник — репетиция, ничего не пишу.");
    if (!store?.available) return say(turn, "Цитатник сейчас недоступен: хранилище не отвечает.");
    const key = QUOTES_KEY(turn.chatId);
    const saved = await store.get(key).catch(() => null);
    const items = Array.isArray(saved?.items) ? saved.items : [];
    const show = (item) => `❝ ${item.text} ❞\n— ${item.who}, ${date(item.at)}`;
    if (asked.op === "save") {
      const replied = turn.message?.reply_to_message;
      const text = String(replied?.text ?? replied?.caption ?? "").replace(/\s+/gu, " ").trim();
      if (!replied) return say(turn, "Что сохранить? Ответьте этими словами на сообщение, которое стоит цитатника.");
      if (!text) return say(turn, "В цитатник идёт только текст: у этого сообщения слов нет.");
      if (items.some(item => item.mid != null && item.mid === replied.message_id)) return say(turn, "Эта цитата уже в цитатнике.");
      const item = {
        text: text.length > QUOTE_LIMIT ? `${text.slice(0, QUOTE_LIMIT).trimEnd()}…` : text,
        who: safeName(replied.from?.first_name) || "Неизвестный", uid: replied.from?.id ?? null, by: turn.actorId, mid: replied.message_id ?? null, at: now(),
      };
      if (!await store.set(key, { items: [...items, item].slice(-MAX_QUOTES), at: now() })) return say(turn, "Не сохранилось: хранилище не отвечает.");
      return say(turn, `Записала в цитатник — №${Math.min(items.length + 1, MAX_QUOTES)}.`);
    }
    if (!items.length) return say(turn, "Цитатник пуст. Сохранить — ответить на сообщение словами «в цитатник».");
    if (asked.op === "random") return say(turn, show(items[Math.min(items.length - 1, Math.floor(random() * items.length))]));
    if (asked.op === "list") {
      const tail = items.map((item, index) => ({ item, index })).slice(-5);
      return say(turn, [`В цитатнике ${items.length}. Последние:`, "", ...tail.map(({ item, index }) => `${index + 1}. «${item.text.length > 80 ? `${item.text.slice(0, 80).trimEnd()}…` : item.text}» — ${item.who}`), "", "Случайная — «цитата». Убрать — «удали цитату 3»; свои — «удали мои цитаты»."].join("\n"));
    }
    if (asked.op === "mine") {
      const rest = items.filter(item => String(item.uid) !== String(turn.actorId));
      if (rest.length === items.length) return say(turn, "Ваших слов в цитатнике нет.");
      if (!await store.set(key, { items: rest, at: now() })) return say(turn, "Не убралось: хранилище не отвечает.");
      return say(turn, `Убрала ваши цитаты: ${items.length - rest.length}.`);
    }
    const at = asked.index === -1 ? items.length - 1 : asked.index - 1;
    const target = items[at];
    if (!target) return say(turn, `Цитаты с таким номером нет: всего их ${items.length}.`);
    // Убрать может тот, чьи это слова, тот, кто их сохранил, и админ чата.
    const allowed = String(target.uid) === String(turn.actorId) || String(target.by) === String(turn.actorId) || await canManage(turn);
    if (!allowed) return say(turn, "Убрать цитату может её автор, тот, кто её сохранил, или админ чата.");
    if (!await store.set(key, { items: items.filter((_, index) => index !== at), at: now() })) return say(turn, "Не убралось: хранилище не отвечает.");
    return say(turn, `Убрала цитату №${at + 1}.`);
  }

  return Object.freeze({ score, quotes });
}
