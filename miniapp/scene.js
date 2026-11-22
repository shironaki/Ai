/**
 * Комната Аи — рисунок (мини-приложение; нарисован заново в сборке 0.39.0; с 0.40.0 она сама — картинкой).
 *
 * Чистая функция: по описанию «что сейчас в комнате» возвращает разметку SVG. Ни страницы, ни Telegram здесь
 * нет — поэтому рисунок проверяется тестами (`tests/miniapp.test.mjs`): каждая поза Аи, каждая поза Байта и
 * каждая вещь из `tgcloud/lib/room.js` должны рисоваться. Что именно нарисовать, решает сердце (`heart.onRoom`):
 * где она и где Байт — по тем же фразам, которые она говорит в чате.
 *
 * Как устроен рисунок.
 *   • Слои. `drawBackdrop` — небо и город: зависят только от часа. `drawRain` — дождь: на странице он лежит
 *     отдельным слоем и движется целиком, комната при этом не перерисовывается. `drawInside` — сама комната и
 *     поверх неё слой нажатий. `drawRoom` — всё разом, для снимков и тестов.
 *   • Свет считается, а не накладывается: каждая краска приглушается под час (`tint`), а лампа, гирлянда и окна
 *     города рисуются поверх своим цветом. Она и Байт приглушаются слабее комнаты — на них смотрят. Свет лампы
 *     и окна на стене и на полу лежит под мебелью и фигурами; сверху — только мягкая тень по углам. Ни фильтров,
 *     ни режимов смешения: рисунок одинаков в любом браузере, который открывает Telegram.
 *   • Объём — тремя тонами: у каждой вещи свой цвет, тень и блик; тени под мебелью и на стене — отдельными
 *     полупрозрачными пятнами.
 *   • Картинка нажатий не ловит вовсе (`pointer-events="none"`): кто кого закрывает на рисунке и кто первым
 *     встречает палец — разные вещи. Порядок слоя нажатий: окно, вещи, Аи, Байт и поверх всех — забота
 *     (Колючка, чайник, миска, клубок).
 *   • Её облик — по картинке профиля: длинные прямые чёрные волосы с ровной чёлкой, алые глаза, чокер с
 *     колечком, красный топ с открытыми плечами, чёрная куртка.
 *   • С 0.40.0 она стоит в комнате картинкой в рост (спрайты в папке `her/`, раздел «Аи картинкой» ниже): так
 *     выбрал владелец. Фигура, нарисованная кодом, осталась запасной — на случай, когда картинки нет.
 */

export const WIDTH = 400;
export const HEIGHT = 520;
export const PARTS = Object.freeze(["утро", "день", "вечер", "ночь"]);
export const HER_POSES = Object.freeze(["desk", "shelf", "chair", "nap", "sill", "back", "map", "garland", "dance", "ribbon", "lie", "read", "feed", "dust", "sort"]);
// 0.49.0: beg — встал на задние лапы и тянется к ней (просится на руки); gift — сидит, у лап игрушка (принёс добычу).
export const CAT_SHAPES = Object.freeze(["sit", "lie", "curl", "walk", "play", "eat", "claw", "eyes", "tail", "belly", "beg", "gift"]);
export const CAT_PLACES = Object.freeze(["bowl", "sill", "chair", "rug", "pillow", "desk", "box", "near", "top", "under", "plaid"]);
export const THINGS = Object.freeze(["кружка", "тапочки", "подушка", "снимок", "плед", "календарь", "кресло", "кактус", "место", "абажур", "рисунок", "ёлка", "торт", "свеча", "фонарь"]);
/**
 * Что за окном (0.44.0): ясно, облачно (солнце и облака), пасмурно, туман, дождь, гроза, снег — по погоде в городе
 * человека (так говорит сердце). До 0.44.0 было два слова, «rain» и «snow»; незнакомое слово — дождь, как раньше.
 */
export const SKIES = Object.freeze(["clear", "clouds", "overcast", "fog", "rain", "storm", "snow"]);
const skyIn = (sky) => (SKIES.includes(sky) ? sky : "rain");
/** Небо открыто: видно солнце, луну и звёзды. */
const open = (sky) => sky === "clear" || sky === "clouds";
/** С неба льёт. */
const wet = (sky) => sky === "rain" || sky === "storm";
/** Что сценка дня меняет в комнате (`SCENE_FX` в `tgcloud/lib/room.js`): страница рисует это поверх обычной комнаты. */
export const SCENE_FX = Object.freeze(["cactus", "haze", "window", "blink", "sock", "curtains", "noplaid", "puddle", "boat"]);
/** Её лицо — по тому, чем она занята (ключ запаса «+комната:она:<key>»). */
export const MOODS = Object.freeze({ "дело": "calm", "уют": "smile", "игра": "happy", "сон": "sleep", "устала": "tired", "обида": "pout", "ревность": "jealous" });

// ── свет и краски ────────────────────────────────────────────────────────────
/**
 * Час суток для краски: `k` — во сколько раз приглушён каждый канал, `to` и `mix` — к какому цвету воздуха и
 * насколько она сдвинута (вечером — к сиреневому, ночью — к синему).
 */
const LIGHT = Object.freeze({
  "утро": { k: [0.98, 0.95, 0.95], to: "#ffe1cc", mix: 0.06 },
  "день": { k: [1, 1, 1], to: "#ffffff", mix: 0 },
  "вечер": { k: [0.76, 0.67, 0.8], to: "#3d2c5e", mix: 0.1 },
  "ночь": { k: [0.58, 0.58, 0.77], to: "#161b44", mix: 0.14 },
});
const lit = (part) => part === "вечер" || part === "ночь";

const hex2 = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
const rgb = (colour) => {
  const found = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(String(colour));
  return found ? [parseInt(found[1], 16), parseInt(found[2], 16), parseInt(found[3], 16)] : null;
};
const hex = (list) => `#${hex2(list[0])}${hex2(list[1])}${hex2(list[2])}`;
/** Смесь двух красок: `share` — доля второй. */
const mix = (one, two, share) => {
  const a = rgb(one), b = rgb(two);
  return a && b ? hex(a.map((value, index) => value + (b[index] - value) * share)) : one;
};
const dk = (colour, share) => mix(colour, "#000000", share);
const lt = (colour, share) => mix(colour, "#ffffff", share);
/**
 * Цвет под час суток. Цвет без «#rrggbb» (прозрачный, готовый) возвращается как есть. `soft` — насколько слабее
 * обычного (0 — как комната, 1 — без изменений): так она и Байт остаются светлее стен.
 */
export function tint(colour, part, soft = 0) {
  const value = rgb(colour);
  if (!value) return colour;
  const light = LIGHT[part] ?? LIGHT["день"], air = rgb(light.to), keep = Math.max(0, Math.min(1, Number(soft) || 0));
  return hex(value.map((channel, index) => {
    const dim = channel * light.k[index];
    const aired = dim + (air[index] - dim) * light.mix;
    return channel + (aired - channel) * (1 - keep);
  }));
}

/** Краски при дневном свете. */
const DAY = Object.freeze({
  // стены, пол, окно
  wall: "#e7d8cb", panel: "#cdb8a8", skirting: "#f0e6da", floor: "#b3875f", floorLine: "#7f5a3f",
  frame: "#f8f2ea", frameDark: "#cfc2b1", sill: "#f5eee3", sillEdge: "#d8cbb8",
  curtain: "#f6ecdf", curtainDark: "#d9c6b3", tie: "#b3202e", rod: "#6b5a4c",
  // мебель
  wood: "#7b5840", woodDark: "#59402f", woodLight: "#9c765a", woodPale: "#c09a78",
  chair: "#4f7b69", chairDark: "#3a5f50", chairLight: "#74a08b", chair2: "#b98f6a", chair2Dark: "#94704f", chair2Light: "#d3ad89",
  plaid: "#3a62a6", plaidLight: "#86a9e0", plaidDark: "#284781", cream: "#f3e7d3",
  rug: "#8f4054", rugLight: "#c98b96", rugDark: "#6d2b3e",
  // она
  skin: "#fce8dc", skinDark: "#f0c5b5", skinLine: "#d79a8d", blush: "#f58e9a", lip: "#c9495a",
  hair: "#1b1823", hairMid: "#312b3b", hairLight: "#544c67", hairShine: "#aaa3c6",
  eye: "#dc2c48", eyeDark: "#5d0a1d", eyeLight: "#ff9aa5", white: "#ffffff",
  top: "#b42030", topDark: "#84151f", topLight: "#d64656", jacket: "#35313f", jacketLight: "#5d5772", stocking: "#2b2835", stockingLight: "#4a4459", silver: "#d6d9e1",
  // Байт
  cat: "#8d929e", catDark: "#5d626e", catLight: "#d6d9df", catEar: "#eaaab5", catEye: "#f2e15c", catEyeDark: "#c2a22a", nose: "#e28d9a",
  // вещи
  paper: "#f8f3e8", paperDark: "#dfd6c4", ink: "#4a4350", red: "#c8353f", gold: "#e3b54e", green: "#5f9f66", greenDark: "#3f7a4c", greenDry: "#93a37c",
  pot: "#c5714e", potDark: "#9d5438", soil: "#5a4334", soilDry: "#96826c", metal: "#bcc1cb", metalDark: "#8a8f9b",
  box: "#c99e6f", boxDark: "#a57d53", bowl: "#d95c58", bowlDark: "#ae403d", food: "#8c5b3c", pillow: "#e8d6c6", pillowDark: "#cbb5a2",
  navy: "#1c2446", star: "#f6ecbc", lamp: "#f2b85b", walle: "#e6ab3a", walleDark: "#8c6a2a", steam: "#ffffff",
  mug: "#b93a46", mug2: "#4f7fc2", treeGreen: "#3f8157", treeDark: "#2b5f40", slipper: "#e2aab4", slipperDark: "#bf8793", teapot: "#f4ede2", teapotDark: "#d5c8b6",
});

// ── разметка ─────────────────────────────────────────────────────────────────
const n = (value) => (Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10));
const at = (x, y, body, extra = "") => `<g transform="translate(${n(x)} ${n(y)})${extra}">${body}</g>`;
const esc = (text) => String(text ?? "").replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
const stopsOf = (stops) => stops.map(([offset, colour, opacity]) => `<stop offset="${offset}" stop-color="${colour}"${opacity === undefined ? "" : ` stop-opacity="${opacity}"`}/>`).join("");
/**
 * Переходы цвета одного слоя: каждый получает имя с приставкой слоя (`s-` — за окном, `r-` — комната), потому что
 * на странице слои — соседи в одном документе, и одинаковые имена перепутались бы. Повторный запрос с тем же
 * именем нового описания не добавляет (два кресла — один переход).
 */
function inks(prefix) {
  const made = new Map();
  // То же имя с другим содержимым (плед на кресле и плед на ней — разного тона) получает номер: имена не спорят.
  const add = (id, make) => {
    for (let index = 1; ; index += 1) {
      const name = `${prefix}${id}${index === 1 ? "" : index}`, body = make(name);
      if (!made.has(name)) made.set(name, body);
      if (made.get(name) === body) return `url(#${name})`;
    }
  };
  return {
    /** Имя с приставкой слоя: для того, на что ссылаются по имени (обрезка по стеклу, маска её картинки). */
    id: (name) => `${prefix}${name}`,
    lin: (id, stops, [x1, y1, x2, y2] = [0, 0, 0, 1], extra = "") => add(id, name => `<linearGradient id="${name}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${extra}>${stopsOf(stops)}</linearGradient>`),
    rad: (id, stops, extra = "") => add(id, name => `<radialGradient id="${name}"${extra}>${stopsOf(stops)}</radialGradient>`),
    raw: (id, body) => add(id, body),
    defs: () => `<defs>${[...made.values()].join("")}</defs>`,
    /** Описания по одному — для рисунка по частям (`drawParts`): страница добавляет новые и убирает лишние. */
    list: () => [...made.values()],
  };
}
/** Мягкая тень на полу или стене: пятно, тающее к краям. */
const shadow = (g, cx, cy, rx, ry, strength = 0.3) => `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="${g.rad("sh", [[0, "#1a0f1e", 1], [0.6, "#1a0f1e", 0.55], [1, "#1a0f1e", 0]])}" opacity="${strength}"/>`;

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
/** Места нажатий 0.46.0: колонка на нижней полке; выключатель света — гирлянда над окном и сама лампа. */
const SPEAKER_ZONE = Object.freeze([12, 322, 45, 46]);
const GARLAND_ZONE = Object.freeze([118, 30, 276, 28]);
/**
 * Место нажатия на лампе: колпак и ножка. Но колпак — место вещи «абажур любимого цвета», если она у человека есть,
 * а перед ножкой в день рождения стоит торт: выключателем остаётся то, что свободно. Заняты и колпак, и ножка —
 * на лампе места нет (`null`): свет гасит гирлянда.
 */
const lampZone = (shade, cake) => (shade && cake ? null : shade ? [366, 292, 34, 28] : cake ? [364, 258, 36, 28] : [364, 258, 36, 62]);
const CARE_ZONES = Object.freeze({
  water: ["Колючка", "plant", [320, 210, 38, 54]],
  tea: ["Чайник", "kettle", [308, 280, 46, 40]],
  feed: ["Миска Байта", "bowl", [10, 391, 56, 34]],
  play: ["Клубок", "toy", [98, 462, 54, 32]],
});
/** Две верхние полки шкафа — книги и папки: место нажатия «возьми книгу» (0.45.0). */
const BOOKS = Object.freeze([16, 174, 86, 84]);
/** Вещи, которые появляются у человека со временем (`ITEMS` в `tgcloud/lib/room.js`): подпись и область. */
/** Середина ковра: нажатие на неё зовёт Байта (0.47.0). Целиком внутри ковра и выше полосы с её словами. */
const RUG_ZONE = [110, 420, 180, 50];
const THING_ZONES = Object.freeze({
  "рисунок": ["Её рисунок", [14, 116, 44, 48]],
  "календарь": ["Календарь", [60, 116, 40, 48]],
  "снимок": ["Рамка с первым разговором", [68, 236, 34, 32]],
  "кружка": ["Вторая кружка", [38, 292, 24, 24]],
  "подушка": ["Вторая подушка", [136, 232, 48, 32]],
  "место": ["Место рядом с Байтом", [268, 248, 44, 16]],
  "кактус": ["Маленький кактус", [358, 236, 22, 28]],
  "плед": ["Плед на двоих", [236, 250, 60, 178]],
  "кресло": ["Второе кресло", [284, 292, 48, 96]],
  "абажур": ["Абажур любимого цвета", [362, 258, 38, 34]],
  // Выше нижнего края: поверх него на странице лежит полоса с её словами.
  "тапочки": ["Тапочки у двери", [14, 462, 66, 26]],
  "ёлка": ["Ёлка", [354, 366, 46, 136]],
  // Праздники и даты (0.41.0): торт — на столе (с 0.45.0), свеча — на полке у рамки, фонарь — у окна, под карнизом.
  "торт": ["Торт ко дню рождения", [361, 286, 34, 38]],
  // Левый край — не левее 93: рядом рамка с первым разговором, и нажатие в её правую треть должно доставаться ей.
  "свеча": ["Свеча в годовщину знакомства", [93, 236, 18, 34]],
  "фонарь": ["Фонарь к празднику", [360, 64, 26, 52]],
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
  // Отступив, область не должна стать меньше пальца: тогда она растёт в свободную сторону — прочь от заботы.
  const span = (low, high, from, min, limit) => {
    if (high - low >= min) return [low, high];
    const start = low > from ? Math.min(low, limit - min) : Math.max(0, high - min);
    return [start, start + min];
  };
  const [left, right] = span(box[0], box[2], x, 36, WIDTH), [top, bottom] = span(box[1], box[3], y, 24, HEIGHT);
  return [left, top, right - left, bottom - top];
}

// ── за окном ─────────────────────────────────────────────────────────────────
/** Стекло окна. Те же числа — в стилях страницы (`.rainbox`): слой дождя лежит ровно по стеклу. */
export const WIN = Object.freeze({ x: 124, y: 44, w: 264, h: 218 });
/** Небо и город по часам: краски неба сверху вниз, облака, три плана домов, окна, зарево у горизонта. */
const SKY = Object.freeze({
  "утро": { sky: ["#8fa6c3", "#c4c2d2", "#f3d8c4"], cloud: "#ffffff", cloudLow: "#8496ad", far: "#b5bdcd", mid: "#8f99ad", near: "#6a7389", pane: "#566078", glow: ["#ffe6c4", 0.55], share: 0.14, rain: "#ffffff" },
  "день": { sky: ["#9aacbf", "#c1ccd7", "#e0e5e7"], cloud: "#f6f8fa", cloudLow: "#8595a6", far: "#b4c0cb", mid: "#8c99a8", near: "#667383", pane: "#525f70", glow: null, share: 0, rain: "#ffffff" },
  "вечер": { sky: ["#232857", "#54477f", "#b96f7f", "#f0a97c"], cloud: "#9478a6", cloudLow: "#3a3465", far: "#6e5d90", mid: "#463f73", near: "#2a2954", pane: "#1b1a3e", glow: ["#ffb57c", 0.6], share: 0.62, rain: "#d7def5" },
  "ночь": { sky: ["#070b20", "#131a42", "#2b3268"], cloud: "#2c356a", cloudLow: "#0c112e", far: "#252d5d", mid: "#181e45", near: "#0d1129", pane: "#070a1b", glow: ["#5d51a6", 0.45], share: 0.44, rain: "#c9d3f2" },
});
// Дома: [x, высота, ширина]. Дальние — выше и бледнее, ближние — ниже и темнее.
const FAR = Object.freeze([[118, 64, 22], [142, 98, 16], [160, 74, 24], [188, 124, 18], [208, 86, 26], [238, 108, 14], [254, 70, 30], [288, 96, 20], [310, 132, 16], [328, 80, 28], [360, 104, 18], [380, 72, 14]]);
const MID = Object.freeze([[120, 62, 30], [152, 84, 22], [176, 52, 34], [212, 76, 26], [240, 58, 22], [264, 92, 28], [294, 60, 26], [322, 82, 24], [348, 56, 28], [378, 74, 16]]);
const NEAR = Object.freeze([[116, 40, 46], [162, 56, 30], [192, 34, 50], [242, 50, 34], [276, 36, 34], [310, 60, 38], [348, 42, 46]]);
const LIGHT_INKS = Object.freeze(["#ffd98a", "#ffd98a", "#ffe7b3", "#ffd98a", "#bfe6ff", "#ffd98a", "#ffb6a3"]);

/** Окна дома: горящие и тёмные. Какие горят — решает счёт по месту окна, а не случай: рисунок всегда один. */
function panes([x, tall, w], base, seed, share) {
  const on = [], off = [];
  const cols = Math.max(1, Math.floor((w - 5) / 6)), rows = Math.max(1, Math.floor((tall - 6) / 8));
  const left = x + (w - cols * 6 + 2.8) / 2;
  for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) {
    const mark = (seed * 31 + row * 17 + col * 7 + row * col * 3 + seed * row) % 20;
    const box = `x="${n(left + col * 6)}" y="${n(base - tall + 5 + row * 8)}" width="3.2" height="4.4"`;
    if (mark < share * 20) on.push(`<rect ${box} fill="${LIGHT_INKS[(seed + row * 3 + col) % LIGHT_INKS.length]}"${mark % 3 === 0 ? ' opacity="0.75"' : ""}/>`);
    else off.push(`<rect ${box}/>`);
  }
  return { on: on.join(""), off: off.join("") };
}

function cloud(x, y, k = 1) {
  return `<g transform="translate(${x} ${y}) scale(${k})"><ellipse cx="0" cy="0" rx="26" ry="8"/><ellipse cx="-12" cy="-5" rx="12" ry="7"/><ellipse cx="6" cy="-8" rx="15" ry="9"/><ellipse cx="24" cy="-2" rx="12" ry="6"/></g>`;
}

/**
 * Краски открытого неба (ясно и облачно) по часам: то, чем они отличаются от пасмурных (`SKY`). Утром — голубое с
 * тёплым низом, днём — синее, вечером — закат, ночью — глубокая синева со звёздами.
 */
const SKY_OPEN = Object.freeze({
  "утро": { sky: ["#6ea5df", "#a8c8ea", "#f4d8c4", "#ffd7a6"], cloud: "#ffffff", far: "#b6c2d6", mid: "#8f9db6", near: "#69768f", glow: ["#ffd6a0", 0.7] },
  "день": { sky: ["#4c95e2", "#85bcf0", "#cfe6f6"], cloud: "#ffffff", far: "#afc4da", mid: "#869bb5", near: "#5f728d", glow: null },
  "вечер": { sky: ["#242967", "#5c4a8d", "#da728a", "#ffb47b"], cloud: "#c88aa8", glow: ["#ffb57c", 0.78] },
  "ночь": { sky: ["#040716", "#0a1130", "#1a2757"], cloud: "#28316b", glow: ["#5d51a6", 0.32] },
});
/** Краски неба и города под эту погоду: пасмурные — как были; открытое небо — свои; туман и гроза — сдвиг к серому и к тёмному. */
function skyLook(part, sky) {
  const base = SKY[part];
  if (open(sky)) return { ...base, ...SKY_OPEN[part] };
  const toward = (colour, to, share) => mix(colour, to, share);
  if (sky === "fog") {
    const mist = lit(part) ? "#39405f" : "#dfe4e8";
    return { ...base, sky: base.sky.map(colour => toward(colour, mist, 0.6)), far: toward(base.far, mist, 0.75), mid: toward(base.mid, mist, 0.5), near: toward(base.near, mist, 0.22), glow: base.glow ? [base.glow[0], base.glow[1] * 0.5] : null, mist };
  }
  if (sky === "storm") {
    const dark = "#12162a";
    return { ...base, sky: base.sky.map(colour => toward(colour, dark, lit(part) ? 0.3 : 0.46)), cloud: toward(base.cloud, dark, 0.5), cloudLow: toward(base.cloudLow, dark, 0.4), far: toward(base.far, dark, 0.3), mid: toward(base.mid, dark, 0.25), near: toward(base.near, dark, 0.2), glow: null };
  }
  return base;
}
/** Доля круга по золотому сечению: места звёзд и облаков — ровно, но не строем, и всегда одни и те же. */
const spread = (index, shift = 0) => (index * 0.618034 + shift) % 1;
/** Звёзды над крышами: мелкие точки, несколько мерцают. В облачную ночь их вдвое меньше. */
function stars(sky) {
  const dots = [];
  for (let index = 0; index < (sky === "clouds" ? 18 : 36); index += 1) {
    const x = WIN.x + 4 + spread(index, 0.11) * (WIN.w - 8), y = WIN.y + 5 + spread(index * 7 + 3, 0.47) * 104, r = 0.45 + (index % 4) * 0.2;
    dots.push(`<circle${index % 5 === 0 ? ` class="star t${(index / 5) % 3}"` : ""} cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${index % 6 === 0 ? "#ffe9c4" : "#ffffff"}" opacity="${index % 3 === 0 ? 0.95 : 0.7}"/>`);
  }
  return `<g>${dots.join("")}</g>`;
}
/**
 * Луна по фазе: `phase` — доля лунного месяца (0 — новолуние, 0,5 — полнолуние). Освещённая сторона — справа, пока
 * луна растёт, и слева, когда убывает; граница света — половина эллипса. В новолуние луны на небе нет.
 */
function moon(g, x, y, r, phase) {
  const p = ((Number(phase) % 1) + 1) % 1;
  if (!Number.isFinite(p) || p < 0.04 || p > 0.96) return "";
  const k = Math.cos(2 * Math.PI * p), waxing = p < 0.5, inner = Math.max(0.01, Math.abs(k)) * r;
  // Внешняя дуга — по освещённому краю; внутренняя — граница света: у серпа она выгнута туда же, у «горбатой» луны — обратно.
  const lit = `M${n(x)} ${n(y - r)} A${n(r)} ${n(r)} 0 0 ${waxing ? 1 : 0} ${n(x)} ${n(y + r)} A${n(inner)} ${n(r)} 0 0 ${(k > 0) === waxing ? 0 : 1} ${n(x)} ${n(y - r)}Z`;
  return [
    `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r * 3.4)}" fill="${g.rad("moonGlow", [[0, "#cfd8ff", 0.34], [0.4, "#cfd8ff", 0.12], [1, "#cfd8ff", 0]])}"/>`,
    `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="#1c2550" opacity="0.55"/>`,
    `<path d="${lit}" fill="#f4f1dc"/>`,
    `<g fill="#d9d5bd" opacity="0.5"><circle cx="${n(x + (waxing ? 3 : -3))}" cy="${n(y - 3)}" r="${n(r * 0.16)}"/><circle cx="${n(x + (waxing ? 5 : -5))}" cy="${n(y + 4)}" r="${n(r * 0.12)}"/></g>`,
  ].join("");
}
/** Солнце: утром — низко и тёплое, днём — высоко и белое, вечером — садится за крыши. Дома рисуются после и закрывают его. */
function sun(g, part) {
  const [x, y, r, ink] = part === "утро" ? [178, 182, 14, "#ffe0a8"] : part === "вечер" ? [206, 226, 17, "#ffb070"] : [338, 82, 12, "#fff7dc"];
  return `<circle cx="${x}" cy="${y}" r="${r * 3.6}" fill="${g.rad("sunGlow", [[0, ink, 0.6], [0.35, ink, 0.22], [1, ink, 0]])}"/><circle cx="${x}" cy="${y}" r="${r}" fill="${ink}"/><circle cx="${x}" cy="${y}" r="${n(r * 0.72)}" fill="#ffffff" opacity="${part === "день" ? 0.55 : 0.28}"/>`;
}
/** Кучевые облака, которые плывут: узор повторён через ширину окна, поэтому слой, съехав на неё, совпадает сам с собой. */
function drifting(s, part, few) {
  const spots = few ? [[150, 84, 0.9], [310, 62, 0.7]] : [[146, 78, 1.5], [222, 112, 1.1], [286, 64, 1.8], [352, 102, 1.3], [196, 58, 0.9], [384, 70, 1]];
  const one = (dx) => spots.map(([x, y, k]) => cloud(x + dx, y, k)).join("");
  const under = lit(part) ? 0.5 : 0.3;
  return `<g class="drift"><g fill="${s.cloud}" opacity="${lit(part) ? 0.62 : 0.92}">${one(0)}${one(WIN.w)}</g><g fill="${s.cloudLow}" opacity="${few ? 0 : under * 0.4}" transform="translate(0 5)">${one(0)}${one(WIN.w)}</g></g>`;
}
/** Молния: ломаная от тучи к башне и вспышка на всё окно. Обе почти всегда не видны — их зажигают стили страницы (`.flash`). */
function lightning() {
  const base = WIN.y + WIN.h;
  return `<g class="flash" opacity="0"><rect x="${WIN.x}" y="${WIN.y}" width="${WIN.w}" height="${WIN.h}" fill="#e9eeff" opacity="0.55"/><path d="M302 ${WIN.y + 14} l-9 30 l8 -2 l-12 34 l9 -3 l-9 ${base - 150 - WIN.y - 73}" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></g>`;
}

/**
 * За окном: небо, светила, облака и три плана города. `sky` — погода (`SKIES`), `phase` — фаза луны (доля лунного
 * месяца) для ясной ночи.
 */
function outside(g, part, sky = "rain", phase = 0.3) {
  const s = skyLook(part, sky);
  const base = WIN.y + WIN.h;
  const block = (list) => list.map(([x, tall, w]) => `<rect x="${x}" y="${base - tall}" width="${w}" height="${tall + 1}"/>`).join("");
  const gradient = g.lin("sky", s.sky.map((colour, index, all) => [n(index / (all.length - 1)), colour]));
  const midPanes = MID.map((house, index) => panes(house, base, index + 3, s.share * 0.8));
  const nearPanes = NEAR.map((house, index) => panes(house, base, index + 11, s.share));
  const glow = s.glow ? `<ellipse cx="282" cy="${base + 6}" rx="190" ry="96" fill="${g.rad("horizon", [[0, s.glow[0], s.glow[1]], [1, s.glow[0], 0]])}"/>` : "";
  const night = lit(part), fog = sky === "fog", clear = open(sky);
  // Светила — только на открытом небе: ночью звёзды и луна, утром, днём и на закате — солнце.
  const lights = !clear ? "" : part === "ночь" ? `${stars(sky)}${moon(g, 334, 84, 11, phase)}` : `${part === "вечер" ? stars("clouds") : ""}${sun(g, part)}`;
  // Облака: на ясном небе — одно-два лёгких, в облачный день — кучевые, и те и другие плывут; под тучами — сплошные, как раньше; в тумане неба не видно.
  const clouds = fog ? "" : clear ? drifting(s, part, sky === "clear")
    : `<g fill="${s.cloud}" opacity="${night ? 0.5 : 0.62}">${cloud(168, 76, 1.5)}${cloud(300, 66, 1.9)}${cloud(232, 118, 1.2)}${cloud(372, 112, 1.3)}</g><g fill="${s.cloudLow}" opacity="${night ? 0.5 : 0.34}">${cloud(140, 104, 1.7)}${cloud(262, 92, 2.1)}${cloud(356, 84, 1.6)}${cloud(204, 62, 1.4)}</g>`;
  // Дымка между планами: в ясную погоду её почти нет — город виден до горизонта; в туман — стена.
  const haze = (id, from, clearShare, usual) => `<rect x="${WIN.x}" y="${base - from}" width="${WIN.w}" height="${from}" fill="${g.lin(id, [[0, s.mist ?? s.sky.at(-1), 0], [1, s.mist ?? s.sky.at(-1), fog ? 0.9 : clear ? clearShare : usual]])}"/>`;
  return [
    `<clipPath id="${g.id("glass")}"><rect x="${WIN.x}" y="${WIN.y}" width="${WIN.w}" height="${WIN.h}"/></clipPath>`,
    `<g clip-path="url(#${g.id("glass")})">`,
    `<rect x="${WIN.x}" y="${WIN.y}" width="${WIN.w}" height="${WIN.h}" fill="${gradient}"/>`,
    lights, glow, clouds,
    sky === "storm" ? lightning() : "",
    // Дальний план: башни в дымке. В тумане от него остаётся намёк, а огонька на башне не видно.
    `<g fill="${s.far}"${fog ? ' opacity="0.3"' : ""}>${block(FAR)}<rect x="196.4" y="${base - 138}" width="1.2" height="16"/><rect x="317.4" y="${base - 150}" width="1.2" height="20"/><path d="M142 ${base - 98} l8 -8 l8 8z M254 ${base - 70} h30 l-6 -7 h-18z"/></g>`,
    night && !fog ? `<circle class="beacon" cx="318" cy="${base - 151}" r="1.5" fill="#ff5d4d"/>` : "",
    haze("haze1", 140, 0.2, 0.55),
    // Средний план.
    `<g fill="${s.mid}"${fog ? ' opacity="0.7"' : ""}>${block(MID)}<path d="M176 ${base - 52} l17 -10 l17 10z M294 ${base - 60} h26 v-5 h-26z"/><rect x="226" y="${base - 88}" width="1.4" height="14"/><rect x="276" y="${base - 104}" width="1.4" height="13"/><path d="M270 ${base - 97} h13" stroke="${s.mid}" stroke-width="1"/></g>`,
    `<g fill="${s.pane}" opacity="${fog ? 0.12 : night ? 0.5 : 0.28}">${midPanes.map(item => item.off).join("")}</g>`,
    `<g class="city" opacity="${fog ? 0.5 : 0.85}">${midPanes.map(item => item.on).join("")}</g>`,
    haze("haze2", 90, 0.16, night ? 0.22 : 0.4),
    // Ближние крыши: бак с водой, трубы, антенны, вывеска.
    `<g fill="${s.near}">${block(NEAR)}`,
    `<path d="M162 ${base - 56} l15 -9 l15 9z"/><rect x="204" y="${base - 46}" width="12" height="12" rx="2"/><path d="M202 ${base - 47} l8 -6 l8 6z M205 ${base - 34} v5 M215 ${base - 34} v5" stroke="${s.near}" stroke-width="1.4"/>`,
    `<rect x="250" y="${base - 58}" width="5" height="8"/><rect x="286" y="${base - 43}" width="6" height="7"/><rect x="362" y="${base - 50}" width="5" height="8"/><rect x="328.4" y="${base - 78}" width="1.3" height="18"/><path d="M323 ${base - 74} h12 M325 ${base - 69} h8" stroke="${s.near}" stroke-width="1"/><rect x="130.4" y="${base - 52}" width="1.2" height="12"/></g>`,
    `<g fill="${s.pane}" opacity="${night ? 0.6 : 0.3}">${nearPanes.map(item => item.off).join("")}</g>`,
    `<g class="city">${nearPanes.map(item => item.on).join("")}</g>`,
    // Вывеска на крыше: вечером и ночью светится.
    night
      ? `<ellipse cx="259.5" cy="${base - 71}" rx="13" ry="18" fill="${g.rad("neon", [[0, "#ff7fb0", 0.8], [1, "#ff7fb0", 0]])}"/><rect class="neon" x="256" y="${base - 80}" width="7" height="18" rx="1.5" fill="#ff8fba"/><path d="M258 ${base - 76} h3 M258 ${base - 71} h3 M258 ${base - 66} h3" stroke="#fff0f6" stroke-width="1"/>`
      : `<rect x="256" y="${base - 80}" width="7" height="18" rx="1.5" fill="${s.pane}" opacity="0.7"/>`,
    `<path d="M259.5 ${base - 62} v12" stroke="${s.near}" stroke-width="1.2"/>`,
    // Туман перед ближними крышами: полоса, которая медленно дышит.
    fog ? `<rect class="mist" x="${WIN.x}" y="${base - 120}" width="${WIN.w}" height="120" fill="${g.lin("mist", [[0, s.mist, 0], [0.5, s.mist, 0.5], [1, s.mist, 0.72]])}"/>` : "",
    `</g>`,
  ].join("");
}

/** Косые струи: их наклон (на каждую единицу вниз — 0,3 влево) и шаг пунктира вдоль струи. */
const SLANT = 0.3;
const RAIN = Object.freeze({
  far: { fall: 60, dash: 7, step: 21, from: 6, width: 0.7, seconds: 0.95 },
  near: { fall: 80, dash: 14, step: 26, from: 0, width: 1.1, seconds: 0.62 },
});
/**
 * Струи одного плана в координатах стекла (0, 0 — левый верхний угол окна). Пунктир повторяется вдоль струи с
 * шагом `fall` по высоте: сдвиг слоя на (−fall × 0,3; fall) даёт тот же рисунок — так дождь идёт без рывка.
 */
function rainLines(name) {
  const { fall, dash, step, from } = RAIN[name];
  const period = fall * Math.sqrt(1 + SLANT * SLANT);
  const top = -fall - 12, bottom = WIN.h + 12;
  const lines = [];
  for (let x = from, index = 0; x < WIN.w + fall * SLANT + (bottom - top) * SLANT + step; x += step, index += 1) {
    lines.push(`<path d="M${n(x)} ${top} L${n(x - (bottom - top) * SLANT)} ${bottom}" stroke-dasharray="${dash} ${n(period - dash)}" stroke-dashoffset="${n((index * 37 + (index % 3) * 11) % period)}"/>`);
  }
  return lines.join("");
}
/**
 * На сколько страница сдвигает слой дождя за один оборот: доли ширины и высоты стекла в процентах и время в
 * секундах. Те же числа записаны в стилях страницы (`@keyframes rain-far`, `rain-near`) — их сверяет тест.
 */
export const RAIN_SHIFT = Object.freeze(Object.fromEntries(Object.entries(RAIN).map(([name, { fall, seconds }]) => [name, Object.freeze({ x: -fall * SLANT / WIN.w * 100, y: fall / WIN.h * 100, seconds })])));
const rainInk = (part, name) => `fill="none" stroke="${SKY[part].rain}" stroke-linecap="round" stroke-width="${RAIN[name].width}" stroke-opacity="${name === "near" ? (lit(part) ? 0.4 : 0.6) : (lit(part) ? 0.24 : 0.4)}"`;

// ── стены и пол ──────────────────────────────────────────────────────────────
const FLOOR_ROWS = Object.freeze([372, 393, 418, 448, 482, 520]);
const FLOOR_JOINTS = Object.freeze([[64, 196, 318], [130, 262, 372], [38, 180, 300], [112, 244, 356], [56, 206, 330]]);
const GRAIN = Object.freeze([[20, 384, 30], [150, 381, 44], [280, 386, 36], [70, 407, 50], [300, 404, 40], [200, 410, 30], [90, 436, 46], [240, 430, 52], [340, 438, 34], [30, 468, 54], [170, 462, 48], [290, 470, 60], [100, 502, 60], [250, 498, 50], [350, 506, 36]]);

function walls(g, c) {
  const hole = `M${WIN.x} ${WIN.y}V${WIN.y + WIN.h}H${WIN.x + WIN.w}V${WIN.y}Z`;
  const wall = g.lin("wall", [[0, dk(c.wall, 0.12)], [0.1, c.wall], [0.8, c.wall], [1, dk(c.wall, 0.05)]]);
  const stripes = g.raw("paper", id => `<pattern id="${id}" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="10" height="20" fill="${lt(c.wall, 0.4)}" opacity="0.3"/></pattern>`);
  const tones = [c.floor, lt(c.floor, 0.08), dk(c.floor, 0.07), lt(c.floor, 0.03)];
  const planks = [];
  FLOOR_ROWS.slice(0, -1).forEach((top, row) => {
    const bottom = FLOOR_ROWS[row + 1], edges = [0, ...FLOOR_JOINTS[row], 400];
    for (let index = 0; index < edges.length - 1; index += 1) planks.push(`<rect x="${edges[index]}" y="${top}" width="${edges[index + 1] - edges[index]}" height="${bottom - top}" fill="${tones[(index * 2 + row) % tones.length]}"/>`);
  });
  const seams = [...FLOOR_ROWS.slice(1, -1).map(y => `M0 ${y}H400`), ...FLOOR_JOINTS.flatMap((list, row) => list.map(x => `M${x} ${FLOOR_ROWS[row]}V${FLOOR_ROWS[row + 1]}`))].join(" ");
  const grain = GRAIN.map(([x, y, w]) => `M${x} ${y} q${w / 2} -2.4 ${w} 0`).join(" ");
  const grooves = Array.from({ length: 16 }, (_, index) => `M${12.5 + index * 25} 305V357`).join(" ");
  return [
    // Стена — рамкой вокруг окна: само стекло остаётся прозрачным. Поверх — полоска обоев.
    `<path fill="${wall}" fill-rule="evenodd" d="M0 0H400V372H0Z ${hole}"/>`,
    `<path fill="${stripes}" fill-rule="evenodd" d="M0 0H400V296H0Z ${hole}"/>`,
    // Панели низа стены.
    `<rect x="0" y="296" width="400" height="66" fill="${g.lin("panel", [[0, c.panel], [1, dk(c.panel, 0.1)]])}"/>`,
    `<path d="${grooves}" stroke="${dk(c.panel, 0.18)}" stroke-width="1.1"/><path d="${grooves}" stroke="${lt(c.panel, 0.3)}" stroke-width="0.8" transform="translate(1.2 0)" opacity="0.7"/>`,
    `<rect x="0" y="293" width="400" height="5.5" fill="${lt(c.panel, 0.34)}"/><rect x="0" y="298.5" width="400" height="2.5" fill="${dk(c.panel, 0.3)}" opacity="0.45"/>`,
    // Плинтус.
    `<rect x="0" y="360" width="400" height="12" fill="${c.skirting}"/><rect x="0" y="360" width="400" height="1.6" fill="${lt(c.skirting, 0.6)}"/><rect x="0" y="369.6" width="400" height="2.4" fill="${dk(c.skirting, 0.35)}" opacity="0.55"/>`,
    // Пол: доски нескольких тонов, швы и волокна; у стены — тень.
    planks.join(""),
    `<path d="${seams}" stroke="${c.floorLine}" stroke-width="1" opacity="0.7"/>`,
    `<path d="${grain}" fill="none" stroke="${c.floorLine}" stroke-width="0.7" opacity="0.32"/>`,
    `<rect x="0" y="372" width="400" height="16" fill="${g.lin("floorTop", [[0, "#1a0f1e", 0.28], [1, "#1a0f1e", 0]])}"/>`,
  ].join("");
}

