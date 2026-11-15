/**
 * Стикер из рисунка: картинка (JPEG или PNG) → PNG 512 точек по большей стороне,
 * не тяжелее 512 КБ — то, что Telegram принимает стикером.
 *
 * Зависимостей у проекта нет, поэтому всё здесь своё и на чистых массивах:
 *   • разбор JPEG — обычный и прогрессивный, любая прореженность цвета,
 *     интервалы перезапуска (художник отдаёт JPEG 1024×1024, Telegram — тоже JPEG);
 *   • разбор PNG — 8 бит на канал, без чересстрочности (распаковка — средой);
 *   • уменьшение усреднением, скруглённые прозрачные углы;
 *   • палитра на 255 цветов (медианное сечение) с размыванием ошибки — такой PNG
 *     весит не больше 263 КБ даже вовсе без сжатия, а со сжатием среды — втрое меньше.
 *
 * Ничего не бросает наружу: `toSticker` возвращает `{ ok, bytes, width, height, cut }`
 * или `{ ok: false, code }` — bad_image (не картинка или незнакомый вид), too_big (сторона
 * больше 4096), no_inflate (PNG, а распаковать его в этой среде нечем), failed (остальное).
 */

export const STICKER_SIDE = 512;
export const STICKER_MAX_BYTES = 512 * 1024;
/** Тяжелее этого картинку для стикера она не скачивает. */
export const STICKER_SOURCE_MAX = 6 * 1024 * 1024;
/** Приписка художнику, когда рисунок сразу пойдёт в стикер: фигура на чистом листе вырезается сама. */
export const STICKER_STYLE = "sticker illustration, die-cut sticker with a thick white outline, flat colors, simple plain white background, centered";
/** Набор человека: до 120 стикеров, потом начинается следующий. */
export const PACK_KEY = (userId) => `heart:pack:${userId}`;
const MAX_SIDE = 4096;

// ── слова ──────────────────────────────────────────────────────────────────
const fold = (value) => String(value ?? "").toLowerCase().replace(/ё/gu, "е").replace(/[«»"“”„]/gu, "").replace(/\s+/gu, " ").trim();
const EMOJI = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}\uFE0F?)*/gu;
/** «Из этого», «из моей фотки», «из последнего рисунка» — про готовую картинку, а не про то, что нарисовать. */
const READY = /^(?:этого|этой|этих|него|нее|этого\s+всего|всего\s+этого|(?:(?:эт|мо|тво|сво|последн|прошл)[а-я]*\s+)?(?:рисунка|картинки|фото|фотки|фотографии|изображения|аватарки|арта|мема|пикчи))$/u;
const THING = "(?:стикер|стикером|стикеры|наклейку|наклейкой)";

/**
 * Слова о стикерах:
 *   { make: true, emoji }           — «сделай стикер»: ответом на картинку, подписью к ней или сразу после рисунка;
 *   { draw: "кот в шляпе", emoji }  — «нарисуй стикер: кот в шляпе» (пустая строка — не сказано, что рисовать);
 *   { pack: true }                  — «мои стикеры»;
 *   { drop: true }                  — «удали последний стикер».
 * `emoji` — смайлики из просьбы (до трёх): под ними стикер ляжет в набор.
 * «Пришли стикер», «что за стикер», «люблю стикеры» — не сюда.
 */
export function parseStickerAsk(value) {
  const raw = String(value ?? "");
  if (raw.length > 260) return null;
  const emoji = [...new Set(raw.match(EMOJI) ?? [])].slice(0, 3);
  const text = fold(raw.replace(EMOJI, " ")).replace(/[.!?…]+$/u, "").replace(/,?\s*(?:пожалуйста|плиз|пж)$/u, "").trim();
  if (!text || !/стикер|наклейк/u.test(text)) return null;
  if (/^(?:покажи\s+|где\s+|дай\s+)?(?:мои\s+стикеры|мой\s+(?:набор\s+стикеров|стикерпак|стикер-пак)|(?:ссылк[ау]|ссылочк[ау])\s+на\s+(?:мои\s+стикеры|мой\s+(?:набор\s+стикеров|стикерпак)))$/u.test(text)) return { pack: true };
  if (/^(?:удали|убери|сотри)\s+(?:последний|прошлый)\s+стикер(?:\s+из\s+(?:моего\s+)?набора)?$/u.test(text)) return { drop: true };
  // «Сделай стикер», «сделай из этого стикер», «преврати это в стикер», «стикер из этого», «в стикер».
  const from = text.match(new RegExp(`^(?:а\\s+)?(?:(?:сделай|сделаешь|сделайте|создай|собери|хочу|можешь\\s+сделать|можно)\\s+)?(?:мне\\s+)?${THING}\\s+из\\s+(.{2,60})$`, "u"));
  if (from && READY.test(from[1])) return { make: true, emoji };
  const into = text.match(new RegExp(`^(?:а\\s+)?(?:сделай|сделаешь|сделайте|создай|собери|преврати|переделай|сохрани|добавь|хочу|можешь\\s+сделать|можно)\\s+(?:мне\\s+)?(?:из\\s+(.{2,60}?)\\s+|это\\s+|его\\s+|ее\\s+)?(?:в\\s+)?${THING}$`, "u"));
  if (into && (into[1] == null || READY.test(into[1]))) return { make: true, emoji };
  if (/^(?:это\s+|его\s+|ее\s+)?в\s+(?:стикер|стикеры|наклейку)$/u.test(text)) return { make: true, emoji };
  if (/^(?:сделай|добавь|сохрани)\s+(?:это\s+|его\s+|ее\s+)?в\s+(?:мой\s+)?(?:набор\s+стикеров|стикерпак|стикеры)$/u.test(text)) return { make: true, emoji };
  // «Нарисуй стикер: кот в шляпе», «стикер: кот в шляпе» — описание после знака.
  const titled = raw.replace(EMOJI, " ").replace(/\s+/gu, " ").trim().match(/^(?:(?:нарисуй|нарисуйте|изобрази|создай|сделай|сгенерируй|придумай)\s+(?:мне\s+)?)?(?:стикер|наклейк[ау])\s*[:—–-]\s*(.{2,200})$/iu);
  if (titled) return { draw: titled[1].replace(/[.!?…]+$/u, "").trim(), emoji };
  // «Нарисуй стикер с котом», «сделай стикер про осень» — просьба целиком уходит художнику.
  const drawn = text.match(/^(?:нарисуй|нарисуйте|изобрази|сгенерируй)\s+(?:мне\s+)?((?:стикер|наклейку)(?:\s+.{2,200})?)$/u)
    ?? text.match(/^(?:сделай|создай|придумай)\s+(?:мне\s+)?((?:стикер|наклейку)\s+(?:с|со|про|где|в\s+виде|как)\s+.{2,200})$/u);
  if (drawn) return { draw: /^(?:стикер|наклейку)$/u.test(drawn[1]) ? "" : drawn[1], emoji };
  return null;
}

