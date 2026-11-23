/**
 * Песочница «дома на телефоне» (`scripts/phone.sh`) — общее для `tests/phone.test.mjs` и
 * `tests/phone-door.test.mjs`.
 *
 * Настоящей платформы здесь нет: вместо инструмента публикации — запись его вызовов (`FAKE_CLI`), вместо curl —
 * запись запросов (`FAKE_CURL`), вместо посредника двери — запись вызовов и код по плану (`FAKE_DOOR`; настоящий
 * посредник — `sandbox({ door: "real" })`). `sandbox()` собирает во временной папке репозиторий-источник, копию
 * «на телефоне» и дом (`~/.heart`), запускает настоящий скрипт и отдаёт, что он напечатал и что позвал.
 *
 * Вынесено из `tests/phone.test.mjs` в 0.54.2: тот файл шёл дольше двух минут, а предел `--test-timeout`
 * действует и на файл целиком (AGENTS.md, раздел 9). Новые тесты дома — в новый файл, общее — сюда.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, chmodSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { OWNER } from "./kit.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
// В Termux нет /usr/bin/env, на который опираются подставные программы теста:
// сам скрипт там работает, а его песочница — нет. Публикацию это не держит.
export const skip = process.platform === "win32" || process.platform === "android" ? "песочница скрипта собирается только на обычном Linux и macOS" : false;
// Песочница не наследует настройки настоящего дома: эти тесты гоняет и сам
// скрипт перед публикацией, и разработчик, у которого ключи лежат в окружении.
export const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(?:HEART_|ALARM_|TGCLOUD_|KEY_|FAKE_|DOOR_)|^(?:AI_PROVIDER_KEY|AI_EXTRA_KEYS|OWNER_TG_ID)$/u.test(name)));
const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
export const TOKEN = "app123:SECRET-PLATFORM-TOKEN";
export const KEYS = { model: "gsk-SECRET-MODEL-KEY", giga: "GIGA-SECRET-KEY", voice: "777:VOICE-SECRET" };

const FAKE_CLI = `
import { appendFileSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve, basename } from "node:path";
const args = process.argv.slice(2);
// Как настоящий инструмент: работает из ближайшей вверх по дереву папки с .tgcloud.
const started = resolve(process.cwd());
let root = started;
for (let dir = started; ; dir = dirname(dir)) {
  if (existsSync(dir + "/.tgcloud")) { root = dir; break; }
  if (dirname(dir) === dir) break;
}
process.chdir(root);
const found = existsSync("tgcloud/lib/secrets.js");
const secrets = found ? readFileSync("tgcloud/lib/secrets.js", "utf8") : "";
// Который это вызов по счёту: сбой можно назначить «начиная с такого-то».
const order = (existsSync(process.env.FAKE_LOG) ? readFileSync(process.env.FAKE_LOG, "utf8").split("\\n").filter(Boolean).length : 0) + 1;
appendFileSync(process.env.FAKE_LOG, JSON.stringify({
  args,
  // Откуда работает инструмент: «stage» — копия для облака, «live» — слепок опубликованного, иначе — сама папка.
  where: basename(root),
  // Ушли ли из кода комментарии: обработчик песочницы несёт один.
  slim: existsSync("tgcloud/handlers/message.js") && !readFileSync("tgcloud/handlers/message.js", "utf8").includes("комментарий"),
  // Ушли ли комментарии из кода страницы (0.51.0): у страницы песочницы он тоже один.
  page: existsSync("miniapp/app.js") && !readFileSync("miniapp/app.js", "utf8").includes("комментарий"),
  token: process.env.TGCLOUD_TOKEN === ${JSON.stringify(TOKEN)},
  key: secrets.includes(${JSON.stringify(KEYS.model)}),
  giga: secrets.includes(${JSON.stringify(KEYS.giga)}),
  explabs: secrets.includes("xpl_1"),
  // Ключ двери приложения (0.54.1): его пишет «phone.sh door» посреди работы — публикация должна его увидеть.
  door: secrets.includes("-100555000111:door-secret"),
  // Он же целиком — каким он ушёл в облако: сердце узнаёт ключ двери только отсюда.
  doorKey: (/"door":"([^"]+)"/u.exec(secrets) ?? [])[1] ?? "",
  // Чей код исполняется: недоделанный коммит песочницы несёт tgcloud/wip.js.
  wip: existsSync("tgcloud/wip.js"),
  inRepo: existsSync(".git"),
  strayed: root !== started,
  // Лежат ли в копии настройки проекта: отправка без целей идёт без них, иначе вместе с кодом ушла бы страница.
  config: existsSync("tgcloud.jsonc"),
}) + "\\n");
if (!found) { console.log("✗ Module not found"); process.exit(1); }
// В соседнем окне посреди публикации запускают что-то ещё.
if (process.env.FAKE_MEANWHILE && args[0] === "fetch") {
  // Соседнее окно открыто в папке с Аи, а не в копии для облака.
  const other = spawnSync("bash", ["-c", process.env.FAKE_MEANWHILE], { cwd: process.env.FAKE_PHONE || started, encoding: "utf8", env: { ...process.env, FAKE_MEANWHILE: "" } });
  appendFileSync(process.env.FAKE_LOG + ".meanwhile", String(other.stdout) + String(other.stderr));
}
// Сбои: FAKE_FAIL — имена вызовов через запятую; FAKE_FAIL_IN — только из этой папки («stage», «live»);
// FAKE_FAIL_FROM — только начиная с вызова с таким номером. FAKE_HANG — вызов, на который платформа молчит.
const fail = String(process.env.FAKE_FAIL || "").split(",").filter(Boolean);
// Отправку можно уронить и прицельно: «push:app» — код вместе с функцией комнаты, «push:page» — страницу комнаты.
// «push:all» — отправка без целей (0.49.1): ею телефон убирает из облака лишние модули.
const name = args[0] === "run" ? "run:" + args[1] : args[0] === "push" && args.length === 1 ? "push:all" : args[0] === "push" && args.includes("miniapp") ? "push:page" : args[0] === "push" && args.includes("endpoints") ? "push:app" : args[0];
const here = !process.env.FAKE_FAIL_IN || process.env.FAKE_FAIL_IN === basename(root);
const since = order >= Number(process.env.FAKE_FAIL_FROM || 1);
if ((process.env.FAKE_HANG === args[0] || process.env.FAKE_HANG === name) && here && since) await new Promise((done) => setInterval(done, 600_000));
const slow = String(process.env.FAKE_SLOW || "").split(":");
if (slow[0] === args[0] || slow[0] === name) await new Promise((done) => setTimeout(done, Number(slow[1]) * 1000));
if (here && since && (fail.includes(args[0]) || fail.includes(name))) { console.log(process.env.FAKE_SAYS || "✗ boom"); process.exit(1); }
// FAKE_ROOM_FATAL — платформа не терпит саму функцию комнаты: пока её файл лежит в копии, отказ на любой отправке
// («push») и, если значение другое, ещё и на её репетиции. Инструмент проверяет все модули копии, а не только цели.
if (process.env.FAKE_ROOM_FATAL && existsSync("tgcloud/endpoints/room.js") && (args[0] === "push" || (process.env.FAKE_ROOM_FATAL !== "push" && name === "run:endpoints/room"))) {
  console.log('Error: tgcloud/endpoints/room.js: "room" is not a valid module name in endpoints/.'); process.exit(1);
}
// Как настоящий инструмент: цель, которой нет в проекте, — отказ.
if (args[0] === "push" && args.includes("endpoints") && !existsSync("tgcloud/endpoints/room.js")) { console.log("Error: Cannot deploy: endpoints — not found"); process.exit(1); }
if (args[0] === "push" && args.includes("miniapp") && !(existsSync("tgcloud.jsonc") && existsSync("miniapp/index.html"))) { console.log("Error: Cannot deploy: miniapp — not found"); process.exit(1); }
// Слепок облака (0.49.1): на «fetch» инструмент кладёт модули облака в .tgcloud/remote. FAKE_CLOUD — что платформа
// хранит сверх коммита (пути через запятую; «-» — ничего лишнего): в слепок ложатся все модули копии и эти.
if (args[0] === "fetch" && process.env.FAKE_CLOUD) {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap(item => (item.isDirectory() ? walk(dir + "/" + item.name) : item.name.endsWith(".js") ? [dir + "/" + item.name] : []));
  const mine = walk("tgcloud").map(path => path.slice("tgcloud/".length));
  const extra = process.env.FAKE_CLOUD.split(",").filter(path => path && path !== "-");
  for (const path of [...mine, ...extra]) { mkdirSync(dirname(".tgcloud/remote/" + path), { recursive: true }); writeFileSync(".tgcloud/remote/" + path, "export default 1;\\n"); }
  console.log("Snapshot updated — " + (mine.length + extra.length) + " modules (revision 7)");
}
// Мини-приложение: на отправку страницы платформа отвечает её адресом, и инструмент кладёт ответ в .tgcloud/static.json.
// FAKE_PAGE_LIVE — страница опубликована раньше: её адрес приходит и с «fetch».
if ((args[0] === "push" && args.includes("miniapp")) || (args[0] === "fetch" && process.env.FAKE_PAGE_LIVE)) {
  writeFileSync(".tgcloud/static.json", JSON.stringify({ hash: "abc", url: process.env.FAKE_PAGE_URL ?? "https://app123.tgcloud.ai/", config: {}, manifest: { "index.html": { hash: "x", size: 1 } } }, null, 2) + "\\n");
}
// Настоящий инструмент печатает «allowed updates:» с выравниванием и цветом; список — через запятую.
// FAKE_UPDATES_SYNCED — подписка после «webhook sync»; FAKE_HOOK_MORE — остальные строки ответа («pending updates», «last error»).
if (args[0] === "webhook") console.log("  url: https://secret.example/hook\\n  \\u001b[2mallowed updates:\\u001b[22m   " + ((args[1] === "sync" && process.env.FAKE_UPDATES_SYNCED) || process.env.FAKE_UPDATES || "message, channel_post") + (process.env.FAKE_HOOK_MORE ? "\\n" + process.env.FAKE_HOOK_MORE : ""));
// Вопрос о двери (0.54.2): сердце отвечает строкой, и настоящий инструмент печатает её как есть — после «< », с цветом и временем.
// FAKE_DOOR_SAYS — её слова; «-» — платформа ответила не тем (прежняя сборка сердца о двери не знает).
const doorAsk = args[0] === "run" && args.some(item => item.includes('door: "state"'));
const doorAfter = (/after: (\\d+)/u.exec(args.join(" ")) ?? [])[1];
// FAKE_PLATFORM — адрес поддельной платформы (tests/fixtures/telegram.mjs): удар после публикации и вопрос о двери
// исполняет настоящее сердце теста.
let ran = null;
if (process.env.FAKE_PLATFORM && args[0] === "run" && args[1] === "handlers/message" && (doorAsk || args.some(item => item.includes("deployed: true")))) {
  try { ran = await (await fetch(process.env.FAKE_PLATFORM, { method: "POST", body: JSON.stringify(doorAsk ? { door: "state", ...(doorAfter ? { after: Number(doorAfter) } : {}) } : { tick: true, deployed: true }) })).json(); } catch { ran = null; }
}
if (doorAsk && typeof ran?.result === "string") console.log("\\u001b[36m< \\u001b[39m\\u001b[1m" + ran.result + "\\u001b[22m\\u001b[2m  41ms\\u001b[22m");
// С поддельной платформой отвечает только сердце на ней: нет его (опубликовано не отсюда, без ключа) — ответа о двери нет.
else if (doorAsk && !process.env.FAKE_PLATFORM && process.env.FAKE_DOOR_SAYS !== "-") console.log("\\u001b[36m< \\u001b[39m\\u001b[1m" + (process.env.FAKE_DOOR_SAYS || "DOOR-SAYS name=ai_heart_bot seq=7 | Что слышала Аи от бота двери за этот опыт: | • личное сообщение бота — запрос, ответила | • правка поста — не слышала | • новый пост — не слышала | Общение ботов у Аи: включено.") + "\\u001b[22m\\u001b[2m  41ms\\u001b[22m");
else if (args[0] === "run") console.log(args.includes("{ tick: true }") && process.env.FAKE_MISMATCH ? "{ ok: false, code: 'build_mismatch' }" : "{ ok: true }");
`;

/** Журналы упавших тестов — как их пишут node 24 и node 22 (сокращённо). */
export const TEST_LOGS = {
  spec: `✖ канал: ответ сестры доходит (0.744664ms)
✖ канал: опоздавший ответ (1.013209ms)
✔ всё хорошо (0.190554ms)
ℹ tests 3
ℹ pass 1
ℹ fail 2

✖ failing tests:

test at a.test.mjs:3:1
✖ канал: ответ сестры доходит (0.744664ms)
  TypeError [Error]: Cannot read properties of undefined (reading 'text')
      at TestContext.<anonymous> (file:///tmp/rep/a.test.mjs:3:75)
      at Test.runInAsyncScope (node:async_hooks:227:14)

test at a.test.mjs:4:1
✖ канал: опоздавший ответ (1.013209ms)
  AssertionError [ERR_ASSERTION]: ответ снимает молчание
  
  true !== false
  
      at TestContext.<anonymous> (file:///tmp/rep/a.test.mjs:4:48) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
  }
`,
  tap: `TAP version 13
# Subtest: канал: ответ сестры доходит
not ok 1 - канал: ответ сестры доходит
  ---
  duration_ms: 0.755088
  type: 'test'
  location: '/tmp/rep/a.test.mjs:3:1'
  failureType: 'testCodeFailure'
  error: "Cannot read properties of undefined (reading 'text')"
  code: 'ERR_TEST_FAILURE'
  name: 'TypeError'
  stack: |-
    TestContext.<anonymous> (file:///tmp/rep/a.test.mjs:3:75)
  ...
# Subtest: канал: опоздавший ответ
not ok 2 - канал: опоздавший ответ
  ---
  duration_ms: 0.980851
  type: 'test'
  location: '/tmp/rep/a.test.mjs:4:1'
  failureType: 'testCodeFailure'
  error: |-
    ответ снимает молчание
    
    true !== false
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  stack: |-
    TestContext.<anonymous> (file:///tmp/rep/a.test.mjs:4:48)
  ...
# Subtest: всё хорошо
ok 3 - всё хорошо
  ---
  duration_ms: 0.165848
  type: 'test'
  ...
1..3
# tests 3
# pass 1
# fail 2
`,
};

