/**
 * Вес того, что уходит в облако, и облегчение кода перед отправкой (`scripts/slim.mjs`).
 *
 * 17.11.2026 сборки 0.36.0–0.36.2 не опубликовались: инструмент шлёт на репетицию весь код
 * одним запросом, запрос перешёл за три миллиона байт (0.35.1 — 2 933 903, 0.36.0 — 3 008 694),
 * и облако обрывало передачу. Телефон узнал об этом раньше агента. Здесь — сторож: вес считается
 * так же, как его собирает инструмент, и тест падает задолго до предела.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { slim, sameProgram, modules, runBody, KEPT, slimPage, pageFiles } = await import("../scripts/slim.mjs");

/**
 * Пределы — не «сколько берёт облако» (этого никто не сказал), а «сколько заведомо проходило»:
 * сборка 0.35.1 опубликована 16.11.2026 с запросом в 2 933 903 байта, самые тяжёлые её модули —
 * 708 254 и 650 669 байт (`git show origin/main`, посчитано `scripts/slim.mjs --size` и `git cat-file -s`).
 * Пределы стоят ниже этих чисел с запасом. Тест упал — не поднимать предел, а облегчать код:
 * следующие рычаги записаны в docs/IDEAS.md («Вес кода для облака»).
 */
const BODY_LIMIT = 2_800_000;
const MODULE_LIMIT = 640_000;
/**
 * Число модулей (0.49.1). 21.11.2026 сборка 0.49.0 не опубликовалась: репетиции в облаке проходили, а отправку
 * платформа не принимала (сообщение 50). Вес был ни при чём — и запрос, и самый тяжёлый модуль, и сумма были меньше,
 * чем у сборок, которые уже стояли в боте. Впервые выросло одно: число модулей. В облаке их стало бы 102 — 101 в
 * коде и прежний словарь (`lib/data/phrases`), который лежал там с 0.36.3: отправка с целями из облака ничего не
 * убирает. До этого больше ста не бывало: 99 при 0.38.0–0.41.0 (в боте подтверждены), 100 при 0.42.0–0.48.0.
 * Предел платформы нигде не назван; по совпадению — сто. Сторож стоит на числе, которое заведомо проходило.
 * Тест упал — не поднимать число, а складывать модули (данные — первыми, как `lib/data/games.js`): и помнить, что
 * убранный модуль уходит из облака только отправкой без целей (`push_code` в scripts/phone.sh).
 */
const MODULE_COUNT_LIMIT = 99;

test("облегчение: комментарии уходят, а строки, шаблоны и регулярные выражения с «//» и «/*» — нет", () => {
  const source = [
    "/**",
    " * Шапка модуля.",
    " */",
    "const url = \"https://example.org/a//b\"; // хвостовой комментарий",
    "const text = `строка один // не комментарий",
    "  /* и это не комментарий */ ${ /* а это комментарий */ url } конец`;",
    "const pattern = /\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\//gu; // выражение, которое само ищет комментарии",
    "const slash = /[/*]+/u.test(\"/* не комментарий */\") ? 6 / 3 / 1 : 0;",
    "  // комментарий с отступом",
    "export const value = url + text + pattern.source + slash /* посреди строки */ + '// и не это';",
    "",
  ].join("\n");
  const out = slim(source);
  assert.equal(out.split("\n").length, source.split("\n").length, "номера строк сохраняются");
  for (const gone of ["Шапка модуля", "хвостовой комментарий", "а это комментарий", "выражение, которое само", "комментарий с отступом", "посреди строки"]) assert.ok(!out.includes(gone), gone);
  for (const kept of ["\"https://example.org/a//b\"", "строка один // не комментарий", "/* и это не комментарий */", "/\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\//gu", "\"/* не комментарий */\"", "'// и не это'", "6 / 3 / 1"]) assert.ok(out.includes(kept), kept);
  assert.equal(out.split("\n")[3], "const url = \"https://example.org/a//b\";", "пробелы перед убранным комментарием уходят вместе с ним");
  assert.equal(slim(out), out, "облегчённое второй раз не меняется");
  assert.ok(sameProgram(source, out));
});