/** Картинка в сообщении, из которой выйдет стикер: фото (наименьший размер не меньше 512 точек) или файл JPEG/PNG. */
export function stickerSource(message) {
  if (!message) return null;
  if (Array.isArray(message.photo) && message.photo.length) {
    const side = (item) => Math.max(Number(item?.width) || 0, Number(item?.height) || 0);
    const sizes = message.photo.filter(item => item?.file_id).sort((a, b) => side(a) - side(b));
    const pick = sizes.find(item => side(item) >= STICKER_SIDE) ?? sizes.at(-1);
    return pick ? { file_id: pick.file_id } : null;
  }
  const file = message.document;
  if (file?.file_id && /^image\/(?:jpeg|png)$/u.test(String(file.mime_type ?? ""))) return Number(file.file_size) > STICKER_SOURCE_MAX ? { heavy: true } : { file_id: file.file_id };
  if (file?.file_id && /^image\//u.test(String(file.mime_type ?? ""))) return { foreign: true };
  if (message.sticker) return { sticker: true };
  return null;
}

/** Имя набора: латиница, цифры и одно подчёркивание подряд; в конце обязательно «_by_<имя бота>». */
export const packName = (userId, part, botUsername) => `ai${String(userId).replace(/\D/gu, "")}${part > 1 ? `x${part}` : ""}_by_${String(botUsername).replace(/^@/u, "")}`;

// ── JPEG ───────────────────────────────────────────────────────────────────
const ZIGZAG = new Uint8Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]);

/** Таблица Хаффмана: по длинам кодов — наименьший и наибольший код каждой длины и где лежат значения. */
function huffmanTable(lengths, values) {
  const min = new Int32Array(17), max = new Int32Array(17).fill(-1), at = new Int32Array(17);
  let code = 0, index = 0;
  for (let length = 1; length <= 16; length += 1) {
    at[length] = index - code;
    min[length] = code;
    if (lengths[length - 1]) { code += lengths[length - 1]; index += lengths[length - 1]; max[length] = code - 1; }
    code <<= 1;
  }
  return { min, max, at, values };
}

/** Обратное косинусное преобразование блока 8×8 (целочисленное, по строкам и столбцам). */
function inverseBlock(coefficients, offset, table, out, scratch) {
  const C1 = 4017, S1 = 799, C3 = 3406, S3 = 2276, C6 = 1567, S6 = 3784, SQRT2 = 5793, SQRT1_2 = 2896;
  let v0, v1, v2, v3, v4, v5, v6, v7, t;
  for (let i = 0; i < 64; i += 1) scratch[i] = coefficients[offset + i] * table[i];
  for (let row = 0; row < 64; row += 8) {
    if (!scratch[row + 1] && !scratch[row + 2] && !scratch[row + 3] && !scratch[row + 4] && !scratch[row + 5] && !scratch[row + 6] && !scratch[row + 7]) {
      t = (SQRT2 * scratch[row] + 512) >> 10;
      for (let i = 0; i < 8; i += 1) scratch[row + i] = t;
      continue;
    }
    v0 = (SQRT2 * scratch[row] + 128) >> 8; v1 = (SQRT2 * scratch[row + 4] + 128) >> 8; v2 = scratch[row + 2]; v3 = scratch[row + 6];
    v4 = (SQRT1_2 * (scratch[row + 1] - scratch[row + 7]) + 128) >> 8; v7 = (SQRT1_2 * (scratch[row + 1] + scratch[row + 7]) + 128) >> 8;
    v5 = scratch[row + 3] << 4; v6 = scratch[row + 5] << 4;
    t = (v0 - v1 + 1) >> 1; v0 = (v0 + v1 + 1) >> 1; v1 = t;
    t = (v2 * S6 + v3 * C6 + 128) >> 8; v2 = (v2 * C6 - v3 * S6 + 128) >> 8; v3 = t;
    t = (v4 - v6 + 1) >> 1; v4 = (v4 + v6 + 1) >> 1; v6 = t;
    t = (v7 + v5 + 1) >> 1; v5 = (v7 - v5 + 1) >> 1; v7 = t;
    t = (v0 - v3 + 1) >> 1; v0 = (v0 + v3 + 1) >> 1; v3 = t;
    t = (v1 - v2 + 1) >> 1; v1 = (v1 + v2 + 1) >> 1; v2 = t;
    t = (v4 * S3 + v7 * C3 + 2048) >> 12; v4 = (v4 * C3 - v7 * S3 + 2048) >> 12; v7 = t;
    t = (v5 * S1 + v6 * C1 + 2048) >> 12; v5 = (v5 * C1 - v6 * S1 + 2048) >> 12; v6 = t;
    scratch[row] = v0 + v7; scratch[row + 7] = v0 - v7; scratch[row + 1] = v1 + v6; scratch[row + 6] = v1 - v6;
    scratch[row + 2] = v2 + v5; scratch[row + 5] = v2 - v5; scratch[row + 3] = v3 + v4; scratch[row + 4] = v3 - v4;
  }
  for (let col = 0; col < 8; col += 1) {
    if (!scratch[col + 8] && !scratch[col + 16] && !scratch[col + 24] && !scratch[col + 32] && !scratch[col + 40] && !scratch[col + 48] && !scratch[col + 56]) {
      t = (SQRT2 * scratch[col] + 8192) >> 14;
      for (let i = 0; i < 64; i += 8) scratch[col + i] = t;
      continue;
    }
    v0 = (SQRT2 * scratch[col] + 2048) >> 12; v1 = (SQRT2 * scratch[col + 32] + 2048) >> 12; v2 = scratch[col + 16]; v3 = scratch[col + 48];
    v4 = (SQRT1_2 * (scratch[col + 8] - scratch[col + 56]) + 2048) >> 12; v7 = (SQRT1_2 * (scratch[col + 8] + scratch[col + 56]) + 2048) >> 12;
    v5 = scratch[col + 24]; v6 = scratch[col + 40];
    t = (v0 - v1 + 1) >> 1; v0 = (v0 + v1 + 1) >> 1; v1 = t;
    t = (v2 * S6 + v3 * C6 + 2048) >> 12; v2 = (v2 * C6 - v3 * S6 + 2048) >> 12; v3 = t;
    t = (v4 - v6 + 1) >> 1; v4 = (v4 + v6 + 1) >> 1; v6 = t;
    t = (v7 + v5 + 1) >> 1; v5 = (v7 - v5 + 1) >> 1; v7 = t;
    t = (v0 - v3 + 1) >> 1; v0 = (v0 + v3 + 1) >> 1; v3 = t;
    t = (v1 - v2 + 1) >> 1; v1 = (v1 + v2 + 1) >> 1; v2 = t;
    t = (v4 * S3 + v7 * C3 + 2048) >> 12; v4 = (v4 * C3 - v7 * S3 + 2048) >> 12; v7 = t;
    t = (v5 * S1 + v6 * C1 + 2048) >> 12; v5 = (v5 * C1 - v6 * S1 + 2048) >> 12; v6 = t;
    scratch[col] = v0 + v7; scratch[col + 56] = v0 - v7; scratch[col + 8] = v1 + v6; scratch[col + 48] = v1 - v6;
    scratch[col + 16] = v2 + v5; scratch[col + 40] = v2 - v5; scratch[col + 24] = v3 + v4; scratch[col + 32] = v3 - v4;
  }
  for (let i = 0; i < 64; i += 1) {
    const sample = 128 + ((scratch[i] + 8) >> 4);
    out[i] = sample < 0 ? 0 : sample > 255 ? 255 : sample;
  }
}

