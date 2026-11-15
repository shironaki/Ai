/**
 * То, что делается словом и ничего не стоит: ролевые действия, приветствие
 * новичков, опросы, «мой айди», настройки чата.
 *
 * Разбор фраз — в `rp.js`, `polls.js`, `whois.js`; здесь то, что отправляется
 * в Telegram. Сердце зовёт эти функции из своего порядка разбора и получает
 * либо результат, либо null — «это не моё, иди дальше».
 */
import { parseAction, lineFor, selfLine, reactionFor, willingness, levelOf, listText, parseEmote, emoteLine, KIND_NAME, dative, ACTIONS as RP_ACTIONS } from "./rp.js";
import { parsePoll, pollFromModel } from "./polls.js";
import { parseWhois, registeredText } from "./whois.js";
import { safeName } from "./address.js";
import { fold } from "./sources.js";
import { pickSticker } from "./pictures.js";
import { QUESTIONS } from "./data/party.js";
import {
  parseOwn, ownActionProblem, matchOwn, actionKeyOf, gifKeyOf, OWN_ACTIONS_MAX, OWN_GIFS_MAX,
  parseBond, bondInfo, bondsOf, partnerOf, bondProblem, bondKeyboard, BONDS, BONDS_KEY, BOND_ASK_TTL_MS,
} from "./chatown.js";

export const CHAT_KEY = (chatId) => `heart:chat:${chatId}`;
const DEFAULTS = Object.freeze({ rp: true, gifs: true, welcome: true, welcomeText: "", quietUntil: 0, tone: "" });

const MINUTE = 60_000;
const QUIET = /^(?:помолчи|замолчи|молчи|тихо|тише|цыц|не\s+(?:пиши|отвечай|говори|шуми)|отдохни|тихий\s+час|объяви\s+тихий\s+час)(?:те)?(?:\s+(?:пожалуйста|тут|здесь|пока|немного|чуть-чуть|в\s+(?:этом\s+)?чате))*(?:\s+(?:на\s+)?(полчаса|сутки|день|(\d{1,3})?\s*(минут[уы]?|мин|час(?:а|ов)?|ч)))?$/u;
const SPEAK = /^(?:можешь\s+говорить|можно\s+говорить|говори|отомри|вернись|хватит\s+молчать|не\s+молчи|просыпайся|тихий\s+час\s+(?:окончен|закончен|закончился|кончился)|(?:отмени|сними|закончи|хватит)\s+тих(?:ий|ого)\s+час(?:а)?|конец\s+тихого\s+часа)$/u;
/** «…до 8:00», «…до 8 утра», «…до утра»: тишина до часа на часах, а не на срок. */
const QUIET_UNTIL = /^(.+?)\s+до\s+(?:(\d{1,2})(?:[:.](\d{2}))?(?:\s*(?:часов|часа|ч))?(?:\s+(утра|вечера|ночи|дня))?|(утра|вечера|полуночи|обеда))$/u;
const QUIET_WORD_HOURS = Object.freeze({ "утра": 8, "вечера": 18, "полуночи": 0, "обеда": 13 });
const QUESTION = /^(?:(?:задай|подкинь|дай|предложи)(?:те)?\s+(?:нам\s+|мне\s+|чату\s+)?(?:вопрос(?:\s+дня)?|тему(?:\s+для\s+(?:разговора|обсуждения|беседы))?)|вопрос\s+дня|тема\s+дня|(?:о\s+чем|про\s+что)\s+(?:бы\s+)?(?:нам\s+)?поговорить)$/u;
const QUESTION_MORE = /^(?:(?:еще|другой|следующий)\s+вопрос|(?:еще|другую|следующую)\s+тему|другой\s+вопрос\s+дня)$/u;

/** «Помолчи час» → на сколько миллисекунд. Не про тишину — null. */
export function parseQuiet(text) {
  const value = fold(text).replace(/[.!…]+$/u, "");
  if (SPEAK.test(value)) return { speak: true };
  // «Помолчи до 8:00» — тихий час до времени на часах: ближайшие 8:00, сегодня или завтра.
  const clocked = value.match(QUIET_UNTIL);
  if (clocked && QUIET.test(clocked[1])) {
    if (clocked[5]) return { at: { hh: QUIET_WORD_HOURS[clocked[5]], mm: 0 } };
    let hh = Number(clocked[2]);
    const mm = Number(clocked[3] ?? 0);
    if ((clocked[4] === "вечера" || clocked[4] === "дня") && hh < 12) hh += 12;
    if (clocked[4] === "ночи" && hh === 12) hh = 0;
    return hh <= 23 && mm <= 59 ? { at: { hh, mm } } : null;
  }
  const match = value.match(QUIET);
  if (!match) return null;
  const [, span, count, unit] = match;
  let ms = 60 * MINUTE;
  if (span === "полчаса") ms = 30 * MINUTE;
  else if (span === "сутки" || span === "день") ms = 24 * 60 * MINUTE;
  else if (unit) ms = (Number(count) || 1) * (unit.startsWith("ч") ? 60 : 1) * MINUTE;
  // Дольше суток молчать не просят — так бота проще убрать из чата.
  return { ms: Math.min(Math.max(ms, MINUTE), 24 * 60 * MINUTE) };
}

/** «Вопрос дня» → { more } или null. */
/** Кнопка под вопросом дня: следующий вопрос без слов. */
export const MORE_QUESTION = Object.freeze({ inline_keyboard: [[{ text: "Ещё вопрос", callback_data: "a:q" }]] });

export function parseQuestion(text) {
  const value = fold(text).replace(/[?.!…]+$/u, "");
  if (QUESTION_MORE.test(value)) return { more: true };
  return QUESTION.test(value) ? { more: false } : null;
}

const span = (ms) => {
  const minutes = Math.round(ms / MINUTE);
  if (minutes % 60 || minutes < 60) return `${minutes} мин`;
  const hours = minutes / 60;
  return hours === 24 ? "сутки" : `${hours} ч`;
};
const esc = (value) => String(value ?? "").replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");

const WELCOMES = Object.freeze([
  "{имя}, добро пожаловать. Я Аи — если что, зовите по имени.",
  "О, новое лицо. {имя}, располагайтесь.",
  "{имя}, привет. Здесь не кусаются. Ну, почти.",
  "Добро пожаловать, {имя}. Я Аи: со мной можно просто говорить.",
]);

const OFF = "(?:выключи|отключи|убери|выруби|запрети)(?:те)?";
const ON = "(?:включи|верни|разреши)(?:те)?";
const RP_WORD = "(?:рп|rp|ролев(?:ые|ку|ки|ая)(?:\\s+(?:действия|игра))?|рп-действия|действия)";
const GIF_WORD = "(?:гифки|гифок|гиф|gif|анимации)";

/**
 * Настройка чата словами. Возвращает `{ patch }`, `{ show }` или null.
 * Менять может админ чата или хозяин — это проверяет сердце.
 */
