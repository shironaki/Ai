#!/usr/bin/env node
/**
 * Облегчает код перед отправкой в облако: убирает комментарии.
 *
 * Зачем. Инструмент публикации отправляет на репетицию весь код одним запросом
 * (`tgcloud run`: все модули — одной картой JSON). 17.11.2026 сборки 0.36.0–0.36.2
 * не опубликовались ни разу: запрос перешёл за три миллиона байт, и облако
 * обрывало передачу (журнал — docs/JOURNAL.md, «Сообщение 31»). Пятая часть
 * кода — комментарии: облаку они не нужны, а людям и агентам нужны. Поэтому в
 * репозитории код лежит с комментариями, а в облако уходит без них.
 *
 * Как. Комментарии находит настоящий разборщик JavaScript (acorn, лежит рядом —
 * `scripts/vendor/acorn.mjs`), а не выражения «на глаз»: «//» внутри строки,
 * шаблона или регулярного выражения комментарием не является. Облегчённый текст
 * разбирается ещё раз и сверяется с исходным лексема за лексемой, вместе с
 * переносами строк между ними (от них зависит расстановка «;»). Не сошлось —
 * ошибка, и ни один файл не тронут. Номера строк сохраняются: на месте
 * комментария остаются его переносы, так что строка в сообщении об ошибке из
 * облака — та же, что в репозитории.
 *
 *   node scripts/slim.mjs          облегчить tgcloud/ в текущей папке. Это должна быть
 *                                  копия для облака: в папке с .git скрипт откажется
 *   node scripts/slim.mjs --here   облегчить и в папке с .git: для одноразовой копии
 *                                  (кнопка в GitHub Actions), не для рабочей папки
 *   node scripts/slim.mjs --size   ничего не менять: только посчитать, сколько уйдёт
 *
 * Итог — одна строка JSON: { files, before, after, body, bodyBefore } — число
 * модулей, их вес в байтах до и после и вес запроса репетиции после и до.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "./vendor/acorn.mjs";

const OPTIONS = Object.freeze({ ecmaVersion: "latest", sourceType: "module" });

/** Лексемы и комментарии текста — так, как их видит разбор, а не догадка. */
function read(source) {
  const tokens = [], comments = [];
  parse(source, { ...OPTIONS, onToken: tokens, onComment: (block, text, start, end) => comments.push({ block, start, end }) });
  return { tokens, comments };
}

/** Перенос строки по правилам языка: от него зависит, где кончается оператор. */
const BREAK = /[\n\r\u2028\u2029]/u;

/** Одна и та же программа: те же лексемы в том же порядке и те же переносы между ними. */
export function sameProgram(before, after) {
  const a = read(before), b = read(after);
  if (b.comments.length) return false;
  if (a.tokens.length !== b.tokens.length) return false;
  let endA = 0, endB = 0;
  for (let index = 0; index < a.tokens.length; index += 1) {
    const x = a.tokens[index], y = b.tokens[index];
    if (x.type.label !== y.type.label) return false;
    if (before.slice(x.start, x.end) !== after.slice(y.start, y.end)) return false;
    if (BREAK.test(before.slice(endA, x.start)) !== BREAK.test(after.slice(endB, y.start))) return false;
    endA = x.end; endB = y.end;
  }
  return true;
}

/**
 * Текст модуля без комментариев. Перенос строки не убирается ни один: комментарий
 * в несколько строк оставляет свои переносы, однострочный — тот, что за ним.
 * Пробелы перед комментарием убираются — они стоят между лексемами, а не внутри.
 */
