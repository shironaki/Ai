/**
 * Умения: список того, что она действительно делает. Пишется человеком в документе
 * SKILLS.txt (корень репозитория) и собирается в data/skills.js командой «npm run skills» —
 * так же, как словарь из PHRASES.txt.
 *
 * «Что ты умеешь» показывает разделы по одной строке, «что ты умеешь: игры» раскрывает один.
 * Модель в этом не участвует: однажды она сама сочинила список команд, которых нет.
 *
 * Документ:
 *   сборка: 0.32.0            — для какой сборки список сверен (тест сравнивает со сборкой кода);
 *   служебное: parseCommand…  — разборы, которые умением не являются;
 *   == [пометки] название ==  — раздел;
 *   слова: игры, игр*         — по каким словам раздел находится («игр*» — начало слова);
 *   коротко: …                — строка раздела в общем списке;
 *   разбор: parseGame, help   — какие разборы и намерения раздел описывает (для теста);
 *   любая другая строка       — строка раздела; в начале могут стоять пометки.
 *
 * Пометки, от которых зависит показ: [хозяин] — хозяину в личке; [группа], [личка];
 * [краски] — есть художник; [секретарь], [сестра]; [ИМЯ] заглавными — настройка не выключена.
 * Пометки для проверки (на показ не влияют): [модель] — отвечает модель; [ответом] — говорится
 * ответом на сообщение; [состояние] — нужна начатая игра и т. п.; [источник] — ответ из сети;
 * [чат] — проверять в группе; [админ] — проверять от имени того, у кого есть права.
 */
