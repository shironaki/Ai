#!/usr/bin/env node
/**
 * Собирает словарный запас: PHRASES.txt → tgcloud/lib/data/phrases.js.
 *
 *   npm run phrases            — собрать;
 *   node scripts/phrases.mjs --check   — только проверить, что собранное свежее.
 *
 * Документ правит человек, поэтому ошибки названы по-русски и с номером
 * строки, а при ошибке старый файл остаётся как был.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCatalogue } from "../tgcloud/lib/catalogue.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE = join(ROOT, "PHRASES.txt");
export const TARGET = join(ROOT, "tgcloud", "lib", "data", "phrases.js");

/** Текст документа → текст модуля. Бросает ошибку со списком замечаний. */
export function build(text) {
  const { sections, errors } = parseCatalogue(text);
  if (errors.length) throw new Error(`В PHRASES.txt есть ошибки:\n${errors.map(item => `  • ${item}`).join("\n")}`);
  const rows = sections.map(section => `  ${JSON.stringify(section)},`).join("\n");
  return `/**\n * Словарный запас Аи. Собрано из PHRASES.txt командой «npm run phrases».\n * Руками не править: правится документ, этот файл пересобирается.\n */\nexport const SECTIONS = Object.freeze([\n${rows}\n]);\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const made = build(readFileSync(SOURCE, "utf8"));
    const old = existsSync(TARGET) ? readFileSync(TARGET, "utf8") : "";
    if (process.argv.includes("--check")) {
      if (made !== old) { console.error("Словарь устарел: PHRASES.txt изменён, а data/phrases.js не пересобран. Запустите: npm run phrases"); process.exit(1); }
      console.log("Словарь свежий.");
    } else {
      if (made !== old) writeFileSync(TARGET, made);
      const { sections } = parseCatalogue(readFileSync(SOURCE, "utf8"));
      const lines = sections.reduce((sum, section) => sum + section.l.length, 0);
      console.log(`Словарь собран: тем — ${sections.filter(item => !item.n.startsWith("+")).length}, запасов — ${sections.filter(item => item.n.startsWith("+")).length}, фраз — ${lines}.`);
    }
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(1);
  }
}
