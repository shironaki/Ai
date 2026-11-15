#!/usr/bin/env node
/**
 * Сверка расчёта намазов (`tgcloud/lib/fajr.js`) с открытой библиотекой adhan.
 *
 * В проект библиотека не ставится: зависимостей у сердца нет. Запуск — из
 * временной папки, куда она поставлена:
 *
 *   mkdir -p /tmp/adhan && cd /tmp/adhan && npm init -y && npm install adhan@4.4.6
 *   node /путь/к/проекту/scripts/adhan-compare.mjs /tmp/adhan
 *
 * Сравниваются семь методов, которые есть и у нас, и у библиотеки, — целиком,
 * с её собственными минутами метода и углом магриба; двенадцать городов, обе
 * школы асра, каждый девятый день года. Правило высоких широт у библиотеки —
 * «угол сумерек»: оно совпадает с нашей «долей ночи».
 *
 * Чего сверка не покрывает: метод «ДУМ России» (в библиотеке его нет) и
 * расписания конкретных мечетей — их у нас нет вовсе.
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const where = resolve(process.argv[2] ?? "/tmp/adhan");
let adhan;
try {
  adhan = createRequire(pathToFileURL(`${where}/`).href)("adhan");
} catch {
  console.error(`Библиотека adhan не найдена в ${where}. Поставить: cd ${where} && npm init -y && npm install adhan@4.4.6`);
  process.exit(2);
}
const { prayersOn, FAJR_METHODS, methodExtras, ishaRule, DAY_TIMES } = await import("../tgcloud/lib/fajr.js");
const { Coordinates, CalculationMethod, PrayerTimes, Madhab, HighLatitudeRule } = adhan;

const CITIES = [
  ["Лелистад", 52.52, 5.47], ["Амстердам", 52.37, 4.9], ["Москва", 55.75, 37.62], ["Казань", 55.79, 49.12],
  ["Грозный", 43.32, 45.69], ["Мекка", 21.42, 39.83], ["Стамбул", 41.01, 28.98], ["Каир", 30.04, 31.24],
  ["Джакарта", -6.2, 106.85], ["Кейптаун", -33.92, 18.42], ["Нью-Йорк", 40.71, -74.0], ["Ташкент", 41.3, 69.24],
];
const PAIRS = { mwl: "MuslimWorldLeague", egypt: "Egyptian", karachi: "Karachi", isna: "NorthAmerica", makkah: "UmmAlQura", turkey: "Turkey", tehran: "Tehran" };

let count = 0, skipped = 0;
const worst = {}, place = {};
for (const [key, theirsName] of Object.entries(PAIRS)) {
  const method = FAJR_METHODS.find(item => item.key === key);
  const mine = { angle: method.angle, ...ishaRule({ method: key, angle: method.angle }), ...methodExtras(key) };
  worst[key] = Object.fromEntries(DAY_TIMES.map(name => [name, 0]));
  for (const [city, lat, lon] of CITIES) for (const factor of [1, 2]) for (let day = 0; day < 365; day += 9) {
    const date = new Date(Date.UTC(2026, 0, 1 + day));
    const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    const params = CalculationMethod[theirsName]();
    params.madhab = factor === 2 ? Madhab.Hanafi : Madhab.Shafi;
    params.highLatitudeRule = HighLatitudeRule.TwilightAngle;
    const theirs = new PrayerTimes(new Coordinates(lat, lon), new Date(y, m - 1, d), params);
    const ours = prayersOn({ y, m, d, latitude: lat, longitude: lon, asr: factor, ...mine });
    if (!ours) { skipped += 1; continue; }
    for (const name of DAY_TIMES) {
      if (ours[name] == null || Number.isNaN(theirs[name]?.getTime?.())) continue;
      // В Рамадан у Умм аль-Кура иша — через 120 минут, а не через 90: такие дни в сравнение иша не идут.
      if (name === "isha" && key === "makkah" && Math.abs((theirs.isha - theirs.maghrib) / 60_000 - 90) > 2) continue;
      const diff = Math.abs(ours[name] - theirs[name].getTime()) / 60_000;
      count += 1;
      if (diff > worst[key][name]) { worst[key][name] = diff; place[`${key}.${name}`] = `${city}, аср ${factor}, ${y}-${m}-${d}`; }
    }
  }
}
console.log(`сравнений: ${count}; дней без расчёта: ${skipped}`);
for (const [key, row] of Object.entries(worst)) console.log(key.padEnd(8), Object.entries(row).map(([name, value]) => `${name} ${value.toFixed(2)}`).join(" · "));
const top = Object.entries(worst).flatMap(([key, row]) => Object.entries(row).map(([name, value]) => [value, `${key}.${name}`])).sort((a, b) => b[0] - a[0])[0];
console.log(`худшее расхождение: ${top[0].toFixed(2)} мин — ${top[1]} (${place[top[1]]})`);
// Библиотека округляет до минуты (до полминуты расхождения — от этого); аср она считает
// по склонению солнца на начало суток, мы — на полдень: отсюда до полутора минут в асре.
process.exit(top[0] < 2 ? 0 : 1);
