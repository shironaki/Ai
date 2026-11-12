/**
 * То, что делается словом и ничего не стоит: ролевые действия, приветствие
 * новичков, опросы, «мой айди», настройки чата.
 *
 * Разбор фраз — в `rp.js`, `polls.js`, `whois.js`; здесь то, что отправляется
 * в Telegram. Сердце зовёт эти функции из своего порядка разбора и получает
 * либо результат, либо null — «это не моё, иди дальше».
 */
import { parseAction, lineFor, selfLine, reactionFor, willingness, levelOf, listText } from "./rp.js";
import { parsePoll, pollFromModel } from "./polls.js";
import { parseWhois, registeredText } from "./whois.js";
import { safeName } from "./address.js";
import { fold } from "./sources.js";
import { pickSticker } from "./pictures.js";
import { QUESTIONS } from "./data/party.js";

export const CHAT_KEY = (chatId) => `heart:chat:${chatId}`;
const DEFAULTS = Object.freeze({ rp: true, gifs: true, welcome: true, welcomeText: "", quietUntil: 0, tone: "" });

const MINUTE = 60_000;
const QUIET = /^(?:помолчи|замолчи|молчи|тихо|тише|цыц|не\s+(?:пиши|отвечай|говори|шуми)|отдохни)(?:те)?(?:\s+(?:пожалуйста|тут|здесь|пока|немного|чуть-чуть|в\s+(?:этом\s+)?чате))*(?:\s+(?:на\s+)?(полчаса|сутки|день|(\d{1,3})?\s*(минут[уы]?|мин|час(?:а|ов)?|ч)))?$/u;
const SPEAK = /^(?:можешь\s+говорить|можно\s+говорить|говори|отомри|вернись|хватит\s+молчать|не\s+молчи|просыпайся)$/u;
const QUESTION = /^(?:(?:задай|подкинь|дай|предложи)(?:те)?\s+(?:нам\s+|мне\s+|чату\s+)?(?:вопрос(?:\s+дня)?|тему(?:\s+для\s+(?:разговора|обсуждения|беседы))?)|вопрос\s+дня|тема\s+дня|(?:о\s+чем|про\s+что)\s+(?:бы\s+)?(?:нам\s+)?поговорить)$/u;
const QUESTION_MORE = /^(?:(?:еще|другой|следующий)\s+вопрос|(?:еще|другую|следующую)\s+тему|другой\s+вопрос\s+дня)$/u;

/** «Помолчи час» → на сколько миллисекунд. Не про тишину — null. */
export function parseQuiet(text) {
  const value = fold(text).replace(/[.!…]+$/u, "");
  if (SPEAK.test(value)) return { speak: true };
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
} = {}) {
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
  /** Гифка с подписью; не вышло — подпись словами. */
  async function show(turn, category, html, { reply = false, gifs = true } = {}) {
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
  async function roleplay(turn, prompt, { self = null, addressed = false } = {}) {
    if (addressed && RP_LIST.test(fold(prompt).replace(/[?!.…]+$/u, ""))) return say(turn, listText());
    // Упоминание человека без @имени Telegram присылает отдельно: само имя
    // в строке — адресат, а не подробность действия.
    const named = (turn.message?.entities ?? []).find(item => item?.type === "text_mention" && item.user?.id != null);
    const span = named && typeof turn.message?.text === "string" ? turn.message.text.slice(named.offset, named.offset + named.length) : "";
    const parsed = parseAction(span ? String(prompt).replace(span, " ") : prompt);
    if (!parsed) return null;
    const target = targetOf(turn, parsed, self);
    const third = target && !target.self ? target : null;
    // Между людьми: только изъявительное («обнял»), только с адресатом.
    if (!addressed && (parsed.asked || !third)) return null;
    if (turn.dry) return addressed ? say(turn, "Разобрала бы это как действие — репетиция, ничего не отправляю.") : null;
    const chat = await chatSettings(turn.chatId);
    // Её попросили помолчать — молчит и в чужих действиях.
    if (!addressed && Number(chat.quietUntil) > now()) return { ignored: true, reason: "quiet" };
    if (!chat.rp) return addressed ? null : { ignored: true, reason: "rp_off" };
    const actor = esc(turn.name || "Кто-то");
    const { action, tail } = parsed;

    // 1. Человек — человеку. От потока защищает счёт: не больше восьми строк
    // в минуту на чат — иначе одним словом её можно заставить засыпать беседу.
    if (!addressed) {
      if (store?.available) {
        const key = `heart:rp:${turn.chatId}`;
        const seen = await store.get(key).catch(() => null);
        const fresh = seen && now() - Number(seen.from) < MINUTE;
        if (fresh && Number(seen.count) >= 8) return { ignored: true, reason: "rp_flood" };
        await store.set(key, { from: fresh ? seen.from : now(), count: fresh ? Number(seen.count) + 1 : 1 }).catch(() => false);
      }
      pulse?.bump("rp");
      const html = String(third.id) === String(turn.actorId) ? selfLine(action, actor) : lineFor(action, actor, label(third), { tail: esc(tail), bName: esc(third.name) });
      const sent = await show(turn, action.gif, html, { gifs: chat.gifs });
      return sent ? { ok: true, action: "rp", kind: action.key, via: sent } : { ok: false, code: "send_failed" };
    }

    pulse?.bump("rp");
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
        const sent = await show(turn, will.gif, esc(will.text), { reply: true, gifs: chat.gifs });
        return { ok: Boolean(sent), action: "rp", kind: action.key, refused: true };
      }
      const object = third ?? { id: turn.actorId, name: turn.name };
      const html = `${lineFor(action, esc(name), label(object), { tail: esc(tail), bName: esc(object.name) })}${will.note ? `\n${esc(will.note)}` : ""}`;
      const sent = await show(turn, action.gif, html, { reply: !third, gifs: chat.gifs });
      return sent ? { ok: true, action: "rp", kind: action.key, via: sent, by: "self" } : { ok: false, code: "send_failed" };
    }

    // 3. Действие обращено к ней: реакция по близости.
    const reaction = reactionFor(action, { score: manner.score, owner: mine, formal, adult: flirt ? adult : false, random });
    await react(turn, reaction.emoji);
    const sent = await show(turn, reaction.gif, esc(reaction.text), { reply: true, gifs: chat.gifs });
    if (sent === "text") await ownSticker(turn, reaction.mood);
    if (reaction.deed && policy) { try { await policy.recordDeed({ userId: turn.actorId, kind: reaction.deed }); } catch { /* шаг отношений подождёт */ } }
    return sent ? { ok: true, action: "rp", kind: action.key, via: sent, level: reaction.level } : { ok: false, code: "send_failed" };
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

  return Object.freeze({ roleplay, welcome, poll, whois, chatSetting, chatSettings, saveChat, canManage, hush, quiet, question, questionFor });
}
