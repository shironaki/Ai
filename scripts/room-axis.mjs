/**
 * Ось третьего кадра (поворот головы, `HER_TURNS`): где у кадра ось тела, чтобы он лёг на позу точка в точку.
 *
 *   bash scripts/verify.sh axis <поза>:<кадр> [<поза>:<кадр> …]      например: work3:work3c home-read:home-readc
 *
 * Зачем. Спрайт ставится на место по оси тела (`cx`, доля ширины). Сама она считается по силуэту, а у повёрнутой
 * головы волосы лежат иначе — кадр уезжает на несколько точек, и при смене кадров фигура дёргается. Здесь ось
 * находится по тому, что на кадре не менялось: ноги кадра накладываются на ноги позы (полоса от 0,6 до 0,97
 * высоты), и ось позы переносится в кадр. Считать по рамкам образца (как делалось в 0.53.0) нельзя: у сидящих поз в
 * модуле слева есть пустые столбцы, и рамка образца у́же модуля — ось выходила на пять точек в сторону.
 *
 * Порядок: `verify.sh sprite <png> <кадр> <высота позы> 0.86` → `verify.sh axis <поза>:<кадр>` → тот же `sprite`
 * с осью шестым словом → снова `axis`: «сама» и «ось» должны совпасть. «Разница» больше 4,5 — ноги на кадре
 * перерисованы: такой кадр не годится.
 *
 * Картинки читает ImageMagick (`convert`), как у `scripts/room-paint.mjs`; браузер не нужен.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const her = join(dirname(fileURLToPath(import.meta.url)), "..", "miniapp", "her");
const pairs = process.argv.slice(2).filter(item => /^[a-z0-9-]+:[a-z0-9-]+$/u.test(item));
if (!pairs.length) { console.error("Нужно: bash scripts/verify.sh axis <поза>:<кадр> [<поза>:<кадр> …]"); process.exit(2); }

async function load(name) {
  const sprite = (await import(`${pathToFileURL(join(her, `${name}.js`)).href}?t=${Date.now()}`)).default;
  const bytes = Buffer.from(String(sprite.src).split(",")[1], "base64");
  const [w, h] = execFileSync("identify", ["-format", "%w %h", "webp:-"], { input: bytes }).toString().split(" ").map(Number);
  return { cx: sprite.cx, w, h, raw: execFileSync("convert", ["webp:-", "-depth", "8", "rgba:-"], { input: bytes, maxBuffer: 1 << 28 }) };
}

let bad = 0;
for (const pair of pairs) {
  const [poseName, turnName] = pair.split(":");
  const pose = await load(poseName), turn = await load(turnName);
  const at = (image, x, y) => { const i = (y * image.w + x) * 4; return x < 0 || y < 0 || x >= image.w || y >= image.h ? [0, 0, 0, 0] : [image.raw[i], image.raw[i + 1], image.raw[i + 2], image.raw[i + 3]]; };
  const from = Math.round(pose.h * 0.6), to = Math.round(pose.h * 0.97);
  let best = [0, 0, Infinity];
  for (let dx = -90; dx <= 90; dx += 1) for (let dy = -4; dy <= 4; dy += 1) {
    let diff = 0;
    for (let y = from; y < to; y += 2) for (let x = 0; x < pose.w; x += 2) {
      const a = at(pose, x, y), b = at(turn, x + dx, y + dy);
      diff += Math.abs(a[3] - b[3]) + (a[3] > 128 && b[3] > 128 ? (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3 : 0);
    }
    if (diff < best[2]) best = [dx, dy, diff];
  }
  // Точка позы x лежит в кадре на x + dx: ось позы (cx · ширина) в кадре — на cx · ширина + dx.
  const axis = (pose.cx * pose.w + best[0]) / turn.w, rest = best[2] / (((to - from) / 2) * (pose.w / 2));
  const fits = turn.h === pose.h && Math.abs(best[1]) <= 1 && rest <= 4.5;
  if (!fits) bad += 1;
  console.log(`${poseName} (${pose.w}×${pose.h}, ось ${pose.cx}) ← ${turnName} (${turn.w}×${turn.h}, сама ${turn.cx}): сдвиг ${best[0]},${best[1]}, разница ${rest.toFixed(2)} → ось ${axis.toFixed(3)}${fits ? "" : "  ✗ кадр не ложится на позу: другая высота, сдвиг по высоте или перерисованы ноги"}`);
}
process.exit(bad ? 1 : 0);