export function slim(source) {
  const text = String(source);
  const { comments } = read(text);
  if (!comments.length) return text;
  let out = "", at = 0;
  for (const { block, start, end } of comments) {
    out += text.slice(at, start).replace(/[ \t]+$/u, "");
    if (block) {
      const lines = text.slice(start, end).split(/\r\n|[\n\r\u2028\u2029]/u).length - 1;
      // Комментарий посреди строки («a /* … */ b») не должен склеить соседей.
      out += lines ? "\n".repeat(lines) : (/[ \t\n\r]$/u.test(out) || /^[ \t\n\r]/u.test(text.slice(end, end + 1)) || !out || end === text.length ? "" : " ");
    }
    at = end;
  }
  out += text.slice(at);
  if (!sameProgram(text, out)) throw new Error("после удаления комментариев программа изменилась");
  return out;
}

/** Модули проекта — те же, что берёт инструмент публикации: schema.js и *.js в lib/, handlers/, endpoints/. */
export function modules(root) {
  const base = join(root, "tgcloud"), found = [];
  const walk = (directory, name) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${name}/${entry.name}`;
      if (entry.isDirectory()) walk(join(directory, entry.name), path);
      else if (entry.isFile() && entry.name.endsWith(".js")) found.push(path);
    }
  };
  if (existsSync(join(base, "schema.js"))) found.push("schema.js");
  for (const name of ["lib", "handlers", "endpoints"]) if (existsSync(join(base, name)) && statSync(join(base, name)).isDirectory()) walk(join(base, name), name);
  return found.sort();
}

/** Вес запроса репетиции в байтах: все модули одной картой JSON — как его собирает `tgcloud run`. */
export function runBody(sources) {
  const named = Object.fromEntries(Object.entries(sources).map(([path, code]) => [path.replace(/\.js$/u, ""), code]));
  return Buffer.byteLength(JSON.stringify({ module: "handlers/message", sources: named, args: { chat: { id: 1, type: "private" }, from: { id: 1 }, text: "/start" }, ctx: { testRun: true } }));
}

/**
 * Что не облегчается: схема базы. Её текст платформа сравнивает с прежним, чтобы
 * решить, менялись ли таблицы; комментариев в ней на сотни байт — трогать незачем.
 */
export const KEPT = Object.freeze(["schema.js"]);

/** Облегчить проект в папке `root`. `write: false` — только посчитать. Возвращает итог в байтах. */
export function slimProject(root, { write = true } = {}) {
  const before = {}, after = {};
  for (const path of modules(root)) {
    const text = readFileSync(join(root, "tgcloud", path), "utf8");
    before[path] = text;
    try { after[path] = KEPT.includes(path) ? text : slim(text); } catch (error) { throw new Error(`${path}: ${error.message}`); }
  }
  const weigh = (map) => Object.values(map).reduce((sum, code) => sum + Buffer.byteLength(code), 0);
  // Пишется всё или ничего: сверка каждого модуля уже прошла.
  if (write) for (const [path, code] of Object.entries(after)) if (code !== before[path]) writeFileSync(join(root, "tgcloud", path), code);
  // Самый тяжёлый модуль после облегчения (0.49.0): у модуля свой предел (`tests/upload.test.mjs`), и подойти к нему
  // незаметно легко — число видно при каждом счёте, а не только когда предел уже пробит.
  const [heaviest, heaviestBytes] = Object.entries(after).map(([path, code]) => [path, Buffer.byteLength(code)]).sort((one, two) => two[1] - one[1])[0] ?? ["", 0];
  return { files: Object.keys(before).length, before: weigh(before), after: weigh(after), body: runBody(after), bodyBefore: runBody(before), heaviest, heaviestBytes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sizeOnly = process.argv.includes("--size"), here = process.argv.includes("--here");
  const root = process.cwd();
  try {
    if (!sizeOnly && !here && existsSync(join(root, ".git"))) throw new Error("здесь репозиторий (.git): комментарии убираются только из копии для облака. Посчитать вес — «node scripts/slim.mjs --size»");
    console.log(JSON.stringify(slimProject(root, { write: !sizeOnly })));
  } catch (error) {
    console.error(`Облегчить код не вышло: ${error.message}`);
    process.exit(1);
  }
}
