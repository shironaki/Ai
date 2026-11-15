/**
 * Секретарь: хозяин подключил Аи к своему аккаунту Telegram (Secretary Mode,
 * «Автоматизация чатов»), и платформа приносит ей сообщения из его личных
 * чатов — событиями `business_connection` и `business_message`.
 *
 * Здесь только слова и правила; отправляет сердце. Правила такие:
 *   • работает она секретарём одного человека — хозяина. Чужое подключение
 *     она не слушает вовсе: ни читать, ни хранить, ни отвечать;
 *   • пока хозяин не сказал «отвечай за меня», в его чатах она молчит;
 *   • отвечает она от его аккаунта, но не притворяется им: первая же строка —
 *     «это Аи, помощница»;
 *   • одному человеку — одно уведомление за отлучку; модель на чужие письма
 *     не тратится, обычные её умения (игры, рисунки, команды) там не работают;
 *   • из чужих писем хранится только короткая выдержка — до возвращения
 *     хозяина, чтобы сказать ему, кто писал;
 *   • расписание («ночью отвечай сама») — та же отлучка, только начинает её
 *     будильник: каждый день в названные часы. «Я тут» кончает и её — до
 *     следующего окна;
 *   • «этим не отвечай» — список людей, которым она не отвечает никогда. Их
 *     письма она по-прежнему записывает, а срочное передаёт хозяину сразу.
 */
export const SECRETARY_KEY = "heart:secretary:v1";
/** «Этому человеку в эту отлучку уже сказано» — отдельным ключом: два письма подряд не дадут двух ответов. */
export const TOLD_PREFIX = "heart:secretary:told:";
export const toldKey = (since, chatId) => `${TOLD_PREFIX}${since}:${chatId}`;
/** Срочное от одного человека зовёт хозяина не чаще раза в две минуты: письма идут очередями. */
export const URGENT_EVERY_MS = 2 * 60_000;
export const urgentKey = (since, chatId, at) => `${TOLD_PREFIX}${since}:${chatId}:u:${Math.floor(Number(at) / URGENT_EVERY_MS)}`;
/** Сколько раз за отлучку она отвечает человеку после первого уведомления («передам», «сообщила»). */
export const ACKS_MAX = 3;
/** Сколько срочного письма уходит хозяину сразу и сколько хранится из просьбы «передай». */
export const URGENT_EXCERPT = 300;
export const ASK_MAX = 200;
/** Чужое подключение (не хозяина): запоминается, чтобы не спрашивать Telegram о нём на каждое письмо. */
export const ALIEN_PREFIX = "heart:secretary:alien:";

/** Ночь по умолчанию — для «ночью отвечай сама» без часов. */
export const PLAN_NIGHT = Object.freeze({ from: "23:00", to: "07:00" });
/** Скольким людям можно не отвечать и сколько помнится чат, открытый через «Управление ботом». */
export const MUTE_MAX = 40;
export const FOCUS_MS = 15 * 60_000;

export const AWAY_DEFAULT_MS = 12 * 3_600_000;
export const AWAY_MAX_MS = 72 * 3_600_000;
export const PEOPLE_MAX = 40;
export const NOTICES_PER_HOUR = 30;
/** Хозяин сам писал в этом чате недавно — она туда не вмешивается. */
export const OWNER_BUSY_MS = 15 * 60_000;
/** Письмо дошло с опозданием больше этого — отвечать на него уже невпопад. */
export const STALE_MS = 15 * 60_000;
export const EXCERPT_MAX = 120;
/**
 * Служебные чаты самого Telegram (уведомления, коды входа): им не отвечают, и
 * их письма не записываются — код входа не должен лежать у неё даже минуту.
 */
export const SERVICE_CHATS = Object.freeze([777000, 42777]);

