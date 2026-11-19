/* global document */
/**
 * Лист рисунков комнаты: много рисунков на одном снимке — чтобы посмотреть их глазами.
 *
 *   bash scripts/verify.sh sheet /tmp/rooms.png              комната целиком: четыре часа суток, разные позы и вещи
 *   bash scripts/verify.sh sheet /tmp/her.png her            она крупно: каждая поза с каждым лицом из словаря
 *   bash scripts/verify.sh sheet /tmp/cat.png cat ночь       Байт крупно: каждая «фигура и место» из словаря, ночью
 *   bash scripts/verify.sh sheet /tmp/things.png things      каждая вещь крупно
 *   bash scripts/verify.sh sheet /tmp/zones.png zones        места нажатий поверх рисунка
 *   bash scripts/verify.sh sheet /tmp/x.png /tmp/spec.json   свой лист
 *   bash scripts/verify.sh sheet /tmp/old.png her день drawn она, нарисованная кодом (запасной вид, без картинок)
 *
 * Зачем. Тесты знают, что рисунок цел, а `verify.sh page` — что всё нажимается. Похожа ли она на себя, не
 * закрыл ли кот её лицо, не ушла ли ночью в темноту, не легла ли полоса света поперёк ног — видно только
 * глазами. Первый рисунок комнаты (0.38.0) вышел в свет после одного снимка страницы, и владелец назвал его
 * «не очень». Поэтому после любой правки `miniapp/scene.js` и перед выпуском листы смотрят (AGENTS.md, §10).
 *
 * Наборы `her` и `cat` берут пары не из головы, а из словаря: те самые позы и лица, которые сердце шлёт
 * странице (`herPose`, `catPose`, `catAfter` из `tgcloud/lib/room.js`). Третьим словом — час: «утро», «день»,
 * «вечер», «ночь» (по умолчанию день).
 *
 * Свой лист — файл JSON: `{ "width": 1214, "zoom": 2, "zones": false, "views": [{ "label": "…", "crop": [x, y,
 * ширина, высота], "view": { "part": "ночь", "her": { "pose": "nap", "key": "сон" }, "cat": { "shape": "curl",
 * "place": "pillow", "key": "спит" }, "things": ["плед"], "tea": true, "fed": true, "plant": "wet", "lamp":
 * "#f08ab5" } }] }`. `view` — то же описание, что получает `drawRoom`; `crop` можно не писать. `width` —
 * ширина листа в точках: рисунки переносятся по ней; `zones` — показать места нажатий; `"sprites": false` у
 * листа или у рисунка — она нарисована кодом, а не картинкой.
 *
 * Она на листах — как на странице: картинкой из `miniapp/her/` (с 0.40.0). Четвёртое слово `drawn` рисует её
 * кодом: таким остаётся запасной вид, и его тоже надо видеть.
 *
 * Браузер — тот же, что у `verify.sh page`: зависимостью проекта он не становится, файл запускается из
 * временной папки. Аргументы: <корень репозитория> <снимок.png> [набор или файл.json] [час] [drawn].
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const [, , root, out, set = "rooms", hour = "день", look = ""] = process.argv;
if (!root || !out) { console.error("Нужно: node room-sheet.mjs <корень репозитория> <снимок.png> [rooms|her|cat|things|zones|файл.json] [час] [drawn]"); process.exit(2); }

const load = (path) => import(pathToFileURL(resolve(root, path)).href);
const scene = await load("miniapp/scene.js");
const room = await load("tgcloud/lib/room.js");
const { createPhrasebook } = await load("tgcloud/lib/phrasebook.js");
const { WIDTH, HEIGHT, PARTS, HER_POSES, THINGS, HER_SPRITES = {}, drawRoom, drawInside } = scene;

// Её картинки — те же модули, что грузит страница. Нет модуля — на листе она будет нарисована кодом, как на
// странице, когда картинка не загрузилась.
const sprites = {};
for (const name of Object.keys(HER_SPRITES)) {
  try { sprites[name] = (await load(`miniapp/her/${name}.js`)).default; } catch { sprites[name] = false; }
}
const painted = look !== "drawn";
const how = (off = false) => (painted && !off ? { sprites } : {});

const part = PARTS.includes(hour) ? hour : "день";
const ALL = [...THINGS];
/** Описание комнаты коротко: `cat` — «фигура.место.состояние». */
const view = (when, pose, key, cat, things = ALL, extra = {}) => {
  const [shape, place, mood = "сыт"] = cat.split(".");
  return { part: when, plant: "wet", her: { pose, key }, cat: { shape, place, key: mood }, things, ...extra };
};
/** Место нажатия на рисунке: по `id` (она — `her`, Байт — `cat`) или по действию (`thing:плед`). */
const zoneOf = (described, mark) => {
  const found = new RegExp(`<g class="tap"[^>]*${mark}[^>]*><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`, "u").exec(drawInside(described, how()));
  return found ? found.slice(1).map(Number) : [0, 0, WIDTH, HEIGHT];
};
const meet = (one, two) => one[0] < two[0] + two[2] && two[0] < one[0] + one[2] && one[1] < two[1] + two[3] && two[1] < one[1] + one[3];
/** Вырезка вокруг места: не меньше `width × height`, с полем, в пределах рисунка. */
const around = ([x, y, w, h], width, height, margin = 14) => {
  const cw = Math.min(WIDTH, Math.max(width, w + margin * 2)), ch = Math.min(HEIGHT, Math.max(height, h + margin * 2));
  const left = Math.max(0, Math.min(WIDTH - cw, x + w / 2 - cw / 2)), top = Math.max(0, Math.min(HEIGHT - ch, y + h / 2 - ch / 2));
  return [Math.round(left), Math.round(top), Math.round(cw), Math.round(ch)];
};

