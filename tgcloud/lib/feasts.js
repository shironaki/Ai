/**
 * Праздники, которые Аи находит сама.
 *
 * Раньше список праздников был пуст, пока хозяин не назовёт каждый словами.
 * Теперь она знает их сама, из трёх мест:
 *   — исламские дни считаются по лунному календарю Умм аль-Кура: таблица
 *     первых чисел месяцев лежит рядом (`data/hijri.js`), сеть не нужна;
 *   — государственные праздники страны хозяина приходят из открытого
 *     справочника Nager.Date (`sources.publicHolidays`), раз в месяц;
 *   — свои праздники хозяин по-прежнему называет словами.
 *
 * Знать и поздравлять — разное. Знает она всё; открытку сама присылает только
 * к тому, что хозяину праздник: Ураза-байрам, Курбан-байрам, начало Рамадана,
 * светские праздники страны, его собственные. Праздник другой веры — в
 * списке: это выходной, о нём полезно знать, но поздравлять с ним она сама не
 * станет (захочет хозяин — добавит его своим). Исламские даты — расчётные:
 * точный день объявляют по луне, и он может сдвинуться на сутки. Хозяин
 * поправляет словом: его праздник с тем же названием заменяет найденный.
 *
 * Здесь только расчёт и разбор слов; сеть и память — в сердце.
 */
import { HIJRI_FIRST, HIJRI_STARTS } from "./data/hijri.js";

const DAY = 86_400_000;
const utc = (y, m, d) => Date.UTC(y, m - 1, d);
const ymd = (at) => { const date = new Date(at); return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() }; };
const fold = (text) => String(text ?? "").toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();

// ── лунный календарь ─────────────────────────────────────────────────────
const STARTS = HIJRI_STARTS.flatMap((row, index) => row.split(" ").map((iso, month) => ({ hy: HIJRI_FIRST + index, hm: month + 1, at: Date.parse(`${iso}T00:00:00Z`) })));
/** Месяцы хиджры в родительном падеже: «10 зуль-хиджа», «1 рамадана». */
export const HIJRI_MONTHS = Object.freeze(["мухаррама", "сафара", "раби аль-авваля", "раби ас-сани", "джумада аль-уля", "джумада ас-сани", "раджаба", "шаабана", "рамадана", "шавваля", "зуль-каада", "зуль-хиджа"]);

/** День по нашему календарю → день по хиджре: `{ hy, hm, hd }`; вне таблицы — null. */
export function hijriOf(y, m, d) {
  const at = utc(y, m, d);
  if (!Number.isFinite(at) || at < STARTS[0].at) return null;
  let low = 0, high = STARTS.length - 1;
  while (low < high) { const mid = (low + high + 1) >> 1; if (STARTS[mid].at <= at) low = mid; else high = mid - 1; }
  const start = STARTS[low];
  const hd = Math.round((at - start.at) / DAY) + 1;
  // Последний месяц таблицы: сколько в нём дней, она не знает — дальше тридцатого не считает.
  if (hd > 30 || (low === STARTS.length - 1 && hd > 29)) return null;
  return { hy: start.hy, hm: start.hm, hd };
}

/** День по хиджре → день по нашему календарю: `{ y, m, d }`; вне таблицы или такого дня нет — null. */
export function gregorianOf(hy, hm, hd) {
  const index = STARTS.findIndex(item => item.hy === hy && item.hm === hm);
  if (index < 0 || !(hd >= 1 && hd <= 30)) return null;
  const at = STARTS[index].at + (hd - 1) * DAY;
  const next = STARTS[index + 1];
  if (next ? at >= next.at : hd > 29) return null;
  return ymd(at);
}

/** «5 джумада ас-сани 1448 года по хиджре». */
export const hijriText = (date) => (date ? `${date.hd} ${HIJRI_MONTHS[date.hm - 1]} ${date.hy} года по хиджре` : "");

