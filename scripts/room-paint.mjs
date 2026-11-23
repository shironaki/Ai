#!/usr/bin/env node
/**
 * Комната картинкой (идея 202, сборка 0.53.0): из двух рисунков художника — модуль `miniapp/room/day.js`.
 *
 * Что на входе. Два рисунка одного размера, оба — правки эскиза, который выбрал владелец
 * (`docs/art/room-concept.webp.b64`), и на обоих вид за стеклом залит ровным зелёным (#00FF00):
 *   «с вещами»  — эскиз как есть;
 *   «без вещей» — тот же рисунок, с которого художник убрал всё, что в комнате бывает и не бывает (плед, кактусы,
 *                 подушки, календарь, её рисунок, рамку и вторую кружку на полке, лампу, табурет, второе кресло,
 *                 тапочки, лежанку Байта).
 *
 * Что на выходе.
 *   `src`    — комната без вещей; стекло окна прозрачное: небо, город и погода остаются живыми, их рисует код;
 *   `things` — вещи, вырезанные из рисунка «с вещами» там, где он отличается от рисунка «без вещей», — каждая на
 *              своём месте, все на одном листе (`at`: где вещь лежит на листе и где стоит в комнате);
 *   `bulbs`  — где на рисунке лампочки гирлянды: над ними код зажигает свет.
 *
 * Почему вещи вырезаются разницей двух рисунков, а не по контуру. Там, где рисунки одинаковы, неважно, чью точку
 * взять; там, где разные, берётся точка «с вещами» — и вместе с вещью на место встаёт её тень. Прозрачность — по
 * величине отличия, плавно: у порога нет ступеньки, значит, нет и шва.
 *
 * Рисунок слегка сжат по высоте выше подоконника: верх стекла у художника вышел на семь с половиной точек выше, чем
 * окно в коде (`WIN` в `miniapp/scene.js`), а небо, дождь и капли на стекле рисуются по `WIN`.
 *
 * Картинки разбирает и собирает ImageMagick (`convert`): зависимостью проекта он не становится — сценарий нужен
 * только тому, кто перерисовывает комнату. Двоичных файлов он в репозитории не оставляет: модуль — текст.
 *
 * Запуск: node scripts/room-paint.mjs <с вещами.png> <без вещей.png> [куда положить модуль] [папка для проб]
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";

const [, , fullPath, cleanPath, outPath = "miniapp/room/day.js", probeDir = ""] = process.argv;
if (!fullPath || !cleanPath) { console.error("Нужно: node scripts/room-paint.mjs <с вещами.png> <без вещей.png> [модуль] [папка для проб]"); process.exit(2); }

// ── размеры ──────────────────────────────────────────────────────────────────
/** Рисунок комнаты в коде — 400×520 точек; картинка — вдвое крупнее. */
const SCENE = { w: 400, h: 520 }, K = 2, W = SCENE.w * K, H = SCENE.h * K;
/** Окно в коде: верх стекла и линия подоконника (точки рисунка). К ним подгоняется проём на картинке. */
const WIN_TOP = 44.5, WIN_SILL = 259;

const magick = (args, input) => execFileSync("convert", args, { input, maxBuffer: 1 << 28 });
const sizeOf = (path) => execFileSync("identify", ["-format", "%w %h", path]).toString().trim().split(" ").map(Number);
const [SW, SH] = sizeOf(fullPath);
{ const [w, h] = sizeOf(cleanPath); if (w !== SW || h !== SH) { console.error(`Рисунки разного размера: ${SW}×${SH} и ${w}×${h}`); process.exit(2); } }

/** Зелёность точки: насколько зелёный канал выше двух других. У заливки окна — за двести, у кактуса и кресла — до ста. */
const greenOf = (buf, i) => buf[i + 1] - Math.max(buf[i], buf[i + 2]);

