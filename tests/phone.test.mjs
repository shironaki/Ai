/**
 * Дом на телефоне (`scripts/phone.sh`): автопубликация и будильник.
 *
 * Настоящей платформы здесь нет: вместо инструмента публикации — запись его
 * вызовов, вместо curl — запись запросов. Проверяется порядок действий и то,
 * что ключи не остаются в файлах и не попадают на экран.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// В Termux нет /usr/bin/env, на который опираются подставные программы теста:
// сам скрипт там работает, а его песочница — нет. Публикацию это не держит.
const skip = process.platform === "win32" || process.platform === "android" ? "песочница скрипта собирается только на обычном Linux и macOS" : false;
const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const TOKEN = "app123:SECRET-PLATFORM-TOKEN";
const KEYS = { model: "gsk-SECRET-MODEL-KEY", giga: "GIGA-SECRET-KEY", voice: "777:VOICE-SECRET" };

const FAKE_CLI = `
import { appendFileSync, readFileSync, existsSync } from "node:fs";
const args = process.argv.slice(2);
const secrets = readFileSync("tgcloud/lib/secrets.js", "utf8");
appendFileSync(process.env.FAKE_LOG, JSON.stringify({
  args,
  token: process.env.TGCLOUD_TOKEN === ${JSON.stringify(TOKEN)},
  key: secrets.includes(${JSON.stringify(KEYS.model)}),
  giga: secrets.includes(${JSON.stringify(KEYS.giga)}),
  explabs: secrets.includes("xpl_1"),
  // Чей код исполняется: недоделанный коммит песочницы несёт tgcloud/wip.js.
  wip: existsSync("tgcloud/wip.js"),
  inRepo: existsSync(".git"),
}) + "\\n");
const fail = String(process.env.FAKE_FAIL || "");
const name = args[0] === "run" ? "run:" + args[1] : args[0];
if (fail && (fail === args[0] || fail === name)) { console.log("✗ boom"); process.exit(1); }
if (args[0] === "webhook") console.log("  url: https://secret.example/hook\\n  allowed updates: message, channel_post");
if (args[0] === "run") console.log(args.includes("{ tick: true }") && process.env.FAKE_MISMATCH ? "{ ok: false, code: 'build_mismatch' }" : "{ ok: true }");
`;

const FAKE_CURL = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_CURL_LOG"
case "$*" in
  *getMe*) echo '{"ok":true,"result":{"id":777,"username":"voice_bot"}}' ;;
  *getChat*) echo '{"ok":true,"result":{"id":-100,"title":"Мост"}}' ;;
  *) echo '{"ok":true,"result":{"message_id":77}}' ;;
esac
`;

function sh(cwd, command, env = {}) {
  const done = spawnSync("bash", ["-c", command], { cwd, env: { ...process.env, ...GIT_ENV, ...env }, encoding: "utf8" });
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
  writeFileSync(join(seed, "package.json"), JSON.stringify({ name: "x", private: true, type: "module", scripts: { ci: "node -e \"process.exit(Number(process.env.FAKE_CI || 0))\"" } }));
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
  return {
    dir, phone, home,
    run(mode = "once", extra = {}) {
      const done = spawnSync("bash", ["scripts/phone.sh", ...String(mode).split(" ")], { cwd: phone, env: { ...process.env, ...GIT_ENV, ...env, ...extra }, encoding: "utf8", timeout: 60_000 });
      return { code: done.status, out: `${done.stdout}${done.stderr}` };
    },
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

test("репетиция упала — публикации нет; владелец узнаёт один раз; после трёх попыток ждёт нового коммита", { skip }, () => {
  const box = sandbox();
  try {
    const first = box.run("once", { FAKE_FAIL: "run:handlers/channel_post" });
    assert.match(first.out, /публикации нет, бот на прежней сборке/u);
    assert.ok(!box.cli().some(item => item.args[0] === "push"), "до публикации дело не дошло");
    assert.equal(box.status(), "", "ключи убраны и после неудачи");
    assert.equal(box.state("published"), "");
    const told = () => box.curl().filter(line => line.includes("chat_id=42"));
    assert.equal(told().length, 1);
    assert.match(told()[0], /не опубликована/u);

    box.run("once", { FAKE_FAIL: "run:handlers/channel_post" });
    box.run("once", { FAKE_FAIL: "run:handlers/channel_post" });
    assert.equal(told().length, 1, "об одной и той же поломке — одно сообщение");
    const tried = box.cli().length;
    box.run("once");
    assert.equal(box.cli().length, tried, "три неудачи — этот коммит больше не трогается");

    box.commit("1.0.1");
    const fixed = box.run("once");
    assert.match(fixed.out, /Сборка 1\.0\.1 опубликована/u);
  } finally { box.clean(); }
});

test("тесты не прошли — в облако ничего не уходит", { skip }, () => {
  const box = sandbox();
  try {
    const done = box.run("once", { HEART_TESTS: "on", FAKE_CI: "1" });
    assert.match(done.out, /Тесты не прошли/u);
    assert.equal(box.cli().length, 0);
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
    assert.match(check.out, /от имени @voice_bot, канал «Мост»/u);
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
    assert.match(done.out, /AI_PROVIDER_KEY .* не похож на ключ .* публикации нет/u);
    assert.equal(box.cli().length, before, "в облако не ушло ничего: ни репетиции, ни публикации, ни удара");
    assert.equal(box.state("published"), "");
    assert.equal(box.status(), "");
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
    const filled = spawnSync("node", ["scripts/inject-secrets.mjs"], { cwd: mixed.phone, encoding: "utf8", env: { ...process.env, AI_PROVIDER_KEY: KEYS.model, OWNER_TG_ID: "ваш числовой ID", KEY_GIGACHAT: "Authorization Key из Сбера", AI_EXTRA_KEYS: '{"explabs":"ключ из кабинета"}' } });
    assert.match(filled.stdout, /provider key yes, owner no, spare providers 0/u);
    assert.match(filled.stdout, /KEY_GIGACHAT does not look like a key/u);
    assert.ok(!filled.stdout.includes("Authorization Key"), "само значение не печатается");
    const secrets = readFileSync(join(mixed.phone, "tgcloud/lib/secrets.js"), "utf8");
    assert.ok(!/Сбера|числовой|кабинета/u.test(secrets));
    // Строгий режим с образцом вместо ключа — стоп, файл не тронут.
    sh(mixed.phone, "git checkout -q -- tgcloud/lib/secrets.js");
    const strict = spawnSync("node", ["scripts/inject-secrets.mjs", "--require-key"], { cwd: mixed.phone, encoding: "utf8", env: { ...process.env, AI_PROVIDER_KEY: "ключ модели" } });
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
