/**
 * Стикер из рисунка (идея 126): своя перекодировка картинки в PNG 512 точек и путь в
 * Telegram — набор человека. Картинки настоящие (tests/fixtures/pictures.mjs), сделаны
 * чужим кодировщиком; готовый PNG проверяется чужим же разбором — zlib из Node.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { heart, message, group, reset, last, calls, chats, says, sdk, source, toChat, OWNER, KEY } from "./fixtures/kit.mjs";
import { PHOTO_BASE, PHOTO_PROG, FIGURE_JPG, FIGURE_PNG, PALETTE_PNG, DEEP_PNG, SAMPLES } from "./fixtures/pictures.mjs";

const { parseStickerAsk, stickerSource, packName, decodeJpeg, decodePng, toSticker, cutBackground, PACK_KEY, STICKER_STYLE, STICKER_MAX_BYTES } = await import("../tgcloud/lib/sticker.js");

const NOON = Date.parse("2026-11-18T09:00:00Z");
const kv = (key) => JSON.parse(sdk().kv.get(key) ?? "null");

/** Разбор PNG чужими руками: куски, контрольные суммы (побитно), распаковка — zlib из Node. */
function readPng(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], "подпись PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const crc = (from, to) => { let c = 0xFFFFFFFF; for (let i = from; i < to; i += 1) { c ^= bytes[i]; for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; } return (c ^ 0xFFFFFFFF) >>> 0; };
  const parts = {};
  const order = [];
  for (let at = 8; at < bytes.length;) {
    const length = view.getUint32(at), type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    assert.equal(view.getUint32(at + 8 + length), crc(at + 4, at + 8 + length), `контрольная сумма куска ${type}`);
    parts[type] = bytes.subarray(at + 8, at + 8 + length);
    order.push(type);
    at += 12 + length;
  }
  assert.deepEqual(order, ["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
  const head = new DataView(parts.IHDR.buffer, parts.IHDR.byteOffset, 13);
  const width = head.getUint32(0), height = head.getUint32(4);
  assert.deepEqual([...parts.IHDR.subarray(8)], [8, 3, 0, 0, 0], "8 бит, палитра, без чересстрочности");
  assert.ok(parts.PLTE.length % 3 === 0 && parts.PLTE.length <= 768, "палитра не больше 256 цветов");
  assert.deepEqual([...parts.tRNS], [0], "прозрачен только нулевой цвет");
  const raw = inflateSync(parts.IDAT); // проверяет и сумму Adler-32
  assert.equal(raw.length, (width + 1) * height);
  /** Точка: [r, g, b, a]. */
  const at = (x, y) => {
    assert.equal(raw[y * (width + 1)], 0, "строки без фильтра");
    const index = raw[y * (width + 1) + 1 + x];
    return index === 0 ? [0, 0, 0, 0] : [parts.PLTE[index * 3], parts.PLTE[index * 3 + 1], parts.PLTE[index * 3 + 2], 255];
  };
  let clear = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (raw[y * (width + 1) + 1 + x] === 0) clear += 1;
  return { width, height, at, clear: clear / (width * height), colours: parts.PLTE.length / 3 - 1 };
}
const close = (got, want, slack, note) => { for (let i = 0; i < want.length; i += 1) assert.ok(Math.abs(got[i] - want[i]) <= slack, `${note}: ${got} вместо ${want}`); };
const point = (image, x, y) => { const i = y * image.width + x; return [image.data[i * 3], image.data[i * 3 + 1], image.data[i * 3 + 2], image.alpha ? image.alpha[i] : 255]; };

/**
 * Крошечный JPEG своими руками: серые блоки 8×8, в каждом только постоянная составляющая.
 * Нужен ради интервалов перезапуска (DRI и метки RSTn): кодировщик под рукой их не ставит.
 * `values` — яркость блоков по порядку, `restart` — через сколько блоков стоит метка.
 */
function tinyJpeg(values, { columns = values.length, restart = 0 } = {}) {
  const out = [0xFF, 0xD8];
  const segment = (marker, body) => out.push(0xFF, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body);
  segment(0xDB, [0, ...new Array(64).fill(1)]); // таблица квантования из единиц
  segment(0xC0, [8, 0, 8 * Math.ceil(values.length / columns), 0, 8 * columns, 1, 1, 0x11, 0]);
  // Стандартная таблица Хаффмана для постоянной составляющей яркости: категории 0–11.
  const counts = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
  segment(0xC4, [0x00, ...counts, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  segment(0xC4, [0x10, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x01]); // «конец блока» — код 00
  if (restart) segment(0xDD, [restart >> 8, restart & 255]);
  segment(0xDA, [1, 1, 0x00, 0, 63, 0]);
  const codes = [];
  for (let length = 1, code = 0, symbol = 0; length <= 16; length += 1, code <<= 1) for (let n = 0; n < counts[length - 1]; n += 1) codes[symbol++] = [code++, length];
  let bits = 0, held = 0;
  const flush = (byte) => { out.push(byte); if (byte === 0xFF) out.push(0); };
  const put = (value, length) => { for (let i = length - 1; i >= 0; i -= 1) { bits = (bits << 1) | ((value >> i) & 1); held += 1; if (held === 8) { flush(bits); bits = 0; held = 0; } } };
  const align = () => { while (held) put(1, 1); };
  let pred = 0;
  values.forEach((value, index) => {
    if (restart && index && index % restart === 0) { align(); out.push(0xFF, 0xD0 + ((index / restart - 1) & 7)); pred = 0; }
    const dc = (value - 128) * 8, diff = dc - pred;
    pred = dc;
    const size = diff === 0 ? 0 : 32 - Math.clz32(Math.abs(diff));
    put(...codes[size]);
    if (size) put(diff < 0 ? diff + (1 << size) - 1 : diff, size);
    put(0, 2);
  });
  align();
  out.push(0xFF, 0xD9);
  return new Uint8Array(out);
}

test("слова о стикерах: «сделай стикер», «нарисуй стикер: …», «мои стикеры» — и похожее мимо", () => {
  for (const said of ["сделай стикер", "Сделай стикер, пожалуйста!", "сделай из этого стикер", "сделай из моей фотки стикер", "стикер из этого", "стикер из последнего рисунка", "преврати это в стикер",
    "в стикер", "это в стикер", "добавь в стикеры", "добавь это в мой набор стикеров", "сделай стикером", "хочу стикер из этой картинки", "можешь сделать стикер из этого?", "сделай наклейку"]) {
    assert.deepEqual(parseStickerAsk(said), { make: true, emoji: [] }, said);
  }
  assert.deepEqual(parseStickerAsk("сделай из него стикер 😺"), { make: true, emoji: ["😺"] });
  assert.deepEqual(parseStickerAsk("нарисуй стикер: кот в шляпе"), { draw: "кот в шляпе", emoji: [] });
  assert.deepEqual(parseStickerAsk("стикер: Кот в шляпе 🐱🎩"), { draw: "Кот в шляпе", emoji: ["🐱", "🎩"] });
  assert.deepEqual(parseStickerAsk("нарисуй стикер с котом"), { draw: "стикер с котом", emoji: [] });
  assert.deepEqual(parseStickerAsk("сделай стикер про осень"), { draw: "стикер про осень", emoji: [] });
  assert.deepEqual(parseStickerAsk("нарисуй стикер"), { draw: "", emoji: [] });
  for (const said of ["мои стикеры", "покажи мои стикеры", "ссылка на мой набор стикеров", "мой стикерпак"]) assert.deepEqual(parseStickerAsk(said), { pack: true }, said);
  for (const said of ["удали последний стикер", "убери последний стикер из набора"]) assert.deepEqual(parseStickerAsk(said), { drop: true }, said);
  for (const said of ["пришли стикер", "что за стикер", "люблю стикеры", "это стикер?", "классный стикер", "твои стикеры", "скинь стикер с котиком", "стикеры — зло", "стикер", "сделай стикер из кота", "удали стикер"]) {
    assert.equal(parseStickerAsk(said), null, said);
  }

  // Имя набора — по правилам Telegram: латиница и цифры, начинается с буквы, в конце «_by_<бот>».
  assert.equal(packName(7, 1, "ai_heart_bot"), "ai7_by_ai_heart_bot");
  assert.equal(packName(123456789, 3, "@Ai_Bot"), "ai123456789x3_by_Ai_Bot");
  assert.match(packName(-100123, 1, "bot"), /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/iu);

  // Из фото берётся наименьший размер, которого хватит на 512 точек: скачивать четыре мегабайта незачем.
  const sizes = [{ file_id: "s", width: 90, height: 90 }, { file_id: "m", width: 320, height: 213 }, { file_id: "x", width: 800, height: 533 }, { file_id: "y", width: 1280, height: 853 }];
  assert.deepEqual(stickerSource({ photo: sizes }), { file_id: "x" });
  assert.deepEqual(stickerSource({ photo: sizes.slice(0, 2) }), { file_id: "m" }, "маленькое фото — какое есть");
  assert.deepEqual(stickerSource({ document: { file_id: "d", mime_type: "image/png", file_size: 1000 } }), { file_id: "d" });
  assert.deepEqual(stickerSource({ document: { file_id: "d", mime_type: "image/jpeg", file_size: 9_000_000 } }), { heavy: true });
  assert.deepEqual(stickerSource({ document: { file_id: "d", mime_type: "image/webp" } }), { foreign: true });
  assert.deepEqual(stickerSource({ sticker: { file_id: "st" } }), { sticker: true });
  assert.equal(stickerSource({ text: "просто слова" }), null);
  assert.equal(stickerSource({ document: { file_id: "d", mime_type: "application/pdf" } }), null);
});

test("JPEG читается своим кодом: обычный и прогрессивный — точка в точку, и так же, как у ImageMagick", () => {
  const base = decodeJpeg(PHOTO_BASE), prog = decodeJpeg(PHOTO_PROG);
  assert.deepEqual([base.width, base.height, base.data.length], [45, 31, 45 * 31 * 3]);
  assert.deepEqual([...prog.data], [...base.data], "прогрессивный JPEG тех же точек читается так же, как обычный");
  for (const [x, y, ...want] of SAMPLES.PHOTO_BASE) close(point(base, x, y), want, 6, `фото, точка ${x},${y}`);
  const figure = decodeJpeg(FIGURE_JPG);
  assert.deepEqual([figure.width, figure.height], [64, 64]);
  // На резкой границе цвета прореженный цвет восстанавливается грубее, чем у libjpeg: там допуск шире.
  for (const [x, y, ...want] of SAMPLES.FIGURE_JPG) close(point(figure, x, y), want, x === 32 && y === 12 ? 40 : 12, `фигура, точка ${x},${y}`);

  // Интервалы перезапуска: после метки предсказание яркости начинается с нуля.
  const values = [40, 200, 90, 255, 128, 0];
  /** Яркость в середине каждого блока 8×8, по порядку блоков. */
  const flat = (image) => values.map((_, index) => image.data[((Math.floor(index / 3) * 8 + 4) * image.width + (index % 3) * 8 + 4) * 3]);
  for (const restart of [0, 1, 2, 3]) {
    const image = decodeJpeg(tinyJpeg(values, { columns: 3, restart }));
    assert.deepEqual([image.width, image.height], [24, 16]);
    assert.deepEqual(flat(image), values, `интервал ${restart}`);
    // Блок залит ровно: углы те же, что середина.
    assert.equal(image.data[0], 40);
    assert.equal(image.data[(15 * 24 + 23) * 3], 0);
  }

  // Не JPEG, обрезанный файл, чужая разновидность — исключение, а не зависание и не мусор молча.
  assert.throws(() => decodeJpeg(new Uint8Array([1, 2, 3, 4, 5])), /not a jpeg/u);
  assert.throws(() => decodeJpeg(PALETTE_PNG), /not a jpeg/u);
  assert.throws(() => decodeJpeg(PHOTO_BASE.subarray(0, 40)), /no frame|bad segment|missing/u);
  const arithmetic = PHOTO_BASE.slice();
  arithmetic[arithmetic.findIndex((value, index) => value === 0xFF && arithmetic[index + 1] === 0xC0) + 1] = 0xC9;
  assert.throws(() => decodeJpeg(arithmetic), /unsupported jpeg kind/u);
  // Обрыв посреди данных: что успело — прочитано, остальное серое; главное — без исключения и зависания.
  const torn = decodeJpeg(PHOTO_BASE.subarray(0, PHOTO_BASE.length - 60));
  assert.deepEqual([torn.width, torn.height], [45, 31]);
});

test("PNG читается своим кодом: прозрачность, палитра в 2 бита, 16 бит — как у ImageMagick; чересстрочный — отказ", async () => {
  const figure = await decodePng(FIGURE_PNG);
  assert.deepEqual([figure.width, figure.height, Boolean(figure.alpha)], [40, 30, true]);
  for (const [x, y, ...want] of SAMPLES.FIGURE_PNG) {
    const got = point(figure, x, y);
    assert.equal(got[3], want[3], `прозрачность в ${x},${y}`);
    if (want[3]) close(got, want, 0, `цвет в ${x},${y}`);
  }
  const palette = await decodePng(PALETTE_PNG);
  assert.deepEqual([palette.width, palette.height, palette.alpha], [24, 16, null]);
  for (const [x, y, ...want] of SAMPLES.PALETTE_PNG) close(point(palette, x, y), want, 0, `палитра, точка ${x},${y}`);
  const deep = await decodePng(DEEP_PNG);
  for (const [x, y, ...want] of SAMPLES.DEEP_PNG) close(point(deep, x, y), want, 1, `16 бит, точка ${x},${y}`);
  const interlaced = PALETTE_PNG.slice();
  interlaced[28] = 1;
  await assert.rejects(decodePng(interlaced), /interlaced/u);
  await assert.rejects(decodePng(PHOTO_BASE), /not a png/u);
});

test("стикер: PNG 512 точек с палитрой, легче 512 КБ; ровный фон срезан и обведён белым, пёстрый — со скруглёнными углами", async () => {
  // Пёстрая картинка: фон не трогается, углы скруглены, пропорции сохранены.
  const photo = await toSticker(PHOTO_BASE);
  assert.deepEqual([photo.ok, photo.width, photo.height, photo.cut], [true, 512, 353, false]);
  assert.ok(photo.bytes.length <= STICKER_MAX_BYTES);
  const read = readPng(photo.bytes);
  assert.deepEqual([read.width, read.height], [512, 353]);
  assert.equal(read.at(0, 0)[3], 0, "угол прозрачен");
  assert.equal(read.at(511, 352)[3], 0);
  assert.equal(read.at(256, 2)[3], 255, "середина края — на месте");
  assert.ok(read.clear < 0.02, "срезаны только углы");
  assert.ok(read.colours > 100, "палитра подобрана по картинке");
  // Цвет в середине — тот же, что в исходной картинке (с поправкой на палитру и размывание ошибки).
  const [, , ...centre] = SAMPLES.PHOTO_BASE[1];
  close(read.at(256, 176), centre, 24, "середина фото");

  // Фигура на белом листе: лист срезан, фигура растянута на весь стикер и обведена белым.
  const figure = await toSticker(FIGURE_JPG);
  assert.deepEqual([figure.ok, figure.cut, Math.max(figure.width, figure.height)], [true, true, 512]);
  const cutout = readPng(figure.bytes);
  assert.equal(cutout.at(0, 0)[3], 0);
  assert.ok(cutout.clear > 0.15 && cutout.clear < 0.35, `от листа остались только углы вокруг круга: ${cutout.clear}`);
  const middle = Math.floor(cutout.height / 2);
  let first = 0;
  while (cutout.at(first, middle)[3] === 0) first += 1;
  assert.ok(first <= 12, `фигура растянута почти до края стикера: ${first}`);
  close(cutout.at(first, middle), [255, 255, 255, 255], 6, "снаружи — белая обводка");
  let inner = first;
  while (cutout.at(inner, middle)[0] > 200) inner += 1;
  assert.ok(inner - first >= 5 && inner - first <= 24, `обводка — несколько точек: ${inner - first}`);
  const dark = cutout.at(inner + 6, middle);
  assert.ok(dark[0] < 110 && dark[1] < 90, `за обводкой — тёмный контур круга: ${dark}`);
  const core = cutout.at(Math.floor(cutout.width / 2), middle);
  assert.ok(core[2] > 150 && core[0] < 120, `в середине — синее пятно: ${core}`);
  // Без среза фона тот же рисунок — квадрат со скруглёнными углами.
  const whole = await toSticker(FIGURE_JPG, { background: false });
  assert.deepEqual([whole.cut, whole.width, whole.height], [false, 512, 512]);
  close(readPng(whole.bytes).at(30, 256), [255, 255, 255, 255], 6, "лист на месте");

  // Картинка, у которой прозрачность уже есть: только обрезка по видимому, без обводки.
  const ready = await toSticker(FIGURE_PNG);
  assert.deepEqual([ready.ok, ready.cut, ready.width, ready.height], [true, false, 512, 512]);
  const shape = readPng(ready.bytes);
  assert.equal(shape.at(3, 3)[3], 0, "вокруг круга — прозрачно");
  close(shape.at(256, 256), [240, 224, 64, 255], 4, "жёлтый квадрат в середине");
  close(shape.at(256, 40), [32, 160, 96, 255], 4, "зелёный круг");

  // Срез фона — только когда рамка ровная: градиент и фигура у самого края остаются как были.
  const gradient = await decodePng(DEEP_PNG);
  assert.equal(cutBackground(gradient), false);
  assert.equal(gradient.alpha ?? null, null);
  assert.equal((await toSticker(DEEP_PNG)).cut, false);

  // Среда без потока сжатия: PNG всё равно верный (блоки без сжатия) и всё равно легче предела.
  const stream = globalThis.CompressionStream;
  try {
    delete globalThis.CompressionStream;
    const plain = await toSticker(PHOTO_BASE);
    assert.equal(plain.ok, true);
    assert.ok(plain.bytes.length > 180_000 && plain.bytes.length <= STICKER_MAX_BYTES, `без сжатия: ${plain.bytes.length}`);
    const again = readPng(plain.bytes);
    assert.deepEqual(again.at(256, 176), read.at(256, 176), "точки те же");
  } finally { globalThis.CompressionStream = stream; }

  // Не картинка, чужой вид, слишком большая — код отказа, а не исключение.
  assert.deepEqual(await toSticker(new Uint8Array(40)), { ok: false, code: "bad_image" });
  assert.deepEqual(await toSticker(null), { ok: false, code: "bad_image" });
  assert.deepEqual(await toSticker(new TextEncoder().encode("RIFF....WEBPVP8 это не то, что я умею читать")), { ok: false, code: "bad_image" });
  const huge = PHOTO_BASE.slice();
  const frame = huge.findIndex((value, index) => value === 0xFF && huge[index + 1] === 0xC0);
  huge[frame + 5] = 0x20; // высота 8223 точки
  assert.deepEqual(await toSticker(huge), { ok: false, code: "too_big" });
  const torn = await toSticker(PHOTO_BASE.subarray(0, 200));
  assert.equal(typeof torn.ok, "boolean");
  // ArrayBuffer и «вид» на чужой буфер — тоже байты.
  assert.equal((await toSticker(PHOTO_BASE.buffer.slice(PHOTO_BASE.byteOffset, PHOTO_BASE.byteOffset + PHOTO_BASE.length))).ok, true);
});

const photoOf = (id = 40) => ({ message_id: id, from: { id: 999, is_bot: true }, photo: [{ file_id: "small", width: 320, height: 320 }, { file_id: "mid", width: 800, height: 800 }, { file_id: "big", width: 1280, height: 1280 }] });
/** Telegram в стабе: загрузка возвращает номер файла, набор — столько стикеров, сколько в него положили. */
function telegram() {
  const set = [];
  sdk().apiReplies.uploadStickerFile = () => ({ file_id: `up${calls("uploadStickerFile").length}` });
  sdk().apiReplies.createNewStickerSet = (params) => { set.length = 0; set.push({ file_id: `st${params.stickers[0].sticker.slice(2)}` }); return true; };
  sdk().apiReplies.addStickerToSet = (params) => { set.push({ file_id: `st${params.sticker.sticker.slice(2)}` }); return true; };
  sdk().apiReplies.getStickerSet = (params) => ({ name: params.name, stickers: [...set] });
  sdk().apiReplies.deleteStickerFromSet = (params) => { const index = set.findIndex(item => item.file_id === params.sticker); if (index >= 0) set.splice(index, 1); return true; };
  return set;
}

test("«сделай стикер» ответом на картинку: PNG в набор человека, стикер — в чат, ссылка — словами", async () => {
  reset();
  const set = telegram();
  sdk().apiReplies.getFileContent = FIGURE_JPG;
  const h = heart({}, { now: () => NOON });
  const result = await h.onMessage(message("сделай стикер 😺", { reply: photoOf() }), KEY);
  assert.deepEqual([result.ok, result.kind], [true, "sticker"]);
  assert.deepEqual(calls("getFileContent"), ["mid"], "скачан размер, которого хватает на 512 точек");
  const upload = calls("uploadStickerFile")[0];
  assert.deepEqual([upload.user_id, upload.sticker_format, upload.sticker.name, upload.sticker.type], [5, "static", "sticker.png", "image/png"]);
  const png = readPng(upload.sticker.bytes);
  assert.equal(Math.max(png.width, png.height), 512, "большая сторона — ровно 512");
  assert.ok(upload.sticker.bytes.length <= STICKER_MAX_BYTES);
  assert.deepEqual(calls("createNewStickerSet"), [{ user_id: 5, name: "ai5_by_ai_heart_bot", title: "Аи: стикеры", stickers: [{ sticker: "up1", format: "static", emoji_list: ["😺"] }], sticker_type: "regular" }]);
  assert.deepEqual(calls("sendSticker"), [{ chat_id: 5, sticker: "st1" }], "в чат уходит стикер из набора, а не загруженный файл");
  assert.equal(last(), "Готово — стикер в вашем наборе: t.me/addstickers/ai5_by_ai_heart_bot\nВ нём 1 стикер. Последний убирается словами «удали последний стикер».");
  assert.equal(chats().length, 0, "модель на стикер не тратится");
  assert.deepEqual(calls("sendChatAction").map(item => item.action), ["choose_sticker"]);

  // Второй — в тот же набор; смайлик по умолчанию — палитра; подпись к картинке — тоже просьба.
  await h.onMessage(message(null, { extra: { caption: "в стикер", photo: photoOf().photo } }), KEY);
  assert.equal(calls("createNewStickerSet").length, 1);
  assert.deepEqual(calls("addStickerToSet"), [{ user_id: 5, name: "ai5_by_ai_heart_bot", sticker: { sticker: "up2", format: "static", emoji_list: ["🎨"] } }]);
  assert.deepEqual(calls("sendSticker").at(-1), { chat_id: 5, sticker: "st2" });
  assert.match(last(), /\nВ нём 2 стикера\./u);
  assert.deepEqual([kv(PACK_KEY(5)).name, kv(PACK_KEY(5)).n, kv(PACK_KEY(5)).last, kv(PACK_KEY(5)).used], ["ai5_by_ai_heart_bot", 2, "st2", 2]);

  await h.onMessage(message("мои стикеры"), KEY);
  assert.equal(last(), "Ваш набор: t.me/addstickers/ai5_by_ai_heart_bot\nВ нём 2 стикера. Набор ваш: целиком его удаляет @Stickers.");
  await h.onMessage(message("удали последний стикер"), KEY);
  assert.deepEqual(calls("deleteStickerFromSet"), [{ sticker: "st2" }]);
  assert.equal(last(), "Убрала последний стикер из набора.");
  assert.deepEqual(set.map(item => item.file_id), ["st1"]);
  await h.onMessage(message("удали последний стикер"), KEY);
  assert.equal(last(), "Последнего стикера я не помню: либо его не было, либо он уже убран.");
  assert.equal(calls("deleteStickerFromSet").length, 1);

  // Набор удалили у @Stickers: добавить некуда — она создаёт его заново.
  sdk().failing.addStickerToSet = new Error("Bad Request: STICKERSET_INVALID");
  await h.onMessage(message("сделай стикер", { reply: photoOf() }), KEY);
  delete sdk().failing.addStickerToSet;
  assert.equal(calls("createNewStickerSet").length, 2);
  assert.match(last(), /^Готово — стикер в вашем наборе/u);
  // Записи нет, а набор в Telegram есть (она всё забыла): имя занято — значит, добавить.
  sdk().kv.delete(PACK_KEY(5));
  sdk().failing.createNewStickerSet = new Error("Bad Request: sticker set name is already occupied");
  await h.onMessage(message("сделай стикер", { reply: photoOf() }), KEY);
  delete sdk().failing.createNewStickerSet;
  assert.equal(calls("addStickerToSet").at(-1).name, "ai5_by_ai_heart_bot");
  assert.match(last(), /^Готово — стикер в вашем наборе/u);
  // Набор полон: следующий стикер начинает второй набор.
  sdk().failing.addStickerToSet = new Error("Bad Request: STICKERS_TOO_MUCH");
  await h.onMessage(message("сделай стикер", { reply: photoOf() }), KEY);
  delete sdk().failing.addStickerToSet;
  assert.deepEqual([calls("createNewStickerSet").at(-1).name, calls("createNewStickerSet").at(-1).title], ["ai5x2_by_ai_heart_bot", "Аи: стикеры (2)"]);
  assert.match(last(), /t\.me\/addstickers\/ai5x2_by_ai_heart_bot\nВ нём 1 стикер\./u);
  assert.equal(kv(PACK_KEY(5)).part, 2);
  // Telegram ещё не показал новый стикер в наборе: в чат уходит только ссылка, без чужого стикера.
  const sent = calls("sendSticker").length;
  sdk().apiReplies.getStickerSet = () => ({ stickers: [] });
  await h.onMessage(message("сделай стикер", { reply: photoOf() }), KEY);
  assert.equal(calls("sendSticker").length, sent);
  assert.match(last(), /^Готово — стикер в вашем наборе: t\.me\/addstickers\/ai5x2_by_ai_heart_bot\nВ нём 2 стикера\./u);

  // «Удали всё обо мне» стирает и запись о наборе; сам набор остаётся человеку.
  await h.onMessage(message("удали всё обо мне"), KEY);
  await h.onMessage(message("да, удали всё"), KEY);
  assert.equal(sdk().kv.has(PACK_KEY(5)), false);
  await h.onMessage(message("мои стикеры"), KEY);
  assert.match(last(), /^Набора пока нет/u);
});

test("стикер: чего нельзя и что не вышло — словами; предел на человека; выключатель", async () => {
  reset();
  telegram();
  sdk().apiReplies.getFileContent = PHOTO_BASE;
  const h = heart({ STICKER_DAILY: 2 }, { now: () => NOON });
  await h.onMessage(message("сделай стикер"), KEY);
  assert.equal(last(), "Из чего? Ответьте словами «сделай стикер» на картинку — мою или любую — или пришлите картинку с такой подписью. А «нарисуй стикер: кот в шляпе» — нарисую и сразу сделаю.");
  await h.onMessage(message("сделай стикер", { reply: { message_id: 41, sticker: { file_id: "st" } } }), KEY);
  assert.equal(last(), "Это уже стикер — делать из него нечего. Нужна картинка.");
  await h.onMessage(message("сделай стикер", { reply: { message_id: 42, document: { file_id: "w", mime_type: "image/webp" } } }), KEY);
  assert.equal(last(), "Из такого файла стикер я не сделаю: умею JPEG и PNG. Пришлите картинку как фото.");
  await h.onMessage(message("сделай стикер", { reply: { message_id: 43, document: { file_id: "h", mime_type: "image/png", file_size: 20_000_000 } } }), KEY);
  assert.match(last(), /^Файл слишком тяжёлый для стикера\./u);
  assert.equal(calls("getFileContent").length, 0, "до сих пор ничего не скачано");
  await h.onMessage(message("нарисуй стикер"), KEY);
  assert.equal(last(), "Что нарисовать стикером? Например: «нарисуй стикер: кот в шляпе».");
  await h.onMessage(message("нарисуй стикер: кот в шляпе"), KEY);
  assert.match(last(), /^Рисовать я не умею: художника у меня нет\. А стикер из готовой картинки сделаю/u);

  // Скачать не вышло; скачалось не то.
  sdk().failing.getFileContent = new Error("400");
  await h.onMessage(message("сделай стикер", { reply: photoOf() }), KEY);
  assert.equal(last(), "Скачать картинку из Telegram не вышло. Попробуйте ещё раз.");
  delete sdk().failing.getFileContent;
  sdk().apiReplies.getFileContent = new Uint8Array(300).fill(7);
  await h.onMessage(message("сделай стикер", { reply: photoOf() }), KEY);
  assert.equal(last(), "Стикер не вышел: эту картинку я разобрать не смогла — умею JPEG и PNG.");
  assert.equal(calls("uploadStickerFile").length, 0);
  assert.equal(kv(PACK_KEY(5)), null, "неудача в счёт не идёт");

  // Человек не открывал с ней личку: набор ему не собрать — заготовка уходит файлом, с причиной.
  sdk().apiReplies.getFileContent = PHOTO_BASE;
  sdk().failing.uploadStickerFile = new Error("Bad Request: PEER_ID_INVALID");
  await h.onMessage(group("Аи, сделай стикер", { id: 21, reply: photoOf() }), KEY);
  delete sdk().failing.uploadStickerFile;
  assert.equal(calls("sendSticker").length, 0);
  const file = calls("sendDocument").at(-1);
  assert.deepEqual([file.chat_id, file.document.name, file.document.type], [-10, "sticker.png", "image/png"]);
  assert.equal(readPng(file.document.bytes).width, 512);
  assert.equal(file.caption, "Стикер готов (PNG, 512×353), но в набор не лёг: собирать набор я могу только тому, кто открыл со мной личку — напишите мне там «Старт» и повторите. Этот файл принимает @Stickers — им набор собирается вручную.");
  // Telegram отказал по другой причине: хозяину — его слова, остальным — без подробностей.
  sdk().failing.createNewStickerSet = new Error("Bad Request: STICKER_PNG_DIMENSIONS");
  await h.onMessage(message("сделай стикер", { reply: photoOf() }), KEY);
  assert.match(calls("sendDocument").at(-1).caption, /но в набор не лёг: Telegram набор не принял\. Этот файл принимает @Stickers/u);
  await h.onMessage(message("сделай стикер", { id: OWNER, reply: photoOf() }), KEY);
  assert.match(calls("sendDocument").at(-1).caption, /Telegram набор не принял \(«Bad Request: STICKER_PNG_DIMENSIONS»\)\./u);
  delete sdk().failing.createNewStickerSet;

  // Предел: два стикера в день на человека (заготовка файлом — тоже работа); хозяину предела нет.
  assert.equal(kv(PACK_KEY(5)).used, 1);
  await h.onMessage(message("сделай стикер", { reply: photoOf() }), KEY);
  assert.match(last(), /^Готово — стикер в вашем наборе/u);
  const before = calls("uploadStickerFile").length;
  await h.onMessage(message("сделай стикер", { reply: photoOf() }), KEY);
  assert.equal(last(), "На сегодня стикеров хватит: 2 за день — мой предел на человека. Завтра продолжим.");
  assert.equal(calls("uploadStickerFile").length, before);
  for (let index = 0; index < 3; index += 1) await h.onMessage(message("сделай стикер", { id: OWNER, reply: photoOf() }), KEY);
  assert.match(toChat(OWNER).at(-1).text, /^Готово — стикер в вашем наборе: t\.me\/addstickers\/ai7_by_ai_heart_bot\nВ нём 3 стикера\./u);

  // Выключатель: слова уходят в разговор.
  reset();
  const off = heart({ STICKERS: false }, { now: () => NOON });
  sdk().fetchQueue.push(says("Стикеры я не делаю."));
  await off.onMessage(message("сделай стикер", { reply: photoOf() }), KEY);
  assert.equal(last(), "Стикеры я не делаю.");
  assert.equal(calls("getFileContent").length, 0);
});

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const DRAW = { DRAW_KEY: `${ACCOUNT}:cf-token_ABCDEFGH-1234567890xyz`, DRAW_DIRECTOR: false };
const painted = (bytes) => ({ success: true, result: { image: Buffer.from(bytes).toString("base64") } });

test("«нарисуй стикер: кот в шляпе» — рисунок сразу стикером; «сделай стикер» после рисунка — из него же", async () => {
  reset();
  telegram();
  source("m2m100", { success: true, result: { translated_text: "a cat in a hat" } });
  source("flux-1-schnell", painted(FIGURE_JPG));
  const h = heart(DRAW, { now: () => NOON });
  const result = await h.onMessage(message("нарисуй стикер: кота в шляпе 🐱"), KEY);
  assert.deepEqual([result.ok, result.kind], [true, "sticker"]);
  const asked = JSON.parse(sdk().sourceFetches.find(item => item.url.includes("flux-1-schnell")).options.body);
  assert.ok(asked.prompt.startsWith("a cat in a hat") && asked.prompt.endsWith(STICKER_STYLE), asked.prompt);
  assert.doesNotMatch(asked.prompt, /[а-яё]/iu, "русских слов художнику не уходит");
  assert.equal(calls("sendPhoto").length, 0, "картинкой рисунок не дублируется");
  assert.deepEqual(calls("createNewStickerSet")[0].stickers[0].emoji_list, ["🐱"]);
  assert.deepEqual(calls("sendSticker"), [{ chat_id: 5, sticker: "st1" }]);
  assert.match(last(), /^Готово — стикер в вашем наборе/u);
  // Рисунок посчитан как рисунок: дневная норма красок общая.
  const drawnKey = [...sdk().kv.keys()].find(key => key.startsWith("heart:drawn:") && key.endsWith(":5"));
  assert.equal(kv(drawnKey).n, 1);

  // Набор не собрался — рисунок не пропадает: уходит картинкой, с причиной.
  sdk().failing.uploadStickerFile = new Error("Bad Request: PEER_ID_INVALID");
  sdk().failing.sendDocument = new Error("400");
  await h.onMessage(message("нарисуй стикер: кота в шляпе"), KEY);
  delete sdk().failing.uploadStickerFile;
  delete sdk().failing.sendDocument;
  assert.equal(calls("sendPhoto").length, 1);
  assert.equal(calls("sendPhoto")[0].caption, "Стикером не вышло: отправить файл мне сейчас нечем. Вот сам рисунок.");

  // Обычный рисунок, а потом «сделай стикер» без ответа: берётся он же, по номеру файла из Telegram.
  sdk().apiReplies.sendPhoto = () => ({ message_id: 77, photo: [{ file_id: "drawn-s", width: 320, height: 320 }, { file_id: "drawn-l", width: 1024, height: 1024 }] });
  sdk().apiReplies.getFileContent = FIGURE_JPG;
  await h.onMessage(message("нарисуй кота в шляпе"), KEY);
  assert.equal(calls("sendPhoto").length, 2);
  assert.doesNotMatch(JSON.parse(sdk().sourceFetches.filter(item => item.url.includes("flux-1-schnell")).at(-1).options.body).prompt, /sticker/u, "обычному рисунку приписки нет");
  await h.onMessage(message("сделай из этого стикер"), KEY);
  assert.deepEqual(calls("getFileContent"), ["drawn-l"]);
  assert.match(last(), /^Готово — стикер в вашем наборе/u);
  // В другом чате её рисунка нет — спрашивает, из чего.
  await h.onMessage(message("сделай стикер", { id: 6 }), KEY);
  assert.match(toChat(6).at(-1).text, /^Из чего\?/u);
});
