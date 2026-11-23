/**
 * «Вы и Аи» — одна карточка и две настройки, которые человек говорит словами.
 *
 * Раньше на этот экран вели шкалы, картинки и анкета: симпатия, доверие,
 * уважение, сцена, уровень. Человеку нужно другое — знать, как его зовут для
 * Аи, сколько вы знакомы и как она к нему относится. Числа остаются внутри:
 * они нужны коду, а не разговору.
 *
 * Здесь только хранение и разбор фраз. Отношения считает политика, текст
 * карточки собирает сердце — модуль не знает ни модели, ни Telegram.
 */

export const STYLE_KEY = userId => `heart:style:${userId}`;
export const FIRST_KEY = userId => `heart:first:${userId}`;

export const LENGTHS = Object.freeze(["кратко", "обычно", "подробно"]);

/** Имя — ярлык для обращения, а не анкета: буквы, цифры, дефис, до 32 знаков. */
export function cleanAddress(value) {
  const name = String(value ?? "").trim().replace(/\s+/gu, " ").replace(/[.,;:!?]+$/u, "");
  if (!name || name.length > 32) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(name)) return null;
  return name;
}

const ADDRESS = /(?:^|[\s,.])(?:зови(?:те)?|называй(?:те)?|обращай(?:ся|тесь)(?:\s+ко\s+мне)?)\s+(?:меня\s+)?(?:как\s+)?([^\n]{1,40})$/iu;

/** «зови меня Алекс», «называй меня просто Лёша» — просьба, а не команда. */
export function addressRequest(text) {
  const match = String(text ?? "").trim().match(ADDRESS);
  if (!match) return null;
  // «зови меня когда хочешь» — это не имя.
  if (/(?:^|\s)(?:когда|если|потом|завтра|сюда|туда|так|всегда|никогда|никак|на\s+(?:ты|вы))(?=\s|$)/iu.test(match[1])) return null;
  // «Зови меня по имени», «называй как хочешь» — не имя: раньше она отвечала «буду обращаться к вам „по имени“».
  if (/^(?:просто\s+)?(?:по\s+имени|по-другому|по\s+другому|иначе|(?:как\s+)?хоче(?:шь|те)|(?:как\s+)?угодно|как-нибудь|нормально|по-человечески|ласково|нежно|уважительно|проще|правильно|по-простому)$/iu.test(match[1].trim().replace(/[.,;:!?]+$/u, ""))) return null;
  return cleanAddress(match[1].replace(/^(?:просто|пожалуйста)\s+/iu, ""));
}

/** После «меня зовут» это не имя: «меня зовут на свадьбу», «меня зовут обедать». */
const NOT_INTRO = /^(?:на|в|во|к|ко|и|а|не|все|всех|друзья|домой|гулять|обедать|ужинать|есть|пить|играть|работать|туда|сюда|так|как|когда|просто|тоже|уже|опять|снова|сегодня|завтра|вчера|обратно|назад|замуж|с|со|никак|по)$/u;
const INTRO = /^(?:(?:привет|здравствуй(?:те)?|кстати|а|ну|аи)[,!.\s]+)*(?:меня\s+зовут|мо[её]\s+имя(?:\s*[—–-])?|зовут\s+меня)\s+(?:просто\s+)?([\p{L}][\p{L}-]{1,24})$/iu;
// То же другим порядком слов: «меня Айдина зовут», «Айдина меня зовут».
const INTRO_TURNED = /^(?:(?:привет|здравствуй(?:те)?|кстати|а|ну|аи)[,!.\s]+)*(?:меня\s+([\p{L}][\p{L}-]{1,24})\s+зовут|([\p{L}][\p{L}-]{1,24})\s+меня\s+зовут)$/iu;

/**
 * «Меня зовут Айдина» — знакомство целиком, без других слов: имя или null.
 * 16.11.2026 такая фраза ушла модели, а имя осталось вопросом «запомнить?» после ответа:
 * человек представился — и не был услышан.
 */