/** JPEG → `{ width, height, data }`, где data — RGB по три байта на точку. Бросает на незнакомом. */
export function decodeJpeg(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) throw new Error("not a jpeg");
  const quant = [], dc = [], ac = [];
  let frame = null, restart = 0, adobe = -1, at = 2;
  const word = () => { const value = (bytes[at] << 8) | bytes[at + 1]; at += 2; return value; };

  function prepare() {
    frame.maxH = Math.max(...frame.components.map(item => item.h));
    frame.maxV = Math.max(...frame.components.map(item => item.v));
    frame.mcusPerLine = Math.ceil(frame.width / 8 / frame.maxH);
    frame.mcusPerColumn = Math.ceil(frame.height / 8 / frame.maxV);
    for (const item of frame.components) {
      item.blocksPerLine = Math.ceil(Math.ceil(frame.width / 8) * item.h / frame.maxH);
      item.blocksPerColumn = Math.ceil(Math.ceil(frame.height / 8) * item.v / frame.maxV);
      item.lineBlocks = frame.mcusPerLine * item.h;
      item.columnBlocks = frame.mcusPerColumn * item.v;
      item.blocks = new Int16Array(64 * item.lineBlocks * (item.columnBlocks + 1));
      item.pred = 0;
    }
  }

  function scan(components, spectralStart, spectralEnd, high, low) {
    const progressive = frame.progressive;
    let bits = 0, count = 0, eobrun = 0, successiveState = 0, successiveNext = 0;
    const bit = () => {
      if (count > 0) { count -= 1; return (bits >> count) & 1; }
      bits = bytes[at];
      at += 1;
      if (bits === 0xFF) {
        const next = bytes[at];
        at += 1;
        // Маркер посреди потока: данных больше нет. Указатель возвращается на маркер, дальше идут нули.
        if (next) { at -= 2; bits = 0; count = 7; return 0; }
      }
      if (bits === undefined) { bits = 0; }
      count = 7;
      return bits >>> 7;
    };
    const symbol = (table) => {
      let code = 0;
      for (let length = 1; length <= 16; length += 1) {
        code = (code << 1) | bit();
        if (code <= table.max[length]) return table.values[table.at[length] + code];
      }
      throw new Error("bad huffman code");
    };
    const receive = (length) => { let value = 0; for (let i = 0; i < length; i += 1) value = (value << 1) | bit(); return value; };
    const extend = (length) => { if (!length) return 0; const value = receive(length); return value >= 1 << (length - 1) ? value : value + (-1 << length) + 1; };

    function baseline(component, offset) {
      const t = symbol(component.dcTable);
      component.pred += extend(t);
      component.blocks[offset] = component.pred;
      for (let k = 1; k < 64;) {
        const rs = symbol(component.acTable), s = rs & 15, r = rs >> 4;
        if (!s) { if (r < 15) break; k += 16; continue; }
        k += r;
        if (k > 63) break;
        component.blocks[offset + ZIGZAG[k]] = extend(s);
        k += 1;
      }
    }
    function dcFirst(component, offset) {
      const t = symbol(component.dcTable);
      component.pred += extend(t);
      component.blocks[offset] = component.pred * (1 << low);
    }
    function dcNext(component, offset) { if (bit()) component.blocks[offset] |= 1 << low; }
    function acFirst(component, offset) {
      if (eobrun > 0) { eobrun -= 1; return; }
      for (let k = spectralStart; k <= spectralEnd;) {
        const rs = symbol(component.acTable), s = rs & 15, r = rs >> 4;
        if (!s) {
          if (r < 15) { eobrun = receive(r) + (1 << r) - 1; break; }
          k += 16;
          continue;
        }
        k += r;
        if (k > 63) break;
        component.blocks[offset + ZIGZAG[k]] = extend(s) * (1 << low);
        k += 1;
      }
    }
    function acNext(component, offset) {
      let k = spectralStart, r = 0;
      while (k <= spectralEnd) {
        const z = offset + ZIGZAG[k];
        const direction = component.blocks[z] < 0 ? -1 : 1;
        if (successiveState === 0) {
          const rs = symbol(component.acTable), s = rs & 15;
          r = rs >> 4;
          if (!s) {
            if (r < 15) { eobrun = receive(r) + (1 << r); successiveState = 4; }
            else { r = 16; successiveState = 1; }
          } else {
            if (s !== 1) throw new Error("bad successive scan");
            successiveNext = extend(s);
            successiveState = r ? 2 : 3;
          }
          continue;
        }
        if (successiveState === 1 || successiveState === 2) {
          if (component.blocks[z]) component.blocks[z] += (bit() << low) * direction;
          else { r -= 1; if (r === 0) successiveState = successiveState === 2 ? 3 : 0; }
        } else if (successiveState === 3) {
          if (component.blocks[z]) component.blocks[z] += (bit() << low) * direction;
          else { component.blocks[z] = successiveNext * (1 << low); successiveState = 0; }
        } else if (component.blocks[z]) component.blocks[z] += (bit() << low) * direction;
        k += 1;
      }
      if (successiveState === 4) { eobrun -= 1; if (eobrun === 0) successiveState = 0; }
    }

    const decode = !progressive ? baseline : spectralStart === 0 ? (high === 0 ? dcFirst : dcNext) : (high === 0 ? acFirst : acNext);
    const single = components.length === 1;
    const total = single ? components[0].blocksPerLine * components[0].blocksPerColumn : frame.mcusPerLine * frame.mcusPerColumn;
    const interval = restart || total;
    let mcu = 0;
    while (mcu < total) {
      for (const item of components) item.pred = 0;
      eobrun = 0;
      successiveState = 0;
      for (let n = 0; n < interval && mcu < total; n += 1, mcu += 1) {
        if (single) {
          const item = components[0];
          const row = Math.floor(mcu / item.blocksPerLine), col = mcu % item.blocksPerLine;
          decode(item, 64 * (row * item.lineBlocks + col));
        } else {
          const row = Math.floor(mcu / frame.mcusPerLine), col = mcu % frame.mcusPerLine;
          for (const item of components) {
            for (let v = 0; v < item.v; v += 1) for (let h = 0; h < item.h; h += 1) decode(item, 64 * ((row * item.v + v) * item.lineBlocks + col * item.h + h));
          }
        }
      }
      // К следующему маркеру: остаток байта отбрасывается; RSTn пропускается, всё прочее кончает скан.
      count = 0;
      while (at < bytes.length - 1 && !(bytes[at] === 0xFF && bytes[at + 1] !== 0 && bytes[at + 1] !== 0xFF)) at += 1;
      if (at >= bytes.length - 1) break;
      if (bytes[at + 1] >= 0xD0 && bytes[at + 1] <= 0xD7) at += 2;
      else break;
    }
  }

  while (at < bytes.length) {
    if (bytes[at] !== 0xFF) { at += 1; continue; }
    const marker = bytes[at + 1];
    at += 2;
    if (marker === 0xD9 || marker === undefined) break;
    if (marker === 0xFF) { at -= 1; continue; }
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD8)) continue;
    const length = word(), end = at + length - 2;
    if (length < 2 || end > bytes.length) throw new Error("bad segment");
    if (marker === 0xDB) {
      while (at < end) {
        const spec = bytes[at]; at += 1;
        const table = new Int32Array(64);
        for (let i = 0; i < 64; i += 1) table[ZIGZAG[i]] = spec >> 4 ? word() : bytes[at++];
        quant[spec & 15] = table;
      }
    } else if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
      if (frame) throw new Error("second frame");
      const precision = bytes[at]; at += 1;
      if (precision !== 8) throw new Error("unsupported precision");
      frame = { progressive: marker === 0xC2, height: word(), width: word(), components: [] };
      const many = bytes[at]; at += 1;
      if (!frame.width || !frame.height || frame.width > MAX_SIDE || frame.height > MAX_SIDE) throw new Error(frame.width && frame.height ? "too big" : "no size");
      if (many !== 1 && many !== 3) throw new Error("unsupported components");
      for (let i = 0; i < many; i += 1) {
        const id = bytes[at], hv = bytes[at + 1], tq = bytes[at + 2];
        at += 3;
        if (!(hv >> 4) || !(hv & 15) || (hv >> 4) > 4 || (hv & 15) > 4) throw new Error("bad sampling");
        frame.components.push({ id, h: hv >> 4, v: hv & 15, tq });
      }
      prepare();
    } else if (marker === 0xC4) {
      while (at < end) {
        const spec = bytes[at]; at += 1;
        const lengths = bytes.subarray(at, at + 16); at += 16;
        let total = 0;
        for (let i = 0; i < 16; i += 1) total += lengths[i];
        const table = huffmanTable(lengths, bytes.subarray(at, at + total));
        at += total;
        (spec >> 4 ? ac : dc)[spec & 15] = table;
      }
    } else if (marker === 0xDD) restart = word();
    else if (marker === 0xEE && length >= 14 && bytes[at] === 0x41 && bytes[at + 1] === 0x64 && bytes[at + 2] === 0x6F && bytes[at + 3] === 0x62 && bytes[at + 4] === 0x65) adobe = bytes[at + 11];
    else if (marker === 0xDA) {
      if (!frame) throw new Error("scan before frame");
      const many = bytes[at]; at += 1;
      const picked = [];
      for (let i = 0; i < many; i += 1) {
        const component = frame.components.find(item => item.id === bytes[at]);
        if (!component) throw new Error("unknown component");
        component.dcTable = dc[bytes[at + 1] >> 4];
        component.acTable = ac[bytes[at + 1] & 15];
        picked.push(component);
        at += 2;
      }
      const spectralStart = bytes[at], spectralEnd = bytes[at + 1], approximation = bytes[at + 2];
      at = end;
      if (picked.some(item => (spectralStart === 0 && !item.dcTable && !(frame.progressive && approximation >> 4)) || ((!frame.progressive || spectralStart > 0) && !item.acTable))) throw new Error("missing table");
      scan(picked, spectralStart, frame.progressive ? spectralEnd : 63, approximation >> 4, approximation & 15);
      continue;
    } else if (marker >= 0xC3 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) throw new Error("unsupported jpeg kind");
    at = end;
  }
  if (!frame) throw new Error("no frame");

  // Блоки → плоскости → RGB. Цвет растягивается до полного размера ближайшей точкой.
  const { width, height } = frame;
  const scratch = new Int32Array(64), cell = new Uint8Array(64);
  const planes = frame.components.map((item) => {
    const table = quant[item.tq];
    if (!table) throw new Error("missing quantization table");
    const w = item.blocksPerLine * 8, h = item.blocksPerColumn * 8;
    const plane = new Uint8Array(w * h);
    for (let row = 0; row < item.blocksPerColumn; row += 1) {
      for (let col = 0; col < item.blocksPerLine; col += 1) {
        inverseBlock(item.blocks, 64 * (row * item.lineBlocks + col), table, cell, scratch);
        for (let y = 0; y < 8; y += 1) plane.set(cell.subarray(y * 8, y * 8 + 8), (row * 8 + y) * w + col * 8);
      }
    }
    return { plane, w, sx: item.h / frame.maxH, sy: item.v / frame.maxV };
  });
  const data = new Uint8Array(width * height * 3);
  if (planes.length === 1) {
    const { plane, w } = planes[0];
    for (let y = 0, out = 0; y < height; y += 1) for (let x = 0; x < width; x += 1, out += 3) data[out] = data[out + 1] = data[out + 2] = plane[y * w + x];
    return { width, height, data };
  }
  const [Y, B, R] = planes;
  const rgb = adobe === 0;
  const xb = new Int32Array(width), xr = new Int32Array(width);
  for (let x = 0; x < width; x += 1) { xb[x] = Math.floor(x * B.sx); xr[x] = Math.floor(x * R.sx); }
  for (let y = 0, out = 0; y < height; y += 1) {
    const rowY = y * Y.w, rowB = Math.floor(y * B.sy) * B.w, rowR = Math.floor(y * R.sy) * R.w;
    for (let x = 0; x < width; x += 1, out += 3) {
      const a = Y.plane[rowY + x], b = B.plane[rowB + xb[x]], c = R.plane[rowR + xr[x]];
      if (rgb) { data[out] = a; data[out + 1] = b; data[out + 2] = c; continue; }
      const red = a + 1.402 * (c - 128), green = a - 0.3441363 * (b - 128) - 0.71413636 * (c - 128), blue = a + 1.772 * (b - 128);
      data[out] = red < 0 ? 0 : red > 255 ? 255 : red + 0.5;
      data[out + 1] = green < 0 ? 0 : green > 255 ? 255 : green + 0.5;
      data[out + 2] = blue < 0 ? 0 : blue > 255 ? 255 : blue + 0.5;
    }
  }
  return { width, height, data };
}

