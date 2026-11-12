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
  return cleanAddress(match[1].replace(/^(?:просто|пожалуйста)\s+/iu, ""));
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
  return match ? match[1] : null;
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

  return Object.freeze({ settings, save, setAddress, setLength, setForm, seen, wipe, daysWith, card });
}

function daysPhrase(days) {
  const tail = days % 100;
  if (tail >= 11 && tail <= 14) return "дней";
  const last = days % 10;
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дня";
  return "дней";
}