const clean = (text) => String(text ?? "").toLowerCase().replace(/ё/gu, "е").replace(/[«»"“”]/gu, "").replace(/\s+/gu, " ").trim().replace(/[.!…]+$/u, "").trim();

const ON = "(?:(?:отвечай|ответь|поотвечай)(?:\\s+(?:всем|людям))?\\s+за\\s+меня|подмени\\s+меня|прикрой\\s+меня|побудь\\s+(?:моим\\s+)?секретарем|включи\\s+секретаря|секретарь\\s+(?:работай|включись)|меня\\s+нет|я\\s+не\\s+на\\s+связи)";
const OFF_ALWAYS = /^(?:секретарь[,:]?\s+)?(?:(?:больше\s+)?не\s+отвечай\s+за\s+меня|(?:больше\s+)?не\s+надо\s+отвечать\s+за\s+меня|хватит\s+отвечать\s+за\s+меня|выключи\s+секретаря|секретарь[,:]?\s+(?:отбой|стоп|хватит|выключись|отдыхай))$/u;
/** «Я тут» — слова обычные: отлучку они кончают, только если она идёт. */
const OFF_IF_AWAY = /^(?:все[,\s]+)?я\s+(?:снова\s+|уже\s+|опять\s+)?(?:тут|здесь|вернулся|вернулась|на\s+связи|в\s+сети|свободен|свободна|освободился|освободилась)$/u;
// «Кто писал?» без «мне» — вопрос о чём угодно: о книге, о песне. Её это слова только с «мне» или «без меня».
const WHO = /^(?:а\s+)?кто\s+(?:(?:мне\s+писал|меня\s+(?:искал|спрашивал)|писал\s+мне)(?:,?\s+(?:пока\s+меня\s+не\s+было|без\s+меня|за\s+это\s+время))?|писал,?\s+(?:пока\s+меня\s+не\s+было|без\s+меня))$/u;
const STATUS = /^(?:секретарь|секретарь\s+статус|статус\s+секретаря|(?:что|как)\s+(?:там\s+)?(?:с\s+)?секретар(?:ь|ем|я)|ты\s+(?:мой\s+)?секретарь|как\s+(?:включить|подключить|настроить)\s+секретаря)$/u;

// ── расписание: «ночью отвечай сама», «отвечай за меня каждый день с 23 до 7» ──
const NIGHT_WORD = "(?:по\\s+ночам|ночью|ночами|каждую\\s+ночь)";
const EVERY_WORD = `(?:${NIGHT_WORD}|каждый\\s+день|ежедневно|каждый\\s+вечер|по\\s+расписанию|всегда)`;
const CLOCK = "(\\d{1,2})(?:[:.](\\d{2}))?(?:\\s*(?:ч|час(?:а|ов)?))?(?:\\s+(утра|дня|вечера|ночи))?";
const WINDOW = new RegExp(`^с\\s+${CLOCK}\\s+(?:до|по)\\s+${CLOCK}$`, "u");
/** «Ночью отвечай сама [с 23 до 7]», «каждый день отвечай за меня [с 23 до 7]» — слово о повторе впереди. */
const PLAN_HEAD = new RegExp(`^(?:секретарь\\s+)?(${EVERY_WORD})\\s+(?:отвечай|ответь)(?:те)?\\s+(?:сама|за\\s+меня(?:\\s+сама)?|сама\\s+за\\s+меня)(?:\\s+(.+))?$`, "u");
const PLAN_OFF = new RegExp(`^(?:секретарь[,:]?\\s+)?(?:(?:убери|отмени|выключи|сними|удали|сбрось)\\s+(?:мое\\s+)?(?:расписание\\s+секретаря|ночного\\s+секретаря|ночной\\s+секретарь|расписание\\s+ответов)|(?:больше\\s+)?не\\s+отвечай\\s+(?:за\\s+меня\\s+)?(?:${NIGHT_WORD}|по\\s+расписанию|каждый\\s+день)|${NIGHT_WORD}\\s+(?:больше\\s+)?не\\s+отвечай(?:\\s+за\\s+меня)?)$`, "u");
const clockOf = (hours, minutes, part, night) => {
  let hh = Number(hours);
  const mm = minutes ? Number(minutes) : 0;
  if ((part === "вечера" || part === "дня") && hh < 12) hh += 12;
  if (part === "ночи" && hh === 12) hh = 0;
  // «По ночам с 11 до 7»: одиннадцать здесь — вечера. Она повторит часы в ответе, ошибка будет видна.
  if (night && !part && hh >= 8 && hh <= 11) hh += 12;
  if (hh === 24) hh = 0;
  return hh <= 23 && mm <= 59 ? `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` : "";
};
/**
 * Хвост после «отвечай за меня» → расписание:
 *   { from, to } — часы названы или это ночь по умолчанию;
 *   null         — повтор назван, а часов нет или они не часы: надо переспросить;
 *   undefined    — это не расписание вовсе.
 */
export function planOf(tail, lead = "") {
  let rest = String(tail ?? "").trim();
  let every = Boolean(lead), night = new RegExp(`^${NIGHT_WORD}$`, "u").test(lead);
  const word = rest.match(new RegExp(`(?:^|\\s)(${EVERY_WORD})(?=\\s|$)`, "u"));
  if (word) {
    every = true;
    night ||= new RegExp(`^${NIGHT_WORD}$`, "u").test(word[1]);
    rest = `${rest.slice(0, word.index)} ${rest.slice(word.index + word[0].length)}`.replace(/\s+/gu, " ").trim();
  }
  if (!every) return undefined;
  if (!rest) return night ? { ...PLAN_NIGHT } : null;
  const found = rest.match(WINDOW);
  if (!found) return undefined;
  const from = clockOf(found[1], found[2], found[3], night), to = clockOf(found[4], found[5], found[6], false);
  return from && to && from !== to ? { from, to } : null;
}

// ── «этим не отвечай» ──────────────────────────────────────────────────────
const HERE = "(?:этому|этой|ему|ей|здесь|тут|там|туда|в\\s+этом\\s+чате|в\\s+том\\s+чате|этому\\s+человеку)";
const MUTE_HERE = new RegExp(`^(?:секретарь[,:]?\\s+)?(?:${HERE}\\s+(?:больше\\s+|никогда\\s+)?не\\s+отвечай|(?:больше\\s+|никогда\\s+)?не\\s+отвечай\\s+${HERE})(?:\\s+за\\s+меня)?$`, "u");
const UNMUTE_HERE = new RegExp(`^(?:секретарь[,:]?\\s+)?(?:${HERE}\\s+(?:снова\\s+|опять\\s+|тоже\\s+)?отвечай|(?:снова\\s+|опять\\s+)?отвечай\\s+(?:и\\s+)?${HERE})(?:\\s+за\\s+меня)?$`, "u");
const UNMUTE_ALL = /^(?:секретарь[,:]?\s+)?(?:(?:снова\s+|опять\s+)?отвечай\s+всем(?:\s+без\s+исключений)?|никого\s+не\s+пропускай|очисти\s+список\s+(?:молчания|тех,?\s+кому\s+не\s+отвечаешь))$/u;
const MUTE_LIST = /^(?:секретарь[,:]?\s+)?(?:а\s+)?(?:кому\s+(?:ты\s+)?не\s+отвечаешь(?:\s+за\s+меня)?|кому\s+(?:ты\s+)?не\s+отвечать|кого\s+(?:ты\s+)?пропускаешь|список\s+молчания)$/u;
// Явные слова («этим не отвечай: …», «секретарь, не отвечай …», «не отвечай за меня …») — и короткое «не отвечай …».
const MUTE_WHO = /^(секретарь[,:]?\s+)?(этим\s+(?:людям\s+)?(?:больше\s+|никогда\s+)?не\s+отвечай|(?:больше\s+|никогда\s+)?не\s+отвечай(\s+за\s+меня)?)\s*[:,—-]?\s+(.{2,200})$/u;
const UNMUTE_WHO = /^(?:секретарь[,:]?\s+)?(?:(?:снова|опять)\s+отвечай|отвечай\s+(?:снова|опять)|разреши\s+отвечать|можешь\s+(?:снова\s+)?отвечать)(?:\s+за\s+меня)?\s*[:,—-]?\s+(.{2,200})$/u;
const UNMUTE_USER = /^(?:секретарь[,:]?\s+)?отвечай(?:\s+за\s+меня)?\s+((?:@[a-z0-9_]{3,32}(?:\s*,\s*|\s+и\s+|\s+)?)+)$/u;
/** Слова, которые после «не отвечай» значат разговор, а не имя: «не отвечай мне так». */
const NOT_A_NAME = new Set(["мне", "нам", "так", "на", "в", "по", "пока", "сейчас", "сегодня", "завтра", "больше", "никому", "ничего", "никогда", "если", "когда", "им", "всем", "людям", "сразу", "грубо", "долго", "коротко", "вопросом", "стихами", "это", "этого", "того", "и", "а", "но", "за", "меня", "ночью", "днем", "утром", "вечером", "же", "уж", "ты", "вы", "сама", "тогда", "вообще", "просто", "пожалуйста", "лучше", "зря"]);
/** «@vasya, Маше и @petya» → { users: ["vasya", "petya"], names: ["маше"] } или null, если это не перечень людей. */
function whoOf(tail) {
  const parts = String(tail ?? "").split(/\s*,\s*|\s+и\s+/u).map(item => item.trim()).filter(Boolean);
  if (!parts.length || parts.length > 8) return null;
  const users = [], names = [];
  for (const part of parts) {
    const user = part.match(/^@([a-z0-9_]{3,32})$/u);
    if (user) { users.push(user[1]); continue; }
    const words = part.split(" ");
    if (words.length > 2 || words.some(word => !/^[а-яёa-z-]{2,24}$/u.test(word) || NOT_A_NAME.has(word))) return null;
    names.push(part);
  }
  return { users, names };
}
/**
 * Имя из слов хозяина против имени в списке: «Маше» — это «Маша», «Сергею» —
 * «Сергей», «Петру» — «Пётр». Словаря падежей у неё нет: из имени в списке
 * строятся его возможные формы «кому», и сказанное сверяется с ними. Сверяется
 * первое слово: «Маша Иванова» узнаётся по «Маше».
 */
export function sameName(said, name) {
  const fold = (value) => String(value ?? "").toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
  const [a, b] = [fold(said), fold(name)];
  if (!a || !b) return false;
  if (a === b) return true;
  const [x, y] = [a.split(" ")[0], b.split(" ")[0]];
  if (x === y) return true;
  const stem = y.slice(0, -1), last = y.slice(-1);
  const forms = /[ая]/u.test(last) ? [`${stem}е`, `${stem}и`]
    : /[йь]/u.test(last) ? [`${stem}ю`]
      // «Павел» → «Павлу», «Пётр» → «Петру»: беглая гласная перед последней согласной.
      : [`${y}у`, ...(/[её].$/u.test(y) ? [`${y.slice(0, -2)}${last}у`] : [])];
  return forms.includes(x);
}

/**
 * Срок в словах → `{ at: "HH:MM" }` (до этого часа) или `{ ms }` (на столько),
 * иначе null. «До 18», «до 18:30», «до 7 утра», «на 2 часа», «час», «полчаса»,
 * «на 40 минут».
 */
export function parseSpan(text) {
  const value = clean(text);
  let found = value.match(/^до\s+(\d{1,2})(?:[:. ](\d{2}))?(?:\s*(?:ч|час[аов]*))?(?:\s+(утра|дня|вечера|ночи))?$/u);
  if (found) {
    let hh = Number(found[1]);
    const mm = found[2] ? Number(found[2]) : 0;
    if ((found[3] === "вечера" || found[3] === "дня") && hh < 12) hh += 12;
    if (found[3] === "ночи" && hh === 12) hh = 0;
    return hh <= 23 && mm <= 59 ? { at: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` } : null;
  }
  if (/^(?:на\s+)?(?:пол\s?часа|полчасика)$/u.test(value)) return { ms: 30 * 60_000 };
  if (/^(?:на\s+)?(?:час|часик)$/u.test(value)) return { ms: 3_600_000 };
  if (/^(?:на\s+)?(?:пару\s+часов|два\s+часа)$/u.test(value)) return { ms: 2 * 3_600_000 };
  found = value.match(/^(?:на\s+)?(\d{1,2})\s*(?:ч|час(?:а|ов)?)$/u);
  if (found) return Number(found[1]) >= 1 && Number(found[1]) <= 72 ? { ms: Number(found[1]) * 3_600_000 } : null;
  found = value.match(/^(?:на\s+)?(\d{1,3})\s*мин(?:ут(?:у|ы)?)?$/u);
  if (found) return Number(found[1]) >= 5 && Number(found[1]) <= 600 ? { ms: Number(found[1]) * 60_000 } : null;
  return null;
}

/**
 * Слова хозяина о секретаре → просьба, иначе null:
 *   { on: true, span?, words? } — «отвечай за меня», «…до 18:00», «…: я на встрече, перезвоню»
 *   { off: true }               — «не отвечай за меня», «выключи секретаря»
 *   { back: true }              — «я тут», «я вернулся»: кончает отлучку, только если она идёт
 *   { who: true }               — «кто мне писал?»
 *   { status: true }            — «секретарь», «как подключить секретаря»
 *   { plan: { from, to }, words? } — «ночью отвечай сама», «отвечай за меня каждый день с 23 до 7»
 *   { plan: null }              — повтор назван, а часы нет: переспросить
 *   { planOff: true }           — «убери расписание секретаря», «не отвечай по ночам»
 *   { mute: { here } | { users, names, strict } }   — «этому не отвечай», «не отвечай @vasya», «этим не отвечай: Маша»
 *   { unmute: { here } | { all } | { users, names } } — «снова отвечай @vasya», «отвечай всем»
 *   { muted: true }             — «кому ты не отвечаешь?»
 */
export function parseSecretary(text) {
  let raw = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!raw || raw.length > 320) return null;
  const value = clean(raw).replace(/[?!]+$/u, "").trim();
  if (STATUS.test(value) || /^(?:мое\s+)?расписание\s+секретаря$/u.test(value)) return { status: true };
  if (WHO.test(value)) return { who: true };
  if (OFF_ALWAYS.test(value)) return { off: true };
  if (PLAN_OFF.test(value)) return { planOff: true };
  if (MUTE_LIST.test(value)) return { muted: true };
  if (MUTE_HERE.test(value)) return { mute: { here: true } };
  if (UNMUTE_ALL.test(value)) return { unmute: { all: true } };
  if (UNMUTE_HERE.test(value)) return { unmute: { here: true } };
  {
    const again = value.match(UNMUTE_WHO) ?? value.match(UNMUTE_USER);
    const who = again ? whoOf(again[1]) : null;
    if (who) return { unmute: who };
    const mute = value.match(MUTE_WHO);
    const quiet = mute ? whoOf(mute[4]) : null;
    // Короткое «не отвечай Маше» может быть и разговором: решит сердце — знает ли оно такую Машу.
    if (quiet) return { mute: { ...quiet, strict: Boolean(mute[1] || mute[3] || /^этим/u.test(mute[2]) || !quiet.names.length) } };
  }
  // «Я тут?» — вопрос, а не возвращение.
  if (OFF_IF_AWAY.test(value) && !/\?\s*$/u.test(raw)) return { back: true };
  // «Секретарь, отвечай за меня» и «секретарь: отвечай за меня» — одно и то же.
  raw = raw.replace(/^(секретарь)\s*[,:]\s*/iu, "$1 ");
  // Голова — «отвечай за меня [хвост]» или «ночью отвечай сама [хвост]»: [целиком, хвост, слово о повторе].
  const head = (part) => {
    const said = clean(part).replace(/[?]+$/u, "").trim();
    const every = said.match(PLAN_HEAD);
    if (every) return [every[0], every[2], every[1]];
    return said.match(new RegExp(`^(?:секретарь\\s+)?${ON}(?:\\s+(.+))?$`, "u"));
  };
  // Слова для людей — после двоеточия, тире или запятой, как сказаны (регистр и знаки — его).
  // Двоеточие в «18:00» — не разделитель.
  let found = null, words = "";
  for (const mark of [/:(?!\d\d(?:\D|$))|\s[—–-]\s/u, /,\s/u]) {
    const at = raw.search(mark);
    if (at < 0) continue;
    const tried = head(raw.slice(0, at));
    if (!tried) continue;
    found = tried;
    words = raw.slice(at).replace(/^\s*[:—–,-]\s*/u, "").trim().replace(/^[«"“]+|[»"”]+$/gu, "").trim();
    break;
  }
  found ??= head(raw);
  if (!found) return null;
  if (words.length > 200) return null;
  // Расписание: слово о повторе впереди («ночью отвечай сама») или в хвосте («…каждый день с 23 до 7»).
  const plan = planOf(found[1] ?? "", found[2] ?? "");
  if (plan !== undefined) return { plan, ...(words ? { words } : {}) };
  let span = null;
  if (found[1]) {
    span = parseSpan(found[1].replace(/^(?:примерно|где-то)\s+/u, ""));
    if (!span) return null;
  }
  return { on: true, ...(span ? { span } : {}), ...(words ? { words } : {}) };
}

/** Может ли она отвечать в чатах хозяина: право даёт он сам при подключении. */
export function canReply(connection) {
  return connection?.rights?.can_reply === true || connection?.can_reply === true;
}

/** Язык уведомления: по письму, а если в нём нет букв — по языку приложения человека. */
export function langOf(message = {}) {
  const text = String(message.text ?? message.caption ?? "");
  if (/[а-яё]/iu.test(text)) return "ru";
  if (/[a-z]/iu.test(text)) return "en";
  const code = String(message.from?.language_code ?? "").toLowerCase().slice(0, 2);
  return !code || ["ru", "uk", "be", "kk", "ky", "uz", "tg", "hy", "az"].includes(code) ? "ru" : "en";
}

/** Что прислали — коротко, для списка «кто писал». Текст — выдержкой, остальное — словом. */
export function excerptOf(message = {}) {
  const text = String(message.text ?? message.caption ?? "").replace(/\s+/gu, " ").trim();
  if (text) return text.length > EXCERPT_MAX ? `«${text.slice(0, EXCERPT_MAX).trimEnd()}…»` : `«${text}»`;
  return message.photo ? "фото" : message.voice ? "голосовое" : message.video_note ? "кружок" : message.video ? "видео"
    : message.sticker ? "стикер" : message.animation ? "гифка" : message.document ? "файл" : message.audio ? "аудио"
      : message.location ? "место на карте" : message.contact ? "контакт" : message.poll ? "опрос" : "сообщение";
}

// Границы слова — явные: `\b` рядом с кириллицей не работает.
const EDGE = "(?:^|[^а-яёa-z0-9])";
const END = "(?=$|[^а-яёa-z0-9])";
const NOT_URGENT = new RegExp(`${EDGE}(?:не\\s*(?:очень\\s+|так\\s+|особо\\s+|слишком\\s+)?(?:срочн|важно)|несрочн|неважно|ничего\\s+срочного|не\\s+горит|не\\s+спеш|не\\s+беда|not\\s+(?:that\\s+|so\\s+|very\\s+)?(?:urgent|important)|no\\s+(?:rush|hurry))`, "iu");
const URGENT = new RegExp(`${EDGE}(?:срочн(?:о|ое|ая|ый|ые|ого|ую|ым|ых|ейше|як)|немедленно|безотлагательн[а-яё]*|неотложн[а-яё]*|экстренн[а-яё]*|как\\s+можно\\s+(?:скорее|быстрее)|(?:очень|крайне|это)\\s+важно|чп|беда|sos|urgent(?:ly)?|asap|emergency|(?:very|really|it'?s)\\s+important)${END}`, "iu");
const RELAY = new RegExp(`${EDGE}(?:переда(?:й|йте|шь|дите)|(?:скажи|сообщи|напомни|напиши|перешли)(?:те)?\\s+(?:ему|ей)|попроси(?:те)?\\s+(?:его|е[её])|пусть\\s+(?:он\\s+|она\\s+)?(?:мне\\s+)?(?:срочно\\s+)?(?:перезвонит|позвонит|наберёт|наберет|напишет|ответит|свяжется)|tell\\s+(?:him|her|them)|let\\s+(?:him|her|them)\\s+know|pass\\s+(?:it|this|that|the\\s+message)\\s+(?:on|along)|ask\\s+(?:him|her|them)\\s+to|give\\s+(?:him|her|them)\\s+(?:a|the|my)\\s+message|please\\s+relay)${END}`, "iu");
const wordsOf = (message = {}) => String(message.text ?? message.caption ?? "").toLowerCase().replace(/\s+/gu, " ").trim();

/** «Срочно», «это важно», «urgent» — и не «не срочно». Только слова письма: модель его не видит. */
export function isUrgent(message = {}) {
  const text = wordsOf(message);
  return Boolean(text) && URGENT.test(text) && !NOT_URGENT.test(text);
}
/** Человек просит что-то передать хозяину: «передай…», «скажи ему…», «пусть перезвонит», «tell him…». */
export function isRelay(message = {}) {
  const text = wordsOf(message);
  return Boolean(text) && RELAY.test(text);
}
/** Письмо выдержкой заданной длины — для вести хозяину и для просьбы «передай». */
export function quoteOf(message = {}, limit = ASK_MAX) {
  const text = String(message.text ?? message.caption ?? "").replace(/\s+/gu, " ").trim();
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}
/** Её второй ответ человеку — запасные слова, если словаря нет, и английские. */
export function ackRussian(kind) {
  return kind === "both" ? "Передам — и уже сообщила, что это срочно." : kind === "urgent" ? "Вижу, что это срочно: уже сообщила." : "Обязательно передам.";
}
export function ackEnglish(kind) {
  return kind === "both" ? "I'll pass it on — and I've already let them know it's urgent." : kind === "urgent" ? "I see it's urgent: I've let them know right away." : "I'll be sure to pass it on.";
}

/** Уведомление по-английски: словарь у неё русский, а пишут хозяину не только по-русски. */
export function noticeEnglish({ name = "", until = "", words = "" } = {}) {
  const who = name || "The owner of this account";
  if (words) return `Hello. This is Ai, an assistant. ${who} can't reply right now and left a message for you: "${words}"`;
  return `Hello. This is Ai, an assistant. ${who} is away right now${until ? ` — until about ${until}` : ""}. I'll pass on that you wrote.`;
}

/** Запасное уведомление по-русски — если словаря нет. */
export function noticeRussian({ name = "", until = "", words = "" } = {}) {
  const who = name || "Владелец этого аккаунта";
  if (words) return `Здравствуйте. Это Аи, помощница. ${who} сейчас не на связи и просит передать: «${words}»`;
  return `Здравствуйте. Это Аи, помощница. ${who} сейчас не на связи${until ? ` — примерно до ${until}` : ""}. Я передам, что вы писали.`;
}

/** Пустое состояние: подключения нет, отлучки нет, никто не писал. */
export function blank() {
  return { conn: null, away: { on: false, since: 0, until: 0, words: "" }, people: [], more: 0, own: {}, sent: { from: 0, n: 0 }, plan: null, mute: [], focus: null };
}
/** Состояние из базы → полное: чего нет — как в пустом. */
export function stateOf(saved) {
  const base = blank();
  if (!saved || typeof saved !== "object") return base;
  return {
    conn: saved.conn && typeof saved.conn === "object" && saved.conn.id ? saved.conn : null,
    away: { ...base.away, ...(saved.away && typeof saved.away === "object" ? saved.away : {}) },
    people: Array.isArray(saved.people) ? saved.people.filter(item => item && item.id != null) : [],
    // Сколько человек список уже вытеснил: он на PEOPLE_MAX, а писать могут и больше.
    more: Math.max(0, Math.round(Number(saved.more) || 0)),
    own: saved.own && typeof saved.own === "object" ? saved.own : {},
    sent: { ...base.sent, ...(saved.sent && typeof saved.sent === "object" ? saved.sent : {}) },
    plan: saved.plan && typeof saved.plan === "object" && /^\d\d:\d\d$/u.test(String(saved.plan.from)) && /^\d\d:\d\d$/u.test(String(saved.plan.to)) ? saved.plan : null,
    mute: Array.isArray(saved.mute) ? saved.mute.filter(item => item && (item.id != null || item.user)).slice(-MUTE_MAX) : [],
    focus: saved.focus && typeof saved.focus === "object" && saved.focus.id != null ? saved.focus : null,
  };
}

/** Тот ли это человек, которому велено не отвечать: по номеру чата или по @имени. */
export function mutedBy(entry, { id = null, user = "" } = {}) {
  if (!entry) return false;
  if (entry.id != null && id != null && String(entry.id) === String(id)) return true;
  return Boolean(entry.user) && Boolean(user) && String(entry.user).toLowerCase() === String(user).toLowerCase();
}
/** Как назвать человека из списка молчания хозяину: «Маша (@masha)», «@vasya», «чат 123». */
export function muteLabel(entry) {
  const name = String(entry?.name ?? "").trim(), user = String(entry?.user ?? "").trim();
  return name ? `${name}${user ? ` (@${user})` : ""}` : user ? `@${user}` : `чат ${entry?.id}`;
}

/** Записать письмо в список «кто писал»: человек — одной строкой, свежие — в конце. */
export function notePerson(people, message, at) {
  const from = message.from ?? {};
  const id = message.chat?.id ?? from.id;
  const name = String([from.first_name, from.last_name].filter(Boolean).join(" ") || message.chat?.first_name || "Без имени").replace(/\s+/gu, " ").trim().slice(0, 48);
  const before = people.find(item => String(item.id) === String(id));
  const next = { id, name, user: String(from.username ?? message.chat?.username ?? "").slice(0, 32), n: (Number(before?.n) || 0) + 1, at, text: excerptOf(message), told: before?.told === true, failed: before?.failed === true };
  // Срочное и просьбы «передай» копятся за отлучку: хозяин увидит их в списке, даже если после было ещё десять писем.
  const urgent = (Number(before?.urgent) || 0) + (isUrgent(message) ? 1 : 0);
  const asks = [...(Array.isArray(before?.asks) ? before.asks : []), ...(isRelay(message) ? [quoteOf(message, ASK_MAX)] : [])].slice(-3);
  const acks = Number(before?.acks) || 0;
  if (urgent) next.urgent = urgent;
  if (asks.length) next.asks = asks;
  if (acks) next.acks = acks;
  return [...people.filter(item => String(item.id) !== String(id)), next].slice(-PEOPLE_MAX);
}
