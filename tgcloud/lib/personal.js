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

const ADDRESS = /(?:^|[\s,.])(?:зови|называй|обращайся(?:\s+ко\s+мне)?)\s+(?:меня\s+)?(?:как\s+)?([^\n]{1,40})$/iu;

/** «зови меня Алекс», «называй меня просто Лёша» — просьба, а не команда. */
export function addressRequest(text) {
  const match = String(text ?? "").trim().match(ADDRESS);
  if (!match) return null;
  // «зови меня когда хочешь» — это не имя.
  if (/\b(?:когда|если|потом|завтра|сюда|туда|так|всегда|никогда|никак)\b/iu.test(match[1])) return null;
  return cleanAddress(match[1].replace(/^(?:просто|пожалуйста)\s+/iu, ""));
}

const LENGTH_WORDS = Object.freeze([
  ["кратко", /(?:говори|пиши|отвечай)\s+(?:мне\s+)?(?:кратко|короче|покороче|без\s+воды)|(?:сделай|давай)\s+(?:ответы\s+)?короче/iu],
  ["подробно", /(?:говори|пиши|отвечай)\s+(?:мне\s+)?(?:подробно|подробнее|длиннее|развёрнуто)|(?:сделай|давай)\s+(?:ответы\s+)?(?:подробнее|длиннее)/iu],
  ["обычно", /(?:говори|пиши|отвечай)\s+(?:мне\s+)?(?:как\s+обычно|обычно|нормально)/iu],
]);

/** «говори короче», «пиши подробнее» — пожелание к длине ответа. */
export function lengthRequest(text) {
  const line = String(text ?? "").trim();
  if (!line) return null;
  for (const [length, pattern] of LENGTH_WORDS) if (pattern.test(line)) return length;
  return null;
}

export function createPersonal({ store, now = () => Date.now() } = {}) {
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
  function card({ address = "", days = 0, relationship = "", memories = 0, length = "обычно" } = {}) {
    const daysLine = days > 0 ? `Мы знакомы ${days} ${daysPhrase(days)}.` : "Мы только начали разговаривать.";
    const nameLine = address ? `Ты для меня — ${address}.` : "Как тебя звать, я пока не знаю.";
    const memoryLine = memories > 0
      ? `Я помню о тебе ${memories} ${memories === 1 ? "заметку" : memories < 5 ? "заметки" : "заметок"}.`
      : "Ты пока ничего о себе не рассказывал.";
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
      "Скажи словами: «зови меня …» или «говори короче» — я запомню. Отношения не настраиваются числами и не покупаются: они складываются из разговоров.",
    ].filter(line => line !== "").join("\n");
  }

  return Object.freeze({ settings, save, setAddress, setLength, daysWith, card });
}

function daysPhrase(days) {
  const tail = days % 100;
  if (tail >= 11 && tail <= 14) return "дней";
  const last = days % 10;
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дня";
  return "дней";
}
