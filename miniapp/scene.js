/**
 * Комната Аи — рисунок (мини-приложение, сборка 0.38.0).
 *
 * Чистая функция: по описанию «что сейчас в комнате» возвращает разметку SVG. Ни страницы, ни Telegram здесь
 * нет — поэтому рисунок проверяется тестами (`tests/miniapp.test.mjs`): каждая поза Аи, каждая поза Байта и
 * каждая вещь из `tgcloud/lib/room.js` должны рисоваться. Что именно нарисовать, решает сердце (`heart.onRoom`):
 * где она и где Байт — по тем же фразам, которые она говорит в чате.
 *
 * Свет не накладывается сверху, а считается: каждый цвет комнаты приглушается под час (`tint`), а лампа,
 * гирлянда и окна города рисуются поверх своим цветом. Так нет ни фильтров, ни режимов смешения — рисунок
 * одинаков в любом браузере, который открывает Telegram.
 *
 * Рисунок — три слоя. `drawBackdrop` — небо, город и дождь: они зависят только от часа, и страница не трогает
 * их при нажатиях (иначе капли прыгали бы назад). `drawInside` — сама комната и поверх неё слой нажатий.
 * Картинка нажатий не ловит вовсе (`pointer-events="none"`): кто кого закрывает на рисунке и кто первым
 * встречает палец — разные вещи. Свет лампы лежит поверх всего, но чайник под ним остаётся чайником; Байт сидит
 * у миски — а миска остаётся миской. Порядок слоя нажатий: окно, вещи, Аи, Байт и поверх всех — забота
 * (Колючка, чайник, миска, клубок).
 */

export const WIDTH = 400;
export const HEIGHT = 520;
export const PARTS = Object.freeze(["утро", "день", "вечер", "ночь"]);
export const HER_POSES = Object.freeze(["desk", "shelf", "chair", "nap", "sill", "back", "map", "garland", "dance", "ribbon", "lie"]);
export const CAT_SHAPES = Object.freeze(["sit", "lie", "curl", "walk", "play", "eat", "claw", "eyes", "tail"]);
export const CAT_PLACES = Object.freeze(["bowl", "sill", "chair", "rug", "pillow", "desk", "box", "near", "top", "under", "plaid"]);
export const THINGS = Object.freeze(["кружка", "тапочки", "подушка", "снимок", "плед", "календарь", "кресло", "кактус", "место", "абажур", "рисунок", "ёлка"]);
/** Её лицо — по тому, чем она занята (ключ запаса «+комната:она:<key>»). */
export const MOODS = Object.freeze({ "дело": "calm", "уют": "smile", "игра": "happy", "сон": "sleep", "устала": "tired", "обида": "pout", "ревность": "jealous" });

// ── свет ─────────────────────────────────────────────────────────────────────
/** Во сколько раз приглушён каждый канал цвета в этот час: [красный, зелёный, синий]. */
const LIGHT = Object.freeze({ "утро": [0.97, 0.94, 0.95], "день": [1, 1, 1], "вечер": [0.66, 0.62, 0.8], "ночь": [0.46, 0.47, 0.68] });
const SKY = Object.freeze({
  "утро": ["#a9b8c9", "#ead9cb"], "день": ["#aebbc8", "#d7dde2"], "вечер": ["#3d456e", "#b47f78"], "ночь": ["#0f1530", "#27325a"],
});
const CITY = Object.freeze({
  "утро": ["#a3acb9", "#838c9b"], "день": ["#9ba8b5", "#7b8897"], "вечер": ["#4d5078", "#33355a"], "ночь": ["#1c2342", "#11162d"],
});
const lit = (part) => part === "вечер" || part === "ночь";

const hex2 = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
/** Цвет под час суток. Цвет без «#rrggbb» (прозрачный, готовый) возвращается как есть. */
export function tint(colour, part) {
  const found = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(String(colour));
  const k = LIGHT[part] ?? LIGHT["день"];
  if (!found) return colour;
  return `#${hex2(parseInt(found[1], 16) * k[0])}${hex2(parseInt(found[2], 16) * k[1])}${hex2(parseInt(found[3], 16) * k[2])}`;
}

/** Краски комнаты при дневном свете. */
const DAY = Object.freeze({
  wall: "#d8ccbf", wallLow: "#cbbdad", skirting: "#b3a08b", floor: "#a47e5d", plank: "#8f6b4d",
  frame: "#f4eee5", frameDark: "#d6ccbd", sill: "#eee5d7", sillEdge: "#d3c7b5",
  wood: "#7d5c46", woodDark: "#5f4635", woodLight: "#9b775c",
  chair: "#5f8674", chairDark: "#4a6c5d", chairLight: "#7fa391", chair2: "#b08d6b", chair2Dark: "#8f7054", chair2Light: "#c7a787",
  plaid: "#3f6db3", plaidLight: "#7ba3de", plaidDark: "#2d5289",
  rug: "#9a5462", rugLight: "#bd7785", rugDark: "#7e404e",
  skin: "#f8e0d1", skinDark: "#eac6b3", blush: "#f2a7a0", hair: "#1e1b24", hairLight: "#3d3747", eye: "#d42c45", white: "#ffffff",
  top: "#a2242f", topDark: "#7f1a25", jacket: "#24212c", jacketLight: "#3b3745", stocking: "#2b2834", silver: "#c9ccd4",
  cat: "#8f949e", catDark: "#6c717b", catLight: "#c6cad1", catEar: "#e3a4ad", catEye: "#dcd44c", nose: "#d98a94",
  paper: "#f6f1e6", paperDark: "#ddd5c4", ink: "#4a4350", red: "#c7353f", gold: "#e0b34f", green: "#5d9c63", greenDark: "#3f7a4b", greenDry: "#8fa07a",
  pot: "#c2714f", potDark: "#9e563a", soil: "#5a4334", soilDry: "#93806b", metal: "#b9bec8", metalDark: "#8b909b",
  box: "#c49a6c", boxDark: "#a37c52", bowl: "#d9605a", bowlDark: "#b3443f", food: "#8a5a3c", pillow: "#e5d3c3", pillowDark: "#cbb5a2",
  navy: "#1f2747", star: "#f3e9b8", lamp: "#f2b85b", walle: "#e2a93b", walleDark: "#8c6a2a", steam: "#ffffff", bulbOff: "#b9ad9c",
  mug: "#b73a45", mug2: "#4f7fc0", treeGreen: "#3f7f55", treeDark: "#2c5f40", slipper: "#d9a7b0", slipperDark: "#b98590",
});

