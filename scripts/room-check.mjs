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

const [, , folder, shotArg = "", previous = ""] = process.argv;
const shot = shotArg === "-" ? "" : shotArg;
if (!folder) { console.error("Нужна папка страницы: node room-check.mjs <папка miniapp> [снимок.png|-] [папка прежней страницы]"); process.exit(2); }

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
const server = createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/u, "");
  const name = path === "/" ? "index.html" : path.replace(/^[/\\]+/u, "");
  const file = join(stale.has(name) ? previous : folder, name);
  try {
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
    const kept = [...document.querySelectorAll("#store image")], used = [...document.querySelectorAll("#inside use")].map(node => node.getAttribute("href"));
    return {
      kept: kept.map(node => node.id), sized: kept.every(node => node.namespaceURI === "http://www.w3.org/2000/svg" && node.getBBox().width > 100 && node.getBBox().height > 100),
      used, inline: document.querySelectorAll("#inside image").length, drawn: document.querySelectorAll("#inside .breath").length,
      // Видна ли она на самом деле: у ссылки на картинку есть размер на экране.
      shown: [...document.querySelectorAll("#inside > .art use")].some(node => node.getBoundingClientRect().height > 200),
    };
  });
  const first = await painted();
  if (first.kept.length < 1 || !first.sized) fail(`её картинки нет в кладовой рисунка: ${JSON.stringify(first.kept)}`);
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
  // После всех нажатий её картинка — та же: в кладовой не прибавилось копий, комната по-прежнему ссылается на неё.
  const later = await painted();
  if (new Set(later.kept).size !== later.kept.length || later.kept.length > 2) fail(`картинок в кладовой после нажатий: ${JSON.stringify(later.kept)} — копятся`);
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
  for (const how of ["картинкой", "кодом"]) for (const part of ["день", "ночь"]) for (const full of [false, true]) {
    const chunk = await page.evaluate(async (part, full, looks) => {
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
      for (const [pose, key] of looks ?? scene.HER_POSES.map(item => [item, "дело"])) for (const place of scene.CAT_PLACES) for (const shape of scene.CAT_SHAPES) {
        const label = `${looks ? "картинкой" : "кодом"}/${part}/${full ? "вещи" : "пусто"}/${pose}·${key}/${shape}.${place}`;
        const view = { part, her: { pose, key }, cat: { shape, place, key: "сыт" }, plant: "dry", things, lamp: "#7fd0c8" };
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
          if (act === "her" || act === "pet") note(broken, `${act}: не дотянуться ← ${who}`, label);
          else note(covered, `${act} ← ${who}`, label);
        }
      }
      const list = (map) => [...map.entries()].map(([key, value]) => ({ key, ...value }));
      return { drawings, checks, broken: list(broken), covered: list(covered), free: [...free.entries()], things: [...scene.THINGS] };
    }, part, full, how === "картинкой" ? LOOKS : null);
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
  // кружкой. Сама она с 0.40.0 — картинка и стоит неподвижно; дышит и моргает только нарисованная кодом (шаг 6).
  for (const [cls, least] of [["bulb", 20], ["blink", 1], ["slide", 1], ["steam", 1]]) {
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
  for (const [mode, what] of [[false, "картинки на сервере нет"], ["broken", "картинка пришла, но не читается"]]) {
    pictures = mode;
    const tab = await browser.newPage();
    const broken = [];
    tab.on("pageerror", (error) => broken.push(String(error)));
    // Отказ сервера на сам файл картинки — ожидаемое: его мы и устроили. Всё остальное — ошибка.
    tab.on("console", (message) => { if (message.type() === "error" && !/net::ERR_|404/u.test(message.text())) broken.push(message.text()); });
    await tab.goto(`${origin}/index.html#part=${encodeURIComponent("вечер")}&things=all`, { waitUntil: "load", timeout: 30_000 });
    await pause(900);
    const got = await tab.evaluate(() => ({
      state: document.querySelector("#app")?.dataset.state ?? "", use: document.querySelectorAll("#inside use").length, kept: document.querySelectorAll("#store image").length,
      her: document.querySelectorAll('#inside .zones [data-act="her"]').length, breath: document.querySelectorAll("#inside .breath").length,
      moving: document.getAnimations().filter(animation => animation.playState === "running" && animation.effect?.target?.closest?.("#inside .breath, #inside .blink")).length,
    }));
    let fed = false;
    try {
      await tab.tap('#actions button[data-act="feed"]');
      await pause(350);
      fed = await tab.$eval('#actions button[data-act="feed"]', (node) => node.classList.contains("done"));
    } catch { fed = false; }
    if (got.state !== "ready") fail(`${what}: комната не открылась — состояние «${got.state}»${broken.length ? `, ${broken[0].slice(0, 170)}` : ""}`);
    else if (broken.length) fail(`${what}: ошибка на странице — ${broken[0].slice(0, 170)}`);
    else if (got.use || got.kept) fail(`${what}, а рисунок на неё ссылается (ссылок ${got.use}, в кладовой ${got.kept}): её не видно вовсе`);
    else if (!got.her || !got.breath) fail(`${what}: она не нарисована кодом — мест нажатия ${got.her}, дышащих частей ${got.breath}`);
    else if (!got.moving) fail(`${what}: нарисованная кодом, она не дышит и не моргает`);
    else if (!fed) fail(`${what}: забота не нажимается`);
    else console.log(`  ${what}: комната открылась, она нарисована кодом (дышит и моргает: ${got.moving}), забота нажимается`);
    await tab.close();
  }
  pictures = true;

  if (errors.length) for (const text of errors) fail(`ошибка на странице: ${text}`);
} catch (error) {
  fail(`проверка оборвалась: ${error?.stack ?? error}`);
} finally {
  await browser.close().catch(() => {});
  server.close();
}

if (failures.length) { console.log(`\nстраница комнаты: ${failures.length} ${failures.length === 1 ? "замечание" : "замечаний"}`); process.exit(1); }
console.log("\nстраница комнаты: всё нажимается");