const FAKE_CURL = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_CURL_LOG"
case "$*" in
  *getMe*) echo '{"ok":true,"result":{"id":777,"username":"voice_bot"}}' ;;
  *getChat*) echo '{"ok":true,"result":{"id":-100,"title":"\\u041c\\u043e\\u0441\\u0442 \\"\\u0434\\u043e\\u043c\\""}}' ;;
  *) echo '{"ok":true,"result":{"message_id":77}}' ;;
esac
`;

/**
 * Поддельный посредник двери (`scripts/door-client.mjs`): записывает, как его позвали и что было в окружении, и
 * кончается кодом по плану. FAKE_DOOR='{"bot":[3,0],"look":[5,0]}' — коды вызовов команды по очереди, последний
 * повторяется. Удачные «bot <токен>» и «setup» пишут в файл ключей то же, что настоящий.
 */
const FAKE_DOOR = `
import { appendFileSync, readFileSync, existsSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2), log = process.env.FAKE_DOOR_LOG, file = process.env.HEART_ENV;
const text = existsSync(file) ? readFileSync(file, "utf8") : "";
appendFileSync(log, JSON.stringify({ args, ai: process.env.DOOR_AI_ID ?? "", name: process.env.DOOR_AI_NAME ?? "", flow: process.env.DOOR_FLOW ?? "", bot: process.env.DOOR_BOT_TOKEN ?? "", key: process.env.KEY_DOOR ?? "" }) + "\\n");
const plan = JSON.parse(process.env.FAKE_DOOR || "{}")[args[0]] ?? [0];
const seen = readFileSync(log, "utf8").split("\\n").filter(Boolean).map(line => JSON.parse(line)).filter(item => item.args[0] === args[0]).length;
const code = plan[Math.min(seen, plan.length) - 1];
console.log("посредник: " + args.join(" ").replace(/\\d+:[A-Za-z0-9_-]{20,}/u, "<токен>") + " → " + code);
if (code === 0 && args[0] === "bot" && args[1]) writeFileSync(file, text.replace(/^DOOR_BOT_TOKEN=.*\\n/mu, "") + "DOOR_BOT_TOKEN=" + (/[0-9]{5,15}:[A-Za-z0-9_-]{30,}/u.exec(args[1]) ?? [args[1].trim()])[0] + "\\n");
if (code === 0 && args[0] === "setup" && !/^KEY_DOOR=/mu.test(text)) appendFileSync(file, "KEY_DOOR=-100555000111:door-secret-0123456789abcdefghijklmnop\\n");
process.exit(code);
`;

export function sh(cwd, command, env = {}) {
  const done = spawnSync("bash", ["-c", command], { cwd, env: { ...CLEAN_ENV, ...GIT_ENV, ...env }, encoding: "utf8" });
  if (done.status !== 0) throw new Error(`${command}\n${done.stdout}\n${done.stderr}`);
  return done.stdout.trim();
}

/** Песочница: «GitHub», папка на телефоне, файл ключей, поддельные инструменты. */
export function sandbox({ lines = null, slim = true, app = false, door = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "heart-phone-"));
  const seed = join(dir, "seed"), phone = join(dir, "phone"), home = join(dir, "home"), bin = join(dir, "bin");
  for (const path of [join(seed, "scripts"), join(seed, "tgcloud/lib"), join(seed, "tgcloud/handlers"), home, bin]) mkdirSync(path, { recursive: true });
  copyFileSync(join(ROOT, "scripts/phone.sh"), join(seed, "scripts/phone.sh"));
  copyFileSync(join(ROOT, "scripts/inject-secrets.mjs"), join(seed, "scripts/inject-secrets.mjs"));
  copyFileSync(join(ROOT, "tgcloud/lib/secrets.js"), join(seed, "tgcloud/lib/secrets.js"));
  // Скрипт облегчения и его разборщик — как в настоящем коммите. `slim: false` — сборка до 0.36.3, без них.
  if (slim) {
    mkdirSync(join(seed, "scripts/vendor"), { recursive: true });
    copyFileSync(join(ROOT, "scripts/slim.mjs"), join(seed, "scripts/slim.mjs"));
    copyFileSync(join(ROOT, "scripts/vendor/acorn.mjs"), join(seed, "scripts/vendor/acorn.mjs"));
  }
  writeFileSync(join(seed, "tgcloud/lib/heart.js"), 'export const BUILD = "1.0.0";\n');
  writeFileSync(join(seed, "tgcloud/handlers/message.js"), "/** Обработчик: этот комментарий облаку не нужен. */\nexport default async function () {} // и этот комментарий тоже\n");
  // `app: true` — в коммите есть мини-приложение: функция комнаты, страница и настройки проекта для инструмента.
  if (app) {
    mkdirSync(join(seed, "tgcloud/endpoints"), { recursive: true });
    mkdirSync(join(seed, "miniapp"), { recursive: true });
    writeFileSync(join(seed, "tgcloud/endpoints/room.js"), "/** Функция комнаты: комментарий облаку не нужен. */\nexport default async function () { return { ok: true }; }\n");
    writeFileSync(join(seed, "miniapp/index.html"), "<!doctype html><title>Комната</title>\n");
    writeFileSync(join(seed, "miniapp/app.js"), "// Код страницы: этот комментарий платформе не нужен.\nexport const page = 1;\n");
    writeFileSync(join(seed, "tgcloud.jsonc"), '// страница мини-приложения\n{ "static": { "source": "miniapp" } }\n');
  }
  // `door: true` — в коммите есть посредник двери приложения (поддельный: что он делает сам, сверяет tests/door.test.mjs);
  // `door: "real"` — настоящий, со всем, что ему нужно: ему отвечает поддельный Telegram (`tests/fixtures/telegram.mjs`).
  if (door === "real") {
    copyFileSync(join(ROOT, "scripts/door-client.mjs"), join(seed, "scripts/door-client.mjs"));
    copyFileSync(join(ROOT, "tgcloud/lib/bridge.js"), join(seed, "tgcloud/lib/bridge.js"));
    // Хозяин записан в настройках сердца — как в настоящем репозитории; посредник спрашивает о нём там же, где сердце.
    writeFileSync(join(seed, "tgcloud/lib/config.js"), `export const CONFIG = Object.freeze({ OWNER_TG_ID: ${OWNER} });\n`);
  } else if (door) writeFileSync(join(seed, "scripts/door-client.mjs"), FAKE_DOOR);
  writeFileSync(join(seed, "package.json"), JSON.stringify({ name: "x", private: true, type: "module", scripts: { ci: "env > \"$FAKE_LOG.ci\"; [ -z \"$FAKE_CI_OUT\" ] || cat \"$FAKE_CI_OUT\"; exit ${FAKE_CI:-0}" } }));
  sh(dir, "git init -q --bare remote.git");
  sh(seed, `git init -q && git checkout -q -b work && git add -A && git commit -q -m one && git remote add origin "${join(dir, "remote.git")}" && git push -q origin work`);
  sh(dir, `git clone -q --branch work "${join(dir, "remote.git")}" phone`);
  writeFileSync(join(home, ".heart.env"), (lines ?? [
    "# ключи", `TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "OWNER_TG_ID=42", `KEY_GIGACHAT=${KEYS.giga}`,
    "HEART_BRANCH=work", `ALARM_BOT_TOKEN=${KEYS.voice}`, "ALARM_CHAT_ID=-100",
  ]).join("\n") + "\n");
  writeFileSync(join(dir, "fake-cli.mjs"), FAKE_CLI);
  writeFileSync(join(bin, "curl"), FAKE_CURL);
  chmodSync(join(bin, "curl"), 0o755);
  const env = {
    PATH: `${bin}:${process.env.PATH}`, HOME: home, HEART_HOME: join(home, ".heart"), HEART_ENV: join(home, ".heart.env"),
    HEART_CLI: join(dir, "fake-cli.mjs"), HEART_TESTS: "off", FAKE_LOG: join(dir, "cli.log"), FAKE_CURL_LOG: join(dir, "curl.log"),
    // Повтор оборванного шага — без паузы: тесты не ждут.
    HEART_RETRY_PAUSE: "0", FAKE_PHONE: phone, FAKE_DOOR_LOG: join(dir, "door.log"),
  };
  const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");
  // Ни один режим не должен кончаться ошибкой самого bash: такая строка в
  // Termux выглядит как поломка, даже когда всё сделано.
  const sane = (out) => { assert.doesNotMatch(out, /unbound variable|syntax error|command not found/u); return out; };
  return {
    dir, phone, home, seed,
    run(mode = "once", extra = {}, input = undefined) {
      const done = spawnSync("bash", ["scripts/phone.sh", ...String(mode).split(" ")], { cwd: phone, env: { ...CLEAN_ENV, ...GIT_ENV, ...env, ...extra }, encoding: "utf8", timeout: 60_000, input });
      return { code: done.status, out: sane(`${done.stdout}${done.stderr}`) };
    },
    /** То же, что `run`, но не занимая поток: рядом, в этом же процессе, отвечает поддельный Telegram. */
    start(mode = "once", extra = {}) {
      return new Promise((resolveRun) => {
        const child = spawn("bash", ["scripts/phone.sh", ...String(mode).split(" ")], { cwd: phone, env: { ...CLEAN_ENV, ...GIT_ENV, ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        child.stdout.on("data", chunk => { out += chunk; });
        child.stderr.on("data", chunk => { out += chunk; });
        const guard = setTimeout(() => child.kill("SIGKILL"), 90_000);
        child.on("close", (code) => { clearTimeout(guard); resolveRun({ code, out: sane(String(out)) }); });
      });
    },
    /**
     * Вечный цикл: работает, пока не выполнится условие, затем его останавливают,
     * как Ctrl+C. Одного нажатия может не хватить: bash теряет SIGINT, пришедший
     * в миг, когда он дожидается конца подстановки команды («$(date +%s)»), —
     * ловушка не зовётся, цикл идёт дальше (проверено на bash 5.2: в цикле из
     * одних подстановок теряется около шести нажатий из ста). Человек в таком
     * случае нажимает ещё раз; тест тоже — раз в три секунды. `presses` —
     * сколько нажатий понадобилось.
     */
    loop(until, extra = {}, mode = []) {
      return new Promise((resolveLoop) => {
        // Своя группа процессов: Ctrl+C в терминале получают все, кто в ней, — и bash, и его sleep.
        const child = spawn("bash", ["scripts/phone.sh", ...mode], { cwd: phone, env: { ...CLEAN_ENV, ...GIT_ENV, ...env, ...extra }, detached: true });
        let out = "", presses = 0, pressedAt = 0;
        child.stdout.on("data", chunk => { out += chunk; });
        child.stderr.on("data", chunk => { out += chunk; });
        const started = Date.now();
        const press = (signal) => { try { process.kill(-child.pid, signal); } catch { child.kill(signal); } };
        const watch = setInterval(() => {
          const now = Date.now();
          // Условию виден и журнал: файл состояния пишется раньше строки о нём, и на занятом процессоре Ctrl+C попадал между ними.
          if (!presses && !(until(String(out)) || now - started > 40_000)) return;
          if (presses && now - pressedAt < 3_000) return;
          presses += 1;
          pressedAt = now;
          // Пятнадцать нажатий без толку — цикл завис: убить, чтобы тест упал, а не висел.
          press(presses > 15 ? "SIGKILL" : "SIGINT");
        }, 100);
        child.on("close", (code, signal) => { clearInterval(watch); resolveLoop({ code, signal, out: sane(out), ms: Date.now() - started, presses }); });
      });
    },
    meanwhile: () => read(`${env.FAKE_LOG}.meanwhile`),
    /** Окружение, в котором скрипт запустил тесты. */
    ci: () => read(`${env.FAKE_LOG}.ci`),
    keys: (lines) => writeFileSync(join(home, ".heart.env"), lines.join("\n") + "\n"),
    cli: () => read(env.FAKE_LOG).split("\n").filter(Boolean).map(line => JSON.parse(line)),
    curl: () => read(env.FAKE_CURL_LOG).split("\n").filter(Boolean),
    /** Как звали посредника двери: по строке на вызов. */
    door: () => read(env.FAKE_DOOR_LOG).split("\n").filter(Boolean).map(line => JSON.parse(line)),
    envFile: () => read(join(home, ".heart.env")),
    /** Новый коммит в «GitHub»: по желанию — с новым номером сборки. */
    commit(build = null, { wip = false } = {}) {
      if (build) writeFileSync(join(seed, "tgcloud/lib/heart.js"), `export const BUILD = "${build}";\n`);
      writeFileSync(join(seed, "note.txt"), `${Math.random()}\n`);
      if (wip) writeFileSync(join(seed, "tgcloud/wip.js"), "// недоделанное\n");
      sh(seed, "git add -A && git commit -q -m next && git push -q origin work");
      return sh(seed, "git rev-parse HEAD");
    },
    head: () => sh(phone, "git rev-parse HEAD"),
    status: () => sh(phone, "git status --porcelain --untracked-files=no"),
    state: (name) => read(join(home, ".heart", name)),
    clean: () => rmSync(dir, { recursive: true, force: true }),
  };
}