// ── разметка ─────────────────────────────────────────────────────────────────
const n = (value) => (Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10));
const at = (x, y, body, extra = "") => `<g transform="translate(${n(x)} ${n(y)})${extra}">${body}</g>`;
const flip = (body) => `<g transform="scale(-1 1)">${body}</g>`;
const esc = (text) => String(text ?? "").replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
/** Невидимая область нажатия: палец шире мыши, а кот — маленький. */
const hit = (x, y, w, h) => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="#000" fill-opacity="0"/>`;
/** Область в пределах рисунка: фигура у края не выносит нажатие за картинку. */
const within = ([x, y, w, h]) => {
  const left = Math.max(0, x), top = Math.max(0, y);
  return [left, top, Math.max(1, Math.min(WIDTH, x + w) - left), Math.max(1, Math.min(HEIGHT, y + h) - top)];
};
/**
 * Место, на которое можно нажать: `act` — что сделать (то же слово уходит сердцу), `label` — подпись для чтения
 * с экрана, `box` — область [x, y, ширина, высота], `id` — имя на странице: по нему сердечко находит, над кем взлететь.
 */
const tap = (act, label, box, id = "") => `<g class="tap" data-act="${esc(act)}" role="button" tabindex="0" aria-label="${esc(label)}"${id ? ` id="${id}"` : ""}>${hit(...within(box))}</g>`;

/** Что можно тронуть ради заботы: подпись, имя на странице и область. Эти области — поверх всех остальных. */
const CARE_ZONES = Object.freeze({
  water: ["Колючка", "plant", [328, 222, 32, 42]],
  tea: ["Чайник", "kettle", [310, 284, 42, 38]],
  feed: ["Миска Байта", "bowl", [18, 384, 46, 30]],
  play: ["Клубок", "toy", [104, 464, 48, 28]],
});
/** Вещи, которые появляются у человека со временем (`ITEMS` в `tgcloud/lib/room.js`): подпись и область. */
const THING_ZONES = Object.freeze({
  "рисунок": ["Её рисунок", [16, 118, 44, 46]],
  "календарь": ["Календарь", [62, 118, 38, 46]],
  "снимок": ["Рамка с первым разговором", [68, 238, 32, 30]],
  "кружка": ["Вторая кружка", [36, 294, 18, 22]],
  "подушка": ["Вторая подушка", [146, 238, 44, 26]],
  "место": ["Место рядом с Байтом", [262, 250, 40, 14]],
  "кактус": ["Маленький кактус", [358, 238, 20, 26]],
  "плед": ["Плед на двоих", [118, 288, 46, 96]],
  "кресло": ["Второе кресло", [202, 300, 72, 94]],
  "абажур": ["Абажур любимого цвета", [364, 262, 34, 30]],
  // Выше нижнего края: поверх него на странице лежит полоса с её словами.
  "тапочки": ["Тапочки у двери", [18, 466, 60, 22]],
  "ёлка": ["Ёлка", [332, 378, 68, 132]],
});
/**
 * Вещи, чьи области лежат поверх Аи и Байта: лампа и ёлка стоят перед ними, а «место рядом с Байтом» мало
 * и лежит у него под боком — под его областью до него было бы не дотянуться.
 */
const FRONT_THINGS = new Set(["абажур", "ёлка", "место"]);
/**
 * Область Байта рядом с заботой: он сидит у миски — нажатие на миску кормит, на него — гладит. Его область
 * отступает от миски, чайника, клубка и Колючки; из четырёх сторон выбирается та, после которой сам Байт
 * (`anchor` — середина его тела) остаётся внутри, а из таких — та, что отнимает меньше.
 */
function besideCare([x, y, w, h], [ax, ay]) {
  let box = [x, y, x + w, y + h];
  for (const [, , [cx, cy, cw, ch]] of Object.values(CARE_ZONES)) {
    const [left, top, right, bottom] = box;
    if (right <= cx || left >= cx + cw || bottom <= cy || top >= cy + ch) continue;
    const ways = [[cx + cw, top, right, bottom], [left, top, cx, bottom], [left, cy + ch, right, bottom], [left, top, right, cy]]
      .filter(way => way[2] - way[0] > 0 && way[3] - way[1] > 0)
      .map(way => ({ way, keeps: ax >= way[0] && ax <= way[2] && ay >= way[1] && ay <= way[3], area: (way[2] - way[0]) * (way[3] - way[1]) }))
      .sort((one, two) => Number(two.keeps) - Number(one.keeps) || two.area - one.area);
    if (ways.length) box = ways[0].way;
  }
  return [box[0], box[1], box[2] - box[0], box[3] - box[1]];
}

// Окно и то, что за ним.
const WIN = Object.freeze({ x: 124, y: 44, w: 264, h: 218 });
const FAR = Object.freeze([[124, 96], [150, 74], [178, 112], [206, 60], [232, 88], [262, 70], [288, 104], [316, 82], [342, 64], [368, 98]]);
const NEAR = Object.freeze([[124, 42], [146, 58], [176, 34], [198, 66], [230, 46], [256, 28], [280, 56], [312, 40], [340, 62], [366, 36]]);
const LIGHTS = Object.freeze([
  [130, 180], [138, 196], [156, 200], [162, 214], [184, 160], [190, 176], [212, 210], [216, 224], [238, 184], [244, 200], [270, 200], [268, 216],
  [296, 170], [302, 212], [322, 190], [330, 230], [348, 206], [352, 222], [374, 176], [380, 236], [206, 236], [150, 226], [284, 240], [226, 150], [352, 150],
]);
const DROPS = Object.freeze([[150, 92], [176, 150], [201, 70], [232, 120], [247, 196], [275, 84], [318, 132], [336, 60], [362, 178], [372, 108], [140, 214], [292, 222]]);

function outside(part) {
  const [top, bottom] = SKY[part];
  const [far, near] = CITY[part];
  const base = WIN.y + WIN.h;
  const row = (list, width) => list.map(([x, tall]) => `<rect x="${x}" y="${base - tall}" width="${width}" height="${tall}"/>`).join("");
  const glow = lit(part) || part === "утро";
  return [
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`,
    `<clipPath id="glass"><rect x="${WIN.x}" y="${WIN.y}" width="${WIN.w}" height="${WIN.h}"/></clipPath></defs>`,
    `<g clip-path="url(#glass)">`,
    `<rect x="${WIN.x}" y="${WIN.y}" width="${WIN.w}" height="${WIN.h}" fill="url(#sky)"/>`,
    `<g fill="${far}">${row(FAR, 30)}<rect x="213" y="${base - 124}" width="3" height="20"/><rect x="349" y="${base - 86}" width="2" height="24"/></g>`,
    `<g fill="${near}">${row(NEAR, 34)}<path d="M176 ${base - 34} l17 -12 l17 12z M280 ${base - 56} l16 -10 l16 10z"/></g>`,
    // Окна города: вечером и ночью — почти все, утром — редкие («фонари ещё не погасли»).
    glow ? `<g class="city" fill="${part === "утро" ? "#f6e3b0" : "#ffd98a"}">${LIGHTS.filter((_, index) => (part === "утро" ? index % 4 === 0 : part === "ночь" ? index % 5 !== 3 : true))
      .map(([x, y], index) => `<rect x="${x}" y="${y}" width="3" height="4" opacity="${index % 3 === 0 ? 0.95 : 0.7}"/>`).join("")}</g>` : "",
    `</g>`,
  ].join("");
}

/**
 * Дождь: длинные косые линии пунктиром. Страница двигает пунктир (`stroke-dashoffset`) ровно на его период —
 * капли падают без рывка в конце круга; без движения (тест, «уменьшить движение») это просто штрихи.
 */
function rain(part) {
  const ink = lit(part) ? "#cfd9f2" : "#ffffff";
  const base = WIN.y + WIN.h + 8;
  const line = (x, index, dash, gap) => `<path class="drop d${index % 4}" d="M${x} ${WIN.y - 14} L${n(x - (base - WIN.y + 14) * 0.3)} ${base}" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${(index * 37) % (dash + gap)}"/>`;
  const near = Array.from({ length: 13 }, (_, index) => line(150 + index * 25, index, 11, 69)).join("");
  const far = Array.from({ length: 14 }, (_, index) => line(138 + index * 24, index + 2, 6, 54)).join("");
  return [
    `<g clip-path="url(#glass)" fill="none" stroke="${ink}" stroke-linecap="round">`,
    `<g class="rain far" stroke-width="0.7" stroke-opacity="${lit(part) ? 0.22 : 0.36}">${far}</g>`,
    `<g class="rain near" stroke-width="1" stroke-opacity="${lit(part) ? 0.36 : 0.55}">${near}</g>`,
    `</g>`,
    `<g clip-path="url(#glass)" fill="${ink}" fill-opacity="${lit(part) ? 0.3 : 0.55}">${DROPS.map(([x, y]) => `<path d="M${x} ${y} q2.2 4 0 6 q-2.2 -2 0 -6z"/>`).join("")}</g>`,
  ].join("");
}

// ── стены и мебель ───────────────────────────────────────────────────────────
function walls(c) {
  const planks = [396, 424, 456, 492].map(y => `<path d="M0 ${y} H400" stroke="${c.plank}" stroke-width="1.2"/>`).join("");
  const joints = [[70, 372, 396], [250, 372, 396], [150, 396, 424], [330, 396, 424], [40, 424, 456], [220, 424, 456], [120, 456, 492], [300, 456, 492], [200, 492, 520]]
    .map(([x, from, to]) => `<path d="M${x} ${from} V${to}" stroke="${c.plank}" stroke-width="1"/>`).join("");
  return [
    // Стена — рамкой вокруг окна: само стекло остаётся прозрачным.
    `<path fill="${c.wall}" fill-rule="evenodd" d="M0 0H400V372H0Z M${WIN.x} ${WIN.y}V${WIN.y + WIN.h}H${WIN.x + WIN.w}V${WIN.y}Z"/>`,
    `<rect x="0" y="300" width="400" height="72" fill="${c.wallLow}" opacity="0.55"/>`,
    `<rect x="0" y="364" width="400" height="8" fill="${c.skirting}"/>`,
    `<rect x="0" y="372" width="400" height="148" fill="${c.floor}"/>${planks}${joints}`,
  ].join("");
}

function windowFrame(c) {
  const { x, y, w, h } = WIN;
  return [
    `<g fill="${c.frame}">`,
    `<path fill-rule="evenodd" d="M${x - 7} ${y - 7}H${x + w + 7}V${y + h}H${x - 7}Z M${x} ${y}V${y + h}H${x + w}V${y}Z"/>`,
    `<rect x="${x + 86}" y="${y}" width="5" height="${h}"/><rect x="${x + 174}" y="${y}" width="5" height="${h}"/>`,
    `<rect x="${x}" y="${y + 62}" width="${w}" height="3.5"/>`,
    `</g>`,
    `<path d="M${x - 7} ${y + h}H${x + w + 7}" stroke="${c.frameDark}" stroke-width="1.5"/>`,
  ].join("");
}

function sill(c) {
  return `<rect x="112" y="262" width="288" height="11" rx="1.5" fill="${c.sill}"/><rect x="112" y="271" width="288" height="5" fill="${c.sillEdge}"/>`;
}

/** Гирлянда: на окне или — когда стоит ёлка — на ней. Горит вечером и ночью. */
const BULBS = Object.freeze(["#ffd27a", "#ff8fa3", "#9fd0ff", "#b9f3a0", "#ffb86b"]);
function garland(c, part, { onTree = false } = {}) {
  if (onTree) return "";
  const points = [];
  for (let index = 0; index <= 12; index += 1) {
    const x = 122 + index * 22.3;
    points.push([x, 40 + Math.sin((index / 12) * Math.PI * 3) ** 2 * 10 + (index % 2 ? 2 : 0)]);
  }
  // Хвост гирлянды спускается по левой стороне рамы: его она и поправляет.
  const tail = [[121, 62], [119, 92], [121, 124], [118, 156], [120, 190], [118, 222], [120, 252]];
  const wire = `M${points.map(([x, y]) => `${n(x)} ${n(y)}`).join(" L")} M${n(points[0][0])} ${n(points[0][1])} L${tail.map(([x, y]) => `${x} ${y}`).join(" L")}`;
  const bulbs = [...points.slice(1), ...tail].map(([x, y], index) => bulb(x, y + 3, BULBS[index % BULBS.length], c, part, index)).join("");
  return `<path d="${wire}" fill="none" stroke="${c.ink}" stroke-width="0.9" stroke-linejoin="round"/>${bulbs}`;
}
function bulb(x, y, colour, c, part, index) {
  if (!lit(part)) return `<circle cx="${n(x)}" cy="${n(y)}" r="2.6" fill="${tint(colour, part)}" opacity="0.85"/>`;
  return `<g class="bulb b${index % 4}"><circle cx="${n(x)}" cy="${n(y)}" r="9" fill="${colour}" opacity="0.2"/><circle cx="${n(x)}" cy="${n(y)}" r="2.8" fill="${colour}"/></g>`;
}