/** Капли на стекле: [x, y, размер]. Каждая пятая медленно сползает (страница двигает её сама). */
/** Средняя створка окна — её и открывают: между переплётами, под верхней перекладиной. */
const SASH = Object.freeze({ x: WIN.x + 91, y: WIN.y + 65, w: 82, h: WIN.h - 65 });
const DROPS = Object.freeze([[146, 86, 1], [171, 142, 1.2], [199, 70, 0.9], [229, 124, 1.1], [247, 190, 1.3], [271, 82, 1], [300, 154, 0.9], [318, 126, 1.2], [338, 62, 1], [357, 176, 1.1], [372, 108, 0.9], [140, 208, 1], [290, 226, 1.2], [188, 232, 0.9], [226, 60, 0.8], [352, 232, 1], [262, 136, 0.8], [310, 200, 1], [158, 170, 0.9], [206, 196, 1.1]]);
/**
 * Само стекло: тень от рамы сверху, блики; в дождь и грозу — капли и запотевший низ, в снег и туман — только
 * запотевший низ, в сухую погоду стекло чистое. Лежит поверх дождя, под рамой.
 */
/**
 * Свет меняется не разом (0.49.0): перед переменой за окном проступает следующий — тёплый закат перед вечером, заря
 * перед утром, синева перед ночью. `glow` — `{ to, k }`: к какому свету идёт и на сколько (0…1). В пасмурную погоду
 * солнца не видно: небо просто темнеет или светлеет.
 */
function skyGlow(g, sky, glow) {
  const k = Math.min(1, Math.max(0, Number(glow?.k) || 0)), to = glow?.to, a = (value) => Math.round(value * k * 100) / 100;
  if (!k || (to !== "утро" && to !== "вечер" && to !== "ночь")) return "";
  const { x, y, w, h } = WIN, box = `class="dusk" x="${x}" y="${y}" width="${w}" height="${h}"`;
  if (to === "ночь") return `<rect ${box} fill="${g.lin("duskNight", [[0, "#0b1030", a(0.5)], [1, "#0b1030", a(0.2)]])}"/>`;
  if (!open(sky)) return `<rect ${box} fill="${to === "вечер" ? "#141a33" : "#dfe6f2"}" opacity="${a(to === "вечер" ? 0.24 : 0.14)}"/>`;
  const [low, high] = to === "вечер" ? ["#ffb060", "#ff7e4a"] : ["#ffc79a", "#ff8fa3"];
  return `<rect ${box} fill="${g.lin("duskWarm", [[0, high, 0], [0.42, high, a(0.16)], [0.8, low, a(0.5)], [1, low, a(0.62)]])}"/>`;
}
function glass(g, part, sky = "rain", ajar = false, glow = null) {
  const { x, y, w, h } = WIN;
  const ink = lit(part) ? "#dfe6ff" : "#ffffff";
  // Створка открыта — в её проёме стекла нет: ни капель, ни запотевшего низа, ни бликов.
  const clip = ajar
    ? g.raw("paneAjar", id => `<clipPath id="${id}"><path clip-rule="evenodd" d="M${x} ${y}H${x + w}V${y + h}H${x}Z M${SASH.x} ${SASH.y}V${SASH.y + SASH.h}H${SASH.x + SASH.w}V${SASH.y}Z"/></clipPath>`)
    : g.raw("pane", id => `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>`);
  const drop = ([dx, dy, k], index) => `<g transform="translate(${dx} ${dy}) scale(${k})"><g${index % 5 === 0 ? ` class="slide s${(index / 5) % 3}"` : ""}><path d="M0 -10 V-3" stroke="${ink}" stroke-width="0.7" stroke-linecap="round" opacity="0.22"/><path d="M0 -3.2 q2.7 3.4 0 5.8 q-2.7 -2.4 0 -5.8z" fill="${ink}" opacity="0.42"/><circle cx="-0.6" cy="0.6" r="0.6" fill="#ffffff" opacity="0.85"/></g></g>`;
  return [
    skyGlow(g, sky, glow),
    `<g clip-path="${clip}">`,
    `<rect x="${x}" y="${y}" width="${w}" height="28" fill="${g.lin("glassTop", [[0, "#0b1030", 0.36], [1, "#0b1030", 0]])}"/>`,
    wet(sky) || sky === "snow" || sky === "fog" ? `<rect x="${x}" y="${y + h - 56}" width="${w}" height="56" fill="${g.lin("glassFog", [[0, "#ffffff", 0], [1, "#ffffff", lit(part) ? 0.12 : 0.22]])}"/>` : "",
    `<g fill="#ffffff" opacity="${lit(part) ? 0.04 : 0.08}"><path d="M${x + 30} ${y} h34 l-66 ${h} h-34z"/><path d="M${x + 78} ${y} h10 l-66 ${h} h-10z"/><path d="M${x + 226} ${y} h22 l-66 ${h} h-22z"/></g>`,
    wet(sky) ? DROPS.map(drop).join("") : "",
    `</g>`,
  ].join("");
}

function windowFrame(g, c) {
  const { x, y, w, h } = WIN;
  const bar = (bx, by, bw, bh, upright) => [
    `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${c.frame}"/>`,
    upright
      ? `<rect x="${bx}" y="${by}" width="1.3" height="${bh}" fill="${lt(c.frame, 0.7)}"/><rect x="${bx + bw - 1.5}" y="${by}" width="1.5" height="${bh}" fill="${c.frameDark}" opacity="0.85"/>`
      : `<rect x="${bx}" y="${by}" width="${bw}" height="1.2" fill="${lt(c.frame, 0.7)}"/><rect x="${bx}" y="${by + bh - 1.4}" width="${bw}" height="1.4" fill="${c.frameDark}" opacity="0.85"/>`,
  ].join("");
  return [
    `<path fill="${c.frame}" fill-rule="evenodd" d="M${x - 9} ${y - 9}H${x + w + 9}V${y + h}H${x - 9}Z M${x} ${y}V${y + h}H${x + w}V${y}Z"/>`,
    `<path d="M${x - 9} ${y - 8.2}H${x + w + 9}" stroke="${lt(c.frame, 0.8)}" stroke-width="1.6"/>`,
    `<path d="M${x} ${y + h}V${y}H${x + w}" fill="none" stroke="${c.frameDark}" stroke-width="2.2" opacity="0.9"/><path d="M${x + w} ${y}V${y + h}" stroke="${lt(c.frame, 0.6)}" stroke-width="1.2" opacity="0.7"/>`,
    `<path d="M${x - 9} ${y - 9}V${y + h} M${x + w + 9} ${y - 9}V${y + h}" stroke="${c.frameDark}" stroke-width="1" opacity="0.7"/>`,
    bar(x, y + 60, w, 5, false), bar(x + 85, y, 6, h, true), bar(x + 173, y, 6, h, true),
    // Ручка на средней створке.
    `<rect x="${x + 174.6}" y="${y + 146}" width="2.8" height="13" rx="1.4" fill="${c.metal}"/><rect x="${x + 174.6}" y="${y + 146}" width="2.8" height="4.4" rx="1.4" fill="${c.metalDark}"/>`,
  ].join("");
}

function sill(g, c) {
  return [
    `<rect x="106" y="279" width="294" height="9" fill="${g.lin("sillShade", [[0, "#1a0f1e", 0.22], [1, "#1a0f1e", 0]])}"/>`,
    `<rect x="106" y="262" width="296" height="12.5" rx="1.5" fill="${g.lin("sill", [[0, lt(c.sill, 0.5)], [1, c.sill]])}"/>`,
    `<rect x="106" y="273.5" width="296" height="5.5" rx="1" fill="${c.sillEdge}"/><rect x="106" y="273.5" width="296" height="1" fill="${dk(c.sillEdge, 0.14)}" opacity="0.5"/>`,
  ].join("");
}

/** Штора слева, собранная подхватом; правая — её отражение (видна только кромка у края рисунка). */
function curtain(g, c) {
  const cloth = g.lin("curtain", [[0, c.curtainDark], [0.25, c.curtain], [0.6, lt(c.curtain, 0.4)], [1, c.curtainDark]], [0, 0, 1, 0]);
  const fold = (d, w = 2.4) => `<path d="${d}" stroke="${c.curtainDark}" stroke-width="${w}" opacity="0.55"/>`;
  const gleam = (d) => `<path d="${d}" stroke="${lt(c.curtain, 0.7)}" stroke-width="1.6" opacity="0.6"/>`;
  return [
    `<path d="M100 29 H152 C152 86 147 136 129 177 L101 177 Z" fill="${cloth}"/>`,
    `<path d="M101 186 H128 C134 212 135 240 134 262 q-4 4 -8 0 q-4 4 -8 0 q-4 4 -8 0 q-5 3 -9 0 Z" fill="${cloth}"/>`,
    `<g fill="none" stroke-linecap="round">`,
    fold("M109 30 C110 90 108 140 105 176"), fold("M120 30 C121 90 117 140 111 176"), fold("M131 30 C132 88 126 138 117 176"), fold("M142 30 C143 86 135 136 123 176", 2),
    gleam("M114.5 31 C115.5 90 112 140 108 175"), gleam("M125.5 31 C126.5 88 121 138 114 175"), gleam("M136.5 31 C137.5 86 130 136 120 175"),
    fold("M107 187 C106 215 105 240 105 262"), fold("M115 187 C117 215 117 240 117 262"), fold("M123 187 C127 212 128 240 127 262", 2),
    gleam("M111 188 C111.5 215 111 240 111 261"), gleam("M119.5 188 C122 214 122.5 240 122 261"),
    `</g>`,
    // Подхват: красная лента.
    `<path d="M99.6 176.6 Q115 183.4 130.6 176.6 L130.8 183.6 Q115 190.4 99.6 183.6Z" fill="${c.tie}"/><path d="M100 178 Q115 184.6 130.4 178" fill="none" stroke="${lt(c.tie, 0.45)}" stroke-width="1" opacity="0.7"/><path d="M100 183 Q115 189.6 130.4 183" fill="none" stroke="${dk(c.tie, 0.3)}" stroke-width="1" opacity="0.6"/>`,
  ].join("");
}
function curtains(g, c, airy = false) {
  // Окно открыто (0.49.0, «более живая погода») — шторы чуть ходят от сквозняка: каждая в своём ритме (стили: `.breeze`).
  const cloth = curtain(g, c), one = airy ? `<g class="breeze">${cloth}</g>` : cloth, two = airy ? `<g class="breeze b1">${cloth}</g>` : cloth;
  const rings = Array.from({ length: 6 }, (_, index) => `<ellipse cx="${104 + index * 9}" cy="27.5" rx="1.5" ry="2.7" fill="none" stroke="${c.rod}" stroke-width="0.9"/>`).join("");
  return [
    `<rect x="93" y="28" width="314" height="5" rx="2" fill="#1a0f1e" opacity="0.14"/>`,
    `<rect x="92" y="25.6" width="316" height="3.6" rx="1.8" fill="${c.rod}"/><rect x="92" y="25.6" width="316" height="1.1" rx="0.5" fill="${lt(c.rod, 0.4)}"/><circle cx="91" cy="27.4" r="3.8" fill="${c.rod}"/><circle cx="90" cy="26.2" r="1.2" fill="${lt(c.rod, 0.5)}"/>`,
    one, rings,
    `<g transform="translate(512 0) scale(-1 1)">${two}${rings}</g>`,
  ].join("");
}

/** Гирлянда: на окне или — когда стоит ёлка — на ней. Горит вечером и ночью. */
const BULBS = Object.freeze(["#ffe1a0", "#ffc670", "#ff9fb4", "#ffe1a0", "#a6dcff", "#ffd48a"]);
function bulb(g, x, y, index, c, part, rogue = false) {
  const colour = BULBS[index % BULBS.length];
  const cap = `<rect x="${n(x - 1.1)}" y="${n(y - 1.8)}" width="2.2" height="2.2" rx="0.5" fill="${dk(c.rod, 0.3)}"/>`;
  const shape = `M${n(x)} ${n(y)} q2.7 2.8 0 6.2 q-2.7 -3.4 0 -6.2z`;
  // Сценка «гирлянда замигала»: одна лампочка горит и днём — и мигает не в лад с остальными (стили: `.rogue`).
  if (rogue) return `<g class="bulb rogue"><circle cx="${n(x)}" cy="${n(y + 3)}" r="15" fill="${g.rad("bulbRogue", [[0, "#fff3c4", 0.95], [0.3, "#ffd97a", 0.5], [1, "#ffd97a", 0]])}"/>${cap}<path d="${shape}" fill="#fff6d8"/><circle cx="${n(x)}" cy="${n(y + 3.3)}" r="1.3" fill="#ffffff"/></g>`;
  if (!lit(part)) return `${cap}<path d="${shape}" fill="${tint(lt(colour, 0.3), part)}" opacity="0.95"/><circle cx="${n(x - 0.5)}" cy="${n(y + 2.2)}" r="0.6" fill="#ffffff" opacity="0.85"/>`;
  const halo = g.rad(`bulb${index % BULBS.length}`, [[0, colour, 0.8], [0.3, colour, 0.34], [1, colour, 0]]);
  return `<g class="bulb b${index % 4}"><circle cx="${n(x)}" cy="${n(y + 3)}" r="12" fill="${halo}"/>${cap}<path d="${shape}" fill="${lt(colour, 0.3)}"/><circle cx="${n(x)}" cy="${n(y + 3.3)}" r="1.1" fill="#ffffff"/></g>`;
}
/** Которая лампочка гирлянды «живёт своей жизнью» в сценке: над средней створкой, где её видно при любой позе. */
const ROGUE_BULB = 10;
function garland(g, c, part, { onTree = false, rogue = false } = {}) {
  if (onTree) return "";
  const hooks = [120, 154, 188, 222, 256, 290, 324, 358, 392];
  const top = 38;
  let wire = `M${hooks[0]} ${top}`;
  const spots = [];
  for (let index = 0; index < hooks.length - 1; index += 1) {
    const from = hooks[index], to = hooks[index + 1], dip = 9 + (index % 2 ? 2.5 : 0);
    wire += ` Q${(from + to) / 2} ${top + dip * 2} ${to} ${top}`;
    // Три лампочки на пролёт — на той же дуге.
    for (const t of [0.22, 0.5, 0.78]) spots.push([from + (to - from) * t, top + 4 * t * (1 - t) * dip]);
  }
  // Хвост гирлянды спускается по шторе у левого края окна: его она и поправляет.
  const tail = [[122, 64], [119, 92], [123, 120], [119, 148], [122, 172], [124, 200], [121, 226], [124, 250]];
  wire += ` M${hooks[0]} ${top} Q117 50 ${tail[0][0]} ${tail[0][1]} ${tail.slice(1).map(([x, y]) => `T${x} ${y}`).join(" ")}`;
  const nails = hooks.map(x => `<circle cx="${x}" cy="${top}" r="1.2" fill="${dk(c.rod, 0.3)}"/>`).join("");
  return `<path d="${wire}" fill="none" stroke="${dk(c.rod, 0.2)}" stroke-width="0.7" stroke-linejoin="round" stroke-linecap="round"/>${nails}${[...spots, ...tail].map(([x, y], index) => bulb(g, x, y + 0.8, index, c, part, rogue && index === ROGUE_BULB)).join("")}`;
}

// ── на стене ─────────────────────────────────────────────────────────────────
function sparkle(x, y, k = 1) {
  return `<path d="M${x} ${n(y - 3 * k)} l${n(0.8 * k)} ${n(2.2 * k)} l${n(2.2 * k)} ${n(0.8 * k)} l${n(-2.2 * k)} ${n(0.8 * k)} l${n(-0.8 * k)} ${n(2.2 * k)} l${n(-0.8 * k)} ${n(-2.2 * k)} l${n(-2.2 * k)} ${n(-0.8 * k)} l${n(2.2 * k)} ${n(-0.8 * k)}z"/>`;
}
/** Карта звёздного неба: Кассиопея («W»), ковш и планета с кольцом. */
function starMap(g, c) {
  const sky = g.rad("map", [[0, lt(c.navy, 0.2)], [1, c.navy]]);
  const cass = [[25, 58], [34, 69], [44, 60], [54, 70], [63, 59]];
  const dipper = [[58, 90], [68, 91], [69, 100], [59, 99], [58, 90]];
  const handle = [[68, 91], [76, 86], [84, 84], [92, 87]];
  const small = [[21, 51], [40, 49], [73, 51], [89, 55], [92, 68], [23, 79], [41, 83], [48, 102], [27, 104], [80, 104], [90, 97], [52, 53], [80, 72], [36, 96], [46, 76], [86, 62]];
  const line = (list) => `M${list.map(([x, y]) => `${x} ${y}`).join(" L")}`;
  return [
    `<rect x="16" y="45" width="86" height="70" rx="2" fill="#1a0f1e" opacity="0.18"/>`,
    `<rect x="14" y="42" width="86" height="70" rx="2" fill="${c.woodDark}"/><rect x="14" y="42" width="86" height="2" rx="1" fill="${lt(c.woodDark, 0.25)}"/>`,
    `<rect x="18" y="46" width="78" height="62" fill="${sky}"/>`,
    `<g fill="none" stroke="${c.star}" stroke-width="0.4" opacity="0.22"><circle cx="57" cy="77" r="27"/><circle cx="57" cy="77" r="15"/><path d="M57 46V108 M18 77H96"/></g>`,
    `<path d="${line(cass)} ${line(dipper)} ${line(handle)}" fill="none" stroke="${c.star}" stroke-width="0.6" opacity="0.6" stroke-linejoin="round"/>`,
    `<g fill="${c.star}">${[...cass, ...dipper.slice(0, 4), ...handle.slice(1)].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4"/>`).join("")}${small.map(([x, y], index) => `<circle cx="${x}" cy="${y}" r="${index % 3 ? 0.6 : 0.9}" opacity="${index % 2 ? 0.7 : 1}"/>`).join("")}${sparkle(82, 61, 0.9)}${sparkle(37, 90, 0.7)}</g>`,
    // Планета с кольцом.
    `<circle cx="30" cy="94" r="4.6" fill="${lt(c.gold, 0.1)}"/><path d="M26.4 91.8 q3.6 -2.4 7.4 0.4" fill="none" stroke="${dk(c.gold, 0.25)}" stroke-width="0.9"/><ellipse cx="30" cy="94" rx="8.4" ry="2.2" fill="none" stroke="${c.star}" stroke-width="0.8" transform="rotate(-18 30 94)"/>`,
    `<rect x="18" y="46" width="78" height="62" fill="none" stroke="${dk(c.navy, 0.4)}" stroke-width="1" opacity="0.6"/>`,
  ].join("");
}
/** Её рисунок: Байт и сердечко, на двух полосках цветного скотча. */
function drawing(c) {
  return `<g transform="rotate(-3 36 140)">${[
    `<rect x="19" y="121.5" width="36" height="40" rx="1" fill="#1a0f1e" opacity="0.16"/>`,
    `<rect x="18" y="120" width="36" height="40" rx="1" fill="${c.paper}"/><path d="M48 160 l6 -6 v6z" fill="${c.paperDark}"/>`,
    // Байт: уши, морда, глаза, усы.
    `<path d="M26 137 l1 -8 l5 4 q4 -2 8 0 l5 -4 l1 8 q2 10 -10 10 q-12 0 -10 -10z" fill="${c.cat}"/><circle cx="32" cy="138" r="1.5" fill="${c.ink}"/><circle cx="40" cy="138" r="1.5" fill="${c.ink}"/><path d="M34.8 141 h2.4 l-1.2 1.4z" fill="${c.nose}"/><path d="M29 141 h-5 M29 143 l-5 1.4 M43 141 h5 M43 143 l5 1.4" stroke="${c.ink}" stroke-width="0.5" stroke-linecap="round"/>`,
    `<path d="M41 152 q-2.6 -3.4 0 -4.4 q1.6 -0.4 2 1.2 q0.4 -1.6 2 -1.2 q2.6 1 0 4.4 l-2 2z" fill="${c.red}"/>`,
    `<path d="M23 153 q4 -3 8 0 q4 3 7 0" fill="none" stroke="${c.plaid}" stroke-width="1.2" stroke-linecap="round"/>`,
    `<rect x="16" y="118.5" width="9" height="4" fill="${c.rugLight}" opacity="0.85" transform="rotate(-24 20 120)"/><rect x="47" y="118.5" width="9" height="4" fill="${c.plaidLight}" opacity="0.85" transform="rotate(24 52 120)"/>`,
  ].join("")}</g>`;
}
function calendar(c) {
  const days = [0, 1, 2, 3].map(row => [0, 1, 2, 3, 4].map(col => `<rect x="${n(67.4 + col * 5.4)}" y="${n(136 + row * 6)}" width="3.4" height="3.4" rx="0.7" fill="${row === 1 && col === 2 ? c.red : c.paperDark}"/>`).join("")).join("");
  return [
    `<rect x="65" y="121.5" width="34" height="42" rx="1.5" fill="#1a0f1e" opacity="0.16"/>`,
    `<rect x="64" y="120" width="34" height="42" rx="1.5" fill="${c.paper}"/><path d="M64 121.5 q0 -1.5 1.5 -1.5 h31 q1.5 0 1.5 1.5 v9.5 h-34z" fill="${c.red}"/>`,
    `<path d="M70 126 h10 M84 126 h8" stroke="${lt(c.red, 0.6)}" stroke-width="1.4" stroke-linecap="round"/>`,
    [70, 77, 84, 91].map(x => `<rect x="${x}" y="117.6" width="1.6" height="5" rx="0.8" fill="${c.metalDark}"/>`).join(""),
    days,
    `<circle cx="79.9" cy="143.7" r="4.6" fill="none" stroke="${c.red}" stroke-width="1.3"/>`,
  ].join("");
}

// ── полка ────────────────────────────────────────────────────────────────────
function mug(x, base, colour, { steam = false } = {}) {
  return [
    `<path d="M${x + 5.5} ${base - 9.5} q7.5 0 7.5 4.4 q0 4.4 -7.5 4.4" fill="none" stroke="${dk(colour, 0.12)}" stroke-width="2.2"/>`,
    `<path d="M${x - 6.5} ${base - 13} h13 v9.5 q0 3.5 -3.5 3.5 h-6 q-3.5 0 -3.5 -3.5z" fill="${colour}"/>`,
    `<path d="M${x + 3} ${base - 13} h3.5 v9.5 q0 3.5 -3.5 3.5z" fill="${dk(colour, 0.2)}" opacity="0.6"/><rect x="${x - 6.5}" y="${base - 13}" width="13" height="2" fill="${lt(colour, 0.45)}" opacity="0.8"/><rect x="${x - 4.6}" y="${base - 9.6}" width="1.6" height="6" rx="0.8" fill="#ffffff" opacity="0.35"/>`,
    steam ? `<g class="steam" fill="none" stroke="#ffffff" stroke-width="1.3" stroke-linecap="round" opacity="0.6"><path d="M${x - 2.4} ${base - 16} q-3 -4 0 -8 q3 -4 0 -7"/><path d="M${x + 2.6} ${base - 17} q3 -4 0 -8"/></g>` : "",
  ].join("");
}
/** Ноты над колонкой, когда она играет (0.46.0): три, каждая в свой черёд (стиль страницы `.note`). */
function speakerNotes(c) {
  const one = ([dx, dy, delay]) => `<g transform="translate(${dx} ${dy})"><g class="note" style="animation-delay:${delay}s" fill="${c.paper}" opacity="0.9"><path d="M58 326 v-9 l5 -1.6 v8.6" fill="none" stroke="${c.paper}" stroke-width="1"/><ellipse cx="56.6" cy="326" rx="1.9" ry="1.4"/><ellipse cx="61.6" cy="324" rx="1.9" ry="1.4"/></g></g>`;
  return `<circle cx="48.6" cy="330.6" r="1.5" fill="#7de0c8"/><circle cx="48.6" cy="330.6" r="3" fill="#7de0c8" opacity="0.3"/>${[[0, 2, 0], [15, 6, -1.2], [29, 3, -2.3]].map(one).join("")}`;
}
/** Колонка: играет — ноты; вечером сама тихо играет lo-fi — огонёк и одна нота. */
const speakerTune = (c, part, music) => (music ? speakerNotes(c) : part === "вечер" ? `<circle cx="48.6" cy="330.6" r="1.2" fill="#7de0c8"/><g class="note" fill="${c.paper}" opacity="0.8"><path d="M58 326 v-9 l5 -1.6 v8.6" fill="none" stroke="${c.paper}" stroke-width="1"/><ellipse cx="56.6" cy="326" rx="1.9" ry="1.4"/><ellipse cx="61.6" cy="324" rx="1.9" ry="1.4"/></g>` : "");
function bookcase(g, c, has, part, music = false) {
  const x = 8, y = 170, w = 98, h = 202;
  const shelves = [218, 266, 314];
  const book = (bx, base, bw, bh, colour, { tilt = 0, band = "" } = {}) => `<g${tilt ? ` transform="rotate(${tilt} ${bx} ${base})"` : ""}><rect x="${bx}" y="${base - bh}" width="${bw}" height="${bh}" rx="0.9" fill="${colour}"/><rect x="${bx}" y="${base - bh}" width="1.2" height="${bh}" fill="${lt(colour, 0.35)}" opacity="0.7"/><rect x="${bx + bw - 1.3}" y="${base - bh}" width="1.3" height="${bh}" fill="${dk(colour, 0.3)}" opacity="0.6"/>${band ? `<rect x="${bx + 0.8}" y="${base - bh + 4}" width="${bw - 1.6}" height="2.4" fill="${band}"/><rect x="${bx + 0.8}" y="${base - 7}" width="${bw - 1.6}" height="1.4" fill="${band}" opacity="0.8"/>` : ""}</g>`;
  // ВАЛЛ-И: коробочка на гусеницах, шея и два глаза-бинокля.
  const walle = [
    `<path d="M18.6 218 l2.6 -9 h5.4 l1.6 9z M32 218 l1.6 -9 h5.4 l2.6 9z" fill="${dk(c.walleDark, 0.45)}"/><path d="M20.4 215 h6.6 M20.8 212 h5.6 M33 215 h6.6 M33.6 212 h5.6" stroke="${lt(c.walleDark, 0.1)}" stroke-width="0.7"/>`,
    `<rect x="22" y="197.4" width="16.4" height="14.6" rx="1.8" fill="${c.walle}"/><rect x="22" y="207" width="16.4" height="5" rx="1.4" fill="${c.walleDark}" opacity="0.75"/><rect x="24.4" y="199.6" width="6" height="4.4" rx="0.8" fill="${dk(c.walle, 0.3)}"/><circle cx="34.6" cy="201.8" r="1.3" fill="${c.red}"/><rect x="22" y="197.4" width="16.4" height="1.6" rx="0.8" fill="${lt(c.walle, 0.45)}"/>`,
    `<path d="M22 203 l-3.4 4 M38.4 203 l3.4 4" stroke="${c.walleDark}" stroke-width="1.8" stroke-linecap="round"/>`,
    `<rect x="29.3" y="191.6" width="1.9" height="6.4" fill="${c.walleDark}"/>`,
    `<g transform="rotate(-9 26.4 188.4)"><rect x="22.6" y="184.4" width="7.4" height="8" rx="3.2" fill="${c.metal}"/><circle cx="26.3" cy="188.6" r="2.3" fill="${c.ink}"/><circle cx="25.6" cy="187.8" r="0.7" fill="#ffffff"/></g>`,
    `<g transform="rotate(9 34 188.4)"><rect x="30.4" y="184.4" width="7.4" height="8" rx="3.2" fill="${c.metal}"/><circle cx="34.1" cy="188.6" r="2.3" fill="${c.ink}"/><circle cx="33.4" cy="187.8" r="0.7" fill="#ffffff"/></g>`,
  ].join("");
  const top = [
    walle,
    book(47, 218, 6, 32, c.plaidDark, { band: c.gold }), book(53.4, 218, 5, 27, c.rug), book(58.8, 218, 7, 34, c.greenDark, { band: c.paper }), book(66.2, 218, 5, 25, c.paperDark), book(71.6, 218, 6, 30, c.top, { band: c.jacket }),
    book(80, 218, 5.6, 29, c.plaid, { tilt: 11 }),
    // Две книги плашмя.
    `<rect x="85" y="213.4" width="14" height="4.6" rx="0.9" fill="${c.chair}"/><rect x="86" y="209.2" width="12" height="4.2" rx="0.9" fill="${c.gold}"/><rect x="85" y="213.4" width="14" height="1" fill="${lt(c.chair, 0.3)}"/>`,
  ].join("");
  const middle = [
    // «Маленький принц» — жёлтый корешок со звездой; рядом — тома манги.
    book(17, 266, 8.4, 36, c.gold), `<g fill="${c.paper}">${sparkle(21.2, 240, 1)}</g><rect x="18.4" y="256" width="5.6" height="1.4" fill="${dk(c.gold, 0.3)}"/>`,
    [0, 1, 2, 3, 4, 5].map(index => `<rect x="${n(27.4 + index * 5.7)}" y="237" width="5.2" height="29" rx="0.6" fill="${c.paper}"/><rect x="${n(27.4 + index * 5.7)}" y="237" width="5.2" height="7.4" rx="0.6" fill="${index % 2 ? c.top : c.jacket}"/><circle cx="${n(30 + index * 5.7)}" cy="250" r="1.1" fill="${index % 2 ? c.jacket : c.top}"/><rect x="${n(28.6 + index * 5.7)}" y="258" width="2.8" height="1" fill="${c.paperDark}"/>`).join(""),
    has("снимок")
      ? `<rect x="70" y="240" width="27" height="26" rx="1.8" fill="${c.woodPale}"/><rect x="70" y="240" width="27" height="1.6" rx="0.8" fill="${lt(c.woodPale, 0.4)}"/><rect x="73.2" y="243.2" width="20.6" height="19.6" fill="${c.paper}"/><rect x="75.4" y="246" width="11" height="4.6" rx="2.2" fill="${c.plaidLight}"/><rect x="80.4" y="252.4" width="11.4" height="4.6" rx="2.2" fill="${c.rugLight}"/><path d="M76 259.6 h9" stroke="${c.paperDark}" stroke-width="1.2" stroke-linecap="round"/>`
      : book(64.6, 266, 6, 27, c.chairDark) + book(71, 266, 7, 31, c.plaid, { band: c.cream }) + book(78.4, 266, 5, 24, c.rugLight) + book(84.6, 266, 6.4, 28, c.woodPale, { tilt: 9 }),
  ].join("");
  const low = [
    mug(27, 314, c.mug), has("кружка") ? mug(47, 314, c.mug2) : "",
    // Жестянка с жасминовым чаем и банка с печеньем.
    `<rect x="60" y="291" width="22" height="23" rx="2" fill="${c.green}"/><rect x="60" y="291" width="3" height="23" rx="1.5" fill="${lt(c.green, 0.3)}" opacity="0.6"/><rect x="59" y="288" width="24" height="5" rx="1.6" fill="${c.greenDark}"/><rect x="63.6" y="297" width="14.8" height="11" rx="1.2" fill="${c.paper}"/><circle cx="71" cy="301.6" r="1.4" fill="${c.gold}"/><g fill="#ffffff" stroke="${c.paperDark}" stroke-width="0.3"><circle cx="71" cy="299.4" r="1.4"/><circle cx="73.1" cy="301" r="1.4"/><circle cx="72.3" cy="303.5" r="1.4"/><circle cx="69.7" cy="303.5" r="1.4"/><circle cx="68.9" cy="301" r="1.4"/></g><circle cx="71" cy="301.6" r="1.1" fill="${c.gold}"/>`,
    `<rect x="86" y="296" width="13" height="18" rx="2.6" fill="${lt(c.metal, 0.5)}" opacity="0.75"/><rect x="85.4" y="293" width="14.2" height="4" rx="1.4" fill="${c.woodPale}"/><circle cx="90" cy="308" r="2.4" fill="${c.box}"/><circle cx="95" cy="309.6" r="2.3" fill="${c.boxDark}"/><circle cx="92.6" cy="303.6" r="2.3" fill="${c.box}"/><rect x="87.6" y="298" width="1.4" height="13" rx="0.7" fill="#ffffff" opacity="0.6"/>`,
  ].join("");
  const bottom = [
    // Колонка: вечером из неё тихо играет lo-fi.
    `<rect x="16" y="326" width="37" height="40" rx="3" fill="${c.jacket}"/><rect x="16" y="326" width="37" height="2" rx="1" fill="${c.jacketLight}"/>`,
    `<circle cx="34.5" cy="339" r="8" fill="${dk(c.jacket, 0.35)}"/><circle cx="34.5" cy="339" r="5.4" fill="${c.jacketLight}"/><circle cx="34.5" cy="339" r="2.2" fill="${dk(c.jacket, 0.3)}"/><circle cx="34.5" cy="356" r="5.2" fill="${dk(c.jacket, 0.35)}"/><circle cx="34.5" cy="356" r="3.2" fill="${c.jacketLight}"/><circle cx="34.5" cy="356" r="1.3" fill="${dk(c.jacket, 0.3)}"/>`,
    speakerTune(c, part, music) || `<circle cx="48.6" cy="330.6" r="1.2" fill="${dk(c.jacket, 0.3)}"/>`,
    // Плетёная корзина.
    `<rect x="59" y="338" width="40" height="28" rx="3" fill="${c.box}"/><path d="M59 345 h40 M59 352 h40 M59 359 h40" stroke="${c.boxDark}" stroke-width="1" opacity="0.6"/><path d="M66 338 v28 M74 338 v28 M82 338 v28 M90 338 v28" stroke="${c.boxDark}" stroke-width="0.7" opacity="0.35"/><rect x="72" y="342.6" width="14" height="5" rx="2.5" fill="${dk(c.boxDark, 0.25)}"/><rect x="59" y="338" width="40" height="2" rx="1" fill="${lt(c.box, 0.35)}"/>`,
  ].join("");
  const shade = g.lin("shelfShade", [[0, "#1a0f1e", 0.42], [1, "#1a0f1e", 0]]);
  return [
    `<rect x="${x + w}" y="${y + 6}" width="7" height="${h - 6}" fill="${g.lin("caseShade", [[0, "#1a0f1e", 0.2], [1, "#1a0f1e", 0]], [0, 0, 1, 0])}"/>`,
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${c.wood}"/><rect x="${x + 5}" y="${y + 6}" width="${w - 10}" height="${h - 12}" fill="${c.woodDark}"/>`,
    `<rect x="${x + 5}" y="${y + 6}" width="${w - 10}" height="9" fill="${shade}"/>${shelves.map(level => `<rect x="${x + 5}" y="${level + 5}" width="${w - 10}" height="9" fill="${shade}"/>`).join("")}`,
    top, middle, low, bottom,
    shelves.map(level => `<rect x="${x + 5}" y="${level}" width="${w - 10}" height="5" fill="${c.wood}"/><rect x="${x + 5}" y="${level}" width="${w - 10}" height="1.2" fill="${c.woodLight}"/>`).join(""),
    `<rect x="${x}" y="${y}" width="5" height="${h}" fill="${c.woodLight}" opacity="0.5"/><rect x="${x + w - 5}" y="${y}" width="5" height="${h}" fill="${dk(c.wood, 0.25)}" opacity="0.5"/><rect x="${x}" y="${y + h - 6}" width="${w}" height="6" fill="${c.wood}"/>`,
    `<rect x="${x - 3}" y="${y - 4}" width="${w + 6}" height="7" rx="1.8" fill="${c.woodLight}"/><rect x="${x - 3}" y="${y - 4}" width="${w + 6}" height="1.6" rx="0.8" fill="${c.woodPale}"/><rect x="${x - 1}" y="${y + 3}" width="${w + 2}" height="2.4" fill="#1a0f1e" opacity="0.25"/>`,
  ].join("");
}

// ── кресла, плед, стол ───────────────────────────────────────────────────────
/**
 * Где стоит её кресло: середина сиденья, его верх и размер. От этих чисел считаются она в кресле, плед и Байт на нём.
 * С 0.44.0 кресло — её роста (`k`): до того оно было впору Байту, и сидела она на пуфе, который появлялся вместе с
 * ней («почему кресло остаётся сзади, а она садится во что-то, что появляется вместе с ней» — владелец). Верх
 * сиденья — на высоте её бёдер, когда она сидит (`seat` в `HER_SPRITES`), спинка — ей по плечи.
 */
