/* global document, Image */
/**
 * Каждая вещь комнаты видна на рисунке (0.45.0).
 *
 *   bash scripts/verify.sh seen            все вещи, днём и ночью
 *
 * Зачем. В день рождения владельца (19.11.2026) она сказала «на столе торт со свечкой», а торта на рисунке не
 * было: он рисовался на табурете, задвинутом под стол, и раньше стола — ящик стола закрывал его целиком. Тесты
 * знали, что торт «нарисован» (его разметка есть в рисунке) и что место нажатия есть; `verify.sh page` — что оно
 * нажимается. Что вещь **видна**, не проверял никто. Теперь проверяет этот сценарий — глазами браузера.
 *
 * Как. Комната рисуется дважды: со всеми вещами и без одной — и снимки сравниваются по точкам внутри места нажатия
 * этой вещи (`THING_ZONES` в `miniapp/scene.js`). Вещь, закрытая мебелью, снимок почти не меняет. Мерка — доля
 * точек места, которые вещь изменила: не меньше `SEEN` (днём у торта под столом было 0,19, у кремовой свечки на
 * кремовой стене — 0,21; у самой неприметной из остальных вещей — больше трети; ночью краски глуше, и мерка вдвое
 * ниже). Её самой и Байта на снимках нет: они ходят и закрывают вещи лишь на время.
 *
 * Браузер — тот же, что у `verify.sh page`: зависимостью проекта он не становится, файл запускается из временной
 * папки. Аргументы: <корень репозитория>.
 */
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const [, , root] = process.argv;
if (!root) { console.error("Нужно: node room-seen.mjs <корень репозитория>"); process.exit(2); }
const scene = await import(pathToFileURL(resolve(root, "miniapp/scene.js")).href);
const { WIDTH, HEIGHT, THINGS, drawRoom, drawInside } = scene;

/** Какая доля места нажатия должна измениться, когда вещь появляется: днём и ночью (ночью краски глуше). */
const SEEN = { "день": 0.3, "ночь": 0.15 };
const LAMP = "#3f6fd8";
const view = (part, things) => ({ part, sky: "clear", plant: "wet", her: null, cat: null, things, lamp: things.includes("абажур") ? LAMP : "", drawing: things.includes("рисунок") ? "Мекка" : "" });
const zoneOf = (described, key) => {
  const found = new RegExp(`<g class="tap"[^>]*data-act="thing:${key}"[^>]*><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`, "u").exec(drawInside(described));
  return found ? found.slice(1).map(Number) : null;
};
const svgOf = (described) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH * 2}" height="${HEIGHT * 2}">${drawRoom(described)}</svg>`).toString("base64")}`;

const jobs = [];
for (const part of ["день", "ночь"]) for (const key of THINGS) {
  const all = view(part, [...THINGS]);
  jobs.push({ part, key, zone: zoneOf(all, key), withIt: svgOf(all), without: svgOf(view(part, THINGS.filter(item => item !== key))) });
}

let chromium, puppeteer;
try {
  process.env.AWS_EXECUTION_ENV ??= "AWS_Lambda_nodejs22.x";
  ({ default: chromium } = await import("@sparticuz/chromium"));
  ({ default: puppeteer } = await import("puppeteer-core"));
} catch (error) {
  console.error(`Браузера рядом нет (${error.code ?? error.message}). Запускайте так: bash scripts/verify.sh seen`);
  process.exit(2);
}
const executablePath = await chromium.executablePath();
process.env.LD_LIBRARY_PATH = [join(tmpdir(), "al2023/lib"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
process.env.FONTCONFIG_PATH ??= join(tmpdir(), "fonts");
process.env.HOME = tmpdir();
const browser = await puppeteer.launch({ args: [...chromium.args, "--no-sandbox", "--disable-gpu", "--font-render-hinting=none"], executablePath, headless: "shell", defaultViewport: { width: 900, height: 1100, deviceScaleFactor: 1 } });
const failures = [];
try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><meta charset=\"utf-8\"><body></body>", { waitUntil: "load" });
  const shares = await page.evaluate(async (list, width, height) => {
    const pixels = async (src) => {
      const image = new Image(); image.src = src; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = width * 2; canvas.height = height * 2;
      const ctx = canvas.getContext("2d", { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const result = [];
    for (const job of list) {
      if (!job.zone) { result.push(null); continue; }
      const one = await pixels(job.withIt), two = await pixels(job.without);
      const [x, y, w, h] = job.zone.map(value => Math.round(value * 2));
      let changed = 0;
      for (let row = Math.max(0, y); row < Math.min(height * 2, y + h); row += 1) for (let col = Math.max(0, x); col < Math.min(width * 2, x + w); col += 1) {
        const i = (row * width * 2 + col) * 4;
        if (Math.abs(one[i] - two[i]) + Math.abs(one[i + 1] - two[i + 1]) + Math.abs(one[i + 2] - two[i + 2]) > 30) changed += 1;
      }
      result.push(changed / (w * h));
    }
    return result;
  }, jobs, WIDTH, HEIGHT);
  const told = new Map();
  for (const [index, job] of jobs.entries()) {
    const share = shares[index];
    if (share === null) failures.push(`${job.key}, ${job.part}: у вещи нет места нажатия на рисунке`);
    else if (share < SEEN[job.part]) failures.push(`${job.key}, ${job.part}: вещь почти не видна — изменила ${Math.round(share * 100)} % своего места, а нужно не меньше ${SEEN[job.part] * 100} %`);
    told.set(job.key, [...(told.get(job.key) ?? []), share === null ? "—" : `${Math.round(share * 100)} %`]);
  }
  console.log(`вещи на рисунке (доля места нажатия, которую вещь меняет; день / ночь): ${[...told].map(([key, list]) => `${key} ${list.join(" / ")}`).join(", ")}`);
} finally {
  await browser.close().catch(() => {});
}
if (failures.length) { for (const text of failures) console.log(`  ✗ ${text}`); console.log(`\nвещи комнаты: ${failures.length} ${failures.length === 1 ? "замечание" : "замечаний"}`); process.exit(1); }
console.log("вещи комнаты: каждая видна на рисунке");
