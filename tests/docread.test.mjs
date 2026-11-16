/**
 * Документы без библиотек: Word, PDF, RTF, OpenDocument, FB2, EPUB.
 *
 * До 0.34.0 «выучи» на PDF и Word отвечало «скопируйте текст в сообщение». Владелец:
 * «что не сделано — доделай». На платформе нет ни библиотек, ни распаковки, поэтому
 * разбор свой (`lib/docread.js`), и проверяется он так же, как своё сжатие картинок:
 * чужим эталоном. Распаковка — против zlib; кодировка — против TextDecoder; файлы в
 * `fixtures/docs` сделаны настоящими программами (python-docx, ReportLab, fpdf2, MuPDF),
 * а текст из них при написании сверен с тем, что читает MuPDF, слово в слово. Там же, вне
 * тестов, прогнаны PDF из набора pdf.js (Word, Chrome, статья на 23 страницы).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import zlib from "node:zlib";
import { randomBytes } from "node:crypto";
import { heart, message, reset, last, sdk, OWNER, KEY } from "./fixtures/kit.mjs";

const { inflateRaw, inflate, cp1251, decodeText, zipEntries, zipRead, docxText, rtfText, pdfText, readDocument, documentKind, glyphChar, readCMap } = await import("../tgcloud/lib/docread.js");
const { textFile } = await import("../tgcloud/lib/knowledge.js");

const NOON = Date.parse("2026-11-18T09:00:00Z");
const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/docs/${name}`, import.meta.url)));
const words = (text) => String(text).toLowerCase().replace(/ё/gu, "е").match(/[\p{L}\p{N}]+/gu) ?? [];
/** Четыре абзаца, которыми набраны файлы-образцы. */
const P = [
  "Памятка садовода. Яблони обрезают ранней весной, до начала сокодвижения: вырезают сухие и растущие внутрь кроны ветви.",
  "Смородину омолаживают осенью, удаляя побеги старше пяти лет. Малину после сбора урожая вырезают под корень — те побеги, что плодоносили.",
  "Клубнику мульчируют соломой, чтобы ягоды не лежали на земле; поливать сад лучше вечером, тёплой водой (20–25 °C), под корень.",
  "Список дел на 2026 год: №1 — купить секатор Fiskars; №2 — побелить стволы; №3 — «не забыть про ёжика».",
];
const latin = (text) => Buffer.from(text, "latin1");