function starMap(c) {
  const stars = [[30, 62], [42, 74], [52, 64], [64, 78], [76, 66], [86, 92], [26, 96], [58, 98], [40, 54], [90, 56], [72, 100]];
  return [
    `<rect x="16" y="44" width="84" height="68" rx="2" fill="${c.woodDark}"/><rect x="19" y="47" width="78" height="62" fill="${c.navy}"/>`,
    `<path d="M30 62 L42 74 L52 64 L64 78 L76 66" fill="none" stroke="${c.star}" stroke-width="0.7" opacity="0.7"/>`,
    stars.map(([x, y], index) => `<circle cx="${x}" cy="${y}" r="${index < 5 ? 1.5 : 0.9}" fill="${c.star}"/>`).join(""),
    `<circle cx="84" cy="74" r="5" fill="none" stroke="${c.star}" stroke-width="0.5" opacity="0.5"/>`,
  ].join("");
}

function bookcase(c, has) {
  const x = 10, y = 170, w = 96, h = 202;
  const shelves = [218, 266, 314].map(level => `<rect x="${x + 4}" y="${level}" width="${w - 8}" height="5" fill="${c.wood}"/>`).join("");
  const book = (bx, by, bw, bh, colour, tilt = 0) => `<rect x="${bx}" y="${by - bh}" width="${bw}" height="${bh}" rx="0.8" fill="${colour}"${tilt ? ` transform="rotate(${tilt} ${bx} ${by})"` : ""}/>`;
  const top = [
    // ВАЛЛ-И: коробочка на гусеницах, два глаза-бинокля.
    `<g><rect x="22" y="200" width="18" height="14" rx="2" fill="${c.walle}"/><rect x="20" y="212" width="22" height="6" rx="3" fill="${c.walleDark}"/>`,
    `<rect x="24" y="190" width="6.5" height="7" rx="2.5" fill="${c.metal}"/><rect x="31.5" y="190" width="6.5" height="7" rx="2.5" fill="${c.metal}"/>`,
    `<circle cx="27.2" cy="193.5" r="1.7" fill="${c.ink}"/><circle cx="34.8" cy="193.5" r="1.7" fill="${c.ink}"/><rect x="30" y="196" width="2" height="5" fill="${c.walleDark}"/></g>`,
    book(50, 218, 6, 30, c.plaidDark), book(57, 218, 5, 26, c.rug), book(63, 218, 7, 32, c.greenDark), book(71, 218, 5, 24, c.paperDark), book(78, 218, 6, 28, c.top, 9),
  ].join("");
  const middle = [
    // «Маленький принц» — жёлтый корешок со звездой; рядом — тома манги.
    book(18, 266, 8, 34, c.gold), `<path d="M22 240 l1.2 2.6 2.8 .3 -2.1 1.9 .6 2.8 -2.5 -1.4 -2.5 1.4 .6 -2.8 -2.1 -1.9 2.8 -.3z" fill="${c.paper}"/>`,
    [0, 1, 2, 3, 4, 5].map(index => `<rect x="${29 + index * 6}" y="238" width="5" height="28" rx="0.6" fill="${c.paper}"/><rect x="${29 + index * 6}" y="238" width="5" height="7" fill="${index % 2 ? c.top : c.jacket}"/>`).join(""),
    has("снимок") ? `<rect x="72" y="242" width="24" height="24" rx="1.5" fill="${c.woodLight}"/><rect x="75" y="245" width="18" height="18" fill="${c.paper}"/><path d="M78 250h12M78 254h9M78 258h11" stroke="${c.ink}" stroke-width="1" opacity="0.6"/>` : book(72, 266, 6, 26, c.chairDark) + book(79, 266, 7, 30, c.plaid),
  ].join("");
  const low = [
    mug(26, 314, c.mug, c), has("кружка") ? mug(44, 314, c.mug2, c) : "",
    `<rect x="62" y="294" width="30" height="20" rx="1.5" fill="${c.green}"/><rect x="66" y="299" width="22" height="9" rx="1" fill="${c.paper}"/>`,
  ].join("");
  const bottom = [
    `<rect x="18" y="330" width="34" height="34" rx="2" fill="${c.jacket}"/><circle cx="35" cy="341" r="6" fill="${c.chairDark}"/><circle cx="35" cy="355" r="4" fill="${c.chairDark}"/>`,
    `<rect x="58" y="338" width="38" height="26" rx="2" fill="${c.box}"/><rect x="72" y="346" width="10" height="4" rx="1" fill="${c.boxDark}"/>`,
  ].join("");
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${c.wood}"/><rect x="${x + 4}" y="${y + 5}" width="${w - 8}" height="${h - 9}" fill="${c.woodDark}"/>`,
    top, middle, low, bottom, shelves,
    `<rect x="${x - 2}" y="${y - 3}" width="${w + 4}" height="6" rx="1.5" fill="${c.woodLight}"/>`,
  ].join("");
}

function mug(x, base, colour, c, { steam = false } = {}) {
  return [
    `<path d="M${x + 5} ${base - 9} q7 0 7 4.5 q0 4.5 -7 4.5" fill="none" stroke="${colour}" stroke-width="2"/>`,
    `<path d="M${x - 6} ${base - 12} h12 v9 q0 3 -3 3 h-6 q-3 0 -3 -3z" fill="${colour}"/><rect x="${x - 6}" y="${base - 12}" width="12" height="2" fill="${c.paper}" opacity="0.5"/>`,
    steam ? `<g class="steam" fill="none" stroke="${c.steam}" stroke-width="1.3" stroke-linecap="round" opacity="0.6"><path d="M${x - 2} ${base - 15} q-3 -4 0 -8"/><path d="M${x + 2.5} ${base - 16} q3 -4 0 -8"/></g>` : "",
  ].join("");
}

/** Кресло: `second` — второе (вещь «кресло»). Плед на спинке — отдельно (`plaidOnChair`). */
function armchair(c, x, { second = false } = {}) {
  const [fill, dark, light] = second ? [c.chair2, c.chair2Dark, c.chair2Light] : [c.chair, c.chairDark, c.chairLight];
  const w = second ? 72 : 86, top = second ? 300 : 288;
  return [
    `<ellipse cx="${x + w / 2}" cy="391" rx="${w / 2 - 6}" ry="4.5" fill="#000" opacity="0.22"/>`,
    `<rect x="${x + 6}" y="378" width="6" height="16" rx="1" fill="${c.woodDark}"/><rect x="${x + w - 12}" y="378" width="6" height="16" rx="1" fill="${c.woodDark}"/>`,
    `<path d="M${x + 9} ${top + 12} q0 -12 12 -12 h${w - 42} q12 0 12 12 v56 h-${w - 18}z" fill="${fill}"/>`,
    `<path d="M${x + 15} ${top + 14} q0 -8 8 -8 h${w - 46} q8 0 8 8 v36 h-${w - 30}z" fill="${light}" opacity="0.45"/>`,
    `<rect x="${x + 11}" y="340" width="${w - 22}" height="14" rx="5" fill="${light}"/>`,
    `<rect x="${x}" y="326" width="17" height="56" rx="8" fill="${dark}"/><rect x="${x + w - 17}" y="326" width="17" height="56" rx="8" fill="${dark}"/>`,
    `<rect x="${x + 11}" y="352" width="${w - 22}" height="30" rx="3" fill="${fill}"/>`,
  ].join("");
}

/** Клетчатый плед: `d` — контур. Клетка — полосами по контуру. */
function plaidShape(c, d, id) {
  return [
    `<defs><clipPath id="${id}"><path d="${d}"/></clipPath></defs><path d="${d}" fill="${c.plaid}"/>`,
    `<g clip-path="url(#${id})" stroke="${c.plaidLight}" stroke-width="2.4" opacity="0.6">${[-80, -62, -44, -26, -8, 10, 28, 46, 64, 82, 100, 118, 136].map(shift => `<path d="M${shift} -60 l110 220"/>`).join("")}</g>`,
    `<g clip-path="url(#${id})" stroke="${c.plaidDark}" stroke-width="2" opacity="0.5">${[-40, -22, -4, 14, 32, 50, 68, 86, 104, 122].map(shift => `<path d="M${shift + 60} -60 l-110 220"/>`).join("")}</g>`,
  ].join("");
}
/** Плед, брошенный на спинку и подлокотник кресла. `big` — вещь «плед на двоих»: он шире. */
function plaidOnChair(c, big) {
  const d = big ? "M-6 0 q18 -8 40 -2 l8 44 q4 22 -4 40 l-30 6 q-14 -30 -14 -88z" : "M0 0 q14 -6 30 -2 l6 40 q2 16 -4 30 l-22 4 q-10 -22 -10 -72z";
  return at(124, 292, plaidShape(c, d, "plaidA"));
}

function stool(c, x, y) {
  return `<rect x="${x - 11}" y="${y}" width="22" height="5" rx="2" fill="${c.woodLight}"/><path d="M${x - 8} ${y + 5} l-2 ${392 - y - 5} M${x + 8} ${y + 5} l2 ${392 - y - 5}" stroke="${c.wood}" stroke-width="3" stroke-linecap="round"/><path d="M${x - 9} ${y + 22} h18" stroke="${c.wood}" stroke-width="2"/>`;
}

function desk(c) {
  return [
    `<rect x="304" y="326" width="6" height="64" fill="${c.wood}"/><rect x="390" y="326" width="6" height="64" fill="${c.wood}"/>`,
    `<rect x="330" y="326" width="56" height="18" rx="1.5" fill="${c.wood}"/><rect x="352" y="333" width="12" height="3" rx="1.5" fill="${c.woodLight}"/>`,
    `<rect x="298" y="318" width="102" height="8" rx="2" fill="${c.woodLight}"/>`,
  ].join("");
}

