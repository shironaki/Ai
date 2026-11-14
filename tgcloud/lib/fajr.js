/**
 * Фаджр — начало рассвета: солнце утром на заданный угол ниже горизонта.
 *
 * Считается здесь же, без сети: широта, долгота и дата. Положение солнца — по
 * общеизвестным формулам невысокой точности (ошибка — около минуты), их же
 * используют открытые расчёты времени намаза. Это не расписание мечети: у
 * каждой общины свой угол и свои поправки, и в сомнении верить надо ей.
 *
 * В высоких широтах летом солнце не опускается на нужный угол вовсе. Тогда
 * фаджр берётся долей ночи перед восходом — «угол / 60» от ночи, одно из
 * принятых правил; результат помечается `adjusted`.
 */
const RAD = Math.PI / 180;
const sin = (deg) => Math.sin(deg * RAD);
const cos = (deg) => Math.cos(deg * RAD);
const asin = (value) => Math.asin(value) / RAD;
const acos = (value) => Math.acos(value) / RAD;
const atan2 = (y, x) => Math.atan2(y, x) / RAD;
const fix = (value, mod) => { const out = value - mod * Math.floor(value / mod); return out < 0 ? out + mod : out; };

/** Углы, которыми считают фаджр разные общины. Ключ — как его называют словами. */
export const FAJR_METHODS = Object.freeze([
  { key: "mwl", angle: 18, title: "Всемирная исламская лига" },
  { key: "russia", angle: 16, title: "ДУМ России" },
  { key: "turkey", angle: 18, title: "Диянет, Турция" },
  { key: "makkah", angle: 18.5, title: "Умм аль-Кура, Мекка" },
  { key: "egypt", angle: 19.5, title: "Египет" },
  { key: "karachi", angle: 18, title: "Карачи" },
  { key: "isna", angle: 15, title: "ИСНА, Северная Америка" },
  { key: "tehran", angle: 17.7, title: "Тегеран" },
]);
export const FAJR_ANGLE = 18;
/** Восход: центр солнца на 0,833° ниже горизонта — рефракция и радиус диска. */
const RISE = 0.833;