// Где на исходном рисунке проём окна: строки, в которых зелёного много.
const probe = magick([cleanPath, "-depth", "8", "rgba:-"]);
const rows = new Uint32Array(SH);
for (let y = 0; y < SH; y += 1) for (let x = 0; x < SW; x += 1) if (greenOf(probe, (y * SW + x) * 4) > 150) rows[y] += 1;
const holeTop = rows.findIndex(count => count > SW * 0.2), holeBottom = SH - 1 - [...rows].reverse().findIndex(count => count > SW * 0.2);
if (holeTop < 0 || holeBottom <= holeTop) { console.error("На рисунке «без вещей» не нашлось зелёного окна."); process.exit(2); }

// Две полосы: выше подоконника — сжать так, чтобы верх стекла встал на `WIN_TOP`; ниже — как есть.
const sill = holeBottom + 1, sillTo = Math.round(WIN_SILL * K), topTo = WIN_TOP * K;
const scaleA = (sillTo - topTo) / (sill - holeTop), pad = Math.max(0, Math.round(sillTo - sill * scaleA));
const scaleB = (H - sillTo) / (SH - sill);
/** Куда на картинке попадает точка исходного рисунка. */
const place = (x, y) => [x * W / SW, y < sill ? pad + y * scaleA : sillTo + (y - sill) * scaleB];
const warped = (path) => magick([
  path,
  "(", "-clone", "0", "-crop", `${SW}x2+0+0`, "+repage", "-resize", `${W}x${Math.max(1, pad)}!`, ")",
  "(", "-clone", "0", "-crop", `${SW}x${sill}+0+0`, "+repage", "-resize", `${W}x${sillTo - pad}!`, ")",
  "(", "-clone", "0", "-crop", `${SW}x${SH - sill}+0+${sill}`, "+repage", "-resize", `${W}x${H - sillTo}!`, ")",
  "-delete", "0", "-append", "-depth", "8", "rgba:-",
]);
const full = Buffer.from(warped(fullPath)), clean = Buffer.from(warped(cleanPath));
if (full.length !== W * H * 4 || clean.length !== W * H * 4) { console.error("Подгонка рисунка дала не тот размер."); process.exit(2); }

// ── окно: зелёное — в прозрачность ───────────────────────────────────────────
/** Цвет заливки — средний по самым зелёным точкам рисунка. */
function keyOf(buf) {
  const sum = [0, 0, 0]; let count = 0;
  for (let i = 0; i < W * H; i += 1) if (greenOf(buf, i * 4) > 200) { sum[0] += buf[i * 4]; sum[1] += buf[i * 4 + 1]; sum[2] += buf[i * 4 + 2]; count += 1; }
  return count ? sum.map(value => value / count) : [0, 255, 0];
}
/**
 * Прозрачность по зелёности — только в прямоугольнике окна (с запасом): зелёные вещи в комнате (жестянка с чаем,
 * книга) остаются как есть. У края стекла точка — смесь рамы и заливки: заливка вычитается, цвет рамы остаётся.
 */
