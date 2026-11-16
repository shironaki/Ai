/**
 * Своё у чата: действия, которых нет в её таблице, свои гифки к действиям и
 * связи между участниками — пары, браки, названая семья, лучшие друзья.
 *
 * Здесь только слова: что просят и как об этом сказать. Отправляет `fun.js`.
 * Наград, очков и рейтингов нет — это статус в ролевой игре, и только.
 *
 * Правила:
 *   • своё действие и свою гифку добавляет админ чата (или хозяин);
 *   • действие срабатывает как встроенное: ответом на сообщение или с @именем;
 *   • откровенного и злого она вести не станет, кто бы ни добавлял;
 *   • связь появляется только с согласия второго человека — его нажатием.
 */
import { fold } from "./sources.js";
import { parseAction, parseEmote, ACTIONS } from "./rp.js";
import { refusal } from "./draw.js";

export const OWN_ACTIONS_MAX = 20;
export const OWN_GIFS_MAX = 5;
export const BONDS_KEY = (chatId) => `heart:bonds:${chatId}`;
export const BOND_ASK_TTL_MS = 10 * 60_000;

const clean = (text) => fold(text).replace(/[«»"“”]/gu, "").replace(/\s+/gu, " ").trim().replace(/[.!…]+$/u, "").trim();
const WORDS = /^[а-яa-z][а-яa-z\- ]{1,39}$/u;
const EMOJI = /(\p{Extended_Pictographic}(?:\u{FE0F}|\u{200D}\p{Extended_Pictographic})*)/u;

/**
 * Слова админа о своих действиях и гифках → просьба, иначе null:
 *   { add: { say: ["угостить печенькой"], verb: "угощает печенькой", how: "acc" | "dat", emoji } }
 *   { bad: "…" }            — похоже на «новое действие», но разобрать нельзя: причина словами;
 *   { list: true }          — «наши действия»;
 *   { drop: "угостить печенькой" | 2 } — «убери действие …»;
 *   { gifFor: "обнять", loose? } — «это для обнять», «гифка для обнять» (ответом на гифку);
 *   { gifDrop: "обнять" }   — «убери гифки для обнять»;
 *   { gifList: true }       — «наши гифки».
 */
export function parseOwn(text) {
  const raw = String(text ?? "").replace(/\s+/gu, " ").trim();
  const value = clean(raw);
  if (!value || value.length > 160) return null;
  if (/^(?:наши|свои|собственные)\s+(?:действия|рп)$|^(?:действия|рп)\s+(?:чата|этого\s+чата)$|^(?:какие\s+)?(?:у\s+нас\s+)?свои\s+действия(?:\s+есть)?$/u.test(value)) return { list: true };
  if (/^(?:наши|свои)\s+(?:гифки|гифы|анимации)$|^(?:гифки|гифы)\s+(?:чата|этого\s+чата)$/u.test(value)) return { gifList: true };
  let found = value.match(/^(?:убери|удали|забудь|сотри)\s+(?:гифки|гифку|гифы|гиф)\s+(?:для|к|на|у)\s+(?:действия\s+)?(.{2,40})$/u);
  if (found) return { gifDrop: found[1].trim() };
  // «Это для обнять» — слова обычные: «это для тебя» говорят и просто так. Такая просьба
  // считается, только если действие нашлось; «гифка для …» — просьба без сомнений.
  found = value.match(/^(?:эт[оау]\s+)?(?:гифк[ау]|гиф|анимаци[яю])\s+(?:для|к|на)\s+(?:действия\s+)?(.{2,40})$/u)
    ?? value.match(/^(?:запомни|поставь|используй)\s+(?:эт[оу]\s+)?(?:гифк[ау]\s+)?(?:для|к|на)\s+(?:действия\s+)?(.{2,40})$/u);
  if (found) return { gifFor: found[1].trim() };
  found = value.match(/^эт[оау]\s+(?:для|к|на)\s+(?:действия\s+)?(.{2,40})$/u);
  if (found) return { gifFor: found[1].trim(), loose: true };
  found = value.match(/^(?:убери|удали|забудь|сотри)\s+(?:сво[её]\s+|наше\s+)?действие\s+(?:номер\s+|№\s*)?(.{1,40})$/u);
  if (found) return { drop: /^\d{1,2}$/u.test(found[1]) ? Number(found[1]) : found[1].trim() };

  // Двоеточие обязательно: «новое действие в фильме — это всегда хорошо» — просто слова.
  found = raw.match(/^(?:а\s+)?(?:новое|сво[её]|наше)\s+действие\s*:\s*(.+)$/iu) ?? raw.match(/^(?:добавь|создай|запомни)\s+(?:новое\s+|сво[её]\s+|наше\s+)?действие\s*:\s*(.+)$/iu);
  if (!found) return null;
  // «Что пишут — что делает»: тире, знак равенства или стрелка.
  const parts = found[1].split(/\s+(?:—|–|-|=|→|->)\s+/u);
  if (parts.length !== 2) return { bad: "Скажите так: «новое действие: угостить печенькой — угощает печенькой». Сначала то, что пишут, после тире — как об этом сказать." };
  const says = clean(parts[0]).split(/\s*(?:\/|\||,|\s+или\s+)\s*/u).map(item => item.trim()).filter(Boolean);
  if (!says.length || says.length > 4 || !says.every(item => WORDS.test(item) && item.split(" ").length <= 4)) {
    return { bad: "Название действия — до четырёх слов буквами: «угостить печенькой». Варианты — через косую черту: «угостить печенькой/угостил печенькой»." };
  }
  let verb = parts[1].replace(/[.!…]+$/u, "").trim();
  const emoji = verb.match(EMOJI)?.[1] ?? "";
  if (emoji) verb = verb.replace(EMOJI, " ").replace(/\s+/gu, " ").trim();
  let how = "acc";
  const tailed = fold(verb).match(/\s+(кого|кому)$/u);
  if (tailed) { how = tailed[1] === "кому" ? "dat" : "acc"; verb = verb.slice(0, verb.length - tailed[0].length).trim(); }
  const plain = fold(verb);
  if (!/^[а-яa-z][а-яa-z\- ]{1,59}$/u.test(plain) || plain.split(" ").length > 6) {
    return { bad: "После тире — как об этом сказать, словами и коротко: «угощает печенькой». Если дальше имя идёт в дательном падеже, добавьте «кому»: «дарит цветы кому»." };
  }
  return { add: { say: says, verb: plain, how, emoji } };
}

/** Можно ли завести такое действие: `""` — да, иначе причина словами. */
export function ownActionProblem(add, existing = []) {
  for (const said of add.say) {
    const built = parseAction(said) ?? parseEmote(said);
    if (built) return `«${said}» у меня уже есть — это встроенное «${(built.action ?? built).title}». Назовите иначе.`;
    if (existing.some(item => item.say.includes(said))) return `Действие «${said}» в этом чате уже есть. Убрать — «убери действие ${said}».`;
  }
  // Откровенное и злое она вести не станет — кто бы ни добавлял.
  if (refusal(`${add.say.join(" ")} ${add.verb}`)) return "Такое действие я вести не буду.";
  return "";
}

/**
 * Своё действие чата в сказанном: `{ action, tail }` или null. `actions` —
 * список из настроек чата. Возвращается действие в том же виде, что и
 * встроенные: его понимает `lineFor`.
 */
export function matchOwn(text, actions = []) {
  if (!Array.isArray(actions) || !actions.length) return null;
  const raw = fold(text).replace(/^[*_~\s]+|[*_~\s]+$/gu, "").replace(/[!.…?)]+$/u, "").trim();
  if (!raw || raw.length > 90 || /[,;:]/u.test(raw)) return null;
  const mentions = [];
  const value = raw.replace(/(?:^|\s)@([a-z0-9_]{3,32})(?=$|[\s,.!?])/giu, (_, name) => { mentions.push(name.toLowerCase()); return " "; })
    .replace(/[^\p{L}\p{N}\s\-]/gu, " ").replace(/\s+/gu, " ").trim();
  for (const [index, item] of actions.entries()) {
    // Длинные названия — первыми: «обнять крепко» раньше, чем «обнять».
    for (const said of [...item.say].sort((a, b) => b.length - a.length)) {
      if (value !== said && !value.startsWith(`${said} `)) continue;
      const tail = value.slice(said.length).trim().replace(/^(?:его|ее|их|тебя|вас|ему|ей|им|тебе|вам)(?=$|\s)/u, "").trim();
      if (tail.length > 40 || tail.split(" ").filter(Boolean).length > 4) return null;
      return {
        action: { key: `own:${index}`, emoji: item.emoji || "✨", verb: item.verb, gif: "", kind: "own", title: item.say[0], tail: "", how: item.how === "dat" ? "dat" : "acc" },
        tail, mention: mentions[0] ?? null, asked: false, toMe: false,
      };
    }
  }
  return null;
}

/** Ключ действия по названию: встроенное («обнять» → hug) или своё («own:0»). */
export function actionKeyOf(title, actions = []) {
  const value = clean(title);
  const built = ACTIONS.find(item => fold(item.title) === value) ?? parseAction(value)?.action;
  if (built) return { key: built.key, title: built.title };
  const index = (Array.isArray(actions) ? actions : []).findIndex(item => item.say.includes(value));
  return index >= 0 ? { key: `own:${actions[index].say[0]}`, title: actions[index].say[0] } : null;
}
/** Под каким ключом лежат гифки действия: у своих — по названию, номер может сдвинуться. */
export const gifKeyOf = (action) => (action?.kind === "own" ? `own:${action.title}` : action?.key ?? "");

// ── связи: пары, браки, названая семья, лучшие друзья ────────────────────
/** [ключ, знак, как называется связь, вопрос второму, что стало, романтическая, сколько таких можно] */
export const BONDS = Object.freeze([
  { key: "pair", emoji: "💞", title: "пара", ask: "стать парой", done: "теперь пара", romantic: true, max: 1 },
  { key: "marriage", emoji: "💍", title: "брак", ask: "пожениться", done: "теперь супруги", romantic: true, max: 1 },
  { key: "kin", emoji: "🏡", title: "семья", ask: "стать одной семьёй", done: "теперь одна семья", romantic: false, max: 6 },
  { key: "friends", emoji: "🤝", title: "лучшие друзья", ask: "стать лучшими друзьями", done: "теперь лучшие друзья", romantic: false, max: 6 },
]);
export const bondInfo = (key) => BONDS.find(item => item.key === key) ?? BONDS[0];

// Только слова-просьбы к ней как к «регистратору»: «пара», «предложи брак», «пожени нас».
// «Давай встречаться» и «давай дружить» говорят ей самой — на них отвечает словарь.
const OFFER = "(?:предложи|предлагаю|оформи|запиши|создай)";
const PROPOSE = [
  ["marriage", new RegExp(`^(?:${OFFER}\\s+)?(?:брак|свадьб[ау]|руку\\s+и\\s+сердце)$|^(?:пожени\\s+нас|пожениться|жениться(?:\\s+на)?|выйти\\s+замуж(?:\\s+за)?)$`, "u")],
  ["pair", new RegExp(`^(?:${OFFER}\\s+)?(?:пар[ау]|нас\\s+парой)$|^(?:в\\s+пару|стать\\s+парой|встречаться(?:\\s+с)?)$`, "u")],
  ["kin", new RegExp(`^(?:${OFFER}\\s+)?(?:семь[яю]|одн[ау]\\s+семь[яю])$|^(?:породниться(?:\\s+с)?|стать\\s+(?:одной\\s+)?семь[её]й|принять\\s+в\\s+семью|прими\\s+в\\s+семью|в\\s+семью)$`, "u")],
  ["friends", new RegExp(`^(?:${OFFER}\\s+)?(?:лучшие\\s+друзья|дружб[ау]|нас\\s+лучшими\\s+друзьями)$|^(?:стать\\s+лучшими\\s+друзьями|лучшими\\s+друзьями|подружиться(?:\\s+с)?|дружить(?:\\s+с)?)$`, "u")],
];
const LEAVE = [
  ["marriage", /^(?:развестись|развод|развожусь|разведи\s+нас)(?:\s+с)?$/u],
  ["pair", /^(?:расстаться|расстаюсь|разойтись|больше\s+не\s+пара)(?:\s+с)?$/u],
  ["kin", /^(?:выйти\s+из\s+семьи|ухожу\s+из\s+семьи|покинуть\s+семью|больше\s+не\s+семья)(?:\s+с)?$/u],
  ["friends", /^(?:раздружиться|больше\s+не\s+друзья|перестать\s+дружить)(?:\s+с)?$/u],
];

/**
 * Слова о связях → просьба, иначе null:
 *   { propose: "pair" } · { leave: "pair" } · { list: true } · { mine: true }
 * Адресат (ответ на сообщение или @имя) определяет вызывающий.
 */
export function parseBond(text) {
  const value = clean(text).replace(/(?:^|\s)@[a-z0-9_]{3,32}(?=$|\s)/giu, " ").replace(/[?]+$/u, "").replace(/\s+/gu, " ").trim();
  if (!value || value.length > 60) return null;
  if (/^(?:пары|семьи|связи|браки)(?:\s+(?:чата|этого\s+чата|тут|здесь))?$|^(?:наши|все)\s+(?:пары|семьи|связи|браки)$|^кто\s+с\s+кем(?:\s+(?:тут|здесь|в\s+чате))?$/u.test(value)) return { list: true };
  if (/^(?:моя|мой|мои)\s+(?:пара|семья|брак|связи|друзья|лучшие\s+друзья|муж|жена)$|^с\s+кем\s+я(?:\s+(?:тут|здесь))?$/u.test(value)) return { mine: true };
  for (const [kind, pattern] of PROPOSE) if (pattern.test(value)) return { propose: kind };
  for (const [kind, pattern] of LEAVE) if (pattern.test(value)) return { leave: kind };
  return null;
}

const same = (a, b) => String(a) === String(b);
/** Связи человека в чате. */
export const bondsOf = (bonds, userId) => (Array.isArray(bonds) ? bonds : []).filter(item => same(item.a, userId) || same(item.b, userId));
/** Второй человек в связи: `{ id, name }`. */
export const partnerOf = (bond, userId) => (same(bond.a, userId) ? { id: bond.b, name: bond.bn } : { id: bond.a, name: bond.an });

/**
 * Можно ли предложить такую связь: `""` — да, иначе причина словами.
 * Пара и брак — по одному на человека и исключают друг друга с другим человеком.
 */
export function bondProblem(bonds, kind, from, to) {
  const info = bondInfo(kind);
  if (same(from.id, to.id)) return "С собой — это не связь, а характер.";
  const between = bondsOf(bonds, from.id).filter(item => same(partnerOf(item, from.id).id, to.id));
  if (between.some(item => item.kind === kind)) return `Вы и ${to.name} — уже ${info.done.replace(/^теперь\s+/u, "")}.`;
  // Имена не склоняются: «У Маши» она сказать не возьмётся, поэтому — через двоеточие.
  for (const [who, other, mine] of [[from, to, true], [to, from, false]]) {
    const own = bondsOf(bonds, who.id);
    if (info.romantic) {
      const taken = own.find(item => bondInfo(item.kind).romantic && !same(partnerOf(item, who.id).id, other.id));
      if (taken) {
        return mine
          ? `У вас уже есть ${bondInfo(taken.kind).title}: ${partnerOf(taken, who.id).name}. Сначала — «расстаться» или «развестись».`
          : `Не выйдет. ${who.name}: ${bondInfo(taken.kind).title} уже есть — ${partnerOf(taken, who.id).name}.`;
      }
    } else if (own.filter(item => item.kind === kind).length >= info.max) {
      return mine ? `Таких связей у вас уже ${info.max} — это предел.` : `Не выйдет. ${who.name}: таких связей уже ${info.max} — это предел.`;
    }
  }
  return "";
}

/** Кнопки под предложением: нажать может только тот, кого спрашивают. */
export const bondKeyboard = (id) => ({ inline_keyboard: [[{ text: "Да", callback_data: `r:y:${id}` }, { text: "Нет", callback_data: `r:n:${id}` }]] });