const CHAIR = Object.freeze({ x: 196, y: 374, k: 1.45 });
/** Точка кресла на рисунке: (dx, dy) — в собственных единицах кресла, от середины сиденья. */
const chairAt = (dx, dy) => [CHAIR.x + dx * CHAIR.k, CHAIR.y + dy * CHAIR.k];
/** Пол у ножек кресла: здесь Байт точит о него когти; под сиденьем, между ножками, — его глаза из темноты. */
const CLAW_Y = chairAt(0, 51)[1], UNDER_Y = chairAt(0, 48)[1];
/** Второе кресло (вещь «кресло»): дальше и меньше, выглядывает из-за первого справа. */
const CHAIR2 = Object.freeze({ x: 281, y: 360, k: 0.92 });
/** Колючка на подоконнике и то, насколько она и Байт светлее комнаты вечером и ночью. */
const PLANT = Object.freeze({ x: 340 });
const FIGURE_SOFT = 0.6;
/** Кресло. Точка отсчёта — середина сиденья. `second` — второе (вещь «кресло»): песочное и поменьше. */
function armchair(g, c, x, y, { second = false, k = 1 } = {}) {
  const [fill, dark, light] = second ? [c.chair2, c.chair2Dark, c.chair2Light] : [c.chair, c.chairDark, c.chairLight];
  const name = second ? "chair2" : "chair";
  const back = g.lin(`${name}Back`, [[0, light], [0.5, fill], [1, dark]]);
  const base = g.lin(`${name}Base`, [[0, fill], [1, dk(dark, 0.15)]]);
  const arm = (side) => [
    `<path d="M${side * 60} 40 V-22 Q${side * 60} -37 ${side * 49} -37 Q${side * 38} -37 ${side * 38} -22 V40 Z" fill="${dark}"/>`,
    `<path d="M${side * 58.4} 38 V-22" stroke="${dk(dark, 0.2)}" stroke-width="2.4" opacity="${side < 0 ? 0 : 0.5}"/>`,
    `<circle cx="${side * 49}" cy="-24" r="10.4" fill="${fill}"/><circle cx="${side * 49}" cy="-24" r="6.4" fill="none" stroke="${dark}" stroke-width="1.3" opacity="0.7"/><circle cx="${side * 49}" cy="-24" r="2.2" fill="${dark}"/>`,
    `<path d="M${side * 49 - 7} -29.4 q7 -6.4 14 0" fill="none" stroke="${light}" stroke-width="1.6" stroke-linecap="round" opacity="0.8"/>`,
  ].join("");
  const body = [
    shadow(g, 0, 50, 66, 7, 0.34),
    // Ножки.
    `<path d="M-55 39 h10 l-1.6 12.6 h-6.4z M55 39 h-10 l1.6 12.6 h6.4z" fill="${c.woodDark}"/>`,
    // Спинка с подушкой, швом и пуговицами.
    `<path d="M-51 12 V-48 Q-51 -80 -20 -80 H20 Q51 -80 51 -48 V12 Z" fill="${back}"/>`,
    `<path d="M-38 6 V-46 Q-38 -68 -17 -68 H17 Q38 -68 38 -46 V6 Z" fill="${light}" opacity="0.5"/>`,
    `<path d="M-45 -50 Q-45 -75 -20 -75 H20 Q45 -75 45 -50" fill="none" stroke="${lt(light, 0.3)}" stroke-width="2" stroke-linecap="round" opacity="0.55"/>`,
    `<path d="M0 -68 V-2 M-38 -30 Q-19 -36 0 -30 Q19 -36 38 -30" fill="none" stroke="${dark}" stroke-width="1" opacity="0.45"/>`,
    `<circle cx="-18" cy="-33" r="2.2" fill="${dark}"/><circle cx="18" cy="-33" r="2.2" fill="${dark}"/><circle cx="-18.6" cy="-33.6" r="0.8" fill="${light}"/><circle cx="17.4" cy="-33.6" r="0.8" fill="${light}"/>`,
    // Сиденье и низ.
    `<rect x="-40" y="10" width="80" height="30" rx="2" fill="${base}"/>`,
    `<rect x="-40" y="-8" width="80" height="21" rx="8" fill="${g.lin(`${name}Seat`, [[0, lt(light, 0.12)], [1, fill]])}"/><path d="M-34 10.6 Q0 14 34 10.6" fill="none" stroke="${dark}" stroke-width="1.2" opacity="0.6"/><path d="M-32 -4.6 Q0 -7.4 32 -4.6" fill="none" stroke="${lt(light, 0.35)}" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>`,
    arm(-1), arm(1),
  ].join("");
  return at(x, y, body, k === 1 ? "" : ` scale(${k})`);
}

/** Клетка пледа: одна на все пледы рисунка. */
const tartan = (g, c) => g.raw("tartan", id => `<pattern id="${id}" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)"><rect width="18" height="18" fill="${c.plaid}"/><rect width="6.4" height="18" fill="${c.plaidDark}" opacity="0.62"/><rect width="18" height="6.4" fill="${c.plaidDark}" opacity="0.62"/><rect x="11" width="2.2" height="18" fill="${c.plaidLight}" opacity="0.7"/><rect y="11" width="18" height="2.2" fill="${c.plaidLight}" opacity="0.7"/><rect x="2.8" width="0.8" height="18" fill="${c.cream}" opacity="0.6"/><rect y="2.8" width="18" height="0.8" fill="${c.cream}" opacity="0.6"/></pattern>`);
/** Клетчатый плед: `d` — контур, `folds` — тёмные складки, `gleams` — светлые гребни, `fringe` — бахрома. */
function plaidShape(g, c, d, { folds = [], gleams = [], fringe = "" } = {}) {
  return [
    fringe ? `<path d="${fringe}" fill="none" stroke="${c.cream}" stroke-width="1.2" stroke-linecap="round" opacity="0.9"/>` : "",
    `<path d="${d}" fill="${tartan(g, c)}"/>`,
    folds.map(fold => `<path d="${fold}" fill="none" stroke="${dk(c.plaidDark, 0.4)}" stroke-width="3" stroke-linecap="round" opacity="0.32"/>`).join(""),
    gleams.map(gleam => `<path d="${gleam}" fill="none" stroke="${lt(c.plaidLight, 0.3)}" stroke-width="2" stroke-linecap="round" opacity="0.4"/>`).join(""),
    `<path d="${d}" fill="none" stroke="${dk(c.plaidDark, 0.35)}" stroke-width="0.8" opacity="0.55"/>`,
  ].join("");
}
/** Плед, брошенный на спинку и подлокотник кресла. `big` — вещь «плед на двоих»: он шире и длиннее. */
function plaidOnChair(g, c, big) {
  const d = big
    ? "M26 -84 Q46 -90 64 -78 L71 -30 Q76 4 68 30 L42 34 Q34 2 33 -34 Q32 -60 26 -84Z"
    : "M32 -82 Q46 -87 60 -78 L66 -34 Q70 -4 64 18 L44 22 Q38 -6 37 -36 Q36 -62 32 -82Z";
  const fringe = big
    ? "M44 34 l-1 6 M49 33.4 l0 6 M54 32.6 l0.6 6 M59 31.8 l1 6 M64 30.8 l1.6 6"
    : "M46 22 l-1 5.4 M51 21.2 l0 5.6 M56 20.2 l0.8 5.6 M61 19 l1.4 5.4";
  return at(CHAIR.x, CHAIR.y, plaidShape(g, c, d, {
    fringe,
    folds: big ? ["M40 -70 Q46 -30 44 26", "M58 -72 Q64 -30 60 24"] : ["M42 -70 Q47 -34 46 14", "M56 -72 Q61 -34 58 12"],
    gleams: big ? ["M49 -78 Q55 -34 52 26"] : ["M49 -76 Q54 -36 52 14"],
  }), ` scale(${CHAIR.k})`);
}

/** Табурет: где стоит у стола и на какой высоте сиденье (с него она дотягивается до столешницы, ступни — на полу). */
const STOOL = Object.freeze({ x: 276, y: 352, rest: 377 });
/** Где стоит табурет, когда она поправляет с него гирлянду. */
const GARLAND_STOOL = 157;
function stool(g, c, x, y) {
  const floor = 393;
  return [
    shadow(g, x, floor + 1, 20, 3.6, 0.3),
    `<path d="M${x - 10} ${y + 4} L${x - 14.5} ${floor} M${x + 10} ${y + 4} L${x + 14.5} ${floor}" stroke="${c.wood}" stroke-width="3.6" stroke-linecap="round"/><path d="M${x} ${y + 5} V${floor - 3}" stroke="${c.woodDark}" stroke-width="3.2" stroke-linecap="round"/>`,
    `<path d="M${x - 12.4} ${y + 22} H${x + 12.4}" stroke="${c.woodDark}" stroke-width="2.2"/>`,
    `<rect x="${x - 15}" y="${y}" width="30" height="6.6" rx="3.3" fill="${c.wood}"/><rect x="${x - 15}" y="${y}" width="30" height="3.4" rx="1.7" fill="${c.woodPale}"/><rect x="${x - 12}" y="${y + 0.8}" width="20" height="1" rx="0.5" fill="${lt(c.woodPale, 0.4)}" opacity="0.8"/>`,
  ].join("");
}

function desk(g, c) {
  const top = 316;
  return [
    shadow(g, 352, 394, 58, 6, 0.32),
    `<rect x="391" y="${top + 6}" width="7" height="72" fill="${c.woodDark}"/>`,
    `<rect x="301" y="${top + 6}" width="7" height="72" rx="1" fill="${c.wood}"/><rect x="301" y="${top + 6}" width="2" height="72" fill="${lt(c.wood, 0.25)}" opacity="0.7"/>`,
    `<rect x="308" y="371" width="84" height="4" fill="${c.woodDark}"/>`,
    // Ящик с ручкой.
    `<rect x="315" y="${top + 6}" width="80" height="23" rx="1.5" fill="${c.wood}"/><rect x="319.5" y="${top + 10}" width="71" height="15" rx="1.5" fill="none" stroke="${c.woodDark}" stroke-width="1.1" opacity="0.75"/><rect x="320" y="${top + 10.6}" width="70" height="1.2" fill="${c.woodLight}" opacity="0.6"/><circle cx="355" cy="${top + 17.4}" r="2.6" fill="${c.woodPale}"/><circle cx="354.3" cy="${top + 16.6}" r="1" fill="${lt(c.woodPale, 0.5)}"/>`,
    // Столешница.
    `<rect x="296" y="${top + 7.4}" width="106" height="3.4" fill="#1a0f1e" opacity="0.24"/>`,
    `<rect x="293" y="${top}" width="112" height="7.6" rx="2" fill="${g.lin("deskTop", [[0, c.woodPale], [1, c.woodLight]])}"/><rect x="293" y="${top}" width="112" height="1.5" rx="0.7" fill="${lt(c.woodPale, 0.45)}"/>`,
  ].join("");
}
/** Чайник с жасминовым чаем и чашка рядом. `steam` — только что наливали: над носиком пар. */
/** Пар над носиком чайника и над чашкой. */
const teaSteam = () => `<g class="steam" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" opacity="0.65"><path d="M350.6 292 q-3 -5 0 -9 q3 -4 0 -8"/><path d="M355 293.4 q3 -5 0 -10"/><path d="M361.4 304 q-2.4 -4 0 -7"/></g>`;
function teapot(g, c, { steam = false } = {}) {
  const body = g.lin("teapot", [[0, lt(c.teapot, 0.5)], [1, c.teapotDark]]);
  return [
    `<ellipse cx="331" cy="316.4" rx="17" ry="2.2" fill="#1a0f1e" opacity="0.2"/>`,
    `<path d="M318.6 304 Q308 303.6 309.6 311 Q311.4 317 319.6 313.4" fill="none" stroke="${c.teapotDark}" stroke-width="2.6" stroke-linecap="round"/>`,
    `<path d="M343 307 Q351.6 304.6 352.6 296.4 L349.4 295.6 Q348 301.6 342 302.6 Z" fill="${body}"/>`,
    `<path d="M316.4 316 Q311.6 299.6 331 298.6 Q350.4 299.6 345.6 316 Z" fill="${body}"/>`,
    `<path d="M315.2 309 Q331 313.6 346.8 309" fill="none" stroke="${c.top}" stroke-width="1.8"/><path d="M315.6 311.8 Q331 316.2 346.4 311.8" fill="none" stroke="${c.top}" stroke-width="0.8" opacity="0.7"/>`,
    `<path d="M322.4 300 Q331 293.6 339.6 300 Z" fill="${c.teapotDark}"/><circle cx="331" cy="294.6" r="2.3" fill="${c.top}"/><circle cx="330.3" cy="293.9" r="0.8" fill="${lt(c.top, 0.5)}"/>`,
    `<ellipse cx="322.6" cy="305" rx="2" ry="3.4" fill="#ffffff" opacity="0.55" transform="rotate(18 322.6 305)"/>`,
    // Чашка.
    `<path d="M366.4 310 q5 0 5 3 q0 3 -5 3" fill="none" stroke="${c.teapotDark}" stroke-width="1.6"/><path d="M356 308 h11 v4.4 q0 3.6 -3.6 3.6 h-3.8 q-3.6 0 -3.6 -3.6z" fill="${body}"/><ellipse cx="361.5" cy="308.2" rx="5.5" ry="1.3" fill="${steam ? dk(c.gold, 0.1) : c.teapotDark}"/>`,
    steam ? teaSteam() : "",
  ].join("");
}
/** Блокнот с напоминаниями и карандаш. */
function notebook(c) {
  return `<path d="M371 316 l3.4 -5 h17 l-2.6 5z" fill="${c.top}"/><path d="M372.6 314.8 l2.4 -3.4 h15 l-1.8 3.4z" fill="${c.paper}"/><path d="M376 313.6 h10 M377 312.2 h9" stroke="${c.paperDark}" stroke-width="0.6"/><path d="M374 311.4 l12 -3.4" stroke="${c.gold}" stroke-width="1.8" stroke-linecap="round"/><path d="M386 308 l2 -0.6" stroke="${c.ink}" stroke-width="1.8" stroke-linecap="round"/>`;
}
/** Лампа на столе: абажур — янтарный или любимого цвета человека (`shade`). Вечером и ночью горит. */
const LAMP = Object.freeze({ x: 385, y: 290 });
function lamp(g, c, part, shade, off = false) {
  // `off` — лампу погасили нажатием (0.46.0): вечером и ночью она стоит тёмной, как днём.
  const on = lit(part) && !off;
  const colour = on ? shade : tint(shade, part);
  const cloth = on
    ? g.lin("shade", [[0, dk(shade, 0.12)], [0.55, shade], [1, lt(shade, 0.55)]])
    : g.lin("shade", [[0, lt(colour, 0.12)], [1, dk(colour, 0.1)]]);
  return [
    `<ellipse cx="${LAMP.x}" cy="316.2" rx="10.4" ry="2" fill="#1a0f1e" opacity="0.22"/>`,
    `<path d="M${LAMP.x - 9} 316 q0 -5 9 -5 q9 0 9 5z" fill="${c.metalDark}"/><rect x="${LAMP.x - 1.2}" y="${LAMP.y - 2}" width="2.4" height="24" fill="${c.metalDark}"/><rect x="${LAMP.x - 1.2}" y="${LAMP.y - 2}" width="0.9" height="24" fill="${lt(c.metalDark, 0.4)}" opacity="0.8"/>`,
    on ? `<ellipse cx="${LAMP.x}" cy="${LAMP.y + 1.4}" rx="14" ry="3.4" fill="#fff4d2"/>` : "",
    `<path d="M${LAMP.x - 16} ${LAMP.y} L${LAMP.x - 10.4} ${LAMP.y - 27} H${LAMP.x + 10.4} L${LAMP.x + 16} ${LAMP.y} Z" fill="${cloth}"/>`,
    `<path d="M${LAMP.x - 10.4} ${LAMP.y - 27} H${LAMP.x + 10.4}" stroke="${on ? dk(shade, 0.3) : dk(colour, 0.25)}" stroke-width="1.6" stroke-linecap="round"/><path d="M${LAMP.x - 16} ${LAMP.y} H${LAMP.x + 16}" stroke="${on ? lt(shade, 0.7) : dk(colour, 0.22)}" stroke-width="1.4" stroke-linecap="round"/>`,
    `<path d="M${LAMP.x - 6} ${LAMP.y - 25} L${LAMP.x - 9.4} ${LAMP.y - 2} M${LAMP.x + 6} ${LAMP.y - 25} L${LAMP.x + 9.4} ${LAMP.y - 2}" stroke="${on ? lt(shade, 0.35) : lt(colour, 0.2)}" stroke-width="0.8" opacity="0.5"/>`,
  ].join("");
}

// ── пол ──────────────────────────────────────────────────────────────────────
function rug(g, c) {
  const cx = 200, cy = 452;
  const fringe = (side) => [-13, -6.5, 0, 6.5, 13].map(dy => `M${cx + side * 153.4} ${cy + dy} l${side * 8} ${n(dy * 0.16)}`).join(" ") + [-19, 19].map(dy => ` M${cx + side * 150} ${cy + dy} l${side * 7} ${n(dy * 0.2)}`).join("");
  return [
    shadow(g, cx, cy + 5, 166, 51, 0.24),
    `<path d="${fringe(-1)} ${fringe(1)}" stroke="${c.cream}" stroke-width="1.5" stroke-linecap="round"/>`,
    `<ellipse cx="${cx}" cy="${cy}" rx="156" ry="46" fill="${c.rugDark}"/>`,
    `<ellipse cx="${cx}" cy="${cy - 1}" rx="153" ry="44" fill="${g.lin("rug", [[0, lt(c.rug, 0.1)], [1, dk(c.rug, 0.08)]])}"/>`,
    `<ellipse cx="${cx}" cy="${cy - 1}" rx="141" ry="38.4" fill="none" stroke="${c.cream}" stroke-width="3.4"/><ellipse cx="${cx}" cy="${cy - 1}" rx="141" ry="38.4" fill="none" stroke="${c.rugDark}" stroke-width="3.4" stroke-dasharray="3 10"/>`,
    `<ellipse cx="${cx}" cy="${cy - 1}" rx="129" ry="33" fill="none" stroke="${c.rugLight}" stroke-width="1" opacity="0.75"/>`,
    `<ellipse cx="${cx}" cy="${cy - 1}" rx="88" ry="21" fill="${c.rugDark}" opacity="0.5"/><ellipse cx="${cx}" cy="${cy - 1}" rx="88" ry="21" fill="none" stroke="${c.rugLight}" stroke-width="1.4" stroke-dasharray="0.1 5.4" stroke-linecap="round"/>`,
    `<ellipse cx="${cx}" cy="${cy - 1}" rx="44" ry="10" fill="${c.rug}" opacity="0.85"/><ellipse cx="${cx}" cy="${cy - 1}" rx="44" ry="10" fill="none" stroke="${c.cream}" stroke-width="0.8" opacity="0.6"/>`,
  ].join("");
}
/** След лапки: подушечка и три пальца. */
const paw = (x, y, colour, k = 1) => `<g transform="translate(${x} ${y}) scale(${k})" fill="${colour}"><ellipse cx="0" cy="1.4" rx="2.6" ry="2"/><circle cx="-2.8" cy="-1.4" r="1.1"/><circle cx="0" cy="-2.6" r="1.2"/><circle cx="2.8" cy="-1.4" r="1.1"/></g>`;
/** Миска нарисована у точки (41, 404) и сдвинута к углу, ближе к зрителю: рядом с ней садится Байт. */
const BOWL = Object.freeze({ dx: -3, dy: 5 });
/** Корм в миске. */
const bowlFood = (c) => `<ellipse cx="41" cy="397.4" rx="16.4" ry="3.5" fill="${c.food}"/><g fill="${lt(c.food, 0.22)}"><circle cx="34" cy="396.4" r="1.9"/><circle cx="40" cy="395.6" r="2"/><circle cx="46.4" cy="396.6" r="1.9"/><circle cx="43" cy="398.4" r="1.7"/><circle cx="37" cy="398.6" r="1.7"/></g><g fill="${dk(c.food, 0.2)}"><circle cx="50" cy="398" r="1.5"/><circle cx="31.6" cy="398.2" r="1.4"/></g>`;
function bowl(g, c, full) {
  return [
    shadow(g, 41, 409, 25, 4.4, 0.34),
    `<path d="M21 397 Q22 411 31 411 H51 Q60 411 61 397 Z" fill="${g.lin("bowl", [[0, c.bowl], [1, c.bowlDark]])}"/>`,
    `<ellipse cx="41" cy="397" rx="20" ry="4.8" fill="${c.bowlDark}"/><ellipse cx="41" cy="397" rx="20" ry="4.8" fill="none" stroke="${lt(c.bowl, 0.4)}" stroke-width="1"/>`,
    full
      ? bowlFood(c)
      : `<ellipse cx="41" cy="397.6" rx="16.4" ry="3.4" fill="${dk(c.bowlDark, 0.3)}"/><ellipse cx="38" cy="398.4" rx="8" ry="1.3" fill="#ffffff" opacity="0.14"/>`,
    paw(41, 405, lt(c.bowl, 0.75), 0.9),
    `<path d="M24.6 400 q1 6 4.4 8.4" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" opacity="0.4"/>`,
  ].join("");
}
function catPillow(g, c) {
  return [
    shadow(g, 300, 492, 36, 6, 0.3),
    `<ellipse cx="300" cy="489" rx="33" ry="10.4" fill="${c.pillowDark}"/><ellipse cx="300" cy="486" rx="32" ry="9.4" fill="${g.rad("pillow", [[0, lt(c.pillow, 0.4)], [1, c.pillow]])}"/>`,
    `<path d="M270 487 q30 6.4 60 0" fill="none" stroke="${c.pillowDark}" stroke-width="1"/><g stroke="${c.pillowDark}" stroke-width="0.8" opacity="0.7"><path d="M300 486 l-20 -4 M300 486 l20 -4 M300 486 l-12 6 M300 486 l12 6 M300 486 v-8"/></g><circle cx="300" cy="486" r="2" fill="${c.rugLight}"/>`,
  ].join("");
}
const BOX = Object.freeze({ x: 300, y: 386, w: 60, h: 36 });
function boxBack(c) {
  const { x, y, w } = BOX;
  return `<path d="M${x} ${y + 5} h${w} v10 h-${w}z" fill="${dk(c.boxDark, 0.25)}"/><path d="M${x} ${y + 5} l-9 -8 h16 l5 8z M${x + w} ${y + 5} l9 -8 h-16 l-5 8z" fill="${c.boxDark}"/><path d="M${x - 9} ${y - 3} h16 M${x + w + 9} ${y - 3} h-16" stroke="${lt(c.box, 0.3)}" stroke-width="1"/>`;
}
function boxFront(g, c) {
  const { x, y, w, h } = BOX;
  return [
    shadow(g, x + w / 2, y + h + 1, 36, 4, 0.3),
    `<rect x="${x}" y="${y + 10}" width="${w}" height="${h - 10}" rx="1.5" fill="${g.lin("box", [[0, c.box], [1, c.boxDark]])}"/>`,
    `<rect x="${x + w / 2 - 5}" y="${y + 10}" width="10" height="${h - 10}" fill="${lt(c.box, 0.3)}" opacity="0.7"/><rect x="${x}" y="${y + 10}" width="${w}" height="1.6" fill="${lt(c.box, 0.4)}"/>`,
    paw(x + 14, y + 23, dk(c.boxDark, 0.25), 1.2),
    `<path d="M${x + w - 18} ${y + 28} v-9 l-3.4 3.4 M${x + w - 18} ${y + 19} l3.4 3.4 M${x + w - 9} ${y + 28} v-9 l-3.4 3.4 M${x + w - 9} ${y + 19} l3.4 3.4" fill="none" stroke="${dk(c.boxDark, 0.25)}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  ].join("");
}
function yarn(g, c) {
  const x = 124, y = 480;
  return [
    shadow(g, x + 1, y + 10, 13, 3, 0.34),
    `<path d="M${x + 8} ${y + 7} q9 6 16 0.6 q6 -4.6 12 0.6 q5 4 10 0.4" fill="none" stroke="${c.top}" stroke-width="1.7" stroke-linecap="round"/>`,
    `<circle cx="${x}" cy="${y}" r="10.4" fill="${g.rad("yarn", [[0, lt(c.top, 0.3)], [0.7, c.top], [1, c.topDark]], ' cx="0.36" cy="0.32" r="0.75"')}"/>`,
    `<g fill="none" stroke-linecap="round"><path d="M${x - 9.4} ${y - 3} q9.4 -6.4 18.8 0 M${x - 10} ${y + 2.4} q10 -5 20 0 M${x - 8.4} ${y + 6.4} q8.4 -3 16.8 0" stroke="${lt(c.top, 0.42)}" stroke-width="1" opacity="0.8"/><path d="M${x - 4} ${y - 9.4} q-5 9.4 0 18.8 M${x + 2.4} ${y - 10} q4.4 10 0 20 M${x + 6.6} ${y - 7.6} q3 7.6 0 15" stroke="${c.topDark}" stroke-width="1" opacity="0.7"/></g>`,
  ].join("");
}
function slippers(g, c) {
  const one = (x, y, turn) => `<g transform="rotate(${turn} ${x} ${y})"><ellipse cx="${x}" cy="${y}" rx="12" ry="6" fill="${c.slipperDark}"/><ellipse cx="${x - 1}" cy="${y - 0.6}" rx="9.4" ry="4.2" fill="${lt(c.paper, 0.2)}" opacity="0.75"/><path d="M${x - 1} ${y - 6} q13 -1 13 6 q0 7 -13 6 q4 -6 0 -12z" fill="${c.slipper}"/><path d="M${x + 3} ${y - 4.4} q6 1 6.4 4.4" fill="none" stroke="${lt(c.slipper, 0.5)}" stroke-width="1.2" stroke-linecap="round"/><path d="M${x + 1.4} ${y - 2} l-3 -2 v4z M${x + 1.4} ${y - 2} l3 -2 v4z" fill="${c.top}"/></g>`;
  return shadow(g, 47, 484, 32, 5, 0.26) + one(34, 478, -10) + one(60, 481, 6);
}
const TREE = Object.freeze({ x: 377, y: 500 });
function tree(g, c, part) {
  const on = lit(part);
  const tier = (y, half, tall) => `<path d="M0 ${y} L${half} ${y + tall} q${-half / 4} 5 ${-half / 2} 0 q${-half / 4} 5 ${-half / 2} 0 q${-half / 4} 5 ${-half / 2} 0 q${-half / 4} 5 ${-half / 2} 0 Z" fill="${c.treeGreen}"/><path d="M0 ${y} L${half} ${y + tall} q${-half / 4} 5 ${-half / 2} 0 L0 ${y + tall * 0.5} Z" fill="${c.treeDark}" opacity="0.45"/>`;
  const balls = [[-7, -84, c.red], [9, -70, c.gold], [-13, -52, c.plaidLight], [5, -46, c.red], [17, -34, c.gold], [-21, -22, c.red], [-3, -20, c.plaidLight], [22, -14, c.rugLight]];
  const spots = [[2, -98], [-10, -72], [12, -58], [-4, -60], [-18, -40], [10, -30], [-10, -32], [24, -24], [-26, -12], [6, -10]];
  const lights = spots.map(([x, y], index) => (on
    ? `<g class="bulb b${index % 4}"><circle cx="${x}" cy="${y}" r="9" fill="${g.rad(`bulb${index % BULBS.length}`, [[0, BULBS[index % BULBS.length], 0.8], [0.3, BULBS[index % BULBS.length], 0.34], [1, BULBS[index % BULBS.length], 0]])}"/><circle cx="${x}" cy="${y}" r="1.7" fill="${lt(BULBS[index % BULBS.length], 0.4)}"/></g>`
    : `<circle cx="${x}" cy="${y}" r="1.6" fill="${tint(lt(BULBS[index % BULBS.length], 0.3), part)}"/>`)).join("");
  return at(TREE.x, TREE.y, [
    shadow(g, 0, 1, 30, 5, 0.3),
    `<rect x="-4" y="-24" width="8" height="16" fill="${c.wood}"/><path d="M-14 -11 h28 l-3.4 11 h-21.2z" fill="${c.pot}"/><rect x="-15.4" y="-13.4" width="30.8" height="4.4" rx="1.6" fill="${c.potDark}"/>`,
    tier(-124, 17, 30), tier(-102, 26, 38), tier(-74, 35, 46),
    `<path d="M-11 -88 q11 8 24 2 M-20 -56 q20 12 40 2 M-28 -24 q28 10 56 0" fill="none" stroke="${c.gold}" stroke-width="1" opacity="0.8"/>`,
    balls.map(([x, y, colour]) => `<circle cx="${x}" cy="${y}" r="3.6" fill="${colour}"/><circle cx="${x - 1.2}" cy="${y - 1.2}" r="1.1" fill="#ffffff" opacity="0.7"/>`).join(""),
    lights,
    on ? `<circle cx="0" cy="-128" r="14" fill="${g.rad("treeStar", [[0, "#ffe9a0", 0.8], [1, "#ffe9a0", 0]])}"/>` : "",
    `<path d="M0 -137 l2.7 5.6 6.1 0.7 -4.5 4.2 1.2 6.1 -5.5 -3 -5.5 3 1.2 -6.1 -4.5 -4.2 6.1 -0.7z" fill="${on ? "#ffe08a" : c.gold}"/>`,
  ].join(""));
}

// ── подоконник ───────────────────────────────────────────────────────────────
/** Колючка. Политая — зелёная и цветёт; сухая — тусклая, без цветка. `small` — второй, маленький кактус. */
function cactus(g, c, x, base, wet, small = false) {
  const green = wet ? c.green : c.greenDry, dark = wet ? c.greenDark : dk(c.greenDry, 0.2), pale = lt(green, 0.35);
  if (small) {
    return at(x, base, [
      `<ellipse cx="0" cy="0.4" rx="8" ry="1.6" fill="#1a0f1e" opacity="0.2"/>`,
      `<path d="M-6.4 0 h12.8 l-1.4 -9 h-10z" fill="${c.paper}"/><rect x="-7.4" y="-10.6" width="14.8" height="3" rx="1.2" fill="${c.paperDark}"/>`,
      `<circle cx="0" cy="-15" r="6.6" fill="${c.green}"/><path d="M0 -21.4 v12 M-3.4 -20.4 q-2 5.4 0 11 M3.4 -20.4 q2 5.4 0 11" fill="none" stroke="${c.greenDark}" stroke-width="0.8" opacity="0.7"/>`,
      `<circle cx="-2" cy="-21" r="1.7" fill="${c.gold}"/><circle cx="-2" cy="-21" r="0.7" fill="${c.red}"/>`,
    ].join(""));
  }
  const spines = [[-7, -20], [-7, -30], [7, -22], [7, -34], [0, -43], [-16, -32], [16, -40], [-3.4, -26], [3.4, -36]].map(([sx, sy]) => `M${sx - 1.4} ${sy - 1} l2.8 2 M${sx + 1.4} ${sy - 1} l-2.8 2`).join(" ");
  return at(x, base, [
    `<ellipse cx="0" cy="0.6" rx="14" ry="2.2" fill="#1a0f1e" opacity="0.22"/>`,
    `<ellipse cx="0" cy="-0.6" rx="12.6" ry="2.4" fill="${c.potDark}"/>`,
    `<path d="M-10 -1 h20 l-2.2 -13 h-15.6z" fill="${g.lin("pot", [[0, lt(c.pot, 0.2)], [1, c.potDark]], [0, 0, 1, 0])}"/><rect x="-11.6" y="-17" width="23.2" height="4.6" rx="1.6" fill="${c.pot}"/><rect x="-11.6" y="-17" width="23.2" height="1.4" rx="0.7" fill="${lt(c.pot, 0.35)}"/><ellipse cx="0" cy="-16.4" rx="9" ry="1.6" fill="${wet ? c.soil : c.soilDry}"/>`,
    `<path d="M-7 -27 h-4 q-5 0 -5 -5 v-4" fill="none" stroke="${green}" stroke-width="5.6" stroke-linecap="round"/><path d="M7 -30 h4 q5 0 5 -5 v-7" fill="none" stroke="${green}" stroke-width="5.4" stroke-linecap="round"/>`,
    `<path d="M-7.4 -16 V-36 Q-7.4 -45.4 0 -45.4 Q7.4 -45.4 7.4 -36 V-16 Z" fill="${green}"/><path d="M2 -45 Q7.4 -44 7.4 -36 V-16 H3.4 Z" fill="${dark}" opacity="0.4"/>`,
    `<path d="M0 -45 V-16 M-3.8 -43.6 V-16 M3.8 -43.6 V-16" stroke="${dark}" stroke-width="0.8" opacity="0.65"/><path d="M-5.6 -40 V-20" stroke="${pale}" stroke-width="1.2" stroke-linecap="round" opacity="0.6"/>`,
    `<path d="${spines}" stroke="${lt(c.paper, 0.2)}" stroke-width="0.5" stroke-linecap="round" opacity="0.9"/>`,
    // Политая Колючка цветёт; сухая — нет.
    wet ? `<g transform="translate(0 -47.4)"><g fill="${c.blush}"><circle cx="0" cy="-3" r="2.3"/><circle cx="2.9" cy="-0.9" r="2.3"/><circle cx="1.8" cy="2.4" r="2.3"/><circle cx="-1.8" cy="2.4" r="2.3"/><circle cx="-2.9" cy="-0.9" r="2.3"/></g><circle cx="0" cy="0" r="1.7" fill="${c.gold}"/></g>` : "",
  ].join(""));
}
/** Вторая подушка на подоконнике (вещь «подушка»): левее кресла, у шторы — её видно и когда она в нём сидит. */
function sillPillow(g, c) {
  return at(-8, 0, [
    `<path d="M146 262 Q141 246 146 238 Q166 233 186 238 Q191 246 186 262 Z" fill="${g.lin("sillPillow", [[0, lt(c.plaidLight, 0.3)], [1, c.plaidLight]])}"/>`,
    `<path d="M150 245 Q166 241 182 245 M148.6 252 Q166 248 183.4 252" fill="none" stroke="${c.paper}" stroke-width="1.6" opacity="0.8"/><path d="M146 262 Q141 246 146 238" fill="none" stroke="${c.plaid}" stroke-width="1" opacity="0.5"/>`,
    `<path d="M146 238 l-3 -3 M186 238 l3 -3" stroke="${c.plaid}" stroke-width="1.6" stroke-linecap="round"/>`,
  ].join(""));
}
/** Место на подоконнике рядом с Байтом (вещь «место»): плоская подушечка с лапками. */
function sillSeat(g, c) {
  return `<ellipse cx="290" cy="259.6" rx="20" ry="4.6" fill="${c.rug}"/><ellipse cx="290" cy="257.6" rx="19.4" ry="4.6" fill="${g.lin("sillSeat", [[0, lt(c.rugLight, 0.25)], [1, c.rugLight]])}"/>${paw(282, 257.4, c.paper, 0.6)}${paw(290, 256.4, c.paper, 0.6)}${paw(298, 257.4, c.paper, 0.6)}`;
}

// ── праздники и даты ─────────────────────────────────────────────────────────
/** Огонёк свечи: мерцает тем же правилом, что лампочки гирлянды. */
const flame = (x, y, k = 1) => `<g class="bulb b1"><path d="M${n(x)} ${n(y - 7 * k)} q${n(3 * k)} ${n(4 * k)} 0 ${n(7 * k)} q${n(-3 * k)} ${n(-3 * k)} 0 ${n(-7 * k)}z" fill="#ffb347"/><path d="M${n(x)} ${n(y - 4 * k)} q${n(1.4 * k)} ${n(2 * k)} 0 ${n(3.6 * k)} q${n(-1.4 * k)} ${n(-1.6 * k)} 0 ${n(-3.6 * k)}z" fill="#fff3c4"/></g>`;
/**
 * Торт со свечкой — в день рождения гостя: на столе, у переднего края, между чайником и лампой. До 0.45.0 он стоял
 * на табурете, задвинутом под стол, и рисовался раньше стола: ящик стола закрывал его целиком — слова говорили «на
 * столе торт со свечкой», а на рисунке его не было (день рождения владельца, 19.11.2026). Теперь он рисуется после
 * стола и лампы, а что вещь видна, проверяет `bash scripts/verify.sh seen`.
 */
const CAKE = Object.freeze({ x: 378, y: 320, k: 1.2 });
function cake(g, c) {
  const { x, y, k } = CAKE;
  return [
    `<g transform="translate(${x} ${y}) scale(${k}) translate(${-x} ${-y})">`,
    `<ellipse cx="${x}" cy="${y + 0.8}" rx="15" ry="2.4" fill="#1a0f1e" opacity="0.22"/><ellipse cx="${x}" cy="${y - 0.4}" rx="14" ry="2.6" fill="${c.paper}"/>`,
    `<path d="M${x - 11} ${y - 12} v10.6 q11 3.4 22 0 v-10.6z" fill="${g.lin("cake", [[0, lt(c.rugLight, 0.35)], [1, c.rugLight]])}"/>`,
    `<path d="M${x - 11} ${y - 7} q11 3.2 22 0" fill="none" stroke="${c.paper}" stroke-width="1.6"/>`,
    `<ellipse cx="${x}" cy="${y - 12}" rx="11" ry="3" fill="${c.paper}"/><path d="M${x - 11} ${y - 12} q2.6 5 5.6 1.4 q2.6 4.6 5.4 0.6 q3 4.6 5.6 0.2 q2.4 3.4 5.4 -2.2" fill="${c.paper}"/>`,
    `<circle cx="${x - 6}" cy="${y - 12.6}" r="1.5" fill="${c.bowl}"/><circle cx="${x + 6.4}" cy="${y - 12.2}" r="1.5" fill="${c.bowl}"/>`,
    `<rect x="${x - 1}" y="${y - 20}" width="2" height="7.6" rx="0.6" fill="${c.plaidLight}"/>`,
    `<circle cx="${x}" cy="${y - 23}" r="6.5" fill="#ffd27a" opacity="0.3"/>`,
    flame(x, y - 20, 0.85),
    "</g>",
  ].join("");
}
/** Свеча на полке у рамки — в годовщину знакомства. */
function candle(c) {
  // До 0.45.0 — кремовая свечка шесть на четырнадцать точек на фоне кремовой стены: есть, а не видно.
  return [
    `<ellipse cx="101" cy="268.2" rx="7.6" ry="1.5" fill="#1a0f1e" opacity="0.22"/><ellipse cx="101" cy="267" rx="7" ry="1.8" fill="${c.gold}"/><ellipse cx="101" cy="266.6" rx="5" ry="1.1" fill="${dk(c.gold, 0.25)}"/>`,
    `<circle cx="101" cy="246" r="9" fill="#ffd27a" opacity="0.32"/>`,
    `<rect x="97.4" y="250" width="7.2" height="16.6" rx="1.2" fill="${c.bowl}"/><rect x="97.4" y="250" width="2.4" height="16.6" rx="1.2" fill="#ffffff" opacity="0.35"/><path d="M97.4 252 q3.6 2 7.2 0" fill="none" stroke="${c.paper}" stroke-width="1"/>`,
    `<path d="M101 250 v-2.4" stroke="${c.ink}" stroke-width="0.7"/>`,
    flame(101, 248, 1.15),
  ].join("");
}
/**
 * Фонарь у окна — в Рамадан и оба байрама: медный, со стеклом, висит на цепочке под карнизом, справа. Там его не
 * закрывает ни она, ни Байт; вечером и ночью он светит.
 */