/** Лампа на столе: абажур — янтарный или любимого цвета человека (`shade`). Вечером и ночью горит. */
function lamp(c, part, shade) {
  const colour = lit(part) ? shade : tint(shade, part);
  const body = [
    `<rect x="372" y="313" width="18" height="5" rx="2" fill="${c.metalDark}"/><rect x="380" y="284" width="2.4" height="30" fill="${c.metalDark}"/>`,
    `<path d="M369 286 l5 -20 h14 l5 20z" fill="${colour}"/>`,
    lit(part) ? `<path d="M371 286 h20 l-2 3 h-16z" fill="#fff3d0" opacity="0.9"/>` : "",
  ].join("");
  return body;
}
function lampGlow(part, shade) {
  if (!lit(part)) return "";
  return [
    `<defs><radialGradient id="lampGlow"><stop offset="0" stop-color="${shade}" stop-opacity="0.5"/><stop offset="0.45" stop-color="${shade}" stop-opacity="0.2"/><stop offset="1" stop-color="${shade}" stop-opacity="0"/></radialGradient></defs>`,
    `<circle class="glow" cx="381" cy="296" r="${part === "ночь" ? 122 : 104}" fill="url(#lampGlow)"/>`,
    `<ellipse cx="366" cy="321" rx="34" ry="4" fill="#ffe7b0" opacity="0.32"/>`,
  ].join("");
}

function kettle(c, { steam = false } = {}) {
  return [
    `<path d="M336 304 q8 -6 10 2" fill="none" stroke="${c.metalDark}" stroke-width="2.4" stroke-linecap="round"/>`,
    `<path d="M316 318 q-3 -16 10 -17 q13 1 10 17z" fill="${c.metal}"/><path d="M319 306 h14" stroke="${c.metalDark}" stroke-width="1.2"/>`,
    `<path d="M318 300 q8 -9 16 0" fill="none" stroke="${c.ink}" stroke-width="1.8"/><circle cx="326" cy="300.5" r="1.8" fill="${c.ink}"/>`,
    steam ? `<g class="steam" fill="none" stroke="${c.steam}" stroke-width="1.4" stroke-linecap="round" opacity="0.6"><path d="M347 298 q-3 -5 0 -9"/><path d="M351 300 q3 -5 0 -10"/></g>` : "",
  ].join("");
}
function notebook(c) {
  return `<rect x="344" y="313" width="22" height="5" rx="1" fill="${c.top}"/><rect x="345" y="312" width="20" height="2" fill="${c.paper}"/><path d="M366 311 l8 -5" stroke="${c.gold}" stroke-width="1.6" stroke-linecap="round"/>`;
}

function rug(c) {
  return [
    `<ellipse cx="200" cy="452" rx="150" ry="44" fill="${c.rug}"/><ellipse cx="200" cy="452" rx="132" ry="36" fill="none" stroke="${c.rugLight}" stroke-width="2.5" stroke-dasharray="2 7" stroke-linecap="round"/>`,
    `<ellipse cx="200" cy="452" rx="92" ry="22" fill="${c.rugDark}" opacity="0.35"/>`,
  ].join("");
}

function bowl(c, full) {
  return [
    `<ellipse cx="40" cy="404" rx="16" ry="4.5" fill="${c.bowlDark}"/><path d="M24 398 h32 l-3 7 h-26z" fill="${c.bowl}"/><ellipse cx="40" cy="398" rx="16" ry="3.6" fill="${c.bowlDark}"/>`,
    full ? `<ellipse cx="40" cy="397.4" rx="12.5" ry="2.8" fill="${c.food}"/><circle cx="36" cy="396.4" r="1.5" fill="${c.boxDark}"/><circle cx="43" cy="396.8" r="1.4" fill="${c.boxDark}"/>` : `<ellipse cx="40" cy="398.2" rx="12" ry="2.2" fill="${c.paper}" opacity="0.35"/>`,
  ].join("");
}
function catPillow(c) {
  return `<ellipse cx="300" cy="488" rx="29" ry="9.5" fill="${c.pillowDark}"/><ellipse cx="300" cy="485" rx="28" ry="8.5" fill="${c.pillow}"/><path d="M280 485 q20 4 40 0" fill="none" stroke="${c.pillowDark}" stroke-width="1"/>`;
}
function boxBack(c) {
  return `<path d="M292 398 h40 v8 h-40z" fill="${c.boxDark}"/><path d="M292 398 l-7 -7 M332 398 l7 -7" stroke="${c.boxDark}" stroke-width="3" stroke-linecap="round"/>`;
}
function boxFront(c) {
  return `<rect x="292" y="404" width="40" height="24" rx="1.5" fill="${c.box}"/><rect x="304" y="412" width="16" height="7" rx="1" fill="${c.paper}" opacity="0.7"/><path d="M308 415.5 h8" stroke="${c.greenDark}" stroke-width="1.4"/>`;
}
function yarn(c) {
  return `<circle cx="118" cy="478" r="7" fill="${c.top}"/><path d="M112.5 475 q5.5 -4 11 0 M112 480 q6 4 12 0 M118 471 v14" fill="none" stroke="${c.rugLight}" stroke-width="1"/><path d="M124 482 q8 5 14 0 q5 -4 10 1" fill="none" stroke="${c.top}" stroke-width="1.6" stroke-linecap="round"/>`;
}

function cactus(c, x, base, wet, small = false) {
  const green = wet ? c.green : c.greenDry, dark = wet ? c.greenDark : c.green;
  const k = small ? 0.62 : 1;
  const body = [
    `<path d="M-8 0 h16 l-2 -11 h-12z" fill="${c.pot}"/><rect x="-9.5" y="-13.5" width="19" height="4" rx="1.5" fill="${c.potDark}"/><ellipse cx="0" cy="-13" rx="7.5" ry="1.6" fill="${wet ? c.soil : c.soilDry}"/>`,
    `<path d="M-5.5 -13 v-15 q0 -6 5.5 -6 q5.5 0 5.5 6 v15z" fill="${green}"/>`,
    small ? "" : `<path d="M5 -20 h4 q4 0 4 -4 v-4" fill="none" stroke="${green}" stroke-width="4.4" stroke-linecap="round"/><path d="M-5 -17 h-3 q-4 0 -4 -4 v-2" fill="none" stroke="${green}" stroke-width="4" stroke-linecap="round"/>`,
    `<path d="M0 -32 v17 M-2.8 -30 v15 M2.8 -30 v15" stroke="${dark}" stroke-width="0.8" opacity="0.7"/>`,
    // Политая Колючка цветёт; сухая — нет.
    wet && !small ? `<circle cx="0" cy="-35" r="3" fill="${c.blush}"/><circle cx="0" cy="-35" r="1.2" fill="${c.gold}"/>` : "",
  ].join("");
  return at(x, base, body, k === 1 ? "" : ` scale(${k})`);
}

function slippers(c) {
  const one = (x, y, turn) => `<g transform="rotate(${turn} ${x} ${y})"><ellipse cx="${x}" cy="${y}" rx="11" ry="5.5" fill="${c.slipperDark}"/><path d="M${x - 2} ${y - 5.5} q13 -1 13 5.5 q0 6 -13 5.5z" fill="${c.slipper}"/></g>`;
  return one(34, 505, -8) + one(60, 507, 6);
}
function calendar(c) {
  return [
    `<rect x="64" y="120" width="34" height="42" rx="1.5" fill="${c.paper}"/><rect x="64" y="120" width="34" height="9" rx="1.5" fill="${c.red}"/>`,
    [0, 1, 2, 3].map(row => [0, 1, 2, 3, 4].map(col => `<rect x="${68 + col * 5.6}" y="${134 + row * 6.4}" width="3.4" height="3.4" rx="0.6" fill="${c.paperDark}"/>`).join("")).join(""),
    `<circle cx="80.9" cy="142.1" r="4.4" fill="none" stroke="${c.red}" stroke-width="1.4"/>`,
  ].join("");
}
function drawing(c) {
  return [
    `<rect x="18" y="120" width="40" height="42" rx="1.5" fill="${c.woodLight}"/><rect x="21" y="123" width="34" height="36" fill="${c.paper}"/>`,
    `<circle cx="46" cy="132" r="4" fill="${c.gold}"/><path d="M24 154 q8 -14 15 -4 q6 -10 14 4z" fill="${c.green}" opacity="0.8"/><path d="M27 138 q4 -6 8 0 q4 -6 8 0" fill="none" stroke="${c.top}" stroke-width="1.4" stroke-linecap="round"/>`,
  ].join("");
}
function sillPillow(c) {
  return `<path d="M150 262 q-3 -17 3 -20 h30 q6 3 3 20z" fill="${c.plaidLight}"/><path d="M155 246 h26" stroke="${c.paper}" stroke-width="1.2" opacity="0.7"/>`;
}
function sillSeat(c) {
  return `<ellipse cx="282" cy="260" rx="17" ry="4.5" fill="${c.rugLight}"/><path d="M276 259 a1.6 1.6 0 1 0 0.1 0 M282 257 a1.8 1.8 0 1 0 0.1 0 M288 259 a1.6 1.6 0 1 0 0.1 0 M282 261.5 a2.4 1.6 0 1 0 0.1 0" fill="${c.paper}" opacity="0.8"/>`;
}
function tree(c, part) {
  const tiers = [[0, -118, 15], [0, -92, 24], [0, -62, 32]].map(([x, y, half]) => `<path d="M${x} ${y} l${half} 42 h-${half * 2}z" fill="${c.treeGreen}"/>`).join("");
  const spots = [[-6, -92], [7, -76], [-12, -58], [3, -52], [14, -40], [-20, -30], [-4, -26], [20, -24]];
  const lights = spots.map(([x, y], index) => (lit(part)
    ? `<g class="bulb b${index % 4}"><circle cx="${x}" cy="${y}" r="8" fill="${BULBS[index % 5]}" opacity="0.22"/><circle cx="${x}" cy="${y}" r="2.6" fill="${BULBS[index % 5]}"/></g>`
    : `<circle cx="${x}" cy="${y}" r="2.6" fill="${tint(BULBS[index % 5], part)}"/>`)).join("");
  return at(366, 506, [
    `<rect x="-4" y="-22" width="8" height="14" fill="${c.wood}"/><path d="M-13 -10 h26 l-3 10 h-20z" fill="${c.pot}"/>`,
    tiers, `<path d="M-10 -84 q10 8 22 2 M-18 -52 q18 12 36 2 M-24 -24 q24 10 50 0" fill="none" stroke="${c.ink}" stroke-width="0.8" opacity="0.7"/>`,
    lights, `<path d="M0 -127 l2.4 5 5.4 .6 -4 3.7 1.1 5.4 -4.9 -2.7 -4.9 2.7 1.1 -5.4 -4 -3.7 5.4 -.6z" fill="${lit(part) ? "#ffe08a" : c.gold}"/>`,
  ].join(""));
}