const WHERE = "(?:\\s+(?:тут|здесь|в\\s+(?:этом\\s+)?чате|в\\s+(?:этой\\s+)?группе))?";
const TONES = Object.freeze([
  ["serious", "(?:по)?серьезн(?:ее|ой|о)|(?:по)?строже|строгой|без\\s+шуток"],
  ["playful", "(?:по)?весел(?:ее|ой)|шутлив(?:ее|ой)|игрив(?:ее|ой)|с\\s+шутками"],
  ["brief", "(?:по)?короче|кратк(?:ой|о)|лаконичн(?:ее|ой|о)"],
  ["", "как\\s+обычно|обычной|собой|самой\\s+собой"],
]);
export const TONE_LABEL = Object.freeze({ serious: "серьёзной: по делу и без шуток", playful: "повеселее: шутки к месту", brief: "краткой: две-три фразы" });
/** Что манера чата значит для модели. */
export const TONE_LINE = Object.freeze({
  serious: "Админы этого чата просили тебя быть здесь серьёзной: по делу, без шуток и заигрываний.",
  playful: "Админы этого чата просили тебя быть здесь повеселее: лёгкий тон, шутки к месту.",
  brief: "Админы этого чата просили тебя отвечать здесь коротко: две-три фразы.",
});

export function parseChatSetting(text) {
  const raw = String(text ?? "").trim();
  const value = fold(raw).replace(/[.!…]+$/u, "");
  const custom = raw.match(/^(?:(?:поставь|установи|задай|запомни|смени)(?:те)?\s+)?приветствие(?:\s+для\s+новичков)?\s*[:—–-]\s*([\s\S]{3,600})$/iu);
  if (custom) return { patch: { welcome: true, welcomeText: custom[1].trim() }, done: "Приветствие запомнила. Вместо {имя} подставлю имя новичка, вместо {чат} — название чата." };
  if (new RegExp(`^(?:${OFF}\\s+приветстви[ея]|не\\s+приветствуй(?:те)?(?:\\s+новичков|\\s+новых)?|без\\s+приветстви[йя])$`, "u").test(value)) return { patch: { welcome: false }, done: "Новичков больше не приветствую." };
  if (new RegExp(`^(?:${ON}\\s+приветстви[ея]|приветствуй(?:те)?\\s+(?:новичков|новых))$`, "u").test(value)) return { patch: { welcome: true }, done: "Буду встречать новичков." };
  if (/^(?:сбрось|верни)(?:те)?\s+(?:свое\s+|обычное\s+|стандартное\s+)?приветствие$|^приветствие\s+по\s+умолчанию$/u.test(value)) return { patch: { welcome: true, welcomeText: "" }, done: "Вернула своё приветствие." };
  if (/^(?:(?:покажи|какое|как\s+выглядит)\s+)?приветствие(?:\s+(?:для\s+новичков|в\s+чате|тут|здесь))?$/u.test(value)) return { show: "welcome" };
  if (new RegExp(`^(?:${OFF}\\s+${RP_WORD}|без\\s+${RP_WORD}|${RP_WORD}\\s+выкл(?:ючи)?)$`, "u").test(value)) return { patch: { rp: false }, done: "Ролевые действия в этом чате выключены." };
  if (new RegExp(`^(?:${ON}\\s+${RP_WORD}|${RP_WORD}\\s+вкл(?:ючи)?)$`, "u").test(value)) return { patch: { rp: true }, done: "Ролевые действия включены: ответом на сообщение — «обнять», «пнуть», «поцеловать»…" };
  if (new RegExp(`^(?:${RP_WORD}\\s+без\\s+${GIF_WORD}|${OFF}\\s+${GIF_WORD}|без\\s+${GIF_WORD})$`, "u").test(value)) return { patch: { gifs: false }, done: "Хорошо, действия — только словами, без гифок." };
  if (new RegExp(`^(?:${RP_WORD}\\s+с\\s+(?:гифками|гиф|gif)|${ON}\\s+${GIF_WORD}|с\\s+гифками)$`, "u").test(value)) return { patch: { gifs: true }, done: "Гифки к действиям вернула." };
  if (/^(?:(?:покажи|какие)\s+)?настройки\s+(?:чата|группы|беседы)$/u.test(value)) return { show: "all" };
  // Манера в этом чате: «будь серьёзнее», «будь веселее», «говори короче».
  for (const [tone, words] of TONES) {
    if (new RegExp(`^(?:будь|говори|общайся|веди\\s+себя|отвечай)${WHERE}\\s+(?:${words})${WHERE}$`, "u").test(value)) {
      return { patch: { tone }, tone: true, done: tone ? `Хорошо, в этом чате буду ${TONE_LABEL[tone]}. Вернуть — «будь как обычно».` : "Хорошо, в этом чате снова говорю как обычно." };
    }
  }
  return null;
}

const RP_LIST = /^(?:(?:какие|покажи|список|дай)\s+)*(?:есть\s+)?(?:рп|rp)(?:\s*-?\s*(?:действия|команды|действий|команд))?(?:\s+есть)?$|^(?:что\s+за\s+)?(?:рп|ролевые)\s+(?:действия|команды)$|^список\s+(?:рп|действий)$/u;

