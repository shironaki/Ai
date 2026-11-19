/* global document, Image */
/**
 * Спрайт Аи для страницы комнаты: из картинки на зелёном фоне — в модуль `miniapp/her/<имя>.js`.
 *
 *   bash scripts/verify.sh sprite <картинка.png> <имя> [высота, точек] [качество 0–1] [ось 0–1]
 *
 * Что делает: убирает зелёный фон (и зелёный отсвет по краям), обрезает пустые поля, уменьшает до нужной высоты
 * и сохраняет картинкой WebP с прозрачностью — строкой base64 внутри модуля:
 * `export default { w, h, cx, src: "data:image/webp;base64,…" }` (`cx` — ось тела в долях ширины: по ней спрайт
 * ставится на место; считается сама, шестым словом задаётся руками). Рядом, в `out/`, кладёт снимок для глаз:
 * спрайт на светлом и на тёмном фоне — по нему видно, чисто ли вырезан край.
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

const [, , root, input, name, heightArg = "900", qualityArg = "0.86", axisArg = ""] = process.argv;
if (!root || !input || !/^[a-z][a-z0-9]*$/u.test(name ?? "")) { console.error("Нужно: node room-sprite.mjs <корень репозитория> <картинка.png> <имя латиницей> [высота] [качество]"); process.exit(2); }
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
  const made = await page.evaluate(async (source, wanted, q) => {
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
    let left = full.width, top = full.height, right = -1, bottom = -1, green = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2], over = g - Math.max(r, b);
      let alpha = over <= LOW ? 1 : over >= HIGH ? 0 : 1 - (over - LOW) / (HIGH - LOW);
      if (over > 0) px[i + 1] = Math.max(r, b);
      // Полупрозрачный край темнится к линии: светлая кайма на тёмных волосах заметнее, чем тёмная.
      if (alpha > 0 && alpha < 1) { const k = 0.55 + 0.45 * alpha; px[i] = r * k; px[i + 1] = px[i + 1] * k; px[i + 2] = b * k; }
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
    return { src, cx, w: out.width, h: out.height, from: [full.width, full.height], box: [left, top, cw, ch], share: green / (px.length / 4), preview: show.toDataURL("image/png") };
  }, `data:${type};base64,${bytes.toString("base64")}`, height, quality);
  if (made.error) { console.error(`спрайт «${name}»: ${made.error}`); process.exit(1); }
  const folder = join(resolve(root), "miniapp", "her");
  await mkdir(folder, { recursive: true });
  const axis = Number(axisArg) > 0 && Number(axisArg) < 1 ? Number(axisArg) : made.cx;
  const text = `// Спрайт Аи «${name}»: собран командой «bash scripts/verify.sh sprite …» (scripts/room-sprite.mjs). Руками не править.\nexport default { w: ${made.w}, h: ${made.h}, cx: ${axis}, src: "${made.src}" };\n`;
  await writeFile(join(folder, `${name}.js`), text);
  await mkdir(join(resolve(root), "out"), { recursive: true });
  await writeFile(join(resolve(root), "out", `sprite-${name}.png`), Buffer.from(made.preview.split(",")[1], "base64"));
  console.log(`спрайт «${name}»: ${made.from.join("×")} → ${made.w}×${made.h}, ось ${axis}, фон — ${Math.round(made.share * 100)} % картинки, модуль ${Math.round(Buffer.byteLength(text) / 1024)} КБ → miniapp/her/${name}.js; снимок — out/sprite-${name}.png`);
} finally {
  await browser.close().catch(() => {});
}
