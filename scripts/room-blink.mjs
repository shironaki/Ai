/* global document, Image */
/**
 * Моргание для спрайта Аи: из той же картинки с закрытыми глазами — маленькая заплатка «веки» в модуль спрайта.
 *
 *   bash scripts/verify.sh blink <картинка с закрытыми глазами.png> <имя спрайта> [win=ШxВ] [at=x,y] [by=head]
 *
 * Откуда вторая картинка. Нейросеть правит уже принятый спрайт (он же на зелёном фоне — `scripts/room-sprite.mjs`,
 * образец для неё делается из модуля): «всё то же, только глаза закрыты». Правка сохраняет фигуру почти точка в
 * точку, поэтому из неё берётся не вся картинка, а только глаза: заплатка с мягким краем ложится поверх спрайта,
 * и страница показывает её на десятую долю секунды — она моргает.
 *
 * Что делает: вырезает фон у второй картинки тем же правилом, подгоняет её к спрайту (сдвиг и размер — перебором,
 * по нижним четырём пятым фигуры: там ничего не менялось), находит глаза — окно, где две картинки расходятся
 * сильнее всего, — подгоняет заплатку ещё раз, уже по кайме вокруг глаз (правка могла сдвинуть голову на точку
 * относительно тела), и дописывает в модуль `blink: { x, y, w, h, src }` (точки спрайта). Рядом, в `out/`, кладёт
 * снимок: спрайт, спрайт с заплаткой и разница — по нему видно, что заплатка села на глаза и края не видно.
 * Пересобрали спрайт — моргание собирается заново: `room-sprite.mjs` пишет модуль без него.
 *
 * `win` — размер окна глаз в точках спрайта (по умолчанию 100×30: стоящая фигура высотой 900); `at` — середина
 * окна руками, если поиск ошибся (например, изменился ещё и рот). `by=head` — подгонять по голове, а не по телу:
 * так веки берутся с картинки в другом наряде (та же поза и то же лицо — у спрайта в свитере и его же в куртке).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const [, , root, input, name, ...more] = process.argv;
if (!root || !input || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(name ?? "")) { console.error("Нужно: node room-blink.mjs <корень репозитория> <картинка.png> <имя спрайта> [win=ШxВ] [at=x,y]"); process.exit(2); }
const option = (key) => more.find(word => word.startsWith(`${key}=`))?.slice(key.length + 1) ?? "";
const win = option("win").split("x").map(Number), at = option("at").split(",").map(Number), byHead = option("by") === "head";

let chromium, puppeteer;
try {
  process.env.AWS_EXECUTION_ENV ??= "AWS_Lambda_nodejs22.x";
  ({ default: chromium } = await import("@sparticuz/chromium"));
  ({ default: puppeteer } = await import("puppeteer-core"));
} catch (error) {
  console.error(`Браузера рядом нет (${error.code ?? error.message}). Запускайте так: bash scripts/verify.sh blink …`);
  process.exit(2);
}

const file = join(resolve(root), "miniapp", "her", `${name}.js`);
const sprite = (await import(`${pathToFileURL(file).href}?${Date.now()}`)).default;
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
  const made = await page.evaluate(async (base, source, size, centre, head) => {
    const load = async (src) => { const image = new Image(); image.src = src; await image.decode(); return image; };
    const first = await load(base), second = await load(source);
    const W = first.naturalWidth, H = first.naturalHeight;
    // Вторая картинка: тот же зелёный фон — то же правило, что в room-sprite.mjs; рамка фигуры — по непрозрачным точкам.
    const full = document.createElement("canvas");
    full.width = second.naturalWidth; full.height = second.naturalHeight;
    const fctx = full.getContext("2d", { willReadFrequently: true });
    fctx.drawImage(second, 0, 0);
    const data = fctx.getImageData(0, 0, full.width, full.height), px = data.data;
    let left = full.width, top = full.height, right = -1, bottom = -1;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2], over = g - Math.max(r, b);
      const alpha = over <= 24 ? 1 : over >= 96 ? 0 : 1 - (over - 24) / 72;
      if (over > 0) px[i + 1] = Math.max(r, b);
      if (alpha > 0 && alpha < 1) { const k = 0.55 + 0.45 * alpha; px[i] = r * k; px[i + 1] = px[i + 1] * k; px[i + 2] = b * k; }
      px[i + 3] = Math.round(px[i + 3] * alpha);
      if (px[i + 3] > 10) { const x = (i / 4) % full.width, y = Math.floor(i / 4 / full.width); if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y; }
    }
    if (right < 0) return { error: "на второй картинке после удаления фона ничего не осталось" };
    fctx.putImageData(data, 0, 0);
    const cw = right - left + 1, ch = bottom - top + 1;
    const pixels = (draw) => { const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d", { willReadFrequently: true }); x.imageSmoothingQuality = "high"; draw(x); return x.getImageData(0, 0, W, H).data; };
    const pa = pixels(x => x.drawImage(first, 0, 0));
    // Та же картинка с закрытыми глазами — тот же силуэт: её рамка ложится на рамку спрайта. Картинка в другом наряде
    // (`by=head`) — силуэт другой: куртка шире свитера, и рамки по ширине не сходятся (в 0.43.0 — на тринадцать точек
    // из трёхсот). Тогда вторая картинка берётся по росту, без искажения, а её место по ширине ищется широко.
    const fitted = head
      ? (dx, dy, sw, sh) => pixels(x => x.drawImage(full, left, top, cw, ch, dx, dy, cw * (H + sh) / ch, H + sh))
      : (dx, dy, sw, sh) => pixels(x => x.drawImage(full, left, top, cw, ch, dx, dy, W + sw, H + sh));
    const gap = (pb, i) => (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2])) / 3;
    const score = (pb, y0, y1, step = 2) => { let sum = 0, count = 0; for (let y = y0; y < y1; y += step) for (let x = 0; x < W; x += step) { const i = (y * W + x) * 4; if (pa[i + 3] < 200 || pb[i + 3] < 200) continue; sum += gap(pb, i); count += 1; } return count ? sum / count : 999; };
    // Подгонка: там, где ничего не менялось (ниже головы), картинки должны совпасть. С картинкой в другом наряде
    // (`by=head`) совпадает только голова — тогда по ней.
    const [from, to] = head ? [0, Math.round(H * 0.2)] : [Math.round(H * 0.25), H];
    let best = null;
    const attempt = (dx, dy, sw, sh) => { const value = score(fitted(dx, dy, sw, sh), from, to, 3); if (!best || value < best.value) best = { value, dx, dy, sw, sh }; };
    if (head) {
      // Сначала грубо и широко (обувь меняет рост на точки, наряд — ширину на десятки), потом — вокруг найденного.
      const wide = Math.max(48, Math.abs(Math.round(cw * H / ch) - W) + 16);
      for (let sh = -16; sh <= 16; sh += 4) for (let dx = -wide; dx <= wide; dx += 3) for (const dy of [-4, 0, 4]) attempt(dx, dy, 0, sh);
      const rough = best;
      for (let sh = rough.sh - 3; sh <= rough.sh + 3; sh += 1) for (let dx = rough.dx - 3; dx <= rough.dx + 3; dx += 1) for (let dy = rough.dy - 4; dy <= rough.dy + 4; dy += 1) attempt(dx, dy, 0, sh);
    } else {
      for (const sw of [0, -2, 2, -4, 4]) for (const sh of [0, -2, 2, -4, 4]) for (let dx = -4; dx <= 4; dx += 1) for (let dy = -4; dy <= 4; dy += 1) attempt(dx, dy, sw, sh);
    }
    const pb = fitted(best.dx, best.dy, best.sw, best.sh);
    // Глаза: окно, где разница собрана плотнее всего (сумма по окну — через таблицу сумм).
    const ww = Math.max(20, Math.min(W, size[0])), wh = Math.max(10, Math.min(H, size[1]));
    let cx = centre[0], cy = centre[1];
    if (!(cx > 0 && cy > 0)) {
      const table = new Float64Array((W + 1) * (H + 1));
      for (let y = 0; y < H; y += 1) { let row = 0; for (let x = 0; x < W; x += 1) { const i = (y * W + x) * 4; const d = pa[i + 3] < 200 || pb[i + 3] < 200 ? 0 : gap(pb, i); row += d > 24 ? d : 0; table[(y + 1) * (W + 1) + x + 1] = table[y * (W + 1) + x + 1] + row; } }
      const sum = (x, y) => table[(y + wh) * (W + 1) + x + ww] - table[y * (W + 1) + x + ww] - table[(y + wh) * (W + 1) + x] + table[y * (W + 1) + x];
      let most = -1;
      // Глаза — в верхних двух пятых картинки (она стоит или сидит): ниже искать нечего, а перерисованная вязка
      // свитера там «расходится» сильнее век.
      for (let y = 0; y + wh <= H * 0.4; y += 1) for (let x = 0; x + ww <= W; x += 1) { const value = sum(x, y); if (value > most) { most = value; cx = x + ww / 2; cy = y + wh / 2; } }
    }
    // Заплатка: окно с запасом, край тает; прозрачность — ещё и по самой фигуре, чтобы ничего не легло мимо неё.
    const PAD = 7, FEATHER = 6;
    const x0 = Math.max(0, Math.round(cx - ww / 2) - PAD), y0 = Math.max(0, Math.round(cy - wh / 2) - PAD);
    const x1 = Math.min(W, Math.round(cx + ww / 2) + PAD), y1 = Math.min(H, Math.round(cy + wh / 2) + PAD);
    // Местная подгонка. Правка могла сдвинуть голову на точку-другую относительно тела (так было с картинкой в
    // свитере: вязку нейросеть перерисовала). Кайма заплатки — чёлка, щёки, пряди — не менялась: по ней заплатка и
    // встаёт на место, иначе при каждом моргании лицо дёргалось бы.
    const rim = (data) => {
      let sum = 0, count = 0;
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
        if (Math.min(x - x0, y - y0, x1 - 1 - x, y1 - 1 - y) >= FEATHER + 2) continue;
        const i = (y * W + x) * 4;
        if (pa[i + 3] < 200 || data[i + 3] < 200) continue;
        sum += gap(data, i); count += 1;
      }
      return count ? sum / count : 999;
    };
    let near = { value: rim(pb), dx: 0, dy: 0, sw: 0, sh: 0, data: pb };
    const tryAt = (sw, sh) => {
      for (let dx = -6; dx <= 6; dx += 1) for (let dy = -6; dy <= 6; dy += 1) {
        if (!dx && !dy && !sw && !sh) continue;
        const data = fitted(best.dx + dx, best.dy + dy, best.sw + sw, best.sh + sh), value = rim(data);
        if (value < near.value - 0.05) near = { value, dx, dy, sw, sh, data };
      }
    };
    tryAt(0, 0);
    // Сдвига мало — голова ещё и чуть другого размера: тот же перебор с размером.
    if (near.value > 8.5) for (const sw of head ? [0] : [-6, -4, -2, 0, 2, 4, 6]) for (const sh of [-6, -4, -2, 0, 2, 4, 6]) if (sw || sh) tryAt(sw, sh);
    const pe = near.data;
    const patch = document.createElement("canvas");
    patch.width = x1 - x0; patch.height = y1 - y0;
    const pctx = patch.getContext("2d");
    const cut = pctx.createImageData(patch.width, patch.height);
    let changed = 0;
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
      const i = (y * W + x) * 4, o = ((y - y0) * patch.width + (x - x0)) * 4;
      const edge = Math.min(x - x0, y - y0, x1 - 1 - x, y1 - 1 - y);
      const soft = Math.max(0, Math.min(1, (edge + 0.5) / FEATHER));
      cut.data[o] = pe[i]; cut.data[o + 1] = pe[i + 1]; cut.data[o + 2] = pe[i + 2];
      cut.data[o + 3] = Math.round(Math.min(pa[i + 3], pe[i + 3]) * soft);
      if (gap(pe, i) > 24) changed += 1;
    }
    pctx.putImageData(cut, 0, 0);
    const src = patch.toDataURL("image/webp", 0.92);
    if (!src.startsWith("data:image/webp")) return { error: "браузер не умеет сохранять WebP" };
    // Снимок для глаз: голова крупно — как есть, с заплаткой, разница ×4.
    const zoom = 3, vx = Math.max(0, x0 - 40), vy = Math.max(0, y0 - 50), vw = Math.min(W - vx, patch.width + 80), vh = Math.min(H - vy, patch.height + 110);
    const show = document.createElement("canvas");
    show.width = vw * zoom * 3 + 40; show.height = vh * zoom + 20;
    const sctx = show.getContext("2d");
    sctx.fillStyle = "#8a8f98"; sctx.fillRect(0, 0, show.width, show.height);
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(first, vx, vy, vw, vh, 10, 10, vw * zoom, vh * zoom);
    sctx.drawImage(first, vx, vy, vw, vh, 20 + vw * zoom, 10, vw * zoom, vh * zoom);
    sctx.drawImage(patch, 0, 0, patch.width, patch.height, 20 + vw * zoom + (x0 - vx) * zoom, 10 + (y0 - vy) * zoom, patch.width * zoom, patch.height * zoom);
    const diff = document.createElement("canvas"); diff.width = vw; diff.height = vh;
    const dctx = diff.getContext("2d"), dimg = dctx.createImageData(vw, vh);
    for (let y = 0; y < vh; y += 1) for (let x = 0; x < vw; x += 1) { const i = ((vy + y) * W + vx + x) * 4, o = (y * vw + x) * 4, d = Math.min(255, gap(pe, i) * 4); dimg.data[o] = d; dimg.data[o + 1] = d; dimg.data[o + 2] = d; dimg.data[o + 3] = 255; }
    dctx.putImageData(dimg, 0, 0);
    sctx.drawImage(diff, 0, 0, vw, vh, 30 + vw * zoom * 2, 10, vw * zoom, vh * zoom);
    return { src, box: [x0, y0, patch.width, patch.height], fit: best, near: { dx: near.dx, dy: near.dy, sw: near.sw, sh: near.sh, rim: near.value }, changed, body: head ? 0 : score(pb, Math.round(H * 0.25), H), preview: show.toDataURL("image/png") };
  }, sprite.src, `data:${type};base64,${bytes.toString("base64")}`, [win[0] > 0 ? win[0] : 100, win[1] > 0 ? win[1] : 30], [at[0] > 0 ? at[0] : 0, at[1] > 0 ? at[1] : 0], byHead);
  if (made.error) { console.error(`моргание «${name}»: ${made.error}`); process.exit(1); }
  // Кайма заплатки не сошлась — заплатку было бы видно: шов на чёлке или на щеках.
  if (made.near.rim > 12) { console.error(`моргание «${name}»: вокруг глаз картинки расходятся (в среднем ${made.near.rim.toFixed(1)} из 255) — заплатку было бы видно. Нужна другая картинка или окно руками (at=x,y).`); process.exit(1); }
  // Картинки разошлись и там, где ничего не менялось, — правка перерисовала фигуру: заплатка не сядет.
  if (made.body > 14) { console.error(`моргание «${name}»: картинки расходятся и ниже головы (в среднем ${made.body.toFixed(1)} из 255) — правка перерисовала фигуру, заплатка не сядет. Нужна другая картинка.`); process.exit(1); }
  const text = await readFile(file, "utf8");
  const [x, y, w, h] = made.box;
  const blink = `blink: { x: ${x}, y: ${y}, w: ${w}, h: ${h}, src: "${made.src}" }, `;
  const cleared = text.replace(/blink: \{[^}]*\}, /u, "");
  if (!/, src: "data:image\/webp;base64,/u.test(cleared)) { console.error(`моргание «${name}»: модуль ${file} устроен не так, как пишет room-sprite.mjs`); process.exit(1); }
  await writeFile(file, cleared.replace(/, src: "data:image\/webp;base64,/u, `, ${blink}src: "data:image/webp;base64,`));
  await mkdir(join(resolve(root), "out"), { recursive: true });
  await writeFile(join(resolve(root), "out", `blink-${name}.png`), Buffer.from(made.preview.split(",")[1], "base64"));
  console.log(`моргание «${name}»: заплатка ${w}×${h} в точке ${x}, ${y}; у глаз сдвинута на ${made.near.dx}, ${made.near.dy}${made.near.sw || made.near.sh ? `, размер ${made.near.sw}, ${made.near.sh}` : ""} (кайма расходится на ${made.near.rim.toFixed(1)} из 255); ${byHead ? `по голове: место ${made.fit.dx}, ${made.fit.dy}, рост ${made.fit.sh >= 0 ? "+" : ""}${made.fit.sh}, голова расходится на ${made.fit.value.toFixed(1)}` : `ниже головы — на ${made.body.toFixed(1)}`}; изменённых точек в заплатке — ${made.changed}; модуль — ${Math.round(Buffer.byteLength(await readFile(file, "utf8")) / 1024)} КБ; снимок — out/blink-${name}.png`);
} finally {
  await browser.close().catch(() => {});
}