function lantern(g, c, part) {
  const x = 373, y = 112, glass = lit(part) ? "#ffd27a" : "#f6e3b0";
  return [
    lit(part) ? `<circle class="glow" cx="${x}" cy="${y - 16}" r="40" fill="${g.rad("lanternGlow", [[0, "#ffcf7a", 0.46], [1, "#ffcf7a", 0]])}"/>` : "",
    `<path d="M${x} 44 V${y - 36}" stroke="${c.gold}" stroke-width="1" stroke-dasharray="2.4 1.6"/>`,
    `<path d="M${x} ${y - 30} a3 3 0 1 1 0.1 0" fill="none" stroke="${c.gold}" stroke-width="1.1"/>`,
    `<path d="M${x - 3} ${y - 27} q3 -6 6 0z" fill="${c.gold}"/><path d="M${x - 8.4} ${y - 21} h16.8 l-4.4 -6.4 h-8z" fill="${dk(c.gold, 0.12)}"/>`,
    `<path d="M${x - 7.6} ${y - 3} l1.2 -18 h12.8 l1.2 18z" fill="${glass}" opacity="0.94"/>`,
    `<path d="M${x - 7.6} ${y - 3} l1.2 -18 M${x + 7.6} ${y - 3} l-1.2 -18 M${x} ${y - 3} v-18 M${x - 7} ${y - 12} h14" fill="none" stroke="${c.gold}" stroke-width="1.2"/>`,
    `<path d="M${x - 8.4} ${y} h16.8 l-1.8 -3.4 h-13.2z" fill="${c.gold}"/><path d="M${x - 2.4} ${y} q2.4 5 4.8 0z" fill="${dk(c.gold, 0.12)}"/>`,
    flame(x, y - 6, 0.8),
  ].join("");
}

// ── свет поверх комнаты ──────────────────────────────────────────────────────
/** Пятно лампы и гирлянды на стене и столе — под фигурами: это свет на вещах, а не дымка перед ними. */
function lampLight(g, part, shade, off = false) {
  if (!lit(part)) return "";
  // Лампа погашена (0.46.0): светит одна гирлянда — её зарево над окном чуть ярче, тёплого круга у стола нет.
  if (off) return `<ellipse cx="256" cy="46" rx="176" ry="34" fill="${g.rad("garlandGlow", [[0, "#ffd58a", 0.3], [1, "#ffd58a", 0]])}"/>`;
  const warm = mix(shade, "#ffd9a0", 0.4);
  return [
    `<circle class="glow" cx="${LAMP.x}" cy="${LAMP.y + 2}" r="${part === "ночь" ? 128 : 112}" fill="${g.rad("lampGlow", [[0, warm, 0.62], [0.32, warm, 0.26], [1, warm, 0]])}"/>`,
    `<ellipse cx="366" cy="319" rx="42" ry="4.6" fill="#ffe9b8" opacity="0.4"/>`,
    `<ellipse cx="256" cy="46" rx="176" ry="34" fill="${g.rad("garlandGlow", [[0, "#ffd58a", 0.2], [1, "#ffd58a", 0]])}"/>`,
  ].join("");
}
const AIR_HOLE = `M${WIN.x} ${WIN.y}V${WIN.y + WIN.h}H${WIN.x + WIN.w}V${WIN.y}Z`;
/** Вечерняя и ночная тень комнаты: темнее к углам, светлее у лампы. Одна заливка — и для комнаты, и для неё у окна. */
function duskFill(g, part, off = false) {
  const depth = part === "ночь" ? 0.46 : 0.38;
  // Лампа погашена (0.46.0): светлее всего под гирляндой, у окна; к полу и углам — темнее обычного.
  if (off) return g.rad("dusk", [[0, "#0e0a2c", depth * 0.55], [0.45, "#0e0a2c", depth * 0.95], [1, "#0e0a2c", depth + 0.14]], ' gradientUnits="userSpaceOnUse" cx="256" cy="50" r="480"');
  return g.rad("dusk", [[0, "#0e0a2c", 0], [0.24, "#0e0a2c", depth * 0.2], [0.6, "#0e0a2c", depth * 0.7], [1, "#0e0a2c", depth]], ` gradientUnits="userSpaceOnUse" cx="${LAMP.x}" cy="${LAMP.y + 10}" r="420"`);
}
/** Последний слой картинки: мягкая тень по углам; окно она не трогает. */
function airLight(g, part, off = false) {
  if (!lit(part)) {
    return `<path fill="${g.rad("dayShade", [[0, "#1a0f1e", 0], [0.6, "#1a0f1e", 0], [1, "#1a0f1e", 0.2]], ' gradientUnits="userSpaceOnUse" cx="256" cy="210" r="400"')}" fill-rule="evenodd" d="M0 0H400V520H0Z ${AIR_HOLE}"/>`;
  }
  return `<path fill="${duskFill(g, part, off)}" fill-rule="evenodd" d="M0 0H400V520H0Z ${AIR_HOLE}"/>`;
}
/**
 * Она стоит перед окном, а не за стеклом: вечерняя тень комнаты ложится и на ту её часть, что видна на фоне окна.
 * Без этого по светлому свитеру шла бы ровная полоса по линии подоконника — выше неё тени нет (окно «дырой»).
 * Маской служит её же картинка (`r-herMask`): тень ложится только на неё, город за стеклом остаётся ярким.
 */
const airOn = (g, part, off, mask) => (lit(part) ? `<path fill="${duskFill(g, part, off)}" d="${AIR_HOLE}" mask="url(#${g.id(mask)})"/>` : "");
const airOnHer = (g, part, off = false) => airOn(g, part, off, "herMask");
/**
 * Тень на ней при смене позы (0.46.0) появляется и уходит вместе с ней самой. Раньше тень новой позы ложилась на окно
 * сразу — тёмным силуэтом там, куда она ещё не дошла, — а прежняя поза таяла без тени, с полосой по линии подоконника.
 * `she.enter` — как проявляется новая поза (открывающий тег её группы), `she.left` — прежняя поза тает на рисунке.
 */
const airOnHerMoving = (g, part, off, she) => (lit(part) ? [
  she.painted ? (she.enter ? `${she.enter}${airOnHer(g, part, off)}</g>` : airOnHer(g, part, off)) : "",
  she.left ? `<g class="leave">${airOn(g, part, off, "herMaskWas")}</g>` : "",
].join("") : "");
/**
 * То же — пока она идёт (0.46.0): без этого вечером по свитеру идущей шла та самая полоса по линии подоконника. Маска —
 * её силуэт в пути (`herWalking`, `shape`): группы и классы те же, что у картинки «идёт», и стили страницы двигают
 * их одинаково — шаг, кадры, путь. Маска не шире окна: тень вне окна ложится общим слоем.
 */
const airOnWalker = (g, part, off, shape) => (lit(part) && shape
  ? `<mask id="${g.id("herAirWalk")}" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="${WIN.x}" y="${WIN.y}" width="${WIN.w}" height="${WIN.h}">${shape}</mask><path fill="${duskFill(g, part, off)}" d="${AIR_HOLE}" mask="url(#${g.id("herAirWalk")})"/>`
  : "");
/**
 * Свет на полу: днём — от окна, вечером и ночью — тёплое пятно под лампой и синева от окна. Ложится на пол до
 * мебели и фигур: поверх них у света был бы край, и ноги ниже плинтуса выглядели бы выцветшими.
 */
function floorLight(g, part, shade, sky = "rain", off = false, painted = false) {
  // Комната картинкой (0.53.0): свет на полу написан художником, а мебель стоит на той же картинке — пятно света
  // кодом легло бы и на кресло со столом, ровным краем по линии плинтуса.
  if (painted) return "";
  if (!lit(part)) {
    // В ясный день на полу лежит солнце — три полосы по створкам окна; под тучами — ровный серый свет.
    const sunny = open(sky), sun = part === "утро" ? (sunny ? "#ffe6c0" : "#fff0dc") : sunny ? "#fff6dc" : "#ffffff";
    const panes = sunny ? `<g fill="${g.lin("sunFloor", [[0, sun, 0.34], [1, sun, 0]])}"><path d="M150 372 h74 l-44 148 h-92z"/><path d="M236 372 h76 l-30 148 h-88z"/><path d="M324 372 h66 l-14 148 h-80z"/></g>` : "";
    return `<path d="M132 372 H400 V470 L356 520 H30 Z" fill="${g.lin("dayFloor", [[0, sun, sky === "fog" || sky === "storm" ? 0.1 : 0.2], [1, sun, 0]])}"/>${panes}`;
  }
  const warm = mix(shade, "#ffd9a0", 0.4);
  // Ясной ночью от окна на пол ложится лунный свет: чуть ярче обычной синевы.
  const blue = part === "ночь" ? (open(sky) ? 0.17 : 0.1) : 0.07;
  return [
    off ? "" : `<ellipse cx="352" cy="404" rx="96" ry="26" fill="${g.rad("lampFloor", [[0, warm, 0.2], [1, warm, 0]])}"/>`,
    `<path d="M132 372 H400 L352 520 H30 Z" fill="${g.lin("nightFloor", [[0, "#9fb4ff", blue], [1, "#9fb4ff", 0]])}"/>`,
  ].join("");
}

// ── комната картинкой (0.53.0, идея 202) ─────────────────────────────────────
/**
 * Комната, написанная художником по эскизу, который выбрал владелец (`miniapp/room/day.js`, собирает
 * `scripts/room-paint.mjs`): стены, пол, окно с рамой и шторами, мебель — одной картинкой с прозрачным стеклом;
 * вещи, которые в комнате бывают и не бывают, вырезаны отдельно и встают на свои места. Всё живое — небо и погода
 * за стеклом, свет часа, она, Байт, пар над чайником, огни гирлянды — остаётся кодом, в прежнем порядке слоёв.
 * Картинки нет (ещё в пути, телефон её не показывает) — комната рисуется кодом, как до 0.53.0.
 */
