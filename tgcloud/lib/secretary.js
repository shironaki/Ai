/**
 * Секретарь: хозяин подключил Аи к своему аккаунту Telegram (Secretary Mode,
 * «Автоматизация чатов»), и платформа приносит ей сообщения из его личных
 * чатов — событиями `business_connection` и `business_message`.
 *
 * Здесь только слова и правила; отправляет сердце. Правила такие:
 *   • работает она секретарём хозяина — и тех близких, кому он разрешил
 *     (с 0.35.0; у каждого свой «стол»: своё состояние, свои вести, свой список,
 *     и чужой стол не показывается никому, хозяину тоже). Чужое подключение она
 *     не слушает вовсе: ни читать, ни хранить, ни отвечать — только спрашивает
 *     хозяина, разрешить ли;
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
/**
 * Столы близких: у кого она секретарь кроме хозяина (`list`) и кто подключил её к себе и ждёт
 * его слова (`asks`). Решает только хозяин; у каждого стола своё состояние под своим ключом.
 */
export const DESKS_KEY = "heart:secretary:desks:v1";
export const DESKS_MAX = 5;
export const DESK_ASKS_MAX = 10;
/** Сколько недошедших вестей близкому ждут следующего удара будильника. */
export const DESK_MAIL_MAX = 6;
export const deskKey = (userId) => `${SECRETARY_KEY}:${userId}`;
/** Список столов из базы → полный: чего нет — пусто. */
export function desksOf(saved) {
  const rows = (value, limit) => (Array.isArray(value) ? value.filter(item => item && item.id != null).slice(-limit) : []);
  return { list: rows(saved?.list, DESKS_MAX), asks: rows(saved?.asks, DESK_ASKS_MAX) };
}

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

const ON = "(?:(?:отвечай|ответь|поотвечай)(?:\\s+(?:всем|людям))?\\s+за\\s+меня(?:\\s+(?:когда|пока|если)\\s+(?:меня\\s+нет(?:\\s+(?:на\\s+связи|в\\s+сети|рядом))?|я\\s+(?:не\\s+на\\s+связи|не\\s+в\\s+сети|занят[а]?|сплю|отошел|отошла)))?|подмени\\s+меня|прикрой\\s+меня|(?:побудь|поработай)\\s+(?:моим\\s+)?секретарем|включи\\s+секретаря|секретарь\\s+(?:работай|включись|вкл|включи|на\\s+пост)|меня\\s+нет|я\\s+не\\s+на\\s+связи)";
const OFF_ALWAYS = /^(?:секретарь[,:]?\s+)?(?:(?:больше\s+)?не\s+отвечай\s+за\s+меня|(?:больше\s+)?не\s+надо\s+отвечать\s+за\s+меня|(?:хватит|перестань|прекрати)\s+отвечать\s+за\s+меня|(?:выключи|отключи)\s+секретаря|секретарь[,:]?\s+(?:отбой|стоп|хватит|выключись|отдыхай|выкл|выключи|свободна))$/u;
/** «Я тут» — слова обычные: отлучку они кончают, только если она идёт. */
const OFF_IF_AWAY = /^(?:все[,\s]+)?я\s+(?:снова\s+|уже\s+|опять\s+)?(?:тут|здесь|вернулся|вернулась|на\s+связи|в\s+сети|свободен|свободна|освободился|освободилась)$/u;
// «Кто мне писал?», «мне писали?», «мне кто-нибудь писал?» — её слова всегда. Без «мне» («кто писал?», «были
// сообщения?», «что было, пока меня не было?») — вопрос о чём угодно, о книге или о чате: её это слова, только
// когда она и правда чей-то секретарь. Такие отдаются с пометкой `bare`, решает сердце.
const AWAY_TAIL = "(?:,?\\s+(?:пока\\s+меня\\s+не\\s+было|без\\s+меня|за\\s+это\\s+время|ночью|за\\s+ночь|сегодня|вчера))?";
const SOMEONE = "(?:кто[-\\s]?(?:нибудь|то|либо)\\s+)";
const WHO = new RegExp(`^(?:а\\s+)?(?:кто\\s+(?:мне\\s+(?:писал|написал)|меня\\s+(?:искал|спрашивал)|(?:писал|написал)\\s+мне)${AWAY_TAIL}|кто\\s+(?:писал|написал),?\\s+(?:пока\\s+меня\\s+не\\s+было|без\\s+меня)|мне\\s+${SOMEONE}?(?:писали?|написали?)${AWAY_TAIL}|${SOMEONE}(?:мне\\s+(?:писал|написал)|(?:писал|написал)\\s+мне)${AWAY_TAIL})$`, "u");
const WHO_BARE = new RegExp(`^(?:а\\s+)?(?:кто\\s+(?:писал|написал)${AWAY_TAIL}|${SOMEONE}(?:писал|написал)${AWAY_TAIL}|писали${AWAY_TAIL}|(?:были|есть)\\s+(?:новые\\s+)?(?:сообщения|письма)${AWAY_TAIL}|что\\s+(?:было|нового),?\\s+(?:пока\\s+меня\\s+не\\s+было|без\\s+меня))$`, "u");
const STATUS = /^(?:секретарь|секретарь\s+статус|статус\s+секретаря|(?:что|как)\s+(?:там\s+)?(?:с\s+)?секретар(?:ь|ем|я)|ты\s+(?:мой\s+)?секретарь|как\s+(?:включить|подключить|настроить)\s+секретаря|подключи\s+секретаря|подключись\s+к\s+(?:моему\s+)?аккаунту|как\s+тебя\s+подключить(?:\s+к\s+(?:моему\s+)?аккаунту)?)$/u;

// ── расписание: «ночью отвечай сама», «отвечай за меня каждый день с 23 до 7» ──
const NIGHT_WORD = "(?:по\\s+ночам|ночью|ночами|каждую\\s+ночь)";
const EVERY_WORD = `(?:${NIGHT_WORD}|каждый\\s+день|ежедневно|каждый\\s+вечер|по\\s+расписанию|всегда)`;
const CLOCK = "(\\d{1,2})(?:[:.](\\d{2}))?(?:\\s*(?:ч|час(?:а|ов)?))?(?:\\s+(утра|дня|вечера|ночи))?";
const WINDOW = new RegExp(`^с\\s+${CLOCK}\\s+(?:до|по)\\s+${CLOCK}$`, "u");
/** «Ночью отвечай сама [с 23 до 7]», «каждый день отвечай за меня [с 23 до 7]» — слово о повторе впереди. */
const PLAN_HEAD = new RegExp(`^(?:секретарь\\s+)?(${EVERY_WORD})\\s+(?:отвечай|ответь)(?:те)?\\s+(?:сама|за\\s+меня(?:\\s+сама)?|сама\\s+за\\s+меня)(?:\\s+(.+))?$`, "u");
const PLAN_SWAP = new RegExp(`^((?:секретарь\\s+)?)(отвечай|ответь)(те)?\\s+(${EVERY_WORD})\\s+(?=сама|за\\s+меня)`, "u");
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
 * То же имя в любом из падежей, в которых его называют в просьбе: «Айдине» и «у Айдины»,
 * «Сергею» и «у Сергея», «Петру» и «у Петра». Дательный знает `sameName`; здесь — родительный.
 */
