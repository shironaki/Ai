/* global document, getComputedStyle, requestAnimationFrame */
/**
 * Страница комнаты в настоящем браузере: всё, что человек нажимает, нажимает этот скрипт.
 *
 *   bash scripts/verify.sh page                 запуск (ставит браузер во временную папку и зовёт этот файл)
 *   bash scripts/verify.sh page /tmp/room.png   то же и снимок страницы
 *
 * Зачем. Тесты без браузера (`tests/miniapp.test.mjs`) проверяют разметку рисунка, но не знают, кто получит
 * нажатие: в 0.38.0 ночью свет лампы, нарисованный позже чайника, молча забирал его нажатия, а у сыгранной
 * сценки оставались кнопки. По картинке этого не видно. Здесь страница открывается как витрина (вне Telegram
 * она показывает комнату сама, сердце не нужно) и проверяется шесть вещей:
 *   1. страница открылась без ошибок, комната нарисована; она стоит в ней картинкой (с 0.40.0), и картинка лежит
 *      в рисунке один раз — от нажатий она не грузится заново;
 *   2. каждое место на рисунке, каждая кнопка заботы и сценка дня отзываются на нажатие пальцем;
 *   3. на всех рисунках (день и ночь × без вещей и со всеми × её позы × места и фигуры Байта; она — и картинкой,
 *      и нарисованная кодом): заботу (Колючка, чайник, миска, клубок) не заслоняет никто; до неё и до Байта
 *      можно дотянуться всегда; вещь или окно фигура заслонить может (она сидит на подушке — нажатие по праву
 *      её), но не навсегда.
 *   4. движение: дождь едет слоем, и только слоем, — на свой шаг за свой оборот, без пустых краёв; в комнате
 *      движется то, что должно; у того, кто просил движение не показывать, не движется ничего. Снимок этого
 *      не покажет: в 0.39.0 дождь шёл вдвое быстрее и на каждом обороте оголял верх окна — правило стилей
 *      задевало и струи внутри слоя. На неподвижной картинке всё было верно.
 *   5. старые копии: страница — четыре файла, и после новой публикации браузер может какое-то время держать
 *      старую копию любого из них. Каждая смесь прежних и новых файлов (их четырнадцать) должна открыться и
 *      отозваться на заботу. В 0.39.0 шесть смесей из четырнадцати оставляли пустую страницу: новый `app.js`
 *      брал из `scene.js` имя, которого в прежнем рисунке нет, и писал в слой, которого нет в прежней разметке.
 *      Прежнюю страницу достаёт из истории `verify.sh` (последний коммит с другим номером страницы).
 *   7. она живая (0.41.0): днём у состояния несколько поз — нажали на неё, и поза сменилась (прежняя тает, новая
 *      проявляется), сама — через полминуты; у картинки с «веками» она моргает; по голове её гладят (сердечко,
 *      во второй раз — другие слова); коробка Байта отвечает; звук включается нажатием, запоминается, а без
 *      нажатия не начинается. Вечером у каждого состояния — картинки в свитере (0.42.0), и поз в нём столько же,
 *      сколько в куртке (0.43.0): нажатие меняет позу, а куртка вечером не появляется ни на миг; где у картинки
 *      есть «веки», она моргает; у «сна» поза одна — нажатие её не меняет и ничего не ломает.
 *   8. своя жизнь, погода, смена часа (0.44.0): она и Байт сами, по очереди, переходят к следующему занятию и
 *      доходят до нового места шагом, а слова под рисунком — о нынешней картинке; нажали на неё — следующее
 *      занятие сразу; погладили Байта второй раз — «перевернулся на спину», и на рисунке он на спине; сценка дня
 *      видна на рисунке и уходит с него после выбора; семь видов неба — струи, хлопья или пусто, гроза сверкает;
 *      час сменился при открытой странице — свет перетекает, а если она при этом переодевается, то уходит к
 *      шкафу, на её месте надпись «*переодевается*», и возвращается она в другом. В 0.43.0 открытая в 17:59
 *      комната в 18:00 не менялась, а слова «Байт перевернулся на спину» стояли под сидящим Байтом.
 *   6. её картинка не загрузилась: папки `her/` на сервере нет — или файл пришёл, а картинка в нём не читается
 *      (браузер не знает формата, страница не даёт её показать). Комната открывается, она нарисована кодом,
 *      забота нажимается. Второй случай без проверки оставил бы её невидимой: ссылка на картинку в рисунке
 *      есть, а показать нечего.
 *
 * Браузер (puppeteer-core и @sparticuz/chromium) зависимостью проекта не становится: `verify.sh` ставит его
 * во временную папку и запускает этот файл оттуда. Аргументы: <папка страницы> [куда положить снимок]
 * [папка прежней страницы]; снимок не нужен, а прежняя страница есть — вторым словом «-».
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const [, , folder, shotArg = "", previous = "", rootArg = ""] = process.argv;
const shot = shotArg === "-" ? "" : shotArg;
// Корень репозитория — на папку выше страницы: шаг 9 берёт оттуда настоящее сердце на стабе базы (`tests/fixtures/kit.mjs`).
// Проверяется копия страницы без комментариев (`SLIM=1`, 0.51.0) — корень называют четвёртым словом: копия лежит не в нём.
const root = rootArg || join(folder, "..");
if (!folder) { console.error("Нужна папка страницы: node room-check.mjs <папка miniapp> [снимок.png|-] [папка прежней страницы] [корень репозитория]"); process.exit(2); }

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
/** Какие файлы сейчас отдаются из прежней страницы (шаг 5); обычно — никакие. */
let stale = new Set();
/** Её картинки (шаг 6): `true` — отдаются; `false` — их нет на сервере; "broken" — файл есть, картинка в нём не читается. */
let pictures = true;
const BROKEN = 'export default { w: 318, h: 900, cx: 0.5, src: "data:image/webp;base64,AAAA" };\n';
/** Картинки комнаты (шаг 6а): те же три случая — отдаются, их нет, файл есть, а картинка в нём не читается. */
let roomPictures = true;
const BROKEN_ROOM = (name) => `export default { v: 1, name: "${name}", w: 800, h: 1040, src: "data:image/webp;base64,AAAA", things: { w: 8, h: 8, src: "data:image/webp;base64,AAAA", at: {} }, bulbs: [] };\n`;
const server = createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/u, "");
  const name = path === "/" ? "index.html" : path.replace(/^[/\\]+/u, "");
  const file = join(stale.has(name) ? previous : folder, name);
  try {
    if (roomPictures !== true && /^room[/\\]/u.test(name)) {
      if (roomPictures !== "broken") throw new Error("картинок комнаты нет");
      response.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store" });
      response.end(BROKEN_ROOM(/([a-z]+)\.js$/u.exec(name)?.[1] ?? "day"));
      return;
    }
    if (pictures !== true && /^her[/\\]/u.test(name)) {
      if (pictures !== "broken") throw new Error("картинок нет");
      response.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store" });
      response.end(BROKEN);
      return;
    }
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
    art: document.querySelectorAll("#room .art *").length, rain: document.querySelectorAll(".rainbox .rain").length,
    foot: document.querySelector("#foot").textContent, scene: !document.querySelector("#scene").hidden,
  }));
  if (seen.state !== "ready") fail(`комната не открылась: состояние «${seen.state}», её слова: «${await said()}»`);
  if (seen.light !== "evening") fail(`свет не вечерний: «${seen.light}»`);
  if (seen.art < 200 || !seen.rain) fail(`рисунок пуст: ${seen.art} частей, дождя — ${seen.rain}`);
  if (!/витрина/u.test(seen.foot)) fail(`вне Telegram страница должна назвать себя витриной: «${seen.foot}»`);
  if (!seen.scene) fail("карточки «Сценка дня» нет");
  // Она — картинкой: определение лежит в кладовой рисунка, комната на него ссылается, а сама картинку не несёт.
  const painted = () => page.evaluate(() => {
    // С 0.53.0 в кладовой лежат и картинки комнаты (`r-room-…`): здесь — только её (`r-her-…`).
    const kept = [...document.querySelectorAll('#store image[id^="r-her-"]')], used = [...document.querySelectorAll('#inside use[href^="#r-her-"]')].map(node => node.getAttribute("href"));
    return {
      // «Веки» (`…-blink`) — заплатка на глаза, она маленькая; «улыбка» (`…-smile`, 0.50.0) — на лицо; сама картинка — в рост.
      kept: kept.map(node => node.id), sized: kept.every(node => node.namespaceURI === "http://www.w3.org/2000/svg" && node.getBBox().width > (/-(?:blink|look[lr])$/u.test(node.id) ? 20 : node.id.endsWith("-smile") ? 40 : 100) && node.getBBox().height > (/-(?:blink|look[lr])$/u.test(node.id) ? 8 : node.id.endsWith("-smile") ? 30 : 100)),
      used, inline: document.querySelectorAll("#inside image").length, drawn: document.querySelectorAll("#inside .breath").length,
      // Видна ли она на самом деле: у ссылки на картинку есть размер на экране.
      shown: [...document.querySelectorAll('#inside > .art use[href^="#r-her-"]')].some(node => node.getBoundingClientRect().height > 200),
    };
  });
  const first = await painted();
  if (!first.kept.some(id => !/-(?:blink|smile|look[lr])$/u.test(id)) || !first.sized) fail(`её картинки нет в кладовой рисунка: ${JSON.stringify(first.kept)}`);
  if (!first.used.some(href => first.kept.includes(String(href).slice(1))) || !first.shown) fail(`комната не показывает её картинку: ссылки ${JSON.stringify(first.used)}, в кладовой ${JSON.stringify(first.kept)}`);
  if (first.inline) fail(`картинка лежит прямо в комнате (${first.inline}) — будет грузиться заново при каждом нажатии`);
  if (first.drawn) fail("она и картинкой, и нарисована кодом сразу");
  console.log(`  состояние ${seen.state}, свет ${seen.light}, частей рисунка ${seen.art}, мест для нажатия ${seen.zones.length}; она — картинкой «${first.kept.join("», «")}»`);

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
    return { her: look.her.line, window: look.window, box: look.box?.line ?? "", things: Object.fromEntries(look.things.map(item => [item.key, item.line])) };
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
    // Чайник (0.48.0): сначала она спрашивает, какой чай налить, — под её словами три кнопки; забота — сам выбор.
    if (act === "tea") {
      const asked = await page.evaluate(() => { const box = document.getElementById("teas"); return Boolean(box) && !box.hidden; });
      if (!asked) fail("«tea»: нажали на чайник — а выбора чая под её словами нет");
      else { await page.evaluate(() => document.querySelector('#teas [data-tea="жасмин"]').click()); await pause(450); }
    }
    const after = await said();
    if (!await done(act)) fail(`«${act}»: нажатие на рисунок заботой не стало (её слова: «${after}»)`);
    else if (after === before || !after) fail(`«${act}»: её слова не изменились`);
  }
  // Она, окно, коробка Байта и вещи: её слова о них.
  for (const [act, expected] of [["her", null], ["window", lines.window], ["box", lines.box], ...Object.entries(lines.things).map(([key, line]) => [`thing:${key}`, line])]) {
    if (!seen.zones.includes(act)) { if (act !== "thing:плед") fail(`«${act}»: места на рисунке нет`); continue; }
    if (!await tapZone(act)) continue;
    const after = await said();
    if (!after) fail(`«${act}»: она молчит`);
    // Окно (0.48.0) по нажатию открывается: сначала её слова об этом, за ними — прежние, о том, что за окном.
    else if (expected && after !== expected && !(act === "window" && after.endsWith(expected))) fail(`«${act}»: сказано «${after}», а ждали «${expected}»`);
  }
  // Погладить её по голове: её слова меняются, над головой — сердечко; во второй раз — другие слова, без сердечка.
  {
    const before = await said();
    if (await tapZone("pat")) {
      const hearts = await page.evaluate(() => document.querySelectorAll("#stage .heart").length);
      const once = await said();
      if (!once || once === before) fail("погладить её: слова не изменились");
      if (!hearts) fail("погладить её: сердечка над головой нет");
      await pause(1300);
      if (await tapZone("pat")) {
        const twice = await said();
        if (!twice || twice === once) fail("погладить её во второй раз: слова те же, что в первый");
        if (await page.evaluate(() => document.querySelectorAll("#stage .heart").length)) fail("погладить её во второй раз: сердечко появилось снова");
      }
    }
  }
  // Полка с книгами (0.45.0): нажали — она отвечает и садится читать (картинка «read»); спит — только отвечает.
  {
    const before = await said();
    if (!seen.zones.includes("book")) fail("полка с книгами: места на рисунке нет");
    else if (await tapZone("book")) {
      const after = await said();
      if (!after || after === before) fail("полка с книгами: её слова не изменились");
      else if (!/^…Сплю/u.test(after)) {
        let reads = false;
        for (let i = 0; i < 40 && !reads; i += 1) { await pause(150); reads = await page.evaluate(() => Boolean(document.querySelector('#inside use[href="#r-her-read"], #inside use[href="#r-her-home-read"]'))); }
        if (!reads) fail("полка с книгами: она не села читать — картинки «read» на рисунке нет");
      }
    }
  }
  // Колонка (0.46.0): нажали — над ней три ноты и она танцует; нажали ещё раз — выключила. Спит — только отвечает.
  {
    const before = await said();
    if (!seen.zones.includes("music")) fail("колонка: места на рисунке нет");
    else if (await tapZone("music")) {
      const after = await said();
      if (!after || after === before) fail("колонка: её слова не изменились");
      else if (!/^…Сплю/u.test(after)) {
        let plays = false;
        for (let i = 0; i < 40 && !plays; i += 1) { await pause(150); plays = await page.evaluate(() => document.querySelectorAll("#inside .note").length === 3 && Boolean(document.querySelector('#inside use[href="#r-her-play2"], #inside use[href="#r-her-home-play2"]'))); }
        if (!plays) fail("колонка: музыка включена — а трёх нот над колонкой или танца на рисунке нет");
        await tapZone("music");
        let quiet = false;
        for (let i = 0; i < 40 && !quiet; i += 1) { await pause(150); quiet = await page.evaluate(() => document.querySelectorAll("#inside .note").length < 3); }
        if (!quiet) fail("колонка: выключили — а ноты остались");
      }
    }
    // Колонка включила звук на этот заход, не запоминая: выбор запоминает только кнопка «звук».
    const sounded = await page.evaluate(() => ({ kept: localStorage.getItem("ai-room-sound"), on: document.getElementById("sound")?.getAttribute("aria-pressed") === "true" }));
    if (sounded.kept === "1") fail("колонка: нажатие запомнило звук включённым — запоминать должна только кнопка «звук»");
    // Вернуть как было: звук проверяется отдельно (шаг 7).
    if (sounded.on) { await page.evaluate(() => document.getElementById("sound").click()); await pause(300); }
  }
  // Кнопки под рисунком (0.47.0): чай на выбор, тихий час, наряд по просьбе.
  {
    const chip = (id) => page.evaluate((name) => { const button = document.getElementById(name); return button && !button.hidden ? button.textContent.trim() : ""; }, id);
    const idle = (id) => page.evaluate((name) => document.getElementById(name)?.disabled === false, id);
    const press = async (id) => { await page.evaluate((name) => document.getElementById(name).click(), id); await pause(400); };
    const tea = await chip("brew");
    if (!/^Чай: (?:жасмин|улун|мята)$/u.test(tea)) fail(`кнопки: «Чай: …» под рисунком нет (${tea || "скрыта"})`);
    else {
      const before = await said();
      await press("brew");
      const next = await chip("brew");
      if (next === tea || !/^Чай: (?:жасмин|улун|мята)$/u.test(next)) fail(`кнопки: чай не сменился (${tea} → ${next})`);
      if ((await said()) === before) fail("кнопки: о новом чае она ничего не сказала");
    }
    const quiet = await chip("quiet");
    if (quiet !== "Посидеть рядом") fail(`кнопки: «Посидеть рядом» под рисунком нет (${quiet || "скрыта"})`);
    else {
      await press("quiet");
      let counts = false;
      for (let i = 0; i < 20 && !counts; i += 1) { await pause(150); counts = /^Тихий час · \d+:\d\d$/u.test(await chip("quiet")); }
      if (!counts) fail(`кнопки: тихий час начат — а отсчёта на кнопке нет («${await chip("quiet")}»)`);
      const curled = await page.evaluate(() => document.getElementById("quiet").getAttribute("aria-pressed") === "true");
      if (counts && !curled) fail("кнопки: тихий час идёт — а кнопка не отмечена нажатой");
      await press("quiet");
      if ((await chip("quiet")) !== "Посидеть рядом") fail("кнопки: тихий час закончили — а отсчёт на кнопке остался");
    }
    const wear = await chip("wear");
    if (!/^Надеть (?:свитер|куртку)$/u.test(wear)) fail(`кнопки: «Надеть …» под рисунком нет (${wear || "скрыта"})`);
    else {
      // Сцена у шкафа: уходит, «*переодевается*», возвращается в другом. Спит — не переодевается: кнопка прежняя.
      const dressed = async (was) => {
        await press("wear");
        for (let i = 0; i < 100; i += 1) { await pause(250); const now = await chip("wear"); if (now !== was && /^Надеть/u.test(now) && await idle("wear")) return true; }
        return false;
      };
      const turned = await dressed(wear);
      if (!turned && !/Сплю/u.test(await said())) fail(`кнопки: нажали «${wear}» — а наряд не сменился`);
      if (turned) {
        await pause(1500);
        const home = wear === "Надеть свитер";
        const worn = await page.evaluate(() => Array.from(document.querySelectorAll('#inside use[href^="#r-her-"]'), (node) => node.getAttribute("href")));
        if (worn.some((href) => href.startsWith("#r-her-home-") !== home)) fail(`кнопки: надела ${home ? "свитер" : "куртку"} — а на рисунке ${worn.join(", ")}`);
        // Вернуть как было: дальше проверяется наряд по часам.
        if (!(await dressed(await chip("wear")))) fail("кнопки: обратно наряд не сменился");
        await pause(1200);
      }
    }
  }
  // Слово ей (0.57.0): поле под её словами. Пустое поле ничего не шлёт; напечатали «Привет!», отправили — под
  // рисунком её ответ, поле пустое.
  {
    const form = await page.evaluate(() => { const box = document.getElementById("words"); return box ? { hidden: box.hidden, max: document.getElementById("word")?.maxLength ?? 0 } : null; });
    if (!form || form.hidden) fail("слово: поля для слов под её словами нет");
    else {
      if (form.max !== 200) fail(`слово: поле пускает ${form.max} знаков, а сердце берёт двести`);
      for (let i = 0; i < 40 && !(await page.evaluate(() => document.getElementById("wordSend").disabled === false)); i += 1) await pause(250);
      const before = await said();
      await page.evaluate(() => { document.getElementById("word").value = "   "; document.getElementById("words").requestSubmit(); });
      await pause(300);
      if ((await said()) !== before) fail("слово: отправили пустое поле — а её слова сменились");
      await page.evaluate(() => { document.getElementById("word").value = "Привет!"; document.getElementById("words").requestSubmit(); });
      let answered = false;
      for (let i = 0; i < 20 && !answered; i += 1) { await pause(150); answered = /^Привет\. Заходите/u.test(await said()); }
      if (!answered) fail(`слово: сказали «Привет!» — а под рисунком «${await said()}»`);
      const left = await page.evaluate(() => document.getElementById("word").value);
      if (left !== "") fail(`слово: ответ пришёл — а в поле осталось «${left}»`);
      const box = await page.evaluate(() => { const field = document.getElementById("word").getBoundingClientRect(), talk = document.getElementById("talk").getBoundingClientRect(); return { inside: field.left >= talk.left && field.right <= talk.right, wide: Math.round(field.width), font: parseFloat(getComputedStyle(document.getElementById("word")).fontSize) }; });
      if (!box.inside || box.wide < 120) fail(`слово: поле не помещается под её словами (${JSON.stringify(box)})`);
      if (box.font < 16) fail(`слово: шрифт поля ${box.font} — телефон приблизит страницу при вводе`);
    }
  }
  // Чайник, окно и она сама (0.48.0). Нажали на чайник — она спрашивает, какой чай налить, и под её словами три
  // кнопки; выбрали — налит этот чай, кнопки убраны. Нажали на окно — створка открыта; ещё раз — закрыта. Нажали на
  // неё — она поднимает глаза (страница ставит на рисунок слово «poked»).
  {
    const kinds = () => page.evaluate(() => { const box = document.getElementById("teas"); return box && !box.hidden ? [...box.querySelectorAll("button")].map(button => button.textContent.trim()) : []; });
    if (!seen.zones.includes("tea")) fail("чайник: места на рисунке нет");
    else if (await tapZone("tea")) {
      const offered = await kinds();
      if (offered.join(", ") !== "Жасмин, Улун, Мята") fail(`чайник: выбора чая под её словами нет (${offered.join(", ") || "скрыт"})`);
      else {
        const before = await said();
        await page.evaluate(() => document.querySelector('#teas [data-tea="улун"]').click());
        let poured = false;
        for (let i = 0; i < 40 && !poured; i += 1) { await pause(150); poured = (await kinds()).length === 0 && (await said()) !== before; }
        if (!poured) fail("чайник: выбрали улун — а выбор остался на месте или она ничего не сказала");
        const chip = await page.evaluate(() => document.getElementById("brew")?.textContent.trim() ?? "");
        if (chip !== "Чай: улун") fail(`чайник: налили улун — а на кнопке под рисунком «${chip}»`);
      }
    }
    // Окно к этому шагу уже открыто или закрыто (на него нажимали выше): каждое нажатие меняет створку на рисунке.
    const ajar = () => page.evaluate(() => Boolean(document.querySelector("#inside .fx-window")));
    const flips = async (was) => { for (let i = 0; i < 40; i += 1) { await pause(150); if ((await ajar()) !== was) return true; } return false; };
    if (!seen.zones.includes("window")) fail("окно: места на рисунке нет");
    else {
      const was = await ajar();
      if (await tapZone("window") && !(await flips(was))) fail(`окно: нажали — а створка ${was ? "не закрылась" : "не открылась"}`);
      else if (await tapZone("window") && !(await flips(!was))) fail(`окно: нажали ещё раз — а створка ${was ? "не открылась" : "не закрылась"}`);
    }
    if (seen.zones.includes("her") && await tapZone("her")) {
      if (!(await page.evaluate(() => document.getElementById("inside").classList.contains("poked")))) fail("нажали на неё: она не подняла глаза — слова «poked» на рисунке нет");
    }
  }
  // Рисунок меняется по частям (0.48.0, «перед сменой анимации мерцает чёрным экран»): от одной перемены на странице
  // заменяются только её части — стены, шторы и шкаф остаются теми же узлами, их движения не начинаются заново.
  {
    const mark = () => page.evaluate(() => {
      const parts = [...document.querySelectorAll("#inside > .art > g")].filter(node => node.firstElementChild);
      for (const node of parts) node.firstElementChild.dataset.was = "1";
      // Стены: у комнаты кодом — заливка `…-wall`, у комнаты картинкой (0.53.0) — ссылка на саму картинку.
      const wall = parts.find(node => node.innerHTML.includes("url(#r-wall)") || node.innerHTML.includes("url(#q-wall)") || /href="#r-room-[a-z]+"/u.test(node.innerHTML));
      if (wall) wall.firstElementChild.dataset.was = "wall";
      return { all: document.querySelectorAll("#inside > .art > g").length, marked: parts.length, wall: Boolean(wall) };
    });
    const count = () => page.evaluate(() => ({
      kept: [...document.querySelectorAll("#inside > .art > g")].filter(node => node.firstElementChild?.dataset.was).length,
      wall: Boolean(document.querySelector('#inside > .art > g > [data-was="wall"]')),
    }));
    const before = await mark();
    if (before.all < 50 || !before.wall) fail(`рисунок по частям: частей на странице ${before.all}, стены ${before.wall ? "есть" : "не найдены"} — комната нарисована одним куском`);
    else {
      let lost = 0, after = null;
      for (const act of ["feed", "play", "pet"]) {
        if (lost > 0 || !seen.zones.includes(act)) continue;
        await tapZone(act);
        await pause(1200);
        after = await count();
        lost = before.marked - after.kept;
      }
      if (!after) fail("рисунок по частям: нажать было не на что");
      else if (lost < 1) fail("рисунок по частям: Байта покормили, с ним поиграли, его погладили — а на рисунке ничего не заменено");
      else if (lost > 12) fail(`рисунок по частям: от одной перемены заменено ${lost} частей из ${before.marked} — комната перерисована целиком`);
      else if (!after.wall) fail("рисунок по частям: от перемены у Байта перерисованы стены");
    }
  }
  // Лампа (0.46.0): вечером и ночью нажатие гасит её (тёплого света лампы на рисунке нет) и зажигает; днём — только слова.
  {
    const before = await said();
    if (!seen.zones.includes("lamp")) fail("лампа: места на рисунке нет");
    else if (await tapZone("lamp")) {
      // Мест два — гирлянда и сама лампа; `tapZone` нажимает первое, гирлянду.
      const after = await said();
      if (!after || after === before) fail("лампа: её слова не изменились");
      else if (!/^Днём/u.test(after)) {
        const glow = () => page.evaluate(() => Boolean(document.querySelector('#inside [id$="lampGlow"]')));
        await pause(300);
        if (await glow()) fail("лампа: погасили — а её свет на рисунке остался");
        await tapZone("lamp");
        await pause(300);
        if (!(await glow())) fail("лампа: включили — а света на рисунке нет");
      }
    }
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
  // После всех нажатий её картинка — та же: в кладовой не прибавилось копий, комната по-прежнему ссылается на неё.
  const later = await painted();
  // С 0.45.0 в кладовой больше картинок: вторые кадры поз и «читает» (нажатие на полку) с её веками; с 0.46.0 —
  // оба кадра шага, кадры ещё шести поз и танец (нажатие на колонку). Главное — что ни одна не лежит дважды.
  // С 0.50.0 и 0.51.0 при картинке лежат её заплатки — веки, улыбка, взгляд (у позы до трёх): счёт идёт по самим картинкам.
  const whole = later.kept.filter(id => !/-(?:blink|smile|look[lr])$/u.test(id));
  if (new Set(later.kept).size !== later.kept.length || whole.length > 20) fail(`картинок в кладовой после нажатий: ${JSON.stringify(later.kept)} — копятся`);
  if (!later.shown || later.inline) fail(`после нажатий её картинки не видно: ${JSON.stringify(later.used)}`);
  console.log(`  нажато: забота на рисунке и кнопками, она, окно, вещей — ${Object.keys(lines.things).length}, сценка`);
  if (shot) { await page.screenshot({ path: shot, fullPage: false }); console.log(`  снимок: ${shot}`); }

  // ── 3. кто получает нажатие — на всех рисунках ─────────────────────────────
  console.log("3. Кто получает нажатие");
  // По куску на каждый свет и набор вещей: один долгий вызов упирается в предел ожидания браузера.
  const tally = { drawings: 0, checks: 0, broken: new Map(), covered: new Map(), free: new Map() };
  const merge = (map, list) => { for (const { key, count, where } of list) { const entry = map.get(key) ?? { count: 0, where: [] }; entry.count += count; entry.where.push(...where.slice(0, 3 - entry.where.length)); map.set(key, entry); } };
  // Она картинкой: места её и Байта зависят от позы (где встать) и от картинки (сколько она закрывает) — по
  // картинке каждой ширины у стола, у полки, у кресла и у окна, спящая и отвернувшаяся. Кодом — каждая поза.
  const LOOKS = [
    ...["уют", "устала", "игра"].flatMap(key => ["desk", "shelf", "chair", "sill"].map(pose => [pose, key])),
    ["nap", "сон"], ["chair", "сон"], ["desk", "ревность"], ["back", "обида"],
  ];
  // Вторые и третьи позы (0.41.0) — с теми «фигурой и местом» Байта, какие бывают по словарю: все сочетания подряд
  // утроили бы время проверки, а этих восемнадцати хватает, чтобы увидеть, кто кого закрыл.
  const PAIRS = "sit.bowl walk.bowl lie.bowl sit.sill lie.chair lie.rug curl.pillow curl.desk curl.box sit.near walk.near play.rug claw.chair sit.desk eyes.under sit.top tail.plaid eat.bowl".split(" ").map(pair => pair.split("."));
  for (const how of ["картинкой", "кодом"]) for (const part of ["день", "ночь"]) for (const full of [false, true]) {
    const chunk = await page.evaluate(async (part, full, looks, pairs) => {
      const scene = await import("./scene.js");
      const sprites = {};
      if (looks) for (const name of Object.keys(scene.HER_SPRITES)) sprites[name] = (await import(`./her/${name}.js`)).default;
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
      const things = full ? [...scene.THINGS] : [];
      backdrop.innerHTML = scene.drawBackdrop(part);
      const every = scene.CAT_PLACES.flatMap(place => scene.CAT_SHAPES.map(shape => [shape, place]));
      // Первая поза — со всеми сочетаниями; остальные позы того же состояния — с теми, что бывают по словарю.
      const turns = (key) => (looks && typeof scene.spritesOf === "function" ? scene.spritesOf({ part, her: { pose: "desk", key } }).length : 1);
      const plan = (looks ?? scene.HER_POSES.map(item => [item, "дело"])).flatMap(([pose, key]) => Array.from({ length: turns(key) }, (_, turn) => [pose, key, turn]));
      for (const [pose, key, turn] of plan) for (const [shape, place] of turn ? pairs : every) {
        const label = `${looks ? "картинкой" : "кодом"}/${part}/${full ? "вещи" : "пусто"}/${pose}·${key}${turn ? `·поза ${turn + 1}` : ""}/${shape}.${place}`;
        const view = { part, her: { pose, key, ...(turn ? { turn } : {}) }, cat: { shape, place, key: "сыт" }, plant: "dry", things, lamp: "#7fd0c8" };
        inside.innerHTML = looks ? scene.drawInside(view, { sprites }) : scene.drawInside(view);
        if (looks && !inside.querySelector("use")) note(broken, "her: картинки на рисунке нет", label);
        drawings += 1;
        // Передышка браузеру: пока сценарий не отпустит его, он не выбрасывает снятые рисунки и их движение. Без
        // неё на 10 тысячах рисунков браузер занимал 3,6 ГБ из четырёх и через раз падал («Target closed»); с ней — 1,3 ГБ.
        if (drawings % 40 === 0) await new Promise((done) => { const timer = setTimeout(done, 60); requestAnimationFrame(() => { clearTimeout(timer); done(); }); });
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
          if (act === "her" || act === "pet" || act === "pat") note(broken, `${act}: не дотянуться ← ${who}`, label);
          else note(covered, `${act} ← ${who}`, label);
        }
      }
      const list = (map) => [...map.entries()].map(([key, value]) => ({ key, ...value }));
      return { drawings, checks, broken: list(broken), covered: list(covered), free: [...free.entries()], things: [...scene.THINGS] };
    }, part, full, how === "картинкой" ? LOOKS : null, PAIRS);
    tally.drawings += chunk.drawings;
    tally.checks += chunk.checks;
    merge(tally.broken, chunk.broken);
    merge(tally.covered, chunk.covered);
    // Свободна ли вещь хоть где-то — считается отдельно для неё картинкой и для неё кодом: человек видит одно из двух.
    for (const [act, count] of chunk.free) tally.free.set(`${how}/${act}`, (tally.free.get(`${how}/${act}`) ?? 0) + count);
    tally.things = chunk.things;
  }
  for (const how of ["картинкой", "кодом"]) for (const act of ["window", ...tally.things.map(key => `thing:${key}`)]) {
    if (!tally.free.get(`${how}/${act}`)) tally.broken.set(`${act}: она ${how} — нет ни одного рисунка, где место свободно целиком`, { count: 1, where: ["все рисунки"] });
  }
  const sorted = (map) => [...map.entries()].map(([key, value]) => ({ key, ...value })).sort((a, b) => b.count - a.count);
  const report = { drawings: tally.drawings, checks: tally.checks, broken: sorted(tally.broken), covered: sorted(tally.covered) };
  console.log(`  рисунков ${report.drawings}, проверок ${report.checks}`);
  for (const item of report.broken) fail(`${item.key} — ${item.count} раз: ${item.where.join(" | ")}`);
  if (report.covered.length) console.log(`  фигура заслоняет вещь целиком (не ошибка — нажатие по праву её): ${report.covered.map(item => `${item.key} ×${item.count}`).join("; ")}`);

  // ── 4. что движется ────────────────────────────────────────────────────────
  console.log("4. Движение");
  // Свежая страница: на прежней рисунки перебирались. Часы движения здесь останавливаются и ставятся руками —
  // так сдвиг дождя меряется точно, а не «примерно через полсекунды».
  const stage = await browser.newPage();
  await stage.goto(`${origin}/index.html#part=${encodeURIComponent("вечер")}&things=all`, { waitUntil: "load", timeout: 30_000 });
  await pause(900);
  const motion = await stage.evaluate(async () => {
    const scene = await import("./scene.js");
    const name = (node) => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}${(node.getAttribute("class") ?? "").trim().split(/\s+/u).filter(Boolean).map(item => `.${item}`).join("")}`;
    const out = { stray: [], moving: {}, total: 0, planes: {} };
    for (const animation of document.getAnimations()) {
      const target = animation.effect?.target;
      if (!target || animation.playState !== "running") continue;
      out.total += 1;
      if (target.id === "rainFar" || target.id === "rainNear") continue;
      // Сам слой дождя может гаснуть и проступать (погода сменилась при открытой странице): это прозрачность, а не сдвиг.
      if (target.matches(".rainbox") && animation.transitionProperty === "opacity") continue;
      // Внутри слоя дождя не движется ничего: слой едет целиком. Иначе сдвиги сложатся.
      if (target.closest(".rainbox")) { out.stray.push(`${name(target)} — «${animation.animationName}»: внутри слоя дождя`); continue; }
      if (target.closest("#room, #sky")) { for (const cls of (target.getAttribute("class") ?? "").split(/\s+/u)) if (cls) out.moving[cls] = (out.moving[cls] ?? 0) + 1; continue; }
      if (!target.matches("#say, .heart, .actions button")) out.stray.push(`${name(target)} — «${animation.animationName}»: вне рисунка`);
    }
    const box = document.querySelector(".rainbox").getBoundingClientRect();
    for (const [id, key] of [["rainFar", "far"], ["rainNear", "near"]]) {
      const plane = document.getElementById(id), own = plane.getAnimations(), lines = [...plane.querySelectorAll("path")];
      const info = { animations: own.length, lines: lines.length };
      out.planes[key] = info;
      if (own.length !== 1 || lines.length < 2) continue;
      const [animation] = own, duration = Number(animation.effect.getComputedTiming().duration);
      animation.pause();
      const boxes = (time) => { animation.currentTime = time; return lines.map(line => line.getBoundingClientRect()); };
      // Струя идёт сверху-справа вниз-влево: где она пересекает высоту y.
      const cross = (r, y) => r.right - (y - r.top) * (r.width / r.height);
      const cover = (list) => {
        const gap = Math.abs(list[1].right - list[0].right);
        return {
          top: Math.max(...list.map(r => r.top)) - box.top, bottom: box.bottom - Math.min(...list.map(r => r.bottom)),
          right: box.right - Math.max(...list.map(r => cross(r, box.top))) - gap, left: Math.min(...list.map(r => cross(r, box.bottom))) - box.left - gap,
        };
      };
      const start = boxes(0), half = boxes(duration / 2), end = boxes(duration - 1);
      Object.assign(info, {
        seconds: duration / 1000, wanted: scene.RAIN_SHIFT[key].seconds,
        moved: [half[0].left - start[0].left, half[0].top - start[0].top],
        expected: [scene.RAIN_SHIFT[key].x / 100 * box.width / 2, scene.RAIN_SHIFT[key].y / 100 * box.height / 2],
        gaps: { "в начале оборота": cover(start), "в конце оборота": cover(end) },
      });
      animation.currentTime = 0;
      animation.play();
    }
    return out;
  });
  for (const text of motion.stray) fail(`движется лишнее: ${text}`);
  for (const [key, info] of Object.entries(motion.planes)) {
    if (info.animations !== 1) { fail(`дождь, слой «${key}»: движений у слоя — ${info.animations}, а должно быть одно`); continue; }
    if (Math.abs(info.seconds - info.wanted) > 0.002) fail(`дождь, слой «${key}»: оборот ${info.seconds} с, а в рисунке записано ${info.wanted} с`);
    const off = Math.hypot(info.moved[0] - info.expected[0], info.moved[1] - info.expected[1]);
    if (off > 0.75) fail(`дождь, слой «${key}»: за пол-оборота струя ушла на (${info.moved.map(v => v.toFixed(1)).join("; ")}) точек, а должна на (${info.expected.map(v => v.toFixed(1)).join("; ")}) — сдвиги складываются?`);
    for (const [when, gaps] of Object.entries(info.gaps)) for (const [side, gap] of Object.entries(gaps)) {
      if (gap > 0.5) fail(`дождь, слой «${key}», ${when}: край окна без струй (${side}: ${gap.toFixed(1)} точек)`);
    }
  }
  // Вечером при всех вещах в комнате движутся: лампочки гирлянды, Байт (моргает), капли на стекле, пар над её
  // кружкой. Сама она с 0.40.0 — картинка; с 0.44.0 картинка дышит (`alive`).
  for (const [cls, least] of [["bulb", 20], ["blink", 1], ["slide", 1], ["steam", 1], ["alive", 1]]) {
    if ((motion.moving[cls] ?? 0) < least) fail(`не движется «${cls}»: частей ${motion.moving[cls] ?? 0}, а должно быть не меньше ${least}`);
  }
  // Кто просил движение не показывать, тот не видит никакого: ни в комнате, ни за окном.
  await stage.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await pause(200);
  const restless = await stage.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running").map(animation => {
    const target = animation.effect?.target;
    return `${target?.tagName?.toLowerCase() ?? "?"}${target?.id ? `#${target.id}` : ""}.${(target?.getAttribute?.("class") ?? "").trim().replace(/\s+/gu, ".")} — «${animation.animationName}»`;
  }));
  if (restless.length) fail(`движение просили не показывать, а движется ${restless.length}: ${restless.slice(0, 4).join("; ")}`);
  await stage.close();
  console.log(`  движется частей: ${motion.total} (${Object.entries(motion.moving).sort((a, b) => b[1] - a[1]).map(([cls, count]) => `${cls} ×${count}`).join(", ")}); дождь: ${Object.entries(motion.planes).map(([key, info]) => `«${key}» — оборот ${info.seconds} с`).join(", ")}; без движения по просьбе — ${restless.length ? "нет" : "да"}`);

  // ── 5. старые и новые файлы вперемешку ─────────────────────────────────────
  if (previous) {
    console.log("5. Старые копии");
    const names = ["index.html", "app.js", "logic.js", "scene.js"];
    let opened = 0, mixes = 0;
    // Все смеси, кроме «всё новое» (проверено выше) и «всё прежнее» (это страница, которая уже работает у людей).
    for (let mask = 1; mask < 2 ** names.length - 1; mask += 1) {
      stale = new Set(names.filter((_, index) => mask & (1 << index)));
      mixes += 1;
      const tab = await browser.newPage();
      const broken = [];
      tab.on("pageerror", (error) => broken.push(String(error)));
      tab.on("console", (message) => { if (message.type() === "error" && !/net::ERR_/u.test(message.text())) broken.push(message.text()); });
      await tab.goto(`${origin}/index.html#part=${encodeURIComponent("вечер")}&things=all`, { waitUntil: "load", timeout: 30_000 });
      await pause(600);
      const got = await tab.evaluate(() => ({ state: document.querySelector("#app")?.dataset.state ?? "", art: document.querySelectorAll("#inside *").length, sky: document.querySelectorAll("#backdrop *").length }));
      let fed = false;
      try {
        await tab.tap('#actions button[data-act="feed"]');
        await pause(350);
        fed = await tab.$eval('#actions button[data-act="feed"]', (node) => node.classList.contains("done"));
      } catch { fed = false; }
      const label = `прежние ${[...stale].join(", ")} с новыми остальными`;
      if (got.state !== "ready" || got.art < 150 || got.sky < 20) fail(`${label}: комната не открылась (состояние «${got.state}», частей рисунка ${got.art})${broken.length ? ` — ${broken[0].slice(0, 170)}` : ""}`);
      else if (broken.length) fail(`${label}: ошибка на странице — ${broken[0].slice(0, 170)}`);
      else if (!fed) fail(`${label}: забота не нажимается`);
      else opened += 1;
      await tab.close();
    }
    stale = new Set();
    console.log(`  смесей прежних и новых файлов — ${mixes}, открылись и отозвались — ${opened}`);
  } else console.log("5. Старые копии: прежней страницы рядом нет — не проверялось");

  // ── 6. картинка не загрузилась ─────────────────────────────────────────────
  console.log("6. Без её картинки");
  {
    // С 0.52.0 (сообщение 53): картинка не пришла — кодом она НЕ нарисована. На её месте силуэт «появляется», комната
    // работает, а страница просит картинку снова; пришла — встаёт на место. Память телефона перед каждым случаем
    // пуста: прежние шаги оставили в ней картинки, и без этого она поднялась бы оттуда.
    const fresh = async (hash) => {
      const tab = await browser.newPage();
      const broken = [];
      tab.on("pageerror", (error) => broken.push(String(error)));
      // Отказ сервера на сам файл картинки — ожидаемое: его мы и устроили. Всё остальное — ошибка.
      tab.on("console", (message) => { if (message.type() === "error" && !/net::ERR_|404/u.test(message.text())) broken.push(message.text()); });
      await tab.goto(`${origin}/index.html#${hash}`, { waitUntil: "load", timeout: 30_000 });
      await tab.evaluate(() => { try { localStorage.clear(); } catch { /* память закрыта — тем более пусто */ } });
      await tab.reload({ waitUntil: "load", timeout: 30_000 });
      await pause(1100);
      return { tab, broken };
    };
    const seen = (tab) => tab.evaluate(() => ({
      state: document.querySelector("#app")?.dataset.state ?? "", use: document.querySelectorAll('#inside use[href^="#r-her-"]').length, kept: document.querySelectorAll('#store image[id^="r-her-"]').length,
      her: document.querySelectorAll('#inside .zones [data-act="her"]').length, breath: document.querySelectorAll("#inside .breath").length,
      coming: document.querySelectorAll("#inside .coming").length, foot: document.querySelector("#foot")?.textContent ?? "",
      moving: document.getAnimations().filter(animation => animation.playState === "running" && animation.effect?.target?.closest?.("#inside .breath, #inside .blink")).length,
    }));
    const feeds = async (tab) => {
      try {
        await tab.tap('#actions button[data-act="feed"]');
        await pause(350);
        return await tab.$eval('#actions button[data-act="feed"]', (node) => node.classList.contains("done"));
      } catch { return false; }
    };
    const hash = `part=${encodeURIComponent("вечер")}&things=all`;

    // а) картинки на сервере нет.
    pictures = false;
    {
      const what = "картинки на сервере нет";
      const { tab, broken } = await fresh(hash);
      const got = await seen(tab), fed = await feeds(tab);
      if (got.state !== "ready") fail(`${what}: комната не открылась — состояние «${got.state}»${broken.length ? `, ${broken[0].slice(0, 170)}` : ""}`);
      else if (broken.length) fail(`${what}: ошибка на странице — ${broken[0].slice(0, 170)}`);
      else if (got.use || got.kept) fail(`${what}, а рисунок на неё ссылается (ссылок ${got.use}, в кладовой ${got.kept})`);
      else if (got.breath) fail(`${what}: она нарисована кодом (дышащих частей ${got.breath}) — с 0.52.0 на её месте должен быть силуэт`);
      else if (!got.coming) fail(`${what}: силуэта «появляется» на её месте нет — её не видно вовсе`);
      else if (!fed) fail(`${what}: забота не нажимается`);
      else {
        // Картинка появилась на сервере — страница просит её снова сама (первый раз — через две секунды).
        pictures = true;
        await pause(3200);
        const later = await seen(tab);
        if (!later.kept || !later.use || later.coming) fail(`${what}, потом появилась — а страница её не получила: в кладовой ${later.kept}, ссылок ${later.use}, силуэтов ${later.coming}`);
        else {
          // Память телефона: та же вкладка заходит снова, сервер опять без картинок — она на месте сразу.
          pictures = false;
          await tab.reload({ waitUntil: "load", timeout: 30_000 });
          await pause(1100);
          const again = await seen(tab);
          if (!again.kept || !again.use || again.coming || again.breath) fail(`второй заход без сети: картинка из памяти телефона не поднялась — в кладовой ${again.kept}, ссылок ${again.use}, силуэтов ${again.coming}`);
          else console.log(`  ${what}: комната открылась, на её месте силуэт (кодом не нарисована), забота нажимается; картинка появилась — страница получила её сама; второй заход без сети — она на месте из памяти телефона`);
        }
      }
      await tab.close();
    }
    // б) долго не приходит: через восемь секунд внизу страницы — «картинка Аи ещё в пути».
    pictures = false;
    {
      const { tab } = await fresh(hash);
      await pause(7600);
      const slow = await seen(tab);
      if (!/картинка Аи ещё в пути/u.test(slow.foot)) fail(`картинка не приходит девять секунд, а внизу страницы об этом ни слова: «${slow.foot}»`);
      else if (slow.breath || !slow.coming) fail(`картинка не приходит девять секунд: силуэтов ${slow.coming}, нарисованных кодом частей ${slow.breath}`);
      else console.log("  картинка не приходит: через восемь секунд внизу — «картинка Аи ещё в пути», силуэт на месте");
      await tab.close();
    }
    // в) картинка пришла, но телефон показать её не может — тогда, как и раньше, она нарисована кодом.
    pictures = "broken";
    {
      const what = "картинка пришла, но не читается";
      const { tab, broken } = await fresh(hash);
      const got = await seen(tab), fed = await feeds(tab);
      if (got.state !== "ready") fail(`${what}: комната не открылась — состояние «${got.state}»${broken.length ? `, ${broken[0].slice(0, 170)}` : ""}`);
      else if (broken.length) fail(`${what}: ошибка на странице — ${broken[0].slice(0, 170)}`);
      else if (got.use || got.kept) fail(`${what}, а рисунок на неё ссылается (ссылок ${got.use}, в кладовой ${got.kept}): её не видно вовсе`);
      else if (!got.her || !got.breath) fail(`${what}: она не нарисована кодом — мест нажатия ${got.her}, дышащих частей ${got.breath}`);
      else if (!got.moving) fail(`${what}: нарисованная кодом, она не дышит и не моргает`);
      else if (!fed) fail(`${what}: забота не нажимается`);
      else console.log(`  ${what}: комната открылась, она нарисована кодом (дышит и моргает: ${got.moving}), забота нажимается`);
      await tab.close();
    }
  }
  pictures = true;

  // ── 6а. комната картинкой ──────────────────────────────────────────────────
  console.log("6а. Комната картинкой");
  {
    // 0.53.0 (идея 202): стены, пол, окно и мебель — картинка художника с прозрачным стеклом, вещи — с листа; пока
    // картинки нет, комната нарисована кодом, а пришла — встаёт на место. Память телефона перед случаем пуста.
    const enter = async (hash, clear = true) => {
      const tab = await browser.newPage();
      const broken = [];
      tab.on("pageerror", (error) => broken.push(String(error)));
      tab.on("console", (message) => { if (message.type() === "error" && !/net::ERR_|404/u.test(message.text())) broken.push(message.text()); });
      await tab.goto(`${origin}/index.html#${hash}`, { waitUntil: "load", timeout: 30_000 });
      if (clear) {
        await tab.evaluate(() => { try { localStorage.clear(); } catch { /* память закрыта — тем более пусто */ } });
        await tab.reload({ waitUntil: "load", timeout: 30_000 });
      }
      await pause(1300);
      return { tab, broken };
    };
    const look = (tab) => tab.evaluate(() => ({
      state: document.querySelector("#app")?.dataset.state ?? "",
      kept: [...document.querySelectorAll('#store image[id^="r-room-"]')].map(node => node.id),
      // Картинка видна: ссылка на неё занимает весь рисунок; лист вещей — отдельные ссылки, по одной на вещь.
      shown: [...document.querySelectorAll('#inside > .art use[href^="#r-room-"]')].map(node => [String(node.getAttribute("href")), Math.round(node.getBoundingClientRect().height)]).filter(([href, tall]) => !href.endsWith("-things") && tall > 300).map(([href]) => href),
      things: document.querySelectorAll('#inside > .art svg > use[href$="-things"]').length,
      // Комната кодом: обои на стене — узором (`pattern`); у комнаты картинкой стен кодом нет.
      code: document.querySelectorAll("#inside pattern").length,
      inline: document.querySelectorAll("#inside image").length,
      memory: Object.keys(localStorage).filter(key => key.startsWith("ai-room-pic:")).sort(),
      her: document.querySelectorAll('#inside use[href^="#r-her-"]').length, cat: document.querySelectorAll("#inside .cat").length,
      zones: document.querySelectorAll("#inside .zones [data-act]").length,
    }));
    const feeds = async (tab) => {
      try {
        await tab.tap('#actions button[data-act="feed"]');
        await pause(350);
        return await tab.$eval('#actions button[data-act="feed"]', (node) => node.classList.contains("done"));
      } catch { return false; }
    };
    const day = `part=${encodeURIComponent("день")}&things=all&scene=0&turn=600000`;

    // а) ясный день: комната — картинка «день», вещи с листа, она и Байт на месте, забота нажимается.
    {
      const { tab, broken } = await enter(`${day}&sky=clear`);
      const got = await look(tab), fed = await feeds(tab);
      if (got.state !== "ready") fail(`комната картинкой не открылась — состояние «${got.state}»${broken.length ? `, ${broken[0].slice(0, 170)}` : ""}`);
      else if (broken.length) fail(`комната картинкой: ошибка на странице — ${broken[0].slice(0, 170)}`);
      else if (got.shown.join() !== "#r-room-day" || !got.kept.includes("r-room-day") || !got.kept.includes("r-room-day-things")) fail(`ясный день, а на рисунке не картинка «день»: видно ${JSON.stringify(got.shown)}, в кладовой ${JSON.stringify(got.kept)}`);
      else if (got.code) fail(`комната картинкой, а стены нарисованы ещё и кодом (узоров ${got.code})`);
      else if (got.things < 8) fail(`вещей с листа на рисунке ${got.things} — при всех вещах их не меньше восьми`);
      else if (got.inline) fail(`картинка вставлена в комнату целиком (${got.inline}) — она должна лежать в кладовой, комната на неё только ссылается`);
      else if (!got.her || !got.cat || got.zones < 8) fail(`в комнате картинкой нет её, Байта или мест нажатия: она ${got.her}, Байт ${got.cat}, мест ${got.zones}`);
      else if (!got.memory.some(key => /^ai-room-pic:\d+:day$/u.test(key))) fail(`картинка комнаты не легла в память телефона: ${JSON.stringify(got.memory)}`);
      else if (!fed) fail("комната картинкой: забота не нажимается");
      else console.log(`  ясный день: картинка «день», вещей с листа ${got.things}, она и Байт на месте, забота нажимается, картинка в памяти телефона`);
      await tab.close();
    }
    // б) дождь: картинка «пасмурно» — без солнца на полу.
    {
      const { tab, broken } = await enter(`${day}&sky=rain`);
      const got = await look(tab);
      if (broken.length) fail(`дождь: ошибка на странице — ${broken[0].slice(0, 170)}`);
      else if (got.shown.join() !== "#r-room-dull" || got.code) fail(`дождь, а на рисунке не картинка «пасмурно»: видно ${JSON.stringify(got.shown)}, узоров кода ${got.code}`);
      else console.log("  дождь: картинка «пасмурно»");
      await tab.close();
    }
    // в) картинок комнаты на сервере нет: комната открыта и нарисована кодом; появились — страница получила их сама;
    //    зашли снова без сети — картинка из памяти телефона.
    roomPictures = false;
    {
      const what = "картинок комнаты на сервере нет";
      const { tab, broken } = await enter(`${day}&sky=clear`);
      const got = await look(tab), fed = await feeds(tab);
      if (got.state !== "ready") fail(`${what}: комната не открылась — состояние «${got.state}»${broken.length ? `, ${broken[0].slice(0, 170)}` : ""}`);
      else if (broken.length) fail(`${what}: ошибка на странице — ${broken[0].slice(0, 170)}`);
      else if (got.shown.length || got.kept.length || got.things) fail(`${what}, а рисунок на них ссылается: ${JSON.stringify(got.shown)}, в кладовой ${JSON.stringify(got.kept)}`);
      else if (!got.code) fail(`${what}: комната не нарисована кодом — стен нет вовсе`);
      else if (!got.her || !fed) fail(`${what}: её картинки нет (${got.her}) или забота не нажимается`);
      else {
        roomPictures = true;
        await pause(3300);
        const later = await look(tab);
        if (later.shown.join() !== "#r-room-day" || later.code) fail(`${what}, потом появились — а страница их не получила: видно ${JSON.stringify(later.shown)}, узоров кода ${later.code}`);
        else {
          roomPictures = false;
          await tab.reload({ waitUntil: "load", timeout: 30_000 });
          await pause(1100);
          const again = await look(tab);
          if (again.shown.join() !== "#r-room-day" || again.code) fail(`второй заход без сети: картинка комнаты из памяти телефона не поднялась — видно ${JSON.stringify(again.shown)}, узоров кода ${again.code}`);
          else console.log(`  ${what}: комната открылась кодом, забота нажимается; картинки появились — страница получила их сама; второй заход без сети — из памяти телефона`);
        }
      }
      await tab.close();
    }
    // г) картинка пришла, но не читается — комната остаётся нарисованной кодом.
    roomPictures = "broken";
    {
      const what = "картинка комнаты пришла, но не читается";
      const { tab, broken } = await enter(`${day}&sky=clear`);
      const got = await look(tab), fed = await feeds(tab);
      if (got.state !== "ready" || broken.length) fail(`${what}: комната не открылась или ошибка — «${got.state}»${broken.length ? `, ${broken[0].slice(0, 170)}` : ""}`);
      else if (got.shown.length || got.kept.length) fail(`${what}, а рисунок на неё ссылается: ${JSON.stringify(got.shown)}, в кладовой ${JSON.stringify(got.kept)}`);
      else if (!got.code || !fed) fail(`${what}: комната не нарисована кодом (узоров ${got.code}) или забота не нажимается`);
      else console.log(`  ${what}: комната нарисована кодом, забота нажимается`);
      await tab.close();
    }
    roomPictures = true;
    // д) погода сменилась при открытой странице: была «день» — стала «пасмурно».
    {
      const { tab, broken } = await enter(`${day}&sky=clear&left=1500&thenSky=rain`);
      const first = await look(tab);
      await pause(4200);
      const later = await look(tab);
      if (broken.length) fail(`смена погоды: ошибка на странице — ${broken[0].slice(0, 170)}`);
      else if (first.shown.join() !== "#r-room-day") fail(`смена погоды: до неё на рисунке не «день» — ${JSON.stringify(first.shown)}`);
      else if (later.shown.join() !== "#r-room-dull" || later.code) fail(`небо затянуло, а картинка комнаты прежняя: ${JSON.stringify(later.shown)}, узоров кода ${later.code}`);
      else console.log("  небо затянуло при открытой странице: «день» сменилась на «пасмурно»");
      await tab.close();
    }
    // ж) поворот головы (0.53.0, идея 185): нажали на окно — она смотрит в окно третьим кадром позы; потом кадр тает.
    {
      const { tab, broken } = await enter(`part=${encodeURIComponent("день")}&key=${encodeURIComponent("дело")}&scene=0&turn=600000&sky=clear`);
      let ready = false;
      for (let i = 0; i < 40 && !ready; i += 1) { await pause(150); ready = await tab.evaluate(() => Boolean(document.querySelector("#store #r-her-workc") && document.querySelector("#inside .alive.tr .fr.c"))); }
      const shownNow = () => tab.evaluate(() => {
        const of = (selector) => { const node = document.querySelector(selector); return node ? Number(getComputedStyle(node).opacity) : -1; };
        return { turn: of("#inside .alive.tr .fr.c"), first: of("#inside .alive.tr .fr.a"), second: of("#inside .alive.tr .fr.b") };
      });
      const calm = await shownNow();
      const point = await tab.evaluate(() => { const box = document.querySelector('#room .zones [data-act="window"]')?.getBoundingClientRect(); return box ? { x: box.left + 14, y: box.top + 14 } : null; });
      if (!ready) fail("поворот головы: третий кадр позы «за столом» не пришёл или не встал на рисунок");
      else if (calm.turn > 0.05) fail(`поворот головы: кадр виден, хотя она никуда не смотрит (${calm.turn})`);
      else if (!point) fail("поворот головы: места нажатия «окно» нет");
      else {
        await tab.touchscreen.tap(point.x, point.y);
        let turned = null;
        for (let i = 0; i < 14 && !turned; i += 1) { await pause(120); const seen = await shownNow(); if (seen.turn > 0.9 && seen.first < 0.1 && seen.second < 0.1) turned = seen; }
        await pause(3700);
        const after = await shownNow();
        if (broken.length) fail(`поворот головы: ошибка на странице — ${broken[0].slice(0, 170)}`);
        else if (!turned) fail(`поворот головы: нажали на окно, а третий кадр не проявился: ${JSON.stringify(await shownNow())}`);
        else if (after.turn > 0.05) fail(`поворот головы: взгляд кончился, а кадр остался (${after.turn})`);
        else console.log("  поворот головы: нажали на окно — третий кадр проявился, первые два ушли; взгляд кончился — кадр растаял");
      }
      await tab.close();
    }
    // е) на своей машине `#room=code` оставляет комнату кодом.
    {
      const { tab } = await enter(`${day}&sky=clear&room=code`);
      const got = await look(tab);
      if (got.shown.length || !got.code) fail(`«room=code», а комната не кодом: ${JSON.stringify(got.shown)}, узоров ${got.code}`);
      await tab.close();
    }
  }

  // ── 7. она живая: позы, веки, звук ─────────────────────────────────────────
  console.log("7. Позы, моргание, звук, снег");
  {
    const tab = await browser.newPage();
    const broken = [];
    tab.on("pageerror", (error) => broken.push(String(error)));
    tab.on("console", (message) => { if (message.type() === "error" && !/net::ERR_/u.test(message.text())) broken.push(message.text()); });
    // День, «уют», у окна: поз три (с кружкой, пьёт, сидит в кресле), у первой есть «веки».
    const day = `${origin}/index.html#part=${encodeURIComponent("день")}&key=${encodeURIComponent("уют")}&scene=0`;
    const failed = failures.length;
    await tab.goto(day, { waitUntil: "load", timeout: 30_000 });
    await pause(900);
    const shownNow = () => tab.evaluate(() => ({
      // Второй кадр позы (`.fr.b`, 0.45.0) — не другая поза: ни в «нарисовано», ни в «видно» он не идёт. Третий
      // (`.fr.c`, поворот головы) — тоже: с 0.54.0 он есть у поз в кресле, а вечером в свитере она в них и сидит.
      used: [...document.querySelectorAll("#inside > .art use")].filter(node => !node.closest(".fr.b, .fr.c")).map(node => node.getAttribute("href")).filter(href => /^#r-her-[a-z0-9-]+$/u.test(String(href)) && !/-(?:blink|smile|look[lr])$/u.test(String(href))),
      // Прежняя поза остаётся в рисунке до следующей перерисовки, но уже растаявшей: что на ней сейчас ВИДНО —
      // это ссылки без тех, чья группа «тает» дошла до прозрачности.
      seen: [...document.querySelectorAll("#inside > .art use")].filter(node => !node.closest(".fr.b, .fr.c")).filter(node => { const gone = node.closest(".leave, .stride"); return !gone || Number(getComputedStyle(gone).opacity) > 0.02; })
        .map(node => node.getAttribute("href")).filter(href => /^#r-her-[a-z0-9-]+$/u.test(String(href)) && !/-(?:blink|smile|look[lr])$/u.test(String(href))),
      kept: [...document.querySelectorAll("#store image")].map(node => node.id),
      leave: document.querySelectorAll("#inside .leave").length, arrive: document.querySelectorAll("#inside .arrive").length,
      wink: document.querySelectorAll("#inside use.wink").length,
      // Улыбка (0.50.0): насколько видна заплатка на лицо (0 — скрыта, 1 — видна); второй кадр позы не в счёт.
      grin: [...document.querySelectorAll("#inside use.grin")].filter(node => !node.closest(".fr.b, .fr.c")).map(node => Number(getComputedStyle(node).opacity)),
      // Взгляд в сторону (0.51.0): насколько видна заплатка на глаза со зрачками вбок.
      gaze: [...document.querySelectorAll("#inside use.eyl, #inside use.eyr")].filter(node => !node.closest(".fr.b, .fr.c")).map(node => Number(getComputedStyle(node).opacity)),
      winking: document.getAnimations().filter(animation => animation.playState === "running" && animation.effect?.target?.matches?.("#inside use.wink")).length,
      pouf: document.querySelectorAll('#inside [fill*="r-pouf"]').length,
    }));
    const waitKept = async (id, ms = 4000) => { for (let spent = 0; spent < ms; spent += 200) { if ((await shownNow()).kept.includes(id)) return true; await pause(200); } return false; };
    // Погладить по голове — своё место нажатия (`pat`): нажатие на неё саму меняет позу, а не гладит.
    const tapHead = async () => {
      const point = await tab.evaluate(() => { const box = document.querySelector('#room .zones [data-act="pat"]')?.getBoundingClientRect(); return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null; });
      if (!point) return false;
      await tab.touchscreen.tap(point.x, point.y);
      return true;
    };
    const tapHer = async () => {
      const point = await tab.evaluate(() => { const box = document.querySelector('#room .zones [data-act="her"]')?.getBoundingClientRect(); return box ? { x: box.left + box.width / 2, y: box.top + box.height * 0.6 } : null; });
      if (!point) return false;
      await tab.touchscreen.tap(point.x, point.y);
      return true;
    };
    const start = await shownNow();
    if (!start.used.includes("#r-her-tea")) fail(`днём в «уюте» первая поза — не «с кружкой»: ${JSON.stringify(start.used)}`);
    if (!start.wink || !start.winking) fail(`она не моргает: заплаток на глаза — ${start.wink}, движется — ${start.winking}`);
    if (!start.kept.includes("r-her-tea-blink")) fail(`«век» нет в кладовой рисунка: ${JSON.stringify(start.kept)}`);
    // Следующая поза подгружается заранее — и только тогда нажатие её сменит.
    if (!await waitKept("r-her-tea2")) fail("следующая поза не подгрузилась заранее");
    if (!await tapHer()) fail("на неё не нажать");
    await pause(160);
    const mid = await shownNow();
    if (!mid.used.includes("#r-her-tea2")) fail(`нажали на неё, а поза не сменилась: ${JSON.stringify(mid.used)}`);
    if (!mid.leave || !mid.arrive) fail(`поза сменилась рывком: тающих — ${mid.leave}, проявляющихся — ${mid.arrive}`);
    if (!await waitKept("r-her-tea3")) fail("третья поза не подгрузилась заранее");
    await pause(600);
    await tapHer();
    await pause(700);
    const third = await shownNow();
    // С 0.44.0 она сидит в кресле комнаты: пуфа, который появлялся вместе с ней, больше нет.
    if (!third.used.includes("#r-her-tea3") || third.pouf) fail(`третья поза — сидит в кресле: ${JSON.stringify(third.used)}, пуфов — ${third.pouf}`);
    if (new Set(third.kept).size !== third.kept.length) fail(`картинки в кладовой повторяются: ${JSON.stringify(third.kept)}`);
    // Кадры внутри позы (0.45.0): в кресле с кружкой слоёв два — второй кадр поверх первого, и оба движутся.
    if (!await waitKept("r-her-tea3b")) fail("второй кадр позы «tea3» не подгрузился");
    else {
      let frames = null;
      for (let spent = 0; spent < 5000 && !(frames?.layers === 2 && frames.moving >= 2); spent += 300) {
        await pause(300);
        frames = await tab.evaluate(() => ({
          // Кадры самой позы — внутри `.alive`: у шага (0.46.0) свои два кадра, и после прихода они ещё в рисунке.
          layers: document.querySelectorAll("#inside .alive .fr").length, second: document.querySelector("#inside .alive .fr.b use")?.getAttribute("href") ?? "",
          moving: document.getAnimations().filter(animation => animation.playState === "running" && animation.effect?.target?.matches?.("#inside .alive .fr")).length,
        }));
      }
      if (frames?.layers !== 2 || frames.second !== "#r-her-tea3b" || frames.moving < 2) fail(`кадры позы «tea3»: слоёв — ${frames?.layers}, второй кадр — «${frames?.second}», движется — ${frames?.moving}`);
    }
    // Сама — без нажатия: срок назван в адресе (на странице в Telegram он — от 24 до 40 секунд).
    await tab.goto(`${day}&turn=700`, { waitUntil: "load", timeout: 30_000 });
    await tab.reload({ waitUntil: "load" });
    await pause(700);
    const before = (await shownNow()).used.join();
    let turned = false;
    for (let spent = 0; spent < 6000 && !turned; spent += 300) { await pause(300); turned = (await shownNow()).used.join() !== before; }
    if (!turned) fail("сама она позу не сменила за шесть секунд (срок в адресе — 0,7 с)");

    // Вечер: свитер — у каждого состояния (0.42.0) и у каждой позы (0.43.0). Что должно быть на ней, считает сам
    // рисунок (`spritesOf` — его держат тесты), а здесь проверяется страница: картинки загрузились, нажатие
    // сменило позу, куртка вечером не показалась ни на миг, веки — там, где они есть в модуле картинки.
    const evening = ["дело", "уют", "игра", "сон", "устала", "обида", "ревность"];
    let eveningPoses = 0, eveningLids = 0, eveningGrins = 0, eveningGazes = 0;
    for (const key of evening) {
      await tab.goto(`${origin}/index.html#part=${encodeURIComponent("вечер")}&key=${encodeURIComponent(key)}&scene=0`, { waitUntil: "load", timeout: 30_000 });
      await tab.reload({ waitUntil: "load" });
      const plan = await tab.evaluate(async (mood) => {
        const [scene, logic] = await Promise.all([import("./scene.js"), import("./logic.js")]);
        const look = logic.demoLook(20, { part: "вечер", key: mood, scene: "0" });
        const list = scene.spritesOf({ part: "вечер", her: { pose: look.her.pose, key: mood } });
        const lids = [], grins = [], gazes = [];
        for (const name of list) { const sprite = (await import(`./her/${name}.js`)).default; lids.push(Boolean(sprite.blink)); grins.push(Boolean(sprite.smile)); gazes.push(sprite.lookr ? "r" : sprite.lookl ? "l" : ""); }
        return { list, lids, grins, gazes };
      }, key);
      if (!plan.list.length || plan.list.some(name => !name.startsWith("home-"))) { fail(`вечер, «${key}»: на ней должен быть свитер, а рисунок называет ${JSON.stringify(plan.list)}`); continue; }
      if ((key === "сон") !== (plan.list.length === 1)) fail(`вечер, «${key}»: поз в свитере — ${plan.list.length}`);
      // Ссылок на картинку вечером две: сама она и маска вечерней тени на ней — обе на одну и ту же.
      // `worn` — что на ней видно; `drawn` — всё, что есть в рисунке, вместе с тающей прежней позой.
      const worn = (now) => [...new Set(now.seen)];
      const drawn = (now) => [...new Set(now.used)];
      for (const [index, name] of plan.list.entries()) {
        if (!await waitKept(`r-her-${name}`, 6000)) { fail(`вечер, «${key}»: картинка в свитере («${name}») не загрузилась`); break; }
        if (index) {
          await tapHer();
          await pause(160);
          const mid = await shownNow();
          if (!mid.used.includes(`#r-her-${name}`)) { fail(`вечер, «${key}»: нажали на неё, а поза не сменилась на «${name}»: ${JSON.stringify(drawn(mid))}`); break; }
          if (!mid.leave || !mid.arrive) fail(`вечер, «${key}»: поза сменилась рывком: тающих — ${mid.leave}, проявляющихся — ${mid.arrive}`);
          if (drawn(mid).some(href => !href.startsWith("#r-her-home-"))) fail(`вечер, «${key}»: при смене позы показалась куртка — ${JSON.stringify(drawn(mid))}`);
          await pause(900);
        } else {
          await pause(300);
        }
        const dusk = await shownNow();
        if (worn(dusk).join() !== `#r-her-${name}`) fail(`вечер, «${key}»: на ней не «${name}» — видно ${JSON.stringify(worn(dusk))}, в рисунке ${JSON.stringify(dusk.used)}`);
        const lids = plan.lids[index];
        if (lids !== Boolean(dusk.wink) || (lids && !dusk.winking)) fail(`вечер, «${key}», «${name}»: «веки» — ${dusk.wink}, движется — ${dusk.winking}, а моргать она ${lids ? "должна" : "не должна"}`);
        // Улыбка (0.50.0): заплатка на лицо есть ровно у тех поз, где она нарисована; в покое её не видно; погладили
        // по голове — видна, поза та же; через две с половиной секунды — снова скрыта.
        const grins = plan.grins[index];
        if (grins !== Boolean(dusk.grin.length)) fail(`вечер, «${key}», «${name}»: заплаток «улыбка» — ${dusk.grin.length}, а быть ей ${grins ? "положено" : "не положено"}`);
        if (dusk.grin.some(value => value > 0.02)) fail(`вечер, «${key}», «${name}»: улыбка видна в покое — ${JSON.stringify(dusk.grin)}`);
        if (grins) {
          if (!await tapHead()) fail(`вечер, «${key}», «${name}»: по голове не погладить — места нажатия нет`);
          await pause(700);
          const glad = await shownNow();
          if (!glad.grin.some(value => value > 0.5)) fail(`вечер, «${key}», «${name}»: её погладили, а улыбки не видно — ${JSON.stringify(glad.grin)}`);
          if (!glad.used.includes(`#r-her-${name}`)) fail(`вечер, «${key}», «${name}»: её погладили — а поза сменилась: ${JSON.stringify(glad.used)}`);
          await pause(1800);
          const calm = await shownNow();
          if (calm.grin.some(value => value > 0.02)) fail(`вечер, «${key}», «${name}»: улыбка не сошла после поглаживания — ${JSON.stringify(calm.grin)}`);
          eveningGrins += 1;
        }
        // Взгляд в сторону (0.51.0): заплатка на глаза есть ровно у тех поз, где она нарисована; в покое скрыта; на
        // рисунке слово «смотрит вправо» (его ставит жест) — видна; слово сняли — снова скрыта.
        const side = plan.gazes[index];
        if (Boolean(side) !== Boolean(dusk.gaze.length)) fail(`вечер, «${key}», «${name}»: заплаток «взгляд в сторону» — ${dusk.gaze.length}, а быть ей ${side ? "положено" : "не положено"}`);
        if (dusk.gaze.some(value => value > 0.02)) fail(`вечер, «${key}», «${name}»: взгляд в сторону виден в покое — ${JSON.stringify(dusk.gaze)}`);
        if (side) {
          await tab.evaluate((word) => document.getElementById("inside").classList.add(word), `look-${side}`);
          await pause(500);
          const aside = await shownNow();
          if (!aside.gaze.some(value => value > 0.5)) fail(`вечер, «${key}», «${name}»: она смотрит в сторону, а глаза прежние — ${JSON.stringify(aside.gaze)}`);
          await tab.evaluate((word) => document.getElementById("inside").classList.remove(word), `look-${side}`);
          await pause(450);
          const back = await shownNow();
          if (back.gaze.some(value => value > 0.02)) fail(`вечер, «${key}», «${name}»: взгляд в сторону не сошёл — ${JSON.stringify(back.gaze)}`);
          eveningGazes += 1;
        }
        eveningPoses += 1;
        eveningLids += lids ? 1 : 0;
      }
      if (plan.list.length === 1) {
        await tapHer();
        await pause(400);
        const same = await shownNow();
        if (worn(same).join() !== `#r-her-${plan.list[0]}` || same.leave) fail(`вечер, «${key}»: поза одна, а после нажатия на рисунке ${JSON.stringify(same.used)}, тающих — ${same.leave}`);
      }
    }

    // Звук: по умолчанию тихо; включается нажатием; запоминается; без нажатия не начинается.
    await tab.goto(day, { waitUntil: "load", timeout: 30_000 });
    await tab.reload({ waitUntil: "load" });
    await pause(800);
    const soundNow = () => tab.evaluate(() => { const button = document.getElementById("sound"); return { shown: Boolean(button) && getComputedStyle(button).display !== "none" && button.getBoundingClientRect().height > 0, on: button?.getAttribute("aria-pressed") === "true", kept: localStorage.getItem("ai-room-sound"), loaded: performance.getEntriesByType("resource").some(entry => /\/sound\.js$/u.test(entry.name)) }; });
    const quiet = await soundNow();
    if (!quiet.shown) fail("выключателя звука на странице не видно");
    if (quiet.on || quiet.loaded) fail(`звук включён без спроса: нажат — ${quiet.on}, модуль загружен — ${quiet.loaded}`);
    await tab.tap("#sound");
    await pause(900);
    const loud = await soundNow();
    if (!loud.on || loud.kept !== "1" || !loud.loaded) fail(`звук не включился: нажат — ${loud.on}, запомнен — «${loud.kept}», модуль загружен — ${loud.loaded}`);
    // Её голос (0.64.0): звук включили — она здоровается вслух записанной репликой (модуль из папки `voice/`).
    let spoke = { name: "", loaded: 0 };
    for (let spent = 0; spent < 4000; spent += 200) {
      spoke = await tab.evaluate(() => ({ name: document.documentElement.dataset.voice ?? "", loaded: performance.getEntriesByType("resource").filter(entry => /\/voice\/[a-z]+\.js$/u.test(entry.name)).length }));
      if (spoke.name) break;
      await pause(200);
    }
    if (!["morning", "day", "evening", "night"].includes(spoke.name) || spoke.loaded !== 1) fail(`голос: звук включили, а она не поздоровалась вслух — реплика «${spoke.name}», модулей голоса загружено ${spoke.loaded}`);
    // 0.66.0: сказанное вслух стоит первым в словах под рисунком — голос и текст сходятся.
    await pause(300);
    const heard = await tab.evaluate(() => document.getElementById("say")?.textContent ?? "");
    if (!/^(?:Доброе утро|Добрый день|Добрый вечер|Доброй ночи)\./u.test(heard)) fail(`голос: она поздоровалась вслух, а под рисунком этих слов нет — «${heard.slice(0, 60)}»`);
    // 0.68.0 (идея 215): что под рисунком — то и вслух. Записанные строки из слов под рисунком (до трёх) она
    // произносит сама, после приветствия; последняя сказанная — в `data-said` страницы.
    const lineNames = await tab.evaluate(async () => {
      const { nameOf } = await import("./say/index.js");
      const { linesToSay } = await import("./logic.js");
      const text = (document.getElementById("say")?.textContent ?? "").replace(/^(?:Доброе утро|Добрый день|Добрый вечер|Доброй ночи)\.\s*/u, "");
      return linesToSay(text, nameOf);
    });
    let saidLine = "";
    for (let spent = 0; lineNames.length && spent < 8000 && saidLine !== lineNames.at(-1); spent += 200) { await pause(200); saidLine = await tab.evaluate(() => document.documentElement.dataset.said ?? ""); }
    if (lineNames.length && saidLine !== lineNames.at(-1)) fail(`голос: под рисунком записанных строк — ${lineNames.length} (${lineNames.join(", ")}), а вслух последней прозвучала «${saidLine}»`);
    console.log(`  строки под рисунком: ${lineNames.length ? `записанных — ${lineNames.length}, сказаны вслух (последняя — «${saidLine}»)` : "записанных нет — промолчала"}`);
    // Забота со звуком: мурчание — и ни одной ошибки.
    await tab.tap('#actions button[data-act="pet"]');
    await pause(500);
    // Запомненное «включено» ждёт первого касания страницы: телефон не даст звучать без него.
    await tab.reload({ waitUntil: "load" });
    await pause(800);
    const waiting = await soundNow();
    if (waiting.on || waiting.loaded) fail(`после перезагрузки звук начался без касания: нажат — ${waiting.on}, модуль загружен — ${waiting.loaded}`);
    await tapHer();
    await pause(1100);
    const again = await soundNow();
    if (!again.on) fail("запомненный звук не вернулся с первым касанием страницы");
    await tab.tap("#sound");
    await pause(500);
    const off = await soundNow();
    if (off.on || off.kept !== "0") fail(`звук не выключился: нажат — ${off.on}, запомнен — «${off.kept}»`);
    // Снег вместо дождя (когда в городе человека снег): те же два слоя, в них хлопья, у каждого слоя — одно движение.
    await tab.goto(`${day}&sky=snow&things=all`, { waitUntil: "load", timeout: 30_000 });
    await tab.reload({ waitUntil: "load" });
    await pause(800);
    const snow = await tab.evaluate(() => ({
      sky: document.querySelector(".rainbox")?.dataset.sky ?? "",
      planes: ["rainFar", "rainNear"].map(id => { const plane = document.getElementById(id); return { flakes: plane.querySelectorAll(".snow circle").length, lines: plane.querySelectorAll("path").length, moves: plane.getAnimations().map(animation => animation.animationName) }; }),
      things: ["торт", "свеча", "фонарь"].filter(key => document.querySelector(`#room .zones [data-act="thing:${key}"]`)),
    }));
    if (snow.sky !== "snow") fail(`снег: слой дождя не знает, что идёт снег («${snow.sky}»)`);
    for (const [index, plane] of snow.planes.entries()) {
      if (plane.flakes < 20 || plane.lines) fail(`снег, слой ${index + 1}: хлопьев — ${plane.flakes}, струй дождя — ${plane.lines}`);
      if (plane.moves.length !== 1 || !/^snow-(?:far|near)$/u.test(plane.moves[0])) fail(`снег, слой ${index + 1}: движения — ${JSON.stringify(plane.moves)}, а должно быть одно, снежное`);
    }
    if (snow.things.length !== 3) fail(`праздничные вещи: на рисунке — ${JSON.stringify(snow.things)}, а должны быть торт, свеча и фонарь`);
    if (broken.length) fail(`позы и звук — ошибка на странице: ${broken[0].slice(0, 200)}`);
    if (failures.length === failed) console.log(`  вечером свитер у всех ${evening.length} состояний: поз в нём — ${eveningPoses}, сменяются от нажатия, куртка не показывается; моргает на ${eveningLids}, улыбается от поглаживания — ${eveningGrins}, смотрит в сторону глазами — ${eveningGazes} из них`);
    if (failures.length === failed) console.log(`  позы сменяются от нажатия и сами, прежняя тает; моргает (заплаток — ${start.wink}); звук включается нажатием, запоминается, без касания не начинается; снег — хлопьями в двух слоях; торт, свеча и фонарь на месте`);
    await tab.close();
  }

  // ── 8. своя жизнь, погода, смена часа (0.44.0) ─────────────────────────────
  console.log("8. Своя жизнь, погода, смена часа, сценка на рисунке");
  {
    const tab = await browser.newPage();
    const broken = [];
    const failed = failures.length;
    tab.on("pageerror", (error) => broken.push(String(error)));
    tab.on("console", (message) => { if (message.type() === "error" && !/net::ERR_/u.test(message.text())) broken.push(message.text()); });
    const open = async (hash) => { await tab.goto(`${origin}/index.html#${hash}`, { waitUntil: "load", timeout: 30_000 }); await tab.reload({ waitUntil: "load" }); await pause(700); };
    const now = () => tab.evaluate(() => {
      // Второй кадр позы (`.fr.b`, 0.45.0) и третий (`.fr.c`, поворот головы) — не другая картинка: в счёт идёт
      // первый кадр, виден он сейчас или нет.
      const visible = (node) => { for (let at = node; at && at.id !== "inside"; at = at.parentElement) if (!at.classList?.contains("fr") && Number(getComputedStyle(at).opacity) <= 0.02) return false; return true; };
      const hers = [...document.querySelectorAll("#inside > .art use")].filter(node => !node.closest(".fr.b, .fr.c")).filter(visible).map(node => String(node.getAttribute("href"))).filter(href => /^#r-her-[a-z0-9-]+$/u.test(href) && !/-(?:blink|smile|look[lr])$/u.test(href));
      const strides = [...document.querySelectorAll("#inside .stride")];
      return {
        say: document.getElementById("say").textContent, light: document.getElementById("app").dataset.light, hers: [...new Set(hers)],
        kept: [...document.querySelectorAll("#store image")].map(node => node.id),
        herWalks: strides.filter(node => node.querySelector("use")).length, catWalks: strides.filter(node => node.querySelector(".cat")).length,
        cat: [...document.querySelectorAll("#inside .cat")].filter(visible).map(node => node.getAttribute("class").replace(/^cat\s*/u, "")),
        note: document.querySelectorAll("#inside .changing").length, fading: document.querySelectorAll("#sky .fading, #room .fading").length,
        fx: [...document.querySelectorAll("#inside .fx")].map(node => node.getAttribute("class").replace(/^fx fx-/u, "")),
        alive: document.getAnimations().filter(animation => animation.playState === "running" && animation.effect?.target?.matches?.("#inside .alive")).length,
      };
    });
    const until = async (test, ms = 8000, step = 150) => { for (let spent = 0; spent <= ms; spent += step) { const seen = await now(); if (test(seen)) return seen; await pause(step); } return null; };
    const demo = await tab.evaluate(async () => { const logic = await import("./logic.js"); const day = logic.demoLook(13, { part: "день" }), dusk = logic.demoLook(19, { part: "вечер" }); return { her: day.her.beats, cat: day.cat.beats, wardrobe: dusk.wardrobe, dusk: dusk.her.beats }; }).catch(() => null);
    await open(`part=${encodeURIComponent("день")}`);
    const plan = demo ?? await tab.evaluate(async () => { const logic = await import("./logic.js"); const day = logic.demoLook(13, { part: "день" }), dusk = logic.demoLook(19, { part: "вечер" }); return { her: day.her.beats, cat: day.cat.beats, wardrobe: dusk.wardrobe, dusk: dusk.her.beats }; });

    // Своя жизнь: по очереди она и Байт переходят к следующему занятию; слова под рисунком — о нынешней картинке.
    await open(`part=${encodeURIComponent("день")}&turn=1500&scene=0`);
    const first = await until(seen => seen.kept.includes("r-her-walk") && seen.kept.includes("r-her-play2"), 6000);
    if (!first) fail("своя жизнь: картинки «идёт» и следующей позы не подгрузились заранее");
    if (first && !first.alive) fail("она не дышит: картинка неподвижна");
    const moved = await until(seen => seen.say === plan.her[1].line, 7000, 100);
    if (!moved) fail(`своя жизнь: сама она к следующему занятию не перешла (ждали слова «${plan.her[1].line.slice(0, 40)}…»)`);
    else {
      if (!moved.herWalks) fail("своя жизнь: она сменила место рывком — картинки «идёт» на рисунке нет");
      const settledHer = await until(seen => seen.hers.join() === "#r-her-play2", 6000, 150);
      if (!settledHer) fail(`своя жизнь: дошла — а на рисунке не та поза: ${JSON.stringify((await now()).hers)}`);
    }
    const trot = await until(seen => seen.say === plan.cat[1].line, 7000, 100);
    if (!trot) fail(`своя жизнь: сам Байт на новое место не пошёл (ждали слова «${plan.cat[1].line.slice(0, 40)}…»)`);
    else if (!trot.catWalks) fail("своя жизнь: Байт сменил место рывком — идущего Байта на рисунке нет");

    // Нажали на неё — следующее занятие сразу, и слова о нём.
    await open(`part=${encodeURIComponent("день")}&turn=600000&scene=0`);
    await until(seen => seen.kept.includes("r-her-play2"), 6000);
    const point = await tab.evaluate(() => { const box = document.querySelector('#room .zones [data-act="her"]')?.getBoundingClientRect(); return box ? { x: box.left + box.width / 2, y: box.top + box.height * 0.6 } : null; });
    if (point) await tab.touchscreen.tap(point.x, point.y);
    const tapped = await until(seen => seen.say === plan.her[1].line, 2000, 100);
    if (!tapped) fail(`нажали на неё, а слова не о следующем занятии: «${(await now()).say.slice(0, 60)}»`);

    // Забота: во второй раз Байт «перевернулся на спину» — и на рисунке он на спине.
    await tab.tap('#actions button[data-act="pet"]');
    await pause(500);
    await tab.tap('#actions button[data-act="pet"]');
    // С 0.46.0 Байт идёт шагом (до четырёх с половиной секунд через всю комнату) — ждать его дольше.
    const belly = await until(seen => /на спину/u.test(seen.say) && seen.cat.includes("belly"), 7000, 150);
    if (!belly) { const seen = await now(); fail(`погладили второй раз: слова «${seen.say.slice(0, 50)}», а Байт на рисунке — ${JSON.stringify(seen.cat)}`); }

    // Сценка дня видна на рисунке и уходит с него после выбора; Байт — там, где сказано.
    await open(`part=${encodeURIComponent("день")}&turn=600000`);
    const staged = await now();
    if (!staged.fx.includes("sock")) fail(`сценка «носок»: носка на рисунке нет (${JSON.stringify(staged.fx)})`);
    await tab.tap('#sceneChoice button[data-pick="0"]');
    const played = await until(seen => !seen.fx.includes("sock") && seen.cat.includes("curl"), 8000, 150);
    if (!played) { const seen = await now(); fail(`сценка сыграна («унёс носок в коробку»), а на рисунке: носок — ${seen.fx.includes("sock")}, Байт — ${JSON.stringify(seen.cat)}`); }

    // Погода: семь видов неба. Дождь и гроза — струи, снег — хлопья, в сухую погоду слои пусты; гроза сверкает.
    const skies = [];
    for (const sky of ["clear", "clouds", "overcast", "fog", "rain", "storm", "snow"]) {
      await open(`part=${encodeURIComponent(sky === "clear" ? "ночь" : "день")}&sky=${sky}&turn=600000&scene=0`);
      // Пока сердце не ответило, за окном серо и сухо; ответило — небо перетекает, дождь проступает через секунду.
      for (let spent = 0; spent < 3000; spent += 150) { if (await tab.evaluate(() => document.querySelector(".rainbox")?.dataset.sky ?? "") === sky) break; await pause(150); }
      const seen = await tab.evaluate(() => ({
        sky: document.querySelector(".rainbox")?.dataset.sky ?? "", label: document.getElementById("room").getAttribute("aria-label"),
        lines: document.querySelectorAll(".rainbox path").length, flakes: document.querySelectorAll(".rainbox .snow circle").length,
        flash: document.querySelectorAll("#sky .flash").length, stars: document.querySelectorAll("#sky .star").length, drift: document.querySelectorAll("#sky .drift").length,
        moving: document.getAnimations().filter(animation => animation.playState === "running" && animation.effect?.target?.closest?.("#sky")).map(animation => animation.animationName),
      }));
      const wet = sky === "rain" || sky === "storm";
      if (seen.sky !== sky) fail(`погода «${sky}»: слой дождя думает, что за окном «${seen.sky}»`);
      if (wet !== seen.lines > 0) fail(`погода «${sky}»: струй дождя — ${seen.lines}`);
      if ((sky === "snow") !== seen.flakes > 0) fail(`погода «${sky}»: хлопьев — ${seen.flakes}`);
      if ((sky === "storm") !== seen.flash > 0 || (sky === "storm" && !seen.moving.includes("flash"))) fail(`погода «${sky}»: молний — ${seen.flash}, движется — ${JSON.stringify(seen.moving)}`);
      if (sky === "clear" && (!seen.stars || !seen.moving.includes("star"))) fail(`ясная ночь: звёзд, которые мерцают, — ${seen.stars}, движется — ${JSON.stringify(seen.moving)}`);
      if (sky === "clouds" && (!seen.drift || !seen.moving.includes("drift"))) fail(`облака: плывущих слоёв — ${seen.drift}, движется — ${JSON.stringify(seen.moving)}`);
      if (/дожд/u.test(seen.label) !== (sky === "rain")) fail(`погода «${sky}»: подпись рисунка — «${seen.label}»`);
      skies.push(sky);
    }
    // Ветер (0.51.0): слово на странице — и по нему облака плывут быстрее, шторы у открытого окна ходят сильнее.
    let winds = 0;
    for (const [wind, word, cloud, curtain] of [["2", "gale", "36s", "gale"], ["1", "windy", "66s", "breeze"], ["", "", "120s", "breeze"]]) {
      await open(`part=${encodeURIComponent("день")}&sky=clouds&open=1&turn=600000&scene=0${wind ? `&wind=${wind}` : ""}`);
      for (let spent = 0; spent < 3000; spent += 150) { if (await tab.evaluate(() => document.querySelectorAll("#sky .drift").length && document.querySelectorAll("#room .breeze").length)) break; await pause(150); }
      const air = await tab.evaluate(() => ({
        words: [...document.body.classList].filter(name => name === "gale" || name === "windy").join(" "),
        cloud: getComputedStyle(document.querySelector("#sky .drift") ?? document.body).animationDuration,
        curtain: getComputedStyle(document.querySelector("#room .breeze") ?? document.body).animationName,
      }));
      if (air.words !== word || air.cloud !== cloud || air.curtain !== curtain) fail(`ветер «${wind || "нет"}»: на странице ${JSON.stringify(air)}`);
      else winds += 1;
    }

    // Смена часа при открытой странице: день → вечер. Она уходит к шкафу, на её месте — «*переодевается*», свет
    // перетекает, и она возвращается в свитере. Сроки названы в адресе: час «кончается» через секунду.
    await open(`part=${encodeURIComponent("день")}&left=800&then=${encodeURIComponent("вечер")}&change=900&turn=600000&scene=0`);
    const story = [];
    for (let spent = 0; spent < 16_000; spent += 120) {
      const seen = await now();
      const last = story[story.length - 1];
      if (!last || last.say !== seen.say || last.light !== seen.light || last.hers.join() !== seen.hers.join() || last.note !== seen.note) story.push(seen);
      if (seen.say.startsWith(plan.wardrobe.back) && seen.hers.length === 1 && seen.hers[0].startsWith("#r-her-home-") && !seen.hers[0].endsWith("-walk")) break;
      await pause(120);
    }
    const told = (test) => story.findIndex(test);
    const left = told(seen => seen.say === plan.wardrobe.leave), away = told(seen => seen.say === "*переодевается*"), back = told(seen => seen.say.startsWith(plan.wardrobe.back));
    const sequence = story.map(seen => `${seen.light}/${seen.hers.map(href => href.slice(7)).join("+") || "—"}/«${seen.say.slice(0, 18)}»`).join(" → ");
    if (left < 0 || away < 0 || back < 0 || !(left < away && away < back)) fail(`смена часа: ждали «уходит → *переодевается* → вернулась», а было: ${sequence}`);
    else {
      if (story[left].light !== "day") fail(`смена часа: уходит она ещё при дневном свете, а свет — ${story[left].light}`);
      if (!story.slice(left, away).some(seen => seen.hers.includes("#r-her-walk"))) fail(`смена часа: к шкафу она не идёт — картинки «идёт» не было: ${sequence}`);
      if (story[away].light !== "evening" || !story[away].note || story[away].hers.length) fail(`смена часа: пока она переодевается — свет ${story[away].light}, надписей на её месте — ${story[away].note}, её картинок — ${JSON.stringify(story[away].hers)}`);
      if (story.slice(away).some(seen => seen.hers.some(href => !href.startsWith("#r-her-home-")))) fail(`смена часа: после шкафа показалась куртка: ${sequence}`);
      if (!story.slice(back).some(seen => seen.hers.includes("#r-her-home-walk"))) fail(`смена часа: от шкафа она не идёт — картинки «идёт» в свитере не было: ${sequence}`);
      const end = story[story.length - 1];
      if (!(end.hers.length === 1 && end.hers[0].startsWith("#r-her-home-") && !end.hers[0].endsWith("-walk"))) fail(`смена часа: в конце на рисунке ${JSON.stringify(end.hers)}`);
    }
    // Час сменился без переодевания (утро → день): свет перетекает, прежний слой тает, она остаётся.
    await open(`part=${encodeURIComponent("утро")}&left=800&then=${encodeURIComponent("день")}&turn=600000&scene=0`);
    const noon = await until(seen => seen.light === "day", 9000, 100);
    if (!noon) fail("утро → день: свет при открытой странице не сменился");
    else if (!noon.fading) fail("утро → день: свет сменился рывком — прежний слой не тает");
    else if (noon.note) fail("утро → день: она ушла переодеваться, хотя наряд тот же");
    if (broken.length) fail(`своя жизнь и смена часа — ошибка на странице: ${broken[0].slice(0, 200)}`);
    if (failures.length === failed) console.log(`  она и Байт сами переходят к следующему занятию и доходят шагом, слова — о нынешней картинке; погода: ${skies.length} видов неба, ветер — ${winds} силы из трёх; сценка видна на рисунке; день → вечер: ${sequence}`);
    await tab.close();
  }

  // ── 9. с настоящим сердцем (0.49.0): повтор запроса, «нет связи», журнал, свёрнутая страница, альбом, встреча ──
  // Страница открыта «из Telegram»: вместо платформы — подставка, которая зовёт настоящее сердце на стабе базы
  // (`tests/fixtures/kit.mjs`). Ответ можно «потерять» по дороге: сердце действие выполнило, страница ответа не
  // получила — так и бывает на плохой связи.
  console.log("9. С сердцем: встреча, альбом, подарок, снимок, повтор запроса, журнал, свёрнутая страница, жесты");
  {
    // Что услышит программа чтения с экрана (дерево доступности) — одной строкой в итог шага.
    let access = "";
    const failed = failures.length;
    const kit = await import(pathToFileURL(join(root, "tests/fixtures/kit.mjs")).href);
    kit.reset();
    let clockAt = Date.parse("2026-11-13T09:00:00Z");
    const heart = kit.heart({ PHRASES: true }, { now: () => clockAt, random: () => 0 });
    const ctx = { ...kit.KEY, initData: { user: { id: 5, first_name: "Тест" } } };
    await heart.onRoom({ do: "look" }, ctx);
    // Четыре дня спустя: 14-го у неё был перерыв, 15-го она нашла книгу — об этом сценка встречи.
    clockAt = Date.parse("2026-11-17T09:00:00Z");
    const tab = await browser.newPage();
    const broken = [], calls = [];
    let drop = 0, shotBytes = 0;
    tab.on("pageerror", (error) => broken.push(String(error)));
    tab.on("console", (message) => { if (message.type() === "error" && !/net::ERR_/u.test(message.text())) broken.push(message.text()); });
    await tab.exposeFunction("heartCall", async (input) => { calls.push(input); const reply = await heart.onRoom(input, ctx); clockAt += 400; if (drop > 0) { drop -= 1; return { lost: true }; } return { reply }; });
    await tab.evaluateOnNewDocument(() => {
      globalThis.Telegram = { WebApp: { initData: "query_id=AAH&user=%7B%22id%22%3A5%7D&hash=0123456789abcdef0123456789abcdef", ready() {}, expand() {},
        Serverless: { call(name, input, done) { globalThis.heartCall(input).then(({ reply, lost }) => (lost ? done({ type: "NETWORK_ERROR", message: "связь оборвалась" }) : done(null, reply))); } } } };
    });
    await tab.goto(`${origin}/index.html#resend=80&retry=400&turn=600000`, { waitUntil: "load", timeout: 30_000 });
    const page9 = () => tab.evaluate(() => ({
      state: document.getElementById("app").dataset.state, down: document.getElementById("app").dataset.down, say: document.getElementById("say").textContent, tone: document.getElementById("talk").dataset.tone,
      foot: document.getElementById("foot").textContent, retry: !document.getElementById("retry").hidden, story: !document.getElementById("story").hidden, storyButton: document.getElementById("storyNext").textContent,
      album: !document.getElementById("album").hidden, box: !document.getElementById("albumBox").hidden, rows: [...document.querySelectorAll("#albumBox .album li .what")].map(node => node.textContent),
      gifts: [...document.querySelectorAll("#albumBox [data-gift]")].length, notes: [...document.querySelectorAll("#albumBox .albumNote")].map(node => node.textContent),
      thumbs: [...document.querySelectorAll("#albumBox img")].map(node => [String(node.src).slice(0, 26), node.naturalWidth]),
      hers: [...new Set([...document.querySelectorAll("#inside > .art use")].map(node => String(node.getAttribute("href"))).filter(href => /^#r-her-[a-z0-9-]+$/u.test(href) && !/-(?:blink|smile|look[lr])$/u.test(href)))],
      flower: document.getElementById("inside").innerHTML.includes('cx="23" cy="143.4"'), art: document.querySelectorAll("#room .art *").length,
      resting: document.documentElement.classList.contains("resting"), running: document.getAnimations().filter(animation => animation.playState === "running" && animation.effect?.target?.closest?.("#room")).length,
      oops: document.getElementById("oops").hidden ? null : document.getElementById("oops").textContent, head: document.querySelectorAll("#inside .hd").length, words: document.getElementById("inside").getAttribute("class") ?? "",
    }));
    const wait9 = async (test, ms = 8000, step = 120) => { for (let spent = 0; spent <= ms; spent += step) { const seen = await page9(); if (test(seen)) return seen; await pause(step); } return null; };
    const opened = await wait9(seen => seen.state === "ready" && seen.hers.length > 0, 12_000);
    if (!opened) fail(`с сердцем: комната не открылась: ${JSON.stringify(await page9()).slice(0, 300)}`);
    else {
      if (/витрина/u.test(opened.foot) || !/сердце \d/u.test(opened.foot)) fail(`с сердцем: внизу должно стоять «сердце N», без «витрины»: «${opened.foot}»`);
      if (!opened.head) fail("слоя головы на рисунке нет");
      // Встреча после четырёх дней: под словами — кнопка сценки; шаги ведёт человек.
      if (!opened.story || !/без меня/u.test(opened.storyButton)) fail(`встреча: кнопки сценки нет («${opened.storyButton}»), её слова: «${opened.say.slice(0, 80)}»`);
      else {
        await tab.click("#storyNext");
        const one = await wait9(seen => /Пока вас не было/u.test(seen.say) && seen.hers.some(href => /tea3$/u.test(href)), 9000);
        if (!one) fail(`встреча, шаг 1: ждали рассказ и её в кресле с кружкой; слова «${(await page9()).say.slice(0, 70)}», картинки ${JSON.stringify((await page9()).hers)}`);
        await tab.click("#storyNext");
        const two = await wait9(seen => /позавчера/u.test(seen.say) && seen.hers.some(href => /read$/u.test(href)), 9000);
        if (!two) fail(`встреча, шаг 2: ждали рассказ о книге и её с книгой; слова «${(await page9()).say.slice(0, 70)}», картинки ${JSON.stringify((await page9()).hers)}`);
        await tab.click("#storyNext");
        await pause(300);
        await tab.click("#storyNext");
        const done = await wait9(seen => !seen.story, 6000);
        if (!done) fail("встреча: после последнего шага кнопка сценки не ушла");
      }
      // Альбом: записи от сердца; подарок — цветок встаёт на шкаф; снимок — картинкой.
      if (!opened.album) fail("кнопки «Альбом» нет");
      else {
        await tab.click("#album");
        const shown = await wait9(seen => seen.box && seen.rows.length >= 3, 8000);
        if (!shown) fail(`альбом не открылся или пуст: ${JSON.stringify((await page9()).rows)}`);
        else if (!shown.rows.some(text => /Нашла интересную книгу/u.test(text)) || !shown.rows.some(text => /Первый раз у меня в комнате/u.test(text))) fail(`альбом: нет рассказанного события или первого захода: ${JSON.stringify(shown.rows)}`);
        if (shown && shown.gifts !== 3) fail(`альбом: кнопок подарка ${shown?.gifts}, а не три`);
        await tab.click('#albumBox [data-gift="flower"]');
        const given = await wait9(seen => seen.flower && seen.notes.some(text => /через 7 дней/u.test(text)), 8000);
        if (!given) fail(`подарок: цветка на шкафу нет или срок не назван; её слова «${(await page9()).say.slice(0, 70)}», заметки ${JSON.stringify((await page9()).notes)}`);
        await tab.click("#albumBox [data-snap]");
        const kept = await wait9(seen => seen.thumbs.some(([src, width]) => src.startsWith("data:image/svg+xml") && width > 0), 10_000);
        if (!kept) fail(`снимок: картинка снимка в альбоме не нарисовалась: ${JSON.stringify((await page9()).thumbs)}`);
        // Снимок в чат (0.62.0, идея 165): страница рисует комнату картинкой JPEG, сердце шлёт её человеку в личку.
        await tab.click("#albumBox [data-post]");
        let posted = null;
        for (let spent = 0; spent < 12_000 && !posted; spent += 150) { posted = kit.calls("sendPhoto").at(-1) ?? null; if (!posted) await pause(150); }
        const jpeg = posted?.photo?.bytes;
        if (!posted) fail(`снимок в чат: сердце картинку не отправило; её слова «${(await page9()).say.slice(0, 90)}»`);
        else if (!(jpeg instanceof Uint8Array) || jpeg.length < 20_000 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) fail(`снимок в чат: ушла не картинка JPEG или она пуста: байт ${jpeg?.length ?? 0}`);
        else if (Number(posted.chat_id) !== 5 || !/^(?:Комната\.|На память:) \d{1,2} [а-я]+, (?:утро|день|вечер|ночь)\.\n\n\S/u.test(String(posted.caption))) fail(`снимок в чат: не тот чат или подпись: ${posted.chat_id}, «${String(posted.caption).slice(0, 90)}»`);
        else {
          const told = await wait9(seen => /Отправила|Готово: комната/u.test(seen.say), 6000);
          if (!told) fail(`снимок в чат: под рисунком должны быть её слова об этом, а там «${(await page9()).say.slice(0, 90)}»`);
          shotBytes = jpeg.length;
        }
        await tab.click("#albumBox [data-close]");
        if ((await page9()).box) fail("альбом не закрылся");
      }
      // Ответ потерялся по дороге: страница сама повторяет запрос с тем же номером — окно открыто один раз.
      const before = calls.length;
      drop = 1;
      await tab.evaluate(() => document.querySelector('#room .zones [data-act="window"]').dispatchEvent(new Event("click", { bubbles: true })));
      const aired = await wait9(seen => seen.tone !== "warn" && !seen.retry && seen.say.length > 0 && calls.slice(before).filter(call => call.do === "window").length >= 2, 8000);
      const sent = calls.slice(before).filter(call => call.do === "window");
      const record = JSON.parse(kit.sdk().kv.get("heart:room:5"));
      if (!aired || sent.length !== 2 || sent[0].id !== sent[1].id || !/^[a-z0-9]{10}$/u.test(String(sent[0].id))) fail(`повтор: ждали два запроса «окно» с одним номером, пришло ${JSON.stringify(sent)}`);
      if (!(record.open > 0)) fail("повтор: окно закрылось обратно — действие выполнено дважды");
      // Связи нет совсем: комната остаётся на экране, внизу «нет связи», кнопка «ещё раз» повторяет то же действие.
      drop = 9;
      await tab.click('#actions [data-act="feed"]');
      const lostLink = await wait9(seen => seen.tone === "warn" && seen.retry && seen.down === "1", 8000);
      if (!lostLink) fail(`нет связи: ждали слова комнаты, кнопку «ещё раз» и пометку внизу: ${JSON.stringify(await page9()).slice(0, 260)}`);
      else if (lostLink.state !== "ready" || lostLink.art < 200 || !/нет связи/u.test(lostLink.foot)) fail(`нет связи: комната должна остаться на экране: состояние ${lostLink.state}, частей ${lostLink.art}, внизу «${lostLink.foot}»`);
      drop = 0;
      const fedBefore = JSON.parse(kit.sdk().kv.get("heart:room:5")).done.feed;
      await tab.click("#retry");
      const mended = await wait9(seen => seen.tone !== "warn" && !seen.retry && seen.down !== "1", 8000);
      if (!mended) fail("нет связи: «ещё раз» не помогло, хотя связь вернулась");
      if (JSON.parse(kit.sdk().kv.get("heart:room:5")).done.feed !== fedBefore) fail("«ещё раз» покормило Байта второй раз: тот же номер действия должен был это остановить");
      // Журнал ошибок: по нажатию на строку «страница N»; без подписи Telegram.
      await tab.click("#foot");
      const journal = (await page9()).oops;
      if (!journal || !/window · NETWORK_ERROR/u.test(journal) || !/feed · NETWORK_ERROR/u.test(journal)) fail(`журнал ошибок: нет записей о потерянных ответах: ${String(journal).slice(0, 240)}`);
      if (journal && /query_id|hash=|0123456789abcdef|%7B/u.test(journal)) fail("журнал ошибок: в нём подпись Telegram");
      await tab.click("#foot");
      // Отчёт ушёл сердцу один раз — и без того, кто зашёл.
      await pause(400);
      const reports = calls.filter(call => call.do === "oops");
      if (reports.length !== 1 || JSON.stringify(reports[0]).includes("query_id")) fail(`отчёт об ошибках: ждали один, без подписи; пришло ${reports.length}`);
      // Страница свёрнута: движение на рисунке стоит; вернулись — идёт.
      await tab.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
      await pause(300);
      const asleep = await page9();
      if (!asleep.resting || asleep.running) fail(`свёрнутая страница: движение не остановлено (слово «resting»: ${asleep.resting}, идёт анимаций: ${asleep.running})`);
      const quietCalls = calls.length;
      await pause(1500);
      if (calls.length !== quietCalls) fail("свёрнутая страница спрашивает сердце");
      await tab.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
      const awake = await wait9(seen => !seen.resting && seen.running > 0, 4000);
      if (!awake) fail("страница вернулась, а движение не пошло");
      // Доступность: у каждой зоны — роль, подпись и место в обходе с клавиатуры; Enter на зоне — то же, что нажатие.
      const zones = await tab.evaluate(() => [...document.querySelectorAll("#room .zones [data-act]")].map(node => [node.dataset.act, node.getAttribute("role"), node.getAttribute("tabindex"), (node.getAttribute("aria-label") ?? "").length]));
      const dumb = zones.filter(([, role, index, label]) => role !== "button" || index !== "0" || label < 2);
      if (!zones.length || dumb.length) fail(`доступность: у зон нет роли, подписи или обхода: ${JSON.stringify(dumb.slice(0, 4))}`);
      await tab.evaluate(() => document.querySelector('#room .zones [data-act="box"]').focus());
      await tab.keyboard.press("Enter");
      const typed = await wait9(seen => /коробк|Байт/iu.test(seen.say), 4000);
      if (!typed) fail(`доступность: Enter на зоне «коробка» ничего не сказал: «${(await page9()).say.slice(0, 60)}»`);
      // Дерево доступности (0.53.0, идея 195) — то, что получает программа чтения с экрана: каждая зона рисунка в нём —
      // кнопка со своей подписью; картинок без подписи и знаков рисунка («!», «?», «z») в нём нет.
      const labels = await tab.evaluate(() => [...document.querySelectorAll("#room .zones [data-act]")].map(node => node.getAttribute("aria-label") ?? ""));
      const tree = await tab.accessibility.snapshot({ interestingOnly: true }).catch(() => null);
      const heard = { buttons: [], texts: [], images: 0 };
      const hear = (node) => {
        if (node.role === "button" && node.name) heard.buttons.push(String(node.name));
        if (node.role === "StaticText") heard.texts.push(String(node.name ?? ""));
        if (/^(?:image|img|graphics-symbol|graphics-object)$/u.test(String(node.role))) heard.images += 1;
        for (const child of node.children ?? []) hear(child);
      };
      if (tree) hear(tree);
      const unheard = labels.filter(label => !heard.buttons.includes(label)), signs = heard.texts.filter(text => /^[!?zZ♪♫\s]{1,3}$/u.test(text));
      if (!tree) fail("доступность: браузер не отдал дерево доступности");
      else if (unheard.length) fail(`доступность: зоны рисунка, которых программа чтения не назовёт: ${JSON.stringify(unheard.slice(0, 5))}`);
      else if (heard.images) fail(`доступность: в дереве ${heard.images} картинок без подписи — программа чтения скажет «картинка» и ничего больше`);
      else if (signs.length) fail(`доступность: знаки рисунка читаются вслух: ${JSON.stringify(signs.slice(0, 5))}`);
      else access = `дерево доступности: кнопок с подписью ${heard.buttons.length}, зоны рисунка названы все (${labels.length}), картинок без подписи и знаков рисунка нет`;
    }
    await tab.close();
    // Жесты: раз в ход своей жизни — слово жеста на рисунке (сердце ведёт её день, ход уходит на жест).
    const live = await browser.newPage();
    live.on("pageerror", (error) => broken.push(String(error)));
    await live.exposeFunction("heartCall", async (input) => ({ reply: await heart.onRoom(input, ctx) }));
    await live.evaluateOnNewDocument(() => {
      globalThis.Telegram = { WebApp: { initData: "user=test", ready() {}, expand() {}, Serverless: { call(name, input, done) { globalThis.heartCall(input).then(({ reply }) => done(null, reply)); } } } };
    });
    await live.goto(`${origin}/index.html#turn=700`, { waitUntil: "load", timeout: 30_000 });
    const gestures = new Set();
    for (let spent = 0; spent < 9000 && gestures.size < 2; spent += 100) {
      for (const word of String(await live.evaluate(() => document.getElementById("inside")?.getAttribute("class") ?? "")).split(" ")) if (/^(?:g-[a-z]+|look-[lr]|peek)$/u.test(word)) gestures.add(word);
      await pause(100);
    }
    if (gestures.size < 2) fail(`жесты: за девять секунд при ходе в 0,7 с ждали хотя бы два разных жеста, были: ${JSON.stringify([...gestures])}`);
    await live.close();
    // Слово ей с настоящим сердцем (0.61.0, идея 204, шаг 3): чего нет в словаре — отвечает модель. Модель здесь
    // «думает долго»: первый вызов сердца ждёт её, а странице вместо него отвечает повтор того же номера — так
    // бывает, когда страница не дождалась и спросила снова. Сердце говорит «ещё думаю»; страница ждёт и спрашивает
    // тот же номер ещё раз — и получает ответ. Модель при этом спросили один раз.
    {
      const stub = await import(pathToFileURL(join(root, "tests/fixtures/sdk-stub.mjs")).href);
      let open = () => {};
      const gate = new Promise((resolve) => { open = resolve; });
      const thinker = kit.heart({ PHRASES: true }, { now: () => clockAt, random: () => 0, fetchImpl: async (url, options) => { if (String(url).endsWith("/chat/completions")) await gate; return stub.fetch(url, options); } });
      const asked = kit.chats().length, ids = [];
      let first = null;
      const word = await browser.newPage();
      word.on("pageerror", (error) => broken.push(String(error)));
      await word.exposeFunction("heartCall", async (input) => {
        if (input.do !== "say") return { reply: await thinker.onRoom(input, ctx) };
        ids.push(input.id);
        if (!first) { first = thinker.onRoom(input, ctx); await pause(200); } else { open(); await first; }
        return { reply: await thinker.onRoom(input, ctx) };
      });
      await word.evaluateOnNewDocument(() => {
        globalThis.Telegram = { WebApp: { initData: "user=test", ready() {}, expand() {}, Serverless: { call(name, input, done) { globalThis.heartCall(input).then(({ reply }) => done(null, reply)); } } } };
      });
      await word.goto(`${origin}/index.html#turn=600000`, { waitUntil: "load", timeout: 30_000 });
      const shown = () => word.evaluate(() => ({ state: document.getElementById("app").dataset.state, say: document.getElementById("say").textContent, off: document.getElementById("wordSend").disabled, field: document.getElementById("word").value, hidden: document.getElementById("words").hidden }));
      let ready = null;
      for (let spent = 0; spent < 12_000 && !ready; spent += 150) { const seen = await shown(); if (seen.state === "ready" && !seen.hidden) ready = seen; else await pause(150); }
      if (!ready) fail(`слово с сердцем: комната не открылась или поля для слов нет: ${JSON.stringify(await shown()).slice(0, 200)}`);
      else {
        await word.evaluate(() => { document.getElementById("word").value = "что такое квазар?"; document.getElementById("words").requestSubmit(); });
        let thinking = null, answered = null;
        for (let spent = 0; spent < 10_000 && !answered; spent += 100) {
          const seen = await shown();
          if (/^(?:Думаю|Минутку|Хороший вопрос)/u.test(seen.say) && seen.off) thinking = seen;
          if (seen.say === "ответ из стаба") answered = seen; else await pause(100);
        }
        if (!thinking) fail("слово с сердцем: пока она думает, под рисунком должны стоять её слова об этом, а кнопка «Сказать» — быть погашена");
        if (!answered) fail(`слово с сердцем: ответа модели под рисунком нет: «${(await shown()).say.slice(0, 80)}», вопросов ушло ${ids.length}`);
        else {
          if (answered.field !== "" || answered.off) fail(`слово с сердцем: после ответа поле должно быть пустым, а кнопка — живой: ${JSON.stringify(answered)}`);
          if (ids.length !== 2 || ids[0] !== ids[1] || !ids[0]) fail(`слово с сердцем: страница должна была спросить тот же номер дважды: ${JSON.stringify(ids)}`);
          if (kit.chats().length !== asked + 1) fail(`слово с сердцем: модель спросили ${kit.chats().length - asked} раз(а), а не один`);
        }
      }
      open();
      await word.close();
    }
    if (broken.length) fail(`с сердцем — ошибка на странице: ${broken[0].slice(0, 220)}`);
    if (failures.length === failed) console.log(`  снимок в чат: картинка JPEG ушла в личку с подписью, ${Math.round(shotBytes / 1024)} КБ`);
    if (failures.length === failed) console.log(`  слово ей: модель думала дольше страницы — «ещё думаю», тот же номер снова, ответ под рисунком; модель спросили один раз`);
    if (failures.length === failed) console.log(`  встреча по шагам, альбом с подарком и снимком, повтор с тем же номером, «нет связи» и «ещё раз», журнал без подписи, свёрнутая страница стоит, жесты: ${[...gestures].join(", ")}${access ? `; ${access}` : ""}`);
  }

  if (errors.length) for (const text of errors) fail(`ошибка на странице: ${text}`);
} catch (error) {
  fail(`проверка оборвалась: ${error?.stack ?? error}`);
} finally {
  await browser.close().catch(() => {});
  server.close();
}

if (failures.length) { console.log(`\nстраница комнаты: ${failures.length} ${failures.length === 1 ? "замечание" : "замечаний"}`); process.exit(1); }
console.log("\nстраница комнаты: всё нажимается");