// ── Аи ───────────────────────────────────────────────────────────────────────
/** Она и Байт нарисованы мелко и увеличиваются при постановке: на телефоне весь рисунок — шириной с ладонь. */
const HER_SCALE = 1.45;
const CAT_SCALE = 1.34;
/** Табурет: где стоит у стола и на какой высоте сиденье (с него она дотягивается до столешницы, ступни — на полу). */
const STOOL = Object.freeze({ x: 282, y: 359 });
/** Волосы сзади: длинные, прямые. Рисуются под телом. */
function hairBack(c, long = 50) {
  return `<path d="M-16.5 -3 C-18 -21 18 -21 16.5 -3 L19 ${long - 6} Q0 ${long + 2} -19 ${long - 6}Z" fill="${c.hair}"/>`;
}
/**
 * Голова: лицо, прямая чёлка, пряди у щёк, алые глаза. `face` — выражение (MOODS), `look` — куда смотрит
 * (−1 влево, 0 прямо, 1 вправо). Точка отсчёта — центр лица.
 */
function head(c, face = "calm", look = 0) {
  const dx = look * 2.2;
  const eye = (x) => {
    const cx = x + dx;
    if (face === "sleep" || face === "happy") return `<path d="M${n(cx - 3)} 3.6 q3 ${face === "happy" ? -3.4 : 2.6} 6 0" fill="none" stroke="${c.hair}" stroke-width="1.5" stroke-linecap="round"/>`;
    const lid = face === "tired" || face === "jealous" || face === "pout";
    return [
      `<ellipse cx="${n(cx)}" cy="3.4" rx="2.7" ry="${lid ? 2.2 : 3.3}" fill="${c.eye}"/>`,
      `<ellipse cx="${n(cx + look * 0.5)}" cy="${lid ? 3.8 : 3.9}" rx="1.2" ry="${lid ? 1.3 : 1.8}" fill="${c.topDark}"/>`,
      `<circle cx="${n(cx - 0.9)}" cy="2.2" r="0.8" fill="${c.white}"/>`,
      `<path d="M${n(cx - 3.2)} ${lid ? 2.3 : 0.9} q3.2 ${lid ? -0.6 : -1.9} 6.4 0" fill="none" stroke="${c.hair}" stroke-width="${lid ? 1.7 : 1.3}" stroke-linecap="round"/>`,
    ].join("");
  };
  const mouth = {
    calm: `<path d="M${n(dx - 2)} 8.6 q2 1.2 4 0" fill="none" stroke="${c.topDark}" stroke-width="0.9" stroke-linecap="round"/>`,
    smile: `<path d="M${n(dx - 2.6)} 8.2 q2.6 2.4 5.2 0" fill="none" stroke="${c.topDark}" stroke-width="1" stroke-linecap="round"/>`,
    happy: `<path d="M${n(dx - 2.6)} 7.8 q2.6 4 5.2 0z" fill="${c.topDark}"/>`,
    sleep: `<ellipse cx="${n(dx)}" cy="8.8" rx="1.1" ry="0.9" fill="${c.topDark}" opacity="0.7"/>`,
    tired: `<path d="M${n(dx - 1.8)} 9 h3.6" stroke="${c.topDark}" stroke-width="0.9" stroke-linecap="round"/>`,
    pout: `<path d="M${n(dx - 2)} 9.4 q2 -1.6 4 0" fill="none" stroke="${c.topDark}" stroke-width="1" stroke-linecap="round"/>`,
    jealous: `<path d="M${n(dx - 2.2)} 9.2 q1.1 -1.4 2.2 0 q1.1 1.4 2.2 0" fill="none" stroke="${c.topDark}" stroke-width="0.9" stroke-linecap="round"/>`,
  }[face] ?? "";
  return [
    `<ellipse cx="0" cy="1" rx="13" ry="12.4" fill="${c.skin}"/>`,
    face === "sleep" || face === "tired" ? "" : `<ellipse cx="${n(-7.6 + dx)}" cy="7.2" rx="2.4" ry="1.3" fill="${c.blush}" opacity="0.55"/><ellipse cx="${n(7.6 + dx)}" cy="7.2" rx="2.4" ry="1.3" fill="${c.blush}" opacity="0.55"/>`,
    eye(-5.4), eye(5.4), mouth,
    face === "jealous" ? `<path d="M${n(-8.4 + dx)} -1.6 l5 1.6 M${n(8.4 + dx)} -1.6 l-5 1.6" stroke="${c.hair}" stroke-width="1" stroke-linecap="round"/>` : "",
    // Чёлка — ровным срезом; пряди — вдоль щёк.
    `<path d="M-14.6 -1.4 C-16 -19.5 16 -19.5 14.6 -1.4 L13 -1.8 Q0 -4.4 -13 -1.8Z" fill="${c.hair}"/>`,
    `<path d="M-14.8 -3 q-1.4 9 0.2 17 l3.6 -0.6 q-1.4 -8 -0.4 -16z M14.8 -3 q1.4 9 -0.2 17 l-3.6 -0.6 q1.4 -8 0.4 -16z" fill="${c.hair}"/>`,
    `<path d="M-8 -13.4 q8 -3.4 15 0.6" fill="none" stroke="${c.hairLight}" stroke-width="1.4" stroke-linecap="round" opacity="0.8"/>`,
  ].join("");
}
/** Шея с чокером и кофта с курткой. Точка отсчёта — центр лица; низ кофты — на `waist`. */
function torso(c, { waist = 36, arms = "down" } = {}) {
  const sleeve = (d) => `<path d="${d}" fill="none" stroke="${c.jacket}" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  const hand = (x, y) => `<circle cx="${x}" cy="${y}" r="3" fill="${c.skin}"/>`;
  const limbs = {
    down: sleeve("M-10 18 L-12.5 33") + sleeve("M10 18 L12.5 33") + hand(-12.8, 35.4) + hand(12.8, 35.4),
    up: sleeve("M-10 18 L-19 6 L-17 -9") + sleeve("M10 18 L19 6 L17 -9") + hand(-16.6, -12) + hand(16.6, -12),
    oneUp: sleeve("M-10 18 L-12.5 33") + hand(-12.8, 35.4) + sleeve("M10 18 L21 9 L24 -9") + hand(24.4, -12.4),
    reach: sleeve("M10 18 L12.5 33") + hand(12.8, 35.4) + sleeve("M-10 18 L-20 15 L-29 8") + hand(-31.4, 6.4),
    hold: sleeve("M-10 18 L-13 27 L-5 31") + sleeve("M10 18 L13 27 L5 31") + hand(-3.4, 31.4) + hand(3.4, 31.4),
    cross: sleeve("M-10 18 L-12 27 L5 28.5") + sleeve("M10 18 L12 27 L-5 30.5") + hand(6.6, 28) + hand(-6.6, 31),
    wave: sleeve("M-10 18 L-12.5 33") + hand(-12.8, 35.4) + sleeve("M10 18 L21 14 L29 5") + hand(31, 3),
  }[arms] ?? "";
  return [
    `<rect x="-3.2" y="11" width="6.4" height="6" fill="${c.skinDark}"/><rect x="-3.6" y="13" width="7.2" height="2.2" rx="1" fill="${c.jacket}"/><circle cx="0" cy="15.6" r="1.1" fill="none" stroke="${c.silver}" stroke-width="0.7"/>`,
    `<path d="M-9.5 16.5 q9.5 -2.4 19 0 l1.8 ${waist - 16.5} h-22.6z" fill="${c.top}"/>`,
    `<path d="M-11 16.6 q-3 1 -3.2 5 l-0.6 ${waist - 22} h5.6 l1.4 -${waist - 20}z M11 16.6 q3 1 3.2 5 l0.6 ${waist - 22} h-5.6 l-1.4 -${waist - 20}z" fill="${c.jacket}"/>`,
    limbs,
  ].join("");
}
/** Стоит. Точка отсчёта — пол между ступнями. */
function standing(c, { face, arms = "down", look = 0, extra = "" } = {}) {
  const body = [
    hairBack(c, 52),
    `<path d="M-6 44 L-6.4 64 M6 44 L6.4 64" stroke="${c.stocking}" stroke-width="5.4" stroke-linecap="round"/><path d="M-6.4 66 h-3.2 M6.4 66 h3.2" stroke="${c.stocking}" stroke-width="4.4" stroke-linecap="round"/>`,
    `<path d="M-11.6 35 h23.2 l3.4 12.5 q-15 3.6 -30 0z" fill="${c.jacket}"/><path d="M-6 37 l-1.6 10 M0 37 v11 M6 37 l1.6 10" stroke="${c.jacketLight}" stroke-width="0.8"/>`,
    torso(c, { arms }), head(c, face, look), extra,
  ].join("");
  return at(0, -68, body);
}
/** В кресле: видно по пояс, ноги — под пледом. Точка отсчёта — сиденье. */
function inChair(c, { face, arms = "hold", wrap = false, book = "" } = {}) {
  const lap = wrap
    // «Завёрнута в плед по самый нос»: плед закрывает всё до глаз.
    ? plaidShape(c, "M-22 -22 q22 -11 44 0 l6 44 q2 12 -6 18 h-44 q-8 -6 -6 -18z", "plaidW")
    : plaidShape(c, "M-21 -6 q21 -8 42 0 l6 28 q2 12 -6 18 h-42 q-8 -6 -6 -18z", "plaidL");
  return [
    at(0, -44, hairBack(c, 44) + (wrap ? "" : torso(c, { arms, waist: 38 })) + head(c, face, 0)),
    lap, book ? at(0, -12, book) : "",
  ].join("");
}
/**
 * Сидит боком, ноги вправо (на табурете — вниз, на подоконнике — колени подтянуты). Точка отсчёта — сиденье.
 * Руки: rest — лежат на столе; write — пишет на листке; cup — держит кружку на столе; hug — обнимает колени с кружкой.
 */
function sitting(c, { face, look = 1, knees = false, arms = "rest" } = {}) {
  const legs = knees
    ? `<path d="M2 -3.5 L17 -18 L27 -3" fill="none" stroke="${c.stocking}" stroke-width="6.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M27 -2.6 h5" stroke="${c.stocking}" stroke-width="4.8" stroke-linecap="round"/>`
    : `<path d="M2 -3.5 L17 -3.5 L18 22" fill="none" stroke="${c.stocking}" stroke-width="6.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 24 h4.4" stroke="${c.stocking}" stroke-width="4.8" stroke-linecap="round"/>`;
  const sleeve = (d) => `<path d="${d}" fill="none" stroke="${c.jacket}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  const hand = (x, y) => `<circle cx="${x}" cy="${y}" r="2.9" fill="${c.skin}"/>`;
  const sheet = `<path d="M15 -28.6 l15 -1 l1 1.4 l-15 1z" fill="${c.paper}"/><path d="M22 -29.6 l13 0.4 l0.4 1.4 l-13 -0.2z" fill="${c.paperDark}"/>`;
  const far = { rest: "M8 -30 L15 -24.5 L22 -30.5", write: "M8 -30 L16 -25 L25 -31", cup: "M8 -30 L15 -26 L19.5 -32", hug: "M8 -30 L15 -25 L21 -27" }[arms] ?? "";
  const near = { rest: "M-7 -30 L1 -21 L13 -29.5", write: "M-7 -30 L1 -21 L14 -29.5", cup: "M-7 -30 L2 -22 L14.5 -32", hug: "M-7 -30 L3 -20 L16 -25" }[arms] ?? "";
  const farHand = { rest: hand(24.4, -31), write: `${hand(27.4, -31.6)}<path d="M28 -32.6 l3.6 -7" stroke="${c.gold}" stroke-width="1.5" stroke-linecap="round"/>`, cup: hand(21, -33), hug: hand(23, -27.4) }[arms] ?? "";
  const nearHand = { rest: hand(15.4, -30.2), write: hand(16.4, -30.2), cup: hand(16, -33), hug: hand(18.2, -25.6) }[arms] ?? "";
  const prop = {
    write: sheet,
    cup: `<g transform="translate(24 -28.4)">${mug(0, 0, c.mug, c, { steam: true })}</g>`,
    hug: `<g transform="translate(25 -19.6)">${mug(0, 0, c.mug, c, { steam: true })}</g>`,
  }[arms] ?? "";
  return [
    at(-1, -50, hairBack(c, 46)),
    `<path d="M-10 -8 q0 -6 6 -6 h12 q7 0 9 6 l1 7 h-28z" fill="${c.jacket}"/>`,
    sleeve(far), farHand,
    legs,
    `<path d="M-9 -34 q9 -2.4 18 0 l1.6 23 h-21.2z" fill="${c.top}"/><path d="M-10.4 -33.8 q-3 1 -3 5 l-0.4 18 h5 l1.2 -22z" fill="${c.jacket}"/>`,
    `<rect x="-3.2" y="-39.4" width="6.4" height="6" fill="${c.skinDark}"/><rect x="-3.6" y="-37.4" width="7.2" height="2.2" rx="1" fill="${c.jacket}"/>`,
    prop, sleeve(near), nearHand, at(0, -50, head(c, face, look)),
  ].join("");
}
/** Сидит спиной: видны волосы и плечи. Точка отсчёта — сиденье. */
function fromBehind(c) {
  return [
    `<path d="M-13 -2 q0 -7 7 -7 h12 q7 0 7 7 v3 h-26z" fill="${c.jacket}"/>`,
    `<path d="M-13.5 -32 q13.5 -5 27 0 l2 26 h-31z" fill="${c.jacket}"/>`,
    `<path d="M-16 -50 C-17.5 -70 17.5 -70 16 -50 L18.5 -8 Q0 0 -18.5 -8Z" fill="${c.hair}"/>`,
    `<path d="M-7 -62 q7 -4 14 0 M-9 -40 v26 M0 -44 v32 M9 -40 v26" fill="none" stroke="${c.hairLight}" stroke-width="1.1" stroke-linecap="round" opacity="0.7"/>`,
  ].join("");
}
/** Лежит на подушках, укрыта пледом. Точка отсчёта — середина. */
function lying(c, { face }) {
  return [
    `<ellipse cx="-44" cy="-4" rx="26" ry="13" fill="${c.pillowDark}"/><ellipse cx="-46" cy="-8" rx="24" ry="12" fill="${c.pillow}"/>`,
    `<path d="M-60 -16 q-10 18 -2 24 l34 -2 q-6 -16 -8 -26z" fill="${c.hair}"/>`,
    plaidShape(c, "M-26 -14 q34 -12 62 -4 q16 2 22 10 q3 8 -4 12 h-78 q-8 -6 -2 -18z", "plaidG"),
    `<path d="M58 -4 q8 -8 12 0 q2 6 -4 8" fill="${c.plaid}"/>`,
    at(-40, -17, head(c, face, 0), " rotate(-12)"),
  ].join("");
}