function keyOut(buf) {
  const key = keyOf(buf), box = { x0: W, y0: H, x1: 0, y1: 0 };
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (greenOf(buf, (y * W + x) * 4) > 150) { box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x); box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y); }
  const lo = 70, hi = 150;
  for (let y = Math.max(0, box.y0 - 6); y <= Math.min(H - 1, box.y1 + 6); y += 1) {
    for (let x = Math.max(0, box.x0 - 6); x <= Math.min(W - 1, box.x1 + 6); x += 1) {
      const i = (y * W + x) * 4, green = greenOf(buf, i);
      if (green <= lo) continue;
      const alpha = green >= hi ? 0 : 1 - (green - lo) / (hi - lo);
      if (alpha <= 0) { buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 0; continue; }
      for (let c = 0; c < 3; c += 1) buf[i + c] = Math.max(0, Math.min(255, Math.round((buf[i + c] - (1 - alpha) * key[c]) / alpha)));
      // Зелёный отсвет на светлой раме: зелёный канал не выше двух других.
      buf[i + 1] = Math.min(buf[i + 1], Math.max(buf[i], buf[i + 2]) + 6);
      buf[i + 3] = Math.round(alpha * 255);
    }
  }
  // Зелёный отсвет на том, что стоит у самого стекла (край шторы, рама): в трёх точках от прозрачного зелёный
  // канал не выше двух других. Кремовой шторе и белой раме это возвращает их цвет, лампочкам гирлянды не мешает.
  const edge = new Uint8Array(W * H);
  for (let y = Math.max(0, box.y0 - 6); y <= Math.min(H - 1, box.y1 + 6); y += 1) for (let x = Math.max(0, box.x0 - 6); x <= Math.min(W - 1, box.x1 + 6); x += 1) {
    if (buf[(y * W + x) * 4 + 3] >= 250) continue;
    for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < H && xx >= 0 && xx < W) edge[yy * W + xx] = 1; }
  }
  for (let i = 0; i < W * H; i += 1) {
    if (!edge[i] || buf[i * 4 + 3] === 0) continue;
    const top = Math.max(buf[i * 4], buf[i * 4 + 2]), green = buf[i * 4 + 1];
    // Тёмная зеленоватая точка у самого стекла — остаток заливки (её тень у рамы), а не рама: убрать совсем.
    // Светлые зелёные лампочки гирлянды сюда не попадают: они яркие.
    if (green - top > 22 && green < 190) { buf[i * 4] = 0; buf[i * 4 + 1] = 0; buf[i * 4 + 2] = 0; buf[i * 4 + 3] = 0; continue; }
    if (green > top && green - top < 60) buf[i * 4 + 1] = top;
  }
  return box;
}
const hole = keyOut(clean);
keyOut(full);

// ── вещи: где «с вещами» отличается от «без вещей» ───────────────────────────
/** Отличие двух точек — по самому разошедшемуся каналу; где комнаты нет (стекло), а вещь есть — вещь целиком. */
const T_LOW = 18, T_HIGH = 46;
const matte = new Float32Array(W * H);
for (let i = 0; i < W * H; i += 1) {
  const j = i * 4, alphaFull = full[j + 3] / 255, alphaClean = clean[j + 3] / 255;
  const apart = Math.max(Math.abs(full[j] - clean[j]), Math.abs(full[j + 1] - clean[j + 1]), Math.abs(full[j + 2] - clean[j + 2]));
  const byColour = Math.max(0, Math.min(1, (apart - T_LOW) / (T_HIGH - T_LOW)));
  matte[i] = Math.max(0, Math.min(1, Math.max(byColour * (3 - 2 * byColour) * byColour * Math.min(alphaFull, alphaClean), alphaFull - alphaClean)));
}

/**
 * Вещи: имя и области на исходном рисунке (левый верхний и правый нижний угол). Имена по-русски — те же, что у вещей
 * человека (`view.things`); по-английски — то, что в комнате всегда или живёт своей жизнью. Третьим — условие для
 * точки там, где области соседей пересекаются: первая вещь по списку, чьё условие сошлось, и берёт точку.
 */
