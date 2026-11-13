/**
 * Словарный запас: разговор без модели.
 *
 * Фразы лежат в текстовом документе PHRASES.txt в корне проекта; из него
 * командой «npm run phrases» собирается data/phrases.js — его и читает сердце.
 * Модель на «привет», «как дела» и «какой твой любимый цвет» не тратится:
 * реплика узнаётся целиком, ответ берётся из каталога.
 *
 * Правило, которое держит это разговором, а не автоответчиком: фраза должна
 * совпасть вся. «Привет, как решить уравнение?» — не приветствие, и уходит к
 * модели; ошибка в сторону «не узнала» стоит одного запроса, ошибка в сторону
 * «узнала не то» стоит доверия.
 */
import { SECTIONS } from "./data/phrases.js";
import { EXCLUSIVE, clean } from "./catalogue.js";

export { TAGS, parseCatalogue, expandTrigger } from "./catalogue.js";

const LEAD = /^(?:ну|а|и|о|ой|эй|слушай|слушайте|кстати|так|ладно|блин|хм|эх|ах|вот|давай|скажи|скажите|ответь|ответьте|расскажи|расскажите)\s+(?=\S)/u;
const TRAIL = /\s+(?:пожалуйста|плиз|пж|а|же|то|ж|вообще|сейчас|сегодня|там|мне|нам|ка|если не секрет|интересно)$/u;
/** Обёртку вокруг сути можно снять: «ну а как дела-то сегодня» → «как дела». */
function variants(value) {
  const seen = [value];
  let current = value;
  for (let step = 0; step < 4; step += 1) {
    const next = current.replace(LEAD, "").replace(TRAIL, "");
    if (next === current || !next) break;
    seen.push(next);
    current = next;
  }
  return seen;
}

// ── подстановки ───────────────────────────────────────────────────────────
const VAR = /\{([^|{}]+)\}/gu;
/** Подставить имя, форму обращения и переменные. Не хватает переменной — null. */
export function fill(text, { formal = true, name = "", vars = {} } = {}) {
  let missing = false;
  let value = String(text).replace(/\{([^|{}]*)\|([^|{}]*)\}/gu, (_, familiar, polite) => (formal ? polite : familiar));
  if (!name) value = value.replace(/,\s*\{имя\}/gu, "").replace(/\{имя\},\s*/gu, "");
  value = value.replace(VAR, (_, key) => {
    if (key === "имя") return name;
    const found = vars[key];
    if (found == null || found === "") { missing = true; return ""; }
    return String(found);
  });
  return missing ? null : value.replace(/[ \t]{2,}/gu, " ").trim();
}

/** Время суток по часу: для пометок «утро», «день», «вечер», «ночь». */
export const partOfDay = (hour) => (hour < 5 ? "ночь" : hour < 12 ? "утро" : hour < 18 ? "день" : hour < 23 ? "вечер" : "ночь");

export function createPhrasebook({ sections = SECTIONS, random = Math.random } = {}) {
  const byName = new Map(), exact = new Map();
  let compiled = null;
  for (const section of sections) {
    byName.set(section.n, section);
    for (const plain of section.w ?? []) if (!exact.has(plain)) exact.set(plain, section.n);
  }
  const patterns = () => (compiled ??= sections.flatMap(section => (section.p ?? []).map(source => [new RegExp(source, "u"), section.n])));

  function lookup(value) {
    for (const candidate of variants(value)) {
      const found = exact.get(candidate);
      if (found) return found;
      const spaced = `${candidate} `;
      for (const [pattern, name] of patterns()) if (pattern.test(spaced)) return name;
    }
    return null;
  }

  /** Реплика целиком → названия тем по порядку, или null: это не из словаря. */
  function match(text) {
    const raw = String(text ?? "").trim();
    if (!raw || raw.length > 140) return null;
    const whole = clean(raw);
    if (!whole) return null;
    const single = lookup(whole);
    if (single) return [single];
    // «Привет! Как дела?» — две темы подряд. Узнаны должны быть все части.
    const parts = raw.split(/[.!?;,]+|\s+[—–]\s+/u).map(clean).filter(Boolean);
    if (parts.length < 2 || parts.length > 3) return null;
    const names = [];
    for (const part of parts) {
      const name = lookup(part);
      if (!name) return null;
      if (names.at(-1) !== name) names.push(name);
    }
    return names;
  }

  const fits = (tag, ctx) => (
    tag === "хозяин" ? ctx.owner === true
      : tag === "не хозяин" ? ctx.owner !== true
        : tag === "близко" ? ctx.owner === true || ctx.level === "close"
          : tag === "тепло" ? ctx.owner === true || ctx.level === "close" || ctx.level === "warm"
            : tag === "знакомы" ? ctx.level === "first"
              : tag === "холодно" ? ctx.level === "cold" && ctx.owner !== true
                : tag === "личка" ? ctx.isPrivate === true
                  : tag === "группа" ? ctx.isPrivate !== true
                    : tag === "флирт" ? ctx.flirt === true
                      : tag === ctx.part);

  /** Одна строка темы под человека и час. `avoid` — что уже звучало: не повторяться. */
  function pick(name, ctx = {}, { avoid = "" } = {}) {
    const section = byName.get(String(name).toLowerCase());
    if (!section) return null;
    let pool = [];
    for (const [tagText, body] of section.l) {
      const tags = tagText ? tagText.split(",") : [];
      if (!tags.every(tag => fits(tag, ctx))) continue;
      const text = fill(body, ctx);
      if (text == null || !text) continue;
      pool.push({ text, weight: 1 + 3 * tags.length, exclusive: tags.includes(EXCLUSIVE) });
    }
    if (pool.some(item => item.exclusive)) pool = pool.filter(item => item.exclusive);
    if (pool.length > 1 && avoid) pool = pool.filter(item => item.text !== avoid).length ? pool.filter(item => item.text !== avoid) : pool;
    if (!pool.length) return null;
    let roll = Math.min(0.999999, Math.max(0, Number(random()) || 0)) * pool.reduce((sum, item) => sum + item.weight, 0);
    for (const item of pool) { roll -= item.weight; if (roll < 0) return item.text; }
    return pool.at(-1).text;
  }

  /** Все строки запаса как есть (для манер и канона): без пометок и подстановок имени. */
  function pool(name, ctx = {}) {
    const section = byName.get(String(name).toLowerCase());
    return section ? section.l.map(([, body]) => fill(body, ctx)).filter(Boolean) : [];
  }

  /** Ответ на реплику из нескольких тем: по строке на тему, одной репликой. */
  function say(names, ctx = {}, options = {}) {
    const out = [];
    for (const name of names) {
      const line = pick(name, ctx, options);
      if (line) out.push(line);
    }
    return out.length ? out.join(" ") : null;
  }

  const stats = () => ({
    sections: sections.filter(section => !section.n.startsWith("+")).length,
    pools: sections.filter(section => section.n.startsWith("+")).length,
    triggers: sections.reduce((sum, section) => sum + (section.w?.length ?? 0) + (section.p?.length ?? 0), 0),
    lines: sections.reduce((sum, section) => sum + section.l.length, 0),
  });

  return Object.freeze({ match, pick, pool, say, stats, has: (name) => byName.has(String(name).toLowerCase()), names: () => [...byName.keys()] });
}