export function createFun({
  api = null, store = null, sources = null, policy = null, personal = null, pulse = null,
  random = Math.random, now = () => Date.now(), owner = () => false, has = () => false,
  name = "Аи", say = async () => ({ ok: false }), react = async () => false, compose = async () => null,
  book = null, bond = null, voice = (turn, text) => text, likes = async () => true, bookCtx = () => ({}),
  isMinor = async () => false,
  // «До 8:00» по часам того, кто просит: ближайший такой час → { until, clock } (от сердца).
  untilClock = null,
} = {}) {
  const ACTION_TITLE = (key) => RP_ACTIONS.find(item => item.key === key)?.title ?? key;
  const pick = (list) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
  const thread = (turn) => (turn.extra?.message_thread_id != null ? { message_thread_id: turn.extra.message_thread_id } : {});

  // ── настройки чата ──────────────────────────────────────────────────────
  async function chatSettings(chatId) {
    let saved = null;
    try { saved = store?.available ? await store.get(CHAT_KEY(chatId)) : null; } catch { saved = null; }
    return { ...DEFAULTS, ...(saved && typeof saved === "object" ? saved : {}) };
  }
  async function saveChat(chatId, patch) {
    if (!store?.available) return false;
    const before = await store.get(CHAT_KEY(chatId)).catch(() => null);
    return store.set(CHAT_KEY(chatId), { ...(before && typeof before === "object" ? before : {}), ...patch, at: now() });
  }

  /** Может ли человек менять настройки чата: хозяин, личка, админ группы. */
  const adminSeen = new Map();
  async function canManage(turn) {
    if (owner(turn.actorId) || turn.isPrivate) return true;
    const key = `${turn.chatId}:${turn.actorId}`;
    const cached = adminSeen.get(key);
    if (cached && now() - cached.at < 5 * 60_000) return cached.ok;
    let ok = false;
    if (has("getChatMember")) {
      try {
        const member = await api.getChatMember({ chat_id: turn.chatId, user_id: turn.actorId });
        ok = member?.status === "creator" || member?.status === "administrator";
      } catch { ok = false; }
    }
    if (adminSeen.size > 256) adminSeen.clear();
    adminSeen.set(key, { ok, at: now() });
    return ok;
  }

  async function chatSetting(turn, prompt) {
    const asked = parseChatSetting(prompt);
    if (!asked) return null;
    // Манеру чата задаёт админ группы; у остальных и в личке это просьба к
    // разговору — на неё ответит она сама.
    if (asked.tone && (turn.isPrivate || turn.dry || !(await canManage(turn)))) return null;
    if (turn.dry) return say(turn, "Разобрала бы это как настройку чата — репетиция, ничего не меняю.");
    const current = await chatSettings(turn.chatId);
    if (asked.show === "welcome") {
      if (turn.isPrivate) return say(turn, "Приветствие — для групп: там я встречаю новичков. В группе админ может сказать «Аи, приветствие: …».");
      return say(turn, !current.welcome ? "Новичков я сейчас не приветствую. Включить — «Аи, включи приветствие»."
        : current.welcomeText ? `Сейчас встречаю так:\n\n${current.welcomeText}` : `Встречаю своими словами, например:\n\n${WELCOMES[0].replace("{имя}", "Имя")}\n\nСвоё — «Аи, приветствие: Привет, {имя}! Правила в закрепе».`);
    }
    if (asked.show === "all") {
      return say(turn, [
        "Настройки этого чата:",
        `• ролевые действия — ${current.rp ? "включены" : "выключены"};`,
        `• гифки к действиям — ${current.gifs ? "да" : "нет"};`,
        current.tone && TONE_LABEL[current.tone] ? `• манера — ${TONE_LABEL[current.tone].replace(/:.*$/u, "")};` : "",
        Number(current.quietUntil) > now() ? `• молчу ещё ${span(Math.ceil((Number(current.quietUntil) - now()) / MINUTE) * MINUTE)};` : "",
        turn.isPrivate ? "" : `• приветствие новичков — ${!current.welcome ? "выключено" : current.welcomeText ? "своё" : "моими словами"}.`,
        "",
        "Менять может админ: «выключи рп», «рп без гифок», «приветствие: …», «выключи приветствие».",
      ].filter((line, index, all) => line !== "" || index === all.length - 2).join("\n"));
    }
    if (!(await canManage(turn))) return say(turn, "Настройки чата меняют его админы.");
    if (turn.isPrivate && ("welcome" in asked.patch)) return say(turn, "Приветствие — для групп. Скажите это в группе, где вы админ.");
    const saved = await saveChat(turn.chatId, asked.patch);
    return say(turn, saved ? asked.done : "Не запомнилось: хранилище не отвечает.");
  }

  // ── тишина ──────────────────────────────────────────────────────────────
  /** Молчит ли она сейчас в этом чате. */
  async function quiet(chatId) {
    const until = Number((await chatSettings(chatId)).quietUntil) || 0;
    return until > now() ? until : 0;
  }

  /**
   * «Помолчи час» и «можешь говорить». Только для групп: в личке она и так
   * пишет лишь в ответ. Просит админ; снять тишину может он же.
   */
  async function hush(turn, prompt) {
    const asked = parseQuiet(prompt);
    if (!asked) return null;
    if (turn.dry) return say(turn, "Разобрала бы это как просьбу о тишине — репетиция, ничего не меняю.");
    if (turn.isPrivate) {
      return asked.speak ? null : say(turn, "В личке я пишу только в ответ — молчать здесь не от чего. Ночные вести отключает «не пиши ночью», в группе тишину просит админ: «Аи, помолчи час».");
    }
    const until = await quiet(turn.chatId);
    if (asked.speak) {
      if (!until) return null;
      if (!(await canManage(turn))) return { ignored: true, reason: "quiet" };
      await saveChat(turn.chatId, { quietUntil: 0 });
      return say(turn, "Я снова здесь.");
    }
    if (!(await canManage(turn))) return say(turn, "Замолчать меня просят админы чата. Но я постараюсь не мешать.");
    if (asked.at) {
      const moment = typeof untilClock === "function" ? untilClock(turn, asked.at) : null;
      if (!moment?.until) return say(turn, "До часа на часах молчать не умею: скажите срок — «помолчи час».");
      const kept = await saveChat(turn.chatId, { quietUntil: moment.until });
      return say(turn, kept ? `Тихий час: молчу до ${moment.clock}. Раньше — «Аи, можешь говорить».` : "Не запомнилось: хранилище не отвечает.");
    }
    const saved = await saveChat(turn.chatId, { quietUntil: now() + asked.ms });
    return say(turn, saved ? `Молчу ${span(asked.ms)}. Раньше — «Аи, можешь говорить».` : "Не запомнилось: хранилище не отвечает.");
  }

  // ── вопрос дня ──────────────────────────────────────────────────────────
  /**
   * Вопрос дня для чата — текстом. Один на день и чат; `more` — следующий по
   * кругу. Им пользуются и слова («вопрос дня»), и кнопка «Ещё вопрос», и
   * утренняя рассылка в чатах, где о ней попросили.
   */
  async function questionFor(chatId, { more = false, day = "" } = {}) {
    const key = `heart:question:${chatId}`;
    const saved = store?.available ? await store.get(key).catch(() => null) : null;
    const days = Math.floor(Date.parse(`${day || new Date(now()).toISOString().slice(0, 10)}T00:00:00Z`) / 86_400_000) || 0;
    // Сдвиг по чату: в двух чатах в один день вопросы разные.
    const base = Math.abs(days + Math.abs(Number(chatId) || 0) % 97) % QUESTIONS.length;
    const same = saved?.day === days;
    const step = same ? (Number(saved.step) || 0) + (more ? 1 : 0) : 0;
    if (store?.available && (!same || more)) await store.set(key, { day: days, step, at: now() }).catch(() => false);
    pulse?.bump("questions");
    return `💬 ${step ? "Ещё вопрос" : "Вопрос дня"}:\n${QUESTIONS[(base + step) % QUESTIONS.length]}`;
  }

  async function question(turn, prompt, { day = "" } = {}) {
    const asked = parseQuestion(prompt);
    if (!asked) return null;
    if (turn.dry) return say(turn, "Задала бы вопрос дня — репетиция.");
    return say(turn, await questionFor(turn.chatId, { more: asked.more, day }), { extra: { reply_markup: MORE_QUESTION } });
  }

  // ── отправка ────────────────────────────────────────────────────────────
  async function post(turn, html, { reply = false } = {}) {
    try {
      await api.sendMessage({ chat_id: turn.chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true, ...(reply ? turn.extra : thread(turn)) });
      turn.delivered = true;
      return true;
    } catch { return false; }
  }
  /**
   * Гифка с подписью; не вышло — подпись словами. `own` — свои гифки чата к
   * этому действию: они идут вместо аниме и от «не люблю аниме» не зависят.
   */
  async function show(turn, category, html, { reply = false, gifs = true, own = null } = {}) {
    if (Array.isArray(own) && own.length && has("sendAnimation")) {
      try {
        await api.sendAnimation({ chat_id: turn.chatId, animation: pick(own), caption: html, parse_mode: "HTML", ...(reply ? turn.extra : thread(turn)) });
        turn.delivered = true;
        return "gif";
      } catch { /* своя гифка не ушла — дальше как обычно */ }
    }
    if (gifs && category && sources && has("sendAnimation")) {
      const url = await sources.gesture(category).catch(() => null);
      if (url) {
        try {
          await api.sendAnimation({ chat_id: turn.chatId, animation: url, caption: html, parse_mode: "HTML", ...(reply ? turn.extra : thread(turn)) });
          turn.delivered = true;
          return "gif";
        } catch { /* гифка не ушла — останутся слова */ }
      }
    }
    return (await post(turn, html, { reply })) ? "text" : null;
  }
  async function ownSticker(turn, mood) {
    if (!has("sendSticker") || !store?.available) return false;
    const shelf = (await store.get("heart:stickers:own").catch(() => null))?.shelf;
    const chosen = pickSticker(shelf, [mood], random);
    if (!chosen) return false;
    try { await api.sendSticker({ chat_id: turn.chatId, sticker: chosen.id, ...thread(turn) }); return true; } catch { return false; }
  }

  // ── ролевые действия ────────────────────────────────────────────────────
  const label = (person) => (person.id != null
    ? `<a href="tg://user?id=${Number(person.id)}">${esc(person.name || "кто-то")}</a>`
    : person.username ? `@${esc(person.username)}` : esc(person.name || "кто-то"));

  /** На кого направлено действие: упоминание, ответ на сообщение. */
  function targetOf(turn, parsed, self) {
    const message = turn.message ?? {};
    const selfName = String(self?.username ?? "").toLowerCase();
    if (parsed.mention) return selfName && parsed.mention === selfName ? { self: true } : { username: parsed.mention, name: `@${parsed.mention}` };
    const mentioned = (message.entities ?? []).find(item => item?.type === "text_mention" && item.user?.id != null)?.user;
    if (mentioned) return { id: mentioned.id, name: safeName(mentioned.first_name), bot: mentioned.is_bot === true };
    const reply = message.reply_to_message;
    // Ответ в теме форума на её заголовок — не ответ человеку.
    if (!reply?.from || reply.forum_topic_created || reply.is_automatic_forward) return null;
    if (turn.replyToMe || (self?.id != null && String(reply.from.id) === String(self.id))) return { self: true };
    return { id: reply.from.id, name: safeName(reply.from.first_name), bot: reply.from.is_bot === true };
  }

  async function levelWith(userId) {
    if (owner(userId)) return "owner";
    if (!policy || userId == null) return "first";
    try { return levelOf((await policy.state(userId, { initialize: false })).score); } catch { return "first"; }
  }

  /**
   * Ролевое действие. `addressed` — фраза обращена к Аи (личка, имя, ответ
   * ей); иначе это действие между людьми в группе, и нужен явный адресат.
   */
  /** Не больше восьми строк действий в минуту на чат. */
  async function underFlood(turn) {
    if (!store?.available) return true;
    const key = `heart:rp:${turn.chatId}`;
    const seen = await store.get(key).catch(() => null);
    const fresh = seen && now() - Number(seen.from) < MINUTE;
    if (fresh && Number(seen.count) >= 8) return false;
    await store.set(key, { from: fresh ? seen.from : now(), count: fresh ? Number(seen.count) + 1 : 1 }).catch(() => false);
    return true;
  }

  async function roleplay(turn, prompt, { self = null, addressed = false } = {}) {
    if (addressed && RP_LIST.test(fold(prompt).replace(/[?!.…]+$/u, ""))) return say(turn, listText());
    // Упоминание человека без @имени Telegram присылает отдельно: само имя
    // в строке — адресат, а не подробность действия.
    const named = (turn.message?.entities ?? []).find(item => item?.type === "text_mention" && item.user?.id != null);
    const span = named && typeof turn.message?.text === "string" ? turn.message.text.slice(named.offset, named.offset + named.length) : "";
    const parsed = parseAction(span ? String(prompt).replace(span, " ") : prompt);
    // Эмоция без адресата: «танцевать», «*зеваю*». Только в группе и не в ответ кому-то.
    // В ответ на чьё-то сообщение слово без звёздочек — это слова человеку, а не эмоция.
    const starred = /^\s*[*_][^*_]+[*_]\s*$/u.test(String(prompt));
    const emote = !named && (!parsed || (!parsed.asked && !parsed.mention)) && (starred || !turn.message?.reply_to_message) ? parseEmote(prompt) : null;
    if (emote && turn.inGroup && !turn.dry) {
      const chat = await chatSettings(turn.chatId);
      if (!chat.rp && !owner(turn.actorId)) return addressed ? null : { ignored: true, reason: "rp_off" };
      if (!addressed && Number(chat.quietUntil) > now()) return { ignored: true, reason: "quiet" };
      if (!(await underFlood(turn))) return { ignored: true, reason: "rp_flood" };
      pulse?.bump("rp");
      const sent = await show(turn, emote.gif, emoteLine(emote, esc(turn.name || "Кто-то")), { gifs: chat.gifs && await likes(turn) });
      return sent ? { ok: true, action: "rp", kind: emote.key, emote: true, via: sent } : { ok: false, code: "send_failed" };
    }
    if (!parsed) return ownAction(turn, span ? String(prompt).replace(span, " ") : prompt, { self, addressed });
    const target = targetOf(turn, parsed, self);
    const third = target && !target.self ? target : null;
    // Между людьми: только изъявительное («обнял»), только с адресатом.
    if (!addressed && (parsed.asked || !third)) return null;
    if (turn.dry) return addressed ? say(turn, "Разобрала бы это как действие — репетиция, ничего не отправляю.") : null;
    const chat = turn.chat ?? await chatSettings(turn.chatId);
    const ownGifs = chat.gifs ? chat.ownGifs?.[gifKeyOf(parsed.action)] : null;
    // Её попросили помолчать — молчит и в чужих действиях.
    if (!addressed && Number(chat.quietUntil) > now()) return { ignored: true, reason: "quiet" };
    if (!chat.rp && !owner(turn.actorId)) return addressed ? null : { ignored: true, reason: "rp_off" };
    const actor = esc(turn.name || "Кто-то");
    const { action, tail } = parsed;

    // 1. Человек — человеку. От потока защищает счёт: не больше восьми строк
    // в минуту на чат — иначе одним словом её можно заставить засыпать беседу.
    if (!addressed) {
      if (!(await underFlood(turn))) return { ignored: true, reason: "rp_flood" };
      pulse?.bump("rp");
      const html = String(third.id) === String(turn.actorId) ? selfLine(action, actor) : lineFor(action, actor, label(third), { tail: esc(tail), bName: esc(third.name) });
      const sent = await show(turn, action.gif, html, { gifs: chat.gifs && await likes(turn), own: ownGifs });
      return sent ? { ok: true, action: "rp", kind: action.key, via: sent } : { ok: false, code: "send_failed" };
    }

    pulse?.bump("rp");
    const gifs = chat.gifs && await likes(turn);
    const manner = turn.manner ?? {};
    const mine = owner(turn.actorId);
    const formal = manner.formal !== false;
    const adult = manner.settings?.minor === true ? false : null;
    const flirt = manner.settings?.flirt !== false;

    // 2. Просят её: «поцелуй меня», «пни его».
    if (parsed.asked) {
      const askerLevel = levelOf(manner.score, { owner: mine });
      const level = third ? await levelWith(third.id) : askerLevel;
      const will = willingness(action, { level, asker: askerLevel, order: mine, adult, flirt, third: Boolean(third), formal });
      if (!will.ok) {
        const sent = await show(turn, will.gif, esc(voice(turn, will.text)), { reply: true, gifs });
        return { ok: Boolean(sent), action: "rp", kind: action.key, refused: true };
      }
      const object = third ?? { id: turn.actorId, name: turn.name };
      const html = `${lineFor(action, esc(name), label(object), { tail: esc(tail), bName: esc(object.name) })}${will.note ? `\n${esc(will.note)}` : ""}`;
      const sent = await show(turn, action.gif, html, { reply: !third, gifs, own: ownGifs });
      return sent ? { ok: true, action: "rp", kind: action.key, via: sent, by: "self" } : { ok: false, code: "send_failed" };
    }

    // 3. Действие обращено к ней: реакция по близости.
    // Слова — из словаря: запас самого действия («+реакция:обнять»), потом запас вида.
    const phrase = book ? (item) => {
      const ctx = bookCtx(turn);
      const own = book.pick(`+реакция:${item.title}`, ctx);
      return own && random() < 0.6 ? own : book.pick(`+реакция:${KIND_NAME[item.kind]}`, ctx) ?? own;
    } : null;
    const reaction = reactionFor(action, { score: manner.score, owner: mine, formal, adult: flirt ? adult : false, random, phrase });
    await react(turn, reaction.emoji);
    // Круглое число — повод сказать: «это уже десятый раз».
    let text = voice(turn, reaction.text);
    if (bond && reaction.level !== "cold") {
      const tally = await bond.count(turn.actorId, action.key).catch(() => ({ milestone: false }));
      const remark = tally.milestone && book ? book.pick("+веха:действие", bookCtx(turn, { "сколько": tally.n })) : null;
      if (remark) text = `${text}\n${remark}`;
    }
    const sent = await show(turn, reaction.gif, esc(text), { reply: true, gifs });
    if (sent === "text") await ownSticker(turn, reaction.mood);
    if (reaction.deed && policy) { try { await policy.recordDeed({ userId: turn.actorId, kind: reaction.deed }); } catch { /* шаг отношений подождёт */ } }
    return sent ? { ok: true, action: "rp", kind: action.key, via: sent, level: reaction.level } : { ok: false, code: "send_failed" };
  }

  // ── своё у чата: действия и гифки ───────────────────────────────────────
  /**
   * Своё действие чата: «угостить печенькой» ответом на сообщение или с
   * @именем. Работает только в группе; без адресата — не действие, а слова.
   */
  async function ownAction(turn, text, { self = null, addressed = false } = {}) {
    if (!turn.inGroup || turn.dry) return null;
    // Без адресата своё действие не срабатывает — и в базу за ним ходить незачем.
    const message = turn.message ?? {};
    const pointed = Boolean(message.reply_to_message) || /@[A-Za-z0-9_]{3,32}/u.test(String(text)) || (message.entities ?? []).some(item => item?.type === "text_mention");
    if (!pointed) return null;
    const chat = turn.chat ?? await chatSettings(turn.chatId);
    const parsed = matchOwn(text, chat.acts);
    if (!parsed) return null;
    if (!chat.rp && !owner(turn.actorId)) return addressed ? null : { ignored: true, reason: "rp_off" };
    if (!addressed && Number(chat.quietUntil) > now()) return { ignored: true, reason: "quiet" };
    const target = targetOf(turn, parsed, self);
    if (!target) return null;
    if (!(await underFlood(turn))) return { ignored: true, reason: "rp_flood" };
    pulse?.bump("rp");
    const actor = esc(turn.name || "Кто-то");
    const { action, tail } = parsed;
    const own = chat.gifs ? chat.ownGifs?.[gifKeyOf(action)] : null;
    let html;
    if (target.self) {
      // Действие обращено к ней: строка та же, и короткое слово от неё.
      const word = book?.pick("+реакция:своё", bookCtx(turn)) ?? "Ого. Такого со мной ещё не делали.";
      html = `${lineFor(action, actor, esc(name), { tail: esc(tail), bName: esc(name) })}\n${esc(voice(turn, word))}`;
    } else if (target.id != null && String(target.id) === String(turn.actorId)) html = selfLine(action, actor);
    else html = lineFor(action, actor, label(target), { tail: esc(tail), bName: esc(target.name) });
    const sent = await show(turn, "", html, { gifs: false, own, reply: Boolean(target.self) });
    return sent ? { ok: true, action: "rp", kind: action.key, own: true, via: sent } : { ok: false, code: "send_failed" };
  }

  /** Слова админа: «новое действие: … — …», «наши действия», «это для обнять», «убери гифки для …». */
  async function own(turn, prompt) {
    const asked = parseOwn(prompt);
    if (!asked) return null;
    // «Это для …» — слова обычные: вне группы и без известного действия это не просьба.
    if (!turn.inGroup) return asked.loose ? null : say(turn, "Свои действия и гифки заводятся в группе: там они и работают.");
    const chat = turn.chat ?? await chatSettings(turn.chatId);
    const acts = Array.isArray(chat.acts) ? chat.acts : [];
    const shelf = chat.ownGifs && typeof chat.ownGifs === "object" ? chat.ownGifs : {};
    const title = asked.gifFor ?? asked.gifDrop;
    const hit = title ? actionKeyOf(title, acts) : null;
    if (asked.loose && !hit) return null;
    if (turn.dry) return say(turn, "Разобрала бы это как настройку своих действий чата — репетиция.");
    if (asked.list) {
      if (!acts.length) return say(turn, "Своих действий в этом чате пока нет. Добавить может админ: «новое действие: угостить печенькой — угощает печенькой».");
      return say(turn, `Свои действия этого чата:\n${acts.map((item, index) => `${index + 1}. ${item.say.join(" / ")} — «${item.verb}»`).join("\n")}\n\nРаботают как остальные: ответом на сообщение или с @именем.`);
    }
    if (asked.gifList) {
      const rows = Object.entries(shelf).filter(([, list]) => Array.isArray(list) && list.length);
      if (!rows.length) return say(turn, "Своих гифок в этом чате пока нет. Админ может ответить на гифку словами «это для обнять» — и к этому действию пойдёт она.");
      return say(turn, `Свои гифки этого чата:\n${rows.map(([key, list]) => `• ${key.startsWith("own:") ? key.slice(4) : ACTION_TITLE(key)} — ${list.length}`).join("\n")}\n\nУбрать — «убери гифки для обнять».`);
    }
    if (!(await canManage(turn))) return say(turn, "Своё в этом чате настраивают админы.");
    if (asked.bad) return say(turn, asked.bad);
    if (asked.add) {
      if (acts.length >= OWN_ACTIONS_MAX) return say(turn, `Своих действий в чате уже ${OWN_ACTIONS_MAX} — это предел. Лишнее можно убрать: «убери действие …».`);
      const problem = ownActionProblem(asked.add, acts);
      if (problem) return say(turn, problem);
      if (!await saveChat(turn.chatId, { acts: [...acts, asked.add] })) return say(turn, "Не запомнилось: хранилище не отвечает.");
      const sample = lineFor({ key: "own", emoji: asked.add.emoji || "✨", verb: asked.add.verb, tail: "", how: asked.add.how }, turn.name || "Вася", "Маша", { bName: "Маша" });
      return say(turn, `Запомнила действие «${asked.add.say[0]}». Выглядеть будет так: ${sample}\nРаботает как остальные — ответом на сообщение или с @именем.`);
    }
    if (asked.drop != null) {
      const index = typeof asked.drop === "number" ? asked.drop - 1 : acts.findIndex(item => item.say.includes(asked.drop));
      if (!(index >= 0 && index < acts.length)) return say(turn, "Такого своего действия в этом чате нет. Список — «наши действия».");
      const gone = acts[index];
      const { [`own:${gone.say[0]}`]: _dropped, ...rest } = shelf;
      if (!await saveChat(turn.chatId, { acts: acts.filter((_, at) => at !== index), ownGifs: rest })) return say(turn, "Не убралось: хранилище не отвечает.");
      return say(turn, `Убрала действие «${gone.say[0]}».`);
    }
    if (!hit) return say(turn, "Такого действия я не знаю. Мои — «какие есть рп», свои этого чата — «наши действия».");
    if (asked.gifDrop) {
      if (!shelf[hit.key]?.length) return say(turn, `Своих гифок для «${hit.title}» здесь и не было.`);
      const { [hit.key]: _gone, ...rest } = shelf;
      if (!await saveChat(turn.chatId, { ownGifs: rest })) return say(turn, "Не убралось: хранилище не отвечает.");
      return say(turn, `Убрала свои гифки для «${hit.title}». Дальше — как раньше.`);
    }
    const clip = turn.message?.reply_to_message?.animation;
    if (!clip?.file_id) return say(turn, "Ответьте этими словами на саму гифку — её и запомню.");
    const before = Array.isArray(shelf[hit.key]) ? shelf[hit.key] : [];
    const list = [...before.filter(id => id !== clip.file_id), clip.file_id].slice(-OWN_GIFS_MAX);
    if (!await saveChat(turn.chatId, { ownGifs: { ...shelf, [hit.key]: list } })) return say(turn, "Не запомнилось: хранилище не отвечает.");
    return say(turn, `Запомнила: к «${hit.title}» в этом чате теперь идёт эта гифка${list.length > 1 ? ` (своих к нему — ${list.length}, выбираю случайную)` : ""}. Убрать — «убери гифки для ${hit.title}».`);
  }

  // ── связи: пары, браки, названая семья, лучшие друзья ───────────────────
  const loadBonds = async (chatId) => {
    const saved = store?.available ? await store.get(BONDS_KEY(chatId)).catch(() => null) : null;
    return { bonds: Array.isArray(saved?.bonds) ? saved.bonds : [], asks: (Array.isArray(saved?.asks) ? saved.asks : []).filter(item => now() - Number(item.at) < BOND_ASK_TTL_MS) };
  };
  const saveBonds = (chatId, data) => store.set(BONDS_KEY(chatId), { bonds: data.bonds.slice(-300), asks: data.asks.slice(-30), at: now() });
  const bondLine = (item) => `${bondInfo(item.kind).emoji} ${esc(item.an)} и ${esc(item.bn)} — ${bondInfo(item.kind).title}`;

  /**
   * «Пара», «брак», «семья», «лучшие друзья» — ответом на сообщение человека.
   * Связь появляется только после его собственного «Да». Наград нет.
   */
  async function bonds(turn, prompt, { self = null } = {}) {
    const asked = turn.inGroup ? parseBond(prompt) : null;
    if (!asked) return null;
    if (turn.dry) return say(turn, "Разобрала бы это как слова о парах чата — репетиция.");
    if (!store?.available) return say(turn, "Пары я сейчас не веду: хранилище не отвечает.");
    const data = await loadBonds(turn.chatId);
    if (asked.list) {
      if (!data.bonds.length) return say(turn, "В этом чате пока никто ни с кем. Начать — ответить на сообщение человека: «Аи, пара», «Аи, брак», «Аи, семья», «Аи, лучшие друзья».");
      const rows = BONDS.flatMap(info => data.bonds.filter(item => item.kind === info.key).map(bondLine));
      return post(turn, `Кто с кем в этом чате:\n${rows.slice(0, 40).join("\n")}${rows.length > 40 ? `\n…и ещё ${rows.length - 40}` : ""}`, { reply: true }).then(ok => (ok ? { ok: true, action: "bonds" } : { ok: false, code: "send_failed" }));
    }
    const mineBonds = bondsOf(data.bonds, turn.actorId);
    if (asked.mine) {
      if (!mineBonds.length) return say(turn, "Здесь вы пока ни с кем. Ответьте на сообщение человека: «Аи, пара» — и я спрошу его.");
      return say(turn, `Ваши связи в этом чате:\n${mineBonds.map(item => `${bondInfo(item.kind).emoji} ${bondInfo(item.kind).title} — ${partnerOf(item, turn.actorId).name}`).join("\n")}`);
    }
    const mention = (String(prompt).match(/@([A-Za-z0-9_]{3,32})/u)?.[1] ?? "").toLowerCase() || null;
    const target = targetOf(turn, { mention }, self);
    if (asked.leave) {
      const kinds = mineBonds.filter(item => item.kind === asked.leave);
      const chosen = target?.id != null ? kinds.find(item => String(partnerOf(item, turn.actorId).id) === String(target.id)) : kinds.length === 1 ? kinds[0] : null;
      if (!kinds.length) return say(turn, "Такой связи у вас здесь нет.");
      if (!chosen) return say(turn, "С кем именно? Ответьте этими словами на сообщение человека.");
      data.bonds = data.bonds.filter(item => item !== chosen);
      if (!await saveBonds(turn.chatId, data)) return say(turn, "Не записалось: хранилище не отвечает.");
      pulse?.bump("rp");
      return post(turn, `💔 ${esc(turn.name)} и ${esc(partnerOf(chosen, turn.actorId).name)} — больше не ${bondInfo(chosen.kind).title}.`, { reply: true }).then(ok => (ok ? { ok: true, action: "bond_end", kind: chosen.kind } : { ok: false, code: "send_failed" }));
    }
    // Предложение.
    const info = bondInfo(asked.propose);
    if (target?.self) return say(turn, "Со мной так не выйдет: я в этих списках не участвую. А между вами — пожалуйста.");
    if (!target) return say(turn, "Кому? Ответьте этими словами на сообщение человека — и я спрошу его.");
    if (target.id == null) return say(turn, "По одному @имени я человека не узнаю: ответьте этими словами на его сообщение.");
    if (target.bot) return say(turn, "С ботом связь не оформить.");
    if (info.romantic && (await isMinor(turn.actorId) || await isMinor(target.id))) return say(turn, "Пары и браки — для взрослых. Могу записать лучшими друзьями: «Аи, лучшие друзья».");
    const from = { id: turn.actorId, name: turn.name || "Кто-то" }, to = { id: target.id, name: target.name || "кто-то" };
    const problem = bondProblem(data.bonds, info.key, from, to);
    if (problem) return say(turn, problem);
    const id = `${now().toString(36)}${Math.floor(random() * 1296).toString(36)}`;
    data.asks = [...data.asks.filter(item => !(String(item.from) === String(from.id) && item.kind === info.key)), { id, kind: info.key, from: from.id, fn: from.name, to: to.id, tn: to.name, at: now() }];
    if (!await saveBonds(turn.chatId, data)) return say(turn, "Не записалось: хранилище не отвечает.");
    pulse?.bump("rp");
    // «Предлагает Маше»: имя склоняется только там, где нельзя ошибиться.
    const bent = dative(to.name);
    try {
      await api.sendMessage({
        chat_id: turn.chatId, parse_mode: "HTML", reply_markup: bondKeyboard(id), ...thread(turn),
        text: `${info.emoji} ${esc(from.name)} предлагает ${bent !== to.name ? label(to).replace(esc(to.name), esc(bent)) : label(to)} ${info.ask}.\n${esc(to.name)}, слово за вами — ответить можете только вы. Десять минут.`,
      });
      turn.delivered = true;
      return { ok: true, action: "bond_ask", kind: info.key, id };
    } catch { return { ok: false, code: "send_failed" }; }
  }

  /** Нажатие «Да» или «Нет» под предложением: считается только нажатие того, кого спросили. */
  async function pressBond(query) {
    const [, verdict, id] = String(query?.data ?? "").split(":");
    const chatId = query?.message?.chat?.id, userId = query?.from?.id;
    const toast = async (text) => { try { await api.answerCallbackQuery({ callback_query_id: query.id, ...(text ? { text } : {}) }); } catch { /* не страшно */ } };
    if (chatId == null || userId == null || !store?.available) { await toast(); return { ok: true, ignored: true }; }
    const data = await loadBonds(chatId);
    const ask = data.asks.find(item => item.id === id);
    const edit = async (text) => {
      try { await api.editMessageText({ chat_id: chatId, message_id: query.message.message_id, text, parse_mode: "HTML" }); }
      catch { try { await api.sendMessage({ chat_id: chatId, text, parse_mode: "HTML" }); } catch { /* слова не обязательны */ } }
    };
    if (!ask) {
      await toast("Это предложение уже не действует.");
      try { await api.editMessageReplyMarkup({ chat_id: chatId, message_id: query.message.message_id }); } catch { /* кнопки останутся — не беда */ }
      return { ok: true, ignored: true, reason: "expired" };
    }
    const info = bondInfo(ask.kind);
    // Тот, кто предлагал, может передумать — своим «Нет».
    if (String(userId) === String(ask.from) && verdict === "n") {
      data.asks = data.asks.filter(item => item !== ask);
      await saveBonds(chatId, data);
      await toast("Отозвано.");
      await edit(`${info.emoji} ${esc(ask.fn)} передумывает. Предложение снято.`);
      return { ok: true, action: "bond_withdrawn" };
    }
    if (String(userId) !== String(ask.to)) { await toast(`Спрашивают не вас. Ответить может только тот, кому предложили: ${ask.tn}.`); return { ok: true, ignored: true, reason: "foreign_button" }; }
    data.asks = data.asks.filter(item => item !== ask);
    if (verdict !== "y") {
      await saveBonds(chatId, data);
      await toast("Хорошо.");
      await edit(`${info.emoji} ${esc(ask.tn)} говорит «нет». ${esc(ask.fn)}, не в этот раз.`);
      return { ok: true, action: "bond_no", kind: ask.kind };
    }
    // Пока ждали ответа, всё могло измениться: проверяется заново.
    const problem = bondProblem(data.bonds, ask.kind, { id: ask.from, name: ask.fn }, { id: ask.to, name: ask.tn });
    if (problem) { await saveBonds(chatId, data); await toast("Уже не получится."); await edit(`${info.emoji} Не вышло: пока ждали ответа, всё изменилось.`); return { ok: true, ignored: true, reason: "stale" }; }
    data.bonds = [...data.bonds, { kind: ask.kind, a: ask.from, an: ask.fn, b: ask.to, bn: ask.tn, at: now() }];
    if (!await saveBonds(chatId, data)) { await toast("Не записалось: хранилище не отвечает."); return { ok: false, code: "storage_unavailable" }; }
    await toast("Да!");
    await edit(`${info.emoji} ${esc(ask.fn)} и ${esc(ask.tn)} — ${info.done}. Поздравляю.`);
    return { ok: true, action: "bond", kind: ask.kind };
  }

  // ── приветствие новичков ────────────────────────────────────────────────
  /**
   * Служебное сообщение «в чат вошли». Здоровается она сама, без моста. От
   * наплыва защищает счёт: не чаще раза в 15 секунд и шести раз за пять минут.
   */
  async function welcome(message, { self = null, dry = false } = {}) {
    const chat = message?.chat;
    const members = Array.isArray(message?.new_chat_members) ? message.new_chat_members : [];
    if (!chat?.id || !members.length || chat.type === "private" || chat.type === "channel") return { ignored: true };
    if (dry) return { ok: true, side_effects: "none" };
    const turn = { chatId: chat.id, extra: message.is_topic_message === true && message.message_thread_id != null ? { message_thread_id: message.message_thread_id } : {}, delivered: false };
    // Её саму добавили в чат: представиться — один раз и коротко.
    if (self?.id != null && members.some(item => String(item.id) === String(self.id))) {
      await post(turn, `Всем привет. Я ${esc(name)}. Со мной можно говорить по имени: «${esc(name)}, …». Что умею — «${esc(name)}, что ты умеешь».`);
      return { ok: true, action: "introduced" };
    }
    const people = members.filter(item => item && item.is_bot !== true);
    if (!people.length) return { ignored: true, reason: "bots_only" };
    const settings = await chatSettings(chat.id);
    if (!settings.welcome) return { ignored: true, reason: "welcome_off" };
    if (Number(settings.quietUntil) > now()) return { ignored: true, reason: "quiet" };
    if (store?.available) {
      const key = `heart:welcome:${chat.id}`;
      const seen = await store.get(key).catch(() => null);
      const at = now();
      const fresh = seen && at - Number(seen.from) < 5 * 60_000;
      if (seen && at - Number(seen.at) < 15_000) return { ignored: true, reason: "welcome_cooldown" };
      if (fresh && Number(seen.count) >= 6) return { ignored: true, reason: "welcome_flood" };
      await store.set(key, { at, from: fresh ? seen.from : at, count: fresh ? Number(seen.count) + 1 : 1 }).catch(() => false);
    }
    const names = people.slice(0, 5).map(item => label({ id: item.id, name: safeName(item.first_name) || "гость" })).join(", ");
    const template = settings.welcomeText || pick(WELCOMES);
    const html = esc(template).replace(/\{имя\}/giu, names).replace(/\{чат\}/giu, esc(chat.title ?? "чат"));
    // Своё приветствие могло не содержать «{имя}»: тогда имя идёт первым.
    const text = /\{имя\}/iu.test(template) ? html : `${names}, ${html}`;
    const sent = await post(turn, text);
    if (sent) pulse?.bump("welcomed");
    return sent ? { ok: true, action: "welcome", count: people.length } : { ok: false, code: "send_failed" };
  }

  // ── опросы ──────────────────────────────────────────────────────────────
  async function sendPoll(turn, poll) {
    if (!has("sendPoll")) return say(turn, "Опросы мне здесь недоступны.");
    try {
      await api.sendPoll({
        chat_id: turn.chatId,
        question: poll.question,
        options: poll.options.map(text => ({ text })),
        is_anonymous: poll.anonymous,
        ...(poll.quiz ? { type: "quiz", correct_option_id: poll.correct } : { allows_multiple_answers: poll.multiple }),
        ...thread(turn),
      });
      turn.delivered = true;
      pulse?.bump("polls");
      return { ok: true, action: "poll", options: poll.options.length };
    } catch (error) {
      const why = String(error?.description ?? "");
      return say(turn, /anonymous|channel|private/iu.test(why)
        ? "Telegram не дал создать такой опрос здесь: в канале опрос может быть только анонимным."
        : "Telegram не принял опрос. Проверьте, что вопрос и варианты не пустые и не слишком длинные.");
    }
  }

  async function poll(turn, prompt) {
    const asked = parsePoll(prompt);
    if (!asked) return null;
    if (turn.dry) return say(turn, "Разобрала бы это как просьбу об опросе — репетиция, ничего не создаю.");
    if (asked.error) return say(turn, asked.error);
    if (asked.stop) {
      const target = turn.message?.reply_to_message;
      if (!target?.poll) return say(turn, "Какой опрос закрыть? Ответьте этой фразой на сообщение с опросом.");
      if (!has("stopPoll")) return say(turn, "Закрывать опросы мне здесь недоступно.");
      try {
        const closed = await api.stopPoll({ chat_id: turn.chatId, message_id: target.message_id });
        const rows = (closed?.options ?? []).map(item => ({ text: String(item.text ?? ""), votes: Number(item.voter_count) || 0 })).sort((a, b) => b.votes - a.votes);
        const total = Number(closed?.total_voter_count) || rows.reduce((sum, item) => sum + item.votes, 0);
        if (!rows.length) return say(turn, "Опрос закрыт.");
        const top = rows[0].votes;
        const lead = rows.filter(item => item.votes === top && top > 0).map(item => `«${item.text}»`);
        return say(turn, [
          `Опрос закрыт. Голосов: ${total}.`,
          ...rows.map(item => `• ${item.text} — ${item.votes}`),
          "",
          !lead.length ? "Никто не проголосовал." : lead.length === 1 ? `Победил вариант ${lead[0]}.` : `Ничья: ${lead.join(" и ")}.`,
        ].join("\n"));
      } catch {
        return say(turn, "Закрыть не получилось: закрывать можно только опрос, который создала я.");
      }
    }
    if (asked.compose) {
      const topic = asked.topic || "что-нибудь интересное для этого чата";
      const answer = await compose(turn, `Придумай ${asked.quiz ? "вопрос викторины с одним верным ответом" : "опрос"} на тему: ${topic}. Ответь только так: первая строка — вопрос, затем от трёх до пяти строк — варианты, каждый с новой строки${asked.quiz ? ", перед верным вариантом поставь звёздочку" : ""}. Без нумерации, без пояснений, без приветствия.`);
      const built = answer ? pollFromModel(answer, { quiz: asked.quiz }) : null;
      if (!built) return say(turn, "Придумать не вышло: мне сейчас нечем думать или ответ не сложился в опрос. Можно продиктовать: «опрос: вопрос? вариант, вариант».");
      return sendPoll(turn, built);
    }
    return sendPoll(turn, asked);
  }

  // ── «мой айди», «когда он зарегистрировался» ────────────────────────────
  async function whois(turn, prompt, { self = null } = {}) {
    const asked = parseWhois(prompt);
    if (!asked) return null;
    const message = turn.message ?? {};
    if (asked.about === "chat") {
      if (turn.dry) return say(turn, "Назвала бы номер чата — репетиция.");
      // Пересланное из канала — номер того канала: так узнают ID «Моста».
      const origin = message.reply_to_message?.forward_origin?.chat ?? message.forward_origin?.chat ?? null;
      if (origin?.id != null) return say(turn, `Номер канала «${origin.title ?? "без названия"}»: ${origin.id}`);
      return say(turn, turn.isPrivate ? `Это личный чат, его номер совпадает с вашим: ${turn.chatId}` : `Номер этого чата: ${turn.chatId}`);
    }
    let person = null;
    if (asked.about === "other") {
      const target = targetOf(turn, { mention: (String(prompt).match(/@([A-Za-z0-9_]{3,32})/u)?.[1] ?? "").toLowerCase() || null }, self);
      const replied = message.reply_to_message;
      if (replied?.forward_origin?.chat?.id != null) {
        if (turn.dry) return say(turn, "Назвала бы номер канала — репетиция.");
        return say(turn, `Это переслано из канала «${replied.forward_origin.chat.title ?? "без названия"}», его номер: ${replied.forward_origin.chat.id}`);
      }
      if (target?.self) return turn.dry ? say(turn, "Рассказала бы о себе — репетиция.") : say(turn, `Это я, ${name}. Мой номер: ${self?.id ?? "не знаю — Telegram не ответил"}.`);
      if (target?.id != null) person = { ...(replied?.from && String(replied.from.id) === String(target.id) ? replied.from : {}), id: target.id, first_name: target.name };
      else if (target?.username) return turn.dry ? say(turn, "Объяснила бы про упоминание — репетиция.") : say(turn, `По одному @${target.username} Telegram номер ботам не выдаёт. Ответьте этой фразой на сообщение человека — тогда скажу.`);
      else if (!asked.loose) return null;
    }
    person ??= message.from ?? { id: turn.actorId, first_name: turn.name };
    if (turn.dry) return say(turn, "Назвала бы номер и примерный возраст аккаунта — репетиция.");
    const own = String(person.id) === String(turn.actorId);
    const lines = [
      `🪪 ${safeName(person.first_name) || "Без имени"}${person.username ? ` · @${person.username}` : ""}${person.is_bot ? " · бот" : ""}`,
      `Номер (ID): ${person.id}`,
      `В Telegram: ${registeredText(person.id, now())}.`,
      person.is_premium ? "Premium: да." : "",
      "",
      `Дата — оценка по номеру: точной Telegram ботам не даёт.${own ? "" : " Спросить о себе — «мой айди»."}`,
    ].filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== ""));
    return say(turn, lines.join("\n"));
  }

  return Object.freeze({ roleplay, welcome, poll, whois, chatSetting, chatSettings, saveChat, canManage, hush, quiet, question, questionFor, own, bonds, pressBond });
}