const edge = (points) => (y) => {
  if (y <= points[0][0]) return points[0][1];
  for (let index = 1; index < points.length; index += 1) if (y <= points[index][0]) { const [y0, x0] = points[index - 1], [y1, x1] = points[index]; return x0 + (x1 - x0) * (y - y0) / (y1 - y0); }
  return points.at(-1)[1];
};
// Правый край пледа: выше — у подушки на подоконнике, ниже — у спинки второго кресла.
const plaidEdge = edge([[566, 632], [580, 651], [596, 663], [604, 668], [648, 672], [665, 675], [685, 679], [705, 682], [722, 684], [740, 700]]);
const THINGS = [
  ["рисунок", [[36, 240, 138, 368]]],
  ["календарь", [[140, 242, 236, 365]]],
  ["снимок", [[144, 518, 240, 594]]],
  ["подушка", [[306, 515, 430, 606]]],
  ["кружка", [[88, 655, 148, 704]]],
  ["место", [[626, 556, 745, 606]], (x, y) => x > plaidEdge(y)],
  ["кресло", [[668, 640, 745, 735], [700, 776, 776, 892]], (x, y) => y > 760 || x > plaidEdge(y)],
  ["плед", [[518, 556, 700, 995]]],
  // Низ области — по кромке подоконника: ниже у Колючки ничего своего нет, а свет лампы на стене — вещь лампы
  // (до 0.54.0 его угол доставался Колючке и днём лежал под блюдцем светлым прямоугольником).
  ["plant", [[726, 458, 821, 604]]],
  ["кактус", [[822, 528, 857, 603]], (x, y) => !(y >= 588 && x >= 856)],
  // Лампа горит, и вокруг неё на стене — её свет: у края области он сходит на нет, иначе был бы виден ровный срез.
  ["lamp", [[800, 603, 911, 732], [857, 586, 911, 603]], null, (x, y) => Math.max(0, Math.min(1, (x - 800) / 26, y < 603 ? (x - 857) / 10 : 1, (732 - y) / 8))],
  ["stool", [[818, 786, 900, 955]]],
  ["тапочки", [[46, 1064, 180, 1126]]],
  ["bed", [[600, 1078, 782, 1184]]],
];
// Обратно: какая точка исходного рисунка легла в эту точку картинки.
const sourceOf = (x, y) => [x * SW / W, y < sillTo ? (y - pad) / scaleA : sill + (y - sillTo) / scaleB];
const owner = new Int8Array(W * H).fill(-1);
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    if (matte[y * W + x] <= 0) continue;
    const [sx, sy] = sourceOf(x + 0.5, y + 0.5);
    for (let index = 0; index < THINGS.length; index += 1) {
      const [, boxes, when, fade] = THINGS[index];
      if (boxes.some(([x0, y0, x1, y1]) => sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) && (!when || when(sx, sy))) {
        owner[y * W + x] = index;
        // Слабое отличие (свет на стене) гаснет к краю области; сама вещь — отличие сильное — остаётся целой.
        if (fade && matte[y * W + x] < 0.999) matte[y * W + x] *= fade(sx, sy);
        break;
      }
    }
  }
}

/** Мелкий сор убрать: связный кусок вещи меньше двадцати точек — шум двух рисунков, а не вещь. */
function cleanOf(index) {
  const alpha = new Float32Array(W * H), seen = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) if (owner[i] === index) alpha[i] = matte[i];
  for (let start = 0; start < W * H; start += 1) {
    if (seen[start] || alpha[start] < 0.3) continue;
    const stack = [start], piece = []; seen[start] = 1;
    while (stack.length) {
      const p = stack.pop(), x = p % W; piece.push(p);
      for (const q of [p - 1, p + 1, p - W, p + W]) { if (q < 0 || q >= W * H || Math.abs((q % W) - x) > 1 || seen[q] || alpha[q] < 0.3) continue; seen[q] = 1; stack.push(q); }
    }
    if (piece.length < 20) for (const p of piece) alpha[p] = 0;
  }
  // Слабые точки вдали от самой вещи — тоже шум: оставить только те, что рядом с плотной частью (четыре точки).
  const near = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    if (alpha[y * W + x] < 0.3) continue;
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < H && xx >= 0 && xx < W) near[yy * W + xx] = 1; }
  }
  for (let i = 0; i < W * H; i += 1) if (!near[i]) alpha[i] = 0;
  // Внутри своего контура вещь сплошная: тёмная клетка пледа на тёмном кресле отличается слабо и вышла бы
  // полупрозрачной. Плотную часть расширить и сжать обратно (щели закрываются), дыры залить — там вещь целиком.
  const R = 5, solid = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) solid[i] = alpha[i] >= 0.5 ? 1 : 0;
  const spread = (src, grow) => {
    const pass = (from, dx, dy) => {
      const out = new Uint8Array(W * H);
      for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
        let value = grow ? 0 : 1;
        for (let k = -R; k <= R; k += 1) {
          const xx = x + dx * k, yy = y + dy * k, cell = xx < 0 || xx >= W || yy < 0 || yy >= H ? 0 : from[yy * W + xx];
          if (grow ? cell : !cell) { value = grow ? 1 : 0; break; }
        }
        out[y * W + x] = value;
      }
      return out;
    };
    return pass(pass(src, 1, 0), 0, 1);
  };
  const closed = spread(spread(solid, true), false);
  // Дыры: всё, до чего не дойти от края картинки по пустым точкам.
  const outside = new Uint8Array(W * H), stack = [];
  for (let x = 0; x < W; x += 1) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y += 1) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const p = stack.pop();
    if (outside[p] || closed[p]) continue;
    outside[p] = 1;
    const x = p % W;
    if (x > 0) stack.push(p - 1);
    if (x < W - 1) stack.push(p + 1);
    if (p >= W) stack.push(p - W);
    if (p < W * (H - 1)) stack.push(p + W);
  }
  // Заливается только то, что и по списку принадлежит этой вещи или никому: чужую вещь контур не съедает.
  for (let i = 0; i < W * H; i += 1) if (!outside[i] && (owner[i] === index || owner[i] === -1) && full[i * 4 + 3] > 0) alpha[i] = Math.max(alpha[i], 1);
  return alpha;
}

