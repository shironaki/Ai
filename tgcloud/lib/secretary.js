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
 *     хозяина, чтобы сказать ему, кто писал.
 */
export const SECRETARY_KEY = "heart:secretary:v1";
/** «Этому человеку в эту отлучку уже сказано» — отдельным ключом: два письма подряд не дадут двух ответов. */
export const TOLD_PREFIX = "heart:secretary:told:";
export const toldKey = (since, chatId) => `${TOLD_PREFIX}${since}:${chatId}`;
/** Чужое подключение (не хозяина): запоминается, чтобы не спрашивать Telegram о нём на каждое письмо. */
export const ALIEN_PREFIX = "heart:secretary:alien:";

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
 */
export function parseSecretary(text) {
  let raw = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!raw || raw.length > 320) return null;
  const value = clean(raw).replace(/[?!]+$/u, "").trim();
  if (STATUS.test(value)) return { status: true };
  if (WHO.test(value)) return { who: true };
  if (OFF_ALWAYS.test(value)) return { off: true };
  // «Я тут?» — вопрос, а не возвращение.
  if (OFF_IF_AWAY.test(value) && !/\?\s*$/u.test(raw)) return { back: true };
  // «Секретарь, отвечай за меня» и «секретарь: отвечай за меня» — одно и то же.
  raw = raw.replace(/^(секретарь)\s*[,:]\s*/iu, "$1 ");
  const head = (part) => clean(part).replace(/[?]+$/u, "").trim().match(new RegExp(`^(?:секретарь\\s+)?${ON}(?:\\s+(.+))?$`, "u"));
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
  let span = null;
  if (found[1]) {
    span = parseSpan(found[1].replace(/^(?:примерно|где-то)\s+/u, ""));
    if (!span) return null;
  }
  if (words.length > 200) return null;
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
  return { conn: null, away: { on: false, since: 0, until: 0, words: "" }, people: [], more: 0, own: {}, sent: { from: 0, n: 0 } };
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
  };
}

/** Записать письмо в список «кто писал»: человек — одной строкой, свежие — в конце. */
export function notePerson(people, message, at) {
  const from = message.from ?? {};
  const id = message.chat?.id ?? from.id;
  const name = String([from.first_name, from.last_name].filter(Boolean).join(" ") || message.chat?.first_name || "Без имени").replace(/\s+/gu, " ").trim().slice(0, 48);
  const before = people.find(item => String(item.id) === String(id));
  const next = { id, name, user: String(from.username ?? message.chat?.username ?? "").slice(0, 32), n: (Number(before?.n) || 0) + 1, at, text: excerptOf(message), told: before?.told === true, failed: before?.failed === true };
  return [...people.filter(item => String(item.id) !== String(id)), next].slice(-PEOPLE_MAX);
}