// ── PNG ────────────────────────────────────────────────────────────────────
const PNG_HEAD = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const isPng = (bytes) => bytes?.length > 8 && PNG_HEAD.every((value, index) => bytes[index] === value);
const CRC = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
function crc32(bytes, from, to) { let c = 0xFFFFFFFF; for (let i = from; i < to; i += 1) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function adler32(bytes) { let a = 1, b = 0; for (let i = 0; i < bytes.length;) { const end = Math.min(i + 3800, bytes.length); for (; i < end; i += 1) { a += bytes[i]; b += a; } a %= 65521; b %= 65521; } return ((b << 16) | a) >>> 0; }

/** Пропустить байты через поток среды (сжатие или распаковка). Нет такого потока — null. */
async function pipe(kind, bytes) {
  const Stream = globalThis[kind];
  if (typeof Stream !== "function") return null;
  const stream = new Stream("deflate");
  const writer = stream.writable.getWriter();
  // Запись и чтение идут разом: иначе большой поток упёрся бы в свою очередь.
  const written = writer.write(bytes).then(() => writer.close());
  const reader = stream.readable.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size > 96 * 1024 * 1024) throw new Error("too big");
  }
  await written;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

/** Сжатие zlib «без сжатия»: когда у среды нет своего потока. Блоки по 65535 байт. */
function stored(bytes) {
  const blocks = Math.max(1, Math.ceil(bytes.length / 65535));
  const out = new Uint8Array(2 + bytes.length + blocks * 5 + 4);
  out[0] = 0x78; out[1] = 0x01;
  let at = 2;
  for (let i = 0; i < blocks; i += 1) {
    const part = bytes.subarray(i * 65535, (i + 1) * 65535);
    out[at] = i === blocks - 1 ? 1 : 0;
    out[at + 1] = part.length & 255; out[at + 2] = part.length >> 8;
    out[at + 3] = ~part.length & 255; out[at + 4] = (~part.length >> 8) & 255;
    out.set(part, at + 5);
    at += 5 + part.length;
  }
  const sum = adler32(bytes);
  out[at] = sum >>> 24; out[at + 1] = (sum >>> 16) & 255; out[at + 2] = (sum >>> 8) & 255; out[at + 3] = sum & 255;
  return out;
}

