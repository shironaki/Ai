/**
 * Упаковка русского текста для облака: буква — один байт вместо двух.
 *
 * Зачем. Весь код уходит в облако одним запросом, и предел этого запроса близко (docs/IDEAS.md, «Вес кода для
 * облака»). Самое тяжёлое в коде — словарь, а в словаре — буквы: кириллица в UTF-8 занимает два байта на букву,
 * латиница — один. Латиницы в словаре почти нет. Поэтому при сборке буквы меняются местами: «привет» лежит в
 * модуле как «ghbdtn»-подобная запись, а редкое «hello» — кириллицей. При загрузке — обратно.
 *
 * Как. `swap` — замена знака на парный по таблице, туда и обратно одной и той же функцией: `swap(swap(x)) === x`
 * для любого текста. Знаки вне таблицы не трогаются (цифры, пробелы, скобки, смайлики). Кроме букв в таблице
 * три пары, которые дороги именно в запросе: кавычка `"` (в JSON-запросе она идёт как `\"` — два байта, а в
 * словаре их десятки тысяч), длинное тире и ёлочки. Их пары — знаки, которых в словаре почти нет.
 *
 * Модуль словаря хранит одну строку: JSON списка тем, пропущенный через `swap`. `unpack` возвращает список.
 * Платформе тут нечего не поддержать: `charCodeAt`, `String.fromCharCode`, `JSON.parse` и типизированный массив.
 *
 * Таблицу менять нельзя без пересборки словаря (`npm run phrases`): тест `tests/phrases.test.mjs` сверяет
 * собранное с документом и заметит расхождение.
 */

/** Что на что меняется: знак из первой строки — на знак с тем же номером из второй, и обратно. */
const FROM = "абвгдежзийклмнопрстуфхцчшщыьэюяё" + "СПНВЯОДКБМТИЗАРХЧУЭЛ" + "\"—«»";
const TO = "abcdefghijklmnopqrstuvwxyzABCDEF" + "GHIJKLMNOPQRSTUVWXYZ" + "#&<>";

const LIMIT = 0x2020;
const TABLE = (() => {
  const table = new Uint16Array(LIMIT);
  for (let code = 0; code < LIMIT; code += 1) table[code] = code;
  for (let index = 0; index < FROM.length; index += 1) {
    const a = FROM.charCodeAt(index), b = TO.charCodeAt(index);
    table[a] = b;
    table[b] = a;
  }
  return table;
})();
const CHUNK = 8192;

/** Знаки таблицы меняются на парные. Вызов дважды возвращает исходный текст. */
export function swap(text) {
  const source = String(text), size = source.length, codes = new Uint16Array(size);
  for (let index = 0; index < size; index += 1) {
    const code = source.charCodeAt(index);
    codes[index] = code < LIMIT ? TABLE[code] : code;
  }
  let out = "";
  for (let index = 0; index < size; index += CHUNK) out += String.fromCharCode.apply(null, codes.subarray(index, index + CHUNK));
  return out;
}

/** Значение → упакованный текст (JSON с переставленными знаками). */
export const pack = (value) => swap(JSON.stringify(value));

/** Упакованный текст → значение. */
export const unpack = (text) => JSON.parse(swap(text));

/** Пары таблицы — для тестов: одинаковой длины и без повторов. */
export const PAIRS = Object.freeze([FROM, TO]);