function julian(y, m, d) {
  let year = y, month = m;
  if (month <= 2) { year -= 1; month += 12; }
  const a = Math.floor(year / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + d + b - 1524.5;
}

/** Склонение солнца и уравнение времени (в часах) на юлианскую дату. */
function sun(jd) {
  const days = jd - 2451545.0;
  const g = fix(357.529 + 0.98560028 * days, 360);
  const q = fix(280.459 + 0.98564736 * days, 360);
  const l = fix(q + 1.915 * sin(g) + 0.020 * sin(2 * g), 360);
  const e = 23.439 - 0.00000036 * days;
  const ra = atan2(cos(e) * sin(l), cos(l)) / 15;
  return { declination: asin(sin(e) * sin(l)), equation: q / 15 - fix(ra, 24) };
}

/**
 * Час местного солнечного времени, когда солнце на `angle` градусов ниже
 * горизонта: до полудня (`before`) или после. NaN — такого часа в этот день нет.
 */
function hourAt(jd, latitude, angle, before) {
  let hour = before ? 5 : 19;
  // Положение солнца берётся на сам искомый час: два прохода дают точность до секунд.
  for (let pass = 0; pass < 3; pass += 1) {
    const at = sun(jd + hour / 24);
    const noon = fix(12 - at.equation, 24);
    const ratio = (-sin(angle) - sin(at.declination) * sin(latitude)) / (cos(at.declination) * cos(latitude));
    if (!(ratio >= -1 && ratio <= 1)) return Number.NaN;
    const span = acos(ratio) / 15;
    hour = noon + (before ? -span : span);
  }
  return hour;
}

/**
 * Фаджр и восход на календарный день `y-m-d` в точке с данными координатами.
 * Возвращает моменты в миллисекундах эпохи — их остаётся показать в часовом
 * поясе человека. `null` — посчитать нельзя: за полярным кругом в этот день
 * нет восхода, или координаты не годятся.
 *   { fajr, sunrise, adjusted } — `adjusted`: взято долей ночи, а не по углу.
 */
export function fajrOn({ y, m, d, latitude, longitude, angle = FAJR_ANGLE } = {}) {
  const lat = Number(latitude), lon = Number(longitude), deg = Number(angle);
  if (![y, m, d].every(Number.isInteger) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 89 || Math.abs(lon) > 180) return null;
  if (!(deg >= 9 && deg <= 24)) return null;
  const jd = julian(y, m, d) - lon / (15 * 24);
  const sunrise = hourAt(jd, lat, RISE, true);
  const sunset = hourAt(jd, lat, RISE, false);
  if (Number.isNaN(sunrise) || Number.isNaN(sunset)) return null;
  const night = fix(sunrise - sunset, 24);
  const portion = (deg / 60) * night;
  let fajr = hourAt(jd, lat, deg, true);
  let adjusted = false;
  if (Number.isNaN(fajr) || sunrise - fajr > portion) { fajr = sunrise - portion; adjusted = true; }
  const midnight = Date.UTC(y, m - 1, d);
  const epoch = (hour) => Math.round(midnight + (hour - lon / 15) * 3_600_000);
  return { fajr: epoch(fajr), sunrise: epoch(sunrise), adjusted };
}

const squash = (text) => String(text ?? "").toLowerCase().replace(/ё/gu, "е").replace(/[«»"]/gu, "").replace(/\s+/gu, " ").trim().replace(/[.!?…]+$/u, "").trim();
const NAMES = [
  ["russia", /^(?:дум|дум\s+рф|дум\s+россии|росси[ия]|российск\S*|муфтият\S*)$/u],
  ["mwl", /^(?:лиг[аеиу]|всемирн\S+\s+исламск\S+\s+лиг\S+|мировой\s+лиге|mwl|вил)$/u],
  ["turkey", /^(?:турци\S*|турецк\S*|диянет\S*)$/u],
  ["makkah", /^(?:мекк[аеиу]|умм\s+аль-?\s?кура|саудовск\S*|саудовская\s+аравия)$/u],
  ["egypt", /^(?:егип\S*)$/u],
  ["karachi", /^(?:карачи|пакистан\S*)$/u],
  ["isna", /^(?:исна|isna|америк\S*|северн\S+\s+америк\S+)$/u],
  ["tehran", /^(?:тегеран\S*|иран\S*)$/u],
];

/**
 * Слова о фаджре → просьба, иначе null:
 *   { show: true, tomorrow }      — «когда фаджр», «во сколько завтра фаджр»;
 *   { angle: 16 }                 — «угол фаджра 16», «фаджр по 16 градусам»;
 *   { method: "russia", angle }   — «считай фаджр по ДУМ», «фаджр по Турции»;
 *   { methods: true }             — «как ты считаешь фаджр».
 */
export function parseFajr(text) {
  const value = squash(text);
  if (!value || value.length > 80 || !/фадж?р|рассветн\S+\s+(?:намаз|молитв)|утренн\S+\s+(?:намаз|молитв)/u.test(value)) return null;
  const word = "(?:фаджр\\S*|фаджр-намаз\\S*|рассветн\\S+\\s+(?:намаз\\S*|молитв\\S*)|утренн\\S+\\s+(?:намаз\\S*|молитв\\S*))";
  if (new RegExp(`^(?:а\\s+)?(?:как|по\\s+како(?:му|й)\\s+(?:углу|методу|правилу|расч[её]ту)|каким\\s+(?:углом|методом))\\s+ты\\s+считаешь\\s+${word}$`, "u").test(value)) return { methods: true };
  let found = value.match(new RegExp(`^(?:а\\s+)?(?:когда|во\\s+сколько|в\\s+котором\\s+часу|время|скажи\\s+время)\\s+(?:у\\s+(?:меня|нас)\\s+)?(?:(сегодня|завтра)\\s+)?(?:будет\\s+|начинается\\s+|наступает\\s+|начало\\s+)?${word}(?:\\s+(сегодня|завтра))?(?:\\s+(?:будет|начинается|наступает))?$`, "u"));
  if (found) return { show: true, tomorrow: found[1] === "завтра" || found[2] === "завтра" };
  if (new RegExp(`^${word}(?:\\s+(?:сегодня|завтра))?(?:\\s+(?:когда|во\\s+сколько))?$`, "u").test(value)) return { show: true, tomorrow: /завтра/u.test(value) };
  found = value.match(new RegExp(`^(?:считай\\s+|ставь\\s+|поставь\\s+)?(?:угол\\s+${word}|${word}\\s+(?:по\\s+углу|угол|по|на))\\s+(?:в\\s+)?(\\d{1,2}(?:[.,]\\d)?)(?:\\s*(?:°|градус\\S*))?$`, "u"));
  if (found) {
    const angle = Number(found[1].replace(",", "."));
    return angle >= 9 && angle <= 24 ? { angle } : null;
  }
  found = value.match(new RegExp(`^(?:считай\\s+|ставь\\s+|поставь\\s+)?${word}\\s+(?:по|как\\s+(?:в|у))\\s+(?:методу\\s+|расч[её]ту\\s+|правилу\\s+)?(.{2,40})$`, "u"));
  if (found) {
    const name = found[1].trim();
    for (const [key, pattern] of NAMES) if (pattern.test(name)) return { method: key, angle: FAJR_METHODS.find(item => item.key === key).angle };
  }
  return null;
}