const book = createPhrasebook({ random: () => 0 });
const pool = (name, ctx = {}) => book.pool(`+комната:${name}`, { formal: true, vars: { "цвет": "синий", "рисунок": "кот в шляпе" }, ...ctx });
/** Пары «поза и состояние», которые сердце в самом деле шлёт: по её строкам словаря. */
function herPairs() {
  const seen = new Set();
  for (const key of ["дело", "уют", "игра", "сон", "устала", "обида", "ревность"]) {
    for (const owner of [true, false]) for (const line of pool(`она:${key}`, { owner, level: owner ? "close" : "known" })) seen.add(`${room.herPose(line, key)}/${key}`);
  }
  return [...seen].map(pair => pair.split("/")).sort((one, two) => HER_POSES.indexOf(one[0]) - HER_POSES.indexOf(two[0]));
}
/** Пары «фигура и место» Байта: по строкам о нём и по тому, чем он занят после заботы. */
function catPairs() {
  const seen = new Map();
  for (const key of ["голоден", "сыт", "спит", "ласка", "игра", "шалит", "обижен"]) for (const line of pool(`байт:${key}`)) {
    const { shape, place } = room.catPose(line, key);
    if (!seen.has(`${shape}.${place}`)) seen.set(`${shape}.${place}`, key);
  }
  for (const [op, again, key] of [["feed", false, "сыт"], ["play", false, "игра"], ["pet", false, "ласка"]]) {
    const { shape, place } = room.catAfter(op, { again });
    if (!seen.has(`${shape}.${place}`)) seen.set(`${shape}.${place}`, key);
  }
  return [...seen].map(([pair, key]) => `${pair}.${key}`);
}

const SETS = {
  rooms: () => ({
    zoom: 0.74, dpr: 2,
    views: [
      ["утро", "desk", "дело", "sit.sill.сыт", []], ["день", "shelf", "уют", "walk.bowl.голоден"], ["вечер", "chair", "уют", "curl.pillow.спит", ALL, { lamp: "#f08ab5" }],
      ["ночь", "nap", "сон", "curl.box.спит", ["кружка", "тапочки"]], ["утро", "garland", "игра", "sit.top.шалит"], ["день", "desk", "ревность", "curl.desk.спит", ["плед", "кресло"], { tea: true }],
      ["вечер", "ribbon", "игра", "play.rug.игра", []], ["ночь", "lie", "устала", "lie.rug.ласка"],
    ].map(([when, pose, key, cat, things, extra]) => ({ label: `${when} · ${pose}/${key} · ${cat}${things && !things.length ? " · без вещей" : ""}`, view: view(when, pose, key, cat, things, extra) })),
  }),
  her: () => ({
    zoom: painted ? 1 : 1.25, dpr: 2,
    // Картинкой — по одной на состояние (и «дело» с чаем в руках); кодом — каждая поза с каждым лицом из словаря.
    views: (painted ? [["desk", "дело"], ["desk", "дело", { tea: true }], ["chair", "уют"], ["dance", "игра"], ["nap", "сон"], ["chair", "устала"], ["back", "обида"], ["desk", "ревность"]] : herPairs()).map(([pose, key, extra = {}]) => {
      const described = view(part, pose, key, "eyes.under.обижен", ["плед"], extra);
      return { label: `${painted ? "" : `${pose} / `}${key}${extra.tea ? " + чай" : ""}`, view: described, crop: around(zoneOf(described, 'id="her"'), painted ? 210 : 150, painted ? 300 : 215) };
    }),
  }),
  cat: () => ({
    zoom: 1.4, dpr: 2,
    views: catPairs().map((cat) => {
      const described = view(part, cat.startsWith("walk.near") || cat.startsWith("sit.near") ? "shelf" : "desk", "дело", cat, ["плед", "подушка"], { fed: cat.startsWith("eat") });
      return { label: cat, view: described, crop: around(zoneOf(described, 'id="cat"'), 132, 112) };
    }),
  }),
  things: () => ({
    zoom: 1.4, dpr: 2,
    views: ALL.map((thing) => {
      // Она встаёт там, где вещь не закрывает; абажур — в цвете, иначе его не отличить от лампы.
      const mark = `data-act="thing:${thing}"`, extra = thing === "абажур" ? { lamp: "#3f6fd8" } : {};
      const apart = (pose) => { const described = view(part, pose, "дело", "curl.box.спит", [thing], extra); return !meet(zoneOf(described, 'id="her"'), zoneOf(described, mark)); };
      const described = view(part, ["desk", "shelf", "sill"].find(apart) ?? "desk", "дело", "curl.box.спит", [thing], extra);
      return { label: thing, view: described, crop: around(zoneOf(described, mark), 132, 132) };
    }),
  }),
  zones: () => ({
    zoom: 0.74, dpr: 2, zones: true,
    views: [
      ["desk", "sit.sill"], ["chair", "lie.chair"], ["sill", "sit.near"], ["dance", "claw.chair"], ["lie", "curl.plaid"], ["shelf", "sit.bowl"], ["back", "curl.pillow"], ["nap", "sit.top"],
    ].map(([pose, cat]) => ({ label: `${pose} · ${cat}`, view: view(part, pose, "уют", cat) })),
  }),
};

