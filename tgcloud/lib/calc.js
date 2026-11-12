/**
 * Точный счёт: арифметику делает код, а не модель.
 *
 * Языковая модель считает на глаз: «17 × 23» она скорее вспомнит, чем
 * вычислит, а на длинных числах ошибается уверенным тоном. Здесь выражение
 * разбирается и считается по правилам — целые числа точно, сколько бы в них
 * ни было цифр, дроби с двенадцатью значащими.
 *
 * Понимает: + − × ÷, скобки, степень, проценты («15% от 2300», «2300 + 15%»),
 * корень, факториал и слова: «плюс», «умножить на», «в квадрате».
 * `eval` здесь нет и быть не может: текст приходит от людей.
 */

const TRIGGER = /^(?:(?:а\s+)?(?:сколько\s+(?:будет|это|получится|выйдет|составит)|посчитай(?:те)?|подсчитай(?:те)?|вычисли(?:те)?|рассчитай(?:те)?|реши(?:те)?|чему\s+(?:равно|равняется|будет\s+равно)|калькулятор|сосчитай(?:те)?)\s*[:,—-]?\s*)/u;
const WORD_OP = /(?:плюс|минус|умножить\s+на|умножь\s+на|помножить\s+на|разделить\s+на|раздели\s+на|делить\s+на|поделить\s+на|в\s+степени|в\s+квадрате|в\s+кубе|корень\s+из|процент(?:а|ов)?\s+от|%\s*от)/u;
const BARE = /^[\d\s.,+\-*/^()%!×÷:xх·=?−–]+$/u;

/** «5 тысяч» → 5000: множитель раскрывается сразу, без двоичного хвоста. */
const scaled = (n, k) => String(Number((Number(n) * k).toPrecision(12)));

/** Слова и значки — к одному письму: цифры, + - * / ^ ( ) % ! и sqrt. */
function toSymbols(input) {
  let text = ` ${String(input ?? "").toLowerCase().replace(/ё/gu, "е")} `;
  text = text
    .replace(/[−–—]/gu, "-")
    .replace(/[×·]/gu, "*")
    .replace(/÷/gu, "/")
    .replace(/(\d)\s*[xх]\s*(?=[\d(])/gu, "$1*")
    .replace(/\)\s*[xх]\s*(?=[\d(])/gu, ")*")
    .replace(/(\d)\s*:\s*(?=\d)/gu, "$1/")
    .replace(/\s(?:умножить|умножь|помножить)\s+на\s/gu, " * ")
    .replace(/\s(?:разделить|раздели|делить|поделить|подели)\s+на\s/gu, " / ")
    .replace(/\sплюс\s/gu, " + ")
    .replace(/\sминус\s/gu, " - ")
    .replace(/\sв\s+степени\s/gu, " ^ ")
    .replace(/\sв\s+квадрате\s/gu, " ^2 ")
    .replace(/\sв\s+кубе\s/gu, " ^3 ")
    .replace(/\s(?:квадратный\s+)?корень\s+из\s/gu, " sqrt ")
    .replace(/\sпроцент(?:а|ов)?(?=\s)/gu, "%")
    // «15% от 2300» — это умножение на долю; значок помнит, что сказано «от».
    .replace(/%\s*от\s/gu, "% @ ")
    // Тысячи через пробел и запятая как десятичный знак.
    .replace(/(\d)[\s\u00a0\u202f](?=\d{3}(?!\d))/gu, "$1")
    .replace(/(\d),(?=\d)/gu, "$1.")
    .replace(/(\d+(?:\.\d+)?)\s*(?:тыс(?:яч[аи]?|\.)?)(?=[\s)+\-*/^%@]|$)/gu, (_, n) => scaled(n, 1e3))
    .replace(/(\d+(?:\.\d+)?)\s*(?:млн\.?|миллион(?:а|ов)?)(?=[\s)+\-*/^%@]|$)/gu, (_, n) => scaled(n, 1e6))
    .replace(/(\d+(?:\.\d+)?)\s*(?:млрд\.?|миллиард(?:а|ов)?)(?=[\s)+\-*/^%@]|$)/gu, (_, n) => scaled(n, 1e9));
  return text.replace(/[=?]+\s*$/u, "").replace(/\s(?:равно|будет)\s*$/u, "").trim();
}

function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/u.test(ch)) { i++; continue; }
    if (/\d/u.test(ch) || (ch === "." && /\d/u.test(text[i + 1] ?? ""))) {
      const match = text.slice(i).match(/^\d*\.?\d+(?:e[+-]?\d+)?|^\d+\.?/u);
      if (!match) return null;
      tokens.push({ type: "num", raw: match[0].replace(/\.$/u, "") });
      i += match[0].length;
      continue;
    }
    if (text.startsWith("sqrt", i)) { tokens.push({ type: "sqrt" }); i += 4; continue; }
    if (ch === "@") { tokens.push({ type: "*", of: true }); i++; continue; }
    if ("+-*/^()%!".includes(ch)) { tokens.push({ type: ch }); i++; continue; }
    return null;
  }
  return tokens;
}

