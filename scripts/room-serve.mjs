#!/usr/bin/env node
/**
 * Страница комнаты в обычном браузере — раздатчик папки `miniapp/` (после 0.47.0, сообщение 46 владельца).
 *
 * Зачем. Страница комнаты — модули: по `file://` браузер их не загрузит, ей нужен адрес `http://`. Вне Telegram
 * она открывается витриной: комната по часам устройства, забота понарошку — рисунок, движение, кнопки под рисунком
 * и места нажатий те же, что увидит человек в боте. Так комнату можно показать в предпросмотре песочницы чата и
 * посмотреть на своей машине, не публикуя сборку.
 *
 * Запуск: `node scripts/room-serve.mjs [порт] [адрес]` — по умолчанию порт 44367 и адрес 0.0.0.0 (предпросмотр
 * песочницы видит только то, что слушает на всех адресах). Порт и адрес можно назвать и переменными `PORT`, `HOST`.
 * Процесс долгий: в песочнице чата его запускают средством долгих процессов, а не командой, — и заново после
 * каждого перезапуска песочницы (процессы она не хранит).
 *
 * Что отдаёт. Только файлы из `miniapp/` — то же, что и так публикуется как страница; выше папки адрес не ведёт.
 * Ничего не кеширует: правка файла видна после обновления страницы. Запрета показывать страницу в рамке в ответе
 * нет: предпросмотр — это рамка. Сердца он не знает и ключей не видит; настройки витрины из адреса
 * (`#part=вечер&things=all`) действуют только на `localhost` — так решено в `miniapp/app.js`, и здесь это не меняется.
 *
 * Зависимостей нет. Проверяется тестами `tests/serve.test.mjs`: ответы — без сети (так тест идёт и на телефоне перед
 * публикацией), сам сервер — по сети (на телефоне этот тест пропускается: раздатчик там не запускают).
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** Порт предпросмотра по умолчанию: на нём комната была показана в песочнице чата. */
export const PREVIEW_PORT = 44367;
const TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon",
});

/** Файл страницы по адресу запроса; `null` — адрес битый или ведёт наружу из папки. Адрес папки — её `index.html`. */
export function fileFor(folder, url) {
  let path = "";
  try { path = decodeURIComponent(new URL(String(url), "http://x").pathname); } catch { return null; }
  if (path.includes("\0")) return null;
  const base = resolve(folder);
  const file = resolve(base, `.${path.endsWith("/") ? `${path}index.html` : path}`);
  return file.startsWith(base + sep) ? file : null;
}

const EMPTY = Buffer.alloc(0);
/**
 * Ответ на запрос — без сети: что отдать по этому адресу (`status`, `headers`, `body`; на `HEAD` тело пустое).
 * Вся логика раздатчика здесь: её проверяет тест на любой машине, в том числе на телефоне, где сервер не запускают.
 * Что бы ни пришло в адресе, ответ — «нет такого файла», а не исключение: предпросмотр должен жить.
 */
export async function answer(folder, method, url) {
  if (method !== "GET" && method !== "HEAD") return { status: 405, headers: { allow: "GET, HEAD", "cache-control": "no-store" }, body: EMPTY };
  try {
    const file = fileFor(folder, url);
    if (!file || !(await stat(file)).isFile()) throw new Error("нет");
    const body = await readFile(file);
    return {
      status: 200,
      headers: { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "content-length": body.length, "cache-control": "no-store", "x-content-type-options": "nosniff" },
      body: method === "HEAD" ? EMPTY : body,
    };
  } catch {
    return { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }, body: method === "HEAD" ? EMPTY : Buffer.from("Такого файла на странице комнаты нет.\n") };
  }
}

/** Запустить раздатчик; обещание — сам сервер (порт 0 — любой свободный: `server.address().port`). */
export function serveRoom({ port = PREVIEW_PORT, host = "0.0.0.0", folder = join(ROOT, "miniapp") } = {}) {
  const server = createServer((request, response) => {
    answer(folder, request.method, request.url).then(
      ({ status, headers, body }) => { response.writeHead(status, headers); response.end(body); },
      () => { response.writeHead(500, { "cache-control": "no-store" }); response.end(); },
    );
  });
  return new Promise((ready, failed) => {
    server.once("error", failed);
    server.listen(port, host, () => ready(server));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const named = process.argv[2] ?? process.env.PORT ?? String(PREVIEW_PORT);
  const port = /^\d{1,5}$/u.test(named) ? Number(named) : NaN;
  const host = process.argv[3] ?? process.env.HOST ?? "0.0.0.0";
  if (!(port >= 0 && port <= 65535)) {
    console.error(`Порт — число от 0 до 65535, а не «${named}». Запуск: node scripts/room-serve.mjs [порт] [адрес]`);
    process.exit(2);
  }
  try {
    const server = await serveRoom({ port, host });
    console.log(`Комната (витрина): http://${host}:${server.address().port}/ — папка miniapp/, без кеша. Остановить — Ctrl+C.`);
  } catch (error) {
    console.error(error?.code === "EADDRINUSE"
      ? `Порт ${port} занят: комната уже раздаётся? Посмотреть, кем: ss -ltnp | grep ${port}`
      : `Раздатчик не запустился: ${error?.message ?? error}`);
    process.exit(1);
  }
}