/**
 * Где она и как нарисована — по позе. Возвращает один из слоёв: `sillSeat` — на подоконнике, `seat` — в кресле,
 * `front` — на полу перед мебелью (тогда `y` — где её ступни: кто ниже, тот ближе и рисуется позже).
 */
function her(c, pose, key, view = {}) {
  const face = MOODS[key] ?? "calm";
  // Фигура ставится в точку (x, y) и увеличивается; `box` — её края в собственных единицах: по ним область нажатия
  // (`zone` — уже в единицах рисунка; сама область ложится отдельным слоем, поверх картинки).
  let zone = null;
  const put = (x, y, body, [left, top, right, bottom], { cls = "", extra = "" } = {}) => {
    zone = [x + left * HER_SCALE, y + top * HER_SCALE, (right - left) * HER_SCALE, (bottom - top) * HER_SCALE];
    return [cls ? `<g class="${cls}">` : "", `<g transform="translate(${n(x)} ${n(y)}) scale(${HER_SCALE})">${body}</g>`, cls ? `</g>` : "", extra].join("");
  };
  const STAND = [-20, -88, 20, 0], WAVE = [-34, -88, 20, 0], SIT = [-20, -70, 34, 26];
  // Байт точит когти о кресло — на ковре она встаёт чуть в стороне, а не перед ним.
  const aside = view.cat?.shape === "claw" && view.cat?.place === "chair" ? 30 : 0;
  const placed = () => {
    switch (pose) {
      case "shelf": return { y: 396, front: put(126, 396, flip(standing(c, { face, arms: "wave", look: 1 })), WAVE) };
      case "map": return { y: 398, front: put(66, 398, flip(standing(c, { face, arms: "oneUp", look: 1 })), WAVE) };
      case "garland": return { y: 393, front: `${stool(c, 146, STOOL.y)}${put(146, STOOL.y, flip(standing(c, { face, arms: "oneUp", look: 1 })), WAVE)}` };
      case "dance": return { y: 448, front: put(236 + aside, 448, standing(c, { face: face === "calm" ? "happy" : face, arms: "up" }), STAND, { cls: "sway" }) };
      case "ribbon": return { y: 448, front: put(226 + aside, 448, standing(c, { face, arms: "wave", look: 1, extra: `<path class="ribbon" d="M31 3 q10 6 4 16 q-6 10 6 18 q8 6 2 16" fill="none" stroke="${c.eye}" stroke-width="2" stroke-linecap="round"/>` }), [-20, -88, 44, 0]) };
      case "chair": return { seat: put(163, 352, inChair(c, { face, arms: key === "ревность" ? "cross" : "hold", book: key === "ревность" || key === "устала" ? "" : `<path d="M-9 -8 l9 2 l9 -2 v11 l-9 2 l-9 -2z" fill="${c.gold}"/><path d="M0 -6 v11" stroke="${c.woodDark}" stroke-width="0.8"/>` }), [-22, -64, 22, 30]) };
      case "nap": return { seat: put(163, 352, inChair(c, { face: "sleep", wrap: true }), [-22, -64, 22, 30], { extra: zzz(c, 192, 292) }) };
      case "sill": return { sillSeat: put(176, 262, sitting(c, { face, look: 1, knees: true, arms: "hug" }), [-20, -70, 34, 2]) };
      case "back": return { sillSeat: put(182, 262, fromBehind(c), [-19, -70, 19, 2]) };
      case "lie": return { y: 458, front: put(204, 458, lying(c, { face: face === "calm" ? "tired" : face }), [-72, -36, 72, 10], { extra: face === "sleep" ? zzz(c, 160, 396) : "" }) };
      case "desk":
      default: return {
        y: 393, stoolUsed: true,
        front: `${stool(c, STOOL.x, STOOL.y)}${put(STOOL.x, STOOL.y, sitting(c, { face, look: 0.6, arms: key === "дело" || key === "ревность" ? "write" : key === "обида" || view.tea ? "cup" : "rest" }), SIT)}`,
      };
    }
  };
  return { ...placed(), zone };
}
function zzz(c, x, y) {
  return `<g class="zzz" fill="${c.paper}" font-family="system-ui, sans-serif" font-weight="700" opacity="0.85"><text x="${x}" y="${y}" font-size="9">z</text><text x="${x + 7}" y="${y - 9}" font-size="11">z</text><text x="${x + 16}" y="${y - 20}" font-size="13">Z</text></g>`;
}

