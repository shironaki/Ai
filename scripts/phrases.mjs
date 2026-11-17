#!/usr/bin/env node
/**
 * Собирает словарный запас: PHRASES.txt → tgcloud/lib/data/phrases-1.js и phrases-2.js.
 *
 *   npm run phrases            — собрать;
 *   node scripts/phrases.mjs --check   — только проверить, что собранное свежее.
 *
 * Документ правит человек, поэтому ошибки названы по-русски и с номером
 * строки, а при ошибке старые файлы остаются как были.
 *
 * Почему модулей два. Облако принимает код одним запросом, и словарь — самое
 * тяжёлое, что в нём есть, после сердца: одним модулем он дорос до 690 КБ
 * (0.36.2). Двумя — ни один модуль проекта не тяжелее, чем был в сборке, которая
 * заведомо публиковалась (docs/JOURNAL.md, «Сообщение 31»). Склеивает половины
 * `tgcloud/lib/phrasebook.js`.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCatalogue } from "../tgcloud/lib/catalogue.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE = join(ROOT, "PHRASES.txt");
/** Одно и то же с точностью до перевода строки: на Windows Git может отдать файл с CRLF. */
export const sameText = (a, b) => String(a).replace(/\r\n/gu, "\n") === String(b).replace(/\r\n/gu, "\n");

export const DIRECTORY = join(ROOT, "tgcloud", "lib", "data");
/** Модули словаря, по порядку: темы первой половины документа и второй. */
export const PARTS = Object.freeze(["phrases-1.js", "phrases-2.js"]);
/** Прежний единый модуль: после сборки его быть не должно. */
const FORMER = join(DIRECTORY, "phrases.js");

/**
 * Текст документа → тексты модулей: `{ "phrases-1.js": …, "phrases-2.js": … }`.
 * Темы идут в порядке документа; граница — там, где набралась половина веса.
 * Бросает ошибку со списком замечаний.
 */
export function build(text) {
  const { sections, errors } = parseCatalogue(text);
  if (errors.length) throw new Error(`В PHRASES.txt есть ошибки:\n${errors.map(item => `  • ${item}`).join("\n")}`);
  const rows = sections.map(section => `  ${JSON.stringify(section)},`);
  const weights = rows.map(row => Buffer.byteLength(row) + 1);
  const half = weights.reduce((sum, weight) => sum + weight, 0) / 2;
  let cut = 0;
  for (let sum = 0; cut < rows.length && sum < half; cut += 1) sum += weights[cut];
  const halves = [rows.slice(0, cut), rows.slice(cut)];
  return Object.fromEntries(PARTS.map((name, index) => [name,
    `/**\n * Словарный запас Аи, часть ${index + 1} из ${PARTS.length}. Собрано из PHRASES.txt командой «npm run phrases».\n * Руками не править: правится документ, этот файл пересобирается.\n */\nexport const PART = Object.freeze([\n${halves[index].join("\n")}\n]);\n`]));
}

/** Свежее ли собранное: каждый модуль словаря совпадает с тем, что даёт документ, и прежнего единого модуля нет. */
export function fresh(text) {
  const made = build(text);
  return !existsSync(FORMER) && PARTS.every(name => existsSync(join(DIRECTORY, name)) && sameText(made[name], readFileSync(join(DIRECTORY, name), "utf8")));
}


if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const made = build(readFileSync(SOURCE, "utf8"));
    if (process.argv.includes("--check")) {
      if (!fresh(readFileSync(SOURCE, "utf8"))) { console.error("Словарь устарел: PHRASES.txt изменён, а data/phrases-1.js и phrases-2.js не пересобраны. Запустите: npm run phrases"); process.exit(1); }
      console.log("Словарь свежий.");
    } else {
      for (const name of PARTS) {
        const target = join(DIRECTORY, name);
        if (!existsSync(target) || !sameText(made[name], readFileSync(target, "utf8"))) writeFileSync(target, made[name]);
      }
      rmSync(FORMER, { force: true });
      const { sections } = parseCatalogue(readFileSync(SOURCE, "utf8"));
      const lines = sections.reduce((sum, section) => sum + section.l.length, 0);
      console.log(`Словарь собран: тем — ${sections.filter(item => !item.n.startsWith("+")).length}, запасов — ${sections.filter(item => item.n.startsWith("+")).length}, фраз — ${lines}.`);
    }
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(1);
  }
}