const ROOM_THINGS = Object.freeze(["рисунок", "календарь", "снимок", "подушка", "кружка", "место", "кресло", "плед", "plant", "кактус", "lamp", "stool", "тапочки", "bed", "boxFront"]);
const roomChecked = new WeakMap();
function fitsRoom(room) {
  if (!room || typeof room !== "object") return false;
  if (roomChecked.has(room)) return roomChecked.get(room);
  const things = room.things, cells = things?.at;
  const fine = room.v === 1 && typeof room.name === "string" && /^[a-z]+$/u.test(room.name) && typeof room.src === "string" && SPRITE_SRC.test(room.src)
    && Boolean(things) && typeof things === "object" && [things.w, things.h].every(size => Number.isFinite(size) && size > 0) && typeof things.src === "string" && SPRITE_SRC.test(things.src)
    && Boolean(cells) && typeof cells === "object" && ROOM_THINGS.every(name => Array.isArray(cells[name]) && cells[name].length === 8 && cells[name].every(Number.isFinite) && [2, 3, 6, 7].every(index => cells[name][index] > 0))
    && Array.isArray(room.bulbs) && room.bulbs.every(bulb => Array.isArray(bulb) && Number.isFinite(bulb[0]) && Number.isFinite(bulb[1]) && /^#[0-9a-f]{6}$/iu.test(String(bulb[2])));
  roomChecked.set(room, fine);
  return fine;
}
/**
 * Картинок комнаты две: «день» — с солнцем на полу, «пасмурно» — с ровным светом. Под тучами, в дождь, снег и туман
 * солнечные полосы на полу были бы неправдой: слова о погоде и рисунок — одно. Ясной ночью полосы от окна — лунные.
 */
export const roomNameOf = (view) => (open(skyIn(view?.sky)) ? "day" : "dull");
/** Картинка комнаты из настроек рисунка (`options.room`) — или `null`: негодную рисунок не примет. */
export const roomOf = (options) => (fitsRoom(options?.room) ? options.room : null);
/**
 * Определения картинок комнаты: сама комната и лист вещей. Как и её картинка (`drawSprite`), на странице они
 * кладутся в рисунок один раз, а комната только ссылается на них по имени.
 */
export function drawPicture(room) {
  if (!fitsRoom(room)) return "";
  return `<image id="r-room-${room.name}" width="${WIDTH}" height="${HEIGHT}" preserveAspectRatio="none" href="${room.src}"/><image id="r-room-${room.name}-things" width="${n(room.things.w)}" height="${n(room.things.h)}" preserveAspectRatio="none" href="${room.things.src}"/>`;
}
/**
 * Свет часа на картинке: заливка поверх неё, маской служит она сама (как у её картинки — `spriteLit`). Цвет и
 * плотность подобраны так, чтобы стена выходила того же тона, что у комнаты кодом (`LIGHT`). Днём — без заливки.
 */
const ROOM_TINT = Object.freeze({ "утро": ["#b57e71", 0.1], "вечер": ["#280046", 0.36], "ночь": ["#000046", 0.47] });
const roomTint = (part) => ROOM_TINT[part] ?? null;
/**
 * Подгонка под картинку: то, что код рисует поверх неё, стоит на её полках и в её миске. `top` — верх шкафа (Байт
 * и подарки), `candle` — вторая полка, `speaker` — колонка, `bowl` — миска, `plaid` — малый плед (у кого нет
 * «пледа на двоих»), `shade` — абажур лампы (для «абажура любимого цвета»).
 */
const PIC = Object.freeze({
  top: -6, candle: -8, speaker: [1, -7], bowl: [-3.5, 2], shade: "M376.5 260 L395.5 260 L400 288.5 L369 288.5 Z",
  // Малый плед: тот же, но обрезан выше — по линии, вдоль которой у большого идёт бахрома; бахрому дорисовывает код.
  plaid: { clip: "M220 240 H312 V330 L256 349 H220 Z", fringe: [[258, 348], [264, 346], [270, 344], [276, 342], [282, 340], [288, 338], [294, 336], [300, 334], [306, 332]] },
});
/** Сама комната: картинка, свет часа на ней и — вечером и ночью — тень в проёме окна (рама и шторы; стекло чистое). */
function paintedRoom(g, room, part, off = false) {
  const picture = `<use href="#r-room-${room.name}"/>`, tint = roomTint(part);
  if (!tint && !lit(part)) return picture;
  const mask = g.raw(`roomMask-${room.name}`, id => `<mask id="${id}" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="${WIDTH}" height="${HEIGHT}">${picture}</mask>`);
  return [
    picture,
    tint ? `<rect width="${WIDTH}" height="${HEIGHT}" fill="${tint[0]}" opacity="${tint[1]}" mask="${mask}"/>` : "",
    // Общая тень комнаты (`airLight`) окно обходит прямоугольником — а рама и шторы внутри него тоже в комнате.
    lit(part) ? `<path fill="${duskFill(g, part, off)}" d="${AIR_HOLE}" mask="${mask}"/>` : "",
  ].join("");
}
/**
 * Вещь с листа — на своём месте. `dx`, `dy` — сдвиг (лежанка Байта отодвинута), `k` — мельче, от верхнего края
 * (малый плед), `glow` — свет часа на неё не ложится (лампа горит).
 */
function paintedThing(g, room, name, part, { dx = 0, dy = 0, k = 1, glow = false } = {}) {
  const [ax, ay, aw, ah, x, y, w, h] = room.things.at[name];
  const box = `x="${n(x + dx + (w - w * k) / 2)}" y="${n(y + dy)}" width="${n(w * k)}" height="${n(h * k)}"`;
  const picture = `<svg ${box} viewBox="${ax} ${ay} ${aw} ${ah}" preserveAspectRatio="none"><use href="#r-room-${room.name}-things"/></svg>`;
  const tint = glow ? null : roomTint(part);
  if (!tint) return picture;
  const mask = g.raw(`thing-${room.name}-${ROOM_THINGS.indexOf(name)}`, id => `<mask id="${id}" style="mask-type:alpha" maskUnits="userSpaceOnUse" ${box}>${picture}</mask>`);
  return `${picture}<rect ${box} fill="${tint[0]}" opacity="${tint[1]}" mask="${mask}"/>`;
}
/**
 * Шторы у открытого окна ходят от сквозняка (0.49.0), а на картинке они написаны неподвижными. Поэтому поверх каждой
 * ходит её же копия — кусок той же картинки (`.breeze`, стили страницы): край шторы дышит, складки и гирлянда на ней
 * чуть скользят. Свет часа и тень проёма ложатся на копию так же, как на саму комнату. Окно закрыто — копий нет.
 */
const PIC_CURTAINS = Object.freeze([[110, 46, 62, 226], [350, 46, 50, 226]]);
function paintedCurtains(g, room, part, off = false) {
  const tint = roomTint(part);
  return PIC_CURTAINS.map(([x, y, w, h], index) => {
    const box = `x="${x}" y="${y}" width="${w}" height="${h}"`;
    const picture = `<svg ${box} viewBox="${x} ${y} ${w} ${h}"><use href="#r-room-${room.name}"/></svg>`;
    const mask = tint || lit(part) ? g.raw(`curtain-${room.name}-${index}`, id => `<mask id="${id}" style="mask-type:alpha" maskUnits="userSpaceOnUse" ${box}>${picture}</mask>`) : "";
    // Низ копии тает (последние двадцать точек): штора кончается у подоконника, а ниже — стена с панелями, и ровный
    // срез ходил бы по ней заметной полосой.
    const fade = g.raw(`curtainFade${index}`, id => `<mask id="${id}" maskUnits="userSpaceOnUse" ${box}><rect ${box} fill="${g.lin("curtainEnd", [[0, "#ffffff"], [0.91, "#ffffff"], [1, "#000000"]])}"/></mask>`);
    return [
      `<g class="breeze${index ? " b1" : ""}" mask="${fade}">`, picture,
      tint ? `<rect ${box} fill="${tint[0]}" opacity="${tint[1]}" mask="${mask}"/>` : "",
      lit(part) ? `<path fill="${duskFill(g, part, off)}" d="${AIR_HOLE}" mask="${mask}"/>` : "",
      `</g>`,
    ].join("");
  }).join("");
}
/**
 * Плед на кресле. «Плед на двоих» (вещь человека) — как написан; без него на кресле малый плед: тот же, но короче
 * (по масштабу его не уменьшить — он лежит по контуру кресла и «отклеился» бы от него).
 */
function paintedPlaid(g, room, part, big) {
  const picture = paintedThing(g, room, "плед", part);
  if (big) return picture;
  const clip = g.raw("plaidCut", id => `<clipPath id="${id}"><path d="${PIC.plaid.clip}"/></clipPath>`);
  return `<g clip-path="${clip}">${picture}</g><path d="${PIC.plaid.fringe.map(([x, y]) => `M${x} ${y} l-0.8 6`).join(" ")}" fill="none" stroke="${tint("#f3e7d3", part)}" stroke-width="1.3" stroke-linecap="round" opacity="0.92"/>`;
}
/**
 * Огни гирлянды: лампочки на картинке написаны, код зажигает над ними свет — вечером и ночью, в лад со стилями
 * страницы (`.bulb`). Сценка «гирлянда замигала» — одна лампочка горит и днём (`.rogue`).
 */
function paintedGarland(g, room, part, rogue = false) {
  return room.bulbs.map(([x, y, colour], index) => {
    if (rogue && index === ROGUE_BULB) return `<g class="bulb rogue"><circle cx="${n(x)}" cy="${n(y)}" r="15" fill="${g.rad("bulbRogue", [[0, "#fff3c4", 0.95], [0.3, "#ffd97a", 0.5], [1, "#ffd97a", 0]])}"/><ellipse cx="${n(x)}" cy="${n(y)}" rx="1.9" ry="2.8" fill="#fff6d8"/><circle cx="${n(x)}" cy="${n(y)}" r="1.2" fill="#ffffff"/></g>`;
    if (!lit(part)) return "";
    return `<g class="bulb b${index % 4}"><circle cx="${n(x)}" cy="${n(y)}" r="12" fill="${g.rad(`glow${colour.slice(1)}`, [[0, colour, 0.8], [0.3, colour, 0.34], [1, colour, 0]])}"/><ellipse cx="${n(x)}" cy="${n(y)}" rx="1.7" ry="2.6" fill="${lt(colour, 0.45)}"/><circle cx="${n(x)}" cy="${n(y)}" r="1" fill="#ffffff"/></g>`;
  }).join("");
}
/** На полках: рамка с первым разговором и вторая кружка — если они у человека есть; колонка играет — ноты. */
function paintedShelves(g, c, room, has, part, music = false) {
  return [
    has("снимок") ? paintedThing(g, room, "снимок", part) : "",
    has("кружка") ? paintedThing(g, room, "кружка", part) : "",
    at(PIC.speaker[0], PIC.speaker[1], speakerTune(c, part, music)),
  ].join("");
}
/**
 * Лампа с листа: горит — свет часа на неё не ложится. «Абажур любимого цвета» — его цвет поверх написанного абажура
 * (`own`); лампу погасили нажатием — она темнеет вместе с комнатой.
 */
function paintedLamp(g, room, part, shade, off = false, own = false) {
  const on = lit(part) && !off;
  return paintedThing(g, room, "lamp", part, { glow: on }) + (own ? `<path d="${PIC.shade}" fill="${on ? shade : tint(shade, part)}" opacity="0.6"/>` : "");
}

// ── что сценка дня изменила в комнате ────────────────────────────────────────
// Слова сценки и рисунок — одно (0.44.0): «Байт уронил Колючку», «в комнате туман», «окно открыто», «шторы
// задёрнуты» — видны, а не только сказаны. Сердце называет, что показать (`view.fx`, имена — `SCENE_FX`).
const fxIn = (view) => new Set((Array.isArray(view?.fx) ? view.fx : []).filter(name => SCENE_FX.includes(name)));
/** Открытая створка: распахнута в комнату, петли слева; ближний край — крупнее и чуть ниже. */
function sashOpen(c) {
  const { x, y, h } = SASH, far = [x + 31, y - 7, y + h + 9];
  return [
    `<path d="M${x + 1} ${y + 2} L${far[0]} ${far[1]} V${far[2]} L${x + 1} ${y + h} Z" fill="#ffffff" fill-opacity="0.16" stroke="${c.frame}" stroke-width="4.4" stroke-linejoin="round"/>`,
    `<path d="M${x + 1} ${y + 2} L${far[0]} ${far[1]} V${far[2]} L${x + 1} ${y + h} Z" fill="none" stroke="${c.frameDark}" stroke-width="0.8" stroke-linejoin="round" opacity="0.7"/>`,
    `<path d="M${x + 9} ${y + 16} L${x + 23} ${y + 10} V${y + 70} L${x + 9} ${y + 62} Z" fill="#ffffff" opacity="0.2"/>`,
    // Ручка на ближнем краю.
    `<rect x="${far[0] - 1.4}" y="${y + 78}" width="2.8" height="13" rx="1.4" fill="${c.metal}"/>`,
  ].join("");
}
/** Задёрнутые шторы: два полотна закрывают окно целиком; гирлянда остаётся поверх. */
function curtainsShut(c) {
  const top = 29, bottom = 268, left = 100, right = 402;
  let hem = `M${left} ${top} H${right} V${bottom}`;
  for (let x = right; x > left; x -= 10.07) hem += " q-5.03 4.4 -10.07 0";
  const folds = [];
  for (let x = left + 8; x < right - 4; x += 13) {
    folds.push(`<path d="M${x} ${top + 1} C${x + 2.4} ${top + 80} ${x - 2.4} ${bottom - 80} ${x} ${bottom - 3}" stroke="${c.curtainDark}" stroke-width="2.3" opacity="0.5"/>`);
    folds.push(`<path d="M${x + 6} ${top + 2} C${x + 8.4} ${top + 80} ${x + 3.6} ${bottom - 80} ${x + 6} ${bottom - 4}" stroke="${lt(c.curtain, 0.7)}" stroke-width="1.5" opacity="0.55"/>`);
  }
  const rings = Array.from({ length: 30 }, (_, index) => `<ellipse cx="${104 + index * 10}" cy="27.5" rx="1.5" ry="2.7" fill="none" stroke="${c.rod}" stroke-width="0.9"/>`).join("");
  return `<path d="${hem} Z" fill="${c.curtain}"/><g fill="none" stroke-linecap="round">${folds.join("")}</g><path d="M256 ${top} V${bottom - 2}" stroke="${c.curtainDark}" stroke-width="1.8" opacity="0.75"/>${rings}`;
}
/** Туман от выкипевшего чайника: белёсая пелена и клубы, которые медленно плывут (стили страницы: `.mist`). */
function haze(g, part) {
  const ink = lit(part) ? "#c9cdea" : "#ffffff";
  const puff = g.rad("mist", [[0, ink, 0.62], [0.6, ink, 0.3], [1, ink, 0]]);
  const clouds = [[70, 150, 120, 60, "m0"], [300, 210, 140, 70, "m1"], [170, 330, 160, 66, "m2"], [330, 420, 120, 56, "m0"], [60, 440, 110, 50, "m1"], [220, 90, 130, 50, "m2"]];
  return `<g><rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="${ink}" opacity="0.2"/>${clouds.map(([x, y, rx, ry, cls]) => `<ellipse class="mist ${cls}" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${puff}"/>`).join("")}</g>`;
}
/** Носок неизвестного происхождения — добыча Байта: лежит на полу рядом с ним. */
function sock(c, x, y) {
  return at(x, y, [
    `<ellipse cx="4" cy="1" rx="12" ry="2.2" fill="#1a0f1e" opacity="0.2"/>`,
    `<path d="M-5 -15 h8 v8.6 q0 2.6 3 3.2 l5.4 1 q3.6 0.8 3.6 3.6 q0 2.6 -3.6 2.6 h-12 q-4.4 0 -4.4 -4.6z" fill="${c.paper}" stroke="${c.paperDark}" stroke-width="0.7" stroke-linejoin="round"/>`,
    `<path d="M-5 -15 h8 v3.4 h-8z" fill="${c.red}"/><path d="M-5 -9.4 h8" stroke="${c.red}" stroke-width="1.2"/><path d="M10.4 -2 q4 0.6 4.6 3.4 q0 2.6 -3.6 2.6 h-2.2 q2.4 -2.4 1.2 -6z" fill="${c.red}"/>`,
  ].join(""), " rotate(-14)");
}
/** Лужа на подоконнике — левее Колючки; капля стекает с края. */
const PUDDLE = Object.freeze({ x: 304, y: 267 });
function puddle() {
  const { x, y } = PUDDLE;
  return [
    `<path d="M${x - 22} ${y + 0.6} q3 -4.2 13 -3.6 q7 -1.8 15 -0.2 q13 -0.4 16 3.4 q-1 4 -14 3.4 q-9 2 -17 0.2 q-11 0.2 -13 -3.2z" fill="#6fb2e6" opacity="0.72"/>`,
    `<path d="M${x - 14} ${y - 1} q8 -2 18 -1.2" fill="none" stroke="#ffffff" stroke-width="1.1" stroke-linecap="round" opacity="0.8"/>`,
    `<path class="slide s1" d="M${x + 6} ${y + 5} q2.4 3.4 0 5.6 q-2.4 -2.2 0 -5.6z" fill="#6fb2e6" opacity="0.8"/>`,
  ].join("");
}
/** Кораблик из записки — плывёт по луже к Колючке (стили страницы: `.float`). */
function boat(c) {
  const { x, y } = PUDDLE;
  return `<g class="float">${at(x + 4, y - 1, `<path d="M-9 -1 h18 l-4.4 4.6 h-9.2z" fill="${c.paper}" stroke="${c.paperDark}" stroke-width="0.6" stroke-linejoin="round"/><path d="M0 -11 l6.4 9.4 h-12.8z" fill="#ffffff" stroke="${c.paperDark}" stroke-width="0.6" stroke-linejoin="round"/><path d="M0 -11 v9.4" stroke="${c.paperDark}" stroke-width="0.5"/>`)}</g>`;
}
/** Колючка на полу: Байт уронил её с подоконника. Лежит на боку у правого края ковра, земля рассыпана. */
const FALLEN = Object.freeze({ x: 352, y: 456, zone: [300, 428, 62, 34] });
function cactusFallen(g, c, wet) {
  const soil = wet ? c.soil : c.soilDry;
  return [
    `<ellipse cx="${FALLEN.x - 20}" cy="${FALLEN.y + 2}" rx="32" ry="4" fill="#1a0f1e" opacity="0.2"/>`,
    `<g fill="${soil}"><ellipse cx="${FALLEN.x - 14}" cy="${FALLEN.y + 1.6}" rx="9" ry="2.2"/><circle cx="${FALLEN.x - 27}" cy="${FALLEN.y + 2.6}" r="1.5"/><circle cx="${FALLEN.x - 4}" cy="${FALLEN.y + 4}" r="1.3"/><circle cx="${FALLEN.x - 21}" cy="${FALLEN.y + 5}" r="1.1"/><circle cx="${FALLEN.x + 6}" cy="${FALLEN.y + 2.4}" r="1"/></g>`,
    at(FALLEN.x, FALLEN.y - 12, cactus(g, c, 0, 0, wet).replace(/<ellipse cx="0" cy="0\.6"[^>]*\/>/u, ""), " rotate(-78)"),
    // На подоконнике, где она стояла, — крошки земли.
    `<g fill="${soil}" opacity="0.85"><ellipse cx="${PLANT.x}" cy="262.6" rx="7" ry="1.2"/><circle cx="${PLANT.x - 10}" cy="263" r="0.9"/><circle cx="${PLANT.x + 9}" cy="262.4" r="0.8"/></g>`,
  ].join("");
}
/** Пылинки в солнечном свете: в ясный день плывут над полом (стили страницы: `.mote`). */
function motes(part, sky) {
  if (lit(part) || !open(sky)) return "";
  const dots = [[168, 396, 1.1, 0], [204, 430, 0.9, 1], [246, 388, 1.2, 2], [286, 446, 0.8, 0], [322, 404, 1, 1], [150, 462, 0.9, 2], [262, 474, 1.1, 0], [338, 458, 0.8, 1], [226, 352, 0.9, 2], [300, 330, 0.8, 0]];
  return `<g fill="#fff8e0">${dots.map(([x, y, r, cls]) => `<circle class="mote o${cls}" cx="${x}" cy="${y}" r="${r}" opacity="0.7"/>`).join("")}</g>`;
}

// ── слои рисунка ─────────────────────────────────────────────────────────────
const partIn = (view) => (PARTS.includes(view?.part) ? view.part : "день");
/**
 * Каким светом красить рисунок (0.47.0, идея 164): `view.light` — свет по солнцу города, когда он разошёлся с
 * часами; нет его — свет по часам (`view.part`). Небо, стены, лампа, гирлянда и она сама красятся светом; наряд
 * (`wearOf`) — по часам: в июне в десять вечера за окном день, а она уже в свитере.
 */
export const lightIn = (view) => (PARTS.includes(view?.light) ? view.light : partIn(view));
/** Краски под час. `soft` — насколько слабее приглушать (для неё и Байта). */
const palette = (part, soft = 0) => Object.fromEntries(Object.entries(DAY).map(([name, colour]) => [name, tint(colour, part, soft)]));

/**
 * За окном: небо и город. Зависит от часа и погоды — страница рисует это один раз и при нажатиях не трогает.
 * `options.phase` — фаза луны (доля лунного месяца); `options.prefix` — приставка имён слоя: когда час или погода
 * сменяются при открытой странице, прежнее небо тает поверх нового, и имена у двух слоёв должны быть разными.
 */
export function drawBackdrop(part, sky = "rain", options = {}) {
  const name = partIn({ part }), weather = skyIn(sky);
  const g = inks(typeof options?.prefix === "string" && /^[a-z]-$/u.test(options.prefix) ? options.prefix : "s-");
  const body = outside(g, name, weather, Number.isFinite(options?.phase) ? options.phase : 0.3);
  // Снег: сугроб на наружном подоконнике и белые шапки на крышах — лёгкой дымкой у нижнего края стекла.
  const drift = weather === "snow" ? `<g><path d="M${WIN.x} ${WIN.y + WIN.h} v-9 q22 -8 46 -3 t52 -1 t58 2 t54 -3 t54 3 v11z" fill="${lit(name) ? "#c9d2ea" : "#f4f7fb"}"/><path d="M${WIN.x} ${WIN.y + WIN.h - 44} h${WIN.w} v34 h-${WIN.w}z" fill="${g.lin("snowHaze", [[0, "#ffffff", 0], [1, "#ffffff", lit(name) ? 0.1 : 0.22]])}"/></g>` : "";
  return `<g class="backdrop" pointer-events="none">${g.defs()}${body}${drift}</g>`;
}
/** Фаза луны на этот день: доля лунного месяца (0 — новолуние, 0,5 — полнолуние). `day` — «2026-11-19» или момент времени. */
export function moonPhase(day) {
  const at = typeof day === "number" ? day : Date.parse(`${String(day).slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(at)) return 0.3;
  const age = (at - Date.UTC(2000, 0, 6, 18, 14)) / (29.530588853 * 86_400_000);
  return age - Math.floor(age);
}

/**
 * Снег: два плана хлопьев. Узор повторяется через шаг `fall` по высоте и `drift` по ширине, поэтому слой, съехав на
 * один шаг вниз и влево, совпадает сам с собой — как у дождя. `size` — радиус хлопьев, `seconds` — время оборота.
 */
const SNOW = Object.freeze({ far: { fall: 54.5, drift: 12, size: 1.1, seconds: 7.5, count: 9 }, near: { fall: 72.6667, drift: 22, size: 1.8, seconds: 5, count: 7 } });
/** На сколько страница сдвигает слой снега за оборот: те же числа записаны в её стилях (`snow-far`, `snow-near`). */
export const SNOW_SHIFT = Object.freeze(Object.fromEntries(Object.entries(SNOW).map(([name, { fall, drift, seconds }]) => [name, Object.freeze({ x: -drift / WIN.w * 100, y: fall / WIN.h * 100, seconds })])));
function snowFlakes(name) {
  const { fall, drift, size, count } = SNOW[name], rows = Math.ceil(WIN.h / fall) + 2, dots = [];
  // Места в одном шаге узора — по золотому сечению: ровно, но не строем.
  for (let index = 0; index < count; index += 1) {
    const x = (index * 0.618034 + (name === "near" ? 0.37 : 0)) % 1 * (WIN.w + rows * drift), y = (index * 0.754878 + 0.13) % 1 * fall, r = size * (0.7 + (index % 3) * 0.25);
    for (let row = -1; row < rows; row += 1) dots.push(`<circle cx="${n(x - row * drift)}" cy="${n(y + row * fall)}" r="${n(r)}"/>`);
  }
  return dots.join("");
}

/**
 * Дождь: два плана струй в координатах стекла (0, 0 — левый верхний угол окна, размер — `WIN.w` × `WIN.h`).
 * На странице каждый план — свой слой, который целиком съезжает вниз и влево и начинает сначала: комната над ним
 * при этом не перерисовывается. `plane` — "far" или "near"; без него — оба плана разом.
 */
export function drawRain(part, plane, sky = "rain") {
  const name = partIn({ part }), weather = skyIn(sky);
  const planes = plane === "far" || plane === "near" ? [plane] : ["far", "near"];
  // В сухую погоду слои пусты: с неба ничего не падает.
  if (!wet(weather) && weather !== "snow") return "";
  // Снег — когда он идёт в городе человека (так говорит сердце): хлопья вместо струй, в тех же двух слоях.
  if (weather === "snow") return planes.map(key => `<g class="snow ${key}" pointer-events="none" fill="#ffffff" fill-opacity="${key === "near" ? (lit(name) ? 0.8 : 0.95) : (lit(name) ? 0.5 : 0.75)}">${snowFlakes(key)}</g>`).join("");
  return planes.map(key => `<g class="rain ${key}" pointer-events="none" ${rainInk(name, key)}>${rainLines(key)}</g>`).join("");
}

// ── Аи ───────────────────────────────────────────────────────────────────────
// Облик — по картинке профиля: длинные прямые чёрные волосы, ровная чёлка и пряди у щёк, алые глаза, чокер с
// колечком, красный топ с открытыми плечами, чёрная куртка, съехавшая на локти. Ростом она — в две пятых рисунка:
// на телефоне видно лицо. Голова крупнее, чем у живого человека, — так рисуют героев в играх про уютные комнаты.

/** Сужающаяся часть руки или ноги: от точки (x1, y1) шириной w1 до точки (x2, y2) шириной w2, с круглыми концами. */
function taper(x1, y1, w1, x2, y2, w2, fill) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  const a = w1 / 2, b = w2 / 2;
  return `<path d="M${n(x1 + nx * a)} ${n(y1 + ny * a)} L${n(x2 + nx * b)} ${n(y2 + ny * b)} A${n(b)} ${n(b)} 0 0 0 ${n(x2 - nx * b)} ${n(y2 - ny * b)} L${n(x1 - nx * a)} ${n(y1 - ny * a)} A${n(a)} ${n(a)} 0 0 0 ${n(x1 + nx * a)} ${n(y1 + ny * a)}Z" fill="${fill}"/>`;
}
const along = ([x1, y1], [x2, y2], share) => [x1 + (x2 - x1) * share, y1 + (y2 - y1) * share];

/** Волосы за спиной: `long` — на сколько ниже центра лица они спускаются, `lean` — куда уходят концы. */
function hairBack(f, long = 96, lean = 0) {
  const b = long, x = lean;
  const edge = [[26.6, -5], [21.4, -1], [19.4, -4.4], [10.6, 0], [8.6, -3.6], [-1, 1], [-3, -3.6], [-12.6, 0], [-14.6, -4.4], [-21.4, -1], [-26.6, -5]].map(([px, py]) => `L${n(px + x)} ${n(b + py)}`).join(" ");
  const strands = [-18, -8.6, 2, 11.6, 20].map(sx => `M${sx} 22 Q${n(sx + x * 0.4 + 1)} ${n(b * 0.6)} ${n(sx + x)} ${n(b - 9)}`).join(" ");
  return [
    `<path d="M-24.6 -5 C-24.6 -20 -13.6 -32.4 0 -32.4 C13.6 -32.4 24.6 -20 24.6 -5 C26 24 ${n(27.4 + x)} ${n(b - 34)} ${n(26.6 + x)} ${n(b - 5)} ${edge} C${n(-27.4 + x)} ${n(b - 34)} -26 24 -24.6 -5Z" fill="${f.hair}"/>`,
    `<path d="${strands}" fill="none" stroke="${f.hairMid}" stroke-width="1.2" stroke-linecap="round"/>`,
    `<path d="M-13.4 26 Q${n(-12.4 + x * 0.4)} ${n(b * 0.6)} ${n(-11.4 + x)} ${n(b - 12)}" fill="none" stroke="${f.hairLight}" stroke-width="2.6" stroke-linecap="round" opacity="0.4"/>`,
  ].join("");
}

/**
 * Голова. Точка отсчёта — центр лица. `face` — выражение (MOODS), `look` — куда смотрит (−1 влево, 0 прямо,
 * 1 вправо), `up` — вверх (1) или вниз (−1).
 */
function head(g, f, face = "calm", look = 0, up = 0) {
  const dx = look * 2.6, dy = up * -1.4;
  const px = look * 1.2, py = up * -1.3;
  const closed = face === "happy" || face === "sleep";
  const half = face === "tired" || face === "pout" || face === "jealous";
  const iris = g.lin("iris", [[0, f.eyeDark], [0.5, f.eye], [1, f.eyeLight]]);
  const eye = (side) => {
    const ex = side * 9.9 + dx, ey = 6.9 + dy;
    if (face === "happy") return `<path d="M${n(ex - 5.6)} ${n(ey + 1.8)} Q${n(ex)} ${n(ey - 6)} ${n(ex + 5.6)} ${n(ey + 1.8)}" fill="none" stroke="${f.hair}" stroke-width="2.2" stroke-linecap="round"/>`;
    if (face === "sleep") return `<path d="M${n(ex - 5.6)} ${n(ey - 0.6)} Q${n(ex)} ${n(ey + 4.8)} ${n(ex + 5.6)} ${n(ey - 0.6)}" fill="none" stroke="${f.hair}" stroke-width="2" stroke-linecap="round"/><path d="M${n(ex - 3.4)} ${n(ey + 2.3)} l-1 1.8 M${n(ex)} ${n(ey + 3)} v2.1 M${n(ex + 3.4)} ${n(ey + 2.3)} l1 1.8" stroke="${f.hair}" stroke-width="0.9" stroke-linecap="round"/>`;
    const ix = ex + px + (face === "pout" ? 1.4 : 0), iy = ey + 0.3 + py;
    const open = [
      `<ellipse cx="${n(ex)}" cy="${n(ey + 0.2)}" rx="6" ry="6.1" fill="${f.white}"/>`,
      `<ellipse cx="${n(ix)}" cy="${n(iy)}" rx="4.8" ry="5.8" fill="${iris}"/>`,
      `<ellipse cx="${n(ix)}" cy="${n(iy + 0.3)}" rx="2.1" ry="3" fill="${f.eyeDark}"/>`,
      `<path d="M${n(ix - 3.8)} ${n(iy + 3.2)} Q${n(ix)} ${n(iy + 6.4)} ${n(ix + 3.8)} ${n(iy + 3.2)}" fill="none" stroke="${f.eyeLight}" stroke-width="1.3" stroke-linecap="round" opacity="0.8"/>`,
      `<circle cx="${n(ix - 1.9)}" cy="${n(iy - 2.7)}" r="1.8" fill="#ffffff"/><circle cx="${n(ix + 2.1)}" cy="${n(iy + 2.5)}" r="0.9" fill="#ffffff" opacity="0.9"/>`,
      `<path d="M${n(ex - 3.8)} ${n(ey + 6.3)} Q${n(ex)} ${n(ey + 7.3)} ${n(ex + 3.8)} ${n(ey + 6.3)}" fill="none" stroke="${f.skinLine}" stroke-width="0.9" stroke-linecap="round"/>`,
    ];
    if (!half) {
      return `<g class="blink">${[
        ...open,
        `<path d="M${n(ex + side * 7)} ${n(ey - 1)} Q${n(ex + side * 5.6)} ${n(ey - 6)} ${n(ex)} ${n(ey - 6.3)} Q${n(ex - side * 4.9)} ${n(ey - 6.1)} ${n(ex - side * 6.1)} ${n(ey - 2.3)}" fill="none" stroke="${f.hair}" stroke-width="2.2" stroke-linecap="round"/>`,
        `<path d="M${n(ex + side * 6.8)} ${n(ey - 1.4)} l${n(side * 2.1)} -1.7" stroke="${f.hair}" stroke-width="1.5" stroke-linecap="round"/>`,
      ].join("")}</g>`;
    }
    // Полуприкрытые: веко опущено; у ревности внутренний край ниже (сердится), у усталости — внешний.
    const inner = face === "jealous" ? 2.2 : face === "tired" ? -0.4 : 0.2, outer = face === "jealous" ? -1.1 : face === "tired" ? 1.3 : 0.2;
    const drop = face === "tired" ? 1.7 : 0.4;
    const yl = ey - 1.5 + drop + (side < 0 ? outer : inner), yr = ey - 1.5 + drop + (side < 0 ? inner : outer), ym = ey - 2.8 + drop;
    return [
      ...open,
      `<path d="M${n(ex - 7.4)} ${n(ey - 7.8)} H${n(ex + 7.4)} V${n(yr)} Q${n(ex)} ${n(ym)} ${n(ex - 7.4)} ${n(yl)}Z" fill="${f.skin}"/>`,
      `<path d="M${n(ex - 7)} ${n(yl + 0.2)} Q${n(ex)} ${n(ym)} ${n(ex + 7)} ${n(yr + 0.2)}" fill="none" stroke="${f.hair}" stroke-width="2.2" stroke-linecap="round"/>`,
    ].join("");
  };
  // Брови — тонкие, под самой чёлкой: по ним читается настроение.
  const brow = (side) => {
    const bx = side * 9.9 + dx, by = -1.2 + dy;
    const [inY, outY] = { jealous: [1.6, -1.2], pout: [-1.2, 0.6], tired: [-0.9, 0.9], happy: [-0.8, 0.2], sleep: [0, 0.4] }[face] ?? [0, 0.3];
    return `<path d="M${n(bx - side * 4.4)} ${n(by + inY)} Q${n(bx)} ${n(by - 1.1 + (inY + outY) / 2)} ${n(bx + side * 4.8)} ${n(by + outY)}" fill="none" stroke="${f.hair}" stroke-width="1" stroke-linecap="round" opacity="0.85"/>`;
  };
  const mx = dx * 1.1, my = 18 + dy;
  const lip = (d, w = 1.2) => `<path d="${d}" fill="none" stroke="${f.lip}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const mouth = {
    calm: lip(`M${n(mx - 2.6)} ${n(my)} q2.6 1.8 5.2 0`),
    smile: lip(`M${n(mx - 3.8)} ${n(my - 0.8)} q3.8 3.8 7.6 0`, 1.3),
    happy: `<path d="M${n(mx - 4.2)} ${n(my - 1.8)} q4.2 7.4 8.4 0z" fill="${f.eyeDark}"/><path d="M${n(mx - 2.2)} ${n(my + 1)} q2.2 1.8 4.4 0 q-2.2 -1.4 -4.4 0z" fill="${f.blush}"/>`,
    sleep: `<ellipse cx="${n(mx)}" cy="${n(my + 0.2)}" rx="1.5" ry="1.2" fill="${f.lip}" opacity="0.8"/>`,
    tired: lip(`M${n(mx - 2.6)} ${n(my + 0.4)} q1.3 -0.7 2.6 0 q1.3 0.7 2.6 0`, 1.1),
    pout: lip(`M${n(mx - 2.8)} ${n(my + 1.2)} q2.8 -2.8 5.6 0`, 1.3),
    jealous: lip(`M${n(mx - 3.6)} ${n(my + 0.6)} q1.8 -2.2 3.6 0 q1.8 2.2 3.6 0`, 1.2),
  }[face] ?? "";
  const rosy = face === "pout" || face === "jealous" ? 0.62 : face === "tired" ? 0.2 : 0.44;
  const cheek = (side) => `<ellipse cx="${n(side * 13.8 + dx)}" cy="${n(13.6 + dy)}" rx="4.2" ry="2.3" fill="${f.blush}" opacity="${rosy}"/>${face === "pout" || face === "jealous" ? `<path d="M${n(side * 13.8 + dx - 2.4)} ${n(14.6 + dy)} l1.1 -2.2 M${n(side * 13.8 + dx)} ${n(14.6 + dy)} l1.1 -2.2 M${n(side * 13.8 + dx + 2.4)} ${n(14.6 + dy)} l1.1 -2.2" stroke="${f.blush}" stroke-width="0.7" stroke-linecap="round"/>` : ""}`;
  const lock = (side) => `<path d="M${side * 24.8} -8 C${side * 26.2} 6 ${side * 25.6} 18 ${side * 24.4} 28 L${side * 20.8} 26.8 L${side * 17.2} 28.2 C${side * 18.4} 16 ${side * 18.6} 4 ${side * 16.6} -8 Z" fill="${f.hair}"/><path d="M${side * 21.4} -2 Q${side * 22.4} 12 ${side * 21} 24.6" fill="none" stroke="${f.hairMid}" stroke-width="1.2" stroke-linecap="round"/>`;
  return [
    `<path d="M-20.5 -6 C-21.6 9 -14 22 0 24.2 C14 22 21.6 9 20.5 -6 C20 -22 -20 -22 -20.5 -6Z" fill="${f.skin}" stroke="${f.skinLine}" stroke-width="0.7"/>`,
    cheek(-1), cheek(1),
    eye(-1), eye(1),
    brow(-1), brow(1),
    // Тень от чёлки на лбу.
    `<path d="M-19.6 -6 H19.6 L19.9 -1.4 Q0 2.2 -19.9 -1.4Z" fill="${f.eyeDark}" opacity="0.13"/>`,
    closed ? "" : `<path d="M${n(dx * 1.3 + 0.4)} ${n(12.8 + dy)} l-0.9 1.7" stroke="${f.skinLine}" stroke-width="1" stroke-linecap="round"/>`,
    mouth,
    lock(-1), lock(1),
    // Чёлка — ровным срезом, с просветами между прядями.
    `<path d="M-24.8 -5 C-24.8 -20 -13.8 -32.6 0 -32.6 C13.8 -32.6 24.8 -20 24.8 -5 L18.4 -4.6 Q9.6 -2.6 0 -3.6 Q-9.6 -2.6 -18.4 -4.6Z" fill="${f.hair}"/>`,
    `<path d="M-10.4 -2.6 l1.3 -4.8 l1.3 4.7z M6.6 -2.8 l1.3 -4.8 l1.3 4.8z" fill="${f.skin}"/>`,
    `<path d="M-13.6 -5 Q-15 -15 -10 -26 M-4.4 -4.6 Q-5 -15 -1.6 -27.4 M4 -4.6 Q5 -15 2.6 -27.4 M13.2 -5 Q14.6 -15 10.2 -26" fill="none" stroke="${f.hairMid}" stroke-width="1.1" stroke-linecap="round"/>`,
    // Блик на волосах — «кольцо».
    `<path d="M-18 -17 Q-9 -22.6 0 -22 Q10 -22.2 18.2 -16.4" fill="none" stroke="${f.hairShine}" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="6.4 2.6 2.4 2.6 9 2.4 3.6 2.6 8 40" opacity="0.6"/>`,
  ].join("");
}

/** Шея с чокером и колечком. Точка отсчёта — основание шеи; голова — на 30 выше. */
function neck(f) {
  return [
    `<path d="M-4.7 -12 L-4.9 1.4 L4.9 1.4 L4.7 -12Z" fill="${f.skin}"/>`,
    `<path d="M-4.7 -11 Q0 -5.4 4.7 -11 V-12 H-4.7Z" fill="${f.skinDark}"/>`,
    `<rect x="-5.2" y="-6" width="10.4" height="3.5" rx="1" fill="${f.jacket}"/><rect x="-5.2" y="-6" width="10.4" height="1" rx="0.5" fill="${f.jacketLight}"/>`,
    `<circle cx="0" cy="-1" r="1.9" fill="none" stroke="${f.silver}" stroke-width="1"/>`,
  ].join("");
}

/** Плечи и красный топ спереди. Точка отсчёта — основание шеи; талия — на 39 ниже. `turn` — вполоборота вправо. */
function chest(f, turn = 0) {
  const l = -21.6 + turn * 9, r = 21.6 - turn * 2, cx = turn * 4;
  return [
    `<path d="M${n(cx - 4.7)} -1.6 L${n(l + 4.6)} 3 Q${l} 5 ${l} 10 V17 H${r} V10 Q${r} 5 ${n(r - 4.6)} 3 L${n(cx + 4.7)} -1.6Z" fill="${f.skin}"/>`,
    `<path d="M${n(cx - 13)} 5.6 q4.6 1.7 8.6 0.9 M${n(cx + 13)} 5.6 q-4.6 1.7 -8.6 0.9" fill="none" stroke="${f.skinLine}" stroke-width="0.7" stroke-linecap="round" opacity="0.7"/>`,
    `<path d="M${n(l + 5)} 11 Q${n(cx)} 14.6 ${n(r - 5)} 11 L${n(r - 5.4)} 20 Q${n(r - 8)} 30 ${n(r - 9.2)} 40 H${n(l + 9.2)} Q${n(l + 8)} 30 ${n(l + 5.4)} 20Z" fill="${f.top}"/>`,
    `<path d="M${n(l + 9)} 26 Q${n(cx)} 31 ${n(r - 9)} 26 L${n(r - 9.2)} 40 H${n(l + 9.2)}Z" fill="${f.topDark}" opacity="0.3"/>`,
    `<path d="M${n(r - 12)} 13 L${n(r - 5)} 11 L${n(r - 5.4)} 20 Q${n(r - 8)} 30 ${n(r - 9.2)} 40 H${n(r - 13.4)}Z" fill="${f.topDark}" opacity="0.35"/>`,
    `<path d="M${n(l + 5)} 11 Q${n(cx)} 14.6 ${n(r - 5)} 11 l-0.2 3.2 Q${n(cx)} 17.8 ${n(l + 5.2)} 14.2Z" fill="${f.topLight}"/>`,
  ].join("");
}

/**
 * Рука: плечо → локоть → кисть. Плечо голое, с середины — рукав куртки, съехавшей на локти. `tool` — что в руке
 * (рисуется под пальцами).
 */
function arm(f, shoulder, elbow, hand, { tool = "", dark = false } = {}) {
  const [sx, sy] = shoulder, [ex, ey] = elbow, [hx, hy] = hand;
  const [px, py] = along(shoulder, elbow, 0.4), [wx, wy] = along(elbow, hand, 0.84);
  const sleeve = `M${n(px)} ${n(py)} L${n(ex)} ${n(ey)} L${n(wx)} ${n(wy)}`;
  const cloth = dark ? dk(f.jacket, 0.2) : f.jacket;
  return [
    `<path d="M${n(sx)} ${n(sy)} L${n(px)} ${n(py)}" stroke="${f.skin}" stroke-width="8.8" stroke-linecap="round"/>`,
    `<path d="M${n(wx)} ${n(wy)} L${n(hx)} ${n(hy)}" stroke="${f.skin}" stroke-width="5.6" stroke-linecap="round"/>`,
    `<path d="${sleeve}" fill="none" stroke="${dark ? f.jacket : f.jacketLight}" stroke-width="10.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<path d="${sleeve}" fill="none" stroke="${cloth}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" transform="translate(0.7 0.8)"/>`,
    tool,
    `<circle cx="${n(hx)}" cy="${n(hy)}" r="4.5" fill="${f.skin}" stroke="${f.skinLine}" stroke-width="0.6"/>`,
  ].join("");
}

/**
 * Нога: бедро → колено → ступня. Сверху — кожа, ниже — тёмный чулок (`share` — с какой доли бедра он начинается).
 * `toe` — куда смотрит носок.
 */
function leg(f, hip, knee, ankle, { toe = 0.4, dark = false, share = 0.54 } = {}) {
  const [hx, hy] = hip, [kx, ky] = knee, [ax, ay] = ankle;
  const [mx, my] = along(hip, knee, share);
  const stock = dark ? dk(f.stocking, 0.28) : f.stocking, skin = dark ? f.skinDark : f.skin;
  const wide = 13.6 + (10.8 - 13.6) * share;
  const dx = kx - hx, dy = ky - hy, len = Math.hypot(dx, dy) || 1, nx = -dy / len * (wide / 2 - 0.2), ny = dx / len * (wide / 2 - 0.2);
  return [
    taper(hx, hy, 13.6, kx, ky, 10.8, skin),
    taper(mx, my, wide, kx, ky, 10.8, stock),
    taper(kx, ky, 10.8, ax, ay, 7.2, stock),
    `<ellipse cx="${n(ax + toe * 5)}" cy="${n(ay + 3.2)}" rx="${n(4.6 + Math.abs(toe) * 3)}" ry="4" fill="${stock}"/>`,
    `<path d="M${n(mx + nx)} ${n(my + ny)} L${n(mx - nx)} ${n(my - ny)}" stroke="${dark ? f.stocking : f.stockingLight}" stroke-width="2.6" stroke-linecap="round"/>`,
    dark ? "" : `<path d="M${n(kx - 2)} ${n(ky + 4)} L${n(ax - 1)} ${n(ay - 4)}" stroke="${f.stockingLight}" stroke-width="1.3" stroke-linecap="round" opacity="0.6"/>`,
  ].join("");
}

/** Складчатая юбка спереди. Точка отсчёта — основание шеи. */
function skirt(f, swing = 0) {
  const s = swing;
  return [
    `<path d="M-12.8 37 H12.8 L${n(22 + s)} 62.6 Q${n(s)} 68.6 ${n(-22 + s)} 62.6Z" fill="${f.jacket}"/>`,
    `<path d="M-7.4 40 L${n(-12.8 + s)} 64.8 M-2.5 40 L${n(-4.4 + s)} 66.4 M2.5 40 L${n(4.4 + s)} 66.4 M7.4 40 L${n(12.8 + s)} 64.8" stroke="${f.jacketLight}" stroke-width="0.9" stroke-linecap="round"/>`,
    `<path d="M${n(-21.4 + s)} 61.4 Q${n(s)} 67.2 ${n(21.4 + s)} 61.4" fill="none" stroke="${f.jacketLight}" stroke-width="1.1" opacity="0.8"/>`,
    `<rect x="-13" y="36" width="26" height="3.6" rx="1.2" fill="${f.jacketLight}"/>`,
  ].join("");
}

/** Полы куртки по бокам: она съехала с плеч и висит на локтях. Точка отсчёта — основание шеи. */
function jacketSides(f) {
  const side = (s) => `<path d="M${s * 14.4} 17 L${s * 21.6} 14.6 Q${s * 25.6} 32 ${s * 24.4} 54 L${s * 14.6} 56.4 Q${s * 13} 40 ${s * 14.4} 17Z" fill="${f.jacket}"/><path d="M${s * 15.2} 22 Q${s * 14} 40 ${s * 15.6} 55" fill="none" stroke="${f.jacketLight}" stroke-width="1.1" stroke-linecap="round"/>`;
  return side(-1) + side(1);
}

/** Руки стоя: плечо, локоть, кисть для левой (от зрителя) и правой руки. Точка отсчёта — основание шеи. */
const SHOULDER = Object.freeze([[-18.8, 6.6], [18.8, 6.6]]);
const ARMS = Object.freeze({
  down: [[[-22.6, 27], [-21.6, 47]], [[22.6, 27], [21.6, 47]]],
  up: [[[-31, -2], [-39, -25]], [[30, -6], [34, -31]]],
  point: [[[-22.6, 27], [-21.6, 47]], [[29, -9], [35, -35]]],
  reach: [[[-22, 26], [-9, 25]], [[33, 5], [47, -7]]],
  wand: [[[-27.4, 23], [-17.6, 37]], [[30, 17], [41, 12]]],
});

/** Стоит лицом к зрителю. Точка отсчёта — пол между ступнями; рост — 200. `tools` — что в левой и в правой руке. */
function standing(g, f, { face = "calm", look = 0, up = 0, arms = "down", step = false, lean = 0, tools = ["", ""], front = "" } = {}) {
  const [left, right] = ARMS[arms] ?? ARMS.down;
  const legs = step
    ? leg(f, [-7.2, -88], [-9.6, -47], [-7, -6], { toe: -0.5 }) + leg(f, [7.2, -88], [17, -55], [10.6, -22], { toe: 0.9 })
    : leg(f, [-7.2, -88], [-7.6, -47], [-8, -6], { toe: -0.4 }) + leg(f, [7.2, -88], [7.6, -47], [8, -6], { toe: 0.4 });
  const upper = [
    jacketSides(f), chest(f),
    arm(f, SHOULDER[0], ...left, { tool: tools[0] }), arm(f, SHOULDER[1], ...right, { tool: tools[1] }),
    neck(f), front,
    at(0, -30, head(g, f, face, look, up)),
  ].join("");
  return [
    at(0, -172, hairBack(f, 100, lean)),
    legs,
    at(0, -142, skirt(f, step ? 2 : 0)),
    `<g class="breath">${at(0, -142, upper)}</g>`,
  ].join("");
}

/** Раскрытая книга обложкой к зрителю: «Маленький принц» — жёлтая, со звездой. */
function openBook(f) {
  return `<path d="M-14.6 -9.4 L0 -7.2 L14.6 -9.4 V8.4 L0 10.6 L-14.6 8.4Z" fill="${f.gold}"/><path d="M-14.6 8.4 L0 10.6 L14.6 8.4" fill="none" stroke="${f.paper}" stroke-width="1.6"/><path d="M0 -7.2 V10.6" stroke="${dk(f.gold, 0.3)}" stroke-width="1.8"/><g fill="${f.paper}">${sparkle(7.4, -0.6, 1.5)}</g><path d="M-11 -3.6 l7 1 M-11 0 l7 1" stroke="${dk(f.gold, 0.25)}" stroke-width="1" stroke-linecap="round"/>`;
}
const zzz = (f, x, y) => `<g class="zzz" aria-hidden="true" fill="${f.paper}" stroke="${f.ink}" stroke-width="0.5" font-family="system-ui, sans-serif" font-weight="700"><text x="${x}" y="${y}" font-size="11">z</text><text x="${x + 9}" y="${y - 11}" font-size="14">z</text><text x="${x + 20}" y="${y - 25}" font-size="17">Z</text></g>`;

/**
 * В кресле, лицом к зрителю: ноги под пледом, из-под него видны носки. Точка отсчёта — середина сиденья.
 * `arms`: hold — держит книгу, cross — скрестила руки, rest — руки на пледе. `wrap` — завёрнута по самый нос.
 */
function inChair(g, f, { face = "calm", arms = "hold", wrap = false, look = 0 } = {}) {
  const shoulders = SHOULDER.map(([x, y]) => [x, y]);
  const pair = {
    hold: [arm(f, shoulders[0], [-22.6, 27], [-13.4, 31.6]), arm(f, shoulders[1], [22.6, 27], [13.4, 31.6])],
    cross: [arm(f, shoulders[0], [-21.6, 27], [8.6, 24.6]), arm(f, shoulders[1], [21.6, 28], [-8.6, 28.6])],
    rest: [arm(f, shoulders[0], [-23.6, 26], [-9.6, 36]), arm(f, shoulders[1], [23.6, 26], [9.6, 36])],
  }[arms] ?? ["", ""];
  const feet = `<ellipse cx="-10.4" cy="46.4" rx="7" ry="4.2" fill="${f.stocking}"/><ellipse cx="10.4" cy="46.4" rx="7" ry="4.2" fill="${f.stocking}"/><path d="M-13 44.6 q2.6 -1.6 5.2 0 M7.8 44.6 q2.6 -1.6 5.2 0" fill="none" stroke="${f.stockingLight}" stroke-width="1" stroke-linecap="round"/>`;
  const lap = plaidShape(g, f, wrap
    ? "M-34 -64 Q-33 -79 -16 -76 Q0 -71.4 16 -76 Q33 -79 34 -64 L37.4 4 Q40.6 28 33.6 43 Q0 49.6 -33.6 43 Q-40.6 28 -37.4 4Z"
    : "M-29.6 -24 Q-14 -30.6 0 -27.4 Q14 -30.6 29.6 -24 L35.4 4 Q39.4 28 33.4 43 Q0 49.6 -33.4 43 Q-39.4 28 -35.4 4Z", {
    folds: wrap ? ["M-18 -62 Q-22 -20 -16 38", "M19 -60 Q24 -20 17 38", "M-2 -66 Q2 -30 -1 40"] : ["M-15 -16 Q-21 12 -15 39", "M16 -15 Q22 12 16 39", "M0 -20 Q-2 10 0 42"],
    gleams: wrap ? ["M-9 -66 Q-11 -24 -7 38", "M10 -66 Q13 -24 9 38"] : ["M-8 -22 Q-11 10 -7 40", "M9 -22 Q12 10 8 40"],
    fringe: "M-30 44.4 l-1 5 M-22 45.6 l-0.6 5 M-14 46.6 l-0.4 5 M-5 47.2 v5 M5 47.2 v5 M14 46.6 l0.4 5 M22 45.6 l0.6 5 M30 44.4 l1 5",
  });
  if (wrap) {
    return [
      at(0, -90, hairBack(f, 78)),
      `<g class="breath">${at(0, -60, jacketSides(f) + chest(f) + neck(f))}${at(0, -90, head(g, f, "sleep", 0, -0.4), " rotate(7 0 26)")}</g>`,
      feet, lap,
      // Пальцы придерживают край пледа.
      `<circle cx="-13" cy="-71" r="4.2" fill="${f.skin}" stroke="${f.skinLine}" stroke-width="0.6"/><circle cx="13" cy="-71" r="4.2" fill="${f.skin}" stroke="${f.skinLine}" stroke-width="0.6"/>`,
    ].join("");
  }
  return [
    at(0, -90, hairBack(f, 78)),
    feet,
    `<g class="breath">${at(0, -60, jacketSides(f) + chest(f) + neck(f))}</g>`,
    lap,
    `<g class="breath">${at(0, -60, (arms === "hold" ? at(0, 31, openBook(f)) : "") + pair.join(""))}${at(0, -90, head(g, f, face, look, arms === "hold" ? -0.6 : 0))}</g>`,
  ].join("");
}

/**
 * Сидит вполоборота, ноги вправо: на табурете — вниз (`knees: false`), на подоконнике — колени подтянуты.
 * Точка отсчёта — сиденье под ней. Руки: rest — лежат на столе, write — пишет, cup — держит кружку над столом,
 * hug — обнимает колени, в другой руке кружка.
 */
function sitting(g, f, { face = "calm", look = 1, knees = false, arms = "rest" } = {}) {
  const near = [-8.8, -53.4], far = [17.8, -53.4];
  const cup = (x, base) => mug(x, base, f.mug, { steam: true });
  const legs = knees
    ? leg(f, [5, -9.6], [31.6, -39], [47, -8], { toe: 1, dark: true, share: 0.7 }) + leg(f, [3, -8.6], [27, -37], [42, -7], { toe: 1, share: 0.7 })
    : leg(f, [8, -9.6], [41, -12], [34, 30.4], { toe: 0.8, dark: true, share: 0.8 }) + leg(f, [6, -8.6], [38, -10.4], [26.6, 32.4], { toe: 0.8, share: 0.8 });
  const skirtSide = knees
    ? `<path d="M-11.6 -22 H12 L22 -29 L29 -21 L17 -3 Q4 2 -11 1 Q-15 -10 -11.6 -22Z" fill="${f.jacket}"/><path d="M-3 -19 L3 0.4 M6 -19.6 L13 -2 M13 -21 L22 -12" stroke="${f.jacketLight}" stroke-width="0.9" stroke-linecap="round"/>`
    : `<path d="M-11.6 -22 H13 Q25 -21 28.6 -14 L29.6 -2 Q12 3 -11 1 Q-15 -10 -11.6 -22Z" fill="${f.jacket}"/><path d="M-3 -19 L2 0.8 M5 -19.6 L13 0.4 M13 -19.4 L24 -1.4" stroke="${f.jacketLight}" stroke-width="0.9" stroke-linecap="round"/><path d="M29.4 -3 Q12 2 -10.6 0.2" fill="none" stroke="${f.jacketLight}" stroke-width="1" opacity="0.8"/>`;
  const band = `<rect x="-11.8" y="-23" width="25" height="3.6" rx="1.2" fill="${f.jacketLight}"/>`;
  const jacketBack = `<path d="M-10 -45 Q-19 -43 -19 -32 L-17 -3 L-8.6 0 L-9.6 -40Z" fill="${f.jacket}"/><path d="M-17.6 -30 L-16 -5" stroke="${f.jacketLight}" stroke-width="1.1" stroke-linecap="round"/>`;
  const torso = at(1, -60, chest(f, 1)) + at(5, -60, neck(f));
  const face3 = at(6.6, -90, head(g, f, face, look, 0));
  const hair = at(4.6, -90, hairBack(f, knees ? 84 : 88, -5));
  const set = {
    rest: { farArm: arm(f, far, [23, -36], [33.4, -40.6], { dark: true }), nearArm: arm(f, near, [-3.6, -31], [22, -40.4]), prop: "" },
    write: {
      farArm: arm(f, far, [24, -36], [37, -40.6], { dark: true }),
      nearArm: arm(f, near, [-3, -31.6], [24.4, -41], { tool: `<path d="M28.6 -37 L22.6 -49" stroke="${f.gold}" stroke-width="2" stroke-linecap="round"/><path d="M28.6 -37 l-0.8 -1.6" stroke="${f.ink}" stroke-width="2" stroke-linecap="round"/>` }),
      prop: `<path d="M18 -36.6 L41 -38 L43 -36.4 L20 -35Z" fill="${f.paper}"/><path d="M24 -36.6 l12 -0.8" stroke="${f.paperDark}" stroke-width="0.7"/>`,
    },
    cup: { farArm: arm(f, far, [25, -37.6], [35, -45], { dark: true }), nearArm: arm(f, near, [-2, -32.6], [24, -45]), prop: cup(29.6, -39) },
    hug: { farArm: arm(f, far, [27.6, -44.6], [35.6, -50.6], { dark: true }), nearArm: arm(f, near, [5, -33], [27, -30.6]), prop: cup(40, -45) },
  }[arms] ?? { farArm: "", nearArm: "", prop: "" };
  return knees
    ? [hair, legs, skirtSide, jacketBack, `<g class="breath">${torso}${band}${set.prop}${set.farArm}${set.nearArm}${face3}</g>`].join("")
    : [hair, set.farArm, legs, skirtSide, jacketBack, `<g class="breath">${torso}${band}${set.prop}${set.nearArm}${face3}</g>`].join("");
}

/** Сидит на подоконнике спиной к комнате: волосы до пояса, плечи, с которых съехала куртка, рядом кружка. Точка отсчёта — подоконник. */
function fromBehind(g, f, { cup = true } = {}) {
  const hair = "M-24.6 -95 C-24.6 -110 -13.6 -122.4 0 -122.4 C13.6 -122.4 24.6 -110 24.6 -95 C25.6 -70 22.6 -40 20.4 -15 L15.4 -11.6 L13.6 -14.8 L7 -10.6 L5 -14.2 L-1 -10 L-3 -14.2 L-9.4 -10.6 L-11.4 -14.8 L-16 -11.6 L-20.4 -15 C-22.6 -40 -25.6 -70 -24.6 -95Z";
  return [
    cup ? mug(41, 0, f.mug, { steam: true }) : "",
    // Юбка, голые плечи и спина куртки.
    `<path d="M-21.6 -17 Q0 -23 21.6 -17 L24 -1 Q0 3.4 -24 -1Z" fill="${f.jacket}"/><path d="M-9 -16 L-11 1 M0 -17 V1.6 M9 -16 L11 1" stroke="${f.jacketLight}" stroke-width="0.9" stroke-linecap="round"/>`,
    `<path d="M-24 -50 Q-24 -59 -11 -61.6 H11 Q24 -59 24 -50 V-44 H-24Z" fill="${f.skin}"/>`,
    `<path d="M-22 -47 Q0 -41 22 -47 L22.6 -14 Q0 -8.6 -22.6 -14Z" fill="${f.jacket}"/><path d="M-22 -47 Q0 -41 22 -47" fill="none" stroke="${f.jacketLight}" stroke-width="1.8"/>`,
    arm(f, [-22, -54], [-29.6, -29], [-28.6, -5.4]), arm(f, [22, -54], [29.6, -29], [28.6, -5.4]),
    `<g class="breath"><path d="${hair}" fill="${f.hair}"/>`,
    `<path d="M-16 -68 Q-15 -40 -13.6 -20 M-7 -66 Q-6.6 -40 -6 -17 M3 -66 Q3.4 -40 3 -17 M12 -68 Q12 -40 11 -19 M19 -72 Q19.4 -46 17 -22" fill="none" stroke="${f.hairMid}" stroke-width="1.2" stroke-linecap="round"/>`,
    `<path d="M-11.6 -66 Q-11 -42 -10 -22" fill="none" stroke="${f.hairLight}" stroke-width="2.6" stroke-linecap="round" opacity="0.4"/>`,
    `<path d="M-18 -107 Q-9 -112.6 0 -112 Q10 -112.2 18.2 -106.4" fill="none" stroke="${f.hairShine}" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="6.4 2.6 2.4 2.6 9 2.4 3.6 2.6 8 40" opacity="0.6"/>`,
    `<path d="M0 -122 Q1.4 -108 0.6 -96" fill="none" stroke="${f.hairMid}" stroke-width="1.2" stroke-linecap="round"/></g>`,
  ].join("");
}

/** Лежит на ковре: голова на подушках, сама под пледом, рука поверх. Точка отсчёта — середина. */
function lying(g, f, { face = "tired" } = {}) {
  const cover = plaidShape(g, f, "M-41 -20 Q-12 -37 30 -27 Q64 -22 85 -16 Q99 -10 96.6 0 Q94 8 84 9.4 L-33 10.4 Q-47 -2 -41 -20Z", {
    folds: ["M-12 -30 Q-2 -10 -14 8", "M26 -26 Q36 -8 24 8", "M62 -20 Q70 -6 60 8"],
    gleams: ["M6 -30 Q16 -12 6 6", "M46 -23 Q54 -8 44 7"],
    fringe: "M86 9 l3.4 4 M91 6.6 l4.4 2.6 M95 2 l5 1 M96.6 -3 l5 -0.6",
  });
  return [
    shadow(g, -4, 11, 112, 9, 0.3),
    // Две подушки: синяя — под спину, большая светлая — под голову.
    `<ellipse cx="-40" cy="-21" rx="26" ry="14" fill="${f.plaidLight}" transform="rotate(-14 -40 -21)"/><ellipse cx="-40" cy="-21" rx="26" ry="14" fill="none" stroke="${f.plaid}" stroke-width="1" opacity="0.5" transform="rotate(-14 -40 -21)"/>`,
    `<ellipse cx="-70" cy="-3" rx="48" ry="17.6" fill="${f.pillowDark}"/><ellipse cx="-71" cy="-7.6" rx="46" ry="16.6" fill="${f.pillow}"/><path d="M-110 -9 q39 9 78 0" fill="none" stroke="${f.pillowDark}" stroke-width="1"/><path d="M-112 -12 l-5 -4 M-27 -12 l5 -4" stroke="${f.pillowDark}" stroke-width="2" stroke-linecap="round"/>`,
    // Волосы рассыпались по подушке.
    `<path d="M-82 -34 Q-103 -20 -99 -2 Q-96 7 -76 6.4 L-48 5 L-38 -22Z" fill="${f.hair}"/><path d="M-80 -22 Q-93 -10 -90 0 M-68 -14 Q-80 -4 -75 4 M-56 -12 Q-62 -4 -56 3" fill="none" stroke="${f.hairMid}" stroke-width="1.2" stroke-linecap="round"/>`,
    `<g class="breath">${cover}`,
    arm(f, [-36, -17], [-17, -4.6], [0, -9.4]),
    at(-57, -27, head(g, f, face, 0, 0), " rotate(-16)"),
    `</g>`,
  ].join("");
}

/**
 * Где она и как нарисована — по позе. Возвращает один из слоёв: `sillSeat` — на подоконнике, `seat` — в кресле,
 * `front` — на полу перед мебелью (тогда `y` — где её ступни: кто ниже, тот ближе и рисуется позже).
 */
function her(g, c, f, pose, key, view = {}) {
  const face = MOODS[key] ?? "calm";
  // Фигура ставится в точку (x, y); `box` — её края в собственных единицах: по ним область нажатия. `mirror` —
  // развёрнута влево. Сама область ложится отдельным слоем, поверх картинки.
  let zone = null;
  const put = (x, y, body, [left, top, right, bottom], { mirror = false, cls = "", extra = "" } = {}) => {
    zone = [mirror ? x - right : x + left, y + top, right - left, bottom - top];
    const inner = at(x, y, body, mirror ? " scale(-1 1)" : "");
    return `${cls ? `<g class="${cls}">${inner}</g>` : inner}${extra}`;
  };
  const floor = (x, y) => shadow(g, x, y + 1, 27, 5, 0.34);
  // В кресле она того же размера, что кресло (оно с 0.44.0 — в рост картинки).
  const grown = (body) => `<g transform="scale(${CHAIR.k})">${body}</g>`;
  // Кресло с 0.44.0 большое: когти Байт точит у его левого края, хвост из-под него торчит у правого — она на ковре
  // стоит между ними и никого не закрывает.
  const pet = view.cat ?? null;
  // Байт у неё на коленях — книга отложена, руки на пледе.
  const lapCat = Boolean(pet) && ((pet.place === "chair" && pet.shape !== "claw") || (pet.place === "plaid" && pet.shape !== "tail"));
  // Вторая подушка лежит на подоконнике справа от неё — кружке там места нет.
  const pillow = Array.isArray(view.things) && view.things.includes("подушка");
  const book = `<g transform="translate(-9.6 21) rotate(-8)"><rect x="-7.4" y="-10" width="14.8" height="20" rx="1.4" fill="${f.plaid}"/><rect x="-7.4" y="-10" width="3" height="20" rx="1" fill="${f.plaidDark}"/><path d="M-1.6 -5 h6 M-1.6 -1.6 h6" stroke="${f.plaidLight}" stroke-width="1.1" stroke-linecap="round"/></g>`;
  const wand = `<path d="M37.6 13.4 L64 3.4" stroke="${f.woodPale}" stroke-width="2.2" stroke-linecap="round"/><path class="ribbon" d="M64 3.4 q10 9 2.6 22 q-8.6 13 3 26 q8 9.6 0.4 21" fill="none" stroke="${f.eye}" stroke-width="2.8" stroke-linecap="round"/>`;
  const placed = () => {
    switch (pose) {
    case "shelf": return { y: 398, front: floor(130, 398) + put(130, 398, standing(g, f, { face, arms: "reach", look: 1, tools: [book, ""] }), [-30, -204, 53, 2], { mirror: true }) };
    case "map": return { y: 400, front: floor(78, 400) + put(78, 400, standing(g, f, { face, arms: "point", look: 1, up: 1 }), [-30, -204, 41, 2], { mirror: true }) };
    case "garland": return { y: 393, front: stool(g, c, GARLAND_STOOL, STOOL.y) + put(GARLAND_STOOL, STOOL.y, standing(g, f, { face, arms: "point", look: 1, up: 1 }), [-30, -204, 41, 2], { mirror: true }) };
    case "dance": return { y: 452, front: floor(240, 452) + put(240, 452, standing(g, f, { face: face === "calm" ? "happy" : face, arms: "up", step: true, lean: 5 }), [-44, -204, 40, 2], { cls: "sway" }) };
    case "ribbon": return { y: 452, front: floor(214, 452) + put(214, 452, standing(g, f, { face, arms: "wand", look: 1, tools: ["", wand] }), [-30, -204, 72, 2]) };
    case "read":
    case "chair": return { seat: put(CHAIR.x, CHAIR.y, grown(inChair(g, f, { face, arms: key === "ревность" || key === "обида" ? "cross" : key === "устала" || lapCat ? "rest" : "hold" })), [-37, -124, 37, 50].map(value => value * CHAIR.k)) };
    case "nap": return { seat: put(CHAIR.x, CHAIR.y, grown(inChair(g, f, { wrap: true })), [-38, -124, 38, 50].map(value => value * CHAIR.k), { extra: zzz(f, ...chairAt(30, -112)) }) };
    case "sill": return { sillSeat: put(182, 262, sitting(g, f, { face, look: 1, knees: true, arms: "hug" }), [-26, -124, 54, 2]) };
    case "back": return { sillSeat: put(188, 262, fromBehind(g, f, { cup: !pillow }), [-34, -124, pillow ? 34 : 49, 3]) };
    case "lie": return { y: 472, front: put(210, 462, lying(g, f, { face: face === "calm" ? "tired" : face }), [-118, -60, 102, 12], { extra: face === "sleep" ? zzz(f, 130, 405) : "" }) };
    case "desk":
    default: return {
      y: 393, stoolUsed: true,
      front: stool(g, c, STOOL.x, STOOL.y) + put(STOOL.x, STOOL.y, sitting(g, f, { face, look: 0.7, arms: key === "дело" || key === "ревность" ? "write" : key === "обида" || view.tea ? "cup" : "rest" }), [-26, -124, 50, 42]),
    };
    }
  };
  return { ...placed(), zone };
}

// ── Аи картинкой ─────────────────────────────────────────────────────────────
// С 0.40.0 её рисует не код. Владелец посмотрел на фигурку из простых форм и выбрал другой облик: картинку в рост,
// как на портрете. Картинки (спрайты) лежат рядом, в папке `her/`, по модулю на состояние; их рисует нейросеть по
// её портрету, а в модуль превращает `scripts/room-sprite.mjs`. Здесь — только то, какой спрайт нужен и куда его
// поставить. Она стоит ближе к зрителю, чем мебель, и потому крупнее её: рост — три четверти рисунка, лицо видно.
// Фигура, нарисованная кодом выше, осталась запасной: её видно, когда спрайта нет (старая копия страницы, обрыв).

// С 0.43.0 в свитере нарисованы все пятнадцать поз — те же, что в куртке: вечером она снова меняет позу. «Веки» —
// у десяти картинок: с кружкой, с блокнотом (обе позы) и на пуфе в обоих нарядах, со скрещёнными руками — тоже.
// С 0.42.0 свитер нарисован для каждого состояния (вечером и ночью она в нём, чем бы ни была занята).
// С 0.41.0 картинок у состояния несколько: позы сменяют друг друга (сами и от нажатия), у глаз есть «веки» —
// она моргает, а вечером на ней домашний свитер. Всё, что нужно знать о картинке, лежит в одной таблице.

/** Наряды: `jacket` — куртка, как на портрете; `home` — большой свитер и наушники (вечером и ночью). */
export const HER_WEARS = Object.freeze(["jacket", "home"]);
/**
 * Её картинки. Имя — файл в `her/`; наряд, кроме куртки, — приставкой через дефис (`home-tea`).
 *   tall — высота картинки на рисунке (стоя — 390: рост три четверти рисунка);
 *   kind — как она на картинке: стоит (по умолчанию), crouch — присела, seat — сидит (в кресле комнаты: сиденья на
 *          картинке нет), floor — на полу, закутавшись в плед, walk — идёт;
 *   seat — у сидящей: где её бёдра, в долях высоты картинки (эта линия ложится на сиденье кресла);
 *   half — полуширина того, что она закрывает собой; legs — ноги: от и до по ширине, от оси тела;
 *   head — где голова, в долях ширины и высоты картинки (по умолчанию — на оси тела, у верхнего края): по ней гладят;
 *   mark — что движется рядом с неподвижной картинкой: пар над кружкой или «z z Z», место — в тех же долях;
 *   faces — куда смотрит картинка «идёт» (0.48.0); drop — где на полу падает корм, от оси тела: там ест Байт;
 *   blush: false — румянца у этой позы нет: лицо повёрнуто или наклонено, пятно пришлось бы на нос или рот.
 * Доли сняты с самих картинок (лист с сеткой); перерисовали спрайт — проверить по листу `her`.
 */
export const HER_SPRITES = Object.freeze({
  tea: { tall: 390, mark: ["steam", 0.11, 0.222] },
  tea2: { tall: 390, mark: ["steam", 0.36, 0.13] },
  tea3: { tall: 320, kind: "seat", half: 60, seat: 0.568, head: [0.49, 0.09], mark: ["steam", 0.485, 0.465] },
  // Читает в кресле (0.45.0): та же сидящая фигура, что с кружкой, — в руках книга; числа — как у `tea3`.
  read: { tall: 320, kind: "seat", half: 60, seat: 0.568, head: [0.49, 0.09] },
  work: { tall: 390 },
  work2: { tall: 390 },
  // Сидит в кресле и в других состояниях (0.47.0, идея 168): с блокнотом, под пледом с закрытыми глазами, скрестив
  // руки. Правки той же сидящей картинки, что с кружкой: рост, сиденье и голова — как у `tea3` (сверено наложением).
  work3: { tall: 320, kind: "seat", half: 60, seat: 0.568, head: [0.49, 0.09], blush: false },
  play: { tall: 390, legs: [-30, 72], head: [0.66, 0.075] },
  play2: { tall: 380, half: 62, legs: [-36, 54], head: [0.51, 0.17] },
  play3: { tall: 215, kind: "crouch", half: 66, head: [0.6, 0.17] },
  tired: { tall: 390, half: 70 },
  tired2: { tall: 390, half: 70 },
  tired3: { tall: 320, kind: "seat", half: 86, seat: 0.568, head: [0.48, 0.09] },
  pout: { tall: 390, head: [0.55, 0.07] },
  pout2: { tall: 390, head: [0.55, 0.07] },
  jealous: { tall: 390, half: 64 },
  jealous2: { tall: 390, half: 64 },
  jealous3: { tall: 320, kind: "seat", half: 60, seat: 0.568, head: [0.49, 0.09] },
  sleep: { tall: 164, kind: "floor", head: [0.47, 0.3], mark: ["zzz", 0.6, 0.13] },
  // Дела дня (0.48.0, сообщение 47: «кормит Байта», «наводит порядок, раскладывает книги»): смахивает пыль метёлкой,
  // раскладывает книги, присела и насыпает корм. Все три смотрят влево: метёлка и книга тянутся к шкафу, корм
  // сыплется влево и вниз. `drop` — где корм падает на пол, от оси её тела: там ест Байт (`catAhead`).
  tidy: { tall: 390, head: [0.58, 0.09], blush: false },
  books: { tall: 390, head: [0.54, 0.1], blush: false },
  feed: { tall: 215, kind: "crouch", half: 66, head: [0.34, 0.15], drop: -96, blush: false },
  // Идёт (0.44.0): не поза состояния, а то, как она переходит от места к месту.
  // `faces` — куда она на картинке идёт. Обе «идёт» нарисованы лицом влево (образец — `verify.sh ref walk,walkb,
  // home-walk,home-walkb`): идёт вправо — картинка отражается. До 0.48.0 код считал наоборот, и она шла задом наперёд.
  walk: { tall: 374, kind: "walk", faces: "left" },
  // В свитере — те же позы, что в куртке (нейросеть переодела те же картинки): и числа те же.
  "home-tea": { tall: 390, mark: ["steam", 0.115, 0.228] },
  "home-tea2": { tall: 390, mark: ["steam", 0.36, 0.13] },
  "home-tea3": { tall: 320, kind: "seat", half: 60, seat: 0.568, head: [0.49, 0.09], mark: ["steam", 0.485, 0.465] },
  "home-read": { tall: 320, kind: "seat", half: 60, seat: 0.568, head: [0.49, 0.09] },
  "home-work": { tall: 390 },
  "home-work2": { tall: 390 },
  "home-work3": { tall: 320, kind: "seat", half: 60, seat: 0.568, head: [0.49, 0.09], blush: false },
  "home-play": { tall: 390, legs: [-30, 72], head: [0.66, 0.075] },
  "home-play2": { tall: 380, half: 62, legs: [-36, 54], head: [0.51, 0.17] },
  "home-play3": { tall: 215, kind: "crouch", half: 66, head: [0.6, 0.17] },
  "home-tired": { tall: 390, half: 70 },
  "home-tired2": { tall: 390, half: 70 },
  "home-tired3": { tall: 320, kind: "seat", half: 86, seat: 0.568, head: [0.48, 0.09] },
  "home-pout": { tall: 390, head: [0.55, 0.07] },
  "home-pout2": { tall: 390, head: [0.55, 0.07] },
  "home-jealous": { tall: 390, half: 64 },
  "home-jealous2": { tall: 390, half: 64 },
  "home-jealous3": { tall: 320, kind: "seat", half: 60, seat: 0.568, head: [0.49, 0.09] },
  "home-sleep": { tall: 164, kind: "floor", head: [0.47, 0.3], mark: ["zzz", 0.6, 0.13] },
  "home-tidy": { tall: 390, head: [0.58, 0.09], blush: false },
  "home-books": { tall: 390, head: [0.54, 0.1], blush: false },
  "home-feed": { tall: 215, kind: "crouch", half: 66, head: [0.34, 0.15], drop: -96, blush: false },
  "home-walk": { tall: 374, kind: "walk", faces: "left" },
});
/**
 * Кадры движения внутри позы (0.45.0, «больше кадров, чтоб казалась живой»): вторая картинка той же позы — та же
 * фигура точка в точку, изменено одно. Страница кладёт её поверх первой на то же место и показывает по-своему:
 * `sip` — изредка и ненадолго (подносит кружку к губам и отпивает), `glance` — подолгу (пишет, глядя в блокнот; а
 * первая картинка — подняла глаза), `dance` — попеременно, в такт, `pace` — второй кадр шага. Кадр — не поза: в списки состояний, в счёт поз
 * и в её слова о числе поз не входит; своего места, век и пара у него нет — они живут с первым кадром.
 */
export const HER_FRAMES = Object.freeze({
  tea3: ["tea3b", "sip"], "home-tea3": ["home-tea3b", "sip"],
  work: ["workb", "glance"], "home-work": ["home-workb", "glance"],
  play2: ["play2b", "dance", ""], "home-play2": ["home-play2b", "dance", ""],
  // 0.46.0. С кружкой у подоконника — отпивает; под гирляндой первая картинка сама «пьёт», поэтому кадр — «опустила
  // кружку», и показан он подолгу (`glance`); с книгой — переворачивает страницу; «идёт» — второй кадр шага
  // (`pace`: ноги вместе, ступня поднята) попеременно с первым (ноги в шаге). У «под гирляндой в свитере» кадра
  // пока нет: на нарисованном юбка вышла серой, а не тёмно-красной, — при смене кадров она бы мигала.
  tea: ["teab", "sip"], "home-tea": ["home-teab", "sip"],
  // 0.47.0: кадр «под гирляндой в свитере» нарисован заново — юбка осталась тёмно-красной.
  // Третье слово (0.48.0) — на каком кадре она смотрит на зрителя: его страница показывает, когда на неё нажали.
  // По умолчанию — на первом; под гирляндой первый кадр «пьёт» с закрытыми глазами — смотрит второй; танец не прерывается.
  tea2: ["tea2b", "glance", "b"], "home-tea2": ["home-tea2b", "glance", "b"],
  read: ["readb", "sip"], "home-read": ["home-readb", "sip"],
  walk: ["walkb", "pace"], "home-walk": ["home-walkb", "pace"],
  // 0.49.0 (сообщение 48: «поворот головы», «поправляет волосы, меняет положение рук»): кадры для пяти поз дня, у
  // которых движения не было. С блокнотом у подоконника: ручка у губ, смотрит на зрителя ↔ пишет, глаза в блокнот
  // (подолгу). В кресле с блокнотом: изредка поправляет волосы и смотрит в сторону. С метёлкой: взмах — вверх и
  // вниз, попеременно (`sweep`). С книгами: изредка оборачивается к зрителю — на этом кадре она и смотрит (`b`).
  // С ленточкой: лента взлетает волной. Четвёртое слово — рост кадра относительно позы: лента в свитере взлетает
  // выше головы, и картинка кадра выше картинки позы в 1,0714 раза (ступни — на той же линии).
  work2: ["work2b", "glance"], "home-work2": ["home-work2b", "glance"],
  work3: ["work3b", "sip"], "home-work3": ["home-work3b", "sip"],
  tidy: ["tidyb", "sweep", ""], "home-tidy": ["home-tidyb", "sweep", ""],
  books: ["booksb", "sip", "b"], "home-books": ["home-booksb", "sip", "b"],
  play3: ["play3b", "sweep", ""], "home-play3": ["home-play3b", "sweep", "", 1.0714],
});
/**
 * Поворот головы (0.53.0, идея 185: «больше движений»): третий кадр позы — та же фигура точка в точку, но голова
 * повёрнута в сторону; `l` и `r` — куда она на картинке смотрит (сторону художник выбирает сам: слова в просьбе ею не
 * управляют). Кадр виден, пока она смотрит в эту сторону — на Байта или в окно (слова страницы `.look-l`, `.look-r`):
 * первые два кадра на это время уходят. Заплаткой на лицо поворот не выходит (шов по волосам) — только целым кадром.
 */
export const HER_TURNS = Object.freeze({ work: ["workc", "r"], "home-work": ["home-workc", "l"], tea: ["teac", "r"], "home-tea": ["home-teac", "l"] });
export const turnOf = (name) => (typeof name === "string" && Object.hasOwn(HER_TURNS, name) ? HER_TURNS[name][0] : null);
const FRAME_NAMES = new Set([...Object.values(HER_FRAMES), ...Object.values(HER_TURNS)].map(([name]) => name));
/** Имя второго кадра этой картинки; `null` — кадра у неё нет. */
export const frameOf = (name) => (typeof name === "string" && Object.hasOwn(HER_FRAMES, name) ? HER_FRAMES[name][0] : null);
/**
 * Позы состояния (ключи те же, что у лиц: `MOODS`) — имена картинок в куртке, по порядку смены. У всех поз одного
 * состояния в руках одно и то же (кружка, блокнот, ленточка, плед): её слова в комнате верны для каждой.
 */
const SPRITE_OF = Object.freeze({
  "дело": ["work", "work2", "work3"], "уют": ["tea", "tea2", "tea3"], "игра": ["play", "play2", "play3"], "сон": ["sleep"],
  "устала": ["tired", "tired2", "tired3"], "обида": ["pout", "pout2"], "ревность": ["jealous", "jealous2", "jealous3"],
});
/** Состояние по имени картинки (без наряда и номера позы): `tired2` → «устала». Дела дня — «дело». */
const HER_MOOD = Object.freeze({ work: "дело", tea: "уют", read: "уют", play: "игра", sleep: "сон", tired: "устала", pout: "обида", jealous: "ревность", tidy: "дело", books: "дело", feed: "дело" });
/**
 * С какой позы начать: с той, что ближе к её словам. Сердце шлёт позу по её реплике: «танцую» — она танцует,
 * «дразню Байта ленточкой» — присела с ленточкой, «чай, кресло, плед» — сидит с кружкой, «пью чай» — пьёт.
 */
const SPRITE_FIRST = Object.freeze({
  "игра": { dance: "play2", ribbon: "play3" },
  "уют": { chair: "tea3", garland: "tea2" },
  "дело": { chair: "work3" }, "устала": { chair: "tired3" }, "ревность": { chair: "jealous3" },
});
/**
 * Картинка её реплики (0.44.0): по состоянию и месту, которое сердце читает из самих слов (`herPose`). Раньше слова
 * и картинки шли двумя списками по кругу и могли разойтись («разглядываю гирлянду» — а глаза закрыты). Теперь у
 * каждой реплики запаса «+комната:она:<состояние>» — своя строка здесь; тест сверяет словарь с этой таблицей.
 */
const SPRITE_FOR = Object.freeze({
  // `chair` — «в кресле» — у каждого состояния теперь сидящая картинка (0.47.0): до этого «у кресла, скрестив руки» и
  // «молчу, завернувшись в плед» показывались стоящей фигурой, а запасная фигура кодом в этих же местах сидела.
  // 0.48.0 — дела дня: «читаю учебник» — та же картинка с книгой; корм, метёлка и книги — свои картинки.
  "дело": { desk: "work", shelf: "work", sill: "work2", chair: "work3", read: "read", feed: "feed", dust: "tidy", sort: "books" },
  // `read` — в кресле с книгой (0.45.0): сама, по распорядку, или когда её усадили читать (полка с книгами, сценка
  // «что читать»). Это единственная картинка «уюта» без кружки — и её реплика говорит о книге, а не о чае.
  "уют": { chair: "tea3", sill: "tea", garland: "tea2", map: "tea", read: "read" },
  "игра": { dance: "play2", ribbon: "play3", shelf: "play" },
  "сон": { nap: "sleep", lie: "sleep" },
  "устала": { sill: "tired", chair: "tired3", desk: "tired", garland: "tired2" },
  "обида": { back: "pout", shelf: "pout2" },
  "ревность": { desk: "jealous2", chair: "jealous3", garland: "jealous" },
});
/** Имя картинки (в куртке) для реплики с этим местом; `null` — такой пары в таблице нет. */
export const lookOf = (key, pose) => (Object.hasOwn(SPRITE_FOR, key) && Object.hasOwn(SPRITE_FOR[key], pose) ? SPRITE_FOR[key][pose] : null);
/**
 * Наряд: названный (сердцем или страницей) или по часу — вечером и ночью домашний. Наряд без картинки этого состояния
 * не надевается. С 0.43.0 в свитере нарисована каждая поза: список поз вечером той же длины, что днём.
 */
function wearOf(view, key) {
  const named = HER_WEARS.includes(view.her.wear) ? view.her.wear : null;
  const wear = named ?? (view.part === "вечер" || view.part === "ночь" ? "home" : "jacket");
  return wear !== "jacket" && SPRITE_OF[key].some(pose => Object.hasOwn(HER_SPRITES, `${wear}-${pose}`)) ? wear : "jacket";
}
/** Все картинки для этого вида комнаты по порядку показа: первая — та, с которой она встречает. Её нет — пусто. */
export function spritesOf(view = {}) {
  if (!view?.her) return [];
  const key = Object.hasOwn(SPRITE_OF, view.her.key) ? view.her.key : "уют";
  const wear = wearOf(view, key);
  // Распорядок (`beat`): у реплики своя картинка — и только она; что у неё в руках, решает сердце (налили чай — «уют»).
  if (view.her.beat === true) {
    const base = lookOf(key, view.her.pose) ?? SPRITE_OF[key][0];
    return [wear !== "jacket" && Object.hasOwn(HER_SPRITES, `${wear}-${base}`) ? `${wear}-${base}` : base];
  }
  // Ей налили чай — в руках кружка, а не блокнот.
  const poses = key === "дело" && view.tea ? SPRITE_OF["уют"] : SPRITE_OF[key];
  const dressed = wear === "jacket" ? [] : poses.map(pose => `${wear}-${pose}`).filter(name => Object.hasOwn(HER_SPRITES, name));
  const list = dressed.length ? dressed : poses;
  // Первая поза — по её словам; в наряде — та же поза, если она в нём нарисована.
  const wanted = poses === SPRITE_OF[key] && Object.hasOwn(SPRITE_FIRST, key) && Object.hasOwn(SPRITE_FIRST[key], view.her.pose) ? SPRITE_FIRST[key][view.her.pose] : null;
  const first = wanted ? list.findIndex(name => name === wanted || name === `${wear}-${wanted}`) : -1;
  return first > 0 ? [...list.slice(first), ...list.slice(0, first)] : [...list];
}
/**
 * Имя спрайта для этого вида комнаты; `null` — её в комнате нет. `view.her.turn` — которая по счёту поза: страница
 * прибавляет его со временем и от нажатия, позы идут по кругу.
 */
export function spriteOf(view = {}) {
  const list = spritesOf(view);
  if (!list.length) return null;
  const turn = Number.isInteger(view.her.turn) && view.her.turn > 0 ? view.her.turn : 0;
  return list[turn % list.length];
}
/** Картинка «идёт» в том наряде, что на ней сейчас. */
export function walkOf(view = {}) {
  if (!view?.her) return null;
  const key = Object.hasOwn(SPRITE_OF, view.her.key) ? view.her.key : "уют";
  return wearOf(view, key) === "home" ? "home-walk" : "walk";
}
/** Свет часа на картинке: она нарисована при дневном свете, вечером и ночью её накрывает тень комнаты. */
const SPRITE_TINT = Object.freeze({ "утро": ["#ffe1cc", 0.05], "вечер": ["#2a1c45", 0.24], "ночь": ["#0e1238", 0.36] });
/** Картинка спрайта попадает в разметку как есть — поэтому только строка base64 и ничего больше. */
const SPRITE_SRC = /^data:image\/(?:webp|png);base64,[A-Za-z0-9+/=]+$/u;
const fitsSprite = (sprite) => Boolean(sprite) && typeof sprite === "object" && Number.isFinite(sprite.w) && Number.isFinite(sprite.h) && sprite.w > 0 && sprite.h > 0
  && typeof sprite.src === "string" && SPRITE_SRC.test(sprite.src);
/** «Веки»: заплатка с закрытыми глазами поверх спрайта (`scripts/room-blink.mjs`) — в точках самого спрайта, внутри него. */
const fitsPatch = (sprite, key) => { const lids = sprite?.[key]; return Boolean(lids) && typeof lids === "object" && [lids.x, lids.y, lids.w, lids.h].every(Number.isFinite) && lids.x >= 0 && lids.y >= 0 && lids.w > 0 && lids.h > 0
  && lids.x + lids.w <= sprite.w && lids.y + lids.h <= sprite.h && typeof lids.src === "string" && SPRITE_SRC.test(lids.src); };
const fitsBlink = (sprite) => fitsPatch(sprite, "blink");
/**
 * Сама картинка — её определение. На странице оно кладётся в рисунок один раз и остаётся там, а комната, сколько
 * бы её ни перерисовывали, только ссылается на него по имени (`<use>`): так картинка не грузится заново при каждом
 * нажатии и она не моргает. `drawRoom` кладёт определение сам — листам и тестам хватает одной строки.
 * У спрайта с «веками» определений два: сама картинка и заплатка на глаза; с улыбкой (0.50.0, `smile` — та же
 * заплатка, но на всё лицо: `scripts/room-blink.mjs … as=smile`) — три; со взглядом в сторону (0.51.0, `lookl` и
 * `lookr` — те же «веки», но зрачки смотрят вбок: `… as=lookr`) — ещё по одному.
 */
export function drawSprite(name, sprite) {
  if (!(Object.hasOwn(HER_SPRITES, name) || FRAME_NAMES.has(name)) || !fitsSprite(sprite)) return "";
  const lids = fitsBlink(sprite) ? `<image id="r-her-${name}-blink" x="${n(sprite.blink.x)}" y="${n(sprite.blink.y)}" width="${n(sprite.blink.w)}" height="${n(sprite.blink.h)}" preserveAspectRatio="none" href="${sprite.blink.src}"/>` : "";
  const grin = fitsPatch(sprite, "smile") ? `<image id="r-her-${name}-smile" x="${n(sprite.smile.x)}" y="${n(sprite.smile.y)}" width="${n(sprite.smile.w)}" height="${n(sprite.smile.h)}" preserveAspectRatio="none" href="${sprite.smile.src}"/>` : "";
  const gaze = ["lookl", "lookr"].map(key => (fitsPatch(sprite, key) ? `<image id="r-her-${name}-${key}" x="${n(sprite[key].x)}" y="${n(sprite[key].y)}" width="${n(sprite[key].w)}" height="${n(sprite[key].h)}" preserveAspectRatio="none" href="${sprite[key].src}"/>` : "")).join("");
  return `<image id="r-her-${name}" width="${n(sprite.w)}" height="${n(sprite.h)}" preserveAspectRatio="none" href="${sprite.src}"/>${lids}${grin}${gaze}`;
}

/**
 * Где её ступни: у переднего края ковра. Ниже нельзя: на странице поверх нижнего края рисунка лежит полоса с её
 * словами — ботинки ушли бы под неё. На полу, в пледе — чуть дальше от края.
 */
const FEET = 500, FEET_SIT = 490;
/**
 * Где она встаёт: у того, о чём её слова. Позу сердце шлёт по её реплике («за столом», «у полки», «в кресле»);
 * сидит она только в кресле, а встать рядом с названным местом может любой картинкой.
 */
const SPRITE_AT = Object.freeze({ desk: 252, shelf: 160, map: 160, chair: CHAIR.x, read: CHAIR.x, lie: 224, nap: 218, sill: 226, back: 226, garland: 226, dance: 226, ribbon: 226, feed: 172, dust: 168, sort: 168 });
/** Все её места по порядку: если на первом она закрыла бы Байта, встаёт на следующее. */
const SPRITE_SPOTS = Object.freeze([252, CHAIR.x, 226, 160]);
/** Сколько у двух областей общего. */
const overlap = ([ax, ay, aw, ah], [bx, by, bw, bh]) => Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx)) * Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
const kindOf = (name) => HER_SPRITES[name].kind ?? "stand";
/** Плед на ней самой: картинки «устала» (кутается в него стоя) и «спит» (на полу, в пледе) — в любом наряде. */
const plaidWorn = (name) => /^(?:tired|sleep)/u.test(String(name).replace(/^[a-z]+-/u, ""));
/**
 * Что она закрывает, встав в точку x. Стоя: волосы и куртка — до бёдер, ниже — ноги. Присев: голова и ниже — вся она.
 * В кресле: голова, ниже — плечи с волосами и руки с кружкой, ещё ниже — ноги. На полу в пледе: голова с плечами и
 * ниже — плед горкой.
 */