// ── Байт ─────────────────────────────────────────────────────────────────────
/** Морда: `eyes` — open, closed, narrow, wide. Точка отсчёта — центр. */
function catHead(c, eyes = "open") {
  const eye = (x) => {
    if (eyes === "closed") return `<path d="M${x - 2.6} 0.4 q2.6 2.2 5.2 0" fill="none" stroke="${c.ink}" stroke-width="1.1" stroke-linecap="round"/>`;
    const tall = eyes === "narrow" ? 1.5 : eyes === "wide" ? 3.4 : 2.7;
    return `<ellipse cx="${x}" cy="0" rx="2.6" ry="${tall}" fill="${c.catEye}"/><ellipse cx="${x}" cy="0" rx="${eyes === "wide" ? 1.5 : 0.8}" ry="${tall - 0.3}" fill="${c.ink}"/>`;
  };
  return [
    `<path d="M-9.4 -4 L-8.4 -13.5 L-2 -8z M9.4 -4 L8.4 -13.5 L2 -8z" fill="${c.cat}"/><path d="M-7.6 -6 L-7.4 -10.8 L-4.2 -8z M7.6 -6 L7.4 -10.8 L4.2 -8z" fill="${c.catEar}"/>`,
    `<ellipse cx="0" cy="0" rx="10.4" ry="8.8" fill="${c.cat}"/><ellipse cx="0" cy="3.4" rx="5" ry="3.6" fill="${c.catLight}"/>`,
    `<path d="M-2.4 -8.6 v3 M0 -8.8 v3.6 M2.4 -8.6 v3" stroke="${c.catDark}" stroke-width="1" stroke-linecap="round"/>`,
    eye(-4.2), eye(4.2),
    `<path d="M-1.3 2.2 h2.6 l-1.3 1.5z" fill="${c.nose}"/><path d="M0 3.7 q-1.6 1.8 -3 0.4 M0 3.7 q1.6 1.8 3 0.4" fill="none" stroke="${c.ink}" stroke-width="0.7" stroke-linecap="round"/>`,
    `<path d="M-6 3 l-6.4 -1 M-6 4.4 l-6.4 1.4 M6 3 l6.4 -1 M6 4.4 l6.4 1.4" stroke="${c.catLight}" stroke-width="0.6" stroke-linecap="round"/>`,
  ].join("");
}
const tailPath = (c, d, extra = "") => `<path class="tailwag" d="${d}" fill="none" stroke="${c.cat}" stroke-width="4.6" stroke-linecap="round"${extra}/>`;
/** Байт. Точка отсчёта — пол под ним. Фигуры в профиль смотрят влево. */
function catShape(c, shape, { eyes = "open" } = {}) {
  switch (shape) {
    case "lie": return [
      tailPath(c, "M20 -6 q14 0 12 -12"),
      `<ellipse cx="4" cy="-8.6" rx="19" ry="8.8" fill="${c.cat}"/><path d="M-4 -16 l2 5 M3 -17 l1 5.4 M10 -16.4 l0 5" stroke="${c.catDark}" stroke-width="1.6" stroke-linecap="round"/>`,
      `<ellipse cx="-13" cy="-1.6" rx="6" ry="2.4" fill="${c.catLight}"/><ellipse cx="-3" cy="-1.2" rx="5" ry="2.2" fill="${c.catLight}"/>`,
      at(-14, -13, catHead(c, eyes)),
    ].join("");
    case "curl": return [
      `<ellipse cx="0" cy="-9" rx="17" ry="9.6" fill="${c.cat}"/><path d="M-2 -18 q4 2 3 6 M6 -17.6 q4 2 3 6" fill="none" stroke="${c.catDark}" stroke-width="1.6" stroke-linecap="round"/>`,
      `<path d="M16 -8 q4 9 -10 8.4 q-12 -0.4 -18 -3" fill="none" stroke="${c.catDark}" stroke-width="4.4" stroke-linecap="round"/>`,
      at(-9, -9.4, catHead(c, "closed"), " scale(0.86)"),
    ].join("");
    case "walk": return [
      tailPath(c, "M19 -19 q10 -4 8 -19"),
      `<path d="M-9 -10 v10 M-3 -10 v10 M9 -10 v10 M15 -10 v10" stroke="${c.catDark}" stroke-width="3.6" stroke-linecap="round"/>`,
      `<ellipse cx="3" cy="-17" rx="18" ry="8.4" fill="${c.cat}"/><path d="M0 -24.6 l1 5 M7 -25 l0 5 M13 -24 l-1 5" stroke="${c.catDark}" stroke-width="1.6" stroke-linecap="round"/>`,
      at(-16, -22, catHead(c, eyes)),
    ].join("");
    case "play": return [
      tailPath(c, "M17 -24 q9 -8 4 -20"),
      `<path d="M14 -14 l4 14 M9 -13 l1 13" stroke="${c.catDark}" stroke-width="3.8" stroke-linecap="round"/>`,
      `<ellipse cx="2" cy="-15" rx="18" ry="8.2" fill="${c.cat}" transform="rotate(-20 2 -15)"/>`,
      `<path d="M-12 -8 l-13 2 M-10 -5 l-12 9" stroke="${c.cat}" stroke-width="4" stroke-linecap="round"/><circle cx="-26" cy="-6" r="2.4" fill="${c.catLight}"/><circle cx="-22.6" cy="4.4" r="2.4" fill="${c.catLight}"/>`,
      at(-15, -13, catHead(c, "wide")),
      // Бантик на нитке — добыча.
      `<g class="toy"><path d="M-37 -24 q-4 10 0 22" fill="none" stroke="${c.paper}" stroke-width="0.8"/><path d="M-37 -1 l-6 -4 v8z M-37 -1 l6 -4 v8z" fill="${c.eye}"/><circle cx="-37" cy="-1" r="1.6" fill="${c.topDark}"/></g>`,
    ].join("");
    case "eat": return [
      tailPath(c, "M19 -6 q12 -1 13 -10"),
      `<ellipse cx="5" cy="-10" rx="17" ry="10" fill="${c.cat}"/><path d="M2 -19 l1 5 M9 -19.6 l0 5" stroke="${c.catDark}" stroke-width="1.6" stroke-linecap="round"/>`,
      `<ellipse cx="-7" cy="-1.4" rx="5" ry="2.2" fill="${c.catLight}"/>`,
      `<g class="munch">${at(-13, -7.4, catHead(c, "closed"), " rotate(-16)")}</g>`,
    ].join("");
    case "claw": return [
      tailPath(c, "M5 -4 q14 2 15 -10"),
      `<path d="M-3 -6 v6 M5 -6 v6" stroke="${c.catDark}" stroke-width="4" stroke-linecap="round"/>`,
      `<ellipse cx="0" cy="-19" rx="8.8" ry="16" fill="${c.cat}" transform="rotate(-10 0 -19)"/>`,
      `<g class="scratch"><path d="M-5 -30 l-10 -5 M-3 -26 l-11 1" stroke="${c.cat}" stroke-width="4" stroke-linecap="round"/><circle cx="-15.6" cy="-35.4" r="2.3" fill="${c.catLight}"/><circle cx="-14.6" cy="-25" r="2.3" fill="${c.catLight}"/></g>`,
      at(-4, -40, catHead(c, "narrow")),
    ].join("");
    case "eyes": return [
      `<ellipse cx="0" cy="-5" rx="20" ry="5.5" fill="#000" opacity="0.45"/>`,
      `<g class="blink"><ellipse cx="-4.6" cy="-6" rx="3" ry="2.6" fill="#f2ea5c"/><ellipse cx="4.6" cy="-6" rx="3" ry="2.6" fill="#f2ea5c"/><ellipse cx="-4.6" cy="-6" rx="0.9" ry="2.3" fill="#15131a"/><ellipse cx="4.6" cy="-6" rx="0.9" ry="2.3" fill="#15131a"/></g>`,
    ].join("");
    case "tail": return `<path class="tailwag angry" d="M0 0 q12 -1 18 -9 q4 -6 10 -4" fill="none" stroke="${c.cat}" stroke-width="5" stroke-linecap="round"/><path d="M22 -11 l3 -2 M16 -6.6 l3 -2.6" stroke="${c.catDark}" stroke-width="1.6" stroke-linecap="round"/>`;
    case "sit":
    default: return [
      tailPath(c, "M9 -4 q14 2 13 -9"),
      `<path d="M-11 0 q-2 -22 11 -23 q13 1 11 23z" fill="${c.cat}"/><ellipse cx="0" cy="-8" rx="5.6" ry="7.4" fill="${c.catLight}"/>`,
      `<ellipse cx="-4.6" cy="-1.4" rx="3.6" ry="2.2" fill="${c.catLight}"/><ellipse cx="4.6" cy="-1.4" rx="3.6" ry="2.2" fill="${c.catLight}"/>`,
      at(0, -27, catHead(c, eyes)),
    ].join("");
  }
}
/**
 * Точка, где стоит Байт, и к какому слою он относится (`front` — на полу: там фигуры рисуются по глубине, и `depth`
 * — глубина, если она не совпадает с `y`). `herOnRug` — она сама на ковре: кот подвинется.
 */
