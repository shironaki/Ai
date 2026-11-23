/* global document, Image */
/**
 * Образец для средства рисования: её картинка из модуля `miniapp/her/<имя>.js` — на ровном зелёном фоне, файлом PNG.
 *
 *   bash scripts/verify.sh ref <имя>[,<имя>…] <куда.png> [высота холста, точек] [closed]
 *
 * Зачем. Исходные картинки между ходами не сохраняются: оригинал — сам модуль (AGENTS.md, раздел 10, «Её
 * картинки»). А нейросети для правки («всё то же, только глаза закрыты», «та же поза, другая одежда») нужна именно
 * картинка, и на том же зелёном фоне, с которого её потом снимет `scripts/room-sprite.mjs`. Несколько имён через
 * запятую — фигуры в ряд, по одной высоте: лист «вот она вся» в образцы для новой позы.
 *
 * `closed` — с закрытыми глазами (поверх картинки кладутся её «веки», если они есть). Так веки переносятся на ту
 * же позу в другом наряде без новой картинки: `ref work out/work-closed.png 1024 closed`, затем
 * `blink out/work-closed.png home-work by=head at=<середина глаз>` — лицо у обеих одно.
 *
 * Браузер — тот же, что у `verify.sh page`; файл запускается из временной папки.
 * Аргументы: <корень репозитория> <имена> <куда.png> [высота].
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const [, , root, names, out, tallArg = "1024", mode = ""] = process.argv;
if (!root || !out || !/^[a-z0-9-]+(?:,[a-z0-9-]+)*$/u.test(names ?? "")) { console.error("Нужно: node room-ref.mjs <корень репозитория> <имя>[,<имя>…] <куда.png> [высота]"); process.exit(2); }

let chromium, puppeteer;
try {
  process.env.AWS_EXECUTION_ENV ??= "AWS_Lambda_nodejs22.x";
  ({ default: chromium } = await import("@sparticuz/chromium"));
  ({ default: puppeteer } = await import("puppeteer-core"));
} catch (error) {
  console.error(`Браузера рядом нет (${error.code ?? error.message}). Запускайте так: bash scripts/verify.sh ref …`);
  process.exit(2);
}

const sprites = [];
for (const name of names.split(",")) {
  const sprite = (await import(pathToFileURL(join(resolve(root), "miniapp", "her", `${name}.js`)).href)).default;
  sprites.push({ src: sprite.src, lids: mode === "closed" && sprite.blink ? sprite.blink : null });
}
const executablePath = await chromium.executablePath();
process.env.LD_LIBRARY_PATH = [join(tmpdir(), "al2023/lib"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
process.env.FONTCONFIG_PATH ??= join(tmpdir(), "fonts");
process.env.HOME = tmpdir();
const browser = await puppeteer.launch({ args: [...chromium.args, "--no-sandbox", "--disable-gpu"], executablePath, headless: "shell", defaultViewport: { width: 1200, height: 900, deviceScaleFactor: 1 } });
try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><meta charset=\"utf-8\"><body style=\"margin:0\"></body>");
  const png = await page.evaluate(async (list, tall) => {
    const images = [];
    const load = async (src) => { const image = new Image(); image.src = src; await image.decode(); return image; };
    for (const { src } of list) images.push(await load(src));
    // Поля — по шесть сотых высоты: фигура не касается края, а нейросети есть куда дорисовать тень от волос.
    const pad = Math.round(tall * 0.06), inner = tall - pad * 2, scale = inner / Math.max(...images.map(image => image.naturalHeight));
    const sized = images.map(image => [Math.round(image.naturalWidth * scale), Math.round(image.naturalHeight * scale)]);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(sized.reduce((sum, [w]) => sum + w + pad * 2, 0), Math.round(tall * 0.62));
    canvas.height = tall;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#00FF00";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = "high";
    let x = Math.round((canvas.width - sized.reduce((sum, [w]) => sum + w + pad * 2, 0)) / 2) + pad;
    for (const [index, image] of images.entries()) {
      const [w, h] = sized[index], lids = list[index].lids;
      ctx.drawImage(image, x, tall - pad - h, w, h);
      if (lids) ctx.drawImage(await load(lids.src), x + lids.x * scale, tall - pad - h + lids.y * scale, lids.w * scale, lids.h * scale);
      x += w + pad * 2;
    }
    return canvas.toDataURL("image/png");
  }, sprites, Math.max(400, Math.min(2000, Number(tallArg) || 1024)));
  await mkdir(dirname(resolve(out)), { recursive: true });
  await writeFile(resolve(out), Buffer.from(png.split(",")[1], "base64"));
  console.log(`образец «${names}» → ${resolve(out)}`);
} finally {
  await browser.close().catch(() => {});
}