function spriteCovers(name, x) {
  const { tall, half = 58, legs = [-30, 30] } = HER_SPRITES[name], kind = kindOf(name);
  if (kind === "floor") return [[x - 60, FEET_SIT - tall + 8, 120, tall * 0.5 - 8], [x - 92, FEET_SIT - tall * 0.5, 184, tall * 0.5]];
  const top = FEET - tall;
  if (kind === "crouch") return [[x - 18, top, 54, tall * 0.34], [x - half + 4, top + tall * 0.3, half * 2 - 8, tall * 0.7]];
  if (kind === "seat") return [[x - 30, top, 60, tall * 0.2], [x - half + 2, top + tall * 0.2, half * 2 - 4, tall * 0.42], [x - 36, top + tall * 0.62, 72, tall * 0.38]];
  return [[x - half, top, half * 2, tall * 0.53], [x + legs[0], top + tall * 0.53, legs[1] - legs[0], tall * 0.47]];
}
/**
 * Места Байта, когда она стоит картинкой: по нескольку на каждое слово сердца, от привычного к запасным. Она
 * большая и стоит перед мебелью — он садится туда, где она его не закрывает (`herStand`). `kind` — как она на
 * картинке: от этого зависит, сколько места у её ног.
 */
function catAhead(place, shape, herX, name = "") {
  const kind = name ? kindOf(name) : "stand";
  const lap = (dx) => ({ x: CHAIR.x + dx, y: CHAIR.y - 6, layer: "lap" });
  // Она сидит в кресле — сиденье занято: Байт ложится на подлокотник, правый или левый (он тогда перед ней, сбоку).
  // Она стоит перед креслом — подлокотник за ней: такое место годится, только если она его не закрывает.
  const arm = (side) => ({ x: chairAt(side * 49, 0)[0], y: chairAt(0, -35)[1], bare: true, only: shape === "curl" ? "curl" : "lie", mirror: side < 0, ...(kind === "seat" ? { layer: "front", depth: FEET + 1 } : { layer: "lap" }) });
  switch (place) {
    // Последнее место (0.49.0) — правее, у самой Колючки: свернувшись, он шире, а она с пледом закрывает середину.
    case "sill": return [262, 294, 164, 148, 304].map(x => ({ x, y: 262, layer: "sill", shade: true }));
    case "chair": return shape === "claw" ? [{ x: chairAt(-60, 0)[0] - 13, y: CLAW_Y, layer: "front", mirror: true }, { x: chairAt(60, 0)[0] + 12, y: CLAW_Y, layer: "front" }]
      : kind === "seat" ? [arm(1), arm(-1)] : [lap(-22), lap(26), arm(-1), arm(1)];
    case "pillow": return [{ x: 300 + PILLOW_ASIDE, y: 485, layer: "front", bare: true }];
    // «Рядом с ней» — у её ног. Сначала с той стороны, где нет клубка: сядь Байт на клубок — нажатие по праву
    // клубка, а место для самого Байта ушло бы вниз, под полосу с её словами. Спит она на полу, в пледе, и
    // занимает середину ковра — он садится у её плеча, выше клубка. Присела — он чуть дальше: у пола она шире.
    case "near": {
      // Она насыпает корм (0.48.0) — Байт ест там, куда он сыплется: слева от неё, мордой к пакету, перед ней.
      if (shape === "eat" && name && Number.isFinite(HER_SPRITES[name].drop)) return [{ x: herX + HER_SPRITES[name].drop, y: 497, layer: "front", depth: FEET + 1, k: 1.2, mirror: true }];
      if (kind === "floor") return [{ x: 96, y: 456, layer: "front" }];
      // Сколько места занимают у пола её ноги — столько и отступить: влево и вправо по-разному (нога отведена).
      const [from, to] = kind === "seat" ? [-40, 40] : kind === "crouch" ? [-64, 64] : (name && HER_SPRITES[name].legs) || [-30, 30];
      const left = herX + from - 38, right = herX + to + 38;
      // Не у самого края рисунка и не под ёлкой в правом углу: туда за ним не дотянуться.
      const fits = [herX <= 226 ? right : left, herX <= 226 ? left : right].filter(x => x >= 40 && x <= 330);
      // Просится на руки (0.49.0) — вплотную к её ногам и лапами к ней: фигура тянется влево, слева от неё — отражена.
      if (shape === "beg") { const close = [herX <= 226 ? herX + to + 20 : herX + from - 20, herX <= 226 ? herX + from - 20 : herX + to + 20].filter(x => x >= 40 && x <= 330); return (close.length ? close : [Math.max(40, Math.min(330, herX + from - 20))]).map(x => ({ x, y: 497, layer: "front", k: 1.2, mirror: x < herX })); }
      return (fits.length ? fits : [Math.max(40, Math.min(330, left))]).map(x => ({ x, y: 497, layer: "front", k: 1.2 }));
    }
    case "under": {
      // Хвост из-под кресла — у правого края или у левого. Глаза — между ножками, там, где она их не закрывает; спит
      // она на ковре перед креслом и закрывает весь его низ — тогда от Байта виден один хвост, слева от кресла.
      const tails = [chairAt(64, 0)[0] + 8, chairAt(-64, 0)[0] - 8].map((x, index) => ({ x, y: UNDER_Y + 2, layer: "front", depth: UNDER_Y, mirror: index === 1, only: "tail" }));
      return shape === "tail" ? tails : [...[CHAIR.x, CHAIR.x - 30, CHAIR.x + 30, CHAIR.x - 58].map(x => ({ x, y: UNDER_Y, layer: "under", only: "eyes" })), tails[1]];
    }
    case "plaid": {
      // Плед на ней самой (картинки «устала» и «спит») — на кресле его нет, и хвосту торчать не из-под чего: Байт
      // устроился у неё под боком, на краю её пледа, — целиком на виду.
      if (plaidWorn(name)) {
        const side = kind === "floor" ? 96 : 68;
        return [herX + side, herX - side].filter(x => x >= 48 && x <= 352).map(x => ({ x, y: 497, layer: "front", depth: FEET + 1, k: 1.2, only: shape === "curl" ? "curl" : "lie", mirror: x < herX }));
      }
      return shape === "tail" ? [{ x: chairAt(52, 0)[0], y: chairAt(0, -4)[1], layer: "lap", mirror: true }] : kind === "seat" ? [arm(1), arm(-1)] : [lap(-22), lap(26)];
    }
    // Последнее место — у левого края ковра: туда он уходит, когда она спит посреди ковра, закутавшись в плед.
    case "rug": return [206, 150, 296, 112, 96].map(x => ({ x, y: 456, layer: "front" }));
    // Миска, стол, коробка, шкаф — в стороне от неё: места те же, что и без картинки.
    default: return [catSpot(place, shape, null)];
  }
}
/** Какую долю Байта она закрыла бы — меньше этого не в счёт: край хвоста за её волосами его не прячет. */
const HIDDEN_OK = 0.15;
/** В какой из прежних поз стоит фигура кодом, когда картинки позы 0.48.0 ещё нет: с метёлкой и с книгами — у полки, с кормом — рядом с Байтом. */
const CODE_POSE = Object.freeze({ feed: "ribbon", dust: "shelf", sort: "shelf" });
/** Клубок — забота: сядь Байт на него, клубка не видно, а нажатие по праву клубка. Место на клубке — как закрытое ею. */
const YARN = CARE_ZONES.play[2];
/**
 * Где встать ей и где сесть Байту, чтобы оба были видны. Сначала — её место по словам (`SPRITE_AT`) и его
 * привычное место; занято — его запасные; все закрыты — она отходит на следующее своё место. Если свободной пары
 * нет вовсе, берётся та, где он закрыт меньше всего. Сидит она только в кресле, спит — посреди ковра: с этих мест
 * она не уходит, уступает Байт.
 */
function herStand(name, pose, pet) {
  const kind = kindOf(name), fixed = kind === "seat" ? CHAIR.x : kind === "floor" ? SPRITE_AT.nap : null;
  const first = fixed ?? SPRITE_AT[pose] ?? SPRITE_SPOTS[0];
  const spots = fixed == null ? [first, ...SPRITE_SPOTS.filter(x => x !== first)] : [first];
  if (!pet) return { x: first, spot: null };
  const { asked, place } = catAsked(pet);
  let best = null;
  for (const x of spots) {
    const covers = spriteCovers(name, x);
    for (const spot of catAhead(place, asked, x, name)) {
      const box = catBoxAt(spot, catShapeAt(spot, asked, place));
      // Байт перед ней (на подлокотнике, у ног) ею не закрыт: он нарисован поверх.
      const ahead = spot.layer === "front" && (spot.depth ?? spot.y) > FEET;
      const hidden = ((ahead ? 0 : covers.reduce((sum, cover) => sum + overlap(cover, box), 0)) + overlap(YARN, box)) / (box[2] * box[3]);
      if (hidden <= HIDDEN_OK) return { x, spot };
      if (!best || hidden < best.hidden) best = { x, spot, hidden };
    }
  }
  return best;
}

/**
 * Для тестов и листов: где она встанет картинкой и какая доля Байта при этом закрыта ею или лежит на клубке (по
 * тем же меркам, по каким выбирается место). `null` — её в комнате нет.
 */
export function spriteStand(view = {}) {
  const name = view?.her?.away === true ? null : spriteOf(view);
  if (!name) return null;
  const pose = HER_POSES.includes(view.her.pose) ? view.her.pose : "desk";
  const stand = herStand(name, pose, view.cat ?? null);
  if (!stand.spot) return { name, x: stand.x, cat: null, hidden: 0 };
  const { asked, place } = catAsked(view.cat);
  const box = catBoxAt(stand.spot, catShapeAt(stand.spot, asked, place));
  const ahead = stand.spot.layer === "front" && (stand.spot.depth ?? stand.spot.y) > FEET;
  return { name, x: stand.x, cat: box, hidden: ((ahead ? 0 : spriteCovers(name, stand.x).reduce((sum, cover) => sum + overlap(cover, box), 0)) + overlap(YARN, box)) / (box[2] * box[3]) };
}

/** Куда ложится картинка: рост, ширина, левый верхний угол; `at` — сдвиг и размер для `<use>`, `box` — рамка. */
function spritePlace(name, sprite, x, grow = 1) {
  // `grow` — рост второго кадра относительно позы (0.49.0): кадр выше позы — ступни остаются на той же линии.
  const tall = HER_SPRITES[name].tall * (grow > 0 ? grow : 1), kind = kindOf(name);
  const k = tall / sprite.h, wide = sprite.w * k, axis = Number.isFinite(sprite.cx) && sprite.cx > 0.1 && sprite.cx < 0.9 ? sprite.cx : 0.5;
  const feet = kind === "floor" ? FEET_SIT : FEET, top = feet - tall, left = x - wide * axis;
  return { tall, kind, wide, feet, top, left, at: `transform="translate(${n(left)} ${n(top)}) scale(${Math.round(k * 10000) / 10000})"`, box: `x="${n(left)}" y="${n(top)}" width="${n(wide)}" height="${n(tall)}"` };
}
/** Картинка со светом часа: тень ложится только на неё — маской служит она сама. `extra` — то, что лежит под тенью вместе с ней (веки). */
function spriteLit(part, name, place, mask, extra = "") {
  const picture = `<use href="#r-her-${name}" ${place.at}/>`, tint = SPRITE_TINT[part];
  return `${picture}${extra}${tint ? `<mask id="${mask}" style="mask-type:alpha" maskUnits="userSpaceOnUse" ${place.box}>${picture}</mask><rect ${place.box} fill="${tint[0]}" opacity="${tint[1]}" mask="url(#${mask})"/>` : ""}`;
}
/** Сколько секунд она идёт: шаг — около семидесяти точек в секунду, но не короче секунды и не дольше трёх с половиной. */
export const walkSeconds = (from, to) => Math.round(Math.max(1, Math.min(3.5, Math.abs(to - from) / 70)) * 10) / 10;
/** За левым краем рисунка — дверь и шкаф: туда она уходит переодеться и оттуда возвращается. */
export const DOOR_X = -74;
/**
 * Она идёт: картинка «идёт» едет от `from` к `to` и покачивается в такт шагам (стили страницы: `.stride`, `.step`).
 * Куда она на картинке смотрит, записано у самой картинки (`faces` в `HER_SPRITES`); идёт в другую сторону —
 * отражением. В конце пути тает: на её месте проявляется новая поза.
 */