export function sameNameAny(said, name) {
  if (sameName(said, name)) return true;
  const fold = (value) => String(value ?? "").toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
  const x = fold(said).split(" ")[0], y = fold(name).split(" ")[0];
  if (!x || !y) return false;
  const stem = y.slice(0, -1), last = y.slice(-1);
  const forms = /[ая]/u.test(last) ? [`${stem}ы`, `${stem}и`, `${stem}у`, `${stem}ю`]
    : /[йь]/u.test(last) ? [`${stem}я`]
      : [`${y}а`, ...(/[её].$/u.test(y) ? [`${y.slice(0, -2)}${last}а`] : [])];
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

// ── столы близких: слова хозяина ───────────────────────────────────────────
/** «Жене», «ей», «этому человеку» — не имя: значит «тому, кто просит» (или единственному). */
const KIN_WORD = /^(?:(?:моей\s+|моему\s+)?(?:жене|жены|жену|жена|супруге|супруги|мужу|мужа|супругу|супруга)|ей|ему|ее|его|нее|него|этому\s+человеку|этого\s+человека)(?:\s+тоже)?$/u;
const DESKS = /^(?:а\s+)?(?:у\s+кого\s+(?:ты\s+)?(?:еще\s+)?(?:работаешь\s+)?секретар(?:ь|ем)|(?:чей|кому)\s+ты\s+(?:еще\s+)?секретарь|секретарь\s+у\s+кого|за\s+кого\s+ты\s+(?:еще\s+)?отвечаешь|у\s+кого\s+ты\s+(?:еще\s+)?работаешь|кто\s+(?:еще\s+)?просит\s+секретаря|кто\s+просится\s+в\s+секретари)$/u;
const DESK_ALLOW = /^(?:да[,\s]+)?(?:разреши|разрешаю|разрешить|одобри|одобряю)\s+секретаря(?:\s+(?:для\s+)?(.{2,40}))?$/u;
// Тот же смысл, другой порядок слов: «разреши жене секретаря», «откажи Айдине в секретаре», «забери у жены секретаря».
const WHOM = "((?:\\S+\\s+){0,2}\\S+)";
const DESK_ALLOW_MID = new RegExp(`^(?:да[,\\s]+)?(?:разреши|разрешаю|разрешить|одобри|одобряю)\\s+${WHOM}\\s+(?:секретаря|быть\\s+с\\s+секретарем)$`, "u");
const DESK_ALLOW_OF = /^(?:будь|стань|поработай)\s+секретарем\s+(?:и\s+|еще\s+и\s+)?((?:моей\s+)?(?:жены|супруги)|(?:моего\s+)?(?:мужа|супруга))$/u;
const DESK_DENY_MID = new RegExp(`^(?:нет[,\\s]+)?(?:не\\s+разрешай|не\\s+разрешаю|не\\s+давай|откажи|отказать)\\s+${WHOM}\\s+(?:секретаря|в\\s+секретаре)$`, "u");
const DESK_REVOKE_MID = new RegExp(`^(?:забери|убери|отними|сними)\\s+у\\s+${WHOM}\\s+секретаря$`, "u");
const DESK_ALLOW_AT = /^(?:будь|стань|поработай)\s+секретарем\s+(?:и\s+|еще\s+и\s+)?(?:у|для)\s+(.{2,40})$/u;
const DESK_DENY = /^(?:нет[,\s]+)?(?:не\s+разрешай|не\s+разрешаю|не\s+давай|откажи|отказать)\s+(?:секретаря|в\s+секретаре)(?:\s+(?:для\s+)?(.{2,40}))?$/u;
const DESK_REVOKE = /^(?:забери|убери|отними|сними)\s+секретаря\s+у\s+(.{2,40})$/u;
const DESK_REVOKE_AT = /^(?:больше\s+)?не\s+будь\s+секретарем\s+(?:у|для)\s+(.{2,40})$/u;
/** Слова хозяина о столах близких: `{ desks }`, `{ allow }`, `{ deny }`, `{ revoke }`; имя — или "" («тот, кто просит»). */
function deskWish(value) {
  if (DESKS.test(value)) return { desks: true };
  const who = (name) => { const text = String(name ?? "").trim(); return KIN_WORD.test(text) ? "" : text; };
  let found = value.match(DESK_ALLOW) ?? value.match(DESK_ALLOW_AT) ?? value.match(DESK_ALLOW_MID);
  if (found) return { allow: who(found[1]) };
  if (DESK_ALLOW_OF.test(value)) return { allow: "" };
  found = value.match(DESK_DENY) ?? value.match(DESK_DENY_MID);
  if (found) return { deny: who(found[1]) };
  found = value.match(DESK_REVOKE) ?? value.match(DESK_REVOKE_AT) ?? value.match(DESK_REVOKE_MID);
  if (found) return { revoke: who(found[1]) };
  return null;
}

/**
 * Слова хозяина о секретаре → просьба, иначе null:
 *   { on: true, span?, words? } — «отвечай за меня», «…до 18:00», «…: я на встрече, перезвоню»
 *   { off: true }               — «не отвечай за меня», «выключи секретаря»
 *   { back: true }              — «я тут», «я вернулся»: кончает отлучку, только если она идёт
 *   { who: true }               — «кто мне писал?», «мне писали?»; с `bare: true` — «кто писал?», «были сообщения?»:
 *                                 без «мне» это её слова, только когда она чей-то секретарь
 *   { status: true }            — «секретарь», «как подключить секретаря»
 *   { plan: { from, to }, words? } — «ночью отвечай сама», «отвечай за меня каждый день с 23 до 7»
 *   { plan: null }              — повтор назван, а часы нет: переспросить
 *   { planOff: true }           — «убери расписание секретаря», «не отвечай по ночам»
 *   { mute: { here } | { users, names, strict } }   — «этому не отвечай», «не отвечай @vasya», «этим не отвечай: Маша»
 *   { unmute: { here } | { all } | { users, names } } — «снова отвечай @vasya», «отвечай всем»
 *   { muted: true }             — «кому ты не отвечаешь?»
 *   { desks: true } | { allow } | { deny } | { revoke } — столы близких: «у кого ты секретарь?»,
 *                                 «разреши секретаря [Айдине]», «не разрешай секретаря», «забери секретаря у Айдины»
 */
export function parseSecretary(text) {
  let raw = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!raw || raw.length > 320) return null;
  const value = clean(raw).replace(/[?!]+$/u, "").trim();
  if (STATUS.test(value) || /^(?:мое\s+)?расписание\s+секретаря$/u.test(value)) return { status: true };
  const desk = deskWish(value);
  if (desk) return desk;
  if (WHO.test(value)) return { who: true };
  if (WHO_BARE.test(value)) return { who: true, bare: true };
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
    // «Отвечай ночью за меня» — тот же порядок, что «ночью отвечай за меня»: слово о повторе переставляется вперёд.
    const said = clean(part).replace(/[?]+$/u, "").trim().replace(PLAN_SWAP, "$1$4 $2$3 ");
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
  // «Отвечай за меня, когда меня нет» — после запятой условие, а не слова для людей.
  if (/^(?:когда|пока|если)\s+(?:меня\s+нет|я\s+(?:не\s+на\s+связи|не\s+в\s+сети|занят[а]?|сплю|отош[её]л|отошла))/iu.test(words)) words = "";
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
    // Когда отдан прошлый список «кто писал» — только час: сами письма после него стёрты.
    ...(Number(saved.last?.at) > 0 ? { last: { at: Number(saved.last.at) } } : {}),
    // Почта стола близкого: вести, которые не ушли сразу. Поля нет, пока она пуста.
    ...(Array.isArray(saved.mail) && saved.mail.some(item => item && item.text) ? { mail: saved.mail.filter(item => item && item.text).slice(-DESK_MAIL_MAX) } : {}),
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

/**
 * Работа секретаря (с 0.55.0 — здесь; до того лежала в `heart.js`, раздел «секретарь»): подключение аккаунта,
 * письма из чужих чатов, отлучка и расписание, столы близких, слова хозяина секретарю. Вынесена из сердца из-за
 * веса: один модуль не должен весить больше 640 КБ, а сердце подошло к 610 (сообщение 65).
 *
 * `H` — инструменты сердца одним объектом: хранилище, отправка в Telegram, время, пульс, её слова. Сердце
 * собирает его само (`createHeart`, раздел «секретарь») и получает обратно функции, которыми пользуется остальной
 * его код. Всё, что названо через `H.`, живёт в сердце; остальное — здесь. Код внутри тот же, что был в сердце,
 * слово в слово: переносил разбор по дереву программы, а не правка руками.
 */
export function createDesk(H) {
  // ── секретарь ───────────────────────────────────────────────────────────
  const STRANGER_PREFIX = "heart:secretary:stranger:";
  const HOW_TO_CONNECT = "Чтобы я стала вашим секретарём, нужны два шага. Первый — в @BotFather включить мне Secretary Mode (настройки бота). Второй — в своём Telegram: Настройки → «Автоматизация чатов» (Chat Automation), выбрать меня и чаты, куда меня пускать, и разрешить отвечать. Как только подключите — я напишу сама.";
  /** Близкому бот уже настроен хозяином: остаётся один шаг — в своём Telegram. */
  const HOW_TO_JOIN = "Чтобы я стала вашим секретарём, остался один шаг — в своём Telegram: Настройки → «Автоматизация чатов» (Chat Automation), выбрать меня и чаты, куда меня пускать, и разрешить отвечать. Как только подключите — я напишу сама.";
  const HOW_TO_ASK = "Близкому человеку достаточно подключить меня у себя — Настройки → «Автоматизация чатов» (Chat Automation), — и я сразу спрошу вас.";
  /**
   * Стол — секретарь одного человека. У хозяина стол есть всегда (ключ прежний); у близких —
   * по его слову: кому разрешено и кто просит, лежит в `DESKS_KEY`. У каждого стола своё
   * состояние, свои вести и свой список «кто писал»: чужой стол не показывается никому, и хозяину тоже.
   */
  const OWNER_DESK = Object.freeze({ id: H.OWNER, key: SECRETARY_KEY, mine: true });
  const guestDesk = (id) => ({ id: Number(id), key: deskKey(id), mine: false });
  const desksState = async () => desksOf(await H.store.get(DESKS_KEY).catch(() => null));
  const mutateDesks = (change) => H.store.update(DESKS_KEY, raw => {
    const next = change(desksOf(raw));
    return next ? { ...next, at: H.now() } : null;
  });
  /** Чей это стол: хозяина, близкого — или ничей (null). */
  async function deskFor(userId) {
    if (H.owner(userId)) return OWNER_DESK;
    if (userId == null || !(H.OWNER > 0) || !H.store.available) return null;
    return (await desksState()).list.some(item => String(item.id) === String(userId)) ? guestDesk(userId) : null;
  }
  const allDesks = async () => [OWNER_DESK, ...(await desksState()).list.map(item => guestDesk(item.id))];
  const deskState = async (desk) => stateOf(await H.store.get(desk.key).catch(() => null));
  /** Отметки «уже сказано» чужого стола — со своим началом: отлучки разных людей не встретятся. */
  const sinceOf = (desk, since) => (desk.mine ? since : `${desk.id}.${since}`);
  /** Счётчики чужого стола — отдельные: «ответила за вас» в сводке хозяина значит за него. */
  const bumpDesk = (desk, name) => H.pulse.bump(desk.mine ? name : `${name}_kin`);
  /**
   * Отметка «я первая»: `setIfAbsent` считает победителем того, чьё значение легло в базу, —
   * поэтому значение у каждой попытки своё. Случайность здесь настоящая, а не из настроек
   * сердца: в тестах та одинакова, и два письма разом «побеждали» бы оба.
   */
  const stamp = (id = null) => ({ at: H.now(), id, r: Math.floor(Math.random() * 1e9) });
  const AWAY_OFF = Object.freeze({ on: false, since: 0, until: 0, words: "", ru: "", en: "" });
  /**
   * Правка состояния поверх самого свежего. Письма приходят одновременно, каждое —
   * своему запуску: записать то, что прочитано в начале, значит затереть письмо
   * соседа. `change` получает свежее состояние и возвращает новое — или null,
   * если править уже нечего. Вернёт true, если правка легла.
   */
  const mutateDesk = (desk, change) => H.store.update(desk.key, raw => {
    const next = change(stateOf(raw));
    return next ? { ...next, at: H.now() } : null;
  });
  const deskZone = async (desk) => H.zoneOf({ manner: await H.mannerFor(desk.id, { dry: true }).catch(() => null) });
  const ownerZone = () => deskZone(OWNER_DESK);
  /** Второй ответ человеку: «передам», «уже сообщила, что срочно» или оба сразу. */
  const ackWords = (kind, english) => {
    if (english) return ackEnglish(kind);
    const pool = kind === "both" ? "+секретарь:срочно и передам" : kind === "urgent" ? "+секретарь:срочно" : "+секретарь:передам";
    return (H.PHRASES ? H.book.pick(pool, { formal: true }) : null) ?? ackRussian(kind);
  };
  /** «в 16:10» сегодня, «14.11 в 16:10» — в другой день. */
  const whenShort = (at, zone) => {
    const [a, b] = [H.localParts(at, zone), H.localParts(H.now(), zone)];
    const clockText = H.localClock(at, zone);
    return a.y === b.y && a.m === b.m && a.d === b.d ? clockText : `${String(a.d).padStart(2, "0")}.${String(a.m).padStart(2, "0")} в ${clockText}`;
  };
  /**
   * Сказать хозяину сразу. Длинный список — частями: одним сообщением Telegram его
   * не примет, а список после этого стирается. Что не ушло — уйдёт с очередью вестей.
   */
  async function tellOwnerNow(text, key = "") {
    if (!(H.OWNER > 0)) return false;
    // Часть — не длиннее вести: иначе очередь вестей обрезала бы её.
    const parts = H.partsOf(text, 3700);
    let sent = 0;
    try {
      for (const part of parts) {
        await H.api.sendMessage({ chat_id: H.OWNER, text: part, disable_web_page_preview: true });
        sent += 1;
      }
      return true;
    } catch {
      const base = key || `secretary:${H.now()}`;
      for (let index = sent; index < parts.length; index += 1) {
        try { await H.notices.tell({ key: parts.length > 1 ? `${base}:${index + 1}` : base, text: parts[index] }); } catch { /* вести подождут */ }
      }
      return false;
    }
  }

  /**
   * Сказать человеку стола сразу. Хозяину — как прежде: не ушло — уйдёт с очередью вестей. Близкому —
   * в личку с ней; не ушло — ложится в «почту» стола и уходит со следующим ударом будильника.
   */
  async function tellDesk(desk, text, key = "") {
    if (desk.mine) return tellOwnerNow(text, key);
    const parts = H.partsOf(text, 3700);
    let sent = 0;
    try {
      for (const part of parts) {
        await H.api.sendMessage({ chat_id: desk.id, text: part, disable_web_page_preview: true });
        sent += 1;
      }
      return true;
    } catch {
      const rest = parts.slice(sent).map(part => ({ text: part, at: H.now() }));
      await mutateDesk(desk, cur => ({ ...cur, mail: [...(cur.mail ?? []), ...rest].slice(-DESK_MAIL_MAX) })).catch(() => false);
      return false;
    }
  }
  /** Несрочное слово человеку стола, один раз по ключу: хозяину — вестью, близкому — сразу в личку. */
  async function tellLater(desk, key, text) {
    if (desk.mine) { try { await H.notices.tell({ key, text }); } catch { /* вести подождут */ } return; }
    if (await H.store.setIfAbsent(`${TOLD_PREFIX}${desk.id}.note:${key}`, stamp()).catch(() => false)) await tellDesk(desk, text, key);
  }

  /**
   * Окно расписания, в которое попадает момент `at`: `{ from, to }` — или null,
   * если сейчас не его часы. Окно через полночь («с 23 до 7») началось вчера.
   */
  function planWindow(plan, at, zone) {
    if (!plan) return null;
    const [fh, fm] = String(plan.from).split(":").map(Number), [th, tm] = String(plan.to).split(":").map(Number);
    const over = th * 60 + tm <= fh * 60 + fm;
    for (const back of [0, 1]) {
      const day = H.localParts(at - back * H.DAY, zone);
      const from = H.zonedEpoch({ y: day.y, m: day.m, d: day.d, hh: fh, mm: fm }, zone);
      const to = H.zonedEpoch({ y: day.y, m: day.m, d: day.d + (over ? 1 : 0), hh: th, mm: tm }, zone);
      if (at >= from && at < to) return { from, to };
    }
    return null;
  }
  const planText = (plan) => `каждый день с ${plan.from} до ${plan.to}`;
  /** Слова, которые получат люди: из словаря, один раз на отлучку — хозяин видит ровно их. */
  function awayWords({ name = "", clockText = "", words = "" }) {
    const vars = { "кто": name || "Владелец этого аккаунта", ...(clockText ? { "срок": clockText } : {}), ...(words ? { "слова": words } : {}) };
    const ru = (H.PHRASES ? H.book.pick(words ? "+секретарь:слова" : clockText ? "+секретарь:нет на связи до" : "+секретарь:нет на связи", { formal: true, vars }) : null)
      ?? noticeRussian({ name, until: clockText, words });
    return { ru, en: noticeEnglish({ name, until: clockText, words }) };
  }
  /**
   * Начать отлучку (или сменить срок и слова идущей). `auto` — начал будильник по
   * расписанию: такая не перебивает отлучку, которую хозяин включил сам.
   * Вернёт слова для людей — или null, если запись не легла.
   */
  async function beginAway(desk, { at, until, words = "", clockText = "", auto = false }) {
    let said = null;
    const armed = await mutateDesk(desk, cur => {
      if (!cur.conn || (auto && cur.away.on)) return null;
      said = awayWords({ name: cur.conn.name || "", clockText, words });
      // Отлучка уже шла — меняются срок и слова, а список писавших и «уже сказано» остаются.
      const going = cur.away.on;
      return { ...cur, away: { on: true, since: going ? cur.away.since : at, until, words, ru: said.ru, en: said.en, ...(auto ? { auto: true } : {}) }, ...(going ? {} : { people: [], more: 0, own: {} }) };
    });
    return armed ? said : null;
  }

  /** Кто писал, пока хозяина не было, — словами для него самого. */
  function secretaryDigest(state, zone) {
    // Свежие — первыми: каждое новое письмо переносит человека в конец списка.
    const people = [...state.people].reverse();
    const since = state.away.since ? ` (с ${whenShort(state.away.since, zone)})` : "";
    if (!people.length) return `Пока вас не было${since}, в личку никто не писал.`;
    // Показываются все, кого она помнит: список после этого стирается, и «…и ещё двадцать» пропали бы.
    const rows = people.flatMap(item => [`${item.urgent ? "❗" : "•"} ${item.name}${item.user ? ` (@${item.user})` : ""} — ${item.n} ${H.plural(item.n, "сообщение", "сообщения", "сообщений")}, ${item.n > 1 ? "последнее — " : ""}${whenShort(item.at, zone)}: ${item.text}${item.urgent ? " · срочное" : ""}`, ...(Array.isArray(item.asks) ? item.asks : []).map(ask => `   просьба передать: «${ask}»`)]);
    const more = Number(state.more) || 0, total = people.length + more;
    const told = people.filter(item => item.told).length, failed = people.filter(item => item.failed && !item.told).length;
    // Кому велено не отвечать — отдельной строкой: это не её промах.
    const hushed = people.filter(item => item.mute && !item.told);
    const tail = !state.conn?.reply ? "Отвечать за вас мне не разрешено — я только записывала."
      : told === people.length ? `Каждому${more ? " из перечисленных" : ""} я один раз сказала, что вы не на связи.`
        : [
          told ? `Сказала, что вы не на связи, — ${told} из ${people.length}.` : "Никому не отвечала.",
          failed ? `Не вышло ответить — ${failed}: Telegram отказал, проверьте права подключения.` : "",
          hushed.length ? `По вашему слову не отвечала — ${hushed.length}: ${hushed.map(item => item.name).join(", ")}.` : "",
          people.length - told - failed - hushed.length > 0 ? "Остальным не стала: вы писали им сами, письмо дошло с опозданием или ответов за час было слишком много." : "",
        ].filter(Boolean).join(" ");
    return [
      `Пока вас не было${since}, писали — ${total} ${H.plural(total, "человек", "человека", "человек")}:`,
      ...rows,
      more ? `Ещё ${more} ${H.plural(more, "человек писал", "человека писали", "человек писали")} до них: список у меня на ${PEOPLE_MAX} человек, тех я уже не помню — смотрите в самих чатах.` : "",
      tail,
    ].filter(Boolean).join("\n");
  }

  /**
   * Кончить отлучку: список «кто писал» отдаётся хозяину и стирается — чужие
   * письма у неё дольше не лежат. Возвращает текст списка; null — отлучку уже
   * кончил другой запуск или запись не прошла: говорить хозяину нечего.
   * `expired` — кончать, только если срок и правда вышел: хозяин мог его продлить.
   */
  async function endAway(desk, zone, { expired = false, detail = null } = {}) {
    let text = "", since = 0, people = [];
    const done = await mutateDesk(desk, cur => {
      if (!cur.away.on || (expired && !(cur.away.until && H.now() >= cur.away.until))) return null;
      text = secretaryDigest(cur, zone);
      since = cur.away.since;
      people = cur.people;
      if (detail) Object.assign(detail, { auto: cur.away.auto === true, wrote: cur.people.length + (Number(cur.more) || 0) });
      // Хозяин вернулся посреди часов расписания — до конца этого окна она сама не начнёт.
      const window = expired ? null : planWindow(cur.plan, H.now(), zone);
      return { ...cur, away: { ...AWAY_OFF }, people: [], more: 0, own: {}, last: { at: H.now() }, ...(window ? { plan: { ...cur.plan, skip: window.to } } : {}) };
    });
    if (!done) return null;
    // Отметки «уже сказано» больше не нужны; не убрались — их сметёт уборка.
    await Promise.all(people.slice(0, 40).map(item => H.store.remove(toldKey(sinceOf(desk, since), item.id)).catch(() => false)));
    return text;
  }
  /** Срок отлучки вышел: рассказать хозяину, кто писал. Ночь по расписанию, когда никто не писал, — молча. */
  async function tellAwayEnded(desk, text, detail, since) {
    if (detail.auto && !detail.wrote) return;
    await tellDesk(desk, `${detail.auto ? "Часы расписания кончились" : "Срок вышел"}: за вас я больше не отвечаю.\n\n${text}`, `secretary:end:${since}`);
  }

  /** Срок вышел — она сама перестаёт отвечать и рассказывает, кто писал. Зовётся с будильника. */
  async function secretaryClock() {
    if (!H.store.available || !(H.OWNER > 0)) return;
    for (const desk of await allDesks()) {
      try { await deskClock(desk); } catch { /* этот стол проверится со следующим ударом */ }
    }
  }
  async function deskClock(desk) {
    const state = await deskState(desk);
    // Почта близкого: что не ушло сразу, уходит с ударом будильника. Старше суток — уже не новость.
    if (!desk.mine && state.mail?.length) {
      const gone = new Set();
      try {
        for (const item of state.mail) {
          if (H.now() - Number(item.at) < H.DAY) await H.api.sendMessage({ chat_id: desk.id, text: String(item.text), disable_web_page_preview: true });
          gone.add(`${item.at}:${item.text}`);
        }
      } catch { /* не ушло и сейчас — уйдёт со следующим ударом */ }
      if (gone.size) {
        await mutateDesk(desk, cur => {
          const { mail: before = [], ...rest } = cur;
          const left = before.filter(item => !gone.has(`${item.at}:${item.text}`));
          return left.length ? { ...rest, mail: left } : rest;
        }).catch(() => false);
      }
    }
    if (!state.away.on) return;
    if (!H.SECRETARY) {
      // Выключили настройкой посреди отлучки: письма к ней больше не идут, а список остался бы
      // лежать. Обещано, что он живёт только до конца отлучки, — отдать хозяину и стереть.
      const text = await endAway(desk, await deskZone(desk));
      if (text != null) await tellDesk(desk, `Секретарь выключен в настройках: за вас я больше не отвечаю.\n\n${text}`, `secretary:end:${state.away.since}`);
      return;
    }
    if (!state.away.until || H.now() < state.away.until) return;
    const detail = {};
    const text = await endAway(desk, await deskZone(desk), { expired: true, detail });
    if (text != null) await tellAwayEnded(desk, text, detail, state.away.since);
  }
  /** Расписание: настали его часы — она начинает отвечать сама. Молча: хозяин сам назвал эти часы. */
  async function secretaryPlan() {
    if (!H.SECRETARY || !H.store.available || !(H.OWNER > 0)) return;
    for (const desk of await allDesks()) {
      try { await deskPlan(desk); } catch { /* расписание этого стола проверится со следующим ударом */ }
    }
  }
  async function deskPlan(desk) {
    if (!H.SECRETARY || !H.store.available || !(H.OWNER > 0)) return;
    const state = await deskState(desk);
    if (!state.plan || !state.conn || state.away.on) return;
    const at = H.now(), zone = await deskZone(desk);
    const window = planWindow(state.plan, at, zone);
    if (!window || (Number(state.plan.skip) || 0) > at) return;
    if (await beginAway(desk, { at, until: window.to, words: String(state.plan.words ?? ""), clockText: H.localClock(window.to, zone), auto: true })) bumpDesk(desk, "secretary_plan");
  }

  /**
   * Подключение к аккаунту: событие `business_connection`. Секретарём она работает у
   * хозяина и у тех, кому он разрешил; о чужом подключении она спрашивает хозяина, один раз.
   */
  async function onBusinessConnection(connection, ctx = {}) {
    if (ctx?.testRun === true) return { ok: true, route: "business_connection", side_effects: "none" };
    try {
      if (!H.SECRETARY || !H.store.available || connection?.id == null) return { ignored: true };
      const userId = connection.user?.id;
      const desk = await deskFor(userId);
      if (!desk) return await strangerConnects(connection);
      if (connection.is_enabled === false) {
        const zone = await deskZone(desk);
        let digest = "", since = 0, people = [];
        const done = await mutateDesk(desk, cur => {
          // Снято не то подключение, с которым она работает (или она его и не знала): это не новость.
          if (!cur.conn || cur.conn.id !== String(connection.id)) return null;
          // Отлучка шла — список «кто писал» хозяин получит и тут: стереть молча было бы потерей.
          digest = cur.away.on ? secretaryDigest(cur, zone) : "";
          since = cur.away.since;
          people = cur.people;
          return { ...cur, conn: null, away: { ...AWAY_OFF }, people: [], more: 0, own: {} };
        });
        if (done) {
          await Promise.all(people.slice(0, 40).map(item => H.store.remove(toldKey(sinceOf(desk, since), item.id)).catch(() => false)));
          await tellDesk(desk, ["Подключение к вашему аккаунту снято: ваших чатов я больше не вижу и за вас не отвечаю.", digest].filter(Boolean).join("\n\n"), `secretary:off:${connection.id}:${H.now()}`);
        }
        if (done && !desk.mine) await mutateDesks(cur => ({ ...cur, list: cur.list.map(item => (String(item.id) === String(desk.id) ? { ...item, conn: "" } : item)) })).catch(() => false);
        return { ok: true, action: "secretary_disconnected" };
      }
      const conn = { id: String(connection.id), name: H.safeName(connection.user?.first_name), reply: canReply(connection), at: H.now() };
      let before = null, away = false;
      const saved = await mutateDesk(desk, cur => { before = cur.conn; away = cur.away.on; return { ...cur, conn }; });
      if (!saved) return { ok: false, code: "storage_unavailable" };
      if (!desk.mine) await mutateDesks(cur => ({ ...cur, list: cur.list.map(item => (String(item.id) === String(desk.id) ? { ...item, conn: conn.id, name: conn.name || item.name } : item)) })).catch(() => false);
      // Telegram шлёт это событие и при правке подключения: говорить стоит, только если что-то изменилось.
      if (before && before.id === conn.id && before.reply !== conn.reply) {
        await tellDesk(desk, conn.reply
          ? (away ? "Теперь мне разрешено отвечать в ваших чатах: тем, кто напишет вам дальше, один раз скажу, что вы не на связи."
            : "Теперь мне разрешено отвечать в ваших чатах. Сама не начну — только после слов «отвечай за меня».")
          : "Права отвечать в ваших чатах у меня больше нет: пока вас нет, смогу только записывать, кто писал. Вернуть его можно в настройках подключения в Telegram.",
        `secretary:right:${conn.id}:${conn.reply}:${H.now()}`);
      } else if (!before || before.id !== conn.id) {
        await tellDesk(desk, [
          "Вижу подключение к вашему аккаунту: теперь мне приходят письма из тех ваших личных чатов, куда вы меня пустили.",
          "Пока я в них молчу и ничего не записываю. Скажете «отвечай за меня» — каждому, кто вам напишет, один раз отвечу, что вы не на связи, и запомню, кто писал. «Я тут» — перестану и расскажу.",
          "Что я при этом храню: имя человека, время, первые слова его последнего письма и то, что он просил передать, — только пока отвечаю за вас; вернётесь — расскажу и сотру. Модели эти письма не показываю и никуда не передаю.",
          conn.reply ? "" : "Права отвечать вы мне не дали: смогу только записывать, кто писал. Дать его можно в настройках подключения в Telegram.",
        ].filter(Boolean).join("\n\n"), `secretary:on:${conn.id}:${conn.reply}`);
      }
      return { ok: true, action: "secretary_connected", reply: conn.reply };
    } catch (error) {
      await H.reportCrash(error, ctx);
      return { ok: false, code: "runtime_error" };
    } finally {
      try { await H.pulse.commit(); } catch { /* счётчики не важнее */ }
    }
  }

  /** Подключение, о котором она не знает: чьё оно, скажет Telegram. Хозяина или близкого — принимает; чужое — запоминает как чужое. */
  async function adoptConnection(connId) {
    if (await H.store.get(`${ALIEN_PREFIX}${connId}`).catch(() => null)) return null;
    let info = null;
    try { info = await H.api.getBusinessConnection({ business_connection_id: connId }); } catch { return null; }
    const desk = await deskFor(info?.user?.id);
    if (!desk) { await H.store.set(`${ALIEN_PREFIX}${connId}`, { at: H.now() }).catch(() => false); return null; }
    if (info.is_enabled === false) return null;
    const conn = { id: connId, name: H.safeName(info.user?.first_name), reply: canReply(info), at: H.now() };
    if (!await mutateDesk(desk, cur => ({ ...cur, conn }))) return null;
    if (!desk.mine) await mutateDesks(cur => ({ ...cur, list: cur.list.map(item => (String(item.id) === String(desk.id) ? { ...item, conn: connId, name: conn.name || item.name } : item)) })).catch(() => false);
    return { desk, state: await deskState(desk) };
  }

  /**
   * Письмо из личного чата хозяина: событие `business_message`. Это не
   * разговор с ней: ни команд, ни игр, ни модели. Пока хозяин не сказал
   * «отвечай за меня», она молчит и ничего не записывает.
   */
  async function onBusinessMessage(message, ctx = {}) {
    if (ctx?.testRun === true) return { ok: true, route: "business_message", side_effects: "none" };
    try {
      const connId = message?.business_connection_id;
      const chatId = message?.chat?.id;
      if (!H.SECRETARY || !H.store.available || !(H.OWNER > 0) || !connId || chatId == null || message?.chat?.type !== "private") return { ignored: true };
      // Её собственные ответы и автоответы самого Telegram приходят сюда же: это не письма.
      if (message.sender_business_bot || message.is_from_offline === true) return { ignored: true, reason: "echo" };
      // Чьё письмо: стол находится по подключению. Незнакомое подключение — спрашивается у Telegram.
      let desk = OWNER_DESK;
      let state = await deskState(desk);
      if (state.conn?.id !== String(connId)) {
        const kin = (await desksState()).list.find(item => String(item.conn ?? "") === String(connId));
        const known = kin ? { desk: guestDesk(kin.id), state: await deskState(guestDesk(kin.id)) } : null;
        const taken = known?.state.conn?.id === String(connId) ? known : await adoptConnection(String(connId));
        if (!taken?.state?.conn) return { ignored: true, reason: "not_owner" };
        ({ desk, state } = taken);
      }
      const at = H.now();
      if (state.away.on && state.away.until && at >= state.away.until) {
        const detail = {};
        const text = await endAway(desk, await deskZone(desk), { expired: true, detail });
        if (text != null) {
          await tellAwayEnded(desk, text, detail, state.away.since);
          return { ignored: true, reason: "not_away" };
        }
        // Кончать было нечего: либо отлучку уже кончил соседний запуск, либо хозяин только что продлил срок.
        state = await deskState(desk);
        if (!state.conn || !state.away.on || (state.away.until && at >= state.away.until)) return { ignored: true, reason: "not_away" };
      }
      // Часы расписания уже идут, а будильник ещё не ударил — отлучку начинает само письмо.
      if (!state.away.on && state.plan) {
        await deskPlan(desk).catch(() => null);
        state = await deskState(desk);
        if (!state.conn) return { ignored: true, reason: "not_owner" };
      }
      const since = state.away.since;
      const going = (cur) => cur.away.on && cur.away.since === since;
      if (String(message.from?.id) === String(desk.id)) {
        // Хозяин сам пишет в этом чате: туда она четверть часа не вмешивается.
        if (state.away.on) {
          await mutateDesk(desk, cur => (going(cur)
            ? { ...cur, own: Object.fromEntries(Object.entries({ ...cur.own, [chatId]: at }).sort((x, y) => Number(y[1]) - Number(x[1])).slice(0, 40)) }
            : null));
        }
        return { ignored: true, reason: "owner_speaks" };
      }
      if (!state.away.on) return { ignored: true, reason: "not_away" };
      if (message.from?.is_bot === true || String(chatId) === String(desk.id)) return { ignored: true, reason: "bot" };
      if (SERVICE_CHATS.includes(Number(chatId))) return { ignored: true, reason: "service" };

      const hour = Math.floor(at / 3_600_000);
      const same = (item) => String(item.id) === String(chatId);
      // Письмо — в список «кто писал» сразу, до ответа, и поверх самого свежего состояния:
      // соседнее письмо не затрётся, а вернись хозяин посреди отправки — человек в списке уже есть.
      let seen = null;
      const writer = { id: chatId, user: String(message.from?.username ?? message.chat?.username ?? "") };
      const noted = await mutateDesk(desk, cur => {
        if (!going(cur) || !cur.conn) return null;
        seen = { known: cur.people.find(same) ?? null, own: Number(cur.own?.[chatId]) || 0, sent: cur.sent.from === hour ? Number(cur.sent.n) || 0 : 0, conn: cur.conn, away: cur.away };
        // «Этим не отвечай»: письмо записывается, ответа не будет. Названный по @имени при первом письме получает номер и имя.
        seen.mute = cur.mute.some(item => mutedBy(item, writer));
        let people = notePerson(cur.people, message, at);
        seen.name = people.at(-1).name;
        if (seen.mute) people = people.map(item => (same(item) ? { ...item, mute: true } : item));
        const mute = seen.mute ? cur.mute.map(item => (mutedBy(item, writer) && item.id == null ? { ...item, id: chatId, name: seen.name } : item)) : cur.mute;
        // Список — на сорок человек: кого он вытеснил, того она уже не помнит, но счёт им ведёт.
        const pushed = cur.people.length + (seen.known ? 0 : 1) - people.length;
        return { ...cur, people, mute, more: cur.more + Math.max(0, pushed) };
      });
      // Не записалось: хозяин уже вернулся или хранилище молчит — отвечать за него тогда нельзя.
      if (!noted) return { ignored: true, reason: "not_away" };
      bumpDesk(desk, "secretary_seen");
      const fresh = !(Number(message.date) > 0) || at - Number(message.date) * 1000 < STALE_MS;
      const busy = at - seen.own < OWNER_BUSY_MS;
      const urgent = isUrgent(message), relay = isRelay(message), english = langOf(message) === "en";
      // Что она ответила на это письмо — для вести хозяину о срочном.
      let replied = "";
      const may = seen.conn.reply && fresh && !busy && !seen.mute && seen.known?.told !== true && seen.known?.failed !== true;
      let action = "secretary_noted";
      if (may && seen.sent >= NOTICES_PER_HOUR) {
        // Писем слишком много — похоже на рассылку или на двух секретарей друг против друга.
        await tellLater(desk, `secretary:cap:${hour}`, `Секретарь: за час я ответила за вас ${NOTICES_PER_HOUR} раз и остановилась до следующего часа — писем слишком много. Записывать, кто писал, продолжаю.`);
      } else if (may && await H.store.setIfAbsent(toldKey(sinceOf(desk, since), chatId), stamp(message.message_id))) {
        // Отметка её: этому человеку отвечает именно этот запуск. У кого отметка не легла —
        // тому человеку уже отвечает (ответил или не смог) другой запуск: повторять незачем.
        const base = (english ? seen.away.en : seen.away.ru) || noticeRussian({ name: seen.conn.name });
        // Первое же письмо срочное — человек сразу узнаёт, что хозяину сообщили.
        const text = urgent ? `${base} ${ackWords("urgent", english)}` : base;
        let told = false;
        try {
          await H.api.sendMessage({ business_connection_id: String(connId), chat_id: chatId, text });
          told = true;
          replied = urgent ? "first_urgent" : "first";
          bumpDesk(desk, "secretary");
          action = "secretary_notice";
        } catch (error) {
          action = "secretary_failed";
          if (!desk.mine) await tellLater(desk, `secretary:failed:${since}`, "Секретарь: ответить за вас не вышло — Telegram отказал. Проверьте в настройках подключения, что мне разрешено отвечать на сообщения.");
          else await H.notices.report({ component: "secretary", code: "send_failed", title: "Секретарь", detail: `ответить за вас не вышло: ${String(error?.description ?? error?.message ?? error).slice(0, 160)}`, severity: "degraded", hint: "Проверьте в Telegram, что в подключении мне разрешено отвечать." }).catch(() => null);
        }
        // Чем кончилось — в список; счёт ответов за час растёт и от неудачной попытки.
        await mutateDesk(desk, cur => {
          if (!going(cur)) return null;
          const base = cur.sent.from === hour ? Number(cur.sent.n) || 0 : 0;
          return { ...cur, people: cur.people.map(item => (same(item) ? { ...item, told, failed: !told } : item)), sent: { from: hour, n: base + 1 } };
        });
      }

      // Срочное — хозяину сразу: и когда письмо опоздало, и когда отвечать ей нельзя. Там, где
      // он пишет сам, звать его незачем — он это письмо видит. От одного человека — не чаще
      // раза в две минуты: «срочно», «ну где ты», «срочно!!» приходят очередью.
      const ping = urgent && !busy && await H.store.setIfAbsent(urgentKey(sinceOf(desk, since), chatId, at), stamp(message.message_id));
      // После её первого ответа: просят передать — «обязательно передам»; срочное — «уже сообщила».
      // Не больше трёх таких ответов человеку за отлучку и в общий счёт ответов за час.
      if (seen.known?.told === true && (relay || ping) && seen.conn.reply && fresh && !busy && !seen.mute && seen.sent < NOTICES_PER_HOUR) {
        const reserved = await mutateDesk(desk, cur => {
          const person = cur.people.find(same);
          if (!going(cur) || !person || (Number(person.acks) || 0) >= ACKS_MAX) return null;
          const base = cur.sent.from === hour ? Number(cur.sent.n) || 0 : 0;
          return { ...cur, people: cur.people.map(item => (same(item) ? { ...item, acks: (Number(item.acks) || 0) + 1 } : item)), sent: { from: hour, n: base + 1 } };
        });
        if (reserved) {
          try {
            await H.api.sendMessage({ business_connection_id: String(connId), chat_id: chatId, text: ackWords(relay && ping ? "both" : ping ? "urgent" : "relay", english) });
            replied = ping ? "ack_urgent" : "ack";
            bumpDesk(desk, "secretary");
            if (action === "secretary_noted") action = "secretary_ack";
          } catch { /* второй ответ не ушёл — письмо всё равно в списке, а срочное хозяин получит */ }
        }
      }
      if (ping) {
        bumpDesk(desk, "secretary_urgent");
        const zone = await deskZone(desk);
        const who = `${seen.name}${message.from?.username ? ` (@${String(message.from.username).slice(0, 32)})` : ""}`;
        const when = fresh ? "" : ` — письмо от ${whenShort(Number(message.date) * 1000, zone)}, дошло с опозданием`;
        const done = replied === "first_urgent" ? "Я ответила, что вы не на связи и что сообщила вам сразу."
          : replied === "ack_urgent" ? "Я ответила, что уже сообщила вам."
            : seen.mute ? "Сама я не отвечала: этому человеку вы велели не отвечать."
              : "Сама я на это письмо не отвечала.";
        await tellDesk(desk, `❗ Срочное. ${who} пишет вам${when}:\n«${quoteOf(message, URGENT_EXCERPT)}»\n${done}`, `secretary:urgent:${since}:${chatId}:${message.message_id}`);
        if (action === "secretary_noted" || action === "secretary_ack") action = "secretary_urgent";
      }
      return { ok: true, action };
    } catch (error) {
      await H.reportCrash(error, ctx);
      return { ok: false, code: "runtime_error" };
    } finally {
      try { await H.pulse.commit(); } catch { /* счётчики не важнее */ }
    }
  }

  // ── столы близких: у кого она секретарь кроме хозяина ───────────────────────
  const deskLabel = (item) => `${item?.name || "Без имени"}${item?.user ? ` (@${item.user})` : ""}`;
  const deskButtons = (id) => ({ inline_keyboard: [[{ text: "Разрешить", callback_data: `s:y:${id}` }, { text: "Отказать", callback_data: `s:n:${id}` }]] });
  /**
   * Её подключил к себе не хозяин и не тот, кому он разрешил. Чаты этого человека она не читает;
   * хозяину — вопрос с кнопками, человеку — что вопрос задан. Один раз на человека за тридцать дней:
   * Telegram шлёт это событие и при каждой правке подключения.
   */
  async function strangerConnects(connection) {
    const userId = connection.user?.id;
    await H.store.set(`${ALIEN_PREFIX}${connection.id}`, { at: H.now() }).catch(() => false);
    H.pulse.bump("secretary_alien");
    if (userId == null || !(H.OWNER > 0)) return { ignored: true, reason: "not_owner" };
    const same = (item) => String(item.id) === String(userId);
    if (connection.is_enabled === false) {
      // Человек снял подключение — и просьбы больше нет.
      await mutateDesks(cur => (cur.asks.some(same) ? { ...cur, asks: cur.asks.filter(item => !same(item)) } : null)).catch(() => false);
      return { ignored: true, reason: "not_owner" };
    }
    const ask = { id: userId, name: H.safeName(connection.user?.first_name), user: String(connection.user?.username ?? "").slice(0, 32), conn: String(connection.id), reply: canReply(connection), at: H.now() };
    await mutateDesks(cur => ({ ...cur, asks: [...cur.asks.filter(item => !same(item)), ask].slice(-DESK_ASKS_MAX) })).catch(() => false);
    if (!await H.store.setIfAbsent(`${STRANGER_PREFIX}${userId}`, stamp(connection.id)).catch(() => false)) return { ignored: true, reason: "not_owner" };
    if (connection.user_chat_id != null) {
      try {
        await H.api.sendMessage({
          chat_id: connection.user_chat_id,
          text: "Секретарём я работаю у хозяина и у тех, кому он разрешил. Я спросила его о вас: как ответит — напишу. До тех пор ваши чаты я не читаю и в них не отвечаю; подключение можно снять в настройках Telegram.\n\nI work as a secretary for my owner and for the people he allows. I have asked him about you and will write as soon as he answers. Until then I don't read or answer your chats; you can remove the connection in Telegram settings.",
        });
      } catch { /* человек не открывал чат с ней — сказать некуда */ }
    }
    const text = `${deskLabel(ask)} просит меня в секретари: подключение к своему аккаунту уже сделано.\n\nРазрешите — буду отвечать в тех чатах по слову «отвечай за меня», сказанному мне этим человеком; что там пишут, вам не показываю. Откажете — те чаты я не читаю.\n\nОтветить можно кнопкой или словами: «разреши секретаря» — или «не разрешай секретаря».`;
    try { await H.api.sendMessage({ chat_id: H.OWNER, text, reply_markup: deskButtons(userId) }); }
    catch { try { await H.notices.tell({ key: `secretary:ask:${userId}`, text }); } catch { /* вести подождут */ } }
    return { ok: true, action: "secretary_asked" };
  }
  /** Слово хозяина о просьбе: разрешить или отказать. Возвращает ответ ему; человеку пишет сама. */
  async function decideDesk(userId, allow) {
    let ask = null, full = false;
    const same = (item) => String(item.id) === String(userId);
    const done = await mutateDesks(cur => {
      ask = cur.asks.find(same) ?? null;
      full = false;
      if (!ask) return null;
      const asks = cur.asks.filter(item => !same(item));
      if (!allow) return { ...cur, asks };
      if (cur.list.length >= DESKS_MAX && !cur.list.some(same)) { full = true; return null; }
      return { ...cur, asks, list: [...cur.list.filter(item => !same(item)), { id: ask.id, name: ask.name, user: ask.user, conn: ask.conn, at: H.now() }] };
    }).catch(() => false);
    if (!ask) return "Этой просьбы у меня уже нет: её сняли или вы уже ответили.";
    if (full) return `Секретарём я работаю у вас и ещё у ${DESKS_MAX} человек — больше не беру. Освободить место — «забери секретаря у» и имя.`;
    if (!done) return "Не запомнилось: хранилище не отвечает.";
    const who = deskLabel(ask);
    if (!allow) {
      try { await H.api.sendMessage({ chat_id: ask.id, text: "Хозяин не разрешил: секретарём у вас я не работаю. Ваши чаты я не читаю и в них не отвечаю; подключение можно снять в настройках Telegram." }); } catch { /* сказать некуда */ }
      return `Хорошо, хозяин: отказано — ${who}. Те чаты я не читаю. Передумаете — пусть этот человек подключит меня у себя заново, а вы скажите «разреши секретаря».`;
    }
    const desk = guestDesk(ask.id);
    await H.store.remove(`${ALIEN_PREFIX}${ask.conn}`).catch(() => false);
    await mutateDesk(desk, cur => ({ ...cur, conn: { id: String(ask.conn), name: ask.name, reply: ask.reply === true, at: H.now() } })).catch(() => false);
    await tellDesk(desk, [
      "Хозяин разрешил: теперь я и ваш секретарь.",
      "Пока я в ваших чатах молчу и ничего не записываю. Скажете мне здесь «отвечай за меня» — каждому, кто вам напишет, один раз отвечу, что вы не на связи, и запомню, кто писал. «Я тут» — перестану и расскажу. Срок («…до 18:00»), свои слова для людей и расписание («ночью отвечай сама») тоже есть: спросите «секретарь».",
      "Что я при этом храню: имя человека, время, первые слова его последнего письма и то, что он просил передать, — только пока отвечаю за вас; вернётесь — расскажу и сотру. Модели эти письма не показываю и никуда не передаю — и хозяину тоже.",
      ask.reply === true ? "" : "Права отвечать вы мне не дали: смогу только записывать, кто писал. Дать его можно в настройках подключения в Telegram.",
    ].filter(Boolean).join("\n\n"), `secretary:desk:${ask.id}`);
    return `Хорошо, хозяин: ${who} — теперь я секретарь и там. Отвечать начну по слову «отвечай за меня», сказанному мне этим человеком; что там пишут, вам не показываю — как и ваши чаты там. Забрать — «забери секретаря у» и имя.`;
  }
  /** Забрать стол: что было записано — отдаётся его человеку и стирается; дальше те чаты не читаются. */
  async function revokeDesk(entry) {
    const desk = guestDesk(entry.id);
    const state = await deskState(desk);
    const digest = state.away.on ? secretaryDigest(state, await deskZone(desk)) : "";
    await mutateDesks(cur => ({ ...cur, list: cur.list.filter(item => String(item.id) !== String(entry.id)) })).catch(() => false);
    await Promise.all(state.people.slice(0, 40).map(item => H.store.remove(toldKey(sinceOf(desk, state.away.since), item.id)).catch(() => false)));
    await H.store.remove(desk.key).catch(() => false);
    // Подключит заново — хозяина спросят снова, не дожидаясь тридцати дней: этому человеку он уже доверял.
    await H.store.remove(`${STRANGER_PREFIX}${entry.id}`).catch(() => false);
    const conn = state.conn?.id ?? entry.conn;
    if (conn) await H.store.set(`${ALIEN_PREFIX}${conn}`, { at: H.now() }).catch(() => false);
    const text = ["Хозяин забрал у меня работу вашего секретаря: в ваших чатах я больше не отвечаю и их не читаю. Подключение можно снять в настройках Telegram.", digest].filter(Boolean).join("\n\n");
    try { for (const part of H.partsOf(text, 3700)) await H.api.sendMessage({ chat_id: entry.id, text: part, disable_web_page_preview: true }); } catch { /* сказать некуда — запись всё равно стёрта */ }
  }
  /** Слова хозяина о столах близких: у кого она секретарь, разрешить, отказать, забрать. Возвращает ответ ему. */
  async function desksWords(wish) {
    const desks = await desksState();
    const named = (rows, name) => rows.filter(item => sameNameAny(name, item.name) || (item.user && String(name).replace(/^@/u, "").toLowerCase() === String(item.user).toLowerCase()));
    const names = (rows) => rows.map(deskLabel).join(", ");
    if (wish.desks) {
      return [
        desks.list.length ? `Секретарём я работаю у вас — и, по вашему слову, ещё у ${desks.list.length}: ${names(desks.list)}.` : `Секретарём я работаю только у вас. ${HOW_TO_ASK}`,
        desks.list.length ? "Что пишут им, вам не показываю — как и ваши чаты им. Забрать — «забери секретаря у» и имя." : "",
        desks.asks.length ? `Просят и ждут вашего слова: ${names(desks.asks)}. Ответить — «разреши секретаря» или «не разрешай секретаря»${desks.asks.length > 1 ? " и имя" : ""}.` : "",
      ].filter(Boolean).join("\n");
    }
    if (wish.revoke !== undefined) {
      if (!desks.list.length) return "Кроме вас, я ни у кого секретарём не работаю.";
      const hits = wish.revoke ? named(desks.list, wish.revoke) : desks.list;
      if (hits.length !== 1) return `${hits.length ? "Таких несколько" : "Такого имени среди них нет"}. Секретарём я работаю ещё у: ${names(desks.list)}. Назовите точнее: «забери секретаря у» и имя или @имя.`;
      await revokeDesk(hits[0]);
      return `Хорошо, хозяин: ${deskLabel(hits[0])} — секретарём там больше не работаю и тех чатов не читаю. Что было записано, отдано этому человеку и стёрто.`;
    }
    const allow = wish.allow !== undefined;
    const name = allow ? wish.allow : wish.deny;
    if (!desks.asks.length) return allow ? `Просьб у меня сейчас нет. ${HOW_TO_ASK}` : "Просьб у меня сейчас нет: отказывать некому.";
    const hits = name ? named(desks.asks, name) : desks.asks;
    if (hits.length !== 1) return `${hits.length ? "Просят несколько человек" : "Такой просьбы нет"}. Ждут вашего слова: ${names(desks.asks)}. Назовите имя: «${allow ? "разреши" : "не разрешай"} секретаря» и имя.`;
    return decideDesk(hits[0].id, allow);
  }
  /** Кнопки под вопросом «разрешить секретаря?»: решает только хозяин. */
  async function pressDesk(query) {
    const done = async (text) => { try { await H.api.answerCallbackQuery({ callback_query_id: query.id, ...(text ? { text } : {}) }); } catch { /* не страшно */ } };
    const found = String(query?.data ?? "").match(/^s:([yn]):(-?\d+)$/u);
    if (!found || !H.owner(query?.from?.id)) { await done("Это решает хозяин."); return { ignored: true, reason: "not_owner" }; }
    const text = await decideDesk(found[2], found[1] === "y");
    await done("");
    // Кнопки сделали своё: под вопросом остаётся ответ.
    const chatId = query.message?.chat?.id, messageId = query.message?.message_id;
    if (chatId != null && messageId != null && H.has("editMessageReplyMarkup")) {
      try { await H.api.editMessageReplyMarkup({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }); } catch { /* кнопки останутся: второе нажатие ответит «просьбы уже нет» */ }
    }
    try { await H.api.sendMessage({ chat_id: H.OWNER, text }); } catch { /* ответ не ушёл — решение уже записано */ }
    return { ok: true, action: found[1] === "y" ? "secretary_allowed" : "secretary_denied" };
  }

  /**
   * Слова о секретаре — от хозяина или от близкого, которому он разрешил, и только в личке с ней:
   * «отвечай за меня до 18:00», «я тут», «кто мне писал?», «секретарь». Каждый говорит о своём столе.
   */
  async function secretaryWords(turn, prompt, { chatId = null } = {}) {
    const asked = parseSecretary(prompt);
    if (!asked) return null;
    const mine = H.owner(turn.actorId);
    // Чей стол: хозяина — или близкого, которому хозяин разрешил. Только в личке с ней.
    const desk = !H.SECRETARY || !turn.isPrivate ? null : mine ? OWNER_DESK : turn.dry ? null : await deskFor(turn.actorId);
    if (!desk) {
      // «Отвечай за меня» от того, у кого она не секретарь, — или от хозяина, но при всех. Говорится прямо: иначе
      // просьба уходила модели, а та соглашалась — и ничего не происходило (16.11.2026: в списке непонятого).
      // «Меня нет», «я не на связи» от гостя — обычные слова: отказ звучит только на прямую просьбу.
      if (!turn.dry && !(mine && turn.isPrivate) && (asked.on || asked.plan !== undefined) && /отвеч|ответь|секретар|подмени|прикрой/iu.test(prompt)) {
        H.pulse.bump("ruled");
        return H.say(turn, mine
          ? "Это — в личке со мной: там скажите «отвечай за меня», и я начну."
          : (H.PHRASES ? H.book.say(["отвечай за меня"], H.voiceCtx(turn)) : null) ?? "Секретарём я работаю у хозяина и у тех, кому он разрешил. Здесь, в нашем чате, помогу чем смогу.");
      }
      // «Кто мне писал?» от того, у кого она не секретарь: писем она не видит — и говорит это, а не отдаёт модели,
      // которая сочинила бы «никто». Короткое «кто писал?» без «мне» — обычные слова.
      if (H.SECRETARY && !turn.dry && !mine && turn.isPrivate && asked.who && !asked.bare) {
        H.pulse.bump("ruled");
        return H.say(turn, H.you(turn,
          "Ваших писем я не вижу: к вашему аккаунту я не подключена. Секретарём я работаю у хозяина и у тех, кому он разрешил.",
          "Твоих писем я не вижу: к твоему аккаунту я не подключена. Секретарём я работаю у хозяина и у тех, кому он разрешил."));
      }
      return null;
    }
    // Столы близких — слово хозяина: «у кого ты секретарь?», «разреши секретаря», «забери секретаря у …».
    if (asked.desks || asked.allow !== undefined || asked.deny !== undefined || asked.revoke !== undefined) {
      if (!desk.mine) return null;
      return H.say(turn, turn.dry ? "Разобрала бы это как слова о секретаре — репетиция." : await desksWords(asked));
    }
    if (turn.dry) return H.say(turn, "Разобрала бы это как слова о секретаре — репетиция.");
    // Близкому «хозяин» не говорится; слова о подключении — короче: бот уже настроен.
    const sir = desk.mine ? ", хозяин" : "";
    const howTo = desk.mine ? HOW_TO_CONNECT : HOW_TO_JOIN;
    const state = await deskState(desk);
    const zone = H.zoneOf(turn);
    // «Я тут» и «кто мне писал?» — слова обычные: без подключения и отлучки они не её.
    if (asked.back && !state.away.on) return null;
    // «Кто писал?» без «мне» — её слова, только когда она и правда секретарь этого человека: иначе это вопрос
    // о книге или о чате. С «мне» («кто мне писал?») — её всегда: без подключения отвечает честно, а не моделью,
    // которая сочинила бы «никто».
    // Хозяину в личке и на короткое «кто писал?» — тоже честно, в одну строку.
    if (asked.who && !state.conn) {
      return asked.bare && !desk.mine ? null : H.say(turn, "Писем я не вижу: к вашему аккаунту я не подключена. Как подключить — скажите «секретарь».");
    }
    // Короткое «не отвечай Маше» — её слова, только если такая Маша ей известна; иначе это разговор.
    if (asked.mute && !asked.mute.here && !asked.mute.strict
      && !asked.mute.names.every(name => [...state.people, ...state.mute].some(item => sameName(name, item.name)))) return null;
    if (!state.conn) {
      if (asked.status) return H.say(turn, `Секретарём я пока не работаю: к вашему аккаунту меня не подключали. ${howTo}`);
      if (asked.off || asked.planOff) return H.say(turn, "Я и не отвечала за вас: к вашему аккаунту я не подключена.");
      return H.say(turn, `Не могу: к вашему аккаунту я не подключена. ${howTo}`);
    }
    const untilText = (until) => (until ? `до ${whenShort(until, zone).replace(/^(\d\d\.\d\d) в /u, "$1, ")}` : "");
    // Открыли «Управление ботом» из чата с человеком — четверть часа «этому не отвечай» значит «ему».
    if (chatId != null) await mutateDesk(desk, cur => ({ ...cur, focus: { id: String(chatId), at: H.now() } }));

    // ── «этим не отвечай» ──
    if (asked.muted) {
      if (!state.mute.length) return H.say(turn, "Таких нет: когда отвечаю за вас, отвечаю всем. Закрыть кого-то — «не отвечай @имя» или из чата с человеком: «Управление ботом», затем «этому не отвечай».");
      return H.say(turn, `Не отвечаю никогда — ${state.mute.length}:\n${state.mute.map(item => `• ${muteLabel(item)}`).join("\n")}\nИх письма записываю, срочное передаю вам сразу. Вернуть — «снова отвечай @имя» или «отвечай всем».`);
    }
    if (asked.mute || asked.unmute) {
      const want = asked.mute ?? asked.unmute;
      const off = Boolean(asked.mute);
      if (want.all) {
        if (!state.mute.length) return H.say(turn, "Я и так отвечаю всем: список пуст.");
        if (!await mutateDesk(desk, cur => ({ ...cur, mute: [] }))) return H.say(turn, "Не запомнилось: хранилище не отвечает.");
        return H.say(turn, `Хорошо${sir}: снова отвечаю всем. Из списка убрано — ${state.mute.length}.`);
      }
      // Кого назвали: «этому» — чат, открытый через «Управление ботом»; иначе @имена и имена из списков.
      const picked = [], unknown = [], vague = [];
      if (want.here) {
        const focus = state.focus && H.now() - Number(state.focus.at) < FOCUS_MS ? state.focus : chatId != null ? { id: String(chatId) } : null;
        if (!focus) return H.say(turn, "Не знаю, о каком чате речь. Откройте чат с этим человеком, нажмите «Управление ботом» — и скажите мне это ещё раз. Или назовите его: «не отвечай @имя».");
        const person = state.people.find(item => String(item.id) === String(focus.id)) ?? state.mute.find(item => String(item.id) === String(focus.id));
        picked.push({ id: focus.id, name: person?.name ?? "", user: person?.user ?? "" });
      } else {
        for (const user of want.users) {
          const person = state.people.find(item => String(item.user).toLowerCase() === user) ?? state.mute.find(item => String(item.user ?? "").toLowerCase() === user);
          picked.push({ ...(person?.id != null ? { id: person.id } : {}), name: person?.name ?? "", user: person?.user || user });
        }
        for (const name of want.names) {
          const pool = off ? [...state.people, ...state.mute] : state.mute;
          const hits = pool.filter(item => sameName(name, item.name)).filter((item, index, list) => list.findIndex(other => String(other.id) === String(item.id)) === index);
          if (hits.length === 1) picked.push({ id: hits[0].id, name: hits[0].name, user: hits[0].user ?? "" });
          else if (hits.length > 1) vague.push(`«${name}» — это ${hits.map(muteLabel).join(" или ")}`);
          else unknown.push(name);
        }
      }
      if (vague.length) return H.say(turn, `Не пойму, кого вы назвали: ${vague.join("; ")}. Назовите по @имени — или откройте чат с человеком, «Управление ботом», и скажите «этому ${off ? "не " : ""}отвечай».`);
      if (unknown.length) {
        return H.say(turn, off
          ? `Не знаю, кто это: ${unknown.map(name => `«${name}»`).join(", ")}. По имени я узнаю только тех, кто писал вам, пока я отвечаю за вас. Назовите по @имени — или откройте чат с человеком, нажмите «Управление ботом» и скажите «этому не отвечай».`
          : `В списке тех, кому я не отвечаю, такого нет: ${unknown.map(name => `«${name}»`).join(", ")}. Кто в нём — «кому ты не отвечаешь?».`);
      }
      const hit = (entry) => (item) => mutedBy(item, { id: entry.id ?? null, user: entry.user });
      let full = false;
      const saved = await mutateDesk(desk, cur => {
        if (!off) return { ...cur, mute: cur.mute.filter(item => !picked.some(entry => hit(entry)(item))) };
        const fresh = picked.filter(entry => !cur.mute.some(hit(entry)));
        if (cur.mute.length + fresh.length > MUTE_MAX) { full = true; return null; }
        return { ...cur, mute: [...cur.mute, ...fresh.map(entry => ({ ...entry, at: H.now() }))] };
      });
      if (full) return H.say(turn, `В списке уже ${state.mute.length} — больше ${MUTE_MAX} не держу. Уберите кого-нибудь: «снова отвечай @имя».`);
      if (!saved) return H.say(turn, "Не запомнилось: хранилище не отвечает.");
      const names = picked.map(muteLabel).join(", ");
      if (!off) return H.say(turn, `Хорошо${sir}: ${names} — снова отвечаю, когда отвечаю за вас.`);
      return H.say(turn, `Хорошо${sir}: ${names} — не отвечаю никогда, даже когда отвечаю за вас. Письма записываю и покажу в списке; напишут «срочно» — сообщу вам сразу. Вернуть — «снова отвечай ${picked[0].user ? `@${picked[0].user}` : picked[0].name || "@имя"}».`);
    }

    // ── расписание ──
    if (asked.planOff) {
      if (!state.plan) return H.say(turn, "Расписания у меня и нет: отвечаю за вас только по слову «отвечай за меня».");
      if (!await mutateDesk(desk, cur => ({ ...cur, plan: null }))) return H.say(turn, "Не запомнилось: хранилище не отвечает.");
      return H.say(turn, `Хорошо${sir}: расписание (${planText(state.plan)}) убрано. Сама больше не начинаю — только по слову «отвечай за меня».${state.away.on && state.away.auto ? " Сейчас я ещё отвечаю за вас; кончить — «я тут»." : ""}`);
    }
    if ("plan" in asked) {
      if (!asked.plan) return H.say(turn, "Назовите часы — например: «отвечай за меня каждый день с 23 до 7» или просто «ночью отвечай сама» (это с 23:00 до 07:00).");
      const words = String(asked.words ?? "").replace(/\s+/gu, " ").trim().slice(0, 200);
      const plan = { from: asked.plan.from, to: asked.plan.to, words, skip: 0, at: H.now() };
      if (!await mutateDesk(desk, cur => (cur.conn ? { ...cur, plan } : null))) return H.say(turn, "Не запомнилось: хранилище не отвечает — расписания нет.");
      // Его часы уже идут — начинает сразу, а не со следующим ударом будильника.
      const at = H.now(), window = planWindow(plan, at, zone);
      const started = window && !state.away.on ? await beginAway(desk, { at, until: window.to, words, clockText: H.localClock(window.to, zone), auto: true }) : null;
      const sample = started ?? awayWords({ name: state.conn.name || "", clockText: plan.to, words });
      return H.say(turn, [
        `Хорошо${sir}: ${planText(plan)} отвечаю за вас сама${state.conn.reply ? "" : " — точнее, записываю, кто писал: отвечать мне не разрешено"}.${started ? " Эти часы уже идут — начала." : ""}`,
        state.conn.reply ? `Каждому, кто напишет вам в эти часы, один раз скажу:\n«${sample.ru}»` : "",
        "Когда часы кончатся, расскажу, кто писал; никто не писал — промолчу. Вернётесь раньше — «я тут»: до следующего раза не начну. Убрать — «убери расписание секретаря».",
      ].filter(Boolean).join("\n"));
    }
    if (asked.status) {
      const lines = [
        `Секретарь: к вашему аккаунту я подключена${state.conn.reply ? "" : ", но отвечать мне не разрешено — могу только записывать, кто писал"}.`,
        state.away.on
          ? `Сейчас отвечаю за вас ${untilText(state.away.until)}: писали — ${state.people.length + state.more} ${H.plural(state.people.length + state.more, "человек", "человека", "человек")}. Кто именно — «кто мне писал?»; закончить — «я тут».`
          : "Сейчас в ваших чатах я молчу и ничего не записываю. Начать — «отвечай за меня» (можно со сроком: «…до 18:00», «…на 2 часа») или со словами для людей: «отвечай за меня: я на встрече, перезвоню».",
        state.away.on && state.away.ru ? `Людям я говорю: «${state.away.ru}»` : "",
        state.plan ? `Расписание: ${planText(state.plan)} начинаю отвечать сама. Убрать — «убери расписание секретаря».` : "Расписания нет. Завести — «ночью отвечай сама» или «отвечай за меня каждый день с 23 до 7».",
        state.mute.length ? `Не отвечаю никогда — ${state.mute.length}: ${state.mute.slice(0, 8).map(muteLabel).join(", ")}${state.mute.length > 8 ? " и другие" : ""}. Весь список — «кому ты не отвечаешь?».` : "",
      ];
      // Открыто из чата с человеком («Управление ботом»): что она делала именно там.
      if (chatId != null) {
        const person = state.people.find(item => String(item.id) === String(chatId));
        lines.push(person
          ? `В том чате (${person.name}): за эту отлучку — ${person.n} ${H.plural(person.n, "сообщение", "сообщения", "сообщений")}; ${person.told ? "я один раз ответила, что вы не на связи" : "я не отвечала"}.`
          : state.away.on ? "В том чате за эту отлучку мне ничего не приходило — и я там ничего не писала." : "В том чате я ничего не писала.");
        lines.push(state.mute.some(item => String(item.id) === String(chatId))
          ? "Этому человеку я не отвечаю никогда — так вы велели. Вернуть — скажите сейчас «этому снова отвечай»."
          : "Чтобы я в том чате не отвечала никогда, скажите сейчас «этому не отвечай».");
      }
      return H.say(turn, lines.filter(Boolean).join("\n"));
    }
    if (asked.who) {
      if (!state.away.on) {
        // Список отдан при возвращении и стёрт: чужие письма она дольше не хранит. Помнит только, когда отдала.
        const given = Number(state.last?.at) || 0;
        return H.say(turn, given && H.now() - given < 2 * H.DAY
          ? `Сейчас я за вас не отвечаю и писем не записываю. Прошлый список я отдала вам ${whenShort(given, zone)} — он выше в этом чате; у себя я чужие письма не храню. Включить снова — «отвечай за меня».`
          : "Сейчас я за вас не отвечаю и писем не записываю. Включить — «отвечай за меня».");
      }
      return H.say(turn, secretaryDigest(state, zone));
    }
    if (asked.off || asked.back) {
      if (!state.away.on) return H.say(turn, "Я и так за вас не отвечаю.");
      const text = await endAway(desk, zone);
      if (text == null) {
        // Отлучку в эту же секунду кончил срок (список ушёл отдельным письмом) — или запись не прошла.
        const fresh = await deskState(desk);
        return H.say(turn, fresh.away.on ? "Не вышло: хранилище не отвечает, и я всё ещё отвечаю за вас. Скажите «я тут» ещё раз." : "Я и так за вас не отвечаю.");
      }
      return H.say(turn, `С возвращением${sir}. За вас больше не отвечаю.\n\n${text}`);
    }
    // «Отвечай за меня»: срок — названный или двенадцать часов, чтобы забытая отлучка не длилась неделю.
    const at = H.now();
    let until = at + AWAY_DEFAULT_MS;
    if (asked.span?.ms) until = at + Math.min(asked.span.ms, AWAY_MAX_MS);
    else if (asked.span?.at) {
      const parts = H.localParts(at, zone);
      const [hh, mm] = asked.span.at.split(":").map(Number);
      until = H.zonedEpoch({ y: parts.y, m: parts.m, d: parts.d, hh, mm }, zone);
      if (until <= at + 60_000) until += H.DAY;
    }
    const words = String(asked.words ?? "").replace(/\s+/gu, " ").trim().slice(0, 200);
    // Текст выбирается один раз: хозяин видит ровно то, что получат люди.
    const armed = await beginAway(desk, { at, until, words, clockText: asked.span ? H.localClock(until, zone) : "" });
    const ru = armed?.ru ?? "";
    if (!armed) return H.say(turn, "Не запомнилось: хранилище не отвечает — за вас не отвечаю.");
    if (!state.conn.reply) return H.say(turn, `Отвечать за вас мне не разрешено: ${untilText(until)} буду только записывать, кто писал. Вернётесь раньше — «я тут».`);
    return H.say(turn, [
      `Хорошо${sir}: ${untilText(until)} отвечаю за вас. Каждому, кто напишет вам в личку, один раз скажу:`,
      `«${ru}»`,
      "Тем, кто пишет не по-русски, — то же по-английски. Там, где вы пишете сами, не вмешиваюсь. Вернётесь раньше — «я тут».",
      "Напишут «срочно» — сразу сообщу вам сюда. Попросят что-то передать — отвечу, что передам, и покажу это в списке.",
    ].join("\n"));
  }

  return {
    OWNER_DESK, STRANGER_PREFIX, allDesks, deskFor, mutateDesk, mutateDesks, onBusinessConnection, onBusinessMessage,
    ownerZone, pressDesk, secretaryClock, secretaryPlan, secretaryWords, tellOwnerNow,
  };
}