export function introRequest(text) {
  const line = String(text ?? "").trim().replace(/\s+/gu, " ").replace(/[.!…)]+$/u, "");
  if (!line || line.length > 60) return null;
  const match = line.match(INTRO);
  const turned = match ? null : line.match(INTRO_TURNED);
  const name = match ? match[1] : turned ? (turned[1] ?? turned[2]) : "";
  if (!name || NOT_INTRO.test(name.toLowerCase().replace(/ё/gu, "е")) || (turned && NOT_A_NAME.test(name.toLowerCase().replace(/ё/gu, "е")))) return null;
  return cleanAddress(`${name[0].toUpperCase()}${name.slice(1)}`);
}

const WHO_AM_I = /^(?:(?:а|ну|и|аи)[,\s]+)*(?:как\s+меня\s+зовут|как\s+мо[её]\s+имя|какое\s+у\s+меня\s+имя|(?:ты\s+)?(?:помнишь|знаешь|запомнила|не\s+забыла),?\s+как\s+меня\s+зовут|(?:ты\s+)?(?:помнишь|знаешь|запомнила)\s+мо[её]\s+имя|как\s+ты\s+меня\s+(?:называешь|зов[её]шь)|как\s+ты\s+ко\s+мне\s+обращаешься|кто\s+я(?:\s+так(?:ой|ая))?|(?:ты\s+)?знаешь,?\s+кто\s+я(?:\s+так(?:ой|ая))?|назови\s+мо[её]\s+имя|скажи\s+мо[её]\s+имя)$/iu;
const BY_NAME = /^(?:(?:пожалуйста|ну|аи)[,\s]+)*(?:(?:зови|называй)(?:те)?\s+меня\s+(?:просто\s+)?по\s+имени|обращай(?:ся|тесь)\s+(?:ко\s+мне\s+)?(?:просто\s+)?по\s+имени)$/iu;
/**
 * «Как меня зовут?», «ты знаешь, кто я?» → "who"; «зови меня по имени» → "by"; иначе null.
 * Ответ — из того, что человек сам о себе сказал: имя-обращение. Модель его могла и выдумать.
 */
export function nameQuestion(text) {
  const line = String(text ?? "").trim().toLowerCase().replace(/\s+/gu, " ").replace(/[.!?…)]+$/u, "");
  if (!line || line.length > 60) return null;
  return WHO_AM_I.test(line) ? "who" : BY_NAME.test(line) ? "by" : null;
}

