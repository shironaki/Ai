/**
 * Настроение с причиной.
 *
 * Раньше настроение было случайным словом на шесть часов. Теперь у него есть
 * причина, и причина настоящая: час и день недели у человека, праздник, давно
 * ли он писал, много ли с ней сегодня говорили, не кончились ли мысли. Слова
 * причины — в словаре (запасы «+причина:…»); здесь только выбор.
 *
 * В пределах трёх часов настроение одно и то же: спросить дважды — услышать
 * одно. Модели называется то же настроение, что и человеку.
 */

/** Праздники и особые дни: [месяц, день, причина, настроение]. */
const DATES = [
  [12, 31, "новый год", "праздничное"], [1, 1, "новый год", "праздничное"],
  [2, 14, "день валентина", "романтичное"], [3, 8, "восьмое марта", "весеннее"],
  [4, 1, "первое апреля", "хулиганское"], [10, 31, "хэллоуин", "таинственное"],
];
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Час, день недели, месяц и число в поясе человека. */
export function localParts(at, timeZone = "UTC") {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, hour: "2-digit", minute: "2-digit", weekday: "short", month: "numeric", day: "numeric" }).formatToParts(new Date(at));
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour12: false, hour: "2-digit", minute: "2-digit", weekday: "short", month: "numeric", day: "numeric" }).formatToParts(new Date(at));
  }
  const get = (type) => parts.find(item => item.type === type)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  return { hour, minute: Number(get("minute")), weekday: WEEKDAYS[get("weekday")] ?? 0, month: Number(get("month")), day: Number(get("day")), clock: `${String(hour).padStart(2, "0")}:${get("minute")}` };
}

const hashOf = (text) => { let hash = 2166136261; for (const char of String(text)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0; return hash; };

/**
 * Настроение сейчас: `{ mood, reason, clock }`.
 *   mood   — «сонное», «игривое»: прилагательное к слову «настроение»;
 *   reason — ключ причины для словаря: «ночь», «пятница», «давно не виделись».
 */
export function moodOf({ now = Date.now(), timeZone = "UTC", userId = "", gapDays = 0, talks = 0, limited = false } = {}) {
  const local = localParts(now, timeZone);
  const { hour, weekday, month, day, clock } = local;
  const seed = hashOf(`${userId}:${month}.${day}:${Math.floor(hour / 3)}`);
  const out = (mood, reason) => ({ mood, reason, clock, hour });

  if (limited) return out("уставшее", "лимит");
  const special = DATES.find(([m, d]) => m === month && d === day);
  if (special) return out(special[3], special[2]);
  if (weekday === 5 && day === 13) return out("суеверное", "пятница 13");
  if (gapDays >= 3) return out("радостное", "давно не виделись");
  if (hour < 5 || hour >= 23) return out(seed % 2 ? "сонное" : "мечтательное", "ночь");

  // Остальное — из того, что сейчас правда; выбор между правдами — по зерну.
  const options = [];
  if (weekday === 1 && hour < 14) options.push(["ворчливое", "понедельник"]);
  if (weekday === 5 && hour >= 15) options.push(["игривое", "пятница"]);
  if ((weekday === 6 || weekday === 0) && hour >= 9 && hour < 21) options.push(["ленивое", "выходной"]);
  if (talks >= 30) options.push(["бодрое", "много разговоров"]);
  if (talks <= 1 && hour >= 12) options.push(["задумчивое", "тихо"]);
  if (hour < 12) options.push([seed % 2 ? "бодрое" : "собранное", "утро"]);
  else if (hour < 18) options.push([seed % 2 ? "деловое" : "хорошее", "день"]);
  else options.push([seed % 2 ? "уютное" : "разговорчивое", "вечер"]);
  const [mood, reason] = options[seed % options.length];
  return out(mood, reason);
}

/**
 * Настроение меняет поведение, а не только слово о нём:
 *   short   — отвечает короче (ворчливое, уставшее, сонное, ленивое);
 *   playful — чаще шутит и поддразнивает (игривое, хулиганское, праздничное, радостное);
 *   soft    — мягче и неторопливее (мечтательное, задумчивое, уютное…);
 *   chatty  — говорит чуть больше и спрашивает в ответ (разговорчивое, бодрое);
 *   plain   — как обычно.
 * `hint` — та же мысль для модели, чтобы слова из словаря и её ответы совпадали.
 */
const WAYS = Object.freeze({
  short: [["ворчливое", "уставшее", "сонное", "ленивое"], "Сейчас отвечай короче обычного и чуть суше; можно слегка поворчать, без грубости."],
  playful: [["игривое", "хулиганское", "праздничное", "радостное"], "Сейчас можно шутить и поддразнивать чаще обычного."],
  soft: [["мечтательное", "задумчивое", "уютное", "романтичное", "таинственное", "весеннее", "суеверное"], "Сейчас говори мягче и неторопливо; уместна одна образная деталь."],
  chatty: [["разговорчивое", "бодрое"], "Сейчас можно сказать чуть больше обычного и задать встречный вопрос."],
});
export function behaviourOf(mood) {
  for (const [kind, [moods, hint]] of Object.entries(WAYS)) if (moods.includes(String(mood))) return { kind, hint };
  return { kind: "plain", hint: "" };
}
