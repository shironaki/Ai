/**
 * К кому обращаются: имя, @упоминание, ответ на её сообщение, её команда.
 *
 * Раньше в группе работало ровно одно написание — «Аи, …» в начале строки, а
 * ответ на сообщение ЛЮБОГО бота считался обращением к ней. Отсюда две
 * поломки сразу: на «привет, Аи» и «@бот привет» она молчала, а на чужие
 * `/help@OtherBot` и ответы другим ботам — отвечала.
 *
 * Правило одно: обращение — это звательная позиция имени (начало, конец,
 * обособление запятыми), явное @упоминание или ответ на её собственное
 * сообщение. Имя в середине фразы («спросим у Аи») — упоминание, не зов.
 */

const escape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Слова, после которых имя всё ещё стоит «в начале»: «привет, Аи», «эй, Аи». */
const LEAD = "(?:эй|хей|слушай|привет|приветик|здравствуй|здравствуйте|доброе\\s+утро|добрый\\s+день|добрый\\s+вечер|доброй\\s+ночи|спасибо|ну|ок|окей|так)";

/**
 * Разобрать команду: «/ai@Bot привет» → { name: "ai", target: "bot", rest: "привет" }.
 * `target` пуст, когда команда без адресата.
 */
export function parseCommand(text) {
  const match = String(text ?? "").trim().match(/^\/([A-Za-zА-Яа-яЁё0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/u);
  if (!match) return null;
  return { name: match[1].toLowerCase(), target: (match[2] ?? "").toLowerCase(), rest: (match[3] ?? "").trim() };
}

/** Есть ли в тексте её @username. Без имени пользователя ответ всегда «нет». */
export function mentions(text, username) {
  const name = String(username ?? "").replace(/^@/u, "").trim();
  if (!name) return false;
  return new RegExp(`(?:^|[^A-Za-z0-9_@])@${escape(name)}(?![A-Za-z0-9_])`, "iu").test(String(text ?? ""));
}

/** Убрать @упоминание из фразы: оно адрес, а не часть вопроса. */
export function stripMention(text, username) {
  const name = String(username ?? "").replace(/^@/u, "").trim();
  if (!name) return String(text ?? "").trim();
  return String(text ?? "")
    .replace(new RegExp(`(^|[^A-Za-z0-9_@])@${escape(name)}(?![A-Za-z0-9_])[,:]?`, "giu"), "$1")
    .replace(/\s{2,}/gu, " ")
    .replace(/^[\s,]+/u, "")
    .trim();
}

/**
 * Звательное имя. Возвращает `{ addressed, prompt }`: фраза без имени, чтобы
 * «Аи, запомни …» и «запомни …, Аи» были одной и той же просьбой.
 *
 * `strict` — имена, которые легко спутать со словом (латинское «ai»): они
 * считаются зовом только со знаком препинания рядом.
 */
export function vocative(text, names = ["аи"], strict = ["ai"]) {
  const raw = String(text ?? "").trim();
  if (!raw) return { addressed: false, prompt: "" };
  const soft = names.filter(Boolean).map(escape).join("|");
  const hard = strict.filter(Boolean).map(escape).join("|");
  const clean = (value) => value.replace(/\s{2,}/gu, " ").replace(/^[\s,:;—-]+/u, "").trim();

  if (soft) {
    // «Аи, …», «Аи!», «Аи? ты тут», «Аи привет», «привет, Аи», «эй, Аи, слушай».
    const head = raw.match(new RegExp(`^(?:(${LEAD})[\\s,!]+)?(?:${soft})(?=$|[\\s,!?.:;…—-])[\\s,!?.:;…—-]*`, "iu"));
    if (head) {
      const rest = raw.slice(head[0].length);
      return { addressed: true, prompt: clean(head[1] && rest ? `${head[1]}, ${rest}` : (head[1] ?? "") + rest) };
    }
    // «ты тут, Аи?», «спасибо, Аи!» — знак в конце остаётся при фразе.
    const tail = raw.match(new RegExp(`[\\s,]+(?:${soft})([\\s!?.…)]*)$`, "iu"));
    if (tail) return { addressed: true, prompt: clean(raw.slice(0, tail.index) + tail[1].trim()) };
    // «слушай, Аи, а ты…» — имя обособлено запятыми.
    const mid = raw.match(new RegExp(`,\\s*(?:${soft})\\s*,\\s*`, "iu"));
    if (mid) return { addressed: true, prompt: clean(`${raw.slice(0, mid.index)}, ${raw.slice(mid.index + mid[0].length)}`) };
  }
  if (hard) {
    const head = raw.match(new RegExp(`^(?:${hard})[,!?:]+\\s*`, "iu"));
    if (head) return { addressed: true, prompt: clean(raw.slice(head[0].length)) };
    const tail = raw.match(new RegExp(`,\\s*(?:${hard})([!?.…]*)$`, "iu"));
    if (tail) return { addressed: true, prompt: clean(raw.slice(0, tail.index) + tail[1]) };
  }
  return { addressed: false, prompt: raw };
}

/**
 * Ответ на ЕЁ сообщение. `me` — то, что сказал getMe; если он недоступен,
 * остаётся сравнение по username из настроек. Ответ другому боту — не к ней.
 */
export function isReplyToMe(message, me = {}) {
  const author = message?.reply_to_message?.from;
  if (!author || author.is_bot !== true) return false;
  if (me?.id != null) return String(author.id) === String(me.id);
  const name = String(me?.username ?? "").replace(/^@/u, "").toLowerCase();
  return Boolean(name) && String(author.username ?? "").toLowerCase() === name;
}

/** Имя из Telegram — данные от человека: только буквы, цифры и пробел, коротко. */
export function safeName(value, limit = 32) {
  return String(value ?? "")
    .replace(/[^\p{L}\p{N} _.-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit);
}