/** Она спрашивает имя: «как вас зовут?», «как к вам обращаться?», «скажите „меня зовут …“». */
export const ASKS_NAME = /как\s+(?:вас|тебя)\s+зовут|(?:вас|тебя)\s+как\s+зовут|как\s+(?:мне\s+)?к\s+(?:вам|тебе)\s+обращаться|как\s+(?:мне\s+)?(?:вас|тебя)\s+(?:называть|звать)|[«"]меня\s+зовут\s*…[»"]|[«"]зови(?:те)?\s+меня\s*…[»"]|как\s+(?:ваше|твое|твоё)\s+имя/iu;
/** Одним словом на её вопрос об имени отвечают и не именем: «потом», «неважно», «зачем». */
const NOT_A_NAME = /^(?:да|нет|неа|не|ага|угу|ок|окей|оке|ладно|хорошо|понятно|ясно|потом|позже|никак|неважно|зачем|почему|что|чего|как|кто|где|когда|привет|пока|спасибо|отстань|хм|ну|эм|секрет|тайна|угадай|сама|сам|никто|никого|аноним|инкогнито|всё|все|так|это|тут|здесь|там|знаю|незнаю|хозяин|хозяйка|человек|друг|подруга|гость|аи|бот|она|он|мы|вы|ты|я|имя|просто|можно|зови|зовите|называй|называйте|меня|мне|давай|стоп|хватит|дальше|ещё|еще|снова|опять|тоже|уже|нормально|плохо|отлично|супер|класс|круто|жаль|увы|ой|ах|эх|ого|вау|лол|кек|хаха|ахах|блин|черт|фу|фиг|нафиг|пофиг|забей|забудь|нету|нечего|ничего|нисколько|нигде|никогда|часто|редко|иногда|обычно|всегда|давно|теперь|сейчас|щас|везде|дома|куда|занят|занята|некогда|подожди|минуту|секунду|думаю|подумаю|скажу|лень|хз|мб|спс|пж|алло|ау|эй|стой|погоди|момент|зря|мимо|дальше|пропусти|пропустим|отмена|выход|назад|меню|старт|помощь|тест|проверка)$/u;
const NAME_REPLY = /^(?:(?:можно\s+)?просто\s+|зови(?:те)?\s+|называй(?:те)?\s+|имя\s+)?([\p{L}][\p{L}-]{1,20})$/iu;
// «Я Айдина», «это Айдина» — только с большой буквы: «я дома», «я спать» — не имя.
const NAME_REPLY_I = /^(?:я|это|меня)\s+(\p{Lu}[\p{L}-]{1,20})$/u;
/**
 * Ответ одним словом на её вопрос об имени: «Айдина», «просто Айдина», «я Айдина» → имя или null.
 * 17.11.2026: она спросила «как к вам обращаться?», человек ответил «просто Айдина» — и это ушло модели.
 * Годится только сразу после её вопроса: что это ответ на него, решает сердце.
 */
export function nameReply(text) {
  const line = String(text ?? "").trim().replace(/\s+/gu, " ").replace(/[.!…)]+$/u, "");
  if (!line || line.length > 40) return null;
  const match = line.match(NAME_REPLY) ?? line.match(NAME_REPLY_I);
  if (!match || NOT_A_NAME.test(match[1].toLowerCase().replace(/ё/gu, "е"))) return null;
  return cleanAddress(`${match[1][0].toUpperCase()}${match[1].slice(1)}`);
}

/** «Не называй меня так», «не обращайся так» — убрать имя-обращение. Хвост в два слова — оговорка голосового ввода. */
export function addressDrop(text) {
  const line = String(text ?? "").trim().toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").replace(/[.!…)]+$/u, "");
  if (!line || line.length > 60) return false;
  return /^(?:(?:пожалуйста|ну|аи)[,\s]+)*(?:не\s+(?:надо\s+)?(?:называй(?:те)?|зови(?:те)?|обращай(?:ся|тесь)|называть|звать|обращаться)\s+(?:(?:меня|ко\s+мне)\s+)?(?:так|по\s+имени|этим\s+именем)(?:[,\s]+[а-я\s]{0,20})?|забудь\s+(?:мое\s+)?имя|забудь,?\s+как\s+меня\s+зовут)$/u.test(line);
}

const LENGTH_WORDS = Object.freeze([
  ["кратко", /(?:говори|пиши|отвечай)(?:те)?\s+(?:мне\s+)?(?:кратко|короче|покороче|без\s+воды)|(?:сделай|давай)(?:те)?\s+(?:ответы\s+)?короче/iu],
  ["подробно", /(?:говори|пиши|отвечай)(?:те)?\s+(?:мне\s+)?(?:подробно|подробнее|длиннее|развёрнуто)|(?:сделай|давай)(?:те)?\s+(?:ответы\s+)?(?:подробнее|длиннее)/iu],
  ["обычно", /(?:говори|пиши|отвечай)(?:те)?\s+(?:мне\s+)?(?:как\s+обычно|обычно|нормально)/iu],
]);

/** «говори короче», «пиши подробнее» — пожелание к длине ответа. */
export function lengthRequest(text) {
  const line = String(text ?? "").trim();
  if (!line) return null;
  for (const [length, pattern] of LENGTH_WORDS) if (pattern.test(line)) return length;
  return null;
}