/** PNG → `{ width, height, data, alpha }`: RGB по три байта и, если есть, прозрачность по байту. */
export async function decodePng(bytes) {
  if (!isPng(bytes)) throw new Error("not a png");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, depth = 0, kind = 0, palette = null, clear = null;
  const parts = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at), type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8); height = view.getUint32(at + 12); depth = body[8]; kind = body[9];
      if (body[12] !== 0) throw new Error("interlaced png");
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") clear = body;
    else if (type === "IDAT") parts.push(body);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  if (!width || !height) throw new Error("no size");
  if (width > MAX_SIDE || height > MAX_SIDE) throw new Error("too big");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[kind];
  // Глубина: 8 и 16 бит — любой вид; 1, 2 и 4 бита — только серое и палитра (так велит формат).
  const small = depth === 1 || depth === 2 || depth === 4;
  if (!channels || !(depth === 8 || depth === 16 || (small && (kind === 0 || kind === 3))) || (kind === 3 && (!palette || depth === 16))) throw new Error("unsupported png");
  const packed = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { packed.set(part, offset); offset += part.length; }
  const raw = await pipe("DecompressionStream", packed);
  if (!raw) throw new Error("no inflate");
  // Строка в байтах и шаг «соседа слева» для фильтров: целые байты на точку, не меньше одного.
  const stride = Math.ceil(width * channels * depth / 8), step = Math.max(1, channels * depth / 8);
  if (raw.length < (stride + 1) * height) throw new Error("short png");
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)], line = y * (stride + 1) + 1, out = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= step ? pixels[out + x - step] : 0, up = y ? pixels[out + x - stride] : 0, corner = x >= step && y ? pixels[out + x - stride - step] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) { const p = left + up - corner, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner); add = a <= b && a <= c ? left : b <= c ? up : corner; }
      pixels[out + x] = (raw[line + x] + add) & 255;
    }
  }
  // Отсчёт номер `n` в строке `y`: при 16 битах — старший байт, при малой глубине — нужные биты.
  const wide = depth === 16 ? 2 : 1, top = (1 << depth) - 1;
  const sample = small
    ? (y, n) => { const value = (pixels[y * stride + ((n * depth) >> 3)] >> (8 - depth - ((n * depth) & 7))) & top; return kind === 3 ? value : Math.round(value * 255 / top); }
    : (y, n) => pixels[y * stride + n * wide];
  // «Прозрачный цвет» у серого и цветного PNG без канала прозрачности: одна точка-ключ.
  const keyed = clear && (kind === 0 || kind === 2) ? (kind === 0 ? [clear[1]] : [clear[1], clear[3], clear[5]]) : null;
  const data = new Uint8Array(width * height * 3);
  const alpha = kind === 4 || kind === 6 || (kind === 3 && clear) || keyed ? new Uint8Array(width * height).fill(255) : null;
  for (let y = 0, i = 0, o = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1, i += 1, o += 3) {
      const n = x * channels;
      if (kind === 2 || kind === 6) {
        data[o] = sample(y, n); data[o + 1] = sample(y, n + 1); data[o + 2] = sample(y, n + 2);
        if (kind === 6) alpha[i] = sample(y, n + 3);
        else if (keyed && depth === 8 && data[o] === keyed[0] && data[o + 1] === keyed[1] && data[o + 2] === keyed[2]) alpha[i] = 0;
      } else if (kind === 3) {
        const index = sample(y, n), c = index * 3;
        data[o] = palette[c] ?? 0; data[o + 1] = palette[c + 1] ?? 0; data[o + 2] = palette[c + 2] ?? 0;
        if (alpha && index < clear.length) alpha[i] = clear[index];
      } else {
        data[o] = data[o + 1] = data[o + 2] = sample(y, n);
        if (kind === 4) alpha[i] = sample(y, n + 1);
        else if (keyed && depth === 8 && data[o] === keyed[0]) alpha[i] = 0;
      }
    }
  }
  return { width, height, data, alpha };
}

