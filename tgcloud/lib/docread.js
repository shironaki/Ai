/**
 * Документы без библиотек: Word (docx), OpenDocument (odt), PDF, FB2, RTF, EPUB — в текст.
 *
 * До 0.34.0 «выучи» брало только текстовые файлы, а на PDF и Word отвечало «скопируйте
 * текст в сообщение». На платформе нет ни библиотек, ни распаковки, поэтому всё здесь
 * своё: распаковка deflate (RFC 1951), разбор ZIP, XML — выборкой нужных тегов, PDF —
 * объекты, шрифты (ToUnicode, кодировки, ширины) и операторы текста.
 *
 * Чего модуль не умеет и говорит об этом кодом, а не пустой строкой:
 *   `empty`     — текста нет: скан (страницы — картинки) или шрифты без таблицы букв;
 *   `encrypted` — PDF закрыт паролем или правами;
 *   `broken`    — файл не разобрался;
 *   `too_big`   — распакованное больше предела;
 *   `format`    — такого вида файлов здесь нет (старый .doc, таблицы, презентации).
 *
 * Модуль не знает ни Telegram, ни хранилища: байты на входе, текст на выходе.
 */

// ── байты и строки ──────────────────────────────────────────────────────────
/** Байты → строка «байт в знак»: так удобно искать по двоичному файлу. */
export function latin1(bytes, from = 0, to = bytes.length) {
  let out = "";
  for (let i = from; i < to; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(to, i + 8192)));
  return out;
}
const fromCodes = (codes) => { let out = ""; for (let i = 0; i < codes.length; i += 8192) out += String.fromCharCode.apply(null, codes.slice(i, i + 8192)); return out; };

/** UTF-8 → строка; `null`, если это не UTF-8 (тогда пробуется другая кодировка). */
export function utf8Strict(bytes, from = 0, to = bytes.length) {
  let out = "", chunk = [];
  for (let i = from; i < to;) {
    const a = bytes[i];
    let code = a, size = 1;
    if (a >= 0x80) {
      if (a >= 0xC2 && a < 0xE0) { size = 2; code = a & 0x1F; } else if (a >= 0xE0 && a < 0xF0) { size = 3; code = a & 0x0F; } else if (a >= 0xF0 && a < 0xF5) { size = 4; code = a & 0x07; } else return null;
      if (i + size > to) return null;
      for (let k = 1; k < size; k += 1) { const b = bytes[i + k]; if ((b & 0xC0) !== 0x80) return null; code = (code << 6) | (b & 0x3F); }
      if ((size === 3 && code < 0x800) || (size === 4 && (code < 0x10000 || code > 0x10FFFF)) || (code >= 0xD800 && code <= 0xDFFF)) return null;
    }
    i += size;
    if (code > 0xFFFF) { code -= 0x10000; chunk.push(0xD800 + (code >> 10), 0xDC00 + (code & 0x3FF)); } else chunk.push(code);
    if (chunk.length >= 4096) { out += String.fromCharCode.apply(null, chunk); chunk = []; }
  }
  return out + String.fromCharCode.apply(null, chunk);
}

/** Windows-1251, старшая половина: 0x80–0xBF по таблице, 0xC0–0xFF — «А»…«я» подряд. */
const CP1251_HIGH = [
  0x0402, 0x0403, 0x201A, 0x0453, 0x201E, 0x2026, 0x2020, 0x2021, 0x20AC, 0x2030, 0x0409, 0x2039, 0x040A, 0x040C, 0x040B, 0x040F,
  0x0452, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x0098, 0x2122, 0x0459, 0x203A, 0x045A, 0x045C, 0x045B, 0x045F,
  0x00A0, 0x040E, 0x045E, 0x0408, 0x00A4, 0x0490, 0x00A6, 0x00A7, 0x0401, 0x00A9, 0x0404, 0x00AB, 0x00AC, 0x00AD, 0x00AE, 0x0407,
  0x00B0, 0x00B1, 0x0406, 0x0456, 0x0491, 0x00B5, 0x00B6, 0x00B7, 0x0451, 0x2116, 0x0454, 0x00BB, 0x0458, 0x0405, 0x0455, 0x0457,
];
const cp1251Code = (byte) => (byte < 0x80 ? byte : byte < 0xC0 ? CP1251_HIGH[byte - 0x80] : 0x0410 + byte - 0xC0);
export function cp1251(bytes, from = 0, to = bytes.length) {
  const codes = new Array(to - from);
  for (let i = from; i < to; i += 1) codes[i - from] = cp1251Code(bytes[i]);
  return fromCodes(codes);
}
/** Windows-1252 (WinAnsi), где она расходится с Latin-1. */
const CP1252_HIGH = { 0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178 };

/**
 * Текстовый файл → строка. Метка порядка байт решает сразу; иначе UTF-8, а если байты им
 * не являются — Windows-1251: так сохраняет «Блокнот» на русской Windows.
 */
export function decodeText(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return utf8Strict(bytes, 3) ?? cp1251(bytes, 3);
  if (bytes.length >= 2 && ((bytes[0] === 0xFF && bytes[1] === 0xFE) || (bytes[0] === 0xFE && bytes[1] === 0xFF))) {
    const little = bytes[0] === 0xFF, codes = [];
    for (let i = 2; i + 1 < bytes.length; i += 2) codes.push(little ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1]);
    return fromCodes(codes);
  }
  return utf8Strict(bytes) ?? cp1251(bytes);
}

// ── распаковка deflate ──────────────────────────────────────────────────────
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
/** Таблица кода Хаффмана по длинам: сколько кодов каждой длины и символы по порядку. */
function huffman(lengths, offset, n) {
  const count = new Uint16Array(16), offs = new Uint16Array(16), symbol = new Uint16Array(n);
  for (let sym = 0; sym < n; sym += 1) count[lengths[offset + sym]] += 1;
  for (let len = 1; len < 15; len += 1) offs[len + 1] = offs[len] + count[len];
  for (let sym = 0; sym < n; sym += 1) { const len = lengths[offset + sym]; if (len !== 0) symbol[offs[len]++] = sym; }
  return { count, symbol };
}
let FIXED = null;
function fixedTables() {
  if (FIXED) return FIXED;
  const lengths = new Uint8Array(288 + 30);
  for (let i = 0; i < 144; i += 1) lengths[i] = 8;
  for (let i = 144; i < 256; i += 1) lengths[i] = 9;
  for (let i = 256; i < 280; i += 1) lengths[i] = 7;
  for (let i = 280; i < 288; i += 1) lengths[i] = 8;
  for (let i = 288; i < 318; i += 1) lengths[i] = 5;
  FIXED = { len: huffman(lengths, 0, 288), dist: huffman(lengths, 288, 30) };
  return FIXED;
}