/**
 * «Давай на ты» / «обращайтесь на вы» — просьба о форме обращения. «Ты» —
 * видимый знак близости: оно приходит само, когда отношения потеплели, или
 * по прямой просьбе. Обратно на «вы» можно попросить всегда.
 */
export function formRequest(text) {
  const line = String(text ?? "").trim().toLowerCase().replace(/ё/gu, "е").replace(/[\s.,!?…]+$/u, "");
  if (!line || line.length > 60) return null;
  const ask = "(?:давай(?:те)?|можно|можем|перейдем|перейдемте|говори(?:те)?|обращай(?:ся|тесь)|будем)";
  const match = line.match(new RegExp(`^(?:${ask}\\s+)?(?:(?:со\\s+мной|ко\\s+мне|мне|лучше|перейти|общаться)\\s+)*на\\s+(ты|вы)$`, "u"));
  if (match) return match[1];
  // То же, но по-человечески: «не выкай», «не будь такой вежливой», «говори проще». Хвост — оговорка голосового ввода.
  const lead = "(?:(?:пожалуйста|ну|да|аи)[,\\s]+)*";
  if (new RegExp(`^${lead}(?:не\\s+(?:надо\\s+)?(?:мне\\s+)?вык(?:ай|айте|ать)|хватит\\s+(?:мне\\s+)?выкать|перестань(?:те)?\\s+(?:мне\\s+)?выкать|(?:давай(?:те)?\\s+)?без\\s+(?:этого\\s+|этих\\s+)?(?:вы|выканья|официоза|церемоний)|не\\s+будь\\s+(?:(?:такой|слишком|столь|со\\s+мной)\\s+)*(?:вежлив|официальн|формальн)[а-я]*(?:[,\\s]+[а-я\\s]{0,30})?|не\\s+надо\\s+(?:так\\s+)?(?:вежливо|официально|формально)|(?:говори|общайся|разговаривай|пиши)\\s+(?:со\\s+мной\\s+|мне\\s+)?(?:проще|попроще|по-простому|по\\s+простому|неформально|без\\s+официоза)|(?:можно|давай(?:те)?)\\s+(?:проще|попроще|без\\s+церемоний))$`, "u").test(line)) return "ты";
  if (new RegExp(`^${lead}(?:не\\s+(?:надо\\s+)?(?:мне\\s+)?тык(?:ай|айте|ать)|хватит\\s+(?:мне\\s+)?тыкать|перестань(?:те)?\\s+(?:мне\\s+)?тыкать|без\\s+фамильярност(?:и|ей)|(?:будь|говори|общайся)\\s+(?:со\\s+мной\\s+)?(?:вежливее|повежливее|официальнее|уважительнее)|повежливее)$`, "u").test(line)) return "вы";
  return null;
}

const LAST_KEY = userId => `heart:last:${userId}`;
const DAY_MS = 86_400_000;