const sprites = [];
for (let index = 0; index < THINGS.length; index += 1) {
  const alpha = cleanOf(index);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (alpha[y * W + x] > 0.02) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) { console.error(`Вещь «${THINGS[index][0]}» на рисунках не нашлась.`); process.exit(2); }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const from = ((y0 + y) * W + x0 + x) * 4, to = (y * w + x) * 4, a = alpha[(y0 + y) * W + x0 + x];
    data[to] = full[from]; data[to + 1] = full[from + 1]; data[to + 2] = full[from + 2]; data[to + 3] = Math.round(a * 255);
  }
  sprites.push({ name: THINGS[index][0], x: x0, y: y0, w, h, data });
}

// Передняя стенка коробки — из рисунка «без вещей»: Байт сидит в коробке, и стенка закрывает его снизу.
{
  const [x0, y0] = place(694, 887).map(Math.floor), [x1, y1] = place(830, 965).map(Math.ceil);
  const w = x1 - x0 + 1, h = y1 - y0 + 1, data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const from = ((y0 + y) * W + x0 + x) * 4, to = (y * w + x) * 4;
    // Верхний край — мягкий (четыре точки): стенка встаёт поверх кота без резкой черты.
    const soft = Math.min(1, (y + 1) / 4) * Math.min(1, (x + 1) / 3) * Math.min(1, (w - x) / 3);
    data[to] = clean[from]; data[to + 1] = clean[from + 1]; data[to + 2] = clean[from + 2]; data[to + 3] = Math.round(255 * soft);
  }
  sprites.push({ name: "boxFront", x: x0, y: y0, w, h, data });
}

// Лист вещей: по полкам, самые высокие первыми.
const GAP = 2, SHEET_W = 512;
const order = [...sprites].sort((a, b) => b.h - a.h);
let cursorX = GAP, cursorY = GAP, shelf = 0;
for (const item of order) {
  if (cursorX + item.w + GAP > SHEET_W) { cursorX = GAP; cursorY += shelf + GAP; shelf = 0; }
  item.ax = cursorX; item.ay = cursorY; cursorX += item.w + GAP; shelf = Math.max(shelf, item.h);
}
const SHEET_H = cursorY + shelf + GAP;
const sheet = Buffer.alloc(SHEET_W * SHEET_H * 4);
for (const item of sprites) for (let y = 0; y < item.h; y += 1) item.data.copy(sheet, ((item.ay + y) * SHEET_W + item.ax) * 4, y * item.w * 4, (y + 1) * item.w * 4);

// ── лампочки гирлянды ────────────────────────────────────────────────────────
/**
 * Где на картинке лампочки (точки рисунка 400×520) и какого они цвета. Список снят с картинки глазами, по сетке:
 * яркие места шторы на солнце по цвету от жёлтой лампочки не отличить, и сам сценарий их путал. Рисунок сменился —
 * список снимается заново (`[папка для проб]/room-base.png`). Сначала вдоль карниза слева направо, потом вниз по шторе.
 */
