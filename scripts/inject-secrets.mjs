#!/usr/bin/env node
/**
 * Вписать секреты в `tgcloud/lib/secrets.js` на время одного запуска Actions.
 *
 * У платформы нет переменных окружения: ключ из GitHub-секрета попадает в
 * сердце только если записан в публикуемый модуль. Этим занимается этот файл —
 * один для публикации и для будильника, чтобы два места не разошлись.
 *
 * Значения читаются из окружения и никуда не печатаются. После запуска файл
 * возвращается пустым: `git checkout -- tgcloud/lib/secrets.js`.
 *
 *   node scripts/inject-secrets.mjs --require-key     публикация: без ключа — стоп
 *   node scripts/inject-secrets.mjs                   будильник: без ключа — предупреждение
 */
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args.find(item => item.startsWith("--file="))?.slice(7) ?? "tgcloud/lib/secrets.js";
const strict = args.includes("--require-key");

const key = String(process.env.AI_PROVIDER_KEY ?? "");
const owner = String(process.env.OWNER_TG_ID ?? "").trim();

if (!key && strict) {
  console.log("::error::Add the provider key as secret AI_PROVIDER_KEY.");
  process.exit(1);
}
if (!key) console.log("::warning::AI_PROVIDER_KEY is empty in this job: the heart wakes up, but has nothing to think with.");
if (!owner) console.log("::warning::OWNER_TG_ID is not set: the heart will answer, but fault reports will wait in the queue.");

// Запасные провайдеры: JSON-объект строк — или ничего.
const extra = {};
try {
  const parsed = JSON.parse(process.env.AI_EXTRA_KEYS || "{}");
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const [name, value] of Object.entries(parsed)) if (typeof value === "string" && value) extra[name] = value;
  }
} catch {
  console.log("::warning::AI_EXTRA_KEYS is not valid JSON: spare providers stay off.");
}

let text = readFileSync(file, "utf8");
const slots = [
  [/export const AI_API_KEY = .*;/u, `export const AI_API_KEY = ${JSON.stringify(key)};`],
  [/export const OWNER_TG_ID = .*;/u, `export const OWNER_TG_ID = ${JSON.stringify(owner)};`],
  [/export const AI_EXTRA_KEYS = .*;/u, `export const AI_EXTRA_KEYS = ${JSON.stringify(extra)};`],
];
for (const [pattern, line] of slots) {
  if (!pattern.test(text)) {
    console.log(`::error::${file}: a secret slot is missing — the file was changed by hand.`);
    process.exit(1);
  }
  // Функция вместо строки: ключ, в котором случилось «$&», останется собой.
  text = text.replace(pattern, () => line);
}
writeFileSync(file, text);
console.log(`Secret slots filled: provider key ${key ? "yes" : "no"}, owner ${owner ? "yes" : "no"}, spare providers ${Object.keys(extra).length}.`);
