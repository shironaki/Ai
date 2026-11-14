/**
 * Дом на телефоне (`scripts/phone.sh`): автопубликация и будильник.
 *
 * Настоящей платформы здесь нет: вместо инструмента публикации — запись его
 * вызовов, вместо curl — запись запросов. Проверяется порядок действий и то,
 * что ключи не остаются в файлах и не попадают на экран.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, chmodSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// В Termux нет /usr/bin/env, на который опираются подставные программы теста:
// сам скрипт там работает, а его песочница — нет. Публикацию это не держит.
const skip = process.platform === "win32" || process.platform === "android" ? "песочница скрипта собирается только на обычном Linux и macOS" : false;
// Песочница не наследует настройки настоящего дома: эти тесты гоняет и сам
// скрипт перед публикацией, и разработчик, у которого ключи лежат в окружении.
const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(?:HEART_|ALARM_|TGCLOUD_|KEY_|FAKE_)|^(?:AI_PROVIDER_KEY|AI_EXTRA_KEYS|OWNER_TG_ID)$/u.test(name)));
const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const TOKEN = "app123:SECRET-PLATFORM-TOKEN";
const KEYS = { model: "gsk-SECRET-MODEL-KEY", giga: "GIGA-SECRET-KEY", voice: "777:VOICE-SECRET" };

const FAKE_CLI = `
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
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
appendFileSync(process.env.FAKE_LOG, JSON.stringify({
  args,
  token: process.env.TGCLOUD_TOKEN === ${JSON.stringify(TOKEN)},
  key: secrets.includes(${JSON.stringify(KEYS.model)}),
  giga: secrets.includes(${JSON.stringify(KEYS.giga)}),
  explabs: secrets.includes("xpl_1"),
  // Чей код исполняется: недоделанный коммит песочницы несёт tgcloud/wip.js.
  wip: existsSync("tgcloud/wip.js"),
  inRepo: existsSync(".git"),
  strayed: root !== started,
}) + "\\n");
if (!found) { console.log("✗ Module not found"); process.exit(1); }
// В соседнем окне посреди публикации запускают что-то ещё.
if (process.env.FAKE_MEANWHILE && args[0] === "fetch") {
  const other = spawnSync("bash", ["-c", process.env.FAKE_MEANWHILE], { cwd: started, encoding: "utf8", env: { ...process.env, FAKE_MEANWHILE: "" } });
  appendFileSync(process.env.FAKE_LOG + ".meanwhile", String(other.stdout) + String(other.stderr));
}
const fail = String(process.env.FAKE_FAIL || "");
const name = args[0] === "run" ? "run:" + args[1] : args[0];
if (fail && (fail === args[0] || fail === name)) { console.log(process.env.FAKE_SAYS || "✗ boom"); process.exit(1); }
if (args[0] === "webhook") console.log("  url: https://secret.example/hook\\n  allowed updates: message, channel_post");
if (args[0] === "run") console.log(args.includes("{ tick: true }") && process.env.FAKE_MISMATCH ? "{ ok: false, code: 'build_mismatch' }" : "{ ok: true }");
`;

/** Журналы упавших тестов — как их пишут node 24 и node 22 (сокращённо). */
const TEST_LOGS = {
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

function sh(cwd, command, env = {}) {
  const done = spawnSync("bash", ["-c", command], { cwd, env: { ...CLEAN_ENV, ...GIT_ENV, ...env }, encoding: "utf8" });
  if (done.status !== 0) throw new Error(`${command}\n${done.stdout}\n${done.stderr}`);
  return done.stdout.trim();
}

/** Песочница: «GitHub», папка на телефоне, файл ключей, поддельные инструменты. */
function sandbox({ lines = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "heart-phone-"));
  const seed = join(dir, "seed"), phone = join(dir, "phone"), home = join(dir, "home"), bin = join(dir, "bin");
  for (const path of [join(seed, "scripts"), join(seed, "tgcloud/lib"), join(seed, "tgcloud/handlers"), home, bin]) mkdirSync(path, { recursive: true });
  copyFileSync(join(ROOT, "scripts/phone.sh"), join(seed, "scripts/phone.sh"));
  copyFileSync(join(ROOT, "scripts/inject-secrets.mjs"), join(seed, "scripts/inject-secrets.mjs"));
  copyFileSync(join(ROOT, "tgcloud/lib/secrets.js"), join(seed, "tgcloud/lib/secrets.js"));
  writeFileSync(join(seed, "tgcloud/lib/heart.js"), 'export const BUILD = "1.0.0";\n');
  writeFileSync(join(seed, "tgcloud/handlers/message.js"), "export default async function () {}\n");
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
  };
  const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");
  // Ни один режим не должен кончаться ошибкой самого bash: такая строка в
  // Termux выглядит как поломка, даже когда всё сделано.
  const sane = (out) => { assert.doesNotMatch(out, /unbound variable|syntax error|command not found/u); return out; };
  return {
    dir, phone, home, seed,
    run(mode = "once", extra = {}) {
      const done = spawnSync("bash", ["scripts/phone.sh", ...String(mode).split(" ")], { cwd: phone, env: { ...CLEAN_ENV, ...GIT_ENV, ...env, ...extra }, encoding: "utf8", timeout: 60_000 });
      return { code: done.status, out: sane(`${done.stdout}${done.stderr}`) };
    },
    /** Вечный цикл: работает, пока не выполнится условие, затем его останавливают, как Ctrl+C. */
    loop(until, extra = {}) {
      return new Promise((resolveLoop) => {
        // Своя группа процессов: Ctrl+C в терминале получают все, кто в ней, — и bash, и его sleep.
        const child = spawn("bash", ["scripts/phone.sh"], { cwd: phone, env: { ...CLEAN_ENV, ...GIT_ENV, ...env, ...extra }, detached: true });
        let out = "", asked = false;
        child.stdout.on("data", chunk => { out += chunk; });
        child.stderr.on("data", chunk => { out += chunk; });
        const started = Date.now();
        const watch = setInterval(() => {
          if (asked || !(until() || Date.now() - started > 40_000)) return;
          asked = true;
          try { process.kill(-child.pid, "SIGINT"); } catch { child.kill("SIGINT"); }
        }, 100);
        child.on("close", (code, signal) => { clearInterval(watch); resolveLoop({ code, signal, out: sane(out), ms: Date.now() - started }); });
      });
    },
    meanwhile: () => read(`${env.FAKE_LOG}.meanwhile`),
    /** Окружение, в котором скрипт запустил тесты. */
    ci: () => read(`${env.FAKE_LOG}.ci`),
    keys: (lines) => writeFileSync(join(home, ".heart.env"), lines.join("\n") + "\n"),
    cli: () => read(env.FAKE_LOG).split("\n").filter(Boolean).map(line => JSON.parse(line)),
    curl: () => read(env.FAKE_CURL_LOG).split("\n").filter(Boolean),
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

const names = (calls) => calls.map(item => (item.args[0] === "run" ? `run:${item.args[1]}${item.args.includes("{ tick: true, deployed: true }") ? ":deployed" : item.args.includes("{ tick: true }") ? ":tick" : ""}` : item.args.slice(0, 2).join(" ").trim()));

test("первый круг публикует: репетиция → публикация → схема → вебхук → пробуждение, ключи только на время", { skip }, () => {
  const box = sandbox();
  try {
    const first = box.run("once");
    assert.equal(first.code, 0, first.out);
    const calls = box.cli();
    assert.deepEqual(names(calls), ["run:handlers/message", "run:handlers/channel_post", "fetch", "push handlers", "migrate --yes", "webhook", "run:handlers/message:deployed"]);
    assert.deepEqual(calls.find(item => item.args[0] === "push").args, ["push", "handlers", "lib", "schema"]);
    assert.ok(calls.every(item => item.token), "токен публикации доходит до инструмента");
    assert.ok(calls.every(item => item.key && item.giga), "ключ модели и запасной (KEY_GIGACHAT) вписаны на время публикации");
    assert.equal(box.status(), "", "после публикации в папке не осталось ни одного ключа");
    assert.match(box.state("published"), /^[0-9a-f]{40}\n1\.0\.0\n/u);
    assert.match(first.out, /Сборка 1\.0\.0 опубликована/u);
    for (const secret of [TOKEN, ...Object.values(KEYS)]) assert.ok(!first.out.includes(secret), "ключи не печатаются");
    assert.ok(!box.state("deploy.log").includes("secret.example"), "адрес вебхука в журнал не пишется");
    // Будильник: первое сообщение в канал, затем — правка его же.
    assert.ok(box.curl().some(line => line.includes("sendMessage") && line.includes("chat_id=-100")));
    assert.equal(box.state("alarm.msg").trim(), "77");

    const second = box.run("once");
    assert.equal(second.code, 0, second.out);
    assert.equal(box.cli().length, calls.length, "та же сборка второй раз не публикуется");
    assert.ok(box.curl().at(-1).includes("editMessageText") && box.curl().at(-1).includes("message_id=77"));
  } finally { box.clean(); }
});

test("новый коммит без нового номера сборки ждёт; новый номер публикуется сам", { skip }, () => {
  const box = sandbox();
  try {
    box.run("once");
    const before = box.cli().length;
    const middle = box.commit();
    box.run("once");
    assert.equal(box.head(), middle, "папка идёт за веткой");
    assert.equal(box.cli().length, before, "недоделанное в живого бота не уходит");

    box.commit("1.1.0");
    const done = box.run("once");
    assert.match(done.out, /Сборка 1\.1\.0 опубликована/u);
    assert.match(box.state("published"), /\n1\.1\.0\n/u);

    // «Каждый коммит» — по желанию владельца.
    const count = box.cli().length;
    box.commit();
    box.run("once", { HEART_DEPLOY_ON: "commit" });
    assert.ok(box.cli().length > count);
  } finally { box.clean(); }
});

test("репетиция упала — публикации нет; владелец узнаёт один раз; после трёх попыток — раз в час", { skip }, () => {
  const box = sandbox();
  try {
    const first = box.run("once", { FAKE_FAIL: "run:handlers/channel_post" });
    assert.match(first.out, /Не прошло: репетиция: пост канала — публикации нет, бот на прежней сборке\. Подробности/u);
    assert.ok(!box.cli().some(item => item.args[0] === "push"), "до публикации дело не дошло");
    assert.equal(box.status(), "", "ключи убраны и после неудачи");
    assert.equal(box.state("published"), "");
    const told = () => box.curl().filter(line => line.includes("chat_id=42"));
    assert.equal(told().length, 1);
    assert.match(told()[0], /не опубликована/u);

    box.run("once", { FAKE_FAIL: "run:handlers/channel_post" });
    const third = box.run("once", { FAKE_FAIL: "run:handlers/channel_post" });
    assert.match(third.out, /Три попытки подряд не вышли\. Этот коммит дальше пробую раз в 60 мин; новый коммит — сразу/u);
    assert.equal(told().length, 1, "об одной и той же поломке — одно сообщение");
    const tried = box.cli().length;
    box.run("once");
    assert.equal(box.cli().length, tried, "три неудачи — в ближайший час этот коммит не трогается");
    // Причина бывает временной (связь): через час — ещё попытка, без нового сообщения владельцу.
    const [commit, count] = box.state("failed").split("\n");
    assert.equal(count, "3");
    writeFileSync(join(box.home, ".heart/failed"), `${commit}\n3\n${Math.floor(Date.now() / 1000) - 3700}\n`);
    box.run("once", { FAKE_FAIL: "run:handlers/channel_post" });
    assert.ok(box.cli().length > tried, "час прошёл — попытка повторяется");
    assert.equal(told().length, 1);
    const again = box.cli().length;
    box.run("once");
    assert.equal(box.cli().length, again, "и снова ждёт час");

    box.commit("1.0.1");
    // Связь и токен — частые причины первого запуска: о них сказано словами, без похода в журнал.
    const offline = box.run("once", { FAKE_FAIL: "run:handlers/message", FAKE_SAYS: "✗ Could not reach the tgcloud server at https://cloud.telegram.org." });
    assert.match(offline.out, /Не прошло: репетиция: сообщение — публикации нет, бот на прежней сборке\. Причина: нет связи с платформой Telegram\./u);
    const rejected = box.run("once", { FAKE_FAIL: "run:handlers/message", FAKE_SAYS: "Error: TGCLOUD_TOKEN (app123): token is invalid or expired." });
    assert.match(rejected.out, /Причина: платформа не приняла токен публикации\./u);
    const fixed = box.run("once");
    assert.match(fixed.out, /Сборка 1\.0\.1 опубликована/u);
  } finally { box.clean(); }
});

test("тесты не прошли — в облако ничего не уходит; ключи и настройки дома до тестов не доходят", { skip }, () => {
  const box = sandbox();
  try {
    const done = box.run("once", { HEART_TESTS: "on", FAKE_CI: "1" });
    assert.match(done.out, /Тесты не прошли/u);
    assert.equal(box.cli().length, 0);
    // Тестам не нужны ни ключи, ни «за какой веткой следить»: с ними они и текут, и ведут себя иначе.
    const seen = box.ci();
    for (const secret of [TOKEN, ...Object.values(KEYS)]) assert.ok(!seen.includes(secret), "ключи до тестов не доходят");
    assert.doesNotMatch(seen, /^(?:HEART_|ALARM_|TGCLOUD_|KEY_|AI_PROVIDER_KEY=|AI_EXTRA_KEYS=|OWNER_TG_ID=)/mu);
    assert.match(seen, /^FAKE_CI=1$/mu, "остальное окружение — как было");
    assert.match(seen, /^PATH=/mu);

    // Что именно не прошло и почему — на экране, каждая неудача один раз. node
    // пишет журнал в двух видах: 24-й — «✖» с итоговым разделом, 22-й — TAP.
    for (const [kind, text] of Object.entries(TEST_LOGS)) {
      const file = join(box.dir, `${kind}.log`);
      writeFileSync(file, text);
      const out = box.run("once", { HEART_TESTS: "on", FAKE_CI: "1", FAKE_CI_OUT: file }).out;
      const lines = out.split("\n").map(line => line.replace(/^\d\d\.\d\d \d\d:\d\d /u, ""));
      const from = lines.findIndex(line => line.startsWith("✗ Тесты не прошли"));
      const named = kind === "spec";
      assert.deepEqual(lines.slice(from + 1, from + 5), [
        "   ✖ канал: ответ сестры доходит",
        `       ${named ? "TypeError [Error]: " : ""}Cannot read properties of undefined (reading 'text')`,
        "   ✖ канал: опоздавший ответ",
        `       ${named ? "AssertionError [ERR_ASSERTION]: " : ""}ответ снимает молчание`,
      ], kind);
      assert.match(lines[from + 5], /Если дело в самом телефоне/u, kind);
      assert.doesNotMatch(out, /failing tests|not ok|\(\d[\d.]*ms\)/u, kind);
    }

    // Три неудачи подряд уже были: следующая попытка — через час или после перезапуска.
    assert.equal(box.run("once", { HEART_TESTS: "on" }).out, "");
    rmSync(join(box.home, ".heart/failed"));
    const passed = box.run("once", { HEART_TESTS: "on" });
    assert.match(passed.out, /Проверяю сборку тестами/u);
    assert.match(passed.out, /Сборка 1\.0\.0 опубликована/u);
    assert.ok(box.cli().every(item => item.key && item.token), "а публикации ключи достались");
  } finally { box.clean(); }
});

test("без второго бота будильник идёт через платформу; чужая сборка — не удар", { skip }, () => {
  const box = sandbox({ lines: [`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "HEART_BRANCH=work", 'AI_EXTRA_KEYS={"explabs":"xpl_1abcdef"}'] });
  try {
    const done = box.run("once");
    assert.equal(done.code, 0, done.out);
    const calls = box.cli();
    assert.equal(names(calls).at(-1), "run:handlers/message:tick");
    assert.ok(calls.at(-1).key && calls.at(-1).explabs, "удару нужны те же ключи; JSON в файле ключей читается как есть");
    assert.equal(box.curl().length, 0, "второго бота нет — в Telegram никто не ходит");
    assert.equal(box.status(), "");

    const tick = box.run("tick", { FAKE_MISMATCH: "1" });
    assert.equal(tick.code, 1);
    assert.match(tick.out, /другая сборка/u);
  } finally { box.clean(); }
});

test("несохранённые правки в папке не стираются; проверка настройки не показывает ключей", { skip }, () => {
  const box = sandbox();
  try {
    box.run("once");
    const before = box.head();
    writeFileSync(join(box.phone, "package.json"), "{}\n");
    box.commit("2.0.0");
    const done = box.run("once");
    assert.match(done.out, /несохранённые правки/u);
    assert.equal(box.head(), before);
    assert.equal(readFileSync(join(box.phone, "package.json"), "utf8"), "{}\n");

    const check = box.run("check");
    assert.match(check.out, /токен публикации: вид правильный/u);
    assert.match(check.out, /запасные мозги: gigachat/u);
    assert.match(check.out, /от имени @voice_bot, канал «Мост "дом"»/u, "название канала — словом, а не \\u041c…, и с кавычками внутри");
    for (const secret of [TOKEN, ...Object.values(KEYS)]) assert.ok(!check.out.includes(secret), "ключи не печатаются");
    assert.ok(!box.cli().slice(-1)[0].args.includes("push"), "проверка ничего не публикует");
  } finally { box.clean(); }
});

test("строка-образец вместо ключа в живого бота не уходит", { skip }, () => {
  // Файл ключей заполнен по инструкции, но значения не вписаны.
  const box = sandbox({ lines: [`TGCLOUD_HEART_TOKEN=${TOKEN}`, "AI_PROVIDER_KEY=ключ модели", "OWNER_TG_ID=ваш числовой ID", "KEY_GIGACHAT=Authorization Key из Сбера", "HEART_BRANCH=work"] });
  try {
    const check = box.run("check");
    assert.equal(check.code, 1);
    assert.match(check.out, /✗ AI_PROVIDER_KEY не похож на ключ/u);
    assert.match(check.out, /✗ KEY_GIGACHAT не похож на ключ/u);
    assert.match(check.out, /Сначала поправьте строки с ✗/u);
    assert.ok(!check.out.includes("Сбера") && !check.out.includes("ключ модели"), "значения не печатаются, даже образцы");

    const before = box.cli().length;
    const done = box.run("once");
    assert.match(done.out, /✗ Публикации нет, бот на прежней сборке: AI_PROVIDER_KEY .* не похож на ключ/u);
    assert.equal(box.cli().length, before, "в облако не ушло ничего: ни репетиции, ни публикации, ни удара");
    assert.equal(box.state("published"), "");
    assert.equal(box.status(), "");
    // Нехватка настройки — не попытка: сколько бы кругов ни прошло, исправленный файл публикуется сразу.
    for (let round = 0; round < 4; round += 1) box.run("once");
    assert.equal(box.state("failed"), "", "счёт неудач не тронут");
    assert.equal(box.cli().length, before);
    // Вечный цикл с такими ключами не крутится впустую, а говорит сразу.
    const refused = box.run("run");
    assert.equal(refused.code, 1);
    assert.match(refused.out, /✗ С такими ключами публиковать нельзя: AI_PROVIDER_KEY/u);
    box.keys([`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "HEART_BRANCH=work"]);
    assert.match(box.run("once").out, /Сборка 1\.0\.0 опубликована/u);
  } finally { box.clean(); }

  // Ключ модели настоящий, а запасной и ID — образцы: публикация идёт, образцы в код не попадают.
  const mixed = sandbox({ lines: [`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "OWNER_TG_ID=ваш числовой ID", "KEY_GIGACHAT=Authorization Key из Сбера", "HEART_BRANCH=work"] });
  try {
    const done = mixed.run("once");
    assert.match(done.out, /Сборка 1\.0\.0 опубликована/u);
    const pushed = mixed.cli().find(item => item.args[0] === "push");
    assert.equal(pushed.key, true);
    assert.equal(pushed.giga, false);
    // Что именно вписалось: запасных провайдеров ноль, владельца нет.
    const filled = spawnSync("node", ["scripts/inject-secrets.mjs"], { cwd: mixed.phone, encoding: "utf8", env: { ...CLEAN_ENV, AI_PROVIDER_KEY: KEYS.model, OWNER_TG_ID: "ваш числовой ID", KEY_GIGACHAT: "Authorization Key из Сбера", AI_EXTRA_KEYS: '{"explabs":"ключ из кабинета"}' } });
    assert.match(filled.stdout, /provider key yes, owner no, spare providers 0/u);
    assert.match(filled.stdout, /KEY_GIGACHAT does not look like a key/u);
    assert.ok(!filled.stdout.includes("Authorization Key"), "само значение не печатается");
    const secrets = readFileSync(join(mixed.phone, "tgcloud/lib/secrets.js"), "utf8");
    assert.ok(!/Сбера|числовой|кабинета/u.test(secrets));
    // Строгий режим с образцом вместо ключа — стоп, файл не тронут.
    sh(mixed.phone, "git checkout -q -- tgcloud/lib/secrets.js");
    const strict = spawnSync("node", ["scripts/inject-secrets.mjs", "--require-key"], { cwd: mixed.phone, encoding: "utf8", env: { ...CLEAN_ENV, AI_PROVIDER_KEY: "ключ модели" } });
    assert.equal(strict.status, 1);
    assert.equal(mixed.status(), "");
  } finally { mixed.clean(); }
});

test("старая папка на другой ветке сама переходит на нужную; причина отказа GitHub названа словами", { skip }, () => {
  const box = sandbox();
  try {
    // Папка осталась от прежних попыток: своя ветка, старый коммит.
    sh(box.phone, "git checkout -q -b leftover");
    const fresh = box.commit("1.1.0");
    const check = box.run("check");
    assert.match(check.out, /папка пока на коммите [0-9a-f]{7} — при запуске обновится сама/u);
    const done = box.run("once");
    assert.equal(box.head(), fresh);
    assert.match(done.out, /Сборка 1\.1\.0 опубликована/u);
  } finally { box.clean(); }

  const lost = sandbox({ lines: [`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "HEART_BRANCH=nope"] });
  try {
    const check = lost.run("check");
    assert.equal(check.code, 1);
    assert.match(check.out, /✗ ветки «nope» в GitHub нет — сверьте строку HEART_BRANCH/u);
    const quiet = lost.run("once");
    assert.match(quiet.out, /Новое из GitHub не взять: ветки «nope» в GitHub нет/u);
  } finally { lost.clean(); }
});

test("удар через платформу идёт опубликованным кодом, а не тем, что лежит в папке", { skip }, () => {
  const lines = [`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "HEART_BRANCH=work"];
  // До первой публикации бить нечем: чужой код в живую базу не ходит.
  const cold = sandbox({ lines });
  try {
    const failed = cold.run("once", { FAKE_FAIL: "push" });
    assert.match(failed.out, /Публикация не прошла/u);
    assert.match(failed.out, /начнёт бить после первой публикации с этого телефона/u);
    assert.ok(!names(cold.cli()).includes("run:handlers/message:tick"), "неопубликованная сборка базу не трогает");
    const tick = cold.run("tick");
    assert.equal(tick.code, 1);
  } finally { cold.clean(); }

  const box = sandbox({ lines });
  try {
    box.run("once");
    const first = box.cli().at(-1);
    assert.deepEqual([names([first])[0], first.inRepo, first.wip, first.key], ["run:handlers/message:tick", false, false, true], "удар — из слепка, с ключом");
    // Пришёл недоделанный коммит: папка ушла за веткой, удар остался на опубликованном.
    const middle = box.commit(null, { wip: true });
    box.run("once");
    assert.equal(box.head(), middle);
    assert.ok(existsSync(join(box.phone, "tgcloud/wip.js")));
    const tick = box.run("tick");
    assert.equal(tick.code, 0, tick.out);
    const beat = box.cli().at(-1);
    assert.deepEqual([names([beat])[0], beat.wip, beat.key], ["run:handlers/message:tick", false, true], "недоделанное в базу не ходит");
    assert.ok(!readFileSync(join(box.home, ".heart/live/tgcloud/lib/secrets.js"), "utf8").includes(KEYS.model), "ключ в слепке — только на время удара");
    // Новый номер сборки: публикуется, и удар переходит на новый код.
    box.commit("1.1.0");
    box.run("once");
    const next = box.run("tick");
    assert.equal(next.code, 0, next.out);
    assert.equal(box.cli().at(-1).wip, true, "после публикации слепок — новая сборка");
    assert.match(readFileSync(join(box.home, ".heart/live/tgcloud/lib/heart.js"), "utf8"), /1\.1\.0/u);
  } finally { box.clean(); }
});

test("первый запуск без файла ключей: проверка создаёт пустой файл с готовыми именами и говорит, что дальше", { skip }, () => {
  const box = sandbox();
  const file = join(box.home, ".heart.env");
  try {
    rmSync(file);
    const first = box.run("check");
    assert.equal(first.code, 1);
    assert.match(first.out, /файла не было, создан пустой/u);
    assert.match(first.out, /Дальше: (?:nano|pkg install -y nano && nano|\S+) \S+\.heart\.env — вписать значения/u);
    const made = readFileSync(file, "utf8");
    assert.match(made, /^TGCLOUD_HEART_TOKEN=$/mu);
    assert.match(made, /^AI_PROVIDER_KEY=$/mu);
    assert.match(made, /^HEART_BRANCH=work$/mu, "ветка — та, с которой склонирована папка");
    assert.match(made, /^# ALARM_BOT_TOKEN=$/mu);
    assert.equal(statSync(file).mode & 0o777, 0o600, "файл ключей закрыт от чужих глаз");
    assert.equal(box.cli().length, 0);

    // Пустой файл — ещё не настройка: ни цикл, ни публикация не начинаются.
    const second = box.run("check");
    assert.match(second.out, /— найден/u);
    assert.match(second.out, /✗ нет TGCLOUD_HEART_TOKEN/u);
    assert.match(second.out, /Сначала поправьте строки с ✗ \(ключи — в \S+\.heart\.env\)/u);
    const idle = box.run("run");
    assert.equal(idle.code, 1);
    assert.match(idle.out, /делать нечего\. Начните с проверки/u);
    assert.equal(box.cli().length, 0);

    // Ключ вставлен отдельной строкой, под именем: названы номера строк, сам текст — нет.
    box.keys(["# ключи", "TGCLOUD_HEART_TOKEN=", TOKEN, "", "AI_PROVIDER_KEY=", "QWxhZGRpbjpvcGVuIHNlc2FtZQ=="]);
    const loose = box.run("check");
    assert.equal(loose.code, 1);
    assert.match(loose.out, /✗ в файле ключей не читаются строки: 3 6 — нужно «ИМЯ=значение» в одной строке/u);
    assert.match(loose.out, /✗ нет TGCLOUD_HEART_TOKEN/u);
    assert.ok(!loose.out.includes(TOKEN) && !loose.out.includes("QWxhZGRp"), "содержимое непонятой строки не печатается");

    // Заполненный файл проверка не трогает никогда.
    box.keys([`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`]);
    const ready = box.run("check");
    assert.equal(ready.code, 0, ready.out);
    assert.match(ready.out, /Готово к работе: bash scripts\/phone\.sh/u);
    assert.match(readFileSync(file, "utf8"), /^AI_PROVIDER_KEY=gsk-/mu);
  } finally { box.clean(); }
});

test("без строки HEART_BRANCH дом идёт за веткой, с которой склонирована папка", { skip }, () => {
  const box = sandbox({ lines: [`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`] });
  try {
    assert.match(box.run("check").out, /Ветка:\s+work \(ветка папки\)/u);
    assert.match(box.run("once").out, /Сборка 1\.0\.0 опубликована/u);
    // После первого обновления папка стоит на коммите, а не на ветке: имя помнится.
    const fresh = box.commit("1.1.0");
    assert.match(box.run("once").out, /Сборка 1\.1\.0 опубликована/u);
    assert.equal(box.head(), fresh);
    assert.match(box.run("check").out, /Ветка:\s+work \(ветка папки, как в прошлый раз\)/u);
    box.commit("1.2.0");
    assert.match(box.run("once").out, /Сборка 1\.2\.0 опубликована/u);
  } finally { box.clean(); }
});

test("ветка, где этого скрипта нет (main до слияния): папка туда не уходит и ничего не публикуется", { skip }, () => {
  const box = sandbox({ lines: [`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "HEART_BRANCH=main"] });
  try {
    sh(box.seed, "git checkout -q -b main && git rm -q scripts/phone.sh && git commit -q -m old && git push -q origin main && git checkout -q work");
    const before = box.head();
    const check = box.run("check");
    assert.equal(check.code, 1);
    assert.match(check.out, /✗ в ветке «main» нет scripts\/phone\.sh/u);
    for (const mode of ["once", "deploy"]) {
      const done = box.run(mode);
      assert.match(done.out, /В ветке «main» нет scripts\/phone\.sh — на неё не перехожу и ничего не публикую/u);
      assert.equal(box.head(), before);
      assert.ok(existsSync(join(box.phone, "scripts/phone.sh")), "дом остался на месте");
    }
    assert.equal(box.run("deploy").code, 1);
    assert.deepEqual([...new Set(names(box.cli()))], ["fetch"], "то, что лежит в папке, под именем чужой ветки не публикуется: в облако ходила только проверка токена");
    assert.equal(box.state("published"), "");
  } finally { box.clean(); }
});