const fold = (value) => String(value ?? "").toLowerCase().replace(/ё/gu, "е").replace(/[«»"“”„]/gu, "").replace(/\s+/gu, " ").trim();

export const SHOW_TAGS = Object.freeze(["хозяин", "группа", "личка", "краски", "секретарь", "сестра"]);
export const CHECK_TAGS = Object.freeze(["модель", "ответом", "состояние", "источник", "чат", "админ"]);
const SETTING = /^[A-Z][A-Z0-9_]{2,30}$/u;

function tagsOf(text, errors, where) {
  const found = String(text).match(/^\[([^\]]+)\]\s*/u);
  if (!found) return { tags: [], rest: String(text).trim() };
  const tags = found[1].split(",").map(item => item.trim()).filter(Boolean);
  for (const tag of tags) if (!SHOW_TAGS.includes(tag) && !CHECK_TAGS.includes(tag) && !SETTING.test(tag)) errors.push(`${where}: незнакомая пометка [${tag}]`);
  return { tags, rest: String(text).slice(found[0].length).trim() };
}
const listOf = (text) => String(text).split(",").map(item => item.trim()).filter(Boolean);

/** Текст документа → `{ build, service, sections, errors }`. */
export function parseSkills(text) {
  const errors = [], sections = [];
  let build = "", service = [], current = null;
  String(text ?? "").split(/\r?\n/u).forEach((raw, index) => {
    const line = raw.trim(), where = `строка ${index + 1}`;
    if (!line || line.startsWith("#")) return;
    const head = line.match(/^==\s*(.+?)\s*==$/u);
    if (head) {
      const { tags, rest } = tagsOf(head[1], errors, where);
      if (!rest) errors.push(`${where}: у раздела нет названия`);
      if (sections.some(item => fold(item.name) === fold(rest))) errors.push(`${where}: раздел «${rest}» уже есть`);
      current = { name: rest, tags, words: [], short: "", covers: [], lines: [] };
      sections.push(current);
      return;
    }
    const field = line.match(/^(сборка|служебное|слова|коротко|разбор):\s*(.*)$/u);
    if (field && field[1] === "сборка") { build = field[2].trim(); return; }
    if (field && field[1] === "служебное") { service = [...service, ...listOf(field[2])]; return; }
    if (!current) { errors.push(`${where}: строка вне раздела`); return; }
    if (field && field[1] === "слова") { current.words = [...current.words, ...listOf(field[2]).map(fold)]; return; }
    if (field && field[1] === "коротко") { current.short = field[2].trim(); return; }
    if (field && field[1] === "разбор") { current.covers = [...current.covers, ...listOf(field[2])]; return; }
    const { tags, rest } = tagsOf(line, errors, where);
    if (!rest) { errors.push(`${where}: пометка без слов`); return; }
    if (rest.length > 400) errors.push(`${where}: строка длиннее 400 знаков`);
    current.lines.push({ text: rest, tags });
  });
  if (!/^\d+\.\d+\.\d+$/u.test(build)) errors.push("нет строки «сборка: X.Y.Z»");
  for (const section of sections) {
    if (!section.short) errors.push(`раздел «${section.name}»: нет строки «коротко:»`);
    if (!section.lines.length) errors.push(`раздел «${section.name}»: пуст`);
  }
  // Одно слово — один раздел: иначе «что ты умеешь: игры» открыло бы не то.
  const taken = new Map();
  for (const section of sections) {
    for (const word of [fold(section.name), ...section.words]) {
      if (taken.has(word) && taken.get(word) !== section.name) errors.push(`слово «${word}» — и у раздела «${taken.get(word)}», и у «${section.name}»`);
      taken.set(word, section.name);
    }
  }
  return { build, service, sections, errors };
}

/** Видна ли строка или раздел: `flags` — { хозяин, группа, …, setting(name) }. */
export function shown(tags, flags = {}) {
  for (const tag of tags ?? []) {
    if (SHOW_TAGS.includes(tag) && !flags[tag]) return false;
    if (SETTING.test(tag) && typeof flags.setting === "function" && !flags.setting(tag)) return false;
  }
  return true;
}

/** Раздел по слову человека: название, слово из списка или начало слова («игр*»). */
export function findSkill(sections, word) {
  const asked = fold(word).replace(/[.!?…]+$/u, "").trim();
  if (!asked) return null;
  const fits = (item) => (item.endsWith("*") ? asked.startsWith(item.slice(0, -1)) : asked === item);
  return sections.find(section => fold(section.name) === asked) ?? sections.find(section => section.words.some(fits)) ?? null;
}

const OPENER = "(?:что\\s+(?:ты|вы)\\s+(?:еще\\s+)?(?:умеешь|можешь|умеете|можете)|что\\s+умеешь|твои\\s+(?:умения|возможности)|умения|возможности|помощь|справка)";
/** «Что ты умеешь: игры», «помощь по напоминаниям», «справка игры» → название раздела, иначе null. */
export function parseSkillAsk(value, sections) {
  const text = fold(value).replace(/[.!?…]+$/u, "").trim();
  if (!text || text.length > 80) return null;
  const found = text.match(new RegExp(`^(?:а\\s+)?${OPENER}\\s*(?:[:—–-]\\s*|\\s+)(?:(?:про|о|об|в|во|по|с|со|для|насчет)\\s+)?(.{2,40})$`, "u"));
  if (!found) return null;
  return findSkill(sections, found[1])?.name ?? null;
}

const voice = (text, formal) => String(text).replace(/\{([^{}|]*)\|([^{}|]*)\}/gu, (_, close, polite) => (formal ? polite : close));

/** Общий список: по строке на раздел. */
export function skillsList(sections, flags = {}, { name = "Аи", formal = true } = {}) {
  const rows = sections.filter(section => shown(section.tags, flags)).map(section => `• ${section.name} — ${voice(section.short, formal)}`);
  const sample = sections.find(section => shown(section.tags, flags) && fold(section.name) === "игры") ?? sections.find(section => shown(section.tags, flags));
  return [
    `${name}. Что я умею:`,
    "",
    ...rows,
    "",
    sample ? `Подробно о любом — «что ты умеешь: ${sample.name}» (название из списка).` : "",
    flags["группа"] ? `В группе ${formal ? "зовите" : "зови"} меня по имени, @упоминанием или ответом на моё сообщение.` : "",
  ].filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== "" && index < all.length - 1)).join("\n").trim();
}

/** Один раздел целиком. */
export function skillText(section, flags = {}, { formal = true } = {}) {
  const rows = section.lines.filter(line => shown(line.tags, flags)).map(line => `• ${voice(line.text, formal)}`);
  return [`${section.name[0].toUpperCase()}${section.name.slice(1)}:`, "", ...rows, "", "Весь список — «что ты умеешь»."].join("\n");
}

/** Цельные примеры из строки: то, что в «ёлочках» и без многоточия. Для проверки документа. */
export function examplesOf(text) {
  return [...String(text).matchAll(/«([^«»]{2,120})»/gu)].map(item => item[1].trim()).filter(item => !/…|\.\.\./u.test(item));
}
