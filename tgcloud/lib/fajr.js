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
  // `shift` — минуты «на осторожность», которые метод сам прибавляет к расчёту
  // (как в открытой библиотеке adhan): зухр — минутой позже зенита и так далее.
  { key: "mwl", angle: 18, isha: 17, shift: { dhuhr: 1 }, title: "Всемирная исламская лига" },
  // ДУМ России: углы — по памяти, сверить было не с чем; поправок метода не знаю.
  { key: "russia", angle: 16, isha: 15, title: "ДУМ России" },
  // Диянет прибавляет «темкин»: восход раньше, зухр, аср и магриб — позже.
  { key: "turkey", angle: 18, isha: 17, shift: { sunrise: -7, dhuhr: 5, asr: 4, maghrib: 7 }, title: "Диянет, Турция" },
  // Умм аль-Кура: иша — через полтора часа после магриба, а не по углу.
  { key: "makkah", angle: 18.5, ishaMinutes: 90, title: "Умм аль-Кура, Мекка" },
  { key: "egypt", angle: 19.5, isha: 17.5, shift: { dhuhr: 1 }, title: "Египет" },
  { key: "karachi", angle: 18, isha: 18, shift: { dhuhr: 1 }, title: "Карачи" },
  { key: "isna", angle: 15, isha: 15, shift: { dhuhr: 1 }, title: "ИСНА, Северная Америка" },
  // Тегеран: магриб — не закат, а солнце на 4,5° ниже горизонта.
  { key: "tehran", angle: 17.7, isha: 14, maghribAngle: 4.5, title: "Тегеран" },
]);
/**
 * Правило для иша: по названному методу, а если хозяин задал только угол
 * фаджра — по первому методу с таким углом; иначе — на градус меньше фаджра.
 *   { isha: 17 } или { ishaMinutes: 90 }
 */
export function ishaRule({ method = "", angle = 18 } = {}) {
  const hit = FAJR_METHODS.find(item => item.key === method) ?? FAJR_METHODS.find(item => item.angle === Number(angle));
  if (hit?.ishaMinutes) return { ishaMinutes: hit.ishaMinutes };
  return { isha: hit?.isha ?? Math.max(9, Math.min(24, Number(angle) - 1)) };
}
/**
 * Что ещё входит в названный метод, кроме углов: минуты «на осторожность» и
 * свой угол магриба. Метод не назван (задан только угол или ничего) — пусто:
 * тогда это чистый расчёт по солнцу.
 */
export function methodExtras(method = "") {
  const hit = FAJR_METHODS.find(item => item.key === method);
  return { shift: hit?.shift ? { ...hit.shift } : {}, ...(hit?.maghribAngle ? { maghribAngle: hit.maghribAngle } : {}) };
}
/** Имена времён дня — в порядке суток. */
export const DAY_TIMES = Object.freeze(["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"]);
/** Предел поправки в минутах: больше — это уже не поправка, а другой метод. */
export const SHIFT_MAX = 30;
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

/**
 * Все времена намаза на календарный день `y-m-d`: моменты в миллисекундах эпохи.
 *   fajr, sunrise — как в `fajrOn`; dhuhr — истинный полдень; asr — тень предмета
 *   длиннее полуденной на одну его высоту (`asr: 1`, большинство школ) или на две
 *   (`asr: 2`, ханафитская); maghrib — закат; isha — солнце на `isha` градусов
 *   ниже горизонта или через `ishaMinutes` после заката.
 * `adjusted` — что взято долей ночи: в высоких широтах летом солнце не
 * опускается на нужный угол. `null` — посчитать нельзя (нет восхода или заката).
 * `maghribAngle` — магриб не на закате, а когда солнце на столько градусов
 * ниже горизонта (метод Тегерана). `shift` — поправки в минутах по именам
 * времён (`{ maghrib: 3 }`): минуты метода и минуты хозяина, уже сложенные.
 * Без них это чистый расчёт по солнцу.
 */
export function prayersOn({ y, m, d, latitude, longitude, angle = FAJR_ANGLE, isha = 17, ishaMinutes = 0, asr = 1, maghribAngle = 0, shift = null } = {}) {
  const dawn = fajrOn({ y, m, d, latitude, longitude, angle });
  if (!dawn) return null;
  const lat = Number(latitude), lon = Number(longitude);
  const jd = julian(y, m, d) - lon / (15 * 24);
  const sunrise = hourAt(jd, lat, RISE, true);
  const sunset = hourAt(jd, lat, RISE, false);
  let noon = 12;
  for (let pass = 0; pass < 3; pass += 1) noon = fix(12 - sun(jd + noon / 24).equation, 24);
  // Аср: высота солнца, при которой тень длиннее полуденной на `factor` высот предмета.
  // Полуденная тень — по склонению солнца в самый полдень, а не в час асра.
  const factor = Number(asr) === 2 ? 2 : 1;
  const height = Math.atan(1 / (factor + Math.tan(Math.abs(lat - sun(jd + noon / 24).declination) * RAD))) / RAD;
  let shade = noon + 3;
  for (let pass = 0; pass < 3; pass += 1) {
    const at = sun(jd + shade / 24);
    const ratio = (sin(height) - sin(at.declination) * sin(lat)) / (cos(at.declination) * cos(lat));
    if (!(ratio >= -1 && ratio <= 1)) { shade = Number.NaN; break; }
    shade = fix(12 - at.equation, 24) + acos(ratio) / 15;
  }
  const night = fix(sunrise - sunset, 24);
  let late = Number.NaN, lateAdjusted = false;
  const minutes = Number(ishaMinutes) || 0;
  if (minutes > 0) late = sunset + minutes / 60;
  else {
    const deg = Number(isha);
    if (!(deg >= 9 && deg <= 24)) return null;
    const portion = (deg / 60) * night;
    late = hourAt(jd, lat, deg, false);
    if (Number.isNaN(late) || late - sunset > portion) { late = sunset + portion; lateAdjusted = true; }
  }
  // Магриб по углу: позже заката; там, где солнце так низко не опускается, — закат.
  let dusk = sunset;
  const below = Number(maghribAngle) || 0;
  if (below > 0 && below <= 10) {
    const moment = hourAt(jd, lat, below, false);
    if (!Number.isNaN(moment) && moment > sunset && moment < late) dusk = moment;
  }
  const midnight = Date.UTC(y, m - 1, d);
  const epoch = (hour) => Math.round(midnight + (hour - lon / 15) * 3_600_000);
  const times = {
    fajr: dawn.fajr, sunrise: dawn.sunrise, dhuhr: epoch(noon),
    asr: Number.isNaN(shade) ? null : epoch(shade),
    maghrib: epoch(dusk), isha: epoch(late),
  };
  for (const key of DAY_TIMES) {
    const minutes = Number(shift?.[key]) || 0;
    if (minutes && times[key] != null) times[key] += Math.max(-SHIFT_MAX, Math.min(SHIFT_MAX, minutes)) * 60_000;
  }
  return { ...times, adjusted: { fajr: dawn.adjusted, isha: lateAdjusted } };
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

/** Метод по названию общины, как его произносят: «дум», «турции», «диянету», «умм аль-кура». Ключ или null. */
export function methodByName(name) {
  const value = squash(name);
  for (const [key, pattern] of NAMES) if (pattern.test(value)) return key;
  return null;
}

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
    const key = methodByName(found[1]);
    if (key) return { method: key, angle: FAJR_METHODS.find(item => item.key === key).angle };
  }
  return null;
}