test("чужая папка .tgcloud выше по дереву инструмент не уводит; образцы в строках будильника — как пустые", { skip }, () => {
  const box = sandbox({ lines: [`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "HEART_BRANCH=work", "ALARM_BOT_TOKEN=токен тестового бота", "ALARM_CHAT_ID=числовой ID канала «Мост»"] });
  try {
    // Настоящий инструмент работает из ближайшей вверх папки с .tgcloud: такая могла остаться в домашней.
    mkdirSync(join(box.dir, ".tgcloud"));
    mkdirSync(join(box.home, ".tgcloud"));
    const check = box.run("check");
    assert.equal(check.code, 1);
    assert.match(check.out, /✗ ALARM_BOT_TOKEN не похож на токен бота/u);
    assert.match(check.out, /✗ ALARM_CHAT_ID не похож на ID канала/u);
    assert.match(check.out, /✓ платформа: токен принят/u);
    const done = box.run("once");
    assert.match(done.out, /Сборка 1\.0\.0 опубликована/u);
    const calls = box.cli();
    assert.ok(calls.every(item => !item.strayed), "и публикация, и удар идут из своих папок");
    assert.equal(names(calls).at(-1), "run:handlers/message:tick", "с образцом вместо токена будильник не стучится в Telegram, а идёт через платформу");
    assert.equal(calls.at(-1).inRepo, false);
    assert.equal(box.curl().length, 0);
    assert.equal(box.status(), "");
  } finally { box.clean(); }
});

test("проверка в соседнем окне не стирает ключи посреди публикации; второй дом рядом не запускается", { skip }, () => {
  const box = sandbox();
  try {
    const done = box.run("once", { FAKE_MEANWHILE: 'bash scripts/phone.sh check; bash scripts/phone.sh once; echo "код: $?"' });
    assert.match(box.meanwhile(), /Готово к работе/u);
    assert.match(box.meanwhile(), /Дом уже запущен \(процесс \d+\)\. Второй не нужен\./u);
    assert.match(box.meanwhile(), /код: 1/u);
    assert.match(done.out, /Сборка 1\.0\.0 опубликована/u);
    const calls = box.cli();
    const after = calls.slice(calls.findIndex(item => item.args[0] === "push"));
    assert.deepEqual(names(after), ["push handlers", "migrate --yes", "webhook", "run:handlers/message:deployed"]);
    assert.ok(after.every(item => item.key && item.giga), "ключи на месте: бот не уходит в облако пустым");
    assert.equal(box.status(), "");
  } finally { box.clean(); }
});

test("вечный цикл: публикует сразу, прошлые неудачи при запуске не в счёт, по Ctrl+C уходит чисто", { skip }, async () => {
  const box = sandbox();
  try {
    // Прошлый запуск трижды не смог; владелец поправил причину и запустил снова.
    for (let round = 0; round < 3; round += 1) box.run("once", { FAKE_FAIL: "fetch" });
    assert.match(box.state("failed"), /\n3\n/u);
    const done = await box.loop(() => box.state("published") !== "" && box.state("alarm.msg") !== "");
    assert.match(done.out, /Дом запущен: ветка «work»/u);
    assert.match(done.out, /Сборка 1\.0\.0 опубликована/u);
    assert.equal(done.code, 0, "остановка — не ошибка");
    assert.ok(done.ms < 30_000, "и конца минуты не ждёт");
    assert.ok(!existsSync(join(box.home, ".heart/lock")), "замок снят");
    assert.equal(box.status(), "");
    assert.equal(box.run("once").code, 0, "следующему запуску ничто не мешает");
  } finally { box.clean(); }
});

test("«events»: спрашивает платформу о событиях, ничего не публикует и не создаёт; ответ — словами", { skip }, () => {
  const box = sandbox();
  try {
    const yes = box.run("events", { FAKE_FAIL: "add", FAKE_SAYS: '✗ Specify a name, e.g. "handlers/business_connection". Available handlers/ types: business_connection, business_message, inline_query.' });
    assert.equal(yes.code, 0);
    assert.match(yes.out, /Ответ платформы:\n {2}✗ Specify a name/u);
    assert.match(yes.out, /Событие business_message есть — «секретаря» сделать можно\./u);
    const no = box.run("events", { FAKE_FAIL: "add", FAKE_SAYS: '✗ Specify a name, e.g. "handlers/inline_query". Available handlers/ types: inline_query, poll.' });
    assert.match(no.out, /События business_message в списке нет/u);
    const vague = box.run("events", { FAKE_FAIL: "add", FAKE_SAYS: '✗ Specify a name, e.g. "handlers/<name>".' });
    assert.match(vague.out, /Списка событий в ответе нет\. Пришлите этот ответ/u);
    const calls = box.cli();
    assert.deepEqual(calls.map(item => item.args.join(" ")), ["add handlers", "add handlers", "add handlers"], "только вопрос: ни публикации, ни запуска");
    assert.ok(calls.every(item => item.token && !item.key), "токен — в окружении, ключей в слепке нет");
    assert.equal(box.status(), "");
    assert.doesNotMatch(`${yes.out}${no.out}${vague.out}`, new RegExp(TOKEN.split(":")[1], "u"));
    const blind = sandbox({ lines: ["HEART_BRANCH=work"] });
    try {
      const refused = blind.run("events");
      assert.equal(refused.code, 1);
      assert.match(refused.out, /нет токена публикации/u);
      assert.equal(blind.cli().length, 0);
    } finally { blind.clean(); }
  } finally { box.clean(); }
});

test("будильник голосом самой Аи: себя она не услышит — сказано прямо, удар идёт через платформу", { skip }, () => {
  // Номер бота в токене будильника тот же, что в токене публикации (app123): это один бот.
  const box = sandbox({ lines: [`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "HEART_BRANCH=work", "ALARM_BOT_TOKEN=123:OWN-BOT-SECRET", "ALARM_CHAT_ID=-100"] });
  try {
    const check = box.run("check");
    assert.equal(check.code, 1);
    assert.match(check.out, /✗ будильник: @voice_bot — это сама Аи \(тот же бот, что публикуется\): себя она не услышит/u);
    assert.doesNotMatch(check.out, /✓ будильник/u);
    const done = box.run("once");
    assert.match(done.out, /Сборка 1\.0\.0 опубликована/u);
    assert.equal(names(box.cli()).at(-1), "run:handlers/message:tick", "будит платформа, а не канал");
    assert.ok(!box.curl().some(line => /sendMessage|editMessageText/u.test(line) && line.includes("chat_id=-100")), "в канал от её же имени никто не пишет");
    // Другой бот — другое дело: минутный будильник через канал.
    box.keys([`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "HEART_BRANCH=work", `ALARM_BOT_TOKEN=${KEYS.voice}`, "ALARM_CHAT_ID=-100"]);
    assert.match(box.run("check").out, /✓ будильник: раз в 60 с от имени @voice_bot/u);
    box.run("once");
    assert.ok(box.curl().some(line => line.includes("sendMessage") && line.includes("chat_id=-100")));
  } finally { box.clean(); }
});