// ── размер, углы, палитра ──────────────────────────────────────────────────
/** Уменьшить (или увеличить) усреднением: большая сторона становится `side`. Возвращает RGBA. */
export function fit(image, side = STICKER_SIDE) {
  const scale = side / Math.max(image.width, image.height);
  const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
  const out = new Uint8Array(width * height * 4);
  const { data, alpha } = image;
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y / scale), y1 = Math.max(y0 + 1, Math.min(image.height, Math.floor((y + 1) / scale)));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x / scale), x1 = Math.max(x0 + 1, Math.min(image.width, Math.floor((x + 1) / scale)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1 && sy < image.height; sy += 1) {
        for (let sx = x0; sx < x1 && sx < image.width; sx += 1) {
          const i = sy * image.width + sx, weight = alpha ? alpha[i] : 255;
          r += data[i * 3] * weight; g += data[i * 3 + 1] * weight; b += data[i * 3 + 2] * weight; a += weight; n += 1;
        }
      }
      const o = (y * width + x) * 4;
      if (a) { out[o] = r / a + 0.5; out[o + 1] = g / a + 0.5; out[o + 2] = b / a + 0.5; out[o + 3] = a / n + 0.5; }
    }
  }
  return { width, height, data: out };
}

/** Скруглить углы: за дугой радиуса `radius` точки становятся прозрачными, на границе — сглаживание порогом. */
export function roundCorners(image, radius) {
  const { width, height, data } = image;
  const r = Math.max(0, Math.min(Math.floor(Math.min(width, height) / 2), Math.round(radius)));
  for (let y = 0; y < r; y += 1) {
    for (let x = 0; x < r; x += 1) {
      const dx = r - x - 0.5, dy = r - y - 0.5;
      if (dx * dx + dy * dy <= r * r) continue;
      for (const [px, py] of [[x, y], [width - 1 - x, y], [x, height - 1 - y], [width - 1 - x, height - 1 - y]]) data[(py * width + px) * 4 + 3] = 0;
    }
  }
  return image;
}

/**
 * Срезать ровный фон. Если рамка картинки почти одного цвета, всё, что связано с краем и
 * похоже на этот цвет, становится прозрачным: рисунок на белом листе превращается в вырезанную
 * фигуру. Заливка идёт от края и останавливается на резком перепаде, так что светлое внутри
 * фигуры остаётся. Фон пёстрый (пейзаж, комната) — ничего не трогает и возвращает false.
 *
 * Решение принимается по уменьшенной копии: в ней нет шума сжатия, из-за которого заливка
 * оставляла бы на ровном листе «снег», и считать вчетверо меньше.
 */
