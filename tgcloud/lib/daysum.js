/**
 * Итоги дня в группе: сколько написали, кто был активнее, какой час самый
 * оживлённый. Считается по памяти чата (`chatlog.js`), без модели; по слову
 * админа приходит само, каждый вечер.
 *
 * Считаются сообщения с текстом от людей: стикеры, картинки без подписи,
 * голосовые и команды в память чата не попадают — и в итоги тоже.
 */

const fold = (text) => String(text ?? "").toLowerCase().replace(/ё/gu, "е").replace(/[«»"]/gu, "").replace(/\s+/gu, " ").trim().replace(/[.!?…]+$/u, "").trim();
const SUM = "(?:итог(?:и|ов)?|сводк[ауи]|статистик[ауи])";
const DAY = "(?:дня|за\\s+день|за\\s+сегодня|сегодня|по\\s+чату\\s+за\\s+день)";
const TIME = "(?:\\s+в\\s+(\\d{1,2})(?:[:.](\\d{2}))?(?:\\s*(?:час(?:а|ов)?|ч))?(?:\\s+(вечера|утра|дня|ночи))?)?";
const EVERY = "(?:\\s+(?:каждый\\s+(?:день|вечер)|по\\s+вечерам|ежедневно|вечером|всегда|сама))?";
const ON = [
  new RegExp(`^(?:подводи|присылай|публикуй|пиши|показывай|включи|шли|делай)\\s+(?:нам\\s+|сюда\\s+)?${SUM}\\s+${DAY}${EVERY}${TIME}${EVERY}$`, "u"),
  new RegExp(`^${SUM}\\s+${DAY}\\s+(?:каждый\\s+(?:день|вечер)|по\\s+вечерам|ежедневно)${TIME}$`, "u"),
];
const OFF = new RegExp(`^(?:(?:не\\s+(?:подводи|присылай|публикуй|пиши|показывай|надо|нужно)|выключи|отключи|убери|отмени|хватит)\\s+(?:больше\\s+)?(?:подводить\\s+|присылать\\s+)?${SUM}(?:\\s+${DAY})?)$`, "u");
const NOW = [
  new RegExp(`^(?:(?:подведи|покажи|дай|скажи|выведи)\\s+)?${SUM}\\s+${DAY}$`, "u"),
  /^(?:а\s+)?кто\s+(?:сегодня\s+)?(?:самый\s+активный|активнее\s+всех|больше\s+всех\s+(?:писал|написал|пишет|болтал|болтает))(?:\s+сегодня)?(?:\s+в\s+чате)?$/u,
  /^(?:а\s+)?сколько\s+(?:сегодня\s+)?(?:мы\s+)?(?:сообщений\s+)?(?:сегодня\s+)?(?:написали|написано|наболтали|наговорили)(?:\s+сообщений)?(?:\s+(?:сегодня|за\s+день|за\s+сегодня))?$/u,
  /^(?:статистика|активность)\s+чата(?:\s+(?:за\s+)?(?:сегодня|день))?$/u,
];
const YESTERDAY = [
  new RegExp(`^(?:(?:подведи|покажи|дай|скажи|выведи)\\s+)?${SUM}\\s+(?:вчерашнего\\s+дня|за\\s+вчера|вчера)$`, "u"),
  /^(?:а\s+)?кто\s+(?:вчера\s+)?(?:был\s+)?(?:самый\s+активный|самым\s+активным|активнее\s+всех|больше\s+всех\s+(?:писал|написал|болтал))(?:\s+вчера)?$/u,
  /^(?:статистика|активность)\s+чата\s+за\s+вчера$/u,
];

/** Час по умолчанию: итоги подводятся вечером. */
export const DAYSUM_HOUR = 22;
/** Больше стольких строк за раз из памяти чата не читается. */
export const DAYSUM_ROWS = 1000;

/**
 * Слова об итогах дня → просьба, иначе null:
 *   { on: true, hour, minute } — «подводи итоги дня», «итоги дня каждый вечер в 21:30»;
 *   { on: false }              — «не подводи итоги дня», «выключи итоги»;
 *   { show: true, yesterday }  — «итоги дня», «кто сегодня самый активный», «итоги за вчера».
 * «Подведи итоги» без «дня» — это про опрос (`polls.js`), не сюда.
 */
export function parseDaySum(text) {
  const value = fold(text);
  if (!value || value.length > 80) return null;
  if (OFF.test(value)) return { on: false };
  for (const pattern of ON) {
    const found = value.match(pattern);
    if (!found) continue;
    let hour = found[1] == null ? DAYSUM_HOUR : Number(found[1]);
    const minute = Number(found[2]) || 0;
    if ((found[3] === "вечера" || found[3] === "дня") && hour < 12) hour += 12;
    if (found[3] === "ночи" && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;
    return { on: true, hour, minute };
  }
  if (YESTERDAY.some(pattern => pattern.test(value))) return { show: true, yesterday: true };
  if (NOW.some(pattern => pattern.test(value))) return { show: true, yesterday: false };
  return null;
}

const two = (value) => String(value).padStart(2, "0");

/**
 * Итоги по строкам памяти чата.
 *   rows   — `[{ u, n, t, at }]`, по порядку;
 *   from, till — границы дня в миллисекундах;
 *   hourOf(at) — час на часах чата; clock(at) — «21:07»;
 *   before — сколько сообщений было за предыдущий день (null — неизвестно);
 *   capped — прочитан предел строк, и самая ранняя из них уже внутри дня.
 * Возвращает `{ count, people, text }`; `text` пуст, если писать не о чем.
 */
export function daySummary(rows, { from, till, hourOf, clock, label = "Итоги дня", before = null, capped = false, plural = (n, a, b, c) => (n === 1 ? a : n < 5 ? b : c) } = {}) {
  const day = (Array.isArray(rows) ? rows : []).filter(row => row && Number(row.at) >= from && Number(row.at) < till);
  if (!day.length) return { count: 0, people: 0, text: "" };
  const by = new Map();
  for (const row of day) {
    const id = row.u || row.n || "?";
    const entry = by.get(id) ?? { name: row.n || "кто-то", count: 0, letters: 0 };
    entry.count += 1;
    entry.letters += String(row.t ?? "").length;
    if (row.n) entry.name = row.n;
    by.set(id, entry);
  }
  const people = [...by.values()].sort((a, b) => b.count - a.count || b.letters - a.letters);
  const messages = (n) => `${n} ${plural(n, "сообщение", "сообщения", "сообщений")}`;
  const lines = [`📊 ${label}`];
  lines.push(`${capped ? "Больше тысячи сообщений — считаю по последней тысяче" : `Сообщений — ${day.length}`}; писали ${people.length} ${plural(people.length, "человек", "человека", "человек")}.`);
  if (people.length > 1) {
    const top = people.slice(0, 5).map((item, index) => `${["🥇", "🥈", "🥉"][index] ?? "•"} ${item.name} — ${item.count}`);
    lines.push("", "Самые активные:", ...top);
    if (people.length > 5) lines.push(`…и ещё ${people.length - 5}.`);
  } else lines.push(`Весь день здесь — ${people[0].name}.`);
  // Самый оживлённый час: только когда день был не из трёх реплик.
  if (day.length >= 10 && typeof hourOf === "function") {
    const hours = new Map();
    for (const row of day) { const hour = hourOf(Number(row.at)); hours.set(hour, (hours.get(hour) ?? 0) + 1); }
    const [peak, count] = [...hours.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    if (hours.size > 1) lines.push("", `Самый оживлённый час — с ${two(peak)}:00 до ${two((peak + 1) % 24)}:00: ${messages(count)}.`);
  }
  if (typeof clock === "function") lines.push(`${day.length >= 10 ? "" : "\n"}Первое сообщение — в ${clock(Number(day[0].at))} (${day[0].n || "кто-то"}), последнее — в ${clock(Number(day.at(-1).at))} (${day.at(-1).n || "кто-то"}).`);
  if (!capped && Number.isFinite(before) && before > 0) {
    const diff = day.length - before;
    lines.push(diff === 0 ? "Столько же, сколько днём раньше." : `Днём раньше было ${before}: ${diff > 0 ? `сегодня больше на ${diff}` : `сегодня меньше на ${-diff}`}.`);
  }
  return { count: day.length, people: people.length, text: lines.join("\n") };
}