/**
 * Распаковать «сырой» deflate. `limit` — предел результата в байтах: архив в килобайт
 * может развернуться в гигабайт, и без предела это способ положить обработчик.
 */
export function inflateRaw(input, { limit = 32 * 1024 * 1024 } = {}) {
  let pos = 0, bitBuf = 0, bitCnt = 0, n = 0;
  let out = new Uint8Array(Math.min(limit, Math.max(4096, input.length * 3)));
  const room = (extra) => {
    if (n + extra <= out.length) return;
    if (n + extra > limit) throw new Error("too big");
    const next = new Uint8Array(Math.min(limit, Math.max(out.length * 2, n + extra)));
    next.set(out.subarray(0, n));
    out = next;
  };
  const bits = (need) => {
    let value = bitBuf;
    while (bitCnt < need) {
      if (pos >= input.length) throw new Error("short deflate");
      value |= input[pos++] << bitCnt;
      bitCnt += 8;
    }
    bitBuf = value >>> need;
    bitCnt -= need;
    return value & ((1 << need) - 1);
  };
  const decode = (table) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len <= 15; len += 1) {
      code |= bits(1);
      const count = table.count[len];
      if (code - count < first) return table.symbol[index + (code - first)];
      index += count; first += count; first <<= 1; code <<= 1;
    }
    throw new Error("bad deflate code");
  };
  let last = 0;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;
      if (pos + 4 > input.length) throw new Error("short deflate");
      const len = input[pos] | (input[pos + 1] << 8), inverse = input[pos + 2] | (input[pos + 3] << 8);
      pos += 4;
      if ((len ^ 0xFFFF) !== inverse || pos + len > input.length) throw new Error("bad stored block");
      room(len);
      out.set(input.subarray(pos, pos + len), n);
      n += len; pos += len;
      continue;
    }
    let lenTable, distTable;
    if (type === 1) ({ len: lenTable, dist: distTable } = fixedTables());
    else if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      if (nlen > 286 || ndist > 30) throw new Error("bad deflate header");
      const short = new Uint8Array(19);
      for (let i = 0; i < ncode; i += 1) short[CL_ORDER[i]] = bits(3);
      const codes = huffman(short, 0, 19), lengths = new Uint8Array(nlen + ndist);
      for (let index = 0; index < nlen + ndist;) {
        const sym = decode(codes);
        if (sym < 16) { lengths[index++] = sym; continue; }
        let value = 0, repeat = 0;
        if (sym === 16) { if (index === 0) throw new Error("bad deflate lengths"); value = lengths[index - 1]; repeat = 3 + bits(2); } else if (sym === 17) repeat = 3 + bits(3); else repeat = 11 + bits(7);
        if (index + repeat > nlen + ndist) throw new Error("bad deflate lengths");
        while (repeat--) lengths[index++] = value;
      }
      if (lengths[256] === 0) throw new Error("no end code");
      lenTable = huffman(lengths, 0, nlen);
      distTable = huffman(lengths, nlen, ndist);
    } else throw new Error("bad deflate block");
    for (;;) {
      let sym = decode(lenTable);
      if (sym < 256) { room(1); out[n++] = sym; continue; }
      if (sym === 256) break;
      sym -= 257;
      if (sym >= 29) throw new Error("bad deflate length");
      const len = LEN_BASE[sym] + bits(LEN_EXTRA[sym]);
      const far = decode(distTable);
      if (far >= 30) throw new Error("bad deflate distance");
      const dist = DIST_BASE[far] + bits(DIST_EXTRA[far]);
      if (dist > n) throw new Error("bad deflate distance");
      room(len);
      for (let i = 0; i < len; i += 1, n += 1) out[n] = out[n - dist];
    }
  } while (!last);
  return out.subarray(0, n);
}

/** zlib (заголовок в два байта, потом deflate). Заголовка нет — пробуется как «сырой». */
export function inflate(input, options) {
  const wrapped = input.length > 2 && (input[0] & 0x0F) === 8 && ((input[0] << 8) | input[1]) % 31 === 0;
  return inflateRaw(wrapped ? input.subarray(2) : input, options);
}

// ── ZIP ─────────────────────────────────────────────────────────────────────
/** Оглавление архива: `[{ name, method, csize, usize, local, encrypted }]` или null, если это не ZIP. */
export function zipEntries(bytes) {
  if (bytes.length < 22) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65535; i -= 1) if (view.getUint32(i, true) === 0x06054B50) { end = i; break; }
  if (end < 0) return null;
  const total = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = [];
  for (let i = 0; i < total && at + 46 <= bytes.length; i += 1) {
    if (view.getUint32(at, true) !== 0x02014B50) break;
    const nameLen = view.getUint16(at + 28, true), extraLen = view.getUint16(at + 30, true), commentLen = view.getUint16(at + 32, true);
    out.push({
      name: utf8Strict(bytes, at + 46, at + 46 + nameLen) ?? latin1(bytes, at + 46, at + 46 + nameLen),
      method: view.getUint16(at + 10, true), csize: view.getUint32(at + 20, true), usize: view.getUint32(at + 24, true),
      local: view.getUint32(at + 42, true), encrypted: Boolean(view.getUint16(at + 8, true) & 1),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
/** Содержимое одной записи архива. */
export function zipRead(bytes, entry, { limit = 32 * 1024 * 1024 } = {}) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.local;
  if (entry.encrypted) throw new Error("encrypted");
  if (at + 30 > bytes.length || view.getUint32(at, true) !== 0x04034B50) throw new Error("bad zip");
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const data = bytes.subarray(start, start + entry.csize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRaw(data, { limit });
  throw new Error("bad zip method");
}
const zipText = (bytes, entries, name, options) => {
  const entry = entries.find(item => item.name === name);
  if (!entry) return null;
  const data = zipRead(bytes, entry, options);
  return utf8Strict(data) ?? cp1251(data);
};

// ── XML: без разбора дерева, выборкой ───────────────────────────────────────
const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00A0", laquo: "«", raquo: "»", mdash: "—", ndash: "–", hellip: "…", copy: "©", reg: "®", trade: "™",
  deg: "°", sect: "§", bull: "•", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", bdquo: "„", euro: "€", times: "×", minus: "−", plusmn: "±", shy: "", thinsp: " ", ensp: " ", emsp: " ", middot: "·",
};
export const unescapeXml = (text) => String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, name) => {
  if (name[0] === "#") { const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1)); return Number.isFinite(code) && code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : ""; }
  return ENTITIES[name.toLowerCase()] ?? whole;
});
const stripTags = (xml) => unescapeXml(String(xml).replace(/<[^>]*>/gu, ""));
/** Привести текст в порядок: пробелы, пустые строки, невидимые знаки. */
export function tidy(text) {
  return String(text ?? "")
    .replace(/\r\n?/gu, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD\u200B-\u200D\uFEFF]/gu, "")
    .replace(/[ \t\u00A0]+/gu, " ").replace(/ *\n */gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
}

