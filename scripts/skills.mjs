#!/usr/bin/env node
/**
 * Собирает список умений: SKILLS.txt → tgcloud/lib/data/skills.js.
 *
 *   npm run skills                  — собрать;
 *   node scripts/skills.mjs --check — только проверить, что собранное свежее.
 *
 * При ошибке в документе старый файл остаётся как был.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseSkills } from "../tgcloud/lib/skills.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE = join(ROOT, "SKILLS.txt");
export const TARGET = join(ROOT, "tgcloud", "lib", "data", "skills.js");

/** Текст документа → текст модуля. Бросает ошибку со списком замечаний. */
export function build(text) {
  const { build: version, service, sections, errors } = parseSkills(text);
  if (errors.length) throw new Error(`В SKILLS.txt есть ошибки:\n${errors.map(item => `  • ${item}`).join("\n")}`);
  const rows = sections.map(section => `  ${JSON.stringify(section)},`).join("\n");
  return `/**\n * Умения Аи. Собрано из SKILLS.txt командой «npm run skills».\n * Руками не править: правится документ, этот файл пересобирается.\n */\nexport const SKILLS_BUILD = ${JSON.stringify(version)};\nexport const SKILLS_SERVICE = Object.freeze(${JSON.stringify(service)});\nexport const SKILLS = Object.freeze([\n${rows}\n]);\n`;
}

export const sameText = (a, b) => String(a).replace(/\r\n/gu, "\n") === String(b).replace(/\r\n/gu, "\n");

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const made = build(readFileSync(SOURCE, "utf8"));
    const old = existsSync(TARGET) ? readFileSync(TARGET, "utf8") : "";
    if (process.argv.includes("--check")) {
      if (!sameText(made, old)) { console.error("Список умений устарел: SKILLS.txt изменён, а data/skills.js не пересобран. Запустите: npm run skills"); process.exit(1); }
      console.log("Список умений свежий.");
    } else {
      if (!sameText(made, old)) writeFileSync(TARGET, made);
      const { sections } = parseSkills(readFileSync(SOURCE, "utf8"));
      console.log(`Список умений собран: разделов — ${sections.length}, строк — ${sections.reduce((sum, section) => sum + section.lines.length, 0)}.`);
    }
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(1);
  }
}
