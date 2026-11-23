/**
 * Упаковка словаря (0.42.0, `tgcloud/lib/pack.js`): русская буква — один байт. Здесь — что упаковка ничего не
 * теряет и что собранные модули словаря действительно лёгкие.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { swap, pack, unpack, PAIRS } = await import("../tgcloud/lib/pack.js");
const { build, literal, PARTS, DIRECTORY, SOURCE } = await import("../scripts/phrases.mjs");
const { parseCatalogue, SECTIONS } = await import("../tgcloud/lib/phrasebook.js");

test("упаковка: таблица — пары без повторов; перестановка обратима на любом тексте", () => {
  const [from, to] = PAIRS;
  assert.equal(from.length, to.length);
  assert.equal(new Set(from + to).size, from.length * 2, "знак встречается в таблице один раз");
  // Вторая строка — только знаки в один байт, и ни один из них не нужно экранировать ни в запросе, ни в шаблонной строке.
  assert.match(to, /^[A-Za-z#&<>]+$/u);
  assert.ok(!/[\\`$"]/u.test(to));
  // Все строчные буквы, кроме «ъ», и самые частые заглавные.
  for (const letter of "абвгдежзийклмнопрстуфхцчшщыьэюяё") assert.ok(from.includes(letter), letter);
  for (const text of [
    "", "привет", "Привет, хозяин — «как дела»?", "hello, world: lo-fi & Telegram #1 <b>", "ъЪЫЩЮЁ ёжик", "😏 ｡◕‿◕｡ 🫡", "\\S+ {0,4}$ `код` ${x}",
    "строка\nвторая\r\nтретья\u2028четвёртая", JSON.stringify({ n: "тема", w: ["раз", "two"], p: ["^(?:я )(?:\\S+ ){0,4}$"], l: [["хозяин,ночь", "Доброй ночи.\\nСпите."]] }),
  ]) {
    assert.equal(swap(swap(text)), text, JSON.stringify(text));
    assert.equal(swap(text).length, text.length);
  }
  assert.equal(swap("привет"), "pqicfs");
  assert.equal(swap("\"—«»"), "#&<>");
  assert.equal(swap("#&<>"), "\"—«»");
  // Длинный текст — кусками: граница куска ничего не рвёт.
  const long = "Привет, мир — «да»! 😏 ".repeat(3000);
  assert.equal(swap(swap(long)), long);
  assert.deepEqual(unpack(pack({ "ключ": ["значение", 1, null, true, "a\"b\\c"] })), { "ключ": ["значение", 1, null, true, "a\"b\\c"] });
});

test("упаковка: запись шаблонной строкой возвращает тот же текст", () => {
  for (const text of ["", "просто", "a\\b", "`код`", "${x} и $ {y} и $", "\\`\\${", "строка\nвторая", "\\S+ {0,4}$", "конец\\"]) {
    assert.equal(runInNewContext(literal(text)), text, JSON.stringify(text));
  }
});

test("упаковка: модули словаря — тот же словарь, что в документе, и буква в них весит байт", () => {
  const text = readFileSync(SOURCE, "utf8"), { sections } = parseCatalogue(text);
  // Распакованное — ровно то, что разобрано из документа: темы, вызовы, шаблоны, строки, пометки.
  assert.deepEqual(SECTIONS, sections);
  const made = build(text);
  let rows = 0;
  for (const name of PARTS) {
    const file = readFileSync(join(DIRECTORY, name), "utf8"), body = file.slice(file.indexOf("export const PART = "));
    // Одна тема — одна строка: правка темы меняет в истории одну строку модуля.
    const lines = body.split("\n");
    assert.equal(lines[0], "export const PART = `[");
    assert.equal(lines.at(-2), "]`;");
    rows += lines.length - 3;
    // Вне шапки-комментария почти всё — в один байт: кириллицей остались только редкие заглавные, «ъ» и то, что было латиницей.
    const heavy = Buffer.byteLength(body) - body.length;
    assert.ok(heavy < body.length * 0.03, `${name}: лишних байт ${heavy} на ${body.length} знаков`);
    assert.ok(!body.includes("\""), `${name}: кавычек в упакованном нет — в запросе каждая стоила бы два байта`);
    assert.equal(made[name].replace(/\r\n/gu, "\n"), file.replace(/\r\n/gu, "\n"));
  }
  assert.equal(rows, sections.length);
  // Сколько это даёт: словарь в запросе — меньше 560 КБ (до упаковки было 883 КБ при 861 теме).
  const weight = PARTS.reduce((sum, name) => sum + Buffer.byteLength(JSON.stringify(readFileSync(join(DIRECTORY, name), "utf8"))), 0);
  assert.ok(weight < Buffer.byteLength(JSON.stringify(sections)) * 0.7, `словарь в запросе: ${weight} байт`);
  assert.ok(readFileSync(join(ROOT, "tgcloud/lib/phrasebook.js"), "utf8").includes("unpack(FIRST)"));
});
