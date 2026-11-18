/* global document, getComputedStyle */
/**
 * Страница комнаты в настоящем браузере: всё, что человек нажимает, нажимает этот скрипт.
 *
 *   bash scripts/verify.sh page                 запуск (ставит браузер во временную папку и зовёт этот файл)
 *   bash scripts/verify.sh page /tmp/room.png   то же и снимок страницы
 *
 * Зачем. Тесты без браузера (`tests/miniapp.test.mjs`) проверяют разметку рисунка, но не знают, кто получит
 * нажатие: в 0.38.0 ночью свет лампы, нарисованный позже чайника, молча забирал его нажатия, а у сыгранной
 * сценки оставались кнопки. По картинке этого не видно. Здесь страница открывается как витрина (вне Telegram
 * она показывает комнату сама, сердце не нужно) и проверяется три вещи:
 *   1. страница открылась без ошибок, комната нарисована;
 *   2. каждое место на рисунке, каждая кнопка заботы и сценка дня отзываются на нажатие пальцем;
 *   3. на всех рисунках (день и ночь × без вещей и со всеми × её позы × места и фигуры Байта): заботу
 *      (Колючка, чайник, миска, клубок) не заслоняет никто; до неё и до Байта можно дотянуться всегда;
 *      вещь или окно фигура заслонить может (она сидит на подушке — нажатие по праву её), но не навсегда.
 *
 * Браузер (puppeteer-core и @sparticuz/chromium) зависимостью проекта не становится: `verify.sh` ставит его
 * во временную папку и запускает этот файл оттуда. Аргументы: <папка страницы> [куда положить снимок].
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { tmpdir } from "node:os";

const [, , folder, shot = ""] = process.argv;
if (!folder) { console.error("Нужна папка страницы: node room-check.mjs <папка miniapp> [снимок.png]"); process.exit(2); }

let chromium, puppeteer;
try {
  process.env.AWS_EXECUTION_ENV ??= "AWS_Lambda_nodejs22.x";
  ({ default: chromium } = await import("@sparticuz/chromium"));
  ({ default: puppeteer } = await import("puppeteer-core"));
} catch (error) {
  console.error(`Браузера рядом нет (${error.code ?? error.message}). Запускайте так: bash scripts/verify.sh page`);
  process.exit(2);
}

// Раздатчик папки: файлы страницы — модули, по file:// браузер их не загрузит.
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const server = createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/u, "");
  const file = join(folder, path === "/" ? "index.html" : path);
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch { response.writeHead(404); response.end("нет"); }
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const origin = `http://127.0.0.1:${server.address().port}`;

// Библиотеки и шрифты браузер распаковывает во временную папку — их надо назвать до запуска.
const executablePath = await chromium.executablePath();
process.env.LD_LIBRARY_PATH = [join(tmpdir(), "al2023/lib"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
process.env.FONTCONFIG_PATH ??= join(tmpdir(), "fonts");
process.env.HOME = tmpdir();
const browser = await puppeteer.launch({
  args: [...chromium.args, "--no-sandbox", "--disable-gpu", "--font-render-hinting=none"], executablePath, headless: "shell",
  defaultViewport: { width: 390, height: 1010, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
});

const failures = [];
const fail = (text) => { failures.push(text); console.log(`  ✗ ${text}`); };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  // Скрипт Telegram в песочнице недоступен — это не ошибка страницы: без него она и должна стать витриной.
  page.on("console", (message) => { if (message.type() === "error" && !/net::ERR_/u.test(message.text())) errors.push(message.text()); });
  // Настройки снимка из адреса читаются только на своей машине: вечер, все вещи, Байт у миски.
  await page.goto(`${origin}/index.html#part=${encodeURIComponent("вечер")}&things=all`, { waitUntil: "load", timeout: 30_000 });
  await pause(1200);

  // ── 1. страница открылась ──────────────────────────────────────────────────
  console.log("1. Страница");
  const said = () => page.$eval("#say", (node) => node.textContent.replace(/\s+/gu, " ").trim());
  const seen = await page.evaluate(() => ({
    state: document.querySelector("#app").dataset.state, light: document.querySelector("#app").dataset.light,
    zones: [...document.querySelectorAll("#room .zones [data-act]")].map(node => node.dataset.act),
    art: document.querySelectorAll("#room .art *").length, rain: document.querySelectorAll("#backdrop .rain").length,
    foot: document.querySelector("#foot").textContent, scene: !document.querySelector("#scene").hidden,
  }));
  if (seen.state !== "ready") fail(`комната не открылась: состояние «${seen.state}», её слова: «${await said()}»`);
  if (seen.light !== "evening") fail(`свет не вечерний: «${seen.light}»`);
  if (seen.art < 200 || !seen.rain) fail(`рисунок пуст: ${seen.art} частей, дождя — ${seen.rain}`);
  if (!/витрина/u.test(seen.foot)) fail(`вне Telegram страница должна назвать себя витриной: «${seen.foot}»`);
  if (!seen.scene) fail("карточки «Сценка дня» нет");
  console.log(`  состояние ${seen.state}, свет ${seen.light}, частей рисунка ${seen.art}, мест для нажатия ${seen.zones.length}`);

  // ── 2. каждое нажатие ──────────────────────────────────────────────────────
  console.log("2. Нажатия");
  /** Точка внутри области, в которой нажатие получает сама область (её может частью заслонять фигура). */
  const pointOf = (act) => page.evaluate((name) => {
    const node = [...document.querySelectorAll("#room .zones [data-act]")].find(item => item.dataset.act === name);
    if (!node) return null;
    const box = node.getBoundingClientRect();
    for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
      const x = box.left + box.width * fx, y = box.top + box.height * fy;
      if (document.elementFromPoint(x, y)?.closest?.("[data-act]") === node) return { x, y, w: Math.round(box.width), h: Math.round(box.height) };
    }
    return { covered: true };
  }, act);
  const done = (act) => page.$eval(`#actions button[data-act="${act}"]`, (node) => node.classList.contains("done"));
  const lines = await page.evaluate(async () => {
    const logic = await import("./logic.js");
    const look = logic.demoLook(20, { part: "вечер", things: "all" });
    return { her: look.her.line, window: look.window, things: Object.fromEntries(look.things.map(item => [item.key, item.line])) };
  });
  const tapZone = async (act) => {
    const point = await pointOf(act);
    if (!point) { fail(`«${act}»: такого места на рисунке нет`); return false; }
    if (point.covered) { fail(`«${act}»: место целиком заслонено — нажать нельзя`); return false; }
    await page.touchscreen.tap(point.x, point.y);
    await pause(450);
    return true;
  };
  // Забота нажатием на рисунок: кнопка под рисунком отмечается сделанной, её слова меняются.
  for (const act of ["pet", "feed", "play", "tea", "water"]) {
    const before = await said();
    if (!await tapZone(act)) continue;
    const after = await said();
    if (!await done(act)) fail(`«${act}»: нажатие на рисунок заботой не стало (её слова: «${after}»)`);
    else if (after === before || !after) fail(`«${act}»: её слова не изменились`);
  }
  // Она, окно и вещи: её слова о них.
  for (const [act, expected] of [["her", null], ["window", lines.window], ...Object.entries(lines.things).map(([key, line]) => [`thing:${key}`, line])]) {
    if (!seen.zones.includes(act)) { if (act !== "thing:плед") fail(`«${act}»: места на рисунке нет`); continue; }
    if (!await tapZone(act)) continue;
    const after = await said();
    if (!after) fail(`«${act}»: она молчит`);
    else if (expected && after !== expected) fail(`«${act}»: сказано «${after}», а ждали «${expected}»`);
  }
  // Кнопки под рисунком: второй раз за день — другие слова; кнопка остаётся отмеченной.
  for (const act of ["pet", "feed", "play", "tea", "water"]) {
    const before = await said();
    await page.tap(`#actions button[data-act="${act}"]`);
    await pause(450);
    const after = await said();
    if (!after || after === before) fail(`кнопка «${act}»: её слова не изменились`);
    if (!await done(act)) fail(`кнопка «${act}»: отметка пропала`);
  }
  // Сценка дня: выбор — исход; кнопки исчезают.
  await page.tap('#sceneChoice button[data-pick="1"]');
  await pause(450);
  const scene = await page.evaluate(() => {
    // Видно ли на самом деле: атрибут `hidden` не в счёт — стиль `display` может оказаться сильнее него.
    const shown = (id) => { const node = document.getElementById(id); return getComputedStyle(node).display !== "none" && node.getBoundingClientRect().height > 0; };
    return { choice: shown("sceneChoice"), picked: shown("scenePicked"), text: document.getElementById("scenePicked").textContent };
  });
  if (scene.choice) fail("сценка сыграна, а кнопки выбора остались на экране");
  if (!scene.picked || !/Новая сценка — завтра\./u.test(scene.text)) fail(`исход сценки не показан: «${scene.text}»`);
  console.log(`  нажато: забота на рисунке и кнопками, она, окно, вещей — ${Object.keys(lines.things).length}, сценка`);
  if (shot) { await page.screenshot({ path: shot, fullPage: false }); console.log(`  снимок: ${shot}`); }

  // ── 3. кто получает нажатие — на всех рисунках ─────────────────────────────
  console.log("3. Кто получает нажатие");
  const report = await page.evaluate(async () => {
    const scene = await import("./scene.js");
    const backdrop = document.querySelector("#backdrop"), inside = document.querySelector("#inside");
    const broken = new Map(), covered = new Map(), free = new Map();
    let drawings = 0, checks = 0;
    const note = (map, key, label) => { const entry = map.get(key) ?? { count: 0, where: [] }; entry.count += 1; if (entry.where.length < 3) entry.where.push(label); map.set(key, entry); };
    const owner = (x, y) => { checks += 1; return document.elementFromPoint(x, y); };
    /** Есть ли в области хоть одна точка, где нажатие получает она сама: сетка шесть на шесть. */
    const reachable = (node, box) => {
      for (let i = 1; i <= 6; i += 1) for (let j = 1; j <= 6; j += 1) if (owner(box.left + box.width * i / 7, box.top + box.height * j / 7)?.closest?.("[data-act]") === node) return true;
      return false;
    };
    for (const part of ["день", "ночь"]) {
      backdrop.innerHTML = scene.drawBackdrop(part);
      for (const things of [[], [...scene.THINGS]]) for (const pose of scene.HER_POSES) for (const place of scene.CAT_PLACES) for (const shape of scene.CAT_SHAPES) {
        const label = `${part}/${things.length ? "вещи" : "пусто"}/${pose}/${shape}.${place}`;
        inside.innerHTML = scene.drawInside({ part, her: { pose, key: "дело" }, cat: { shape, place, key: "сыт" }, plant: "dry", things, lamp: "#7fd0c8" });
        drawings += 1;
        for (const node of inside.querySelectorAll(".zones [data-act]")) {
          const act = node.dataset.act, box = node.getBoundingClientRect();
          let own = 0;
          const takers = new Set();
          for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7]]) {
            const hit = owner(box.left + box.width * fx, box.top + box.height * fy), got = hit?.closest?.("[data-act]");
            if (got === node) own += 1; else takers.add(got?.dataset.act ?? `(${hit?.tagName ?? "ничего"})`);
          }
          const who = [...takers].sort().join(", ");
          // Нажатие внутри области обязано попасть в чью-то область: ушло в сам рисунок — слой нажатий дыряв.
          if ([...takers].some(name => name.startsWith("("))) note(broken, `${act}: нажатие уходит мимо слоя нажатий (${who})`, label);
          if (own === 5) { free.set(act, (free.get(act) ?? 0) + 1); continue; }
          // Забота — поверх всех: её не заслоняет никто и никогда.
          if (["water", "tea", "feed", "play"].includes(act)) { note(broken, `${act} ← ${who}`, label); continue; }
          if (own > 0 || reachable(node, box)) continue;
          // До неё и до Байта можно дотянуться на любом рисунке. Вещь и окно фигура заслонить может:
          // она сидит на подушке — нажатие по праву её. Но не на каждом рисунке (сверка — ниже).
          if (act === "her" || act === "pet") note(broken, `${act}: не дотянуться ← ${who}`, label);
          else note(covered, `${act} ← ${who}`, label);
        }
      }
    }
    const acts = new Set(["window", ...scene.THINGS.map(key => `thing:${key}`)]);
    for (const act of acts) if (!free.get(act)) note(broken, `${act}: нет ни одного рисунка, где место свободно целиком`, "все рисунки");
    const list = (map) => [...map.entries()].map(([key, value]) => ({ key, ...value })).sort((a, b) => b.count - a.count);
    return { drawings, checks, broken: list(broken), covered: list(covered) };
  });
  console.log(`  рисунков ${report.drawings}, проверок ${report.checks}`);
  for (const item of report.broken) fail(`${item.key} — ${item.count} раз: ${item.where.join(" | ")}`);
  if (report.covered.length) console.log(`  фигура заслоняет вещь целиком (не ошибка — нажатие по праву её): ${report.covered.map(item => `${item.key} ×${item.count}`).join("; ")}`);

  if (errors.length) for (const text of errors) fail(`ошибка на странице: ${text}`);
} catch (error) {
  fail(`проверка оборвалась: ${error?.stack ?? error}`);
} finally {
  await browser.close().catch(() => {});
  server.close();
}

if (failures.length) { console.log(`\nстраница комнаты: ${failures.length} ${failures.length === 1 ? "замечание" : "замечаний"}`); process.exit(1); }
console.log("\nстраница комнаты: всё нажимается");