function herWalking(g, part, walker, from, to) {
  const place = spritePlace(walker.name, walker.sprite, to), seconds = walkSeconds(from, to);
  const first = spriteLit(part, walker.name, place, g.id("herMaskWalk"));
  // Шаг в два кадра (0.46.0): ноги в шаге — ноги вместе, ступня поднята; меняются в такт покачиванию (`.pace`).
  const second = walker.frame ? spritePlace(walker.name, walker.frame.sprite, to) : null;
  const lit = walker.frame
    ? `<g class="fr a pace">${first}</g><g class="fr b pace">${spriteLit(part, walker.frame.name, second, g.id("herMaskWalkB"))}</g>`
    : first;
  // Отражать ли: картинка смотрит влево, а идти вправо (или наоборот). Оба кадра шага отражаются вместе.
  const flipped = (to < from) !== (HER_SPRITES[walker.name]?.faces === "left");
  const stride = (body) => `<g class="stride" style="--dx:${n(from - to)}px;--t:${seconds}s"><g class="step">${flipped ? `<g transform="translate(${n(to * 2)} 0) scale(-1 1)">${body}</g>` : body}</g></g>`;
  // Её силуэт в пути — для вечерней тени на фоне окна (`airOnWalker`): те же группы и те же движения, что у самой
  // картинки «идёт», но одни картинки, без света часа.
  const bare = (name, at) => `<use href="#r-her-${name}" ${at.at}/>`;
  const shape = walker.frame ? `<g class="fr a pace">${bare(walker.name, place)}</g><g class="fr b pace">${bare(walker.frame.name, second)}</g>` : bare(walker.name, place);
  return { seconds, svg: stride(lit), shape: stride(shape) };
}
/**
 * Слой головы (0.49.0, сообщение 48: «поворот головы», «движение волос — небольшое, почти незаметное»). Картинка
 * цельная, отдельной головы у неё нет — поэтому поверх картинки лежит она же, обрезанная мягким овалом вокруг
 * головы. Пока слой неподвижен, он совпадает с картинкой точка в точку и его не видно; стили страницы наклоняют его
 * на градус-два вокруг шеи (`.hd`) и чуть сдвигают низ — концы волос (`.hr`). Край овала тает, поэтому шва нет: у
 * края слой прозрачен, и видна сама картинка. Веки и румянец — в слое: они наклоняются вместе с головой.
 */
function headLayer(g, name, place, x, y, inside) {
  const id = g.id("herHead"), soft = g.rad("hd", [[0, "#ffffff", 1], [0.66, "#ffffff", 1], [1, "#ffffff", 0]]);
  const mask = `<mask id="${id}" maskUnits="userSpaceOnUse" x="${n(x - 44)}" y="${n(y - 45)}" width="88" height="96"><ellipse cx="${n(x)}" cy="${n(y + 3)}" rx="42" ry="46" fill="${soft}"/></mask>`;
  return `${mask}<g class="hd" style="transform-origin:${n(x)}px ${n(y + 30)}px"><g class="hr" style="transform-origin:${n(x)}px ${n(y - 24)}px"><g mask="url(#${id})"><use href="#r-her-${name}" ${place.at}/>${inside}</g></g></g>`;
}
/**
 * Метки-эмоции у головы (0.49.0, «разные реакции глаз: удивление, интерес, сонливость, недовольство»): «!», «?»,
 * «жилка» недовольства, капля усталости, «z z». Нарисованы всегда и не видны, пока страница не покажет нужную
 * (стили: `.g-bang`, `.g-ask`, `.g-huff`, `.g-sigh`, `.g-yawn`). Глаза при этом — веками: зажмурилась, моргнула дважды.
 */
function emoMarks(x, y) {
  const font = `text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-weight="700" stroke="#3a2412" stroke-width="0.7" paint-order="stroke"`;
  // Знаки — украшение рисунка: программе чтения с экрана их называть не нужно («восклицательный знак», «z»).
  const mark = (name, body) => `<g class="emo e-${name}" opacity="0" aria-hidden="true">${body}</g>`;
  return [
    mark("bang", `<text x="${n(x + 27)}" y="${n(y - 20)}" font-size="17" fill="#ffd166" ${font}>!</text>`),
    mark("ask", `<text x="${n(x + 27)}" y="${n(y - 20)}" font-size="16" fill="#9ad7ff" ${font}>?</text>`),
    mark("huff", `<path transform="translate(${n(x + 26)} ${n(y - 28)})" d="M-5.5 -2q3.5 0 3.5 -3.5M5.5 -2q-3.5 0 -3.5 -3.5M-5.5 2q3.5 0 3.5 3.5M5.5 2q-3.5 0 -3.5 3.5" fill="none" stroke="#e2364f" stroke-width="1.9" stroke-linecap="round"/>`),
    mark("drop", `<path d="M${n(x + 28)} ${n(y - 36)}q4.2 5.8 4.2 8.4a4.2 4.2 0 0 1 -8.4 0q0 -2.6 4.2 -8.4z" fill="#bfe6ff" stroke="#3a6a8a" stroke-width="0.6"/>`),
    mark("zz", `<text x="${n(x + 25)}" y="${n(y - 20)}" font-size="12" fill="#ffffff" ${font}>z</text><text x="${n(x + 33)}" y="${n(y - 29)}" font-size="9" fill="#ffffff" ${font}>z</text>`),
  ].join("");
}
/**
 * Она — картинкой: ссылка на определение спрайта (`drawSprite`), тень под ногами, свет часа, веки, место нажатия и
 * место, где её гладят (голова). `ghost` — её прежняя поза `{ name, sprite, x }`: она тает, пока новая проявляется;
 * стояла в другом месте и есть картинка «идёт» (`walker`) — доходит до нового места шагом.
 */
function herPainted(g, c, f, part, name, sprite, x, ghost = null, walker = null, frame = null, face = "", turn = null) {
  const place = spritePlace(name, sprite, x), { tall, kind, wide, feet, top, left } = place, low = kind === "floor";
  // Веки — заплатка с закрытыми глазами: моргает; клюёт носом (`face: "drowsy"`) — моргает медленно (`.slow`).
  // Румянец (0.48.0) — два пятна под глазами, по месту той же заплатки; не виден, пока её не погладят или не нальют
  // ей чай (стили страницы: `.patted`, `.glad`). Ложится он только на кожу: маской служит сама картинка — мимо
  // фигуры его нет, — а смешение «умножением» прячет его на тёмных волосах: у лица в три четверти дальнее пятно
  // приходится на волосы или мимо головы (лист с румянцем смотрели при 0.48.0 — без этого пятно висело в воздухе).
  // У четырёх поз лицо повёрнуто или наклонено так, что пятно пришлось бы на нос или рот, — у них в таблице `blush: false`.
  const eyes = fitsBlink(sprite) ? sprite.blink : null, blushId = g.id("herBlush"), rosy = HER_SPRITES[name].blush !== false;
  const cheek = (share) => `<ellipse cx="${n(eyes.x + eyes.w * share)}" cy="${n(eyes.y + eyes.h * 1.12)}" rx="${n(eyes.w * 0.1)}" ry="${n(eyes.w * 0.055)}"/>`;
  const blush = eyes && rosy ? `<mask id="${blushId}" style="mask-type:alpha" maskUnits="userSpaceOnUse" ${place.box}><use href="#r-her-${name}" ${place.at}/></mask><g class="blush" opacity="0" mask="url(#${blushId})" style="mix-blend-mode:multiply"><g fill="#ff5f7a" ${place.at}>${cheek(0.27)}${cheek(0.73)}</g></g>` : "";
  // Улыбка (0.50.0, сообщение 51 — «продолжай генерацию»): заплатка на всё лицо — глаза закрыты дугами, губы
  // улыбаются. Сама не видна (`opacity="0"`): её показывают стили страницы — пока её гладят, когда налили чай или
  // что-то подарили и жестом между делами (`.patted`, `.glad`, `.g-smile`). Лежит поверх век: закрытые глаза под ней те же.
  const grin = eyes && fitsPatch(sprite, "smile") ? `<use class="grin" opacity="0" href="#r-her-${name}-smile" ${place.at}/>` : "";
  // Взгляд в сторону (0.51.0, сообщение 52 — «доделывай оставшиеся дела»): заплатка на глаза — зрачки смотрят вбок.
  // Не видна, пока страница не поставит на рисунок слово «смотрит влево / вправо» (`.look-l`, `.look-r` — те же, что
  // чуть поворачивают голову). Лежит под веками: моргать не мешает.
  const gaze = eyes ? ["l", "r"].map(side => (fitsPatch(sprite, `look${side}`) ? `<use class="ey${side}" opacity="0" href="#r-her-${name}-look${side}" ${place.at}/>` : "")).join("") : "";
  const lids = eyes ? `${gaze}<use class="wink${face === "drowsy" ? " slow" : ""}" href="#r-her-${name}-blink" ${place.at}/>${grin}${blush}` : "";
  const [mark, mx, my] = HER_SPRITES[name].mark ?? [], px = left + wide * (mx ?? 0), py = top + tall * (my ?? 0);
  const alive = mark === "steam" ? `<g class="steam" fill="none" stroke="#ffffff" stroke-width="1.3" stroke-linecap="round" opacity="0.6"><path d="M${n(px - 2.4)} ${n(py)} q-3 -4 0 -8 q3 -4 0 -7"/><path d="M${n(px + 2.8)} ${n(py - 1)} q3 -4 0 -8"/></g>`
    : mark === "zzz" ? zzz(f, n(px), n(py)) : "";
  // Она дышит: картинка чуть растёт и опадает от ступней (стили страницы, `.alive`); пар и «z z Z» живут своей жизнью.
  // Второй кадр той же позы (`HER_FRAMES`) — поверх первого, на том же месте: ось тела у них общая. Веки и пар —
  // внутри первого кадра: пока она отпивает, кружки на коленях нет, и пара над ней тоже.
  // Слой головы (0.49.0) — у стоящей, сидящей и присевшей; спит на полу или идёт — без него (веки тогда на самой картинке).
  const [hx, hy] = HER_SPRITES[name].head ?? [null, 0.07], headX = hx == null ? x : left + wide * hx, headY = top + tall * hy;
  const headed = !low && kind !== "walk";
  const lit = spriteLit(part, name, place, g.id("herMask"), headed ? headLayer(g, name, place, headX, headY, lids) : lids);
  // Кадр, на котором она смотрит на зрителя, помечен `lk`, второй — `nl`: нажали на неё — страница показывает первый
  // (`.poked`): подняла глаза. У танца пометок нет — он не прерывается.
  const looks = frame ? HER_FRAMES[name]?.[2] ?? "a" : "", seen = (which) => (looks ? (looks === which ? " lk" : " nl") : "");
  // Третий кадр — голова повёрнута (0.53.0, `HER_TURNS`): лежит поверх первых двух и не виден, пока она не посмотрит
  // в его сторону; сторона — словом на группе (`tl`, `tr`), чтобы стили страницы знали, какой взгляд его открывает.
  const turned = turn ? `<g class="fr c">${spriteLit(part, turn.name, spritePlace(name, turn.sprite, x), g.id("herMaskC"))}</g>` : "";
  const group = turn ? `alive t${turn.side}` : "alive";
  const core = frame
    ? `<g class="${group}"><g class="fr a ${frame.how}${seen("a")}">${lit}${alive}</g><g class="fr b ${frame.how}${seen("b")}">${spriteLit(part, frame.name, spritePlace(name, frame.sprite, x, frame.grow), g.id("herMaskB"))}</g>${turned}</g>`
    : turn ? `<g class="${group}"><g class="fr a">${lit}</g>${turned}</g>${alive}` : `<g class="alive">${lit}</g>${alive}`;
  // Стоя она ещё и чуть покачивается (0.48.0, «небольшие движения головы»): вся фигура, от ступней; голова идёт дальше всех.
  // Три слоя движения (0.49.0, «разделить переходы, мимику и постоянное состояние»): переход — снаружи (`.arrive`,
  // `.leave`, `.lower`, `.rise`); мимика — `.mim` (вздрогнула, вздохнула, наклонилась) и слой головы; постоянное —
  // внутри (`.lean`, `.alive`). Реакция больше не подменяет дыхание: они складываются. Настроение — словом на слое
  // мимики (`m-calm`, `m-tired`…). Метки-эмоции — рядом с головой, вне покачивания.
  const mood = MOODS[HER_MOOD[name.replace(/^[a-z]+-/u, "").replace(/\d$/u, "")] ?? ""] ?? "calm";
  const body = `<g class="mim m-${mood}">${kind === "stand" ? `<g class="lean">${core}</g>` : core}</g>${headed ? emoMarks(headX, headY) : ""}`;
  // Садится — опускается, встаёт — поднимается (0.48.0, «естественные переходы между сидячими и стоячими позами»).
  const down = kind === "stand" ? "" : " lower", up = ghost && !["stand", "walk"].includes(kindOf(ghost.name)) ? " rise" : "";
  const before = ghost ? spritePlace(ghost.name, ghost.sprite, ghost.x) : null;
  // Идёт, а не тает на месте: когда стояла (или сидела) в другой точке, сама не на полу и картинка «идёт» загружена.
  const walk = ghost && walker && Math.abs(ghost.x - x) >= 12 && !low && kindOf(ghost.name) !== "floor" ? herWalking(g, part, walker, ghost.x, x) : null;
  const reach = low ? 30 : kind === "stand" ? 22 : 25;
  const shade = shadow(g, x + (low ? 0 : 2), feet - 2, low ? wide * 0.44 : kind === "stand" ? 36 : wide * 0.36, low ? 7 : 6, 0.34);
  const was = before ? `<g class="leave${up}">${spriteLit(part, ghost.name, before, g.id("herMaskWas"))}</g>` : "";
  return {
    y: feet, painted: name, walk: walk?.seconds ?? 0, walkShape: walk?.shape ?? "",
    // Как проявляется новая поза и тает ли прежняя: так же появляется и уходит вечерняя тень на ней (`airOnHerMoving`).
    enter: walk ? `<g class="arrive late${down}" style="--t:${walk.seconds}s">` : before ? `<g class="arrive${down}">` : "", left: Boolean(before),
    front: walk
      ? `${was}${walk.svg}<g class="arrive late${down}" style="--t:${walk.seconds}s">${shade}${body}</g>`
      : `${shade}${before ? `${was}<g class="arrive${down}">${body}</g>` : body}`,
    // Нажатие — по ней самой, а не по всей картинке: волосы и плед по краям не отнимают нажатий у вещей за ней.
    zone: low ? [x - wide * 0.3, top + 14, wide * 0.6, tall - 20] : kind === "stand" ? [x - 28, top + 6, 56, tall - 12] : [x - 36, top + 8, 72, tall - 14],
    // Голова — отдельное место поверх: по голове её гладят.
    head: [Math.max(2, Math.min(WIDTH - reach * 2 - 2, headX - reach)), Math.max(2, headY - reach), reach * 2, reach * 2],
  };
}
/**
 * Её вещи и подарки (0.49.0, сообщение 48: «личные предметы… некоторые появляются после значимых событий»; идея 163 —
 * подарки). Её вещи — следы её событий: наброски, приклеенные к стеклу (до трёх), открытка с небом на подоконнике,
 * найденная книга на табурете. Подарки человека: цветок в вазе и книга — на шкафу, игрушечная мышь — на полу у миски.
 * Что из этого есть, говорит сердце (`view.own`, `view.gifts`); нажатий у них нет — о них рассказывает альбом.
 */
const ownOf = (view) => ({ sketches: Math.max(0, Math.min(3, Math.floor(Number(view?.own?.sketches) || 0))), book: view?.own?.book === true, card: view?.own?.card === true });
const giftsOf = (view) => new Set((Array.isArray(view?.gifts) ? view.gifts : []).filter(kind => ["flower", "book", "toy"].includes(kind)));
function sketches(c, count) {
  const doodles = [
    `<path d="M3 9.6 l1 -4 l2 2 q1 -0.6 2 0 l2 -2 l1 4 q0.4 3.4 -4 3.4 q-4.4 0 -4 -3.4z" fill="${c.cat}"/>`,
    `<path d="M6 3.6 l1.1 2.6 l2.8 0.2 l-2.1 1.8 l0.7 2.7 l-2.5 -1.5 l-2.5 1.5 l0.7 -2.7 l-2.1 -1.8 l2.8 -0.2z" fill="${c.gold}"/>`,
    `<path d="M6 11 q-5 -3.6 -3.2 -6.4 q1.6 -2 3.2 0.4 q1.6 -2.4 3.2 -0.4 q1.8 2.8 -3.2 6.4z" fill="${c.red}"/>`,
  ];
  return [[153, 207, -6], [169, 213, 5], [160, 228, -3]].slice(0, count).map(([x, y, turn], index) => `<g transform="translate(${x} ${y}) rotate(${turn})"><rect x="0.6" y="0.8" width="12" height="15" rx="0.8" fill="#1a0f1e" opacity="0.18"/><rect width="12" height="15" rx="0.8" fill="${c.paper}"/>${doodles[index]}<rect x="3.4" y="-1.4" width="5.2" height="2.6" fill="${c.plaidLight}" opacity="0.85"/></g>`).join("");
}
const skyCard = (c) => `<g transform="rotate(-7 204 262)"><rect x="198" y="245" width="12" height="17" rx="0.8" fill="${c.paper}"/><rect x="199.2" y="246.2" width="9.6" height="11.4" fill="#f0a36b"/><rect x="199.2" y="246.2" width="9.6" height="5" fill="#8a7fc0"/><circle cx="204" cy="253.4" r="2.2" fill="#ffe2a6"/></g>`;
const foundBook = (c) => `<rect x="${STOOL.rest - 11}" y="${STOOL.y - 5}" width="22" height="5" rx="0.9" fill="${c.plaid}"/><rect x="${STOOL.rest - 11}" y="${STOOL.y - 5}" width="22" height="1.4" rx="0.7" fill="${c.plaidLight}"/><path d="M${STOOL.rest + 5} ${STOOL.y - 5} v7.4 l1.5 -1.4 l1.5 1.4 v-7.4z" fill="${c.red}"/>`;
const giftFlower = (c) => `<path d="M22 158 q-1.6 -8 1 -15" fill="none" stroke="${c.greenDark}" stroke-width="1.4" stroke-linecap="round"/><path d="M22.4 152 q4 -1.6 5 -5 q-4.4 0 -5 5z" fill="${c.green}"/><g fill="${c.red}"><circle cx="23" cy="140.6" r="2.4"/><circle cx="20.2" cy="142.6" r="2.4"/><circle cx="25.8" cy="142.6" r="2.4"/><circle cx="21.4" cy="145.6" r="2.4"/><circle cx="24.8" cy="145.6" r="2.4"/></g><circle cx="23" cy="143.4" r="1.7" fill="${c.gold}"/><path d="M17.6 157 h9.6 l-1.2 13 h-7.2z" fill="${c.plaidLight}"/><path d="M17.6 157 h9.6 l-0.3 2.6 h-9z" fill="${lt(c.plaidLight, 0.45)}"/>`;
const giftBook = (c) => `<rect x="34" y="164.6" width="25" height="5.4" rx="0.9" fill="${c.greenDark}"/><rect x="34" y="164.6" width="25" height="1.5" rx="0.7" fill="${c.green}"/><rect x="37" y="166.6" width="7" height="1.6" fill="${c.gold}"/>`;
const giftToy = (f) => `<g transform="translate(34 476)"><ellipse cx="0" cy="1.6" rx="8" ry="2" fill="#1a0f1e" opacity="0.2"/><ellipse cx="0" cy="-2.4" rx="6.6" ry="4" fill="${f.rugLight}"/><circle cx="-4" cy="-5.6" r="2" fill="${f.rugLight}"/><circle cx="-5.4" cy="-2.2" r="0.8" fill="${f.ink}"/><path d="M6.4 -2 q5 -3.6 7 1.4" fill="none" stroke="${f.rugLight}" stroke-width="1.2" stroke-linecap="round"/></g>`;
/**
 * Её картинка ещё в пути (0.49.0): на её месте — мягкий силуэт и три точки, чтобы было видно, что она появляется, а
 * не пропала. Ждёт, сколько нужно: с 0.52.0 код рисует её, только если картинку не может показать сам телефон;
 * картинка пришла — силуэт сменяется ею.
 */
function herComing(x) {
  const dots = [-10, 0, 10].map((dx, index) => `<circle class="dot d${index}" cx="${n(x + dx)}" cy="330" r="3.2" fill="#ffffff"/>`).join("");
  return { y: FEET, front: `<g class="coming" role="img" aria-label="Аи появляется"><ellipse cx="${n(x)}" cy="${FEET - 3}" rx="34" ry="6" fill="#1a0f1e" opacity="0.2"/><path d="M${n(x - 24)} ${FEET - 4} q-6 -170 4 -262 a20 23 0 1 1 40 0 q10 92 4 262 z" fill="#ffffff" opacity="0.14"/>${dots}</g>` };
}
/**
 * Её нет в комнате: ушла к шкафу переодеться. На её месте — надпись «*переодевается*» (так просил владелец);
 * `delay` — через сколько секунд надпись проявится: пока она идёт к двери, надписи ещё нет.
 */
function changingNote(delay = 0) {
  const note = `<g class="changing"><rect x="146" y="296" width="132" height="27" rx="13.5" fill="#1a0f1e" opacity="0.56"/><text x="212" y="314" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="12.5" font-style="italic" fill="#ffffff">*переодевается*</text></g>`;
  return delay > 0 ? `<g class="arrive late" style="--t:${n(delay)}s">${note}</g>` : note;
}
/** Она уходит за левый край (к шкафу): прежняя поза тает, картинка «идёт» доходит до двери и пропадает. */
function herLeaving(g, part, ghost, walker) {
  const before = spritePlace(ghost.name, ghost.sprite, ghost.x);
  const walk = walker ? herWalking(g, part, walker, ghost.x, DOOR_X) : null;
  return { y: FEET, walk: walk?.seconds ?? 0.5, walkShape: walk?.shape ?? "", left: true, front: `<g class="leave">${spriteLit(part, ghost.name, before, g.id("herMaskWas"))}</g>${walk?.svg ?? ""}`, note: changingNote(walk?.seconds ?? 0.5) };
}

// ── Байт ─────────────────────────────────────────────────────────────────────
// Серый кот: полоски на спине, лбу и хвосте, светлая грудь и лапы, жёлтые глаза. Сидя — ей по колено.
const fur = (g, f) => g.lin("fur", [[0, lt(f.cat, 0.2)], [0.55, f.cat], [1, mix(f.cat, f.catDark, 0.6)]]);
const stripes = (f, d, w = 1.7) => `<path d="${d}" fill="none" stroke="${f.catDark}" stroke-width="${w}" stroke-linecap="round" opacity="0.85"/>`;
/** Хвост: толстая линия с полосками поперёк и тёмным кончиком. `cls` — как он движется. */
function catTail(f, d, rings, { cls = "tailwag", tip = "" } = {}) {
  return `<g class="${cls}"><path d="${d}" fill="none" stroke="${f.cat}" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round"/>${rings ? stripes(f, rings, 1.6) : ""}${tip ? `<path d="${tip}" fill="none" stroke="${f.catDark}" stroke-width="6.4" stroke-linecap="round"/>` : ""}</g>`;
}
const catPaw = (f, x, y, rx = 4.2) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="2.7" fill="${f.catLight}"/><path d="M${x - 1.4} ${y - 0.6} v2 M${x + 1.2} ${y - 0.6} v2" stroke="${f.cat}" stroke-width="0.7" stroke-linecap="round"/>`;

/**
 * Лапа идущего Байта (0.46.0): две части — от плеча (бедра) до сгиба и от сгиба до подушечки. Каждая часть качается
 * стилями страницы вокруг своего начала (`.lg.up`, `.lg.low`): на полу лапа уходит назад прямой, в воздухе сгибается
 * и выносится вперёд. `far` — дальняя лапа (темнее); `turn` — которой по счёту она ступает: задняя, передняя с той
 * же стороны, задняя с другой, передняя с другой — так ходят коты. Без стилей лапа стоит прямо: он просто стоит.
 */
function catLeg(f, x, y, far, turn) {
  const ink = `fill="none" stroke="${far ? f.catDark : f.cat}" stroke-width="${far ? 5.6 : 5.8}" stroke-linecap="round"`;
  return `<g transform="translate(${x} ${y})"><g class="lg up p${turn}"><path d="M0 0 V8.2" ${ink}/><g transform="translate(0 8.2)"><g class="lg low p${turn}"><path d="M0 0 V6" ${ink}/>${catPaw(f, -0.8, 7.2, 3.8)}</g></g></g></g>`;
}

/**
 * Морда. Точка отсчёта — центр. `eyes` — open, closed, wide (круглые зрачки: просит), play (шалит: круглые зрачки,
 * кончик языка), sad (обижен: бровки домиком). Прищура — века с опущенным внутренним краем — больше нет (0.52.0,
 * сообщение 53: «не нравится вот эта вот хмурая или же хитрая морда кота, есть что-то приятное?»): он был у «шалит»,
 * а это самое частое его состояние, — и Байт хмурился почти всегда.
 */
function catHead(g, f, eyes = "open") {
  const round = eyes === "wide" || eyes === "play" || eyes === "sad";
  const eye = (s) => {
    const x = s * 6.6, y = -1.8;
    if (eyes === "closed") return `<path d="M${n(x - 3.6)} ${n(y - 0.2)} q3.6 3.2 7.2 0" fill="none" stroke="${f.ink}" stroke-width="1.4" stroke-linecap="round"/>`;
    const ball = [
      `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${round ? 4 : 3.7}" ry="${round ? 4.4 : 4.1}" fill="${g.lin("catEye", [[0, f.catEyeDark], [0.45, f.catEye], [1, lt(f.catEye, 0.35)]])}" stroke="${f.ink}" stroke-width="0.7"/>`,
      // Зрачок: круглый — когда просит, шалит или обижен; в покое — овальный, но не щёлкой: щёлка смотрит строго.
      round ? `<circle cx="${n(x)}" cy="${n(y + (eyes === "sad" ? 0.9 : 0.2))}" r="2.7" fill="#1c1a22"/>` : `<ellipse cx="${n(x)}" cy="${n(y + 0.1)}" rx="2.1" ry="3.3" fill="#1c1a22"/>`,
      `<circle cx="${n(x - 1.1)}" cy="${n(y - 1.6)}" r="${round ? 1.2 : 1.05}" fill="#ffffff"/><circle cx="${n(x + 1.3)}" cy="${n(y + 1.6)}" r="${round ? 0.7 : 0.55}" fill="#ffffff"/>`,
    ];
    // Обижен: бровки домиком — жалобно, а не сердито.
    const brow = eyes === "sad" ? `<path d="M${n(x + s * 3.6)} ${n(y - 4.6)} L${n(x - s * 3)} ${n(y - 6.8)}" fill="none" stroke="${f.catDark}" stroke-width="1.2" stroke-linecap="round"/>` : "";
    return `<g class="blink">${ball.join("")}</g>${brow}`;
  };
  const ear = (s) => `<path d="M${s * 14.8} -4.6 L${s * 13.6} -22 L${s * 2.2} -12.6Z" fill="${f.cat}"/><path d="M${s * 12.6} -8.6 L${s * 12} -17.8 L${s * 5.6} -12.4Z" fill="${f.catEar}"/>`;
  const mouth = eyes === "sad" ? `<path d="M0 4.7 v1.6 M-2.6 8 q2.6 -2.2 5.2 0" fill="none" stroke="${f.ink}" stroke-width="0.85" stroke-linecap="round"/>`
    : `${eyes === "play" ? `<path d="M-1.7 6.5 h3.4 v1.3 a1.7 1.9 0 0 1 -3.4 0z" fill="#f08aa8"/>` : ""}<path d="M0 4.7 v1.3 M0 6 q-2.4 2.2 -4.4 0.2 M0 6 q2.4 2.2 4.4 0.2" fill="none" stroke="${f.ink}" stroke-width="0.85" stroke-linecap="round"/>`;
  return [
    ear(-1), ear(1),
    `<path d="M-15.4 -1 C-15.4 -10 -9 -13.8 0 -13.8 C9 -13.8 15.4 -10 15.4 -1 L19 3 L15.2 3.8 L17.4 7.6 L12.6 7.6 C9 10.8 5 12 0 12 C-5 12 -9 10.8 -12.6 7.6 L-17.4 7.6 L-15.2 3.8 L-19 3Z" fill="${fur(g, f)}"/>`,
    stripes(f, "M0 -13.2 v4.6 M-4.6 -12.6 l0.9 3.9 M4.6 -12.6 l-0.9 3.9", 1.6),
    stripes(f, "M-15 0.6 h3.6 M15 0.6 h-3.6 M-14.6 -3 l3.4 0.7 M14.6 -3 l-3.4 0.7", 1.2),
    `<ellipse cx="0" cy="5.2" rx="7.8" ry="5.4" fill="${f.catLight}"/>`,
    eye(-1), eye(1),
    `<path d="M-2 2.3 h4 l-2 2.4z" fill="${f.nose}"/>`,
    mouth,
    `<path d="M-8.6 4.4 L-22 2 M-8.6 5.8 L-22.6 6.2 M-8.6 7 L-21 10 M8.6 4.4 L22 2 M8.6 5.8 L22.6 6.2 M8.6 7 L21 10" stroke="${f.white}" stroke-width="0.6" stroke-linecap="round" opacity="0.9"/>`,
  ].join("");
}

/**
 * Байт. Точка отсчёта — середина у пола; смотрит влево или на зрителя. Фигуры: sit — сидит; lie — лежит; curl —
 * спит клубком; walk — идёт; play — в прыжке за игрушкой; eat — ест; claw — точит когти, стоя; eyes — одни глаза
 * из темноты; tail — один хвост; belly — на спине, лапы кверху.
 */
function catShape(g, f, shape, { eyes = "open", angry = false, gait = false } = {}) {
  const coat = fur(g, f);
  const wag = angry ? "tailwag angry" : "tailwag";
  switch (shape) {
    case "lie": return [
      catTail(f, "M22 -5 Q35 -3 31 4 Q26 6.6 6 3.6", "M30.6 -1 l3.4 -1.6 M29.6 4.4 l1.4 3 M20 3.2 l-0.6 3.4 M12 2.4 l-0.6 3.4", { cls: wag }),
      `<path d="M-24 0 C-29 -8 -24 -19.6 -9 -21 C6 -23.4 23 -21 27 -10.6 C29 -4 27 0 22 0Z" fill="${coat}"/>`,
      stripes(f, "M-1 -21.6 q-1.6 5 0.6 9.4 M7 -22.2 q-1.6 5 0.6 9.6 M15 -21.4 q-1.2 5 1 9 M22 -18 q-0.6 4 1 7.4"),
      catPaw(f, -22, -2.2, 6), catPaw(f, -12.6, -1.6, 6),
      at(-18, -22, catHead(g, f, eyes)),
    ].join("");
    case "curl": return [
      `<ellipse cx="1" cy="-11.6" rx="23" ry="12.4" fill="${coat}"/>`,
      stripes(f, "M-2 -23.6 q-1.8 5 0.2 9 M6 -23.6 q-1 5 1 9.4 M14 -21.6 q0 4.6 2 8.4 M-10 -22 q-2.4 4.4 -1 8.4"),
      // Голова уложена на лапы, хвост обнимает бок.
      `<g transform="translate(-13.4 -9.6) rotate(-14)"><path d="M-12 -2.6 L-11.6 -14.6 L-3 -8.6Z M9 -6 L13.4 -15.4 L15.4 -4Z" fill="${f.cat}"/><path d="M-10.6 -5 L-10.4 -11.4 L-5.6 -8Z" fill="${f.catEar}"/><ellipse cx="0" cy="0" rx="13.4" ry="10" fill="${coat}"/>${stripes(f, "M0 -9.6 v3.6 M-4 -9 l0.8 3.2 M4 -9 l-0.8 3.2", 1.4)}<ellipse cx="-1" cy="4.2" rx="6.4" ry="4.2" fill="${f.catLight}"/><path d="M-9 -0.4 q3 2.6 6 0 M2 -0.4 q3 2.6 6 0" fill="none" stroke="${f.ink}" stroke-width="1.3" stroke-linecap="round"/><path d="M-2.6 2.2 h3.4 l-1.7 2z" fill="${f.nose}"/></g>`,
      catTail(f, "M23 -9 Q27 2.6 8 2 Q-8 1.6 -17 -1", "M19 0.6 l1.6 3 M10 -0.6 l0.4 3.4 M1 -1 l0 3.4 M-8 -1.6 l-0.6 3.2", { cls: "", tip: "M-13 -0.2 L-17 -1" }),
    ].join("");
    case "walk": return [
      catTail(f, "M21 -25 Q33 -33 30 -49", "M26.6 -31.6 l3.4 2.4 M29.4 -37.6 l3.6 0.6 M28.6 -43.6 l3.6 -0.8", { cls: wag, tip: "M30.4 -46 L30 -49" }),
      // `gait` — он идёт (0.46.0): лапы — отдельными частями, шагают по очереди; иначе — прежняя неподвижная фигура.
      gait ? catLeg(f, -7, -17, true, 3) + catLeg(f, 19.5, -17.4, true, 2)
        : `<path d="M-6 -14 L-3.4 -2.6 M19 -15 L22.6 -2.6" stroke="${f.catDark}" stroke-width="5.6" stroke-linecap="round"/>${catPaw(f, -3, -1.6, 3.8)}${catPaw(f, 23, -1.6, 3.8)}`,
      `<path d="M-19 -22 C-19 -30.6 -8 -32.6 4 -32 C18 -32 25 -26.6 24 -18.6 C23 -12 12 -10.6 0 -11.2 C-10 -11.2 -19 -13 -19 -22Z" fill="${coat}"/>`,
      stripes(f, "M-3 -32 q-1.6 4.6 0.2 8.6 M5 -32.4 q-1.4 4.8 0.4 9 M13 -31.6 q-1 4.6 0.8 8.6 M20 -28.6 q-0.4 3.6 1 6.6"),
      gait ? catLeg(f, -12.4, -17, false, 1) + catLeg(f, 14.6, -17, false, 0)
        : `<path d="M-13 -14 L-18.6 -2.6 M13 -14 L9 -2.6" stroke="${f.cat}" stroke-width="5.8" stroke-linecap="round"/>${catPaw(f, -19.4, -1.6, 3.8)}${catPaw(f, 8.4, -1.6, 3.8)}`,
      at(-21, -30, catHead(g, f, eyes)),
    ].join("");
    case "play": return [
      // В прыжке: тело вытянуто, передние лапы вперёд, игрушечная мышь убегает.
      `<ellipse cx="2" cy="1" rx="24" ry="3" fill="#1a0f1e" opacity="0.22"/>`,
      `<g class="toy"><ellipse cx="-43" cy="-3.4" rx="5.6" ry="3.6" fill="${f.rugLight}"/><circle cx="-45.6" cy="-6.2" r="1.7" fill="${f.rugLight}"/><circle cx="-46.6" cy="-3" r="0.7" fill="${f.ink}"/><path d="M-37.6 -3 q4 -3 6 1" fill="none" stroke="${f.rugLight}" stroke-width="1.1" stroke-linecap="round"/></g>`,
      catTail(f, "M24 -30 Q38 -34 37 -50", "M30.6 -32.6 l1.6 -3.4 M35.4 -37 l3.4 -1.4 M35.6 -43.6 l3.6 0", { cls: "tailwag angry", tip: "M37.2 -47 L37 -50" }),
      `<path d="M17 -22 L27 -9.6 M22 -26 L33 -15" stroke="${f.catDark}" stroke-width="5.6" stroke-linecap="round"/>`,
      catPaw(f, 28.6, -8.6, 3.6), catPaw(f, 34.4, -14, 3.6),
      `<path d="M-21 -19 C-21 -27 -11 -33 2 -36 C16 -39 27 -35 27 -27 C27 -19.6 17 -15 4 -12.6 C-9 -10 -21 -11 -21 -19Z" fill="${coat}"/>`,
      stripes(f, "M-2 -35 q-0.6 4.6 1.6 8.4 M6 -37 q-0.4 4.8 1.6 8.6 M14 -37.4 q0 4.6 1.8 8.2 M21 -35 q0.2 3.6 1.6 6.4"),
      `<path d="M-13 -15 L-27 -9 M-16 -19 L-30 -16" stroke="${f.cat}" stroke-width="5.8" stroke-linecap="round"/>`,
      catPaw(f, -28.4, -8.6, 3.8), catPaw(f, -31.4, -15.6, 3.8),
      at(-19, -28, catHead(g, f, eyes === "open" ? "wide" : eyes), " rotate(-8)"),
    ].join("");
    case "eat": return [
      catTail(f, "M22 -7 Q35 -6.6 37 -16", "M28.6 -9.6 l1 3.6 M34 -9 l2.6 2.4 M35 -14 l3.6 0.4", { cls: wag }),
      `<path d="M-13 0 C-19 -6 -17 -18.6 -4 -22 C10 -25.4 23 -21 25 -10.6 C26 -4 23 0 19 0Z" fill="${coat}"/>`,
      stripes(f, "M0 -22.6 q-1.6 4.8 0.4 9 M8 -23.6 q-1.4 5 0.6 9.4 M16 -21.6 q-0.8 4.6 1.2 8.4"),
      catPaw(f, -10, -1.6, 4.6), catPaw(f, 14, -1.6, 5),
      `<g class="munch">${at(-17, -11.6, catHead(g, f, "closed"), " rotate(-10)")}</g>`,
    ].join("");
    case "claw": return [
      // Стоит на задних лапах, передние — на боку кресла.
      catTail(f, "M11 -6 Q28 -5 26.6 -22", "M18 -5.6 l0.6 3.6 M25 -9 l3.4 1.6 M25.4 -16 l3.6 -0.4", { cls: "tailwag angry", tip: "M26.8 -19 L26.6 -22" }),
      `<path d="M4 -8 L5.4 -2.6 M12 -9 L13.6 -2.6" stroke="${f.catDark}" stroke-width="6" stroke-linecap="round"/>`,
      catPaw(f, 4.6, -1.6, 4.4), catPaw(f, 13.6, -1.6, 4.4),
      `<path d="M-2 -2 C-9 -11 -14 -29 -8 -40 C-2 -46.6 9 -42 11 -29 C13 -18 17 -9 15 -2Z" fill="${coat}"/>`,
      stripes(f, "M9.6 -32 q-4 0.4 -6.6 2.6 M11.4 -25.6 q-4 0.4 -6.6 2.6 M13 -19 q-4 0.4 -6.6 2.6 M14.4 -12.4 q-3.6 0.4 -6 2.4"),
      `<path d="M-6.6 -28 Q-2 -21 -3 -9.6 Q-8 -17 -8.6 -25Z" fill="${f.catLight}" opacity="0.9"/>`,
      `<g class="scratch"><path d="M-6 -35 L-23 -50.6 M-3 -38 L-19.6 -58.6" stroke="${f.cat}" stroke-width="5.8" stroke-linecap="round"/>${catPaw(f, -24.4, -51.6, 3.6)}${catPaw(f, -21, -59.6, 3.6)}</g>`,
      at(3, -46.6, catHead(g, f, eyes), " rotate(-10)"),
    ].join("");
    case "belly": return [
      // На спине: светлый живот кверху, лапы поджаты, голова повёрнута к зрителю. «Это ловушка — но приятная».
      catTail(f, "M23 -5 Q37 -6 38 4", "M29 -6.4 l0.6 3.4 M35 -4.6 l3 1.2", { cls: wag }),
      `<path d="M-25 -1 C-29 -11 -20 -19 -5 -19.6 C12 -20 27 -17 28 -8.6 C28.6 -3.4 25 0 19 0 L-19 0 C-22 0 -24 0 -25 -1Z" fill="${coat}"/>`,
      `<path d="M-13 -16.6 C-3 -22 13 -21 21 -15.4 C15 -8.6 -6 -8.6 -13 -16.6Z" fill="${f.catLight}"/>`,
      `<g class="paws"><path d="M-6 -17 q-4 -8 1 -13 M5 -19 q-2 -9 3 -13 M14 -18 q2 -9 8 -10 M21 -14 q5 -6 10 -4" fill="none" stroke="${f.cat}" stroke-width="5.6" stroke-linecap="round"/>${catPaw(f, -5, -30.6, 3.6)}${catPaw(f, 8.4, -32.6, 3.6)}${catPaw(f, 22.6, -28.4, 3.6)}${catPaw(f, 31.4, -18.4, 3.6)}</g>`,
      at(-21, -11, catHead(g, f, "closed"), " rotate(-32)"),
    ].join("");
    case "eyes": return [
      // Темнота, из которой смотрят два глаза.
      `<ellipse cx="0" cy="-5" rx="19" ry="6" fill="#120c18" opacity="0.55"/>`,
      // Обижен — смотрит из темноты жалобно: зрачки круглые, верхний край глаз скошен наружу (0.52.0: сердитых бровей нет).
      [-6, 6].map(x => `<ellipse cx="${x}" cy="-5.4" rx="4" ry="3.6" fill="${DAY.catEye}"/>${eyes === "sad" ? `<circle cx="${x}" cy="-4.8" r="2.3" fill="#17131c"/>` : `<ellipse cx="${x}" cy="-5.4" rx="1.7" ry="3" fill="#17131c"/>`}<circle cx="${x - 1.2}" cy="-6.4" r="0.9" fill="#ffffff"/>`).join(""),
      eyes === "sad" ? `<path d="M-10.8 -7 L-2.4 -9.6 M10.8 -7 L2.4 -9.6" stroke="#120c18" stroke-width="2.2" stroke-linecap="round"/>` : "",
    ].join("");
    case "tail": return catTail(f, "M-2 -2 Q9 -4 10 -15 Q10.6 -23 16.6 -24", "M3.6 -3.4 l1.6 3.4 M8.6 -9 l3.4 1.2 M9.8 -16 l3.6 -0.4 M12 -22.6 l2 3", { cls: wag, tip: "M14 -23.4 L16.6 -24" });
    // 0.49.0 (сообщение 48). Принёс добычу: сидит, у лап — игрушечная мышь. Просится на руки: встал на задние лапы
    // и тянется к ней — та же фигура, что «точит когти», но глаза круглые, хвост спокоен, лапы не дерут, а тянутся.
    case "gift": return `${catShape(g, f, "sit", { eyes, angry })}<g><ellipse cx="-24" cy="-3.4" rx="5.6" ry="3.6" fill="${f.rugLight}"/><circle cx="-26.6" cy="-6.2" r="1.7" fill="${f.rugLight}"/><circle cx="-27.6" cy="-3" r="0.7" fill="${f.ink}"/><path d="M-18.6 -3 q4 -3 6 1" fill="none" stroke="${f.rugLight}" stroke-width="1.1" stroke-linecap="round"/></g>`;
    case "beg": return catShape(g, f, "claw", { eyes: "wide" }).replace('class="scratch"', 'class="reach"').replace("tailwag angry", "tailwag");
    case "sit":
    default: return [
      catTail(f, "M10 -5 Q28 -3 26 -18", "M17 -4.6 l0.6 3.6 M24 -7.6 l3.4 1.8 M25 -14 l3.6 -0.2", { cls: wag, tip: "M26.2 -15 L26 -18" }),
      `<path d="M-14 0 C-18.6 -12 -14 -28 0 -30.6 C14 -28 18.6 -12 14 0Z" fill="${coat}"/>`,
      stripes(f, "M-15.4 -15 q3.4 -1.2 5.4 1 M-16 -9.6 q3.4 -1.2 5.6 1 M15.4 -15 q-3.4 -1.2 -5.4 1 M16 -9.6 q-3.4 -1.2 -5.6 1"),
      `<path d="M-7 -25 Q0 -15 7 -25 Q6.4 -9 0 -5.6 Q-6.4 -9 -7 -25Z" fill="${f.catLight}"/>`,
      `<rect x="-8.4" y="-14" width="6.6" height="13.4" rx="3.3" fill="${f.cat}"/><rect x="1.8" y="-14" width="6.6" height="13.4" rx="3.3" fill="${f.cat}"/>`,
      catPaw(f, -5.2, -1.8), catPaw(f, 5.2, -1.8),
      at(0, -39, catHead(g, f, eyes)),
    ].join("");
  }
}