const MAX_DIGITS = 600;
class CalcError extends Error { constructor(code) { super(code); this.code = code; } }

/** Число в двух видах: точное целое, если оно целое, и обычное. */
const whole = (big) => ({ big, num: Number(big), pct: false });
const real = (num) => {
  if (!Number.isFinite(num)) throw new CalcError("too_big");
  return { big: Number.isInteger(num) && Math.abs(num) <= Number.MAX_SAFE_INTEGER ? BigInt(num) : null, num, pct: false };
};
const digits = (big) => (big < 0n ? -big : big).toString().length;

function power(base, exp) {
  if (base.big != null && exp.big != null && exp.big >= 0n && exp.big <= 4096n) {
    if (digits(base.big) * Number(exp.big) > MAX_DIGITS) throw new CalcError("too_big");
    return whole(base.big ** exp.big);
  }
  return real(base.num ** exp.num);
}

function factorial(value) {
  if (value.big == null || value.big < 0n) throw new CalcError("syntax");
  if (value.big > 300n) throw new CalcError("too_big");
  let out = 1n;
  for (let k = 2n; k <= value.big; k++) out *= k;
  return whole(out);
}

function root(value) {
  if (value.num < 0) throw new CalcError("negative_root");
  if (value.big != null) {
    // Целый корень из целого — точно: метод Ньютона на больших числах.
    let x = BigInt(Math.floor(Math.sqrt(value.num)));
    while (x * x > value.big) x--;
    while ((x + 1n) * (x + 1n) <= value.big) x++;
    if (x * x === value.big) return whole(x);
  }
  return real(Math.sqrt(value.num));
}

function evaluate(tokens) {
  let at = 0;
  const peek = () => tokens[at]?.type;
  const take = (type) => { if (peek() !== type) throw new CalcError("syntax"); return tokens[at++]; };
  const plain = (value) => (value.pct ? real(value.num / 100) : value);

  function primary() {
    const token = tokens[at];
    if (!token) throw new CalcError("syntax");
    if (token.type === "num") {
      at++;
      return /^\d+$/u.test(token.raw) && token.raw.length <= MAX_DIGITS ? whole(BigInt(token.raw)) : real(Number(token.raw));
    }
    if (token.type === "(") { at++; const inner = expression(); take(")"); return inner; }
    if (token.type === "sqrt") { at++; return root(plain(unary())); }
    throw new CalcError("syntax");
  }
  function postfix() {
    let value = primary();
    for (;;) {
      if (peek() === "!") { at++; value = factorial(plain(value)); continue; }
      if (peek() === "%") { at++; value = { ...plain(value), pct: true }; continue; }
      return value;
    }
  }
  function unary() {
    if (peek() === "-") { at++; const value = unary(); return value.big != null ? { ...whole(-value.big), pct: value.pct } : { ...real(-value.num), pct: value.pct }; }
    if (peek() === "+") { at++; return unary(); }
    const base = postfix();
    if (peek() === "^") { at++; return power(plain(base), plain(unary())); }
    return base;
  }
  function term() {
    let left = unary();
    while (peek() === "*" || peek() === "/") {
      const op = tokens[at++].type;
      const right = plain(unary());
      left = plain(left);
      if (op === "*") {
        left = left.big != null && right.big != null ? whole(left.big * right.big) : real(left.num * right.num);
        if (left.big != null && digits(left.big) > MAX_DIGITS) throw new CalcError("too_big");
      } else {
        if (right.num === 0) throw new CalcError("div_zero");
        left = left.big != null && right.big != null && left.big % right.big === 0n ? whole(left.big / right.big) : real(left.num / right.num);
      }
    }
    return left;
  }
  function expression() {
    let left = term();
    while (peek() === "+" || peek() === "-") {
      const op = tokens[at++].type;
      let right = term();
      left = plain(left);
      // «2300 + 15%» — прибавить пятнадцать процентов от левого числа.
      if (right.pct) right = real(left.num * right.num / 100);
      if (left.big != null && right.big != null) left = whole(op === "+" ? left.big + right.big : left.big - right.big);
      else left = real(op === "+" ? left.num + right.num : left.num - right.num);
    }
    return left;
  }

  const value = plain(expression());
  if (at !== tokens.length) throw new CalcError("syntax");
  return value;
}

const group = (text) => text.replace(/\B(?=(\d{3})+(?!\d))/gu, "\u202f");