/**
 * Исламские дни. `card` — в этот день она сама поздравит открыткой; `night` —
 * это ночь: она начинается накануне вечером; `some` — отмечают не все общины.
 * `ask` — как о дне спрашивают («когда ураза-байрам»).
 */
export const ISLAMIC = Object.freeze([
  { id: "newyear", hm: 1, hd: 1, title: "Новый год по хиджре", ask: /нов\S+\s+год\s+по\s+хиджре|исламск\S+\s+нов\S+\s+год|мусульманск\S+\s+нов\S+\s+год|1\s+мухаррам\S*/u },
  { id: "ashura", hm: 1, hd: 10, title: "День Ашура", ask: /(?:день\s+)?ашур[аыу]/u },
  { id: "mawlid", hm: 3, hd: 12, title: "Мавлид ан-Наби", some: true, ask: /мавлид\S*(?:\s+ан[-\s]наби)?|мевлид\S*|день\s+рождения\s+пророка/u },
  { id: "miraj", hm: 7, hd: 27, title: "Ночь Исра и Мирадж", night: true, some: true, ask: /(?:ночь\s+)?(?:исра\s+и\s+)?ми['’]?радж\S*|раджаб[-\s]байрам\S*/u },
  { id: "baraat", hm: 8, hd: 15, title: "Ночь Бараат", night: true, some: true, ask: /(?:ночь\s+)?бараат\S*|(?:ночь\s+)?берат\S*/u },
  { id: "ramadan", hm: 9, hd: 1, title: "Начало Рамадана", card: true, ask: /(?:начало\s+|начн[её]тся\s+|начинается\s+|первый\s+день\s+)?(?:рамадан|рамазан)\S*|(?:начало\s+)?(?:поста|уразы)|ураза(?!-)/u },
  { id: "qadr", hm: 9, hd: 27, title: "Ляйлят аль-Кадр", night: true, ask: /ляйлят\S*\s+аль[-\s]кадр|лейлят\S*\s+аль[-\s]кадр|ночь\s+(?:предопределения|могущества|кадр\S*)/u },
  { id: "fitr", hm: 10, hd: 1, title: "Ураза-байрам", card: true, ask: /ураза[-\s]байрам\S*|ид\s+аль[-\s]фитр\S*|рамазан[-\s]байрам\S*|ораза[-\s]айт\S*|праздник\s+разговения/u },
  { id: "arafah", hm: 12, hd: 9, title: "День Арафа", ask: /(?:день\s+)?арафа\S*/u },
  { id: "adha", hm: 12, hd: 10, title: "Курбан-байрам", card: true, ask: /курбан(?:[-\s]байрам\S*|[-\s]айт\S*)?|ид\s+аль[-\s]адха\S*|праздник\s+жертвоприношения/u },
]);

/** Исламские дни в окне `[from, from + days)`: `{ key, y, m, d, title, card, night, some, kind: "islam", hijri }`. */
export function islamicDays(from, days = 366) {
  const start = utc(from.y, from.m, from.d), end = start + days * DAY;
  const first = hijriOf(from.y, from.m, from.d);
  if (!first) return [];
  const out = [];
  for (let hy = first.hy; hy <= first.hy + Math.ceil(days / 354) + 1; hy += 1) {
    for (const item of ISLAMIC) {
      const date = gregorianOf(hy, item.hm, item.hd);
      if (!date) continue;
      const at = utc(date.y, date.m, date.d);
      if (at < start || at >= end) continue;
      out.push({ key: `islam:${item.id}`, ...date, title: item.title, card: Boolean(item.card), night: Boolean(item.night), some: Boolean(item.some), kind: "islam", hijri: { hy, hm: item.hm, hd: item.hd } });
    }
  }
  return out.sort((a, b) => utc(a.y, a.m, a.d) - utc(b.y, b.m, b.d));
}

// ── государственные праздники ────────────────────────────────────────────
/** Названия из справочника (по-английски) → по-русски. Ключ — название строчными, без скобок. */
const NAMES = new Map(Object.entries({
  "new year's day": "Новый год", "new year": "Новый год", "new year holiday": "Новогодние каникулы", "new year's eve": "Канун Нового года",
  "christmas day": "Рождество", "christmas": "Рождество", "orthodox christmas day": "Рождество Христово", "orthodox christmas": "Рождество Христово",
  "christmas eve": "Сочельник", "st. stephen's day": "Второй день Рождества", "saint stephen's day": "Второй день Рождества", "boxing day": "Второй день Рождества",
  "second day of christmas": "Второй день Рождества", "good friday": "Страстная пятница", "easter sunday": "Пасха", "easter": "Пасха", "easter monday": "Пасхальный понедельник",
  "orthodox easter": "Пасха", "orthodox easter sunday": "Пасха", "orthodox easter monday": "Пасхальный понедельник", "orthodox good friday": "Страстная пятница",
  "maundy thursday": "Великий четверг", "holy saturday": "Великая суббота", "ascension day": "Вознесение", "pentecost": "Пятидесятница", "whit sunday": "Пятидесятница",
  "whit monday": "Духов день", "pentecost monday": "Духов день", "epiphany": "Богоявление", "assumption day": "Успение Богородицы", "assumption of mary": "Успение Богородицы",
  "all saints' day": "День всех святых", "all saints day": "День всех святых", "corpus christi": "Праздник Тела и Крови Христовых", "immaculate conception": "День Непорочного зачатия",
  "reformation day": "День Реформации", "radonitsa": "Радоница", "holy trinity": "Троица",
  "defender of the fatherland day": "День защитника Отечества", "international women's day": "Международный женский день", "women's day": "Международный женский день",
  "labour day": "День труда", "labor day": "День труда", "may day": "День труда", "international workers' day": "День труда", "workers' day": "День труда",
  "victory day": "День Победы", "great patriotic war against fascism victory day": "День Победы", "victory in europe day": "День Победы в Европе",
  "russia day": "День России", "unity day": "День народного единства", "king's day": "День короля", "liberation day": "День освобождения",
  "independence day": "День независимости", "constitution day": "День конституции", "republic day": "День республики", "national day": "Национальный день",
  "nauryz meyramy": "Наурыз", "nowruz": "Навруз", "kazakhstan people's unity day": "День единства народа Казахстана", "capital city day": "День столицы",
  "national independence & children's day": "День национального суверенитета и детей", "atatürk commemoration & youth day": "День памяти Ататюрка, молодёжи и спорта",
  "democracy and national unity day": "День демократии и национального единства", "german unity day": "День германского единства",
  "thanksgiving day": "День благодарения", "memorial day": "День памяти", "veterans day": "День ветеранов", "bastille day": "День взятия Бастилии", "armistice day": "День перемирия",
  "children's day": "День защиты детей", "flag day": "День флага", "statehood day": "День государственности", "october revolution day": "День Октябрьской революции",
  "remembrance day": "День памяти", "day of remembrance": "День памяти", "eid al-fitr": "Ураза-байрам", "eid al-adha": "Курбан-байрам", "ramadan feast": "Ураза-байрам", "sacrifice feast": "Курбан-байрам",
  "islamic new year": "Новый год по хиджре", "ashura": "День Ашура", "mawlid": "Мавлид ан-Наби", "prophet's birthday": "Мавлид ан-Наби",
}));
/** Праздник другой веры: выходной, о котором полезно знать, но не повод для открытки. */
const CHRISTIAN = /christmas|easter|good friday|ascension|pentecost|whit\s|epiphany|assumption|all saints|corpus christi|immaculate|st\.?\s|saint|boxing day|maundy|holy|trinity|radonitsa|reformation|palm sunday|orthodox|all souls/iu;
const ISLAMIC_PUBLIC = /\beid\b|ramadan|sacrifice feast|islamic new year|ashura|mawlid|prophet/iu;
/** День женщин: хозяину его не адресуют — но о нём стоит напомнить. */
const WOMEN = /women/iu;
/** Не праздник, а дни отдыха после него: «новогодние каникулы». */
const BREAK = /new year holiday|bridge day|day off|holiday \(|substitute/iu;

/** Название праздника из справочника → `{ title, known }`; незнакомое остаётся английским (`known: false`). */
export function publicTitle(name) {
  const raw = String(name ?? "").replace(/\s+/gu, " ").trim();
  const base = raw.replace(/\s*\((?:tentative date|estimated|observed|orthodox)\)\s*/giu, " ").replace(/\s+(?:first|second|third|fourth)\s+day\b/giu, "").replace(/\s+/gu, " ").trim().toLowerCase();
  const orthodox = /\(orthodox\)/iu.test(raw) ? NAMES.get(`orthodox ${base}`) : null;
  const hit = orthodox ?? NAMES.get(base) ?? NAMES.get(base.replace(/^the\s+/u, ""));
  return hit ? { title: hit, known: true } : { title: raw.slice(0, 60), known: false };
}

/**
 * Ответ справочника (массив Nager.Date) → дни: `{ key, y, m, d, title, name, kind, off, card, note }`.
 *   kind: «public» — светский праздник; «other» — праздник другой веры; «islam» — исламский
 *         (у стран, где он государственный); «women» — 8 Марта; «break» — дни отдыха.
 *   off — в стране выходной. Подряд идущие одноимённые дни сливаются в один (`till`).
 */
export function publicDays(rows, code = "") {
  const list = (Array.isArray(rows) ? rows : [])
    .filter(row => row && /^\d{4}-\d\d-\d\d$/u.test(String(row.date ?? "")) && row.name && row.nationalHoliday !== false)
    .map(row => {
      const [y, m, d] = String(row.date).split("-").map(Number);
      const name = String(row.name).replace(/\s+/gu, " ").trim();
      const types = Array.isArray(row.holidayTypes) ? row.holidayTypes.map(String) : [];
      const named = publicTitle(name);
      const kind = BREAK.test(name) ? "break" : ISLAMIC_PUBLIC.test(name) ? "islam" : CHRISTIAN.test(name) ? "other" : WOMEN.test(name) ? "women" : "public";
      return { y, m, d, name, title: named.title, known: named.known, kind, off: types.includes("Public") || types.includes("Bank"), types };
    })
    // Только то, что отмечает вся страна: выходные и дни, которые чтят власти и школы.
    .filter(item => item.off || item.types.includes("Authorities") || item.types.includes("School"))
    .sort((a, b) => utc(a.y, a.m, a.d) - utc(b.y, b.m, b.d));
  const out = [];
  for (const item of list) {
    const last = out.at(-1);
    // «Новогодние каникулы» со 2 по 6 января, «Ураза-байрам» три дня — одна строка.
    if (last && last.title === item.title && utc(item.y, item.m, item.d) - utc(last.till.y, last.till.m, last.till.d) <= DAY) { last.till = { y: item.y, m: item.m, d: item.d }; continue; }
    out.push({
      key: `pub:${String(code).toUpperCase()}:${item.title.toLowerCase()}`, y: item.y, m: item.m, d: item.d, till: { y: item.y, m: item.m, d: item.d },
      title: item.title, name: item.name, known: item.known, kind: item.kind, off: item.off, country: String(code).toUpperCase(),
    });
  }
  return out.map(item => ({ ...item, ...(utc(item.till.y, item.till.m, item.till.d) === utc(item.y, item.m, item.d) ? { till: null } : {}) }));
}

// ── страны ───────────────────────────────────────────────────────────────
/** Страны по-русски: код → [именительный, родительный, предложный («в …»)]. */
const COUNTRY_ROWS = `
RU Россия|России|России
NL Нидерланды|Нидерландов|Нидерландах|Голландия|Голландии
KZ Казахстан|Казахстана|Казахстане
BY Беларусь|Беларуси|Беларуси|Белоруссия|Белоруссии
UA Украина|Украины|Украине
TR Турция|Турции|Турции
DE Германия|Германии|Германии
FR Франция|Франции|Франции
GB Великобритания|Великобритании|Великобритании|Англия|Англии
US США|США|США|Америка|Америки
BE Бельгия|Бельгии|Бельгии
AT Австрия|Австрии|Австрии
CH Швейцария|Швейцарии|Швейцарии
IT Италия|Италии|Италии
ES Испания|Испании|Испании
PT Португалия|Португалии|Португалии
PL Польша|Польши|Польше
CZ Чехия|Чехии|Чехии
SE Швеция|Швеции|Швеции
NO Норвегия|Норвегии|Норвегии
FI Финляндия|Финляндии|Финляндии
DK Дания|Дании|Дании
EE Эстония|Эстонии|Эстонии
LV Латвия|Латвии|Латвии
LT Литва|Литвы|Литве
GE Грузия|Грузии|Грузии
AM Армения|Армении|Армении
AZ Азербайджан|Азербайджана|Азербайджане
MD Молдова|Молдовы|Молдове|Молдавия|Молдавии
UZ Узбекистан|Узбекистана|Узбекистане
KG Киргизия|Киргизии|Киргизии|Кыргызстан|Кыргызстана
TJ Таджикистан|Таджикистана|Таджикистане
TM Туркмения|Туркмении|Туркмении|Туркменистан|Туркменистана
AE ОАЭ|ОАЭ|ОАЭ|Эмираты|Эмиратов
SA Саудовская Аравия|Саудовской Аравии|Саудовской Аравии
EG Египет|Египта|Египте
MA Марокко|Марокко|Марокко
TN Тунис|Туниса|Тунисе
ID Индонезия|Индонезии|Индонезии
CA Канада|Канады|Канаде
AU Австралия|Австралии|Австралии
JP Япония|Японии|Японии
KR Южная Корея|Южной Кореи|Южной Корее|Корея|Кореи
CN Китай|Китая|Китае
GR Греция|Греции|Греции
BG Болгария|Болгарии|Болгарии
RS Сербия|Сербии|Сербии
HU Венгрия|Венгрии|Венгрии
RO Румыния|Румынии|Румынии
IE Ирландия|Ирландии|Ирландии
CY Кипр|Кипра|Кипре
ME Черногория|Черногории|Черногории
BA Босния и Герцеговина|Боснии и Герцеговины|Боснии и Герцеговине|Босния|Боснии
AL Албания|Албании|Албании
`;
export const COUNTRIES = Object.freeze(Object.fromEntries(COUNTRY_ROWS.trim().split("\n").map(line => {
  const [code, ...rest] = line.trim().split(" ");
  const forms = rest.join(" ").split("|");
  return [code, Object.freeze({ code, name: forms[0], of: forms[1] ?? forms[0], at: forms[2] ?? forms[0], forms: Object.freeze(forms.map(fold)) })];
})));
const COUNTRY_INDEX = new Map(Object.values(COUNTRIES).flatMap(item => item.forms.map(form => [form, item.code])));
/** «России», «Нидерланды», «NL» → код страны или пусто. */
export function countryCodeOf(text) {
  const value = fold(text).replace(/[.!?…]+$/u, "").trim();
  if (/^[a-z]{2}$/u.test(value) && COUNTRIES[value.toUpperCase()]) return value.toUpperCase();
  return COUNTRY_INDEX.get(value) ?? "";
}
/** Страна словами: `{ name, of, at }`; незнакомый код — он сам. */
export const countryWords = (code) => COUNTRIES[String(code).toUpperCase()] ?? { code: String(code).toUpperCase(), name: String(code).toUpperCase(), of: String(code).toUpperCase(), at: String(code).toUpperCase() };

// ── общий список ─────────────────────────────────────────────────────────
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
export const dayText = (item, withYear = false) => `${item.d} ${MONTHS[item.m - 1]}${withYear ? ` ${item.y}` : ""}`;

/**
 * Свои праздники хозяина + исламские + государственные → один список по дням.
 *   own      — `[{ d, m, y?, title }]`;
 *   islam    — считать ли исламские дни;
 *   publics  — дни из `publicDays` (уже за нужные годы);
 *   removed  — ключи, которые хозяин убрал («убери праздник 3»): не показываются и не поздравляются.
 * Что получает открытку: свои; исламские с `card`; светские выходные страны.
 * Одноимённый свой праздник заменяет найденный: так хозяин поправляет расчётный день.
 */
export function feastsFor({ own = [], islam = true, publics = [], removed = [], from, days = 366 } = {}) {
  const start = utc(from.y, from.m, from.d), end = start + days * DAY;
  const gone = new Set((Array.isArray(removed) ? removed : []).map(String));
  const out = [];
  const mine = [];
  for (const item of Array.isArray(own) ? own : []) {
    for (const year of item.y ? [item.y] : [from.y, from.y + 1]) {
      const at = utc(year, item.m, item.d);
      // 29 февраля в невисокосный год — такого дня нет.
      if (new Date(at).getUTCDate() !== item.d || at < start || at >= end) continue;
      mine.push({ key: `own:${fold(item.title)}`, y: year, m: item.m, d: item.d, title: item.title, kind: "own", card: true, once: Boolean(item.y) });
    }
  }
  // Своё название совпало с найденным — хозяин уточнил день: найденный в ближайшие два месяца от его дня не нужен.
  // «Ураза байрам» без дефиса, «Рамадан» вместо «Начало Рамадана» — тот же праздник.
  const corrected = (item) => mine.some(own => sameFeast(own.title, item) && Math.abs(utc(own.y, own.m, own.d) - utc(item.y, item.m, item.d)) < 60 * DAY);
  if (islam) for (const item of islamicDays(from, days)) if (!gone.has(item.key) && !corrected(item)) out.push(item);
  const islamTitles = new Set(out.map(item => fold(item.title)));
  for (const item of Array.isArray(publics) ? publics : []) {
    const at = utc(item.y, item.m, item.d);
    if (at < start || at >= end || gone.has(item.key) || corrected(item)) continue;
    // Ураза-байрам из справочника страны и расчётный — один праздник: остаётся расчётный, с пометкой о выходном.
    if (item.kind === "islam") {
      const twin = out.find(other => other.kind === "islam" && fold(other.title) === fold(item.title) && Math.abs(utc(other.y, other.m, other.d) - at) <= 3 * DAY);
      if (twin) { twin.off = item.off; twin.country = item.country; continue; }
      if (islam && islamTitles.has(fold(item.title))) continue;
    }
    out.push({ ...item, card: item.off && (item.kind === "public" || (item.kind === "islam" && islam)) });
  }
  return [...mine, ...out].sort((a, b) => utc(a.y, a.m, a.d) - utc(b.y, b.m, b.d) || (a.kind === "own" ? -1 : 1));
}

const plain = (text) => fold(text).replace(/[-–—\s]+/gu, " ").trim();
/** Название, которым хозяин назвал свой день, — тот же праздник, что найденный? */
export function sameFeast(title, item) {
  if (plain(title) === plain(item.title)) return true;
  const day = item.kind === "islam" && String(item.key ?? "").startsWith("islam:") ? ISLAMIC.find(entry => `islam:${entry.id}` === item.key) : null;
  return Boolean(day && new RegExp(`^(?:${day.ask.source})$`, "u").test(fold(title)));
}
/** Исламский день, которому соответствует название, — или null: «Ураза байрам» → Ураза-байрам. */
export const islamicByTitle = (title) => ISLAMIC.find(entry => plain(entry.title) === plain(title) || new RegExp(`^(?:${entry.ask.source})$`, "u").test(fold(title))) ?? null;

/** Строка списка: «Ураза-байрам — 9 марта · по расчёту · открытка». */
export function feastLine(item, { year = false } = {}) {
  // «2–6 января» — в одном месяце; «30 декабря — 2 января» — через границу.
  const range = (from, till) => (from.m === till.m && from.y === till.y ? `${from.d}–${dayText(till, year)}` : `${dayText(from, year && till.y !== from.y)} — ${dayText(till, year)}`);
  const date = item.night ? `в ночь на ${dayText(item, year)}` : item.till ? range(item, item.till) : dayText(item, year);
  const marks = [];
  if (item.kind === "own") marks.push(item.once ? "ваш, один раз" : "ваш, каждый год");
  if (item.kind === "islam" && item.hijri) marks.push("по расчёту");
  if (item.some) marks.push("отмечают не все");
  if (item.off && item.country) marks.push(`выходной в ${countryWords(item.country).at}`);
  else if (item.country && item.kind !== "islam") marks.push(`памятный день в ${countryWords(item.country).at}`);
  if (item.card) marks.push("открытка");
  return `${item.title} — ${date}${marks.length ? ` · ${marks.join(" · ")}` : ""}`;
}

// ── слова ────────────────────────────────────────────────────────────────
/**
 * Вопросы и просьбы о найденных праздниках → просьба, иначе null:
 *   { today: true }                 — «какой сегодня праздник», «что сегодня отмечают»;
 *   { tomorrow: true }              — «какой завтра праздник»;
 *   { when: "fitr" }                — «когда ураза-байрам», «сколько до рамадана»;
 *   { hijri: true }                 — «какое сегодня число по хиджре»;
 *   { country: "RU", mode }         — «праздники России» (mode: "set"), «добавь праздники России» ("add"),
 *                                     «убери праздники России» ("drop");
 *   { countries: true }             — «праздники какой страны», «чьи праздники ты знаешь»;
 *   { auto: false | true }          — «не ищи праздники сама» / «ищи праздники сама»;
 *   { islam: false | true }         — «не отмечай исламские праздники» / «отмечай исламские праздники»;
 *   { refresh: true }               — «обнови праздники».
 */
export function parseFeast(text) {
  const low = fold(text).replace(/[«»"]/gu, "").replace(/[.!?…]+$/u, "").replace(/^(?:а|и|ну|скажи|подскажи|напомни)[,\s]+/u, "").trim();
  if (!low || low.length > 90) return null;
  // «Какой сегодня день» — вопрос о числе и дне недели: он остаётся разговору.
  if (/^(?:какой|что\s+за)\s+(?:сегодня|сейчас)\s+праздник$|^какой\s+праздник\s+сегодня$|^сегодня\s+(?:какой[-\s]то\s+|какой[-\s]нибудь\s+)?праздник$|^(?:есть\s+)?сегодня\s+(?:есть\s+)?(?:какой[-\s]нибудь\s+)?праздник$|^что\s+сегодня\s+(?:за\s+праздник|празднуют|отмечают)$/u.test(low)) return { today: true };
  if (/^(?:какой|что\s+за)\s+завтра\s+праздник$|^какой\s+праздник\s+завтра$|^завтра\s+(?:какой[-\s]то\s+|какой[-\s]нибудь\s+)?праздник$|^что\s+завтра\s+(?:за\s+праздник|празднуют|отмечают)$/u.test(low)) return { tomorrow: true };
  if (/^(?:какое|какой)\s+(?:сегодня\s+|сейчас\s+)?(?:число|день|год|месяц)\s+по\s+(?:хиджре|исламскому\s+календарю|мусульманскому\s+календарю|лунному\s+календарю)$|^(?:какое|какой)\s+(?:число|день|год|месяц)\s+(?:сегодня\s+)?по\s+(?:хиджре|исламскому\s+календарю|мусульманскому\s+календарю)$|^(?:сегодня\s+)?(?:дата|число)\s+по\s+хиджре$|^какой\s+сейчас\s+(?:исламский|мусульманский)\s+(?:месяц|год)$/u.test(low)) return { hijri: true };
  let found = low.match(/^(?:когда|какого\s+числа|в\s+каком\s+месяце|сколько\s+(?:дней\s+)?(?:осталось\s+)?до|через\s+сколько(?:\s+дней)?)\s+(?:будет\s+|начн[её]тся\s+|начинается\s+|наступит\s+|в\s+этом\s+году\s+)?(.{3,50}?)(?:\s+(?:в\s+этом\s+году|в\s+следующем\s+году|будет|начн[её]тся|начинается|наступит))?$/u);
  if (found) {
    const what = found[1].trim();
    const hit = ISLAMIC.find(item => new RegExp(`^(?:${item.ask.source})$`, "u").test(what));
    if (hit) return { when: hit.id };
    return null;
  }
  if (/^(?:чьи\s+праздники\s+ты\s+(?:знаешь|отмечаешь|ищешь)|праздники\s+какой\s+страны(?:\s+ты\s+(?:знаешь|отмечаешь|ищешь))?|откуда\s+(?:ты\s+)?(?:знаешь|берешь)\s+праздники|откуда\s+(?:у\s+тебя\s+)?праздники)$/u.test(low)) return { countries: true };
  if (/^(?:обнови|перечитай|пересмотри|проверь)\s+праздники$|^найди\s+праздники(?:\s+заново|\s+еще\s+раз)?$/u.test(low)) return { refresh: true };
  if (/^(?:не\s+(?:ищи|находи|добавляй|пополняй)\s+праздники(?:\s+сама)?|праздники\s+не\s+(?:ищи|добавляй)(?:\s+сама)?|сама\s+праздники\s+не\s+(?:ищи|добавляй)|только\s+мои\s+праздники)$/u.test(low)) return { auto: false };
  if (/^(?:ищи|находи|добавляй|пополняй)\s+праздники(?:\s+сама)?$|^праздники\s+(?:ищи|находи|добавляй)\s+сама$|^сама\s+(?:ищи|находи)\s+праздники$/u.test(low)) return { auto: true };
  if (/^не\s+(?:отмечай|считай|показывай|ищи)\s+(?:исламские|мусульманские)\s+праздники$|^(?:исламские|мусульманские)\s+праздники\s+не\s+(?:отмечай|нужны|надо|показывай)$|^(?:убери|выключи)\s+(?:исламские|мусульманские)\s+праздники$/u.test(low)) return { islam: false };
  if (/^(?:отмечай|считай|показывай|включи|верни|добавь)\s+(?:исламские|мусульманские)\s+праздники$/u.test(low)) return { islam: true };
  found = low.match(/^(добавь|убери|удали|выключи|включи|отмечай|не\s+отмечай|покажи|ищи)?\s*праздники\s+(?:страны\s+|страны:\s*|в\s+)?(.{2,40})$/u);
  if (found) {
    const code = countryCodeOf(found[2].replace(/^(?:страны|республики)\s+/u, ""));
    if (!code) return null;
    const verb = found[1] ?? "";
    return { country: code, mode: /^(?:убери|удали|выключи|не\s+отмечай)$/u.test(verb) ? "drop" : /^(?:добавь|включи|отмечай)$/u.test(verb) ? "add" : "set" };
  }
  // «Я из России» — разговор, а не настройка: страну праздников меняют словом «праздники России».
  return null;
}