/** Когда она стоит картинкой, подушка Байта лежит правее: посреди ковра — её место. */
const PILLOW_ASIDE = 32;
/** Сколько места занимает каждая фигура Байта: [слева, сверху, справа, снизу] от его точки отсчёта. */
const CAT_BOX = Object.freeze({
  sit: [-22, -62, 30, 2], lie: [-38, -46, 37, 6], curl: [-30, -30, 28, 5], walk: [-42, -54, 34, 2], play: [-50, -56, 40, 3],
  eat: [-38, -36, 40, 3], claw: [-30, -72, 30, 2], eyes: [-22, -18, 22, 8], tail: [-12, -30, 26, 4], belly: [-42, -40, 40, 5],
  beg: [-30, -72, 30, 2], gift: [-34, -62, 30, 2],
});
/**
 * Где Байт: точка на рисунке и слой. `pose` — её поза: он не садится ей на лицо и не прячется за ней.
 * Слои: front — на полу, по глубине вместе с ней; lap — на сиденье кресла или у неё на коленях; sill, desk, top,
 * box, under — на подоконнике, столе, шкафу, в коробке, под креслом. `only` — здесь его видно только так.
 */
function catSpot(place, shape, pose = null) {
  const herLies = pose === "lie", inChair = pose === "chair" || pose === "nap" || pose === "read";
  const lap = { x: CHAIR.x + 2, y: CHAIR.y - (inChair ? 3 : 6), layer: "lap" };
  switch (place) {
    case "bowl": return { x: shape === "eat" ? 82 : shape === "walk" ? 104 : shape === "lie" ? 100 : 90, y: shape === "eat" ? 418 : 420, layer: "front" };
    // Она за столом — её голова как раз перед серединой подоконника: Байт садится левее, а не за её затылком.
    case "sill": return { x: pose === "desk" ? 226 : 262, y: 262, layer: "sill", shade: true };
    case "chair": return shape === "claw" ? { x: chairAt(-60, 0)[0] - 13, y: CLAW_Y, layer: "front", mirror: true } : lap;
    case "pillow": return { x: 300, y: 485, layer: "front", bare: true };
    case "desk": return { x: 364, y: 316, layer: "desk", shade: true };
    case "box": return { x: BOX.x + BOX.w / 2 + 1, y: BOX.y + 21, layer: "box" };
    // Она лежит на ковре — Байт устраивается у неё под боком, а не на лице.
    case "near": return { x: herLies ? 262 : 176, y: 497, layer: "front", k: 1.2 };
    // На шкафу — с правого края, хвостом к стене: так он закрывает календарь, а её рисунок остаётся виден.
    case "top": return { x: 82, y: 166, layer: "top", shade: true, mirror: true };
    // Она (нарисованная кодом) лежит на ковре перед креслом и закрывает всё, что под ним: тогда Байт прячется в
    // своей коробке — из неё видны одни глаза.
    case "under": return herLies ? { x: BOX.x + BOX.w / 2 + 1, y: BOX.y + 21, layer: "box", only: "eyes" }
      : shape === "tail" ? { x: chairAt(64, 0)[0] + 8, y: UNDER_Y + 2, layer: "front", depth: UNDER_Y } : { x: CHAIR.x, y: UNDER_Y, layer: "under", only: "eyes" };
    case "plaid":
      // Плед на ней — Байт под ним или поверх него; плед на кресле — хвост торчит из-под пледа.
      if (herLies) return shape === "tail" ? { x: 297, y: 471, layer: "front", depth: 480 } : { x: 262, y: 455, layer: "front", depth: 480, bare: true };
      // Она (нарисованная кодом) за столом или на ковре у кресла закрыла бы собой и плед, и хвост из-под него —
      // тогда Байт лежит на сиденье, на виду.
      if (shape === "tail") return inChair ? { x: chairAt(21, 0)[0], y: chairAt(0, 31)[1], layer: "lap" } : pose === "desk" || pose === "dance" || pose === "ribbon" ? { ...lap, only: "lie" } : { x: chairAt(52, 0)[0], y: chairAt(0, -4)[1], layer: "lap", mirror: true };
      return lap;
    case "rug":
    default: return herLies ? { x: 252, y: 495, layer: "front" } : pose === "ribbon" ? { x: 300, y: 462, layer: "front" } : pose === "dance" ? { x: 312, y: 464, layer: "front" } : { x: 206, y: 456, layer: "front" };
  }
}
/** О чём просит сердце: фигура и место Байта (незнакомые — «сидит на ковре»). */
const catAsked = (view) => ({ asked: CAT_SHAPES.includes(view?.shape) ? view.shape : "sit", place: CAT_PLACES.includes(view?.place) ? view.place : "rug" });
/** Какой фигурой он будет в этом месте. На кресле Байт лежит или спит клубком: сидя он закрыл бы ей лицо, когда она в этом кресле. */
const catShapeAt = (spot, asked, place) => spot.only ?? (spot.layer === "lap" && asked !== "lie" && asked !== "curl" && !(asked === "tail" && place === "plaid") ? "lie" : asked);
/** Сколько места он занимает на рисунке в этом месте этой фигурой. */
function catBoxAt(spot, shape) {
  const k = spot.k ?? 1, [left, top, right, bottom] = CAT_BOX[shape];
  return within(spot.mirror ? [spot.x - right * k, spot.y + top * k, (right - left) * k, (bottom - top) * k] : [spot.x + left * k, spot.y + top * k, (right - left) * k, (bottom - top) * k]);
}
/** Точка на полу под местом Байта: по ней он идёт, даже если сидел на подоконнике или на шкафу. У миски пол начинается выше. */
const floorUnder = ({ x, y }) => ({ x: Math.max(24, Math.min(376, x)), y: Math.max(x < 120 ? 424 : 452, Math.min(497, y)) });
/**
 * Сколько секунд Байт идёт (0.46.0): шагом — около пятидесяти пяти точек в секунду, не меньше секунды и не больше
 * четырёх с половиной; за игрушкой (`runs`) — бегом, около ста точек в секунду. До 0.46.0 он всегда «бежал рысцой»:
 * сто точек в секунду неподвижной фигурой, которая подпрыгивала, — владелец назвал это «прыг-прыг-прыг».
 */
export const catSeconds = (from, to, runs = false) => Math.round(Math.max(runs ? 0.7 : 1, Math.min(runs ? 2.5 : 4.5, Math.hypot(to.x - from.x, to.y - from.y) / (runs ? 100 : 55))) * 10) / 10;
/** На сколько точек лапа уходит назад, пока стоит на полу (полкруга шага): длина лапы и размах — в `catLeg` и в стилях `legUp`. */
const STEP_REACH = 13.5;
/**
 * Сколько длится круг шага — все четыре лапы по разу: такой, чтобы лапа на полу не скользила. За полкруга она
 * проходит назад `STEP_REACH` точек — столько же должен пройти он сам. Быстрее трети секунды лапы не мелькают,
 * медленнее двух третей — не волочатся.
 */
export const gaitSeconds = (distance, seconds) => Math.round(Math.max(0.32, Math.min(0.64, 2 * STEP_REACH * seconds / Math.max(1, distance))) * 100) / 100;
/**
 * Байт. `given` — место, выбранное заранее (когда она стоит картинкой: `herStand`); иначе — по её позе. `was` — где
 * и каким он был на прежнем рисунке (`castOf`): перешёл на другое место — прежний тает, по полу идёт Байт, на новом
 * месте проявляется новый (стили страницы: `.leave`, `.stride`, `.late`, лапы — `.lg`). Сам шаг (`walk`) рисуется поверх всей
 * комнаты: по полу он идёт перед мебелью, куда бы ни шёл.
 */
function cat(g, f, view, pose, given = null, was = null) {
  const { asked, place } = catAsked(view);
  const spot = given ?? catSpot(place, asked, pose);
  const shape = catShapeAt(spot, asked, place);
  const key = view?.key ?? "";
  const eyes = shape === "lie" && (key === "голоден" || key === "игра" || key === "ласка" || key === "сыт") ? "closed" : key === "обижен" ? "sad" : key === "шалит" ? "play" : key === "голоден" ? "wide" : "open";
  const k = spot.k ?? 1, small = shape === "eyes" || shape === "tail";
  const angry = key === "обижен" || key === "шалит";
  const body = catShape(g, f, shape, { eyes, angry });
  const extra = [
    shape === "curl" ? `<g transform="scale(0.72)">${zzz(f, 14, -44)}</g>` : "",
    // Наигрался — рядом ленточка, которую он сторожит.
    key === "игра" && shape === "lie" ? `<path d="M-32 -1.6 q-8 -7 -15 0 q-7 7 -14 0" fill="none" stroke="${f.eye}" stroke-width="2.4" stroke-linecap="round"/>` : "",
  ].join("");
  const box = catBoxAt(spot, shape);
  // Тень под ним: на полу — пятно, на подоконнике, столе и шкафу — полоска.
  const under = small || spot.bare || spot.layer === "lap" || spot.layer === "box" || shape === "play" ? ""
    : spot.shade ? `<ellipse cx="${spot.x + (shape === "sit" ? 3 : 0)}" cy="${spot.y + 0.6}" rx="${shape === "sit" ? 19 : 27}" ry="2.2" fill="#1a0f1e" opacity="0.24"/>`
      : shadow(g, spot.x + (shape === "sit" || shape === "gift" ? 3 : 0), spot.y + 1, (["sit", "claw", "beg", "gift"].includes(shape) ? 22 : 32) * k, 4.6 * k, 0.34);
  const figure = (at0, kind, inner, mirror, scale) => at(at0.x, at0.y, `<g class="cat ${kind}">${inner}</g>`, `${mirror ? " scale(-1 1)" : ""}${scale === 1 ? "" : ` scale(${scale})`}`);
  const settled = under + figure(spot, shape, `${body}${extra}`, spot.mirror, k);
  const moved = was && CAT_SHAPES.includes(was.shape) && Number.isFinite(was.x) && Number.isFinite(was.y) && Math.hypot(was.x - spot.x, was.y - spot.y) >= 16;
  let svg = settled, walk = "", seconds = 0;
  if (moved) {
    const from = floorUnder(was), to = floorUnder(spot);
    // Бегом — за игрушкой и когда удирает (`run`, 0.47.0: позвали второй раз подряд).
    seconds = catSeconds(from, to, key === "игра" || view?.run === true);
    // Идёт мордой вперёд: фигура «идёт» нарисована мордой влево. Лапы шагают (`gait`), круг шага — по скорости (`--g`).
    walk = `<g class="stride" style="--dx:${n(from.x - to.x)}px;--dy:${n(from.y - to.y)}px;--t:${seconds}s;--g:${gaitSeconds(Math.hypot(to.x - from.x, to.y - from.y), seconds)}s"><g class="pad">${figure(to, "walk", catShape(g, f, "walk", { eyes: "open", angry, gait: true }), to.x > from.x, 1)}</g></g>`;
    const ghost = figure(was, was.shape, catShape(g, f, was.shape, { eyes, angry }), was.mirror === true, Number(was.k) > 0 ? Number(was.k) : 1);
    svg = `<g class="leave">${ghost}</g><g class="arrive late" style="--t:${seconds}s">${settled}</g>`;
  }
  return {
    layer: spot.layer, depth: spot.depth ?? spot.y, svg, walk, seconds,
    // Область нажатия — в единицах рисунка; от миски, чайника, клубка и Колючки она отступает (`besideCare`).
    zone: besideCare(box, [spot.x, spot.y - (small ? 8 : 14 * k)]),
  };
}

// ── вся комната ──────────────────────────────────────────────────────────────
/**
 * Комната без того, что за окном: картинка и поверх неё — слой нажатий. `view`:
 *   part — «утро», «день», «вечер», «ночь»;
 *   her — { pose, key } или null (её пока не видно: страница ещё не получила ответ);
 *   cat — { shape, place, key } или null;
 *   plant — "wet" | "dry"; things — ключи вещей; lamp — цвет абажура («#rrggbb»);
 *   dark — лампа погашена, горит одна гирлянда (0.46.0); music — колонка играет: над ней ноты (0.46.0);
 *   fed — миска полна; tea — у неё в руках чай (чайник парит).
 * `options.sprites` — её картинки, какие страница уже загрузила: `{ имя: { w, h, cx, src } }`. Есть нужная — она
 * стоит картинкой. Ключа ещё нет — картинка грузится, и её самой пока не видно. Значение `false` (не загрузилась),
 * негодная картинка или спрайтов не передали вовсе — она нарисована кодом, как до 0.40.0.
 * `options.was` — `{ name, x }`: прежняя её картинка и где она стояла; тогда поза сменяется плавно.
 */
/**
 * Кто где на этом рисунке: какой картинкой и в какой точке она, где и какой фигурой Байт. Одно место для рисунка
 * (`drawInside`) и для страницы (`castOf`): страница запоминает ответ и отдаёт его следующему рисунку — так он знает,
 * откуда им идти.
 */
function cast(view, options) {
  const present = Boolean(view?.her) && view.her.away !== true;
  const asked = present ? (HER_POSES.includes(view.her.pose) ? view.her.pose : "desk") : null;
  const loaded = options && typeof options === "object" && options.sprites && typeof options.sprites === "object" ? options.sprites : null;
  const name = asked && loaded ? spriteOf(view) : null, got = name && Object.hasOwn(loaded, name) ? loaded[name] : undefined;
  const sprite = name && fitsSprite(got) ? got : null;
  // Картинка ещё в пути: её самой не видно, а Байт уже сидит там, где будет сидеть при ней, — чтобы не прыгал.
  const waits = Boolean(name) && got === undefined;
  const ahead = Boolean(sprite || waits);
  // Дела дня (0.48.0) нарисованы только картинками: пока картинки нет, фигура кодом стоит в ближайшей из прежних поз.
  const pose = ahead ? null : CODE_POSE[asked] ?? asked;
  const stand = ahead ? herStand(name, asked, view.cat) : null;
  let spot = null, shape = null;
  if (view?.cat) {
    const { asked: want, place } = catAsked(view.cat);
    spot = stand?.spot ?? catSpot(place, want, pose);
    shape = catShapeAt(spot, want, place);
  }
  return { asked, loaded, name, sprite, waits, ahead, pose, stand, spot, shape };
}
/**
 * Для страницы: что сейчас нарисовано. `her` — `{ name, x }` (картинка и точка, где она стоит) или `null`;
 * `cat` — `{ x, y, shape, mirror, k }` или `null`. Отдаётся следующему рисунку как `options.was` и `options.catWas`.
 */
export function castOf(view = {}, options = {}) {
  const { name, sprite, stand, spot, shape } = cast(view, options);
  return {
    her: sprite && stand ? { name, x: stand.x } : null,
    cat: spot ? { x: spot.x, y: spot.y, shape, mirror: Boolean(spot.mirror), k: spot.k ?? 1 } : null,
  };
}

function insideOf(view = {}, options = {}) {
  const part = lightIn(view), sky = skyIn(view?.sky);
  // Приставка имён слоя: когда час сменяется при открытой странице, прежняя комната тает поверх новой — имена у них разные.
  const g = inks(typeof options?.prefix === "string" && /^[a-z]-$/u.test(options.prefix) ? options.prefix : "r-");
  const c = palette(part), f = palette(part, FIGURE_SOFT);
  const things = new Set(Array.isArray(view.things) ? view.things : []);
  const has = (key) => things.has(key);
  const fx = fxIn(view);
  // Лужа на подоконнике — от открытого окна: створка открыта и при ней.
  // Окно открыто: его открыла сценка дня — или она сама, по нажатию (0.48.0): тогда слышна улица.
  const ajar = fx.has("window") || fx.has("puddle") || view.open === true;
  // Каждая перемена от сценки — своей группой с именем: по нему её находят проверки страницы.
  const fxShown = (name, body, when = fx.has(name)) => (when ? `<g class="fx fx-${name}">${body()}</g>` : "");
  const { loaded, name, sprite, waits, ahead, pose, stand, spot, shape: petShape } = cast(view, options);
  // Байт: `options.catWas` — где он был на прежнем рисунке: перешёл — дойдёт шагом.
  const catWas = options?.catWas && typeof options.catWas === "object" ? options.catWas : null;
  const pet = view.cat ? cat(g, f, view.cat, pose, spot, catWas) : null;
  // Прежняя поза тает, пока новая проявляется: `options.was` — имя прежней картинки и место, где она стояла.
  const before = loaded && options?.was && typeof options.was === "object" && Object.hasOwn(HER_SPRITES, options.was.name) && Number.isFinite(options.was.x)
    && Object.hasOwn(loaded, options.was.name) && fitsSprite(loaded[options.was.name]) ? { name: options.was.name, sprite: loaded[options.was.name], x: options.was.x } : null;
  const was = sprite && before && (before.name !== name || Math.abs(before.x - stand.x) >= 12) ? before : null;
  // Картинка «идёт» в её нынешнем наряде: есть — от места к месту она доходит шагом, нет — тает и проявляется.
  const strider = loaded && view.her ? walkOf(view) : null;
  const pace = strider ? frameOf(strider) : null;
  const walker = strider && fitsSprite(loaded[strider]) ? { name: strider, sprite: loaded[strider], ...(pace && fitsSprite(loaded[pace]) ? { frame: { name: pace, sprite: loaded[pace] } } : {}) } : null;
  // Она только что вошла (вернулась от шкафа): идёт от левого края рисунка.
  const door = sprite && walker && options?.enter === true ? { name: strider, sprite: loaded[strider], x: DOOR_X } : null;
  // Второй кадр её позы: загружен — она движется внутри позы; нет — стоит одной картинкой, как раньше.
  const alt = sprite && Object.hasOwn(HER_FRAMES, name) ? HER_FRAMES[name] : null;
  const frame = alt && loaded && fitsSprite(loaded[alt[0]]) ? { name: alt[0], sprite: loaded[alt[0]], how: alt[1], grow: Number(alt[3]) > 0 ? Number(alt[3]) : 1 } : null;
  const side = sprite && Object.hasOwn(HER_TURNS, name) ? HER_TURNS[name] : null;
  const turn = side && loaded && fitsSprite(loaded[side[0]]) ? { name: side[0], sprite: loaded[side[0]], side: side[1] } : null;
  const she = sprite ? herPainted(g, c, f, part, name, sprite, stand.x, door ?? was, walker, frame, view.her?.face, turn)
    // Её на рисунке нет, а только что была: уходит к шкафу, за левый край.
    : view.her?.away === true ? (before ? herLeaving(g, part, before, walker) : { note: changingNote() })
      // Картинка заказана и ещё не пришла — силуэт с точками (0.49.0); иначе она нарисована кодом.
      : pose ? her(g, c, f, pose, view.her.key, view) : waits && stand ? herComing(stand.x) : {};
  // Плед на ней — значит, на кресле его нет: это картинки «устала» и «спит».
  const plaidOnHer = sprite ? plaidWorn(name) : pose === "lie" || pose === "nap" || pose === "chair" || pose === "read";
  // Байт замечает, что она подошла (0.48.0, «реакция Байта на приближение Аи»): она дошла шагом и встала рядом — он
  // вздрагивает, над ним вспыхивает «!». Спящий, спрятавшийся и тот, кто идёт сам, её не замечают.
  const noticed = Boolean(pet) && !pet.walk && she.walk > 0 && Boolean(stand) && Boolean(spot) && Math.abs(spot.x - stand.x) < 130 && ["sit", "lie", "belly", "claw", "eat"].includes(petShape);
  const [markX, markY] = noticed ? (([bx, by, bw]) => [bx + bw / 2, by - 5])(catBoxAt(spot, petShape)) : [0, 0];
  const petSvg = !pet ? "" : !noticed ? pet.svg
    : `<g class="notice" style="--t:${she.walk}s"><g class="hop">${pet.svg}</g><text class="mark" aria-hidden="true" x="${n(markX)}" y="${n(markY)}" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="700" fill="#ffd166" stroke="#3a2412" stroke-width="0.7" paint-order="stroke" opacity="0">!</text></g>`;
  const on = (layer) => (pet?.layer === layer ? petSvg : "");
  // На полу — по глубине: кто ниже на рисунке, тот ближе к зрителю и закрывает дальнего.
  const herDepth = she.y ?? 400;
  // Три места в списке частей: Байт позади неё, она, Байт перед ней. Её место — всегда среднее: перешёл он — её
  // часть та же, и страница её не трогает (`drawParts`).
  const petOnFloor = pet?.layer === "front" ? petSvg : "", petBehind = Boolean(petOnFloor) && Boolean(she.front) && pet.depth < herDepth;
  // Коробка стоит ближе к зрителю, чем её ступни за столом: тогда коробка рисуется после неё.
  const boxNear = pose === "desk";
  // Она стоит на полу ближе Байта и закрывает его собой — тогда и палец встречает её первой: он на кресле, под
  // креслом, на подоконнике, а она перед ними. Иначе первым — он: он маленький, а сидит у неё на коленях, на полу
  // перед ней или в коробке у её ног.
  const herCloser = Boolean(she.front && pet && (pet.layer === "front" ? herDepth > pet.depth : !(pet.layer === "box" && boxNear)));
  const shade = /^#[0-9a-f]{6}$/iu.test(String(view.lamp ?? "")) && has("абажур") ? view.lamp : DAY.lamp;
  // 0.46.0. Лампу погасили нажатием: вечером и ночью светит одна гирлянда (днём лампа не горит и так). Колонка играет.
  const dark = lit(part) && view.dark === true, music = view.music === true;
  const own = ownOf(view), gifted = giftsOf(view);
  // Вещь рисуется, только если она у человека есть. Плед, которым она укрыта, с кресла снят — нажать на него там нельзя.
  const thing = (key, body) => (has(key) ? body() : "");
  const stoolFree = !(she.stoolUsed || pose === "garland");
  // «Плед пропал» (сценка): на кресле его нет — и нажать на него нельзя.
  const noPlaid = plaidOnHer || fx.has("noplaid");
  const shown = (key) => has(key) && !(key === "плед" && noPlaid);
  // Носок — у Байта под носом, если он на полу; иначе — посреди ковра.
  const sockAt = spot && pet?.layer === "front" ? [spot.x + (spot.mirror ? 34 : -34) * (spot.k ?? 1), spot.y - 1] : [214, 470];
  // Комната картинкой (0.53.0): мебель и стены — одна картинка, вещи — с листа; чего на картинке нет, рисует код.
  const pic = roomOf(options);
  const painted = (name, how) => paintedThing(g, pic, name, part, how);
  const lift = (dy, body) => (pic && body ? at(0, dy, body) : body);
  // Коробка на картинке написана целиком; Байт в ней — и её передняя стенка встаёт поверх него.
  const box = pic ? on("box") + (pet?.layer === "box" ? painted("boxFront") : "") : boxBack(c) + on("box") + boxFront(g, c);

  const parts = [
    glass(g, part, sky, ajar, view.glow), pic ? paintedRoom(g, pic, part, dark) : walls(g, c), pic ? "" : windowFrame(g, c),
    pic ? (ajar && !fx.has("curtains") ? paintedCurtains(g, pic, part, dark) : "") : curtains(g, c, ajar && !fx.has("curtains")), fxShown("curtains", () => curtainsShut(c)), pic ? paintedGarland(g, pic, part, fx.has("blink")) : garland(g, c, part, { rogue: fx.has("blink") }),
    thing("фонарь", () => lantern(g, c, part)),
    pic ? "" : starMap(g, c),
    thing("рисунок", () => (pic ? painted("рисунок") : drawing(c))),
    thing("календарь", () => (pic ? painted("календарь") : calendar(c))),
    // 0.49.0: её наброски на стекле и открытка на подоконнике — за ней и за Байтом, перед окном.
    (pic ? "" : sill(g, c)) + (own.sketches ? sketches(c, own.sketches) : "") + (own.card ? skyCard(c) : ""), fxShown("window", () => sashOpen(c), ajar && !fx.has("curtains")),
    fxShown("puddle", () => puddle()), fxShown("boat", () => boat(c)),
    // 0.49.0: подарки на шкафу — цветок в вазе и книга; Байт на шкафу сидит перед ними.
    (pic ? paintedShelves(g, c, pic, has, part, music) : bookcase(g, c, has, part, music)) + lift(PIC.top, (gifted.has("flower") ? giftFlower(c) : "") + (gifted.has("book") ? giftBook(c) : "")), lift(PIC.top, on("top")),
    thing("свеча", () => lift(PIC.candle, candle(c))),
    thing("подушка", () => (pic ? painted("подушка") : sillPillow(g, c))),
    thing("место", () => (pic ? painted("место") : sillSeat(g, c))),
    she.sillSeat ?? "", on("sill"),
    fx.has("cactus") ? "" : pic && view.plant !== "dry" ? painted("plant") : cactus(g, c, PLANT.x, 262, view.plant !== "dry"),
    thing("кактус", () => (pic ? painted("кактус") : cactus(g, c, 368, 262, true, true))),
    // Свет лампы на стене — под мебелью и фигурами.
    lampLight(g, part, shade, dark), floorLight(g, part, shade, sky, dark, Boolean(pic)),
    // Ковёр — до кресла: большое кресло (0.44.0) стоит на его дальнем краю ножками, а не тонет за ним.
    pic ? "" : rug(g, c),
    // Кресла, плед, стол.
    thing("кресло", () => (pic ? painted("кресло") : armchair(g, c, CHAIR2.x, CHAIR2.y, { second: true, k: CHAIR2.k }))),
    pic ? "" : armchair(g, c, CHAIR.x, CHAIR.y, { k: CHAIR.k }), on("under"), noPlaid ? "" : pic ? paintedPlaid(g, pic, part, has("плед")) : plaidOnChair(g, c, has("плед")),
    she.seat ?? "", on("lap"),
    stoolFree ? (pic ? painted("stool") : stool(g, c, STOOL.rest, STOOL.y)) + (own.book ? foundBook(c) : "") : "",
    pic ? "" : desk(g, c),
    pic ? "" : notebook(c), pic ? (view.tea ? teaSteam() : "") : teapot(g, c, { steam: Boolean(view.tea) }), on("desk"), pic ? paintedLamp(g, pic, part, shade, dark, shade !== DAY.lamp) : lamp(g, c, part, shade, dark),
    // В день рождения на столе — торт: после стола и лампы, иначе его закрывает мебель (так было до 0.45.0).
    thing("торт", () => cake(g, c)),
    // Пол.
    motes(part, sky),
    pic ? (view.fed ? at(PIC.bowl[0], PIC.bowl[1], bowlFood(c)) : "") : at(BOWL.dx, BOWL.dy, bowl(g, c, Boolean(view.fed))),
    (pic ? "" : yarn(g, c)) + (gifted.has("toy") ? giftToy(f) : ""),
    boxNear ? "" : box,
    fxShown("cactus", () => cactusFallen(g, c, view.plant !== "dry")),
    fxShown("sock", () => sock(c, ...sockAt)),
    pic ? painted("bed", { dx: ahead ? PILLOW_ASIDE : 0 }) : ahead ? at(PILLOW_ASIDE, 0, catPillow(g, c)) : catPillow(g, c),
    thing("тапочки", () => (pic ? painted("тапочки") : slippers(g, c))),
    petBehind ? petOnFloor : "", she.front ?? "", petBehind ? "" : petOnFloor,
    boxNear ? box : "",
    // Байт идёт на новое место: по полу, перед мебелью.
    pet?.walk ?? "",
    thing("ёлка", () => tree(g, c, part)),
    fxShown("haze", () => haze(g, part)),
    airLight(g, part, dark), airOnHerMoving(g, part, dark, she), airOnWalker(g, part, dark, she.walkShape),
    she.note ?? "",
    `<rect class="frame" x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="none"/>`,
  ].map(piece => (typeof piece === "string" ? piece : ""));

  // Слой нажатий: кто ниже в списке, тот ближе к пальцу.
  const thingZone = ([key, [label, box]]) => tap(`thing:${key}`, label, box);
  const owned = Object.entries(THING_ZONES).filter(([key]) => shown(key));
  const lampAt = lampZone(shown("абажур"), shown("торт"));
  const herZone = she.zone ? tap("her", "Аи", she.zone, "her") : "";
  // Голова — её отдельное место: по голове гладят (у нарисованной кодом фигуры его нет — там она мала).
  const headZone = she.head ? tap("pat", "Погладить Аи по голове", she.head, "pat") : "";
  // Нажать на Байта — погладить: слово то же, что у кнопки «Погладить» и у сердца.
  const catZone = pet ? tap("pet", "Байт", pet.zone, "cat") : "";
  // «Место рядом с Байтом» — у него под боком и потому поверх него; но когда она сидит перед подоконником,
  // закрывая место собой, палец встречает её.
  const seatZone = owned.filter(([key]) => key === "место").map(thingZone);
  const zones = [
    tap("window", "Окно", [WIN.x, WIN.y, WIN.w, WIN.h]),
    // Ковёр (0.47.0, идея 162): нажал на свободное место — позвал Байта. Первым в списке — дальше всех от пальца:
    // она, Байт, клубок и вещи, стоящие на ковре, лежат поверх.
    tap("call", "Ковёр: позвать Байта", RUG_ZONE, "rug"),
    // Выключатель света (0.46.0): гирлянда над окном и сама лампа — нажал, и лампа гаснет или загорается.
    tap("lamp", "Гирлянда", GARLAND_ZONE, "garland"),
    // Полка с книгами (0.45.0): нажал — она берёт книгу и садится читать. Вещи на полках — поверх: они ниже в списке.
    tap("book", "Полка с книгами", BOOKS, "books"),
    // Колонка на нижней полке (0.46.0): нажал — три минуты музыки, она танцует. Поверх полки с книгами.
    tap("music", "Колонка", SPEAKER_ZONE, "speaker"),
    ...(lampAt ? [tap("lamp", "Лампа", lampAt, "switch")] : []),
    ...owned.filter(([key]) => !FRONT_THINGS.has(key)).map(thingZone),
    // Коробка Байта: нажал — что он в неё натаскал. Сам Байт, если сидит в ней, — поверх.
    tap("box", "Коробка Байта", [BOX.x, BOX.y + 8, BOX.w, BOX.h - 8], "box"),
    ...(herCloser ? [catZone, ...seatZone, herZone, headZone] : [herZone, headZone, catZone, ...seatZone]),
    ...owned.filter(([key]) => FRONT_THINGS.has(key) && key !== "место").map(thingZone),
    // Колючка на полу — и поливают её там, где она лежит.
    ...Object.entries(CARE_ZONES).map(([act, [label, id, box]]) => tap(act, label, act === "water" && fx.has("cactus") ? FALLEN.zone : box, id)),
  ].join("");

  return { inks: g.list(), parts, zones };
}
/** Комната изнутри одной строкой: рисунок (`.art`) и слой нажатий (`.zones`). Так её берут листы, тесты и прежняя страница. */
export function drawInside(view = {}, options = {}) {
  const made = insideOf(view, options);
  return `<g class="art" pointer-events="none"><defs>${made.inks.join("")}</defs>${made.parts.join("")}</g><g class="zones">${made.zones}</g>`;
}
/**
 * Комната изнутри по частям (0.48.0): `inks` — описания переходов цвета, `parts` — части рисунка в порядке слоёв
 * (их всегда одно и то же число: чего на рисунке нет, то пустая строка), `zones` — слой нажатий. Сложенные вместе —
 * ровно `drawInside`. Страница меняет на рисунке только те части, что стали другими: до этого любая перемена
 * заменяла всю комнату разом — и на телефоне перед сменой позы мигал пустой экран (сообщение 47).
 */
export function drawParts(view = {}, options = {}) {
  return insideOf(view, options);
}

/**
 * Весь рисунок сразу — для снимков и тестов; страница рисует его тремя слоями. `options` — как у `drawInside`.
 * Определение её картинки (`drawSprite`) кладётся сюда же: рисунок целиком должен быть виден сам по себе.
 */
export function drawRoom(view = {}, options = {}) {
  const part = lightIn(view), name = spriteOf(view), sky = skyIn(view?.sky);
  // В кладовую — всё, на что рисунок ссылается: нынешняя поза, прежняя (она тает) и, если она идёт, картинка «идёт».
  const moving = options?.was || options?.enter === true;
  const wanted = [name, frameOf(name), turnOf(name), options?.was?.name, moving ? walkOf(view) : null, moving ? frameOf(walkOf(view)) : null].filter((item, index, all) => item && options?.sprites?.[item] && all.indexOf(item) === index);
  const store = wanted.map(item => drawSprite(item, options.sprites[item])).join("") + drawPicture(options?.room);
  return `${drawBackdrop(part, sky, { phase: Number.isFinite(view?.moon) ? view.moon : 0.3 })}<g clip-path="url(#s-glass)" pointer-events="none"><g transform="translate(${WIN.x} ${WIN.y})">${drawRain(part, undefined, sky)}</g></g>${store ? `<defs>${store}</defs>` : ""}${drawInside(view, options)}`;
}