/** Word: `word/document.xml`, абзацы `<w:p>`, текст `<w:t>`. */
export function docxText(xml) {
  const out = [];
  const token = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab(?:\s[^>]*)?\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>|<\/w:p>|<w:p(?:\s[^>]*)?\/>|<\/w:tc>/gu;
  for (const found of String(xml).matchAll(token)) {
    if (found[1] != null) out.push(unescapeXml(found[1]));
    else if (found[0].startsWith("<w:tab")) out.push("\t");
    else if (found[0] === "</w:tc>") out.push("\t");
    else out.push("\n");
  }
  return tidy(out.join("").replace(/\n\t+/gu, "\n").replace(/\t+\n/gu, "\n"));
}
/** OpenDocument: `content.xml`, абзацы `<text:p>` и заголовки `<text:h>`. */
export function odtText(xml) {
  const out = [];
  for (const found of String(xml).matchAll(/<text:(p|h)(?:\s[^>]*)?>([\s\S]*?)<\/text:\1>/gu)) {
    out.push(stripTags(found[2]
      .replace(/<text:tab(?:\s[^>]*)?\/>/gu, "\t").replace(/<text:line-break(?:\s[^>]*)?\/>/gu, "\n")
      .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/gu, (whole, count) => " ".repeat(Math.min(20, Number(count) || 1)))));
  }
  return tidy(out.join("\n"));
}
/** FictionBook: всё, что в `<body>`, по абзацам; картинки (`<binary>`) — мимо. */
export function fb2Text(xml) {
  const body = [...String(xml).replace(/<binary[\s\S]*?<\/binary>/gu, "").matchAll(/<body(?:\s[^>]*)?>([\s\S]*?)<\/body>/gu)].map(found => found[1]).join("\n");
  if (!body) return "";
  return tidy(stripTags(body.replace(/<\/(?:p|v|title|subtitle|text-author|epigraph|cite|stanza|section|td|tr)>|<empty-line\s*\/>/gu, "\n")));
}
/** Страница книги или сайта: текст без разметки, блочные теги — перевод строки. */
export function htmlText(html) {
  return tidy(stripTags(String(html)
    .replace(/<(script|style|head|svg|noscript)\b[\s\S]*?<\/\1>/giu, " ").replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<br\s*\/?>|<\/(?:p|div|h[1-6]|li|tr|blockquote|section|article|title|dt|dd|table)>/giu, "\n")));
}
/** EPUB: порядок глав — из `spine` в файле `.opf`, главы — страницы XHTML. */
function epubText(bytes, entries, { limit, chars }) {
  const container = zipText(bytes, entries, "META-INF/container.xml", { limit }) ?? "";
  const opfName = container.match(/full-path="([^"]+)"/u)?.[1] ?? entries.find(item => /\.opf$/iu.test(item.name))?.name;
  const opf = opfName ? zipText(bytes, entries, opfName, { limit }) ?? "" : "";
  const base = opfName && opfName.includes("/") ? opfName.slice(0, opfName.lastIndexOf("/") + 1) : "";
  const items = new Map();
  for (const found of opf.matchAll(/<item\b[^>]*>/gu)) {
    const id = found[0].match(/\bid="([^"]+)"/u)?.[1], href = found[0].match(/\bhref="([^"]+)"/u)?.[1];
    if (id && href) items.set(id, decodeURIComponent(href));
  }
  let order = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/gu)].map(found => items.get(found[1])).filter(Boolean).map(href => base + href);
  if (!order.length) order = entries.map(item => item.name).filter(name => /\.x?html?$/iu.test(name)).sort();
  const out = [];
  let size = 0;
  for (const name of order) {
    const page = zipText(bytes, entries, name, { limit });
    if (!page) continue;
    const text = htmlText(page);
    if (text) { out.push(text); size += text.length; }
    if (size > chars) break;
  }
  return out.join("\n\n");
}

