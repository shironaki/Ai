#!/usr/bin/env node
/* global document, Image */
/**
 * Сжать по высоте полосу картинки — и только её (0.44.0).
 *
 *   bash scripts/verify.sh squeeze <картинка.png> <куда.png> <от 0–1> <до 0–1> <во сколько раз, 0.2–1>
 *
 * Зачем. Сидящую нейросеть рисует с голенями в полтора раза длиннее, чем у той же девушки стоя: сидя она выходит
 * «выше» самой себя, и ни кресло, ни рост под неё не подобрать. Полоса от колен до ботинок — ровная тёмная ткань без
 * рисунка; сжатая по высоте, она выглядит так же, а ноги становятся своей длины. Всё, что выше и ниже полосы, не
 * меняется ни на точку — только сдвигается вверх.
 *
 * Доли — от высоты всей картинки (а не фигуры): картинка, она же с закрытыми глазами и она же в другом наряде
 * приходят от нейросети на одном холсте, и одни и те же числа сжимают у всех трёх одно и то же место. Поэтому
 * сжатие — отдельный шаг до `sprite` и `blink`, а не их слово.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { tmpdir } from "node:os";

const [, , input, output, fromArg, toArg, factorArg] = process.argv;
const from = Number(fromArg), to = Number(toArg), factor = Number(factorArg);
if (!input || !output || !(from >= 0 && to <= 1 && to > from) || !(factor >= 0.2 && factor <= 1)) {
  console.error("Нужно: node room-squeeze.mjs <картинка.png> <куда.png> <от 0–1> <до 0–1> <во сколько раз, 0.2–1>");
  process.exit(2);
}

let chromium, puppeteer;
try {
  process.env.AWS_EXECUTION_ENV ??= "AWS_Lambda_nodejs22.x";
  ({ default: chromium } = await import("@sparticuz/chromium"));
  ({ default: puppeteer } = await import("puppeteer-core"));
} catch (error) {
  console.error(`Браузера рядом нет (${error.code ?? error.message}). Запускайте так: bash scripts/verify.sh squeeze …`);
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
  const made = await page.evaluate(async (source, a, b, k) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const W = image.naturalWidth, H = image.naturalHeight, y0 = Math.round(H * a), y1 = Math.round(H * b), band = Math.round((y1 - y0) * k);
    const out = document.createElement("canvas");
    out.width = W; out.height = y0 + band + (H - y1);
    const x = out.getContext("2d");
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
    x.drawImage(image, 0, 0, W, y0, 0, 0, W, y0);
    x.drawImage(image, 0, y0, W, y1 - y0, 0, y0, W, band);
    x.drawImage(image, 0, y1, W, H - y1, 0, y0 + band, W, H - y1);
    return { png: out.toDataURL("image/png"), from: [W, H], to: [out.width, out.height], rows: [y0, y1, band] };
  }, `data:${type};base64,${bytes.toString("base64")}`, from, to, factor);
  await writeFile(resolve(output), Buffer.from(made.png.split(",")[1], "base64"));
  console.log(`сжатие: ${made.from.join("×")} → ${made.to.join("×")}; полоса строк ${made.rows[0]}–${made.rows[1]} стала высотой ${made.rows[2]} → ${output}`);
} finally {
  await browser.close().catch(() => {});
}