/** ZIP своими руками: записи со сжатием deflate (или без него). */
function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, content, stored = false] of files) {
    const title = Buffer.from(name, "utf8"), data = Buffer.from(content), packed = stored ? data : zlib.deflateRawSync(data);
    const local = Buffer.alloc(30), entry = Buffer.alloc(46);
    local.writeUInt32LE(0x04034B50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(title.length, 26);
    entry.writeUInt32LE(0x02014B50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(stored ? 0 : 8, 10);
    entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(title.length, 28); entry.writeUInt32LE(offset, 42);
    parts.push(local, title, packed);
    central.push(entry, title);
    offset += 30 + title.length + packed.length;
  }
  const list = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(list.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, list, end]));
}
/** PDF своими руками: объекты подряд. Таблицы ссылок нет — разбор её и не читает. */
const pdf = (objects) => new Uint8Array(Buffer.concat([latin("%PDF-1.7\n"), ...objects.flatMap(([id, body]) => [latin(`${id} 0 obj\n`), Buffer.isBuffer(body) ? body : latin(body), latin("\nendobj\n")]), latin("trailer\n<< /Root 1 0 R >>\n%%EOF\n")]));
const stream = (dict, data, { flate = false } = {}) => {
  const body = flate ? zlib.deflateSync(Buffer.isBuffer(data) ? data : latin(data)) : Buffer.isBuffer(data) ? data : latin(data);
  return Buffer.concat([latin(`<< ${dict}${flate ? " /Filter /FlateDecode" : ""} /Length ${body.length} >>\nstream\n`), body, latin("\nendstream")]);
};
const TREE = [[1, "<< /Type /Catalog /Pages 2 0 R >>"], [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"], [3, "<< /Type /Page /Parent 2 0 R /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>"]];

test("распаковка: что сжал zlib, то она и вернула — все уровни, фиксированные таблицы, блоки без сжатия; предел размера", () => {
  for (const sample of [Buffer.from("а".repeat(60_000)), randomBytes(70_000), Buffer.from(P.join("\n").repeat(40)), Buffer.alloc(0), Buffer.from("x")]) {
    for (const level of [0, 1, 6, 9]) {
      assert.deepEqual(Buffer.from(inflateRaw(new Uint8Array(zlib.deflateRawSync(sample, { level })))), sample);
      assert.deepEqual(Buffer.from(inflate(new Uint8Array(zlib.deflateSync(sample, { level })))), sample);
    }
  }
  assert.equal(Buffer.from(inflateRaw(new Uint8Array(zlib.deflateRawSync(Buffer.from("привет привет привет"), { strategy: zlib.constants.Z_FIXED })))).toString(), "привет привет привет");
  // Пять мегабайт нулей в пяти килобайтах: без предела это способ положить обработчик.
  assert.throws(() => inflateRaw(new Uint8Array(zlib.deflateRawSync(Buffer.alloc(5_000_000))), { limit: 1_000_000 }), /too big/u);
  for (const broken of [new Uint8Array([7, 7, 7]), new Uint8Array(zlib.deflateRawSync(Buffer.from(P[0]))).subarray(0, 20)]) assert.throws(() => inflateRaw(broken));
});

test("кодировки: Windows-1251 — как у TextDecoder; текст без метки — UTF-8, а не вышло — Windows-1251", () => {
  const all = Uint8Array.from({ length: 256 }, (_, index) => index);
  assert.equal(cp1251(all), new TextDecoder("windows-1251").decode(all));
  const said = "Привет, ёжик № 5 — «да»";
  assert.equal(decodeText(new TextEncoder().encode(said)), said);
  assert.equal(decodeText(new Uint8Array([0xEF, 0xBB, 0xBF, ...new TextEncoder().encode(said)])), said, "метка UTF-8 в текст не попадает");
  assert.equal(decodeText(Uint8Array.from([0xCF, 0xF0, 0xE8, 0xE2, 0xE5, 0xF2, 0x2C, 0x20, 0xB8, 0xE6, 0xE8, 0xEA])), "Привет, ёжик");
  assert.equal(decodeText(new Uint8Array([0xFF, 0xFE, ...Buffer.from("Привет", "utf16le")])), "Привет");
});

test("виды файлов: что она берётся читать, а что нет", () => {
  for (const [name, type, kind] of [
    ["Договор.docx", "", "docx"], ["a.PDF", "", "pdf"], ["книга.fb2", "", "fb2"], ["книга.fb2.zip", "application/zip", "fb2"], ["письмо.rtf", "", "rtf"], ["роман.epub", "", "epub"], ["заметки.odt", "", "odt"],
    ["без расширения", "application/pdf", "pdf"], ["x", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"], ["старый.doc", "application/msword", ""], ["таблица.xlsx", "", ""], ["a.txt", "text/plain", ""],
  ]) assert.equal(documentKind({ name, type }), kind, name);
  assert.equal(textFile({ file_id: "x", file_name: "Договор.docx" }).kind, "docx");
  assert.equal(textFile({ file_id: "x", file_name: "заметки.txt" }).kind, undefined);
  assert.deepEqual(textFile({ file_id: "x", file_name: "старый.doc", mime_type: "application/msword" }), { ok: false, code: "format", name: "старый.doc", ext: "doc" });
});

test("Word, OpenDocument, EPUB, FB2: архив разбирается сам, текст — по абзацам; старый FB2 — в Windows-1251", () => {
  // Настоящий docx (python-docx): заголовок, абзацы, таблица, табуляция и перенос внутри абзаца.
  const real = readDocument(fixture("a.docx"), "docx");
  assert.equal(real.ok, true);
  assert.deepEqual(words(real.text), words(`Памятка садовода ${P.join(" ")} Культура Срок Яблоня Март Строка с табуляцией: после неё и переносом внутри абзаца.`));
  assert.equal(real.text.split("\n")[1], P[0], "абзац — одной строкой, со своими знаками");
  // Свой docx: оглавление и сжатие — как у любого архива.
  const made = zip([["[Content_Types].xml", "<Types/>", true], ["word/document.xml", `<w:document><w:body><w:p><w:pPr><w:b/></w:pPr><w:r><w:t>Раз &amp; два</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve"> три</w:t></w:r></w:p><w:p><w:r><w:t>Вторая</w:t><w:br/><w:t>строка &#8470;5</w:t></w:r></w:p></w:body></w:document>`]]);
  assert.deepEqual(zipEntries(made).map(item => item.name), ["[Content_Types].xml", "word/document.xml"]);
  assert.equal(readDocument(made, "docx").text, "Раз & два три\nВторая\nстрока №5");
  assert.equal(docxText("<w:p><w:r><w:t>один</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>а</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>б</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), "один\nа\nб");
  assert.equal(readDocument(zip([["content.xml", `<office:document-content><office:body><office:text><text:h text:outline-level="1">Заголовок</text:h><text:p text:style-name="P1">Первый<text:s text:c="2"/>абзац<text:tab/>и &lt;знак&gt;</text:p><text:p>Второй<text:line-break/>абзац</text:p></office:text></office:body></office:document-content>`]]), "odt").text, "Заголовок\nПервый абзац и <знак>\nВторой\nабзац");
  const book = zip([
    ["mimetype", "application/epub+zip", true], ["META-INF/container.xml", `<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`],
    ["OEBPS/content.opf", `<package><manifest><item id="b" href="two.xhtml"/><item id="a" href="one.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>`],
    ["OEBPS/two.xhtml", "<html><body><p>Глава вторая &mdash; &laquo;конец&raquo;.</p></body></html>"], ["OEBPS/one.xhtml", "<html><head><title>x</title><style>p{color:red}</style></head><body><h1>Глава первая</h1><p>Начало.</p></body></html>"],
  ]);
  assert.equal(readDocument(book, "epub").text, "Глава первая\nНачало.\n\nГлава вторая — «конец».", "главы — в порядке книги, а не архива");
  const fb2 = `<?xml version="1.0" encoding="windows-1251"?><FictionBook><description><title-info><book-title>Мимо</book-title></title-info></description><body><title><p>Памятка</p></title><section><p>${P[0]}</p><p>Вторая &amp; третья</p></section></body><binary id="c.jpg">AAAA</binary></FictionBook>`;
  const old = Uint8Array.from(Buffer.from(fb2, "latin1").length ? [...fb2].map(ch => { const code = ch.charCodeAt(0); return code < 128 ? code : code === 0x451 ? 0xB8 : code === 0x401 ? 0xA8 : code === 0x2014 ? 0x97 : code - 0x410 + 0xC0; }) : []);
  assert.equal(readDocument(old, "fb2").text, `Памятка\n\n${P[0]}\nВторая & третья`);
  assert.equal(readDocument(zip([["book.fb2", Buffer.from(old)]]), "fb2").text, `Памятка\n\n${P[0]}\nВторая & третья`, "и из архива .fb2.zip");
  // Битое и чужое — отказ кодом, а не исключение.
  assert.deepEqual(readDocument(new Uint8Array(randomBytes(3000)), "docx"), { ok: false, code: "broken" });
  assert.deepEqual(readDocument(zip([["other.xml", "<a/>"]]), "docx"), { ok: false, code: "broken" });
  assert.deepEqual(readDocument(zip([["word/document.xml", "<w:document><w:body></w:body></w:document>"]]), "docx"), { ok: false, code: "empty" });
  assert.throws(() => zipRead(made, { ...zipEntries(made)[1], encrypted: true }), /encrypted/u);
});

test("RTF: управляющие слова долой, кириллица — и байтами Windows-1251, и знаками Юникода", () => {
  const hex = (text) => [...text].map(ch => (ch.charCodeAt(0) < 128 ? ch : `\\'${(ch.charCodeAt(0) - 0x410 + 0xC0).toString(16)}`)).join("");
  const uni = (text) => [...text].map(ch => (ch.charCodeAt(0) < 128 ? ch : `\\u${ch.charCodeAt(0)}?`)).join("");
  const file = `{\\rtf1\\ansi\\ansicpg1251\\deff0{\\fonttbl{\\f0 Times New Roman;}}{\\colortbl;\\red0\\green0\\blue0;}{\\*\\generator Word;}{\\info{\\title Тайное}}\\f0\\fs24 ${hex("Привет, мир")}\\par\n${uni("Вторая строка")} \\endash  \\{x\\}\\tab ${hex("конец")}\\par}`;
  assert.equal(rtfText(new Uint8Array(latin(file))), "Привет, мир\nВторая строка – {x} конец");
  assert.equal(readDocument(new Uint8Array(latin("просто текст")), "rtf").code, "empty");
});

test("PDF настоящих программ: ReportLab, fpdf2 — те же слова в том же порядке; закрытый паролем и скан — названы", () => {
  // Встроенный шрифт с таблицей букв, выключка по ширине (слова расставлены сдвигами).
  const report = readDocument(fixture("rl.pdf"), "pdf");
  assert.equal(report.ok, true);
  assert.deepEqual(words(report.text), words([...P, ...P].join(" ")));
  assert.ok(report.text.startsWith("Памятка садовода. Яблони обрезают ранней весной, до начала сокодвижения:"), report.text.slice(0, 80));
  // Двухбайтовые коды (Type0), две страницы.
  const two = readDocument(fixture("fp.pdf"), "pdf");
  assert.deepEqual(words(two.text), words([...P, P[0], P[1]].join(" ")));
  assert.equal(two.pages, 2);
  // Стандартные шрифты без таблицы букв: латиница по кодировке; страницы — через пустую строку.
  assert.equal(readDocument(fixture("rl-latin.pdf"), "pdf").text, "Garden notes for 2026.\nPrune apple trees in early spring, before the sap runs.\nWater in the evening: 20-25 degrees.\n\nSecond page: buy a Fiskars pruner.");
  assert.deepEqual(readDocument(fixture("rl-enc.pdf"), "pdf"), { ok: false, code: "encrypted" });
  assert.deepEqual(readDocument(fixture("scan.pdf"), "pdf"), { ok: false, code: "empty", pages: 1 });
  assert.deepEqual(readDocument(new Uint8Array(randomBytes(3000)), "pdf"), { ok: false, code: "broken" });
  assert.deepEqual(readDocument(new Uint8Array(latin("%PDF-1.7\nничего")), "pdf"), { ok: false, code: "broken" });
});

test("PDF изнутри: таблица букв шрифта, пробел из сдвига, объекты в потоке объектов, картинка посреди текста", () => {
  // Коды 1…64 — «А»…«я», 0x41 — пробел: так пишут шрифты с собственной нумерацией знаков.
  const code = (text) => [...text].map(ch => (ch === " " ? 0x41 : ch.charCodeAt(0) - 0x410 + 1).toString(16).padStart(4, "0")).join("").toUpperCase();
  const cmap = "/CIDInit /ProcSet findresource begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0001> <0040> <0410> endbfrange 1 beginbfchar <0041> <0020> endbfchar endcmap end";
  assert.equal(readCMap(cmap).map.get(1), "А");
  assert.equal(readCMap(cmap).map.get(0x40), "я");
  assert.equal(readCMap(cmap).bytes, 2);
  assert.equal(readCMap("1 beginbfrange <01> <03> [<0041> <00420043> <0044>] endbfrange").map.get(2), "BC");
  const wide = pdf([
    ...TREE, [4, "<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>"], [6, "<< /Type /Font /Subtype /CIDFontType2 /DW 600 >>"], [7, stream("", cmap, { flate: true })],
    // «Привет» и «мир» — без пробела, сдвигом в 0,4 кегля; «Вторая строка» — с пробелом-знаком, на новой строке; «слит» + «но» — вплотную.
    [5, stream("", `BT /F1 12 Tf 72 700 Td [<${code("Привет")}> -400 <${code("мир")}>] TJ 0 -14 Td <${code("Вторая строка")}> Tj 0 -14 Td [<${code("слит")}> 20 <${code("но")}>] TJ ET`, { flate: true })],
  ]);
  assert.deepEqual(pdfText(wide), { ok: true, text: "Привет мир\nВторая строка\nслитно", pages: 1, read: 1 });

  // Каталог, страницы и шрифт лежат в потоке объектов; в тексте страницы — картинка, в байтах которой стоят «(» и « EI ».
  const bodies = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"];
  let at = 0;
  const index = bodies.map((body, k) => { const line = `${k + 1} ${at}`; at += body.length + 1; return line; }).join(" ") + " ";
  const packed = pdf([
    [8, stream(`/Type /ObjStm /N 4 /First ${index.length}`, index + bodies.join(" "), { flate: true })],
    [5, stream("", Buffer.concat([latin("q 1 0 0 1 0 0 cm BI /W 4 /H 2 /CS /G /BPC 8 ID "), Buffer.from([0x28, 0x00, 0x20, 0x45, 0x49, 0x20, 0x28, 0xFF]), latin("\nEI Q BT /F1 12 Tf 72 700 Td (Hello) Tj 40 0 Td (world) Tj 0 -20 Td (Next \\(line\\)) Tj ET")]))],
  ]);
  assert.deepEqual(pdfText(packed), { ok: true, text: "Hello world\nNext (line)", pages: 1, read: 1 });
});

test("PDF без таблицы букв: имена знаков (afii, uni) — в буквы; старый русский файл с «Ïðèâåò» — в кириллицу", () => {
  assert.deepEqual(["afii10017", "afii10022", "afii10023", "afii10024", "afii10049", "afii10065", "afii10071", "afii10097", "uni0416", "A", "quoteright", "fi", "нет"].map(glyphChar), ["А", "Е", "Ё", "Ж", "Я", "а", "ё", "я", "Ж", "A", "’", "fi", ""]);
  const named = pdf([...TREE, [4, "<< /Type /Font /Subtype /Type1 /BaseFont /X /Encoding << /Type /Encoding /Differences [65 /afii10017 /afii10018 /afii10023 /afii10071 /uni0416 32 /space] >> >>"], [5, stream("", "BT /F1 12 Tf 72 700 Td (ABC DE) Tj ET")]]);
  assert.equal(pdfText(named).text, "АБЁ ёЖ");
  // Шрифт назван латинским, а байты — Windows-1251: так делали в девяностых и нулевых.
  const said = "Привет, это старый документ из девяностых годов";
  const bytes = Buffer.from([...said].map(ch => (ch.charCodeAt(0) < 128 ? ch.charCodeAt(0) : ch.charCodeAt(0) - 0x410 + 0xC0)));
  const old = pdf([...TREE, [4, "<< /Type /Font /Subtype /Type1 /BaseFont /Arial /Encoding /WinAnsiEncoding >>"], [5, stream("", Buffer.concat([latin("BT /F1 12 Tf 72 700 Td ("), bytes, latin(") Tj ET")]))]]);
  assert.equal(pdfText(old).text, said);
  // Шрифт с двухбайтовыми кодами и без таблицы: букв взять неоткуда — «пусто», а не мусор.
  const mute = pdf([...TREE, [4, "<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [6 0 R] >>"], [6, "<< /Type /Font /Subtype /CIDFontType2 >>"], [5, stream("", "BT /F1 12 Tf 72 700 Td <00010002000300040005> Tj ET")]]);
  assert.deepEqual(pdfText(mute), { ok: false, code: "empty", pages: 1 });
});

// ── в сердце ────────────────────────────────────────────────────────────────
const stored = new Map();
const upload = (name, bytes, { caption = "выучи", type = "" } = {}) => {
  stored.set(`file-${name}`, bytes);
  sdk().apiReplies.getFileContent = (fileId) => stored.get(fileId) ?? new Uint8Array(0);
  const update = message(caption, { id: OWNER });
  delete update.text;
  update.caption = caption;
  update.document = { file_id: `file-${name}`, file_name: name, mime_type: type, file_size: bytes.length };
  return update;
};

test("«выучи» на файле Word и PDF: она читает его сама и отвечает по нему; скан, пароль и старый .doc — словами", async () => {
  reset();
  const h = heart({}, { now: () => NOON });
  await h.onMessage(upload("Памятка садовода.docx", fixture("a.docx")), KEY);
  assert.match(last(OWNER), /^Выучила: документ №1 «Памятка садовода» — \d+ част[ьи], \d+ знаков\. Отвечать по нему буду всем/u);
  await h.onMessage(upload("Сад.pdf", fixture("rl.pdf"), { type: "application/pdf" }), KEY);
  assert.match(last(OWNER), /^Выучила: документ №2 «Сад» — /u);
  await h.onMessage(message("документы", { id: OWNER }), KEY);
  assert.match(last(OWNER), /1\. «Памятка садовода» — .+\(файл Word\)\n2\. «Сад» — .+\(файл PDF\)/u);
  await h.onMessage(message("покажи документ 2", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Яблони обрезают ранней весной, до начала сокодвижения/u);
  // Текстовый файл из «Блокнота» русской Windows: раньше — «не в кодировке UTF-8».
  const windows = Uint8Array.from([...`Правила дачного посёлка.\n${P.join("\n")}`].map(ch => { const c = ch.charCodeAt(0); return c < 128 ? c : c === 0x451 ? 0xB8 : c === 0x2116 ? 0xB9 : c === 0x2014 ? 0x97 : c === 0x2013 ? 0x96 : c === 0xAB ? 0xAB : c === 0xBB ? 0xBB : c === 0xB0 ? 0xB0 : c - 0x410 + 0xC0; }));
  await h.onMessage(upload("Правила.txt", windows, { type: "text/plain" }), KEY);
  assert.match(last(OWNER), /^Выучила: документ №3 «Правила» — /u);
  await h.onMessage(message("покажи документ 3", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Правила дачного посёлка\.\nПамятка садовода\. Яблони/u);
  // То, чего она прочесть не может, — сказано словами, и в знания ничего не легло.
  await h.onMessage(upload("Скан.pdf", fixture("scan.pdf")), KEY);
  assert.match(last(OWNER), /^В этом PDF нет текста, который можно прочесть: похоже, это скан/u);
  await h.onMessage(upload("Тайна.pdf", fixture("rl-enc.pdf")), KEY);
  assert.match(last(OWNER), /^Этот PDF закрыт паролем или защитой/u);
  await h.onMessage(upload("Старый.doc", new Uint8Array(500), { type: "application/msword" }), KEY);
  assert.match(last(OWNER), /^Такой файл \(\.doc\) я прочитать не могу\. Читаю текстовые .+ Word \(docx\), PDF, RTF/u);
  assert.equal((await h.knowledge.docs()).length, 3);
});