// ── RTF ─────────────────────────────────────────────────────────────────────
const RTF_SKIP = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer", "headerl", "headerr", "footerl", "footerr", "footnote", "generator", "themedata", "colorschememapping", "datastore", "latentstyles", "listtable", "listoverridetable", "rsidtbl", "xmlnstbl", "fldinst", "filetbl", "revtbl", "mmathPr", "wgrffmtfilter", "pgdsctbl", "nonshppict", "shpinst", "bkmkstart", "bkmkend"]);
const RTF_CHAR = { par: "\n", line: "\n", sect: "\n", page: "\n", row: "\n", tab: "\t", cell: "\t", emdash: "—", endash: "–", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”", bullet: "•", emspace: " ", enspace: " " };
/** RTF: управляющие слова долой, `\'xx` — байт в кодировке файла, `\uN` — знак Юникода. */
export function rtfText(bytes) {
  const text = latin1(bytes);
  if (!text.startsWith("{\\rtf")) return "";
  const page = Number(text.match(/\\ansicpg(\d+)/u)?.[1]) || 1251;
  const byteChar = (byte) => String.fromCharCode(page === 1252 ? (CP1252_HIGH[byte] ?? byte) : cp1251Code(byte));
  const out = [];
  const stack = [];
  let skip = false, uc = 1, pending = 0, i = 0;
  const put = (piece) => { if (pending > 0) { pending -= 1; return; } if (!skip) out.push(piece); };
  while (i < text.length) {
    const c = text[i];
    if (c === "{") { stack.push({ skip, uc }); i += 1; continue; }
    if (c === "}") { const back = stack.pop(); if (back) ({ skip, uc } = back); pending = 0; i += 1; continue; }
    if (c === "\r" || c === "\n") { i += 1; continue; }
    if (c !== "\\") { put(c); i += 1; continue; }
    const next = text[i + 1];
    if (next === "\\" || next === "{" || next === "}") { put(next); i += 2; continue; }
    if (next === "'") { const byte = parseInt(text.slice(i + 2, i + 4), 16); if (Number.isFinite(byte)) put(byteChar(byte)); i += 4; continue; }
    if (next === "*") { skip = true; i += 2; continue; }
    if (next === "~") { put(" "); i += 2; continue; }
    if (next === "\n" || next === "\r") { put("\n"); i += 2; continue; }
    const word = /^\\([a-zA-Z]+)(-?\d+)?[ ]?/u.exec(text.slice(i, i + 48));
    if (!word) { i += 2; continue; }
    i += word[0].length;
    const [, name, param] = word;
    if (RTF_SKIP.has(name)) { skip = true; continue; }
    if (name === "uc") { uc = Number(param) || 0; continue; }
    if (name === "u") { const code = Number(param); if (!skip) out.push(String.fromCharCode(code < 0 ? code + 65536 : code)); pending = uc; continue; }
    if (name === "bin") { i += Math.max(0, Number(param) || 0); continue; }
    if (RTF_CHAR[name]) put(RTF_CHAR[name]);
  }
  return tidy(out.join(""));
}

// ── PDF ─────────────────────────────────────────────────────────────────────
const isSpace = (c) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
const isDelimiter = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
function readLiteral(text, at) {
  const codes = [];
  let i = at + 1, depth = 1;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === 92) {
      const d = text.charCodeAt(i + 1);
      if (d === 110) codes.push(10); else if (d === 114) codes.push(13); else if (d === 116) codes.push(9); else if (d === 98) codes.push(8); else if (d === 102) codes.push(12);
      else if (d >= 48 && d <= 55) {
        let value = 0, k = 0;
        i += 1;
        while (k < 3 && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 55) { value = value * 8 + text.charCodeAt(i) - 48; i += 1; k += 1; }
        codes.push(value & 255);
        continue;
      } else if (d === 13) { i += text.charCodeAt(i + 2) === 10 ? 3 : 2; continue; } else if (d === 10) { i += 2; continue; } else codes.push(d);
      i += 2;
      continue;
    }
    if (c === 40) depth += 1;
    else if (c === 41) { depth -= 1; if (depth === 0) { i += 1; break; } }
    codes.push(c);
    i += 1;
  }
  return [fromCodes(codes), i];
}
function readHex(text, at) {
  const codes = [];
  let i = at + 1, half = -1;
  for (; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 62) { i += 1; break; }
    const digit = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
    if (digit < 0) continue;
    if (half < 0) half = digit; else { codes.push(half * 16 + digit); half = -1; }
  }
  if (half >= 0) codes.push(half * 16);
  return [fromCodes(codes), i];
}
function readName(text, at) {
  let i = at + 1;
  while (i < text.length) { const c = text.charCodeAt(i); if (isSpace(c) || isDelimiter(c)) break; i += 1; }
  return [text.slice(at + 1, i).replace(/#([0-9A-Fa-f]{2})/gu, (whole, hex) => String.fromCharCode(parseInt(hex, 16))), i];
}
function readNumber(text, at) {
  let i = at;
  while (i < text.length) { const c = text.charCodeAt(i); if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) i += 1; else break; }
  const value = Number(text.slice(at, i));
  return [Number.isFinite(value) ? value : 0, Math.max(i, at + 1)];
}
const skipSpace = (text, at) => {
  let i = at;
  for (;;) {
    const c = text.charCodeAt(i);
    if (c === 37) { while (i < text.length && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) i += 1; } else if (isSpace(c)) i += 1; else return i;
  }
};
/** Значение PDF со строки: словарь → объект, массив, `{ name }`, `{ str }`, `{ ref }`, число. Возвращает [значение, позиция]. */
function readValue(text, at, depth = 0) {
  let i = skipSpace(text, at);
  if (depth > 40 || i >= text.length) return [null, text.length];
  const c = text.charCodeAt(i);
  if (c === 60 && text.charCodeAt(i + 1) === 60) {
    const dict = {};
    i += 2;
    for (;;) {
      i = skipSpace(text, i);
      if (i >= text.length) break;
      if (text.charCodeAt(i) === 62) { i += text.charCodeAt(i + 1) === 62 ? 2 : 1; break; }
      if (text.charCodeAt(i) !== 47) { i += 1; continue; }
      let key;
      [key, i] = readName(text, i);
      let value;
      [value, i] = readValue(text, i, depth + 1);
      dict[key] = value;
    }
    return [dict, i];
  }
  if (c === 91) {
    const list = [];
    i += 1;
    for (;;) {
      i = skipSpace(text, i);
      if (i >= text.length) break;
      if (text.charCodeAt(i) === 93) { i += 1; break; }
      let value;
      const before = i;
      [value, i] = readValue(text, i, depth + 1);
      list.push(value);
      if (i <= before) i = before + 1;
    }
    return [list, i];
  }
  if (c === 47) { const [name, end] = readName(text, i); return [{ name }, end]; }
  if (c === 40) { const [str, end] = readLiteral(text, i); return [{ str }, end]; }
  if (c === 60) { const [str, end] = readHex(text, i); return [{ str }, end]; }
  if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) {
    const [value, end] = readNumber(text, i);
    // «12 0 R» — ссылка на объект.
    if (c >= 48 && c <= 57) {
      const ref = /^\s+\d+\s+R(?![A-Za-z0-9])/u.exec(text.slice(end, end + 24));
      if (ref) return [{ ref: value }, end + ref[0].length];
    }
    return [value, end];
  }
  let end = i;
  while (end < text.length) { const d = text.charCodeAt(end); if (isSpace(d) || isDelimiter(d)) break; end += 1; }
  const word = text.slice(i, end);
  return [word === "true" ? true : word === "false" ? false : null, Math.max(end, i + 1)];
}

function asciiHex(data) { return Uint8Array.from(readHex(`<${latin1(data)}>`, 0)[0], ch => ch.charCodeAt(0)); }
function ascii85(data) {
  const text = latin1(data).replace(/\s+/gu, "").replace(/^<~/u, "").replace(/~>[\s\S]*$/u, "");
  const out = [];
  for (let i = 0; i < text.length;) {
    if (text[i] === "z") { out.push(0, 0, 0, 0); i += 1; continue; }
    const group = text.slice(i, i + 5);
    i += 5;
    let value = 0;
    for (let k = 0; k < 5; k += 1) value = value * 85 + ((k < group.length ? group.charCodeAt(k) : 117) - 33);
    const four = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    out.push(...four.slice(0, group.length - 1));
  }
  return Uint8Array.from(out);
}
/** Снять предсказание PNG со строк потока (так сжимают таблицы объектов). */
function unpredict(data, columns, pixel) {
  const row = Math.max(1, Math.ceil(columns * pixel)), step = Math.max(1, Math.ceil(pixel)), rows = Math.floor(data.length / (row + 1));
  const out = new Uint8Array(rows * row);
  for (let y = 0; y < rows; y += 1) {
    const filter = data[y * (row + 1)], from = y * (row + 1) + 1, to = y * row;
    for (let x = 0; x < row; x += 1) {
      const left = x >= step ? out[to + x - step] : 0, up = y ? out[to + x - row] : 0, corner = x >= step && y ? out[to + x - row - step] : 0;
      let add = 0;
      if (filter === 1) add = left; else if (filter === 2) add = up; else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) { const p = left + up - corner, a = Math.abs(p - left), b = Math.abs(p - up), cc = Math.abs(p - corner); add = a <= b && a <= cc ? left : b <= cc ? up : corner; }
      out[to + x] = (data[from + x] + add) & 255;
    }
  }
  return out;
}

