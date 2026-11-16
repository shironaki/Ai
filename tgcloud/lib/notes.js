/**
 * Списки, цели и дневник: то, что человек просит записать дословно.
 *
 * Это не память о человеке: память — выводы («любит чай»), а здесь его
 * собственные строки, которые возвращаются без пересказа. Модель их не пишет
 * и не правит. Всё хранится по человеку, а не по чату: список покупок один
 * и в личке, и в группе. Дневник показывается только в личке.
 *
 * «Удали всё обо мне» стирает и это.
 */
import { fold } from "./sources.js";

export const NOTES_KEY = (userId) => `heart:lists:${userId}`;
const MAX_LISTS = 20, MAX_ITEMS = 100, MAX_TEXT = 200;

const ADD = "(?:добавь|запиши|внеси|допиши|закинь|занеси)(?:те)?";
const NAME = "([\\p{L}\\p{N}][\\p{L}\\p{N} -]{1,38})";
const clean = (value) => String(value ?? "").replace(/\s+/gu, " ").replace(/^[\s«"'“—–:-]+|[\s»"'”.!]+$/gu, "").trim();
const many = (value) => String(value ?? "").split(/\s*[,;\n]\s*|\s+и\s+(?=\S+$)/u).map(clean).filter(Boolean);

/**
 * Разобрать просьбу. Возвращает
 *   { op: "add", list, items, kind }   · { op: "show", list, kind } · { op: "all" }
 *   { op: "strike", list, item, kind } · { op: "done", list, item, kind } · { op: "clear", list, kind }
 * или null. `kind`: "list" | "goals" | "diary"; `list` — имя, как сказано.
 */
export function parseNote(value) {
  const flat = String(value ?? "").replace(/\s+/gu, " ").trim();
  const cut = flat.replace(/[?!.…]+$/u, "").trim();
  const text = fold(cut);
  if (!text || text.length > 700) return null;
  // Слова человека — как он их написал: регистр и знаки в записи сохраняются.
  // `rest` — кусок тянется до конца фразы, вместе с последней точкой.
  const tail = (found, group = 1, rest = false) => {
    const piece = found[group];
    const at = text.lastIndexOf(piece);
    if (text.length !== cut.length || at < 0) return piece;
    return rest ? flat.slice(at) : cut.slice(at, at + piece.length);
  };
  let match;

  // ── цели ──
  if ((match = text.match(/^(?:(?:новая|моя|еще\s+одна)\s+)?цель\s*[:—–-]\s*(.{2,400})$/u))) return { op: "add", kind: "goals", list: "цели", items: [clean(tail(match, 1, true)).slice(0, MAX_TEXT)] };
  if (/^(?:(?:покажи|какие|напомни)\s+)?(?:мои\s+)?цели$|^какие\s+у\s+меня\s+цели$/u.test(text)) return { op: "show", kind: "goals", list: "цели" };
  if ((match = text.match(/^цель\s+(?:номер\s+|№\s*)?(\d{1,3})\s+(?:выполнена|достигнута|готова|сделана|закрыта)$/u))
    ?? (match = text.match(/^(?:выполнил[а]?|достиг(?:ла)?|закрыл[а]?|отметь)\s+цель\s+(?:номер\s+|№\s*)?(\d{1,3})$/u))) return { op: "done", kind: "goals", list: "цели", item: match[1] };
  if ((match = text.match(/^(?:убери|удали|вычеркни)\s+цель\s+(?:номер\s+|№\s*)?(\d{1,3})$/u))) return { op: "strike", kind: "goals", list: "цели", item: match[1] };
  if (/^(?:очисти|удали|сотри)\s+(?:все\s+)?(?:мои\s+)?цели$/u.test(text)) return { op: "clear", kind: "goals", list: "цели" };

  // ── дневник ──
  if ((match = text.match(/^(?:(?:запись|запиши)\s+в\s+дневник|в\s+дневник|дорогой\s+дневник|дневник)\s*[:—–,-]\s*([\s\S]{2,600})$/u))) return { op: "add", kind: "diary", list: "дневник", items: [tail(match, 1, true).trim().slice(0, 600)] };
  if (/^(?:(?:покажи|открой|прочитай|почитай)\s+)?(?:мой\s+)?дневник$|^что\s+(?:у\s+меня\s+)?в\s+дневнике$/u.test(text)) return { op: "show", kind: "diary", list: "дневник" };
  if ((match = text.match(/^(?:очисти|удали|сотри)\s+(?:весь\s+)?(?:мой\s+)?дневник(\s+навсегда)?$/u))) return { op: "clear", kind: "diary", list: "дневник", sure: Boolean(match[1]) };

  // ── списки ──
  if (/^(?:(?:покажи|какие)\s+)?(?:мои|все\s+мои)\s+списки$|^какие\s+у\s+меня\s+(?:есть\s+)?списки$/u.test(text)) return { op: "all" };
  // Слово «список» сказано — просьба однозначна; без него («убери это из
  // памяти») речь о списке, только если такой у человека уже есть.
  const explicit = /(?:^|\s)списо?к/u.test(text);
  const listed = (found) => ({ ...found, explicit });
  // «список покупок: молоко, хлеб», «в список покупок: сыр», «добавь в покупки: чай».
  if ((match = text.match(new RegExp(`^(?:${ADD}\\s+)?(?:в\\s+)?список\\s+${NAME}\\s*[:—–]\\s*(.{1,500})$`, "u")))
    ?? (match = text.match(new RegExp(`^${ADD}\\s+в\\s+${NAME}\\s*[:—–]\\s*(.{1,500})$`, "u")))) {
    return listed({ op: "add", kind: "list", list: clean(match[1]), items: many(tail(match, 2, true)).map(item => item.slice(0, MAX_TEXT)) });
  }
  // «добавь молоко и хлеб в список покупок».
  if ((match = text.match(new RegExp(`^${ADD}\\s+(.{1,300}?)\\s+в\\s+список\\s+${NAME}$`, "u")))) {
    return listed({ op: "add", kind: "list", list: clean(match[2]), items: many(tail(match, 1)).map(item => item.slice(0, MAX_TEXT)) });
  }
  if ((match = text.match(new RegExp(`^(?:вычеркни|убери|удали|зачеркни)(?:те)?\\s+(.{1,200}?)\\s+из\\s+(?:списка\\s+)?${NAME}$`, "u")))) return listed({ op: "strike", kind: "list", list: clean(match[2]), item: clean(tail(match, 1)) });
  if ((match = text.match(new RegExp(`^(?:отметь|куплен[оаы]?|сделан[оаы]?|готово)(?:те)?\\s+(.{1,200}?)\\s+в\\s+(?:списке\\s+)?${NAME}$`, "u")))) return listed({ op: "done", kind: "list", list: clean(match[2]), item: clean(tail(match, 1)) });
  if ((match = text.match(new RegExp(`^(?:очисти|удали|сотри)(?:те)?\\s+(?:весь\\s+)?список\\s+${NAME}$`, "u")))) return listed({ op: "clear", kind: "list", list: clean(match[1]) });
  if ((match = text.match(new RegExp(`^(?:(?:покажи|открой|прочитай|напомни)(?:те)?\\s+)?(?:мой\\s+)?список\\s+${NAME}$`, "u")))
    ?? (match = text.match(new RegExp(`^что\\s+(?:у\\s+меня\\s+)?в\\s+списке\\s+${NAME}$`, "u")))) return listed({ op: "show", kind: "list", list: clean(match[1]) });
  return null;
}

/** «покупки» и «покупок» — один список: сравниваются согласные и начало слова. */
const skeleton = (word) => word.replace(/[аеёиоуыэюяьъ]/gu, "");
function alikeWord(a, b) {
  if (a === b) return true;
  const x = skeleton(a), y = skeleton(b);
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && long.startsWith(short) && long.length - short.length <= 1 && a.slice(0, 3) === b.slice(0, 3);
}
export function sameList(a, b) {
  const left = fold(a).split(" "), right = fold(b).split(" ");
  return left.length === right.length && left.every((word, index) => alikeWord(word, right[index]));
}

const two = (n) => String(n).padStart(2, "0");
const HEAD = Object.freeze({ goals: "🎯 Цели", diary: "📔 Дневник" });
/** «Список покупок» — если так и сказано; заведённый словами «в покупки» зовётся «покупки». */
const nameOf = (list) => (list.plain ? `«${list.title}»` : `список ${list.title}`);
const titleOf = (list) => HEAD[list.kind] ?? `📝 ${list.plain ? nameOf(list) : `Список ${list.title}`}`;
const plural = (n, one, few, many5) => { const d = n % 10, h = n % 100; return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many5; };

export function createNotes({ store = null, now = () => Date.now(), dayOf = (at) => new Date(at).toISOString().slice(0, 10) } = {}) {
  async function read(userId) {
    let saved = null;
    try { saved = store?.available ? await store.get(NOTES_KEY(userId)) : null; } catch { saved = null; }
    return Array.isArray(saved?.lists) ? saved.lists : [];
  }
  const write = async (userId, lists) => (lists.length ? store.set(NOTES_KEY(userId), { lists, at: now() }) : store.remove(NOTES_KEY(userId)));
  const find = (lists, asked) => lists.find(list => (asked.kind !== "list" ? list.kind === asked.kind : list.kind === "list" && sameList(list.title, asked.list)));
  /** Строка списка по номеру или по словам. */
  function locate(list, item) {
    if (/^\d{1,3}$/u.test(item)) return Number(item) - 1 < list.items.length ? Number(item) - 1 : -1;
    const want = fold(item);
    const exact = list.items.findIndex(entry => fold(entry.text) === want);
    return exact >= 0 ? exact : list.items.findIndex(entry => fold(entry.text).split(" ").some(word => alikeWord(word, want)) || fold(entry.text).includes(want));
  }

  function render(list) {
    if (!list.items.length) return `${titleOf(list)}: пусто.`;
    if (list.kind === "diary") {
      const recent = list.items.slice(-10);
      const lines = recent.map(entry => { const day = dayOf(entry.at); return `${day.slice(8, 10)}.${day.slice(5, 7)} — ${entry.text}`; });
      return `${titleOf(list)}${list.items.length > recent.length ? ` — последние ${recent.length} из ${list.items.length}` : ""}:\n\n${lines.join("\n\n")}`;
    }
    const done = list.items.filter(entry => entry.done).length;
    return `${titleOf(list)} (${list.items.length}${done ? `, готово ${done}` : ""}):\n${list.items.map((entry, index) => `${index + 1}. ${entry.done ? "✅ " : ""}${entry.text}`).join("\n")}`;
  }

  /** Не имена списков: у этих слов есть свой хозяин — память, напоминания, уроки. */
  const RESERVED = /^(?:памят[ьи]|напоминани[яй]|напоминалк[иу]|урок(?:и|ов)|календар[ья]|будильник[иа]?|профил[ья]|избранно[ем]|чат[ае]?|групп[ыуе])$/u;

  /**
   * Выполнить просьбу. Возвращает текст ответа или null — «это не про
   * списки»; `isPrivate` нужен дневнику.
   */
  async function handle(userId, asked, { isPrivate = true } = {}) {
    if (asked.kind === "list" && !asked.explicit && RESERVED.test(fold(asked.list))) return null;
    if (!store?.available) return "Записать некуда: хранилище не отвечает.";
    if (asked.kind === "diary" && !isPrivate) return "Дневник — личное: веду и показываю его только в личке.";
    const lists = await read(userId);
    if (asked.op === "all") {
      if (!lists.length) return "Списков пока нет. Начать просто: «список покупок: молоко, хлеб», «цель: выучить сто кандзи», «дневник: сегодня…».";
      return `Что у вас записано:\n${lists.map(list => `• ${titleOf(list).replace(/^\S+\s/u, "")} — ${list.items.length} ${plural(list.items.length, "запись", "записи", "записей")}`).join("\n")}\n\nОткрыть — «покажи список …», «мои цели», «покажи дневник».`;
    }
    let list = find(lists, asked);
    if (asked.op === "add") {
      const items = asked.items.filter(Boolean);
      if (!items.length) return "Что записать? Например: «список покупок: молоко, хлеб».";
      if (!list) {
        if (lists.length >= MAX_LISTS) return `Списков уже ${MAX_LISTS} — это предел. Удалите лишний: «удали список …».`;
        list = { kind: asked.kind, title: asked.kind === "list" ? asked.list : asked.kind, items: [], ...(asked.kind === "list" && !asked.explicit ? { plain: true } : {}) };
        lists.push(list);
      }
      if (list.items.length + items.length > MAX_ITEMS) return `В одном списке помещается ${MAX_ITEMS} строк. Сейчас в нём ${list.items.length}.`;
      for (const text of items) list.items.push({ text, at: now() });
      if (!(await write(userId, lists))) return "Не записалось: хранилище не отвечает.";
      if (asked.kind === "diary") return `Записала в дневник. Записей — ${list.items.length}.`;
      if (asked.kind === "goals") return `🎯 Цель записана — №${list.items.length}. Выполните — скажите «цель ${list.items.length} выполнена».`;
      return `Записала в ${nameOf(list)}: ${items.join(", ")}. Всего — ${list.items.length}.`;
    }
    if (!list) {
      // «Убери это из памяти» — не про списки: такого списка нет и слова «список» не было.
      if (asked.kind === "list" && !asked.explicit) return null;
      const mine = lists.filter(item => item.kind === "list").map(item => `«${item.title}»`);
      if (asked.kind === "goals") return "Целей пока нет. Записать — «цель: …».";
      if (asked.kind === "diary") return "Дневник пока пуст. Записать — «дневник: …».";
      return mine.length ? `Списка «${asked.list}» у вас нет. Есть: ${mine.join(", ")}.` : `Списка «${asked.list}» у вас нет. Завести — «список ${asked.list}: …».`;
    }
    if (asked.op === "show") return render(list);
    if (asked.op === "clear") {
      const count = list.items.length;
      // Дневник не восстановить: стирается только вторым, явным словом.
      if (asked.kind === "diary" && !asked.sure && count) return `В дневнике ${count} ${plural(count, "запись", "записи", "записей")}, и вернуть их будет нельзя. Чтобы стереть, скажите: «сотри дневник навсегда».`;
      if (!(await write(userId, lists.filter(item => item !== list)))) return "Не стёрлось: хранилище не отвечает.";
      return asked.kind === "diary" ? `Дневник стёрт: записей было ${count}.` : asked.kind === "goals" ? "Цели стёрты." : `${list.plain ? `Список ${nameOf(list)}` : `Список ${list.title}`} удалён.`;
    }
    const index = locate(list, asked.item);
    if (index < 0) return `Не нашла «${asked.item}» ${asked.kind === "goals" ? "среди целей" : list.plain ? `в списке ${nameOf(list)}` : `в списке ${list.title}`}.\n\n${render(list)}`;
    const entry = list.items[index];
    if (asked.op === "done") {
      entry.done = true;
      if (!(await write(userId, lists))) return "Не отметилось: хранилище не отвечает.";
      const left = list.items.filter(item => !item.done).length;
      return asked.kind === "goals" ? `🎯 Выполнено: «${entry.text}». ${left ? `Впереди ещё ${left}.` : "Это была последняя — все цели закрыты."}` : `Отметила: ✅ ${entry.text}. Осталось — ${left}.`;
    }
    list.items.splice(index, 1);
    if (!(await write(userId, list.items.length ? lists : lists.filter(item => item !== list)))) return "Не вычеркнулось: хранилище не отвечает.";
    return `Вычеркнула: ${entry.text}. ${list.items.length ? `Осталось — ${list.items.length}.` : "Список опустел — убрала и его."}`;
  }

  /** «Удали всё обо мне» — и списки тоже. */
  async function wipe(userId) {
    if (!store?.available) return { ok: true };
    try { await store.remove(NOTES_KEY(userId)); return { ok: true }; } catch { return { ok: false }; }
  }

  return Object.freeze({ handle, wipe, read });
}