const GLASS = { y: "#ffd96b", p: "#ff9db0", c: "#7fe3df", b: "#9fd4ff", o: "#ffbf6b" };
const BULBS = [
  [131, 45.5, "y"], [140.5, 48.5, "p"], [150, 45, "p"], [165, 48, "c"], [174.2, 51.2, "c"], [183.5, 47.5, "y"], [198.5, 46, "y"], [207.5, 49, "y"],
  [216, 45.5, "p"], [232.5, 47.5, "y"], [241.7, 50.5, "c"], [251, 46.5, "c"], [265.5, 45.5, "y"], [274.7, 48.7, "y"], [284, 45.5, "p"], [299, 47.2, "y"],
  [308.2, 51, "c"], [317, 47.2, "y"], [332, 46.2, "y"], [342, 49.5, "y"], [351.2, 45.5, "p"], [367, 46.2, "y"], [376.2, 50.5, "b"], [386.2, 47, "o"],
  [124.5, 64.5, "y"], [124.2, 91.2, "y"], [126.5, 118.5, "p"], [124, 145.5, "y"], [125, 168, "y"], [129.2, 198.7, "y"], [125, 225, "y"], [128.5, 247.5, "y"],
];
const bulbs = BULBS.map(([x, y, kind]) => [x, y, GLASS[kind]]);

// ── запись ───────────────────────────────────────────────────────────────────
const work = join(tmpdir(), `room-paint-${process.pid}`);
mkdirSync(work, { recursive: true });
const webp = (buf, w, h, quality, name) => {
  const file = join(work, `${name}.webp`);
  magick(["-size", `${w}x${h}`, "-depth", "8", "rgba:-", "-quality", String(quality), "-define", "webp:method=6", "-define", "webp:alpha-quality=92", "-define", "webp:alpha-filtering=2", file], buf);
  return readFileSync(file);
};
const basePicture = webp(clean, W, H, Number(process.env.ROOM_QUALITY) || 80, "base"), thingsPicture = webp(sheet, SHEET_W, SHEET_H, Number(process.env.THINGS_QUALITY) || 84, "things");
const unit = (value) => Math.round(value / K * 10) / 10;
// Имя картинки — имя файла модуля («day», «dull»): по нему рисунок называет её определения.
const target = resolve(outPath), name = basename(target, ".js");
if (!/^[a-z]+$/u.test(name)) { console.error(`Имя модуля — латиницей, строчными: «${name}».`); process.exit(2); }
const at = Object.fromEntries(sprites.map(item => [item.name, [item.ax, item.ay, item.w, item.h, unit(item.x), unit(item.y), unit(item.w), unit(item.h)]]));
const module = `// Комната картинкой (идея 202). Модуль собран \`scripts/room-paint.mjs\` и руками не правится: он и есть оригинал.
// \`src\` — комната без вещей (${W}×${H}, стекло окна прозрачное); \`things\` — лист вещей: \`at[имя]\` — где вещь на
// листе (точки листа: x, y, ширина, высота) и где она в комнате (точки рисунка 400×520: x, y, ширина, высота);
// \`bulbs\` — лампочки гирлянды: x, y, цвет.
export default ${JSON.stringify({ v: 1, name, w: W, h: H, src: `data:image/webp;base64,${basePicture.toString("base64")}`, things: { w: SHEET_W, h: SHEET_H, src: `data:image/webp;base64,${thingsPicture.toString("base64")}`, at }, bulbs })};
`;
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, module);
if (probeDir) {
  mkdirSync(probeDir, { recursive: true });
  magick(["-size", `${W}x${H}`, "-depth", "8", "rgba:-", join(probeDir, "room-base.png")], clean);
  magick(["-size", `${SHEET_W}x${SHEET_H}`, "-depth", "8", "rgba:-", join(probeDir, "room-things.png")], sheet);
}
rmSync(work, { recursive: true, force: true });
console.log(JSON.stringify({
  source: [SW, SH], hole: { top: holeTop, bottom: holeBottom }, pad, scaleA: Math.round(scaleA * 1000) / 1000, scaleB: Math.round(scaleB * 1000) / 1000,
  glass: [unit(hole.x0), unit(hole.y0), unit(hole.x1), unit(hole.y1)], base: basePicture.length, things: thingsPicture.length, sheet: [SHEET_W, SHEET_H], module: module.length,
  bulbs: bulbs.length, at,
}));