export function createPersonal({ store, now = () => Date.now(), dayOf = (at) => new Date(at).toISOString().slice(0, 10) } = {}) {
  async function settings(userId) {
    const value = await store.get(STYLE_KEY(userId));
    return value && typeof value === "object" ? value : {};
  }

  async function save(userId, patch) {
    const before = await settings(userId);
    const next = { ...before, ...patch };
    // Одновременная запись двух настроек не должна затирать одну из них.
    const saved = Object.keys(before).length
      ? await store.compareSet(STYLE_KEY(userId), before, next)
      : await store.setIfAbsent(STYLE_KEY(userId), next);
    if (saved) return { ok: true, settings: next };
    const after = await settings(userId);
    return { ok: Object.keys(after).length > 0, settings: Object.keys(after).length ? after : before };
  }

  async function setAddress(userId, name) {
    const clean = cleanAddress(name);
    if (!clean) return { ok: false, code: "invalid_name" };
    return save(userId, { address: clean });
  }

  /** «Не называй меня так»: имя-обращение убирается, остальные настройки остаются. */
  async function clearAddress(userId) { return save(userId, { address: "" }); }

  async function setLength(userId, length) {
    if (!LENGTHS.includes(length)) return { ok: false, code: "invalid_length" };
    return save(userId, { length });
  }

  async function setForm(userId, form) {
    if (!["ты", "вы"].includes(form)) return { ok: false, code: "invalid_form" };
    return save(userId, { form });
  }

  /**
   * Отметить, что человек пришёл. Возвращает, сколько дней его не было и
   * первый ли это разговор за календарный день: на этом держатся «давно не
   * виделись», шаг отношений и годовщины. Пишет не чаще раза в час.
   */
  async function seen(userId) {
    const at = now();
    const day = dayOf(at);
    const last = await store.get(LAST_KEY(userId));
    const known = Number.isFinite(last?.at);
    const gapDays = known ? Math.max(0, Math.floor((at - last.at) / DAY_MS)) : 0;
    const newDay = !known || last.day !== day;
    if (newDay || at - last.at > 3600_000) await store.set(LAST_KEY(userId), { at, day });
    return { known, gapDays, newDay, day };
  }

  /** Стереть всё личное: имя, длину, форму обращения, первый и последний день. */
  async function wipe(userId) {
    const done = await Promise.all([STYLE_KEY(userId), FIRST_KEY(userId), LAST_KEY(userId)].map(key => store.remove(key)));
    return { ok: done.every(Boolean) };
  }

  /** Сколько дней человек знаком с Аи. Первый день запоминается один раз. */
  async function daysWith(userId) {
    let first = await store.get(FIRST_KEY(userId));
    if (!Number.isFinite(first?.at)) {
      const started = { at: now() };
      await store.setIfAbsent(FIRST_KEY(userId), started);
      first = (await store.get(FIRST_KEY(userId))) ?? started;
    }
    const days = Math.floor((now() - first.at) / 86_400_000);
    return { days: Number.isFinite(days) && days > 0 ? days : 0, at: first.at };
  }

  /**
   * Карточка словами. `relationship` — уже готовая фраза от сердца, `facts` —
   * сколько он про себя рассказал. Никаких шкал и никаких чисел, кроме
   * «сколько дней знакомы»: это не оценка человека, а календарь.
   */
  function card({ address = "", days = 0, relationship = "", memories = 0, length = "обычно", formal = true } = {}) {
    const daysLine = days > 0 ? `Мы знакомы ${days} ${daysPhrase(days)}.` : "Мы только начали разговаривать.";
    const nameLine = address
      ? (formal ? `Для меня вы — ${address}.` : `Ты для меня — ${address}.`)
      : (formal ? "Как к вам обращаться, я пока не знаю." : "Как тебя звать, я пока не знаю.");
    const memoryLine = memories > 0
      ? `Я помню о ${formal ? "вас" : "тебе"} ${memories} ${memories === 1 ? "заметку" : memories < 5 ? "заметки" : "заметок"}.`
      : `О ${formal ? "вас" : "тебе"} у меня пока ничего не записано.`;
    return [
      "🤍 Вы и Аи",
      "",
      nameLine,
      daysLine,
      relationship,
      memoryLine,
      "",
      `Отвечаю ${({ кратко: "коротко", обычно: "обычно", подробно: "подробно" })[length] ?? "обычно"}.`,
      "",
      formal
        ? "Скажите словами: «зовите меня …» или «говорите короче» — я запомню. Отношения не настраиваются числами и не покупаются: они складываются из дней и поступков."
        : "Скажи словами: «зови меня …» или «говори короче» — я запомню. Отношения не настраиваются числами и не покупаются: они складываются из дней и поступков.",
    ].filter(line => line !== "").join("\n");
  }

  return Object.freeze({ settings, save, setAddress, clearAddress, setLength, setForm, seen, wipe, daysWith, card });
}

function daysPhrase(days) {
  const tail = days % 100;
  if (tail >= 11 && tail <= 14) return "дней";
  const last = days % 10;
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дня";
  return "дней";
}
