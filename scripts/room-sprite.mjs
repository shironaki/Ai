/* global document, Image */
/**
 * Спрайт Аи для страницы комнаты: из картинки на зелёном фоне — в модуль `miniapp/her/<имя>.js`.
 *
 *   bash scripts/verify.sh sprite <картинка.png> <имя> [высота, точек] [качество 0–1] [ось 0–1 или «-»] [erase=x0,y0,x1,y1 …] [red]
 *
 * Что делает: убирает зелёный фон (и зелёный отсвет по краям), обрезает пустые поля, уменьшает до нужной высоты
 * и сохраняет картинкой WebP с прозрачностью — строкой base64 внутри модуля:
 * `export default { w, h, cx, src: "data:image/webp;base64,…" }` (`cx` — ось тела в долях ширины: по ней спрайт
 * ставится на место; считается сама, шестым словом задаётся руками). Рядом, в `out/`, кладёт снимок для глаз:
 * спрайт на светлом и на тёмном фоне — по нему видно, чисто ли вырезан край.
 *
 * Имя — латиницей, наряд через дефис: `tea`, `tea2`, `home-tea`. `erase=…` — прямоугольник в долях исходной картинки
 * (левый верхний и правый нижний угол), в котором всё светлое считается фоном: так убирается нарисованный пар над
 * кружкой (пар на странице рисует код — он движется), а тёмные волосы рядом остаются.
 *
 * `red` — для картинки с тонкой красной лентой (0.43.0). Тонкую ленту нейросеть рисует смесью красного с зелёным
 * фоном, и смесь выходит оливковой: зелёного в такой точке меньше, чем красного, поэтому обычное правило («зелёный
 * канал не выше остальных») её не видит, и лента в комнате получается то красной, то болотной. Со словом `red`
 * насыщенно-красная точка, в которой зелёного больше, чем положено красному, разбирается обратно: доля фона в ней —
 * (зелёный − синий) / 255, остальное — лента; красный и синий возвращаются к своей яркости, зелёный — к синему.
 * Правило включается словом, а не всегда: у золотого и рыжего (обложка блокнота, чай в кружке) зелёного тоже
 * больше, чем у красного, и их оно перекрасило бы.
 *
 * Почему строкой, а не файлом картинки. Двоичные файлы песочница чата портит между ходами (AGENTS.md, раздел 6),
 * а текст — нет; страница берёт такой модуль отдельным запросом и только тот, что нужен сейчас.
 *
 * Откуда картинка. Её рисует нейросеть по портрету `docs/profile/welcome.jpg` и уже принятому спрайту — на
 * ровном зелёном фоне (#00FF00): в её облике зелёного нет, поэтому фон отделяется чисто.
 *
 * Браузер — тот же, что у `verify.sh page`: зависимостью проекта он не становится, файл запускается из
 * временной папки. Аргументы: <корень репозитория> <картинка> <имя> [высота] [качество].
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { tmpdir } from "node:os";

const [, , root, input, name, heightArg = "900", qualityArg = "0.86", axisArg = "", ...more] = process.argv;
const erase = more.filter(word => word.startsWith("erase=")).map(word => word.slice(6).split(",").map(Number)).filter(box => box.length === 4 && box.every(value => value >= 0 && value <= 1));
const red = more.includes("red");
if (!root || !input || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(name ?? "")) { console.error("Нужно: node room-sprite.mjs <корень репозитория> <картинка.png> <имя латиницей> [высота] [качество]"); process.exit(2); }
const height = Math.max(200, Math.min(1600, Number(heightArg) || 900)), quality = Math.max(0.4, Math.min(1, Number(qualityArg) || 0.86));

let chromium, puppeteer;
try {
  process.env.AWS_EXECUTION_ENV ??= "AWS_Lambda_nodejs22.x";
  ({ default: chromium } = await import("@sparticuz/chromium"));
  ({ default: puppeteer } = await import("puppeteer-core"));
} catch (error) {
  console.error(`Браузера рядом нет (${error.code ?? error.message}). Запускайте так: bash scripts/verify.sh sprite …`);
  process.exit(2);
}

const bytes = await readFile(resolve(input));
const type = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[extname(input).toLowerCase()] ?? "image/png";
const executablePath = await chromium.executablePath();
process.env.LD_LIBRARY_PATH = [join(tmpdir(), "al2023/lib"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
process.env.FONTCONFIG_PATH ??= join(tmpdir(), "fonts");
process.env.HOME = tmpdir();
const browser = await puppeteer.launch({ args: [...chromium.args, "--no-sandbox", "--disable-gpu"], executablePath, headless: "shell", defaultViewport: { width: 1200, height: 900, deviceScaleFactor: 1 } });
try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><meta charset=\"utf-8\"><body style=\"margin:0\"></body>");
  const made = await page.evaluate(async (source, wanted, q, boxes, ribbon) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const full = document.createElement("canvas");
    full.width = image.naturalWidth; full.height = image.naturalHeight;
    const ctx = full.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, full.width, full.height), px = data.data;
    // Зелёный фон: чем сильнее зелёный канал выше остальных, тем прозрачнее точка. Край (смесь фона с линией)
    // выходит полупрозрачным, а его зелёный отсвет гасится: зелёный канал не выше остальных.
    const LOW = 24, HIGH = 96;
    let left = full.width, top = full.height, right = -1, bottom = -1, green = 0, fixed = 0;
    const wiped = boxes.map(([x0, y0, x1, y1]) => [x0 * full.width, y0 * full.height, x1 * full.width, y1 * full.height]);
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2], over = g - Math.max(r, b);
      let alpha = over <= LOW ? 1 : over >= HIGH ? 0 : 1 - (over - LOW) / (HIGH - LOW);
      // Нарисованный пар: в названном прямоугольнике всё светлое — фон.
      if (alpha > 0 && wiped.length && (r + g + b) / 3 > 100) { const x = (i / 4) % full.width, y = Math.floor(i / 4 / full.width); if (wiped.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) alpha = 0; }
      if (over > 0) px[i + 1] = Math.max(r, b);
      // Красная лента на зелёном (слово `red`): точка — смесь ленты с фоном. Насколько она красная, видно по
      // отношению красного к синему (фон его не меняет); сколько в ней фона — по зелёному сверх синего.
      let mended = 0;
      if (ribbon && alpha > 0) {
        const warm = r / Math.max(b, 1), spill = px[i + 1] - (r + b) / 2;
        if (warm > 1.6 && spill > 4) {
          const t = Math.min(1, (warm - 1.6) / 1.2), share = Math.min(0.75, Math.max(0, (g - b) / 255)), back = 1 / (1 - share);
          const pure = [Math.min(255, r * back), Math.min(255, b * back), Math.min(255, b * back)];
          px[i] = r + (pure[0] - r) * t; px[i + 1] = px[i + 1] + (pure[1] - px[i + 1]) * t; px[i + 2] = b + (pure[2] - b) * t;
          mended = 1;
        }
      }
      // Полупрозрачный край темнится к линии: светлая кайма на тёмных волосах заметнее, чем тёмная.
      if (alpha > 0 && alpha < 1) { const k = 0.55 + 0.45 * alpha; px[i] = px[i] * k; px[i + 1] = px[i + 1] * k; px[i + 2] = px[i + 2] * k; }
      fixed += mended;
      px[i + 3] = Math.round(px[i + 3] * alpha);
      if (alpha === 0) green += 1;
      if (px[i + 3] > 10) { const x = (i / 4) % full.width, y = Math.floor(i / 4 / full.width); if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y; }
    }
    if (right < 0) return { error: "после удаления фона ничего не осталось" };
    ctx.putImageData(data, 0, 0);
    const cw = right - left + 1, ch = bottom - top + 1, k = Math.min(1, wanted / ch);
    const out = document.createElement("canvas");
    out.width = Math.round(cw * k); out.height = Math.round(ch * k);
    const octx = out.getContext("2d");
    octx.imageSmoothingQuality = "high";
    octx.drawImage(full, left, top, cw, ch, 0, 0, out.width, out.height);
    // Ось тела — доля ширины, по которой спрайт ставится на место: середина между головой (верхняя восьмая часть)
    // и ногами (нижняя треть). Поднятая рука с ленточкой или плед на одном плече её не сдвигают.
    const small = octx.getImageData(0, 0, out.width, out.height).data;
    const middle = (from, to) => {
      let sum = 0, count = 0;
      for (let y = Math.floor(out.height * from); y < Math.floor(out.height * to); y += 1) for (let x = 0; x < out.width; x += 1) if (small[(y * out.width + x) * 4 + 3] > 128) { sum += x; count += 1; }
      return count ? sum / count / out.width : 0.5;
    };
    const cx = Math.round((middle(0, 0.125) + middle(0.67, 1)) / 2 * 1000) / 1000;
    const src = out.toDataURL("image/webp", q);
    if (!src.startsWith("data:image/webp")) return { error: "браузер не умеет сохранять WebP" };
    // Снимок для глаз: на светлом и на тёмном.
    const show = document.createElement("canvas");
    show.width = out.width * 2 + 60; show.height = out.height + 40;
    const sctx = show.getContext("2d");
    sctx.fillStyle = "#efe4d6"; sctx.fillRect(0, 0, show.width / 2, show.height);
    sctx.fillStyle = "#2a2440"; sctx.fillRect(show.width / 2, 0, show.width / 2, show.height);
    sctx.drawImage(out, 20, 20); sctx.drawImage(out, out.width + 40, 20);
    return { src, cx, w: out.width, h: out.height, from: [full.width, full.height], box: [left, top, cw, ch], share: green / (px.length / 4), fixed, preview: show.toDataURL("image/png") };
  }, `data:${type};base64,${bytes.toString("base64")}`, height, quality, erase, red);
  if (made.error) { console.error(`спрайт «${name}»: ${made.error}`); process.exit(1); }
  const folder = join(resolve(root), "miniapp", "her");
  await mkdir(folder, { recursive: true });
  const axis = Number(axisArg) > 0 && Number(axisArg) < 1 ? Number(axisArg) : made.cx;
  const text = `// Спрайт Аи «${name}»: собран командой «bash scripts/verify.sh sprite …» (scripts/room-sprite.mjs). Руками не править.\nexport default { w: ${made.w}, h: ${made.h}, cx: ${axis}, src: "${made.src}" };\n`;
  await writeFile(join(folder, `${name}.js`), text);
  await mkdir(join(resolve(root), "out"), { recursive: true });
  await writeFile(join(resolve(root), "out", `sprite-${name}.png`), Buffer.from(made.preview.split(",")[1], "base64"));
  console.log(`спрайт «${name}»: ${made.from.join("×")} (фигура в рамке ${made.box.join(" ")}) → ${made.w}×${made.h}, ось ${axis}, фон — ${Math.round(made.share * 100)} % картинки, модуль ${Math.round(Buffer.byteLength(text) / 1024)} КБ${red ? `, красных точек возвращено — ${made.fixed}` : ""} → miniapp/her/${name}.js; снимок — out/sprite-${name}.png`);
} finally {
  await browser.close().catch(() => {});
}
