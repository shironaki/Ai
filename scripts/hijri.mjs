#!/usr/bin/env node
/**
 * Собирает таблицу лунного календаря: tgcloud/lib/data/hijri.js.
 *
 *   node scripts/hijri.mjs            — собрать;
 *   node scripts/hijri.mjs --check    — только проверить, что собранное совпадает.
 *
 * Зачем таблица. Дни исламских праздников (Ураза-байрам, Курбан-байрам, начало
 * Рамадана) каждый год другие: их считают по луне. Календарь Умм аль-Кура —
 * расчётный, и он есть в Node (ICU). Есть ли он в облаке, где живёт Аи, никто
 * не проверял, поэтому она не считает его на ходу, а носит с собой готовые
 * первые числа месяцев — на пятнадцать лет вперёд. Кончатся годы — запустить
 * этот скрипт ещё раз с бóльшим `LAST`.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const TARGET = join(ROOT, "tgcloud", "lib", "data", "hijri.js");
export const FIRST = 1447, LAST = 1462;

/** Умеет ли этот Node календарь Умм аль-Кура. */
export function supported() {
  try { return new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { timeZone: "UTC" }).resolvedOptions().calendar === "islamic-umalqura"; } catch { return false; }
}

/** Первые числа месяцев: `{ год хиджры: ["2025-06-26", …12] }`. */
export function starts(first = FIRST, last = LAST) {
  const format = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric" });
  const out = {};
  for (let at = Date.UTC(2025, 0, 1); ; at += 86_400_000) {
    const parts = Object.fromEntries(format.formatToParts(new Date(at)).map(part => [part.type, part.value]));
    const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
    if (year > last) break;
    if (year >= first && day === 1) (out[year] ??= [])[month - 1] = new Date(at).toISOString().slice(0, 10);
  }
  return out;
}

export function build() {
  const table = starts();
  const years = Object.keys(table).map(Number).sort((a, b) => a - b);
  for (const year of years) if (table[year].filter(Boolean).length !== 12) throw new Error(`Год ${year}: месяцев не двенадцать.`);
  const rows = years.map(year => `  "${table[year].join(" ")}", // ${year}`).join("\n");
  return `/**\n * Первые числа месяцев по календарю Умм аль-Кура, годы ${years[0]}–${years.at(-1)} хиджры.\n * Собрано командой «node scripts/hijri.mjs» из календаря ICU. Руками не править.\n */\nexport const HIJRI_FIRST = ${years[0]};\nexport const HIJRI_STARTS = Object.freeze([\n${rows}\n]);\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!supported()) { console.error("Этот Node не знает календаря Умм аль-Кура: таблицу собрать нечем."); process.exit(2); }
  const text = build();
  if (process.argv.includes("--check")) {
    const same = existsSync(TARGET) && readFileSync(TARGET, "utf8").replace(/\r\n/gu, "\n") === text;
    console.log(same ? "Таблица лунного календаря свежая." : "Таблица лунного календаря устарела: node scripts/hijri.mjs");
    process.exit(same ? 0 : 1);
  }
  writeFileSync(TARGET, text);
  console.log(`Собрано: ${TARGET}`);
}