export function cutBackground(image, { tolerance = 40, jump = 12, work = 384 } = {}) {
  if (image.width < 16 || image.height < 16) return false;
  const small = Math.max(image.width, image.height) > work ? fit(image, work) : fit(image, Math.max(image.width, image.height));
  const { width, height, data } = small;
  const total = width * height;
  const frame = new Int32Array(2 * width + 2 * Math.max(0, height - 2));
  let count = 0;
  for (let x = 0; x < width; x += 1) { frame[count++] = x; frame[count++] = (height - 1) * width + x; }
  for (let y = 1; y < height - 1; y += 1) { frame[count++] = y * width; frame[count++] = y * width + width - 1; }
  // Цвет фона — медиана рамки по каждому каналу: уголок фигуры у края её не сдвинет.
  const back = [0, 1, 2].map((channel) => {
    const values = new Uint8Array(count);
    for (let i = 0; i < count; i += 1) values[i] = data[frame[i] * 4 + channel];
    values.sort();
    return values[count >> 1];
  });
  const near = (i, limit) => Math.abs(data[i * 4] - back[0]) <= limit && Math.abs(data[i * 4 + 1] - back[1]) <= limit && Math.abs(data[i * 4 + 2] - back[2]) <= limit;
  let same = 0;
  for (let i = 0; i < count; i += 1) if (near(frame[i], tolerance / 2)) same += 1;
  if (same < count * 0.9) return false;

  const gone = new Uint8Array(total), queue = new Int32Array(total);
  let head = 0, tail = 0;
  for (let i = 0; i < count; i += 1) { const at = frame[i]; if (!gone[at] && near(at, tolerance)) { gone[at] = 1; queue[tail++] = at; } }
  const smooth = (a, b) => Math.abs(data[a * 4] - data[b * 4]) <= jump && Math.abs(data[a * 4 + 1] - data[b * 4 + 1]) <= jump && Math.abs(data[a * 4 + 2] - data[b * 4 + 2]) <= jump;
  const spread = (ok) => {
    while (head < tail) {
      const at = queue[head++], x = at % width;
      if (x > 0) { const to = at - 1; if (!gone[to] && ok(at, to)) { gone[to] = 1; queue[tail++] = to; } }
      if (x < width - 1) { const to = at + 1; if (!gone[to] && ok(at, to)) { gone[to] = 1; queue[tail++] = to; } }
      if (at >= width) { const to = at - width; if (!gone[to] && ok(at, to)) { gone[to] = 1; queue[tail++] = to; } }
      if (at < total - width) { const to = at + width; if (!gone[to] && ok(at, to)) { gone[to] = 1; queue[tail++] = to; } }
    }
  };
  spread((from, to) => near(to, tolerance) && smooth(from, to));
  let removed = tail;
  // Рамка должна уйти почти вся: иначе заливку остановила фактура, и срез вышел бы рваным.
  let framed = 0;
  for (let i = 0; i < count; i += 1) if (gone[frame[i]]) framed += 1;
  if (framed < count * 0.9) return false;

  // Островки: всё оставшееся, кроме крупных кусков, — крошки фона. Куски считаются заливкой.
  const label = new Int32Array(total), sizes = [0];
  for (let start = 0; start < total; start += 1) {
    if (gone[start] || label[start]) continue;
    const id = sizes.length;
    let size = 0;
    head = 0; tail = 0;
    label[start] = id; queue[tail++] = start;
    while (head < tail) {
      const at = queue[head++], x = at % width;
      size += 1;
      if (x > 0 && !gone[at - 1] && !label[at - 1]) { label[at - 1] = id; queue[tail++] = at - 1; }
      if (x < width - 1 && !gone[at + 1] && !label[at + 1]) { label[at + 1] = id; queue[tail++] = at + 1; }
      if (at >= width && !gone[at - width] && !label[at - width]) { label[at - width] = id; queue[tail++] = at - width; }
      if (at < total - width && !gone[at + width] && !label[at + width]) { label[at + width] = id; queue[tail++] = at + width; }
    }
    sizes.push(size);
  }
  const largest = Math.max(...sizes);
  const crumb = Math.max(total * 0.004, largest * 0.03);
  for (let at = 0; at < total; at += 1) if (!gone[at] && sizes[label[at]] < crumb) { gone[at] = 1; removed += 1; }
  // Срезано почти ничего или почти всё — это не «фигура на листе»: оставить как было.
  if (removed < total * 0.06 || removed > total * 0.94) return false;

  // Маска — обратно на полный размер: каждая точка берёт решение своей клетки уменьшенной копии.
  const alpha = image.alpha ?? new Uint8Array(image.width * image.height).fill(255);
  const column = new Int32Array(image.width);
  for (let x = 0; x < image.width; x += 1) column[x] = Math.min(width - 1, Math.floor(x * width / image.width));
  for (let y = 0; y < image.height; y += 1) {
    const row = Math.min(height - 1, Math.floor(y * height / image.height)) * width, out = y * image.width;
    for (let x = 0; x < image.width; x += 1) if (gone[row + column[x]]) alpha[out + x] = 0;
  }
  image.alpha = alpha;
  return true;
}

/** Обрезать по видимому: рамка непрозрачных точек плюс поле. Всё прозрачно — null. */
export function cropVisible(image, margin = 0) {
  const { width, height, data, alpha } = image;
  if (!alpha) return image;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] < 128) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - margin); y0 = Math.max(0, y0 - margin); x1 = Math.min(width - 1, x1 + margin); y1 = Math.min(height - 1, y1 + margin);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w === width && h === height) return image;
  const out = { width: w, height: h, data: new Uint8Array(w * h * 3), alpha: new Uint8Array(w * h) };
  for (let y = 0; y < h; y += 1) {
    const from = (y0 + y) * width + x0;
    out.data.set(data.subarray(from * 3, (from + w) * 3), y * w * 3);
    out.alpha.set(alpha.subarray(from, from + w), y * w);
  }
  return out;
}

/** Белая обводка вокруг вырезанной фигуры: холст шире на `radius` с каждой стороны. Вход и выход — RGBA. */
export function outline(image, radius) {
  const r = Math.max(1, Math.round(radius));
  const { width, height, data } = image;
  const w = width + 2 * r, h = height + 2 * r;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < height; y += 1) out.set(data.subarray(y * width * 4, (y + 1) * width * 4), ((y + r) * w + r) * 4);
  const solid = (x, y) => x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] >= 128;
  // Круг радиуса r ставится в каждой точке контура: внутри фигуры считать нечего.
  const spans = [];
  for (let dy = -r; dy <= r; dy += 1) spans.push(Math.floor(Math.sqrt(r * r - dy * dy)));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!solid(x, y) || (solid(x - 1, y) && solid(x + 1, y) && solid(x, y - 1) && solid(x, y + 1))) continue;
      for (let dy = -r; dy <= r; dy += 1) {
        const span = spans[dy + r], row = (y + r + dy) * w;
        for (let dx = -span; dx <= span; dx += 1) {
          const at = (row + x + r + dx) * 4;
          if (out[at + 3] < 128) { out[at] = 255; out[at + 1] = 255; out[at + 2] = 255; out[at + 3] = 255; }
        }
      }
    }
  }
  return { width: w, height: h, data: out };
}

/** Палитра до `limit` цветов медианным сечением — по точкам, которые видны. */
function paletteOf(image, limit) {
  const { data } = image;
  // Гистограмма по 5 битам на канал: 32768 ячеек вместо четверти миллиона точек.
  const count = new Uint32Array(32768), sumR = new Float64Array(32768), sumG = new Float64Array(32768), sumB = new Float64Array(32768);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const cell = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    count[cell] += 1; sumR[cell] += data[i]; sumG[cell] += data[i + 1]; sumB[cell] += data[i + 2];
  }
  const cells = [];
  for (let cell = 0; cell < 32768; cell += 1) if (count[cell]) cells.push({ r: sumR[cell] / count[cell], g: sumG[cell] / count[cell], b: sumB[cell] / count[cell], n: count[cell] });
  if (!cells.length) return [[0, 0, 0]];
  const boxOf = (items) => {
    const box = { items, n: 0, span: 0, axis: "r" };
    for (const axis of ["r", "g", "b"]) {
      let low = 255, high = 0;
      for (const item of items) { if (item[axis] < low) low = item[axis]; if (item[axis] > high) high = item[axis]; }
      // Зелёный глазу заметнее: его разброс весит больше.
      const span = (high - low) * (axis === "g" ? 1.2 : axis === "r" ? 1 : 0.8);
      if (span > box.span) { box.span = span; box.axis = axis; }
    }
    for (const item of items) box.n += item.n;
    return box;
  };
  const boxes = [boxOf(cells)];
  while (boxes.length < limit) {
    let pick = -1, best = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      const score = boxes[i].items.length > 1 ? boxes[i].span * Math.sqrt(boxes[i].n) : 0;
      if (score > best) { best = score; pick = i; }
    }
    if (pick < 0) break;
    const box = boxes[pick], axis = box.axis;
    box.items.sort((x, y) => x[axis] - y[axis]);
    let half = 0, cut = 0;
    while (cut < box.items.length - 1 && half + box.items[cut].n <= box.n / 2) { half += box.items[cut].n; cut += 1; }
    cut = Math.max(1, cut);
    boxes.splice(pick, 1, boxOf(box.items.slice(0, cut)), boxOf(box.items.slice(cut)));
  }
  return boxes.map((box) => {
    let r = 0, g = 0, b = 0;
    for (const item of box.items) { r += item.r * item.n; g += item.g * item.n; b += item.b * item.n; }
    return [Math.round(r / box.n), Math.round(g / box.n), Math.round(b / box.n)];
  });
}

