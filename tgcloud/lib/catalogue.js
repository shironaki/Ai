/**
 * Формат словарного запаса: как читается документ PHRASES.txt.
 * Отдельно от самого словаря — чтобы сборщик мог прочитать документ, когда
 * собранного файла ещё нет.
 */
/** Пометки строк: кому и когда строка подходит. */
export const TAGS = Object.freeze(["хозяин", "не хозяин", "близко", "тепло", "знакомы", "холодно", "утро", "день", "вечер", "ночь", "личка", "группа", "флирт"]);
/** Пометка, при которой остальные строки темы не используются: холодному — только холодные. */
export const EXCLUSIVE = "холодно";

export const clean = (text) => String(text ?? "").toLowerCase().replace(/ё/gu, "е")
  .replace(/[^a-zа-я0-9\s-]/gu, " ").replace(/-(?:то|ка)(?=\s|$)/gu, "").replace(/(^|\s)-+|-+(?=\s|$)/gu, "$1").replace(/\s+/gu, " ").trim();

// ── разбор документа ──────────────────────────────────────────────────────
const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** «как (у тебя) дела/делишки» → все простые варианты; со «*» — образец. */
export function expandTrigger(trigger) {
  const value = String(trigger ?? "").toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
  if (!value) return { plain: [], pattern: "" };
  const parts = [];
  for (const piece of value.match(/\([^)]*\)|\S+/gu) ?? []) {
    if (piece === "*") { parts.push({ star: true }); continue; }
    const optional = piece.startsWith("(") && piece.endsWith(")");
    const options = (optional ? piece.slice(1, -1) : piece).split("/").map(item => clean(item)).filter(Boolean);
    if (!options.length) continue;
    parts.push({ options: optional ? ["", ...options] : options });
  }
  if (parts.some(part => part.star)) {
    const body = parts.map(part => (part.star ? "(?:\\S+ ){0,4}" : `(?:${part.options.map(item => (item ? `${escapeRe(item)} ` : "")).join("|")})`)).join("");
    return { plain: [], pattern: `^${body}$` };
  }
  let list = [""];
  for (const part of parts) {
    const next = [];
    for (const head of list) for (const option of part.options) next.push(option ? (head ? `${head} ${option}` : option) : head);
    list = next;
    if (list.length > 400) return { plain: [], pattern: "", error: "слишком много вариантов" };
  }
  return { plain: [...new Set(list.filter(Boolean))], pattern: "" };
}

/**
 * Документ → темы. Возвращает `{ sections, errors }`; ошибки — с номером
 * строки и по-русски: документ правит человек, а не программа.
 */
export function parseCatalogue(text) {
  const sections = [], errors = [];
  const names = new Map(), owners = new Map();
  let current = null;
  const lines = String(text ?? "").replace(/^\uFEFF/u, "").split(/\r?\n/u);
  lines.forEach((raw, index) => {
    const line = raw.trim(), at = index + 1;
    if (!line || line.startsWith("#")) return;
    const head = line.match(/^==\s*(.+?)\s*==$/u);
    if (head) {
      const name = head[1].toLowerCase().replace(/ё/gu, "е");
      if (names.has(name)) errors.push(`строка ${at}: тема «${name}» уже есть в строке ${names.get(name)}`);
      names.set(name, at);
      current = { name, at, plain: [], patterns: [], lines: [] };
      sections.push(current);
      return;
    }
    if (!current) { errors.push(`строка ${at}: фраза вне темы — перед ней нужна строка «== название ==»`); return; }
    const when = line.match(/^когда\s*:\s*(.*)$/iu);
    if (when) {
      if (current.name.startsWith("+")) { errors.push(`строка ${at}: у запаса «${current.name}» не бывает строки «когда:» — его берёт программа`); return; }
      for (const trigger of when[1].split(",").map(item => item.trim()).filter(Boolean)) {
        const made = expandTrigger(trigger);
        if (made.error) { errors.push(`строка ${at}: «${trigger}» — ${made.error}`); continue; }
        if (made.pattern) current.patterns.push(made.pattern);
        for (const plain of made.plain) {
          const other = owners.get(plain);
          if (other && other !== current.name) errors.push(`строка ${at}: «${plain}» уже ведёт в тему «${other}»`);
          else if (!other) { owners.set(plain, current.name); current.plain.push(plain); }
        }
      }
      return;
    }
    const tagged = line.match(/^\[([^\]]*)\]\s*(.*)$/u);
    const tags = tagged ? tagged[1].split(",").map(item => item.trim().toLowerCase()).filter(Boolean) : [];
    const body = (tagged ? tagged[2] : line).replace(/\\n/gu, "\n").trim();
    for (const tag of tags) if (!TAGS.includes(tag)) errors.push(`строка ${at}: пометки «${tag}» нет; есть: ${TAGS.join(", ")}`);
    if (!body) { errors.push(`строка ${at}: пустая фраза`); return; }
    if (body.length > 600) errors.push(`строка ${at}: фраза длиннее 600 знаков`);
    if ((body.match(/\{/gu) ?? []).length !== (body.match(/\}/gu) ?? []).length) errors.push(`строка ${at}: непарная фигурная скобка`);
    current.lines.push([tags.join(","), body]);
  });
  for (const section of sections) {
    if (!section.lines.length) errors.push(`строка ${section.at}: в теме «${section.name}» нет ни одной фразы`);
    if (!section.name.startsWith("+") && !section.plain.length && !section.patterns.length) errors.push(`строка ${section.at}: у темы «${section.name}» нет строки «когда:» — её никто не вызовет`);
  }
  return { sections: sections.map(({ name, plain, patterns, lines: list }) => ({ n: name, w: plain, p: patterns, l: list })), errors };
}