function catSpot(place, shape, { herOnRug = false, plaidOnHer = false, herLies = false, herOnStool = false } = {}) {
  switch (place) {
    case "bowl": return { x: shape === "walk" ? 92 : 80, y: 408, layer: "front" };
    case "sill": return { x: 252, y: 262, layer: "sill" };
    case "chair": return shape === "claw" ? { x: 222, y: 394, layer: "front" } : { x: 163, y: 346, layer: "lap" };
    case "pillow": return { x: 300, y: 487, layer: "front" };
    case "desk": return { x: 362, y: 318, layer: "desk" };
    case "box": return { x: 312, y: 420, layer: "box" };
    // Она лежит на ковре — Байт устраивается у неё под боком, а не на лице.
    case "near": return herLies ? { x: 268, y: 484, layer: "front" } : { x: herOnRug ? 168 : 196, y: 486, layer: "front", big: true };
    case "top": return { x: 60, y: 168, layer: "top" };
    case "under": return { x: 163, y: 395, layer: "under" };
    // Плед на ней — Байт устроился поверх него, у ног: рисуется после неё (`depth`), хотя стоит чуть дальше.
    // Она на табуретке перед креслом (вешает гирлянду) — Байт сдвигается к краю, чтобы не прятаться за ней.
    case "plaid": return plaidOnHer ? { x: 284, y: 452, layer: "front", depth: 460 } : { x: herOnStool ? 178 : 156, y: 372, layer: "front" };
    case "rug":
    default: return herLies ? { x: 268, y: 484, layer: "front" } : { x: herOnRug ? 306 : 214, y: herOnRug ? 462 : 452, layer: "front" };
  }
}
function cat(c, view, where) {
  const asked = CAT_SHAPES.includes(view?.shape) ? view.shape : "sit";
  const place = CAT_PLACES.includes(view?.place) ? view.place : "rug";
  const spot = catSpot(place, asked, where);
  // На кресле Байт лежит или спит клубком: сидя он закрыл бы ей лицо, когда она в этом кресле.
  const shape = spot.layer === "lap" && asked !== "lie" && asked !== "curl" ? "lie" : asked;
  const key = view?.key ?? "";
  const eyes = shape === "lie" && (key === "голоден" || key === "игра" || key === "ласка" || key === "сыт") ? "closed" : key === "обижен" || key === "шалит" ? "narrow" : key === "голоден" ? "wide" : "open";
  const facesRight = (place === "bowl" && shape !== "walk") ? false : place === "sill" || place === "desk";
  const body = catShape(c, shape, { eyes });
  const drawn = facesRight && shape !== "sit" && shape !== "curl" ? flip(body) : body;
  const extra = [
    shape === "curl" ? zzz(c, 10, -22) : "",
    // Наигрался — рядом ленточка, которую он сторожит.
    key === "игра" && shape === "lie" ? `<path d="M-30 -2 q-8 -6 -14 0 q-6 6 -13 0" fill="none" stroke="${c.eye}" stroke-width="2" stroke-linecap="round"/>` : "",
  ].join("");
  // Из-под кресла и из коробки видны только глаза или хвост: они не увеличиваются, и область у них своя.
  const small = shape === "eyes" || shape === "tail";
  const k = small ? 1 : spot.big ? 1.56 : CAT_SCALE;
  // У неё на коленях область ниже: её лицо над ним остаётся её лицом.
  const [left, top, w, h] = small ? [-22, -20, 52, 26] : spot.layer === "lap" ? [-30, -26, 60, 32] : [-30, -50, 60, 56];
  return {
    layer: spot.layer, depth: spot.depth ?? spot.y,
    svg: at(spot.x, spot.y, `<g class="cat ${shape}">${drawn}${extra}</g>`, ` scale(${k})`),
    // Область нажатия — в единицах рисунка; от миски, чайника и клубка она отступает (`besideCare`).
    zone: besideCare(within([spot.x + left * k, spot.y + top * k, w * k, h * k]), [spot.x, spot.y - (small ? 7 : 12 * k)]),
  };
}

// ── вся комната ──────────────────────────────────────────────────────────────
const partIn = (view) => (PARTS.includes(view?.part) ? view.part : "день");

/** За окном: небо, город и дождь. Зависит только от часа — страница рисует это один раз и при нажатиях не трогает. */
export function drawBackdrop(part) {
  const name = partIn({ part });
  return `<g class="backdrop" pointer-events="none">${outside(name)}${rain(name)}</g>`;
}

/**
 * Комната без того, что за окном: картинка и поверх неё — слой нажатий. `view`:
 *   part — «утро», «день», «вечер», «ночь»;
 *   her — { pose, key } или null (её пока не видно: страница ещё не получила ответ);
 *   cat — { shape, place, key } или null;
 *   plant — "wet" | "dry"; things — ключи вещей; lamp — цвет абажура («#rrggbb»);
 *   fed — миска полна; tea — у неё в руках чай (чайник парит).
 */
export function drawInside(view = {}) {
  const part = partIn(view);
  const c = Object.fromEntries(Object.entries(DAY).map(([name, colour]) => [name, tint(colour, part)]));
  const things = new Set(Array.isArray(view.things) ? view.things : []);
  const has = (key) => things.has(key);
  const pose = view.her ? (HER_POSES.includes(view.her.pose) ? view.her.pose : "desk") : null;
  const she = pose ? her(c, pose, view.her.key, view) : {};
  const herOnRug = pose === "dance" || pose === "ribbon" || pose === "lie";
  const plaidOnHer = pose === "lie" || pose === "nap" || pose === "chair";
  const pet = view.cat ? cat(c, view.cat, { herOnRug, plaidOnHer: pose === "lie", herLies: pose === "lie", herOnStool: pose === "garland" }) : null;
  const on = (layer) => (pet?.layer === layer ? pet.svg : "");
  // На полу — по глубине: кто ниже на рисунке, тот ближе к зрителю и закрывает дальнего.
  const herDepth = she.y ?? 400;
  const stage = [she.front ? { depth: herDepth, svg: she.front } : null, pet?.layer === "front" ? { depth: pet.depth, svg: pet.svg } : null]
    .filter(Boolean).sort((a, b) => a.depth - b.depth).map(item => item.svg).join("");
  // Она стоит на полу ближе Байта и закрывает его собой — тогда и палец встречает её первой. Иначе первым — он:
  // он маленький, а сидит у неё на коленях, выглядывает из-под кресла или из коробки.
  const herCloser = Boolean(she.front && pet?.layer === "front" && herDepth > pet.depth);
  const shade = /^#[0-9a-f]{6}$/iu.test(String(view.lamp ?? "")) ? view.lamp : DAY.lamp;
  // Вещь рисуется, только если она у человека есть. Плед, которым она укрыта, с кресла снят — нажать на него там нельзя.
  const thing = (key, body) => (has(key) ? body : "");
  const shown = (key) => has(key) && !(key === "плед" && plaidOnHer);

  const art = [
    walls(c), windowFrame(c),
    garland(c, part, { onTree: has("ёлка") }),
    starMap(c),
    thing("рисунок", drawing(c)),
    thing("календарь", calendar(c)),
    bookcase(c, has), on("top"),
    sill(c),
    thing("подушка", sillPillow(c)),
    thing("место", sillSeat(c)),
    she.sillSeat ?? "", on("sill"),
    cactus(c, 344, 262, view.plant !== "dry"),
    thing("кактус", cactus(c, 368, 262, true, true)),
    // Кресла, плед, стол.
    armchair(c, 120), on("under"), plaidOnHer ? "" : (thing("плед", plaidOnChair(c, true)) || plaidOnChair(c, false)),
    she.seat ?? "", on("lap"),
    thing("кресло", armchair(c, 202, { second: true })),
    desk(c),
    at(4, 0, kettle(c, { steam: Boolean(view.tea) })),
    notebook(c), on("desk"), lamp(c, part, shade),
    she.stoolUsed || pose === "garland" ? "" : stool(c, STOOL.x, STOOL.y),
    // Пол.
    rug(c),
    bowl(c, Boolean(view.fed)),
    yarn(c),
    boxBack(c), on("box"), boxFront(c),
    catPillow(c),
    thing("тапочки", at(0, -28, slippers(c))),
    stage,
    thing("ёлка", tree(c, part)),
    lampGlow(part, shade),
    `<rect class="frame" x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="none"/>`,
  ].join("");

  // Слой нажатий: кто ниже в списке, тот ближе к пальцу.
  const thingZones = (front) => Object.entries(THING_ZONES).filter(([key]) => shown(key) && FRONT_THINGS.has(key) === front).map(([key, [label, box]]) => tap(`thing:${key}`, label, box));
  const herZone = she.zone ? tap("her", "Аи", she.zone, "her") : "";
  // Нажать на Байта — погладить: слово то же, что у кнопки «Погладить» и у сердца.
  const catZone = pet ? tap("pet", "Байт", pet.zone, "cat") : "";
  const zones = [
    tap("window", "Окно", [WIN.x, WIN.y, WIN.w, WIN.h]),
    ...thingZones(false),
    ...(herCloser ? [catZone, herZone] : [herZone, catZone]),
    ...thingZones(true),
    ...Object.entries(CARE_ZONES).map(([act, [label, id, box]]) => tap(act, label, box, id)),
  ].join("");

  return `<g class="art" pointer-events="none">${art}</g><g class="zones">${zones}</g>`;
}

/** Весь рисунок сразу — для снимков и тестов; страница рисует его двумя частями. */
export function drawRoom(view = {}) {
  return `${drawBackdrop(view?.part)}${drawInside(view)}`;
}