/** Число словами цифр: тысячи разделены, десятичный знак — запятая. */
export function formatNumber(value) {
  if (value.big != null) {
    const text = value.big.toString();
    return text.replace(/^(-?)(\d+)$/u, (_, sign, body) => `${sign ? "−" : ""}${body.length > 4 ? group(body) : body}`);
  }
  const rounded = Number(value.num.toPrecision(12));
  if (!Number.isFinite(rounded)) return String(value.num);
  let text = String(rounded);
  if (/e/iu.test(text)) return text.replace(".", ",").replace(/e\+?/iu, " × 10^").replace(/^-/u, "−");
  const [whole_, frac = ""] = text.replace(/^-/u, "").split(".");
  text = `${whole_.length > 4 ? group(whole_) : whole_}${frac ? `,${frac}` : ""}`;
  return rounded < 0 ? `−${text}` : text;
}

/** Выражение так, как его пишут люди: × вместо *, запятая вместо точки. */
function pretty(tokens) {
  const out = [];
  tokens.forEach((token, index) => {
    const prev = tokens[index - 1]?.type;
    if (token.type === "num") {
      const [whole_, frac] = token.raw.split(".");
      out.push(`${whole_.length > 4 ? group(whole_) : whole_}${frac != null ? `,${frac}` : ""}`);
    } else if (token.type === "sqrt") out.push("√");
    else if (token.type === "(" || token.type === ")" || token.type === "!" || token.type === "%" || token.type === "^") out.push(token.type);
    else {
      const sign = token.of ? "от" : ({ "*": "×", "/": "÷", "-": "−", "+": "+" })[token.type];
      // Унарный минус пишется слитно с числом.
      const unary = prev == null || ["(", "+", "-", "*", "/", "^", "sqrt"].includes(prev);
      out.push(unary ? sign : ` ${sign} `);
    }
  });
  return out.join("").replace(/\s+/gu, " ").replace(/\( /gu, "(").trim();
}

/**
 * Посчитать, если это счёт. `null` — это не выражение (обычная фраза);
 * `{ ok: false, code }` — выражение, но посчитать нельзя: деление на ноль,
 * слишком большое число.
 */
export function calculate(input) {
  let source = String(input ?? "").toLowerCase().replace(/ё/gu, "е")
    // Вежливость — не часть примера: «посчитай, пожалуйста, 2+2».
    .replace(/(?:^|[\s,])(?:пожалуйста|плиз|пж)(?=[\s,?!.]|$)[,]?/gu, " ")
    .replace(/\s+/gu, " ").trim().replace(/[.…]+$/u, "");
  // «5!» — факториал, «2+2!» — восклицание: знак остаётся только за одиноким числом.
  if (!/(?:^|\s)\d+!$/u.test(source)) source = source.replace(/[!.…]+$/u, "");
  if (!source || source.length > 240 || !/\d/u.test(source)) return null;
  const triggered = TRIGGER.test(source);
  let body = (triggered ? source.replace(TRIGGER, "") : source).replace(/^[\s,:—-]+/u, "");

  // «Сколько процентов составляет 30 от 120» — отдельный вопрос: доля.
  const share = body.match(/^(?:сколько\s+)?процентов\s+(?:составля[ею]т\s+)?(\d[\d\s.,]*?)\s+от\s+(\d[\d\s.,]*?)\??$/u);
  if (share) body = `(${share[1]}) / (${share[2]}) * 100`;

  if (!triggered && !share) {
    const bare = BARE.test(body);
    if (!bare && !WORD_OP.test(body)) return null;
    if (bare) {
      const asked = /[=?]\s*$/u.test(body);
      const inner = body.replace(/^[\s+\-−–]+/u, "").replace(/[=?\s]+$/u, "");
      // Телефон, диапазон «10-12» и время «12:30» — не примеры.
      const strong = /[+*/^×÷·!%]|\d\s*[xх]\s*\d|\(/u.test(inner);
      if (!strong && !asked) return null;
      if (!/[+\-−–*/^×÷·:xх!%]/u.test(inner)) return null;
    }
  }

  const tokens = tokenize(toSymbols(body));
  if (!tokens || !tokens.length) return null;
  // Одно число — не пример; «сколько будет 5» тоже. Без слова-просьбы нужен
  // настоящий знак действия: «50%» в ответ на вопрос — не пример.
  const acts = tokens.filter(token => ["+", "-", "*", "/", "^", "sqrt"].includes(token.type)).length;
  const marks = tokens.filter(token => token.type === "!" || token.type === "%").length;
  if (!acts && !(triggered && marks)) return null;
  // Слова после разбора остаться не должны: «посчитай 5 яблок» — не пример.
  try {
    const value = evaluate(tokens);
    const text = formatNumber(value);
    if (share) return { ok: true, value: text, expr: `${share[1].trim()} от ${share[2].trim()}`, text: `${text}%`, line: `${share[1].trim()} от ${share[2].trim()} — это ${text}%` };
    const expr = pretty(tokens);
    return { ok: true, value: text, expr, text, line: `${expr} = ${text}` };
  } catch (error) {
    if (error instanceof CalcError) {
      if (error.code === "syntax") return triggered || share ? { ok: false, code: "syntax" } : null;
      return { ok: false, code: error.code };
    }
    return null;
  }
}
