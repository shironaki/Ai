// Раздатчик страницы комнаты (`scripts/room-serve.mjs`) — предпросмотр в обычном браузере.
//
// Сообщение 46 владельца (20.11.2026): «Resume the app preview on port 44367. Inspect the existing processes first,
// then repair the setup and start the server if needed». Песочница перезапустилась, и предпросмотр комнаты пропал:
// сервера, который показывал бы страницу, в репозитории не было вовсе — раздатчик жил внутри проверки страницы и
// умирал вместе с ней. Теперь он есть; тесты держат то, без чего предпросмотр не покажет комнату: страница отдаётся
// как есть, модули — с типом скрипта, без кеша и без запрета на рамку, а выше папки страницы адрес не ведёт.
//
// Тестов два. Первый — без сети: ответы раздатчика (`answer`) на каждый адрес. Он идёт везде, и на телефоне перед
// публикацией тоже (`npm run ci` в `scripts/phone.sh`), поэтому портов не открывает: до этого теста ни один тест
// проекта сети не касался, и репетиция на телефоне не должна зависеть от того, даст ли Android открыть порт.
// Второй — по сети: тот же ответ доходит до настоящего запроса. На телефоне он пропускается: раздатчик там не
// запускают.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { answer, serveRoom, fileFor, PREVIEW_PORT } from "../scripts/room-serve.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FOLDER = join(ROOT, "miniapp");
const read = (path) => readFileSync(join(ROOT, path));
/** Адреса, которые ведут наружу из папки страницы или в никуда: точками, закодированными точками и чертой. */
const OUTSIDE = ["/../package.json", "/%2e%2e/package.json", "/..%2fpackage.json", "/..%2Fpackage.json", "/..%5cpackage.json", "/her/..%2f..%2fpackage.json",
  "/%2e%2e%2f%2e%2e%2fetc%2fpasswd", "/..%2ftgcloud%2flib%2fheart.js", "/package.json", "/her", "/her/", "/нет.js", "/%00", "/%E0%A4%A"];

