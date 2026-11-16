#!/usr/bin/env node
/**
 * Вписать секреты в `tgcloud/lib/secrets.js` на время одной публикации.
 *
 * У платформы нет переменных окружения: ключ попадает в сердце, только если
 * записан в публикуемый модуль. Этим занимается этот файл — один для телефона
 * (`scripts/phone.sh`) и для кнопки в Actions, чтобы два пути не разошлись.
 *
 * Значения читаются из окружения и никуда не печатаются. После запуска файл
 * возвращается пустым: `git checkout -- tgcloud/lib/secrets.js`.
 *
 *   node scripts/inject-secrets.mjs --require-key     публикация: без ключа — стоп
 *   node scripts/inject-secrets.mjs                   будильник: без ключа — предупреждение
 *
 * Запасные ключи — двумя способами, можно вместе:
 *   AI_EXTRA_KEYS={"gigachat":"…"}     одной строкой JSON, как в GitHub-секрете;
 *   KEY_GIGACHAT=…                      отдельной строкой: имя после KEY_ — id.
 */
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args.find(item => item.startsWith("--file="))?.slice(7) ?? "tgcloud/lib/secrets.js";
const strict = args.includes("--require-key");

let key = String(process.env.AI_PROVIDER_KEY ?? "").trim();
let owner = String(process.env.OWNER_TG_ID ?? "").trim();
/**
 * Ключ — печатные знаки латиницы без пробелов. Строка-образец из инструкции
 * («ключ модели», «ваш числовой ID») в живого бота уйти не должна: с ней он
 * перестал бы думать, а узнать об этом было бы не от кого.
 */
const keyLike = (value) => /^[\x21-\x7e]{6,}$/u.test(String(value ?? ""));
// В Actions строка с «::error::» становится заметкой в журнале; на телефоне
// это просто слово.
const inActions = process.env.GITHUB_ACTIONS === "true";
const fail = (text) => console.log(inActions ? `::error::${text}` : `Ошибка: ${text}`);
const warn = (text) => console.log(inActions ? `::warning::${text}` : `Внимание: ${text}`);

if (!key && strict) {
  fail("AI_PROVIDER_KEY is empty: add the provider key.");
  process.exit(1);
}
if (key && !keyLike(key)) {
  fail("AI_PROVIDER_KEY does not look like a key (spaces or non-Latin letters): put the key itself in place of the sample line.");
  if (strict) process.exit(1);
  key = "";
}
if (owner && !/^\d{3,20}$/u.test(owner)) {
  warn("OWNER_TG_ID is not a number: ignored.");
  owner = "";
}
if (!key) warn("AI_PROVIDER_KEY is empty: the heart wakes up, but has nothing to think with.");
if (!owner) warn("OWNER_TG_ID is not set: fine if the owner is in config.js; otherwise fault reports wait in the queue.");

// Запасные провайдеры: JSON-объект строк — или ничего.
const extra = {};
try {
  const parsed = JSON.parse(process.env.AI_EXTRA_KEYS || "{}");
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value !== "string" || !value) continue;
      if (keyLike(value.trim())) extra[name] = value.trim();
      else warn(`AI_EXTRA_KEYS: the value for "${name}" does not look like a key — that provider stays off.`);
    }
  }
} catch {
  warn("AI_EXTRA_KEYS is not valid JSON: spare providers from it stay off.");
}
// KEY_GIGACHAT=… → { gigachat: "…" }: так ключ удобнее набрать на телефоне.
for (const [name, value] of Object.entries(process.env)) {
  const id = name.match(/^KEY_([A-Za-z0-9_]+)$/u)?.[1];
  if (!id || typeof value !== "string" || !value.trim()) continue;
  if (keyLike(value.trim())) extra[id.toLowerCase()] = value.trim();
  else warn(`${name} does not look like a key (spaces or non-Latin letters) — that provider stays off.`);
}

// Cloudflare (рисование и запасной мозг): ключ особого вида — «ID аккаунта:токен».
if (extra.cloudflare && !/^[0-9a-f]{32}:[\x21-\x7e]{20,}$/iu.test(extra.cloudflare)) {
  warn('KEY_CLOUDFLARE must look like "<account id>:<token>": 32 hex characters, a colon, the token — drawing and the Cloudflare brain stay off.');
  delete extra.cloudflare;
}

let text = readFileSync(file, "utf8");
const slots = [
  [/export const AI_API_KEY = .*;/u, `export const AI_API_KEY = ${JSON.stringify(key)};`],
  [/export const OWNER_TG_ID = .*;/u, `export const OWNER_TG_ID = ${JSON.stringify(owner)};`],
  [/export const AI_EXTRA_KEYS = .*;/u, `export const AI_EXTRA_KEYS = ${JSON.stringify(extra)};`],
];
for (const [pattern, line] of slots) {
  if (!pattern.test(text)) {
    fail(`${file}: a secret slot is missing — the file was changed by hand.`);
    process.exit(1);
  }
  // Функция вместо строки: ключ, в котором случилось «$&», останется собой.
  text = text.replace(pattern, () => line);
}
writeFileSync(file, text);
console.log(`Secret slots filled: provider key ${key ? "yes" : "no"}, owner ${owner ? "yes" : "no"}, spare providers ${Object.keys(extra).length}.`);