/** Имена знаков в шрифтах без таблицы ToUnicode: латиница, знаки, кириллица (`afii…`, `uni…`). */
const GLYPHS = { space: " ", exclam: "!", quotedbl: '"', numbersign: "#", dollar: "$", percent: "%", ampersand: "&", quotesingle: "'", parenleft: "(", parenright: ")", asterisk: "*", plus: "+", comma: ",", hyphen: "-", minus: "−", period: ".", slash: "/", zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", colon: ":", semicolon: ";", less: "<", equal: "=", greater: ">", question: "?", at: "@", bracketleft: "[", backslash: "\\", bracketright: "]", asciicircum: "^", underscore: "_", grave: "`", braceleft: "{", bar: "|", braceright: "}", asciitilde: "~", quoteleft: "‘", quoteright: "’", quotedblleft: "“", quotedblright: "”", quotedblbase: "„", guillemotleft: "«", guillemotright: "»", endash: "–", emdash: "—", bullet: "•", ellipsis: "…", numero: "№", degree: "°", section: "§", copyright: "©", nbspace: " ", fi: "fi", fl: "fl", ff: "ff", ffi: "ffi", ffl: "ffl" };
export function glyphChar(name) {
  if (name.length === 1) return name;
  if (GLYPHS[name] != null) return GLYPHS[name];
  let found = /^uni([0-9A-Fa-f]{4})/u.exec(name);
  if (found) return String.fromCharCode(parseInt(found[1], 16));
  found = /^u([0-9A-Fa-f]{4,6})$/u.exec(name);
  if (found) return String.fromCodePoint(parseInt(found[1], 16));
  found = /^afii(\d{5})$/u.exec(name);
  if (found) {
    const n = Number(found[1]);
    if (n >= 10017 && n <= 10022) return String.fromCharCode(0x410 + n - 10017);
    if (n === 10023) return "Ё";
    if (n >= 10024 && n <= 10049) return String.fromCharCode(0x416 + n - 10024);
    if (n >= 10065 && n <= 10070) return String.fromCharCode(0x430 + n - 10065);
    if (n === 10071) return "ё";
    if (n >= 10072 && n <= 10097) return String.fromCharCode(0x436 + n - 10072);
    if (n === 61352) return "№";
  }
  return "";
}

/** Таблица «код → буквы» из потока ToUnicode. `bytes` — сколько байт в одном коде. */
export function readCMap(text) {
  const map = new Map();
  let bytes = (text.match(/begincodespacerange\s*<([0-9A-Fa-f]+)>/u)?.[1].length ?? 0) / 2;
  const chars = (hex) => { let out = ""; let i = 0; for (; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16)); if (i < hex.length) out += String.fromCharCode(parseInt(hex.slice(i), 16)); return out; };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/gu)) {
    for (const found of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/gu)) { map.set(parseInt(found[1], 16), chars(found[2])); if (!bytes) bytes = found[1].length / 2; }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/gu)) {
    for (const found of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]*)>|\[([^\]]*)\])/gu)) {
      const low = parseInt(found[1], 16), high = parseInt(found[2], 16);
      if (!bytes) bytes = found[1].length / 2;
      if (!(high >= low) || high - low > 65535) continue;
      if (found[3] != null) {
        const base = chars(found[3]), head = base.slice(0, -1), tail = base.charCodeAt(base.length - 1) || 0;
        for (let code = low; code <= high; code += 1) map.set(code, head + String.fromCharCode(tail + code - low));
      } else {
        const items = [...found[4].matchAll(/<([0-9A-Fa-f]*)>/gu)].map(item => chars(item[1]));
        for (let code = low; code <= high && code - low < items.length; code += 1) map.set(code, items[code - low]);
      }
    }
  }
  return { map, bytes: Math.round(bytes) || 0 };
}

const multiply = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const UNIT = [1, 0, 0, 1, 0, 0];

/**
 * PDF → `{ ok, text, pages }` или `{ ok: false, code }`. `chars` — сколько знаков нужно:
 * после этого страницы не читаются (она всё равно выучит только начало).
 */
export function pdfText(bytes, { limit = 24 * 1024 * 1024, chars = 120_000, maxPages = 600 } = {}) {
  const raw = latin1(bytes);
  if (!raw.slice(0, 1024).includes("%PDF-")) return { ok: false, code: "broken" };
  if (/\/Encrypt(?![A-Za-z])/u.test(raw.slice(Math.max(0, raw.length - 4096))) || /\/Encrypt\s+\d+\s+\d+\s+R/u.test(raw)) return { ok: false, code: "encrypted" };

  // 1. Объекты: «N G obj … endobj». Поток пропускается целиком — в его байтах может стоять что угодно.
  const objects = new Map();
  const head = /(\d+)\s+(\d+)\s+obj(?![A-Za-z])/gu;
  for (let found = head.exec(raw); found; found = head.exec(raw)) {
    let value, at;
    try { [value, at] = readValue(raw, head.lastIndex); } catch { continue; }
    at = skipSpace(raw, at);
    if (raw.startsWith("stream", at)) {
      let start = at + 6;
      if (raw.charCodeAt(start) === 13) start += 1;
      if (raw.charCodeAt(start) === 10) start += 1;
      const length = typeof value?.Length === "number" ? value.Length : -1;
      let end = length >= 0 && /^\s*endstream/u.test(raw.slice(start + length, start + length + 24)) ? start + length : -1;
      if (end < 0) {
        end = raw.indexOf("endstream", start);
        if (end < 0) break;
        if (raw.charCodeAt(end - 1) === 10) end -= 1;
        if (raw.charCodeAt(end - 1) === 13) end -= 1;
      }
      objects.set(Number(found[1]), { value, start, end });
      head.lastIndex = end;
    } else objects.set(Number(found[1]), { value });
  }
  const resolve = (value, depth = 0) => {
    let cur = value;
    for (let i = 0; cur && typeof cur === "object" && cur.ref != null && i < 20; i += 1) {
      const target = objects.get(cur.ref);
      if (!target) return null;
      if (target.value === undefined && target.text != null) { try { [target.value] = readValue(target.text, 0); } catch { target.value = null; } }
      cur = target.value;
    }
    return depth > 20 ? null : cur;
  };
  const number = (value, fallback = 0) => { const got = resolve(value); return typeof got === "number" && Number.isFinite(got) ? got : fallback; };
  const nameOf = (value) => { const got = resolve(value); return got && typeof got === "object" && typeof got.name === "string" ? got.name : ""; };
  const list = (value) => { const got = resolve(value); return Array.isArray(got) ? got : got == null ? [] : [got]; };
  let budget = limit;
  /** Байты потока после всех его фильтров; `null` — фильтр незнаком (картинка, старое сжатие). */
  const streamOf = (ref) => {
    const target = ref && typeof ref === "object" && ref.ref != null ? objects.get(ref.ref) : null;
    if (!target || target.start == null) return null;
    if (target.data !== undefined) return target.data;
    let data = bytes.subarray(target.start, target.end);
    const filters = list(target.value?.Filter).map(nameOf), parms = list(target.value?.DecodeParms);
    try {
      for (let k = 0; k < filters.length; k += 1) {
        const filter = filters[k];
        if (filter === "FlateDecode" || filter === "Fl") data = inflate(data, { limit: Math.max(1, budget) });
        else if (filter === "ASCIIHexDecode" || filter === "AHx") data = asciiHex(data);
        else if (filter === "ASCII85Decode" || filter === "A85") data = ascii85(data);
        else { data = null; break; }
        const parm = resolve(parms[k]);
        if (parm && number(parm.Predictor) >= 10) data = unpredict(data, number(parm.Columns, 1), number(parm.Colors, 1) * number(parm.BitsPerComponent, 8) / 8);
      }
    } catch (error) { if (/too big/u.test(String(error?.message))) throw error; data = null; }
    if (data) budget -= data.length;
    if (budget < 0) throw new Error("too big");
    target.data = data;
    return data;
  };
  // 2. Объекты, уложенные в потоки объектов (так пишут PDF с версии 1.5).
  for (const [id, target] of [...objects]) {
    if (target.start == null || nameOf(target.value?.Type) !== "ObjStm") continue;
    const data = streamOf({ ref: id });
    if (!data) continue;
    const text = latin1(data), first = number(target.value.First), count = number(target.value.N);
    const index = text.slice(0, first).trim().split(/\s+/u).map(Number);
    for (let k = 0; k < count && 2 * k + 1 < index.length; k += 1) {
      const from = first + index[2 * k + 1], to = 2 * k + 3 < index.length ? first + index[2 * k + 3] : text.length;
      if (!objects.has(index[2 * k])) objects.set(index[2 * k], { text: text.slice(from, to) });
    }
  }

  // 3. Страницы по порядку: от корня по дереву; не вышло — все объекты «страница» по номерам.
  const pages = [];
  const rootRef = [...raw.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/gu)].at(-1)?.[1];
  const walk = (ref, inherited, depth) => {
    if (depth > 60 || pages.length >= maxPages) return;
    const node = resolve(ref);
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const resources = node.Resources ?? inherited;
    const kids = resolve(node.Kids);
    if (Array.isArray(kids)) { for (const kid of kids) walk(kid, resources, depth + 1); return; }
    pages.push({ node, resources });
  };
  if (rootRef) { const catalog = resolve({ ref: Number(rootRef) }); if (catalog?.Pages) walk(catalog.Pages, null, 0); }
  if (!pages.length) {
    for (const id of [...objects.keys()].sort((a, b) => a - b)) {
      const node = resolve({ ref: id });
      if (node && typeof node === "object" && !Array.isArray(node) && nameOf(node.Type) === "Page") pages.push({ node, resources: node.Resources ?? null });
      if (pages.length >= maxPages) break;
    }
  }
  if (!pages.length) return { ok: false, code: "broken" };

  // 4. Шрифты: код из строки → буквы и ширина знака.
  const fontCache = new Map();
  const fontOf = (value) => {
    const key = value && typeof value === "object" && value.ref != null ? value.ref : null;
    if (key != null && fontCache.has(key)) return fontCache.get(key);
    const dict = resolve(value);
    if (!dict || typeof dict !== "object") return null;
    const type0 = nameOf(dict.Subtype) === "Type0";
    const unicode = dict.ToUnicode ? streamOf(dict.ToUnicode) : null;
    const cmap = unicode ? readCMap(latin1(unicode)) : null;
    const font = { wide: type0 && cmap?.bytes !== 1, known: Boolean(cmap?.map.size), char: null, width: null };
    if (type0) {
      const child = resolve(list(dict.DescendantFonts)[0]) ?? {};
      const base = number(child.DW, 1000), widths = new Map();
      const table = list(child.W);
      for (let i = 0; i < table.length && widths.size < 70_000;) {
        const first = number(table[i]), next = resolve(table[i + 1]);
        if (Array.isArray(next)) { next.forEach((item, k) => widths.set(first + k, number(item, base))); i += 2; } else { const lastCode = number(next), w = number(table[i + 2], base); for (let code = first; code <= lastCode && code - first < 70_000; code += 1) widths.set(code, w); i += 3; }
      }
      font.char = (code) => cmap?.map.get(code) ?? "";
      font.width = (code) => widths.get(code) ?? base;
    } else {
      const table = new Array(256);
      const encoding = resolve(dict.Encoding);
      const baseName = encoding && typeof encoding === "object" && encoding.name ? encoding.name : nameOf(encoding?.BaseEncoding);
      for (let code = 0; code < 256; code += 1) table[code] = code < 32 ? "" : code < 128 ? String.fromCharCode(code) : baseName === "MacRomanEncoding" ? "" : String.fromCharCode(CP1252_HIGH[code] ?? code);
      let named = false;
      if (encoding && !encoding.name) {
        let code = 0;
        for (const item of list(encoding.Differences)) {
          const got = resolve(item);
          if (typeof got === "number") code = got;
          else if (got?.name != null) { const ch = glyphChar(got.name); if (code >= 0 && code < 256) { table[code] = ch; if (ch) named = true; } code += 1; }
        }
      }
      const first = number(dict.FirstChar), widths = list(dict.Widths).map(item => number(item, 0));
      const missing = number(resolve(dict.FontDescriptor)?.MissingWidth, 500);
      font.known = font.known || named || Boolean(baseName) || !dict.FontDescriptor || nameOf(dict.Subtype) === "Type1";
      font.char = (code) => cmap?.map.get(code) ?? table[code & 255] ?? "";
      font.width = (code) => widths[code - first] || missing;
    }
    if (key != null) fontCache.set(key, font);
    return font;
  };

  // 5. Операторы текста: где стоит перо, каким шрифтом и что пишется.
  const out = [];
  let size = 0, hidden = 0, shown = 0;
  const emit = (piece) => { out.push(piece); size += piece.length; };
  const lastChar = () => { const piece = out.at(-1); return piece ? piece[piece.length - 1] : "\n"; };
  const run = (text, resources, ctm0, depth) => {
    const res = resolve(resources) ?? {};
    const fonts = resolve(res.Font) ?? {}, forms = resolve(res.XObject) ?? {};
    let ctm = ctm0, tm = UNIT, line = UNIT, font = null, fontSize = 0, charSpace = 0, wordSpace = 0, scale = 1, leading = 0;
    const saved = [];
    let penX = null, penY = 0;
    const show = (str) => {
      if (!font || !str) return;
      const at = multiply(tm, ctm);
      const height = Math.max(0.5, Math.abs(fontSize) * (Math.hypot(at[2], at[3]) || 1));
      if (penX != null) {
        const dy = Math.abs(at[5] - penY);
        if (dy > height * 0.45) { if (lastChar() !== "\n") emit(dy > height * 1.9 ? "\n\n" : "\n"); } else {
          const gap = at[4] - penX;
          if ((gap > height * 0.17 || gap < -height * 0.6) && !/\s/u.test(lastChar())) emit(" ");
        }
      } else if (out.length && lastChar() !== "\n") emit("\n");
      const step = font.wide ? 2 : 1;
      let advance = 0, piece = "";
      for (let i = 0; i + step <= str.length; i += step) {
        const code = step === 2 ? (str.charCodeAt(i) << 8) | str.charCodeAt(i + 1) : str.charCodeAt(i);
        const ch = font.char(code);
        if (ch) { piece += ch; shown += 1; } else hidden += 1;
        advance += (font.width(code) / 1000 * fontSize + charSpace + (step === 1 && code === 32 ? wordSpace : 0)) * scale;
      }
      if (piece) emit(piece);
      tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + advance * tm[0], tm[5] + advance * tm[1]];
      const end = multiply(tm, ctm);
      penX = end[4]; penY = end[5];
    };
    const move = (tx, ty) => { line = multiply([1, 0, 0, 1, tx, ty], line); tm = line; };
    const stack = [];
    const num = (k) => (typeof stack[k] === "number" ? stack[k] : 0);
    let i = 0;
    const n = text.length;
    while (i < n && size <= chars) {
      const c = text.charCodeAt(i);
      if (isSpace(c)) { i += 1; continue; }
      if (c === 37) { while (i < n && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) i += 1; continue; }
      if (c === 40) { let str; [str, i] = readLiteral(text, i); stack.push({ str }); continue; }
      if (c === 60 && text.charCodeAt(i + 1) !== 60) { let str; [str, i] = readHex(text, i); stack.push({ str }); continue; }
      if (c === 60 || c === 91) { let value; [value, i] = readValue(text, i); stack.push(value); continue; }
      if (c === 47) { let name; [name, i] = readName(text, i); stack.push({ name }); continue; }
      if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) { let value; [value, i] = readNumber(text, i); stack.push(value); continue; }
      let end = i;
      while (end < n) { const d = text.charCodeAt(end); if (isSpace(d) || isDelimiter(d)) break; end += 1; }
      if (end === i) { i += 1; continue; }
      const op = text.slice(i, end);
      i = end;
      const top = stack.at(-1);
      switch (op) {
        case "q": saved.push([ctm, font, fontSize, charSpace, wordSpace, scale, leading]); break;
        case "Q": if (saved.length) [ctm, font, fontSize, charSpace, wordSpace, scale, leading] = saved.pop(); break;
        case "cm": if (stack.length >= 6) ctm = multiply(stack.slice(-6).map(item => (typeof item === "number" ? item : 0)), ctm); break;
        case "BT": tm = UNIT; line = UNIT; break;
        case "Tf": { const name = stack.at(-2)?.name; font = name != null ? fontOf(fonts[name]) : font; fontSize = num(stack.length - 1); break; }
        case "Tc": charSpace = num(stack.length - 1); break;
        case "Tw": wordSpace = num(stack.length - 1); break;
        case "Tz": scale = num(stack.length - 1) / 100 || 1; break;
        case "TL": leading = num(stack.length - 1); break;
        case "Td": move(num(stack.length - 2), num(stack.length - 1)); break;
        case "TD": leading = -num(stack.length - 1); move(num(stack.length - 2), num(stack.length - 1)); break;
        case "Tm": if (stack.length >= 6) { line = stack.slice(-6).map(item => (typeof item === "number" ? item : 0)); tm = line; } break;
        case "T*": move(0, -leading); break;
        case "Tj": show(top?.str); break;
        case "'": move(0, -leading); show(top?.str); break;
        case "\"": wordSpace = num(stack.length - 3); charSpace = num(stack.length - 2); move(0, -leading); show(top?.str); break;
        case "TJ":
          for (const item of Array.isArray(top) ? top : []) {
            if (typeof item === "number") { const shift = -item / 1000 * fontSize * scale; tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + shift * tm[0], tm[5] + shift * tm[1]]; } else if (item?.str != null) show(item.str);
          }
          break;
        case "Do": {
          const form = top?.name != null ? forms[top.name] : null;
          const target = form?.ref != null ? objects.get(form.ref) : null;
          if (target && depth < 4 && nameOf(target.value?.Subtype) === "Form") {
            const data = streamOf(form);
            const matrix = list(target.value.Matrix).map(item => number(item));
            if (data) run(latin1(data), target.value.Resources ?? resources, matrix.length === 6 ? multiply(matrix, ctm) : ctm, depth + 1);
            penX = null;
          }
          break;
        }
        case "BI": {
          // Картинка внутри потока: после «ID» идут её байты, и в них может стоять что угодно — в том числе «(» и «EI».
          // Без сжатия длина известна по размерам; иначе конец — «EI», за которым снова читаемый текст.
          const mark = /\sID[\s]/gu;
          mark.lastIndex = i;
          const id = mark.exec(text);
          if (!id) { i = n; break; }
          const head = text.slice(i, id.index);
          const data = id.index + 4;
          const width = Number(head.match(/\/W(?:idth)?\s+(\d+)/u)?.[1]), tall = Number(head.match(/\/H(?:eight)?\s+(\d+)/u)?.[1]);
          const mask = /\/IM(?:ageMask)?\s+true/u.test(head), depth8 = mask ? 1 : Number(head.match(/\/B(?:PC|itsPerComponent)\s+(\d+)/u)?.[1]) || 8;
          const space = head.match(/\/(?:CS|ColorSpace)\s*\/(\w+)/u)?.[1] ?? "G";
          const parts = mask ? 1 : /RGB/u.test(space) ? 3 : /CMYK/u.test(space) ? 4 : 1;
          let stop = -1;
          if (!/\/F(?:ilter)?[\s\/\[]/u.test(head) && width > 0 && tall > 0) {
            const after = data + Math.ceil(width * parts * depth8 / 8) * tall;
            if (/^\s*EI(?:\s|$)/u.test(text.slice(after, after + 8))) stop = text.indexOf("EI", after) + 2;
          }
          for (let from = data; stop < 0;) {
            const at = text.indexOf("EI", from);
            if (at < 0) { stop = n; break; }
            // Настоящий конец: перед «EI» пробел, после — пробел и дальше только печатные знаки.
            if (isSpace(text.charCodeAt(at - 1)) && (at + 2 >= n || isSpace(text.charCodeAt(at + 2))) && !/[^\x09\x0A\x0D\x20-\x7E]/u.test(text.slice(at + 2, at + 14))) stop = at + 2;
            from = at + 2;
          }
          i = stop;
          break;
        }
        default: break;
      }
      stack.length = 0;
    }
  };
  let read = 0;
  try {
    for (const page of pages) {
      if (size > chars) break;
      const parts = [];
      // Содержимое страницы — ссылка на поток или на массив потоков: ссылку нельзя «раскрывать», иначе вместо потока останется его словарь.
      const contents = page.node.Contents;
      const direct = contents?.ref != null && objects.get(contents.ref)?.start != null;
      for (const item of direct ? [contents] : list(contents)) { const data = streamOf(item); if (data) parts.push(latin1(data)); }
      if (out.length && lastChar() !== "\n") emit("\n");
      if (out.length) emit("\n");
      if (parts.length) run(parts.join("\n"), page.resources, UNIT, 0);
      read += 1;
    }
  } catch (error) {
    if (/too big/u.test(String(error?.message))) return { ok: false, code: "too_big" };
    if (!shown) return { ok: false, code: "broken" };
  }
  let text = out.join("");
  // Старые русские PDF: шрифт назван латинским, а байты — Windows-1251. Видно по сплошным «Ïðèâåò».
  const latinHigh = (text.match(/[\u00C0-\u00FF]/gu) ?? []).length, cyrillic = (text.match(/[\u0400-\u04FF]/gu) ?? []).length;
  if (latinHigh > 20 && latinHigh > 4 * cyrillic && latinHigh * 3 > (text.match(/\p{L}/gu) ?? []).length) text = text.replace(/[\u0080-\u00FF]/gu, ch => String.fromCharCode(cp1251Code(ch.charCodeAt(0))));
  text = tidy(text);
  // Букв нет вовсе — скан или шрифты без таблицы букв. Часть знаков без букв — текст есть, но не весь: `partial`.
  if (!/[\p{L}\p{N}]/u.test(text)) return { ok: false, code: "empty", pages: pages.length };
  return { ok: true, text, pages: pages.length, read, ...(hidden > shown ? { partial: true } : {}) };
}

// ── вход ────────────────────────────────────────────────────────────────────
export const DOC_KINDS = Object.freeze({ docx: "Word", odt: "OpenDocument", pdf: "PDF", fb2: "FictionBook", rtf: "RTF", epub: "EPUB" });
const KIND_BY_TYPE = Object.freeze({
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", "application/vnd.oasis.opendocument.text": "odt", "application/pdf": "pdf",
  "application/x-fictionbook+xml": "fb2", "application/x-fictionbook": "fb2", "application/rtf": "rtf", "text/rtf": "rtf", "application/epub+zip": "epub",
});
/** Вид документа по имени и типу файла: ключ из `DOC_KINDS` или "". */
export function documentKind({ name = "", type = "" } = {}) {
  const file = String(name).toLowerCase();
  if (/\.fb2(?:\.zip)?$/u.test(file)) return "fb2";
  const ext = file.match(/\.([a-z0-9]{1,8})$/u)?.[1] ?? "";
  if (DOC_KINDS[ext]) return ext;
  return KIND_BY_TYPE[String(type).toLowerCase().split(";")[0].trim()] ?? "";
}

/**
 * Документ → `{ ok: true, text, pages? }` или `{ ok: false, code }`. Никогда не бросает:
 * битый файл — это ответ «не разобрала», а не упавший обработчик.
 */
export function readDocument(bytes, kind, { limit = 24 * 1024 * 1024, chars = 120_000 } = {}) {
  try {
    if (!(bytes instanceof Uint8Array) || !bytes.length) return { ok: false, code: "broken" };
    if (kind === "pdf") return pdfText(bytes, { limit, chars });
    if (kind === "rtf") { const text = rtfText(bytes); return text ? { ok: true, text } : { ok: false, code: "empty" }; }
    const zipped = bytes[0] === 0x50 && bytes[1] === 0x4B;
    if (kind === "fb2" && !zipped) {
      // Кодировку называет первая строка файла; чаще всего это UTF-8 или Windows-1251.
      const declared = latin1(bytes, 0, Math.min(bytes.length, 200)).match(/encoding=["']([\w-]+)["']/iu)?.[1]?.toLowerCase() ?? "";
      const xml = /1251/u.test(declared) ? cp1251(bytes) : decodeText(bytes);
      const text = fb2Text(xml);
      return text ? { ok: true, text } : { ok: false, code: "empty" };
    }
    const entries = zipped ? zipEntries(bytes) : null;
    if (!entries) return { ok: false, code: "broken" };
    let text = "";
    if (kind === "docx") { const xml = zipText(bytes, entries, "word/document.xml", { limit }); if (xml == null) return { ok: false, code: "broken" }; text = docxText(xml); }
    else if (kind === "odt") { const xml = zipText(bytes, entries, "content.xml", { limit }); if (xml == null) return { ok: false, code: "broken" }; text = odtText(xml); }
    else if (kind === "epub") text = epubText(bytes, entries, { limit, chars });
    else if (kind === "fb2") {
      const inner = entries.find(item => /\.fb2$/iu.test(item.name));
      if (!inner) return { ok: false, code: "broken" };
      return readDocument(zipRead(bytes, inner, { limit }), "fb2", { limit, chars });
    } else return { ok: false, code: "format" };
    return text ? { ok: true, text } : { ok: false, code: "empty" };
  } catch (error) {
    const why = String(error?.message ?? error);
    return { ok: false, code: /too big/u.test(why) ? "too_big" : /encrypted/u.test(why) ? "encrypted" : "broken" };
  }
}
