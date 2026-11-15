/**
 * Кибла: в какую сторону от города человека лежит Кааба.
 *
 * Чистая геометрия шара, без сети и без модели: начальный азимут дуги большого
 * круга от точки до Каабы. Градусы считаются от истинного севера (как на
 * карте), по часовой стрелке. Стрелка компаса показывает магнитный север —
 * поправка зависит от места и здесь не считается: об этом она говорит прямо.
 */

/** Кааба: 21°25′21″ с. ш., 39°49′34″ в. д. */
export const KAABA = Object.freeze({ lat: 21.4225, lon: 39.8262 });
const EARTH_KM = 6371;
const rad = (deg) => (deg * Math.PI) / 180;
const deg = (value) => (value * 180) / Math.PI;

/** Точка → `{ bearing, km }`: азимут на Каабу (0…360, от севера по часовой) и расстояние по дуге. */
export function qiblaOf(latitude, longitude) {
  const lat = Number(latitude), lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const f1 = rad(lat), f2 = rad(KAABA.lat), dl = rad(KAABA.lon - lon);
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  const bearing = (deg(Math.atan2(y, x)) + 360) % 360;
  const h = Math.sin((f2 - f1) / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  const km = 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  return { bearing, km };
}

const POINTS = Object.freeze(["север", "северо-восток", "восток", "юго-восток", "юг", "юго-запад", "запад", "северо-запад"]);
const TOWARDS = Object.freeze({ "север": "северу", "восток": "востоку", "юг": "югу", "запад": "западу" });
const CARDINALS = Object.freeze(["север", "восток", "юг", "запад"]);

/**
 * Азимут словами: «почти точно на юг», «на юг, чуть к западу», «на юго-запад
 * с уклоном к югу». Восемь сторон и сторона, к которой отклонение.
 */
export function compassWords(bearing) {
  const value = ((Number(bearing) % 360) + 360) % 360;
  const index = Math.round(value / 45) % 8;
  const point = POINTS[index];
  // Отклонение от ближайшей из восьми сторон: по часовой — плюс.
  const off = ((value - index * 45 + 540) % 360) - 180;
  if (Math.abs(off) <= 4) return `почти точно на ${point}`;
  // К какой из четырёх сторон отклонение: от «юга» по часовой — к западу; от «юго-запада» против часовой — к югу.
  const turned = ((value + (off > 0 ? 45 : -45)) % 360 + 360) % 360;
  const side = index % 2 === 0
    ? CARDINALS[(index / 2 + (off > 0 ? 1 : 3)) % 4]
    : CARDINALS[Math.round(turned / 90) % 4];
  return Math.abs(off) <= 14 ? `на ${point}, чуть к ${TOWARDS[side]}` : `на ${point} с уклоном к ${TOWARDS[side]}`;
}

/** «3 380 км». */
export const kmText = (km) => `${String(Math.round(km / 10) * 10).replace(/\B(?=(\d{3})+(?!\d))/gu, " ")} км`;

const fold = (text) => String(text ?? "").toLowerCase().replace(/ё/gu, "е").replace(/[«»"]/gu, "").replace(/\s+/gu, " ").trim().replace(/[.!?…]+$/u, "").trim();
const QIBLA = "(?:кибл[аыуе]|къибл[аыуе]|кыбл[аыуе])";
const PLACE = "(?:\\s+(?:из|в|во|для|от|у)\\s+(?:города\\s+|городе\\s+)?(.{2,40}))?";
const ASK = [
  new RegExp(`^(?:а\\s+)?(?:(?:где|куда|в\\s+какой\\s+стороне|в\\s+какую\\s+сторону|с\\s+какой\\s+стороны|покажи|скажи|найди|посчитай|определи)\\s+)?(?:сейчас\\s+|у\\s+(?:меня|нас)\\s+)?(?:находится\\s+|смотрит\\s+)?(?:направление\\s+(?:на\\s+)?)?${QIBLA}${PLACE}$`, "u"),
  new RegExp(`^(?:а\\s+)?(?:где|куда|в\\s+какой\\s+стороне|в\\s+какую\\s+сторону|покажи|скажи)?\\s*(?:направление\\s+на\\s+|сторона\\s+|дорога\\s+на\\s+)?(?:мекк[аеуи]|кааб[аеуы])${PLACE}$`, "u"),
  new RegExp(`^(?:а\\s+)?(?:куда|в\\s+какую\\s+сторону|в\\s+какой\\s+стороне|лицом\\s+куда)\\s+(?:мне\\s+|нам\\s+|надо\\s+|нужно\\s+)*(?:молиться|поворачиваться|повернуться|вставать|встать|становиться|читать\\s+намаз|совершать\\s+намаз|делать\\s+намаз)(?:\\s+(?:в|на|при|для)\\s+намаз[еау]?)?${PLACE}$`, "u"),
];

/**
 * Слова о кибле → `{ city }` (город назван — «кибла из Казани»; пусто — город
 * человека), иначе null. «Где Мекка?» — тоже о направлении: о самом городе
 * спрашивают «что такое Мекка», «расскажи про Мекку».
 */
export function parseQibla(text) {
  const value = fold(text);
  if (!value || value.length > 80 || !/кибл|къибл|кыбл|мекк|кааб|молиться|намаз/u.test(value)) return null;
  for (const pattern of ASK) {
    const found = value.match(pattern);
    if (!found) continue;
    const city = String(found[1] ?? "").replace(/^(?:города|городе)\s+/u, "").trim();
    // «куда молиться в пути», «…в намазе» — не город.
    if (/^(?:пути|дороге|поезде|самолете|намазе|мечети|доме|комнате|квартире|офисе|этом|нашем|моем)(?:\s|$)/u.test(city)) return { city: "" };
    return { city };
  }
  return null;
}