let sheet;
if (/\.json$/u.test(set)) sheet = JSON.parse(await readFile(set, "utf8"));
else if (SETS[set]) sheet = SETS[set]();
else { console.error(`Набора «${set}» нет. Есть: ${Object.keys(SETS).join(", ")} — или файл .json.`); process.exit(2); }

let chromium, puppeteer;
try {
  process.env.AWS_EXECUTION_ENV ??= "AWS_Lambda_nodejs22.x";
  ({ default: chromium } = await import("@sparticuz/chromium"));
  ({ default: puppeteer } = await import("puppeteer-core"));
} catch (error) {
  console.error(`Браузера рядом нет (${error.code ?? error.message}). Запускайте так: bash scripts/verify.sh sheet <снимок.png>`);
  process.exit(2);
}

// Каждый рисунок — отдельной картинкой: у рисунков одни и те же имена красок, на одной странице они бы спутались.
const zoom = sheet.zoom ?? 1;
// Места нажатий: вещи — жёлтым, она — алым, Байт — синим, забота — зелёным; окно — одной рамкой, иначе оно красит всё.
const paint = sheet.zones ? `<style>.zones rect{fill:#ffd400!important;fill-opacity:.14!important;stroke:#ffd400;stroke-width:1}.zones [data-act="window"] rect{fill-opacity:0!important;stroke-dasharray:4 3}.zones #her rect{fill:#ff2d6f!important;stroke:#ff2d6f}.zones #cat rect{fill:#2d9bff!important;stroke:#2d9bff}${["water", "tea", "feed", "play"].map(act => `.zones [data-act="${act}"] rect`).join(",")}{fill:#22d36b!important;stroke:#22d36b}</style>` : "";
const cells = sheet.views.map(({ label = "", view: described, crop, sprites: wanted }) => {
  const sprites_off = wanted === false;
  const [x, y, w, h] = crop ?? sheet.crop ?? [0, 0, WIDTH, HEIGHT];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w * zoom}" height="${h * zoom}">${paint}${drawRoom(described, how(sheet.sprites === false || sprites_off))}</svg>`;
  return `<figure><img width="${w * zoom}" height="${h * zoom}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"><figcaption>${String(label).replace(/</gu, "&lt;")}</figcaption></figure>`;
});
// Рисунки идут строками и переносятся по ширине листа: вырезки бывают разного размера.
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#1b1b22;font:12px system-ui,sans-serif;color:#ddd}main{display:flex;flex-wrap:wrap;align-items:flex-start;box-sizing:border-box;width:${Number(sheet.width) || 1214}px;gap:6px;padding:6px}figure{margin:0}figcaption{padding:2px 0 0;height:14px}img{display:block}</style><main>${cells.join("")}</main>`;

const executablePath = await chromium.executablePath();
process.env.LD_LIBRARY_PATH = [join(tmpdir(), "al2023/lib"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
process.env.FONTCONFIG_PATH ??= join(tmpdir(), "fonts");
process.env.HOME = tmpdir();
const scale = sheet.dpr ?? 1;
const browser = await puppeteer.launch({ args: [...chromium.args, "--no-sandbox", "--disable-gpu", "--font-render-hinting=none"], executablePath, headless: "shell", defaultViewport: { width: Number(sheet.width) || 1214, height: 800, deviceScaleFactor: scale } });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  const size = await page.evaluate(() => { const box = document.querySelector("main").getBoundingClientRect(); return { width: Math.ceil(box.width), height: Math.ceil(box.height) }; });
  await page.setViewport({ ...size, deviceScaleFactor: scale });
  await page.screenshot({ path: out });
  console.log(`лист «${set}»: рисунков ${cells.length}, ${size.width}×${size.height} → ${out}`);
} finally { await browser.close(); }