/** Точки → номера цветов палитры, с размыванием ошибки (Флойд — Стейнберг). Номер 0 — прозрачный. */
function indexed(image, palette) {
  const { width, height, data } = image;
  const out = new Uint8Array(width * height);
  const cache = new Int16Array(32768).fill(-1);
  const nearest = (r, g, b) => {
    const cell = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    if (cache[cell] >= 0) return cache[cell];
    let best = 0, distance = Infinity;
    for (let i = 0; i < palette.length; i += 1) {
      const dr = r - palette[i][0], dg = g - palette[i][1], db = b - palette[i][2];
      const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if (d < distance) { distance = d; best = i; }
    }
    cache[cell] = best;
    return best;
  };
  let errors = new Float32Array((width + 2) * 3), next = new Float32Array((width + 2) * 3);
  const clamp = (value) => (value < 0 ? 0 : value > 255 ? 255 : value | 0);
  for (let y = 0; y < height; y += 1) {
    next.fill(0);
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4, e = (x + 1) * 3;
      if (data[i + 3] < 128) { out[y * width + x] = 0; continue; }
      // Ошибка размывается на три четверти: полная даёт «песок» на ровных заливках.
      const r = clamp(data[i] + errors[e] * 0.75), g = clamp(data[i + 1] + errors[e + 1] * 0.75), b = clamp(data[i + 2] + errors[e + 2] * 0.75);
      const pick = nearest(r, g, b);
      out[y * width + x] = pick + 1;
      const er = r - palette[pick][0], eg = g - palette[pick][1], eb = b - palette[pick][2];
      errors[e + 3] += er * 7 / 16; errors[e + 4] += eg * 7 / 16; errors[e + 5] += eb * 7 / 16;
      next[e - 3] += er * 3 / 16; next[e - 2] += eg * 3 / 16; next[e - 1] += eb * 3 / 16;
      next[e] += er * 5 / 16; next[e + 1] += eg * 5 / 16; next[e + 2] += eb * 5 / 16;
      next[e + 3] += er / 16; next[e + 4] += eg / 16; next[e + 5] += eb / 16;
    }
    [errors, next] = [next, errors];
  }
  return out;
}

/** RGBA → PNG с палитрой (до 255 цветов и один прозрачный). */
export async function encodePng(image) {
  const { width, height } = image;
  const palette = paletteOf(image, 255);
  const pixels = indexed(image, palette);
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y += 1) raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  let packed = null;
  try { packed = await pipe("CompressionStream", raw); } catch { packed = null; }
  packed ??= stored(raw);
  const plte = new Uint8Array((palette.length + 1) * 3);
  palette.forEach((colour, index) => plte.set(colour, (index + 1) * 3));
  const chunk = (type, body) => {
    const out = new Uint8Array(12 + body.length), view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    view.setUint32(8 + body.length, crc32(out, 4, 8 + body.length));
    return out;
  };
  const head = new Uint8Array(13), view = new DataView(head.buffer);
  view.setUint32(0, width); view.setUint32(4, height);
  head[8] = 8; head[9] = 3;
  const parts = [new Uint8Array(PNG_HEAD), chunk("IHDR", head), chunk("PLTE", plte), chunk("tRNS", new Uint8Array([0])), chunk("IDAT", packed), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/**
 * Картинка → стикер. Ровный фон срезается, фигура обводится белым (`stroke` точек); пёстрый
 * фон остаётся, а углы скругляются (`corners` — радиус в долях стороны). Картинка, у которой
 * уже есть прозрачность, только обрезается по видимому.
 * `{ ok, bytes, width, height, cut }` или `{ ok: false, code }`.
 */
export async function toSticker(bytes, { side = STICKER_SIDE, corners = 0.09, background = true, stroke = 7 } = {}) {
  try {
    const input = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
    if (!input || input.length < 16) return { ok: false, code: "bad_image" };
    let image = null;
    try {
      if (isPng(input)) image = await decodePng(input);
      else if (input[0] === 0xFF && input[1] === 0xD8) image = decodeJpeg(input);
    } catch (error) {
      const why = String(error?.message);
      return { ok: false, code: /too big/u.test(why) ? "too_big" : /no inflate/u.test(why) ? "no_inflate" : "bad_image" };
    }
    if (!image) return { ok: false, code: "bad_image" };
    // Прозрачность уже есть (вырезанная фигура из PNG) — фон искать незачем.
    let clear = 0;
    if (image.alpha) for (let i = 0; i < image.alpha.length; i += 1) if (image.alpha[i] < 128) clear += 1;
    const ready = clear > image.width * image.height * 0.03;
    const cut = !ready && background ? cutBackground(image) : false;
    if (cut || ready) {
      image = cropVisible(image, 1);
      if (!image) return { ok: false, code: "bad_image" };
    }
    let small = null;
    if (cut && stroke > 0) small = outline(fit(image, side - 2 * stroke), stroke);
    else {
      small = fit(image, side);
      if (!cut && !ready && corners > 0) roundCorners(small, Math.min(small.width, small.height) * corners);
    }
    const out = await encodePng(small);
    if (out.length > STICKER_MAX_BYTES) return { ok: false, code: "failed" };
    return { ok: true, bytes: out, width: small.width, height: small.height, cut: Boolean(cut) };
  } catch {
    return { ok: false, code: "failed" };
  }
}
