/* global document, Image */
/**
 * Картинки рядом и наложением — посмотреть глазами и числом (0.46.0).
 *
 *   bash scripts/verify.sh contact <лист.png> <высота> <картинка.png>…
 *       сырые картинки в ряд: что вернула нейросеть (рядом с образцом);
 *   bash scripts/verify.sh pairs <лист.png> <поза>:<кадр>[:<рост кадра>] …
 *       второй кадр позы поверх самой позы — так, как их положит страница (`HER_FRAMES`, `spritePlace`): слева
 *       поза, посередине кадр, справа наложение (поза — красным, кадр — голубым, общее — белым). Числом — на
 *       сколько точек рисунка кадр надо сдвинуть, чтобы совпали голова и ступни: «голова 0, 0 · ступни 0, 0» —
 *       кадр лежит точка в точку. Сдвиг головы по горизонтали лечится осью (шестое слово `verify.sh sprite`),
 *       сдвиг по вертикали — ростом кадра (четвёртое слово в `HER_FRAMES`).
 *
 * Зачем. Кадр, который «прыгает» относительно позы на несколько точек, на странице виден как дрожание. В 0.45.0
 * это ловилось временным сценарием в `/tmp`, и к следующему ходу его уже не было. Браузер — тот же, что у
 * `verify.sh page`: файл запускается из временной папки.
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const [, , root, mode, out, ...rest] = process.argv;
if (!root || !out || (mode !== "contact" && mode !== "pairs") || !rest.length) { console.error("Нужно: node room-pairs.mjs <корень> contact <лист.png> <высота> <png>… | pairs <лист.png> <поза>:<кадр>[:<рост>] …"); process.exit(2); }

let chromium, puppeteer;
try {
  process.env.AWS_EXECUTION_ENV ??= "AWS_Lambda_nodejs22.x";
  ({ default: chromium } = await import("@sparticuz/chromium"));
  ({ default: puppeteer } = await import("puppeteer-core"));
} catch (error) {
  console.error(`Браузера рядом нет (${error.code ?? error.message}). Запускайте так: bash scripts/verify.sh ${mode} …`);
  process.exit(2);
}
const executablePath = await chromium.executablePath();
process.env.LD_LIBRARY_PATH = [join(tmpdir(), "al2023/lib"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
process.env.FONTCONFIG_PATH ??= join(tmpdir(), "fonts");
process.env.HOME = tmpdir();
const browser = await puppeteer.launch({ args: [...chromium.args, "--no-sandbox", "--disable-gpu"], executablePath, headless: "shell", defaultViewport: { width: 1600, height: 800 } });
const style = "body{margin:0;background:#1b1b22;font:12px system-ui,sans-serif;color:#ddd}main{display:flex;flex-wrap:wrap;align-items:flex-start;gap:6px;padding:6px;width:max-content;max-width:2400px}figure{margin:0}figcaption{padding:2px 0 0;height:14px}img,canvas{display:block}";
const shoot = async (page) => {
  const size = await page.evaluate(() => { const box = document.querySelector("main").getBoundingClientRect(); return { width: Math.ceil(box.width), height: Math.ceil(box.height) }; });
  await page.setViewport({ ...size, deviceScaleFactor: 1 });
  await page.screenshot({ path: out });
  return size;
};
try {
  const page = await browser.newPage();
  if (mode === "contact") {
    const [height, ...files] = rest;
    const cells = [];
    for (const file of files) cells.push(`<figure><img height="${Number(height) || 400}" src="data:image/png;base64,${(await readFile(resolve(file))).toString("base64")}"><figcaption>${file.split("/").pop()}</figcaption></figure>`);
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${style}</style><main>${cells.join("")}</main>`, { waitUntil: "load" });
    const size = await shoot(page);
    console.log(`картинок ${files.length}, ${size.width}×${size.height} → ${out}`);
  } else {
    const scene = await import(pathToFileURL(resolve(root, "miniapp/scene.js")).href);
    const module = async (name) => (await import(pathToFileURL(resolve(root, `miniapp/her/${name}.js`)).href)).default;
    const pairs = [];
    for (const word of rest) {
      const [base, frame, grow] = word.split(":");
      if (!Object.hasOwn(scene.HER_SPRITES, base)) { console.error(`Позы «${base}» в HER_SPRITES нет.`); process.exit(2); }
      const tall = scene.HER_SPRITES[base].tall;
      pairs.push({ base, frame, tall, grow: Number(grow) > 0 ? Number(grow) : Number(scene.HER_FRAMES?.[base]?.[3]) > 0 ? Number(scene.HER_FRAMES[base][3]) : 1, a: await module(base), b: await module(frame) });
    }
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${style}</style><main></main>`, { waitUntil: "load" });
    const lines = await page.evaluate(async (list) => {
      const zoom = 2, report = [];
      const load = (src) => new Promise((done, fail) => { const image = new Image(); image.onload = () => done(image); image.onerror = fail; image.src = src; });
      for (const { base, frame, tall, grow, a, b } of list) {
        const [one, two] = await Promise.all([load(a.src), load(b.src)]);
        const W = Math.ceil(Math.max(a.w * tall / a.h, b.w * tall * grow / b.h) * 1.3) + 40, H = Math.ceil(tall * Math.max(1, grow)) + 24, X = W / 2, FEET = H - 12;
        // Так же, как `spritePlace` в miniapp/scene.js: рост позы, ось тела, ступни на одной линии.
        const draw = (image, sprite, height) => {
          const canvas = document.createElement("canvas"); canvas.width = W * zoom; canvas.height = H * zoom;
          const wide = sprite.w * height / sprite.h, axis = sprite.cx > 0.1 && sprite.cx < 0.9 ? sprite.cx : 0.5;
          canvas.getContext("2d").drawImage(image, (X - wide * axis) * zoom, (FEET - height) * zoom, wide * zoom, height * zoom);
          return canvas;
        };
        const ca = draw(one, a, tall), cb = draw(two, b, tall * grow);
        const da = ca.getContext("2d").getImageData(0, 0, ca.width, ca.height), db = cb.getContext("2d").getImageData(0, 0, cb.width, cb.height);
        const w = ca.width, h = ca.height;
        const mask = (data) => { const bits = new Uint8Array(w * h); for (let i = 0; i < bits.length; i += 1) bits[i] = data.data[i * 4 + 3] > 128 ? 1 : 0; return bits; };
        const ma = mask(da), mb = mask(db);
        const rows = (bits) => { let top = h, bottom = 0; for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (bits[y * w + x]) { if (y < top) top = y; if (y > bottom) bottom = y; } return [top, bottom]; };
        const [topA, bottomA] = rows(ma), [topB, bottomB] = rows(mb);
        // Лучший сдвиг кадра в полосе: при каком сдвиге его силуэт ближе всего к силуэту позы.
        const best = (from, to) => {
          const y0 = Math.round(topA + (bottomA - topA) * from), y1 = Math.round(topA + (bottomA - topA) * to);
          let found = { score: -1, dx: 0, dy: 0 }, still = 0;
          for (let dy = -24; dy <= 24; dy += 1) for (let dx = -24; dx <= 24; dx += 1) {
            let both = 0, any = 0;
            for (let y = y0; y <= y1; y += 2) { const yb = y - dy; if (yb < 0 || yb >= h) continue; for (let x = 24; x < w - 24; x += 2) { const p = ma[y * w + x], q = mb[yb * w + x - dx]; both += p & q; any += p | q; } }
            const score = any ? both / any : 0;
            if (dx === 0 && dy === 0) still = score;
            if (score > found.score) found = { score, dx, dy };
          }
          return { dx: found.dx / zoom, dy: found.dy / zoom, score: Math.round(found.score * 100), still: Math.round(still * 100) };
        };
        const head = best(0, 0.2), body = best(0.2, 0.55), feet = best(0.88, 1);
        const over = document.createElement("canvas"); over.width = w; over.height = h;
        const pixels = over.getContext("2d").createImageData(w, h);
        for (let i = 0; i < w * h; i += 1) { pixels.data[i * 4] = ma[i] ? 255 : 0; pixels.data[i * 4 + 1] = mb[i] ? 255 : 0; pixels.data[i * 4 + 2] = mb[i] ? 255 : 0; pixels.data[i * 4 + 3] = ma[i] || mb[i] ? 255 : 40; }
        over.getContext("2d").putImageData(pixels, 0, 0);
        const text = `${base} ← ${frame}${grow === 1 ? "" : ` (рост ×${grow})`}: голова ${head.dx}, ${head.dy} (совпадение ${head.still}% → ${head.score}%) · тело ${body.dx}, ${body.dy} (${body.still}% → ${body.score}%) · ступни ${feet.dx}, ${feet.dy} (${feet.still}% → ${feet.score}%) · верх ${(topB - topA) / zoom}, низ ${(bottomB - bottomA) / zoom}`;
        report.push(text);
        const figure = document.createElement("figure"), row = document.createElement("div"), caption = document.createElement("figcaption");
        row.style.display = "flex"; row.style.gap = "4px"; row.style.background = "#6b7280";
        for (const canvas of [ca, cb, over]) { canvas.style.width = `${W}px`; canvas.style.height = `${H}px`; row.append(canvas); }
        caption.textContent = text; figure.append(row, caption); document.querySelector("main").append(figure);
      }
      return report;
    }, pairs.map(({ base, frame, tall, grow, a, b }) => ({ base, frame, tall, grow, a: { w: a.w, h: a.h, cx: a.cx, src: a.src }, b: { w: b.w, h: b.h, cx: b.cx, src: b.src } })));
    const size = await shoot(page);
    for (const line of lines) console.log(line);
    console.log(`пар ${pairs.length}, ${size.width}×${size.height} → ${out}`);
  }
} finally { await browser.close(); }
