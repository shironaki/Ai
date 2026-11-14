/**
 * Она пишет хозяину первой: «доброе утро» и «спокойной ночи» в его время.
 *
 * Слова — из словаря (запасы «+утро хозяину», «+ночь хозяину»), модель не
 * тратится. Время хозяин называет словами; по умолчанию — восемь утра и
 * одиннадцать вечера по его часам. Опоздать больше чем на два часа она не
 * станет: будильник молчал — значит, сегодня без этого.
 */
export const GREET_KEY = "heart:greet:v1";
export const GREET_DEFAULTS = Object.freeze({ morning: "08:00", night: "23:00" });
/** Сколько после назначенного часа слова ещё уместны. */
export const GREET_WINDOW_MS = 2 * 3_600_000;

const squash = (text) => String(text ?? "").toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim().replace(/[.!?…]+$/u, "").trim();
const MORNING = "(?:доброе\\s+утро|доброго\\s+утра|с\\s+добрым\\s+утром|утром|по\\s+утрам)";
const NIGHT = "(?:спокойной\\s+ночи|доброй\\s+ночи|сладких\\s+снов|перед\\s+сном|на\\s+ночь|по\\s+вечерам)";
const VERB = "(?:пиши|желай|говори|присылай|шли)(?:те)?";
const TIME = "(?:в\\s+)?(\\d{1,2})(?:[:.\\s](\\d{2}))?(?:\\s*(?:час(?:а|ов)?|утра|вечера|ночи))?";

const clockOf = (hour, minute, part = "") => {
  let h = Number(hour);
  const m = Number(minute ?? 0);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) return "";
  if (/вечера/u.test(part) && h < 12) h += 12;
  if (/ночи/u.test(part) && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/**
 * Слова хозяина → просьба, иначе null:
 *   { set: "morning" | "night", time: "07:30" } · { off: "morning" | "night" | "all" }
 *   { on: "morning" | "night" | "all" } · { show: true }
 */
export function parseGreet(text) {
  const value = squash(text);
  if (!value || value.length > 90) return null;
  if (/^(?:когда|во\s+сколько)\s+ты\s+(?:мне\s+)?пишешь\s+(?:мне\s+)?(?:первой|сама)$/u.test(value) || /^(?:когда|во\s+сколько)\s+ты\s+(?:мне\s+)?желаешь\s+(?:мне\s+)?(?:доброго\s+утра|спокойной\s+ночи)$/u.test(value)) return { show: true };
  let found = value.match(new RegExp(`^${VERB}\\s+(?:мне\\s+)?${MORNING}\\s+${TIME}$`, "u"));
  if (found) { const time = clockOf(found[1], found[2], value); return time ? { set: "morning", time } : null; }
  found = value.match(new RegExp(`^${VERB}\\s+(?:мне\\s+)?${NIGHT}\\s+${TIME}$`, "u"));
  if (found) { const time = clockOf(found[1], found[2], value); return time ? { set: "night", time } : null; }
  if (new RegExp(`^не\\s+${VERB}\\s+(?:мне\\s+)?(?:первой|сама)$`, "u").test(value) || /^не\s+надо\s+(?:мне\s+)?писать\s+первой$/u.test(value)) return { off: "all" };
  if (new RegExp(`^не\\s+${VERB}\\s+(?:мне\\s+)?${MORNING}$`, "u").test(value)) return { off: "morning" };
  if (new RegExp(`^не\\s+${VERB}\\s+(?:мне\\s+)?${NIGHT}$`, "u").test(value)) return { off: "night" };
  if (new RegExp(`^${VERB}\\s+(?:мне\\s+)?(?:первой|сама)$`, "u").test(value)) return { on: "all" };
  if (new RegExp(`^${VERB}\\s+(?:мне\\s+)?(?:доброе\\s+утро|доброго\\s+утра|по\\s+утрам)$`, "u").test(value)) return { on: "morning" };
  if (new RegExp(`^${VERB}\\s+(?:мне\\s+)?(?:спокойной\\s+ночи|доброй\\s+ночи|перед\\s+сном|на\\s+ночь)$`, "u").test(value)) return { on: "night" };
  return null;
}

/** Настройка из базы → полная: времена и выключатели. */
export function greetSettings(saved = null) {
  const time = (value, fallback) => (/^\d{2}:\d{2}$/u.test(String(value ?? "")) ? String(value) : fallback);
  return {
    morning: time(saved?.morning, GREET_DEFAULTS.morning), night: time(saved?.night, GREET_DEFAULTS.night),
    morningOff: saved?.morningOff === true, nightOff: saved?.nightOff === true,
    m: String(saved?.m ?? ""), n: String(saved?.n ?? ""),
  };
}