test("облегчение: соседние слова не склеиваются, перенос строки не теряется — программа та же", () => {
  // Комментарий между словами без пробелов: без него «a» и «in» слились бы в одно имя.
  assert.equal(slim("const a = 1; const b = { a: 2 }; export default (\"a\"/**/in/**/b) && a;\n"), "const a = 1; const b = { a: 2 }; export default (\"a\" in b) && a;\n");
  // Перенос строки внутри комментария кончает оператор «return»: убрать его — получить другую программу.
  const asi = "export function f() {\n  return /* объяснение\n  на две строки */ 1;\n}\n";
  assert.equal(slim(asi), "export function f() {\n  return\n 1;\n}\n");
  // Сверка ловит и то, и другое: лексемы те же, а перенос пропал — уже не та программа.
  assert.equal(sameProgram("let a = 1\n++a\n", "let a = 1\n\n\n++a\n"), true, "пустые строки программу не меняют");
  assert.equal(sameProgram("let a = 1; let b = a\n/ 2\n", "let a = 1; let b = a / 2\n"), false, "перенос между лексемами — часть программы");
  assert.equal(sameProgram("const a = 1; // c\n", "const a = 1; // c\n"), false, "комментарий остался — не облегчено");
  assert.equal(sameProgram("const a = 1;\n", "const a = 2;\n"), false);
  assert.throws(() => slim("const a = ;"), /Unexpected token/u, "нечитаемый код не трогается");
});

test("облегчение: каждый модуль проекта читается, облегчается и остаётся той же программой", () => {
  const paths = modules(ROOT);
  assert.ok(paths.includes("handlers/message.js") && paths.includes("lib/heart.js") && paths.includes("schema.js"));
  assert.ok(paths.includes("lib/data/phrases-1.js") && paths.includes("lib/data/phrases-2.js"), "словарь — двумя модулями");
  assert.ok(!paths.includes("lib/data/phrases.js"), "прежнего единого модуля словаря нет");
  // Данные игр — одним модулем (0.49.1): пять прежних файлов в коде не лежат.
  assert.ok(paths.includes("lib/data/games.js"));
  for (const old of ["words", "riddles", "animals", "quest", "party"]) assert.ok(!paths.includes(`lib/data/${old}.js`), `lib/data/${old}.js сложен в lib/data/games.js`);
  const heart = readFileSync(join(ROOT, "tgcloud/lib/heart.js"), "utf8"), light = slim(heart);
  assert.equal(light.split("\n").length, heart.split("\n").length);
  assert.match(light, /^export const BUILD = "\d+\.\d+\.\d+";$/mu);
  assert.ok(sameProgram(heart, light), "та же программа, и комментариев в ней не осталось");
  assert.ok(!light.includes("Сборка сердца. Её видно в /status"), "комментарий над номером сборки ушёл");
  assert.ok(Buffer.byteLength(light) < Buffer.byteLength(heart) * 0.85, "сердце легче хотя бы на седьмую часть");
});

test("сторож веса: запрос репетиции и каждый модуль — под пределом, который заведомо проходил", () => {
  // Один проход по коду: на телефоне этот тест идёт перед каждой публикацией.
  const light = {};
  let before = 0, after = 0;
  for (const path of modules(ROOT)) {
    const text = readFileSync(join(ROOT, "tgcloud", path), "utf8");
    light[path] = KEPT.includes(path) ? text : slim(text);
    before += Buffer.byteLength(text);
    after += Buffer.byteLength(light[path]);
    assert.ok(Buffer.byteLength(light[path]) <= MODULE_LIMIT, `${path}: ${Buffer.byteLength(light[path])} байт после облегчения — больше ${MODULE_LIMIT}. Разделите модуль`);
  }
  const count = Object.keys(light).length;
  assert.ok(count <= MODULE_COUNT_LIMIT, `модулей ${count} — больше ${MODULE_COUNT_LIMIT}: сборку с сотней и больше платформа, судя по 0.49.0, не принимает. Сложите модули вместе, число не поднимать`);
  assert.ok(count > 50, "счёт не пустой: в нём все модули");
  const body = runBody(light);
  assert.ok(after < before * 0.9, `комментарии — заметная часть кода: ${before} → ${after} байт`);
  assert.ok(body <= BODY_LIMIT, `в облако одним запросом уходит ${body} байт — больше ${BODY_LIMIT}. Облегчайте код (docs/IDEAS.md, «Вес кода для облака»), предел не поднимать`);
  assert.ok(body > 1_000_000, "счёт не пустой: в запросе весь код");
  // Сам счёт: тело — карта «модуль без .js → текст» одним JSON, как у `tgcloud run`.
  assert.equal(runBody({ "handlers/message.js": "export default 1;\n" }), Buffer.byteLength("{\"module\":\"handlers/message\",\"sources\":{\"handlers/message\":\"export default 1;\\n\"},\"args\":{\"chat\":{\"id\":1,\"type\":\"private\"},\"from\":{\"id\":1},\"text\":\"/start\"},\"ctx\":{\"testRun\":true}}"));
});