test("предпросмотр комнаты: раздатчик отдаёт страницу как есть — модули с типом скрипта, без кеша, без запрета на рамку — и ничего вне её папки", async () => {
  // Страница — та же, что публикуется: байт в байт, и по «/», и по имени.
  for (const url of ["/", "/index.html", "/index.html?v=1", "/index.html#part=вечер"]) {
    const page = await answer(FOLDER, "GET", url);
    assert.equal(page.status, 200, url);
    assert.equal(page.headers["content-type"], "text/html; charset=utf-8", url);
    assert.ok(page.body.equals(read("miniapp/index.html")), `${url}: страница отдаётся как есть`);
    // Предпросмотр песочницы — рамка на чужой странице: запрет на рамку оставил бы в ней пустое место.
    assert.deepEqual(Object.keys(page.headers).filter(name => /frame|security-policy/iu.test(name)), [], url);
    assert.equal(page.headers["cache-control"], "no-store", `${url}: правка видна после обновления страницы`);
  }
  // Всё, что страница грузит сама: четыре модуля, звук и каждая её картинка. Модуль с другим типом браузер не возьмёт.
  const modules = ["app.js", "logic.js", "scene.js", "sound.js", ...readdirSync(join(FOLDER, "her")).map(name => `her/${name}`), ...readdirSync(join(FOLDER, "voice")).map(name => `voice/${name}`)];
  assert.ok(modules.length > 50, "картинки на месте");
  for (const name of modules) {
    const got = await answer(FOLDER, "GET", `/${name}`);
    assert.equal(got.status, 200, name);
    assert.equal(got.headers["content-type"], "text/javascript; charset=utf-8", name);
    assert.equal(got.headers["cache-control"], "no-store", name);
    assert.equal(got.headers["content-length"], got.body.length, name);
    assert.ok(got.body.equals(read(`miniapp/${name}`)), `${name}: отдаётся как есть`);
  }
  // Наружу из папки страницы адрес не ведёт. (Рядом лежат `package.json` и сердце — а предпросмотр виден из сети.)
  for (const url of OUTSIDE) {
    const got = await answer(FOLDER, "GET", url);
    assert.equal(got.status, 404, url);
    assert.equal(got.headers["cache-control"], "no-store", url);
    assert.doesNotMatch(got.body.toString("utf8"), /"version"|export const BUILD|root:/u, url);
  }
  // Страница только читается; на `HEAD` — те же заголовки без тела.
  const head = await answer(FOLDER, "HEAD", "/app.js");
  assert.deepEqual([head.status, head.body.length, head.headers["content-length"], head.headers["content-type"]], [200, 0, read("miniapp/app.js").length, "text/javascript; charset=utf-8"]);
  assert.deepEqual([(await answer(FOLDER, "HEAD", "/нет.js")).status, (await answer(FOLDER, "HEAD", "/нет.js")).body.length], [404, 0]);
  for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
    const got = await answer(FOLDER, method, "/");
    assert.deepEqual([got.status, got.headers.allow, got.body.length], [405, "GET, HEAD", 0], method);
  }
  // Что бы ни пришло вместо адреса, ответ — «нет», а не исключение: предпросмотр должен жить.
  for (const url of [undefined, null, "", "//[", "http://[", "\\\\", "%", "/%", "/%zz"]) assert.equal((await answer(FOLDER, "GET", url)).status === 500, false, String(url));
  for (const url of ["//[", "/%", "/%zz", "/%E0%A4%A"]) assert.equal((await answer(FOLDER, "GET", url)).status, 404, url);

  // Какой файл стоит за адресом.
  assert.equal(fileFor("/a/miniapp", "/"), "/a/miniapp/index.html");
  assert.equal(fileFor("/a/miniapp", "/her/work.js?x=1#y"), "/a/miniapp/her/work.js");
  assert.equal(fileFor("/a/miniapp/", "/app.js"), "/a/miniapp/app.js", "черта в конце имени папки ничего не меняет");
  for (const url of ["/..%2fsecret", "/%2e%2e%2fsecret", "/her/..%2f..%2fsecret", "/..%2f..%2f..%2fetc%2fpasswd", "/%E0%A4%A", "/a%00b"]) assert.equal(fileFor("/a/miniapp", url), null, url);
  // Соседняя папка с похожим именем — тоже «наружу».
  for (const url of ["/..%2fminiapp2%2fapp.js", "/..%2fminiapp-old%2fapp.js"]) assert.equal(fileFor("/a/miniapp", url), null, url);
  // Порт по умолчанию — тот, на котором комнату показывает предпросмотр песочницы (сообщение 46).
  assert.equal(PREVIEW_PORT, 44367);
});

test("предпросмотр комнаты: по сети до браузера доходит тот же ответ; занятый порт — отказ, а не второй сервер", {
  skip: process.platform === "android" ? "на телефоне раздатчик не запускают: репетиция перед публикацией портов не открывает" : false,
}, async () => {
  const server = await serveRoom({ port: 0, host: "127.0.0.1" });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const get = async (path, options) => {
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(20_000), ...options });
    return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) };
  };
  try {
    for (const path of ["/", "/app.js", "/her/work.js"]) {
      const [got, same] = [await get(path), await answer(FOLDER, "GET", path)];
      assert.equal(got.status, 200, path);
      assert.ok(got.body.equals(same.body), `${path}: по сети — те же байты`);
      for (const [name, value] of Object.entries(same.headers)) assert.equal(got.headers.get(name), String(value), `${path}: ${name}`);
      for (const header of ["x-frame-options", "content-security-policy"]) assert.equal(got.headers.get(header), null, `${path}: ${header}`);
    }
    for (const path of OUTSIDE) assert.equal((await get(path)).status, 404, path);
    const head = await get("/app.js", { method: "HEAD" });
    assert.deepEqual([head.status, head.body.length, Number(head.headers.get("content-length"))], [200, 0, read("miniapp/app.js").length]);
    const post = await get("/", { method: "POST", body: "x" });
    assert.deepEqual([post.status, post.headers.get("allow")], [405, "GET, HEAD"]);
    // Сервер жив после всего, что в него прилетело.
    assert.equal((await get("/logic.js")).status, 200);
    await assert.rejects(serveRoom({ port: server.address().port, host: "127.0.0.1" }), { code: "EADDRINUSE" });
  } finally {
    server.closeAllConnections?.();
    await new Promise(done => server.close(done));
  }
});