test("скрипт облегчения: в копии для облака — правит файлы; в репозитории — отказывается; «--size» — только считает", () => {
  const dir = mkdtempSync(join(tmpdir(), "heart-slim-"));
  try {
    mkdirSync(join(dir, "tgcloud/handlers"), { recursive: true });
    mkdirSync(join(dir, "tgcloud/lib/data"), { recursive: true });
    mkdirSync(join(dir, "tgcloud/static"), { recursive: true });
    writeFileSync(join(dir, "tgcloud/schema.js"), "// схема\nexport default {};\n");
    writeFileSync(join(dir, "tgcloud/lib/heart.js"), "// сердце\nexport const BUILD = \"1.0.0\";\n");
    writeFileSync(join(dir, "tgcloud/handlers/message.js"), "/** Обработчик. */\nexport default async function () { return 1; } // хвост\n");
    writeFileSync(join(dir, "tgcloud/lib/data/table.js"), "export const TABLE = [\"// не комментарий\"];\n");
    writeFileSync(join(dir, "tgcloud/static/page.js"), "// не модуль проекта: инструмент его не берёт\n");
    const script = join(ROOT, "scripts/slim.mjs");
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" });

    const sized = run("--size");
    assert.equal(sized.status, 0, sized.stderr);
    assert.match(readFileSync(join(dir, "tgcloud/lib/heart.js"), "utf8"), /сердце/u, "«--size» ничего не меняет");
    const before = JSON.parse(sized.stdout);
    assert.equal(before.files, 4);

    const done = run();
    assert.equal(done.status, 0, done.stderr);
    assert.deepEqual(JSON.parse(done.stdout), before);
    assert.equal(readFileSync(join(dir, "tgcloud/lib/heart.js"), "utf8"), "\nexport const BUILD = \"1.0.0\";\n");
    assert.equal(readFileSync(join(dir, "tgcloud/handlers/message.js"), "utf8"), "\nexport default async function () { return 1; }\n");
    // Схема базы не облегчается: её текст платформа сравнивает с прежним.
    assert.deepEqual([...KEPT], ["schema.js"]);
    assert.equal(readFileSync(join(dir, "tgcloud/schema.js"), "utf8"), "// схема\nexport default {};\n");
    assert.equal(readFileSync(join(dir, "tgcloud/lib/data/table.js"), "utf8"), "export const TABLE = [\"// не комментарий\"];\n");
    assert.match(readFileSync(join(dir, "tgcloud/static/page.js"), "utf8"), /не модуль проекта/u);
    assert.ok(before.after < before.before && before.body < before.bodyBefore);

    // Один нечитаемый модуль — и не тронут ни один: пишется всё или ничего.
    writeFileSync(join(dir, "tgcloud/lib/heart.js"), "// снова сердце\nexport const BUILD = \"1.0.1\";\n");
    writeFileSync(join(dir, "tgcloud/lib/broken.js"), "export const = 1;\n");
    const failed = run();
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /Облегчить код не вышло: lib\/broken\.js: /u);
    assert.match(readFileSync(join(dir, "tgcloud/lib/heart.js"), "utf8"), /снова сердце/u);

    // В папке с .git — это не копия, а сам репозиторий: комментарии там нужны.
    rmSync(join(dir, "tgcloud/lib/broken.js"));
    mkdirSync(join(dir, ".git"));
    const inRepo = run();
    assert.equal(inRepo.status, 1);
    assert.match(inRepo.stderr, /здесь репозиторий/u);
    assert.match(readFileSync(join(dir, "tgcloud/lib/heart.js"), "utf8"), /снова сердце/u, "в репозитории комментарии остаются");
    assert.equal(run("--size").status, 0, "а посчитать вес можно и там");
    // Одноразовая копия (кнопка в GitHub Actions) — папка с .git, но беречь в ней нечего.
    assert.equal(run("--here").status, 0);
    assert.equal(readFileSync(join(dir, "tgcloud/lib/heart.js"), "utf8"), "\nexport const BUILD = \"1.0.1\";\n");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("разборщик JavaScript, лежащий рядом со скриптом, — тот самый файл: acorn 8.19.0, без правок", () => {
  // Сумма — от файла dist/acorn.mjs из пакета acorn@8.19.0 (registry.npmjs.org), снята при добавлении.
  const sum = createHash("sha256").update(readFileSync(join(ROOT, "scripts/vendor/acorn.mjs"))).digest("hex");
  assert.equal(sum, "76254fc76529713b4dfd2532972d17a991ffd9aafeebb1f977445b5506b9fb0b");
  assert.match(readFileSync(join(ROOT, "scripts/vendor/acorn.LICENSE"), "utf8"), /^MIT License/u);
});


test("страница уходит без комментариев (0.51.0): только её код, картинки и index.html не тронуты; не разобралась — уходит как лежит, а код облака облегчается всё равно", () => {
  const dir = mkdtempSync(join(tmpdir(), "heart-slim-page-"));
  try {
    mkdirSync(join(dir, "tgcloud/handlers"), { recursive: true });
    mkdirSync(join(dir, "miniapp/her"), { recursive: true });
    writeFileSync(join(dir, "tgcloud/handlers/message.js"), "/** Обработчик. */\nexport default async function () { return 1; }\n");
    writeFileSync(join(dir, "miniapp/index.html"), "<!doctype html><!-- разметка остаётся как есть --><title>Комната</title>\n");
    writeFileSync(join(dir, "miniapp/app.js"), "// страница\nimport { step } from \"./logic.js\"; /* посреди строки */ step();\n");
    writeFileSync(join(dir, "miniapp/logic.js"), "/**\n * Логика.\n */\nexport const step = () => \"// не комментарий\";\n");
    writeFileSync(join(dir, "miniapp/her/tea.js"), "export default { w: 1, h: 1, src: \"data:image/webp;base64,AAAA\" };\n");
    assert.deepEqual(pageFiles(dir), ["app.js", "logic.js"]);
    const script = join(ROOT, "scripts/slim.mjs");
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" });
    const html = readFileSync(join(dir, "miniapp/index.html"), "utf8"), picture = readFileSync(join(dir, "miniapp/her/tea.js"), "utf8");

    const sized = JSON.parse(run("--size").stdout);
    assert.equal(sized.pageFiles, 2);
    assert.ok(sized.page < sized.pageBefore, "без комментариев страница легче");
    assert.match(readFileSync(join(dir, "miniapp/app.js"), "utf8"), /страница/u, "«--size» ничего не меняет");

    const done = run();
    assert.equal(done.status, 0, done.stderr);
    assert.deepEqual(JSON.parse(done.stdout), sized);
    assert.equal(readFileSync(join(dir, "miniapp/app.js"), "utf8"), "\nimport { step } from \"./logic.js\"; step();\n");
    assert.equal(readFileSync(join(dir, "miniapp/logic.js"), "utf8"), "\n\n\nexport const step = () => \"// не комментарий\";\n", "номера строк страницы — те же: журнал её ошибок называет строку репозитория");
    assert.equal(readFileSync(join(dir, "miniapp/index.html"), "utf8"), html);
    assert.equal(readFileSync(join(dir, "miniapp/her/tea.js"), "utf8"), picture);
    assert.equal(sized.page, Buffer.byteLength(html) + Buffer.byteLength(readFileSync(join(dir, "miniapp/app.js"))) + Buffer.byteLength(readFileSync(join(dir, "miniapp/logic.js"))));

    // Файл страницы не разобрался: страница не тронута вся, причина названа; код облака облегчён как обычно.
    writeFileSync(join(dir, "miniapp/app.js"), "// страница\nexport const page = 1;\n");
    writeFileSync(join(dir, "miniapp/logic.js"), "// сломано\nexport const = ;\n");
    writeFileSync(join(dir, "tgcloud/handlers/message.js"), "/** Обработчик. */\nexport default async function () { return 2; }\n");
    const broken = run();
    assert.equal(broken.status, 0, broken.stderr);
    const said = JSON.parse(broken.stdout);
    assert.match(said.pageError, /^logic\.js: /u);
    assert.equal(said.page, said.pageBefore);
    assert.equal(said.pageFiles, 0);
    assert.match(readFileSync(join(dir, "miniapp/app.js"), "utf8"), /страница/u, "пишется всё или ничего");
    assert.equal(readFileSync(join(dir, "tgcloud/handlers/message.js"), "utf8"), "\nexport default async function () { return 2; }\n");
    // Функция для тестов и листов: то же без запуска скрипта; страницы нет — пустой итог, и строка скрипта прежняя.
    assert.deepEqual(slimPage(join(dir, "tgcloud")), {});
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("страница проекта облегчается целиком: каждый её файл проходит сверку, комментариев в ней — больше четверти", () => {
  const before = pageFiles(ROOT).reduce((sum, name) => sum + Buffer.byteLength(readFileSync(join(ROOT, "miniapp", name), "utf8")), 0);
  const after = pageFiles(ROOT).reduce((sum, name) => sum + Buffer.byteLength(slim(readFileSync(join(ROOT, "miniapp", name), "utf8"))), 0);
  assert.deepEqual(pageFiles(ROOT), ["album.js", "app.js", "logic.js", "scene.js", "sound.js"]);
  assert.ok(after < before * 0.75, `код страницы: ${before} → ${after} байт`);
  const said = slimPage(ROOT, { write: false });
  assert.equal(said.pageError, undefined);
  assert.equal(said.pageFiles, 5);
});
